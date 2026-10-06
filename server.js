const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const DAILY_LIMIT = Math.max(1, Math.min(100, Number(process.env.DAILY_LIMIT || 10)));
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter(Boolean),
);

const SYSTEM_PROMPT = `너는 RoutineTracker의 한국어 AI 습관 코치다. 사용자의 습관과 루틴 만들기, 조정, 실행 기록, 분석만 돕는다. 습관과 무관한 질문에는 정중히 범위를 알려준다. 제공된 context에 없는 통계나 기록을 사실처럼 만들어내지 않는다.

응답은 반드시 JSON 객체 하나여야 한다. 형식:
{"message":"사용자에게 보여줄 답변","actions":[],"suggestions":[]}

상태를 변경하는 요청이면 message에서 변경 내용을 설명하고 actions에 앱이 지원하는 명령만 넣는다. 사용자가 원하는 것이 불확실하면 actions를 비우고 되묻는다. 사용자가 명시적으로 요청하지 않은 삭제나 완료/실패 기록을 임의로 만들지 않는다. 습관 생성은 CREATE_HABIT과 ADD_ROUTINE을 함께 사용할 수 있다. 이미 있는 습관을 참조할 때는 context.habits의 실제 이름을 사용한다. 액션은 최대 3개다.

지원 액션 형식:
{"type":"CREATE_HABIT","habit":"습관 이름","time":"HH:MM","minutes":10,"days":["MON","WED","FRI"]}
{"type":"CHANGE_TIME","habit":"기존 습관 이름","time":"HH:MM"}
{"type":"CHANGE_DURATION","habit":"기존 습관 이름","minutes":10}
{"type":"CHANGE_DAYS","habit":"기존 습관 이름","days":["MON","TUE","WED","THU","FRI","SAT","SUN"]}
{"type":"ADD_ROUTINE","habit":"기존 습관 이름","title":"루틴 제목","time":"HH:MM","minutes":5,"days":["MON","WED","FRI"]}
{"type":"DELETE_HABIT","habit":"기존 습관 이름"}
{"type":"COMPLETE_ROUTINE","habit":"기존 습관 이름","date_offset":0}
{"type":"FAIL_ROUTINE","habit":"기존 습관 이름","date_offset":0,"reason":"tired|busy|forgot|motivation|sick|weather|social|burden"}
{"type":"SET_GOAL","goal":"사용자의 목표"}

요일은 MON,TUE,WED,THU,FRI,SAT,SUN만 사용한다. date_offset은 오늘 0, 어제 -1, 그제 -2만 사용한다. 새 습관은 구체적이고 부담이 낮은 이름으로 만들고 사용자가 시간/요일/기간을 말하지 않았다면 기본값을 과장해서 단정하지 않는다. suggestions는 후속 질문 예시 문자열 최대 3개다. 답변은 간결하고 친근한 한국어로 쓴다.`;

// Per-process quota protection. This resets when Render restarts the service;
// use a persistent store for a strict cross-restart quota in a production app.
const usage = new Map();
const minuteUsage = new Map();

function seoulDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}

