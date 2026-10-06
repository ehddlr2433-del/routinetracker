const VERSION='rt-2026-10-06-2';
const SHELL=VERSION+'-shell',FONTS=VERSION+'-fonts';
const APP_SHELL=['./','./index.html','./manifest.json','./icon-192.png','./icon-512.png','./maskable-192.png','./maskable-512.png','./apple-touch-icon.png','./favicon-32.png'];
self.addEventListener('install',e=>{e.waitUntil((async()=>{const c=await caches.open(SHELL);await c.addAll(APP_SHELL.map(u=>new Request(u,{cache:'reload'})));if(!self.registration.active)await self.skipWaiting();})());});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{const k=await caches.keys();await Promise.all(k.filter(x=>!x.startsWith(VERSION)).map(x=>caches.delete(x)));await self.clients.claim();})());});
self.addEventListener('message',e=>{if(e.data&&e.data.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);
  if(u.origin===location.origin){if(/\/(api|ai|auth)\//i.test(u.pathname))return;
    if(r.mode==='navigate'){e.respondWith(page(r));return;}
    if(/\.(css|js|json|png|ico|woff2?)$/i.test(u.pathname)){e.respondWith(swr(r,SHELL));return;}return;}
  if(u.hostname==='fonts.googleapis.com'){e.respondWith(swr(r,FONTS));return;}
  if(u.hostname==='fonts.gstatic.com'){e.respondWith(cf(r,FONTS));}});
async function page(r){const c=await caches.open(SHELL);try{const res=await Promise.race([fetch(r),new Promise((_,j)=>setTimeout(()=>j(0),4000))]);if(res&&res.ok)c.put('./index.html',res.clone());return res;}catch(x){return(await c.match(r,{ignoreSearch:true}))||(await c.match('./index.html'))||new Response('오프라인입니다',{headers:{'Content-Type':'text/plain; charset=utf-8'}});}}
async function swr(r,n){const c=await caches.open(n);const hit=await c.match(r,{ignoreSearch:true});const net=fetch(r).then(res=>{if(res&&(res.ok||res.type==='opaque'))c.put(r,res.clone());return res;}).catch(()=>null);return hit||(await net)||Response.error();}
async function cf(r,n){const c=await caches.open(n);const hit=await c.match(r);if(hit)return hit;try{const res=await fetch(r);if(res&&(res.ok||res.type==='opaque'))c.put(r,res.clone());return res;}catch(x){return Response.error();}}
