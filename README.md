# RoutineTracker (PWA)

말로 요청하면 AI 코치가 습관 루틴을 설계해주는 습관 앱. Android·iPhone 홈 화면에 설치해서 앱처럼 쓸 수 있다.

## 파일

| 파일 | 역할 |
|---|---|
| `index.html` | 화면 구조, PWA 메타태그, 파일 연결 |
| `style.css` | 디자인 + 모바일 대응(safe area, 키보드, 터치, 가로 화면) |
| `core.js` | Mock AI, Action Handler, 중앙 상태, 분석 계산 (화면 코드 없음) |
| `script.js` | 화면 렌더링, 탭, 채팅, 폼, 모바일/PWA 처리 |
| `manifest.json` | 앱 이름, 아이콘, 전체 화면 실행 설정 |
| `service-worker.js` | 오프라인 캐시 (정적 파일만) |
| `icon-*.png`, `maskable-*.png`, `apple-touch-icon.png`, `favicon-32.png` | 앱 아이콘 (폴더 없이 한곳에 둬서 폰에서도 한 번에 업로드 가능) |
| `render.yaml` | Render 배포 설정 |

## 로컬에서 실행

서비스 워커는 `http://localhost` 또는 `https`에서만 동작한다.

```
python3 -m http.server 8000
```

→ 브라우저에서 `http://localhost:8000` 열기. (`index.html`을 더블클릭해도 앱은 동작하지만 설치·오프라인 캐시는 안 된다.)

## 배포

- **GitHub Pages**: 이 폴더 내용을 저장소에 올리고 Settings → Pages → Branch `main`, 폴더 `/ (root)` 선택. 경로가 모두 상대 경로라 `https://아이디.github.io/저장소/`에서도 그대로 동작한다.
- **Render**: New → Static Site → 저장소 선택, Build Command 비움, Publish Directory `./`. 또는 `render.yaml`로 Blueprint 생성.

## 업데이트 배포할 때

`service-worker.js` 맨 위 `VERSION` 값을 바꿔야 설치된 앱이 새 파일을 받는다. 바꾸면 앱 안에 "새 버전이 준비됐어요 [업데이트]" 알림이 뜬다.