function json(res, status, value, corsHeaders = {}) {
  res.writeHead(status, {
    ...corsHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(value));
}

function getOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return '';
  try { return new URL(origin).origin; } catch { return ''; }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let tooLarge = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      if (tooLarge) return;
      data += chunk;
      if (Buffer.byteLength(data, 'utf8') > 20_000) {
        tooLarge = true;
        data = '';
      }
    });
    req.on('end', () => {
      if (tooLarge) return reject(Object.assign(new Error('too_large'), { status: 413 }));
      try { resolve(JSON.parse(data || '{}')); }
      catch { reject(Object.assign(new Error('bad_json'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function takeQuota(req, device) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = (forwarded || req.socket.remoteAddress || 'unknown').slice(0, 80);
  const now = Date.now();
  const minuteKey = `${ip}:${Math.floor(now / 60_000)}`;
  const minuteCount = minuteUsage.get(minuteKey) || 0;
  if (minuteCount >= 12) return false;
  minuteUsage.set(minuteKey, minuteCount + 1);

  const key = `${seoulDate()}:${ip}:${device}`;
  const count = usage.get(key) || 0;
  if (count >= DAILY_LIMIT) return false;
  usage.set(key, count + 1);

  // Keep the in-memory maps bounded during long-running deployments.
  if (minuteUsage.size > 5_000) {
    for (const [k] of minuteUsage) if (!k.endsWith(`:${Math.floor(now / 60_000)}`)) minuteUsage.delete(k);
  }
  if (usage.size > 20_000) {
    const today = seoulDate();
    for (const k of usage.keys()) if (!k.startsWith(`${today}:`)) usage.delete(k);
  }
  return true;
}

const server = (await import('node:http')).createServer(async (req, res) => {
  const origin = getOrigin(req);
  const originAllowed = origin && allowedOrigins.has(origin);
  const cors = originAllowed ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type, X-RT-Device',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  } : {};

  if (req.method === 'GET' && req.url === '/healthz') {
    return json(res, 200, { ok: true }, cors);
  }
  if (req.method === 'OPTIONS' && req.url === '/api/chat') {
    if (!originAllowed) return json(res, 403, { error: 'origin_not_allowed' });
    res.writeHead(204, cors);
    return res.end();
  }
  if (req.method !== 'POST' || req.url !== '/api/chat') {
    return json(res, 404, { error: 'not_found' }, cors);
  }
  if (!originAllowed) return json(res, 403, { error: 'origin_not_allowed' });
  if (!process.env.OPENAI_API_KEY) return json(res, 503, { error: 'server_not_configured' }, cors);

  let body;
  try { body = await readBody(req); }
  catch (error) { return json(res, error.status || 400, { error: error.message === 'too_large' ? 'request_too_large' : 'invalid_json' }, cors); }

  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 600) : '';
  if (!message) return json(res, 400, { error: 'message_required' }, cors);
  const device = String(req.headers['x-rt-device'] || 'browser').slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!takeQuota(req, device)) return json(res, 429, { error: 'daily_limit' }, cors);

  const history = Array.isArray(body.history) ? body.history.slice(-8)
    .filter((item) => item && ['user', 'assistant'].includes(item.role) && typeof item.text === 'string')
    .map((item) => ({ role: item.role, content: item.text.slice(0, 400) })) : [];
  let context;
  try { context = JSON.stringify(body.context || {}).slice(0, 8_000); }
  catch { context = '{}'; }

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 25_000);
  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'system', content: `사용자의 현재 습관 데이터(context): ${context}` },
          ...history,
          { role: 'user', content: message },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.5,
        max_tokens: 700,
      }),
      signal: abort.signal,
    });
    if (!upstream.ok) {
      // Do not return upstream response bodies because they may contain diagnostics.
      const status = upstream.status === 429 ? 429 : 502;
      return json(res, status, { error: status === 429 ? 'upstream_rate_limit' : 'upstream_error' }, cors);
    }
    const payload = await upstream.json();
    let answer;
    try { answer = JSON.parse(payload.choices?.[0]?.message?.content || '{}'); }
    catch { return json(res, 502, { error: 'invalid_ai_response' }, cors); }

    const output = {
      message: typeof answer.message === 'string' ? answer.message.trim().slice(0, 1_500) : '',
      actions: Array.isArray(answer.actions) ? answer.actions.filter((a) => a && typeof a === 'object').slice(0, 3) : [],
      suggestions: Array.isArray(answer.suggestions)
        ? answer.suggestions.filter((s) => typeof s === 'string').map((s) => s.slice(0, 40)).slice(0, 3) : [],
    };
    if (!output.message) return json(res, 502, { error: 'empty_ai_response' }, cors);
    return json(res, 200, output, cors);
  } catch (error) {
    const status = error.name === 'AbortError' ? 504 : 502;
    return json(res, status, { error: status === 504 ? 'upstream_timeout' : 'upstream_unavailable' }, cors);
  } finally {
    clearTimeout(timeout);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`RoutineTracker API listening on port ${PORT}`);
});
