# DeepLine Web 2.3.0

The DeepLine app as a web app: iMessage-style AI chat with glass UI, bounce animations, 信息 list, 动态 feed (AI likes / comments / posts), 增加AI, groups, red packets & transfers, tapback reactions, sounds, light/dark chat, backup ZIP (compatible with the Android app).

* **Zero dependencies** – plain Node.js (>= 18) server + static files. No build step.
* **No accounts, no database.** All chats, AI characters, API keys and images live in the visitor's own browser (IndexedDB).
* `POST /api/ai` is a tiny stateless relay to DeepSeek / Claude / 豆包 / ChatGPT so the browser does not hit CORS errors. The upstream URL comes from a fixed allow-list on the server (never from the client); keys are forwarded for that one request and never stored or logged. Per-IP rate limit (default 90/min, env `RATE_LIMIT_PER_MIN`) and 16 MB body limit.

## Deploy on Render (about 3 minutes)
1. Put this folder in a Git repository (GitHub / GitLab) and push it.
2. Render dashboard → **New + → Blueprint** → select the repo. `render.yaml` is picked up automatically (free web service, health check `/healthz`).
   *Or* **New + → Web Service** with: Runtime `Node`, Build Command `npm install --no-audit --no-fund`, Start Command `node server.js`, Health Check Path `/healthz`.
3. Open the `https://<name>.onrender.com` URL. On a phone use **Add to Home Screen** to install it as an app (it ships a web-app manifest).

Notes
* Render's free plan sleeps after ~15 min idle; the first request afterwards takes a few seconds. Any paid plan stays awake (the AI "auto post" timer only runs while the page is open anyway).
* HTTPS is provided by Render, which is required for microphone/speech recognition and for installing the PWA.
* Environment variables (all optional): `PORT` (Render sets it), `RATE_LIMIT_PER_MIN`.

## Run locally
```
node server.js        # http://localhost:3000   (PORT=8080 node server.js to change)
```

## Using it
1. **增加AI → 创建 AI**: name, persona, provider, model, API key (kept only in this browser).
2. Chat. Long-press (or right-click) a bubble for tapback / copy / quote / delete. Tap a bubble to show its time, model and token count. `+` opens image / GIF / 红包 / 转账.
3. **我的 → 数据与备份** to export/restore a ZIP. Android backups (`data.json` + `media/`) can be imported here and the other way round.
4. **我的 → 连接方式**: relay through this server (default, recommended) or call the provider directly from the browser (works only where the provider allows CORS).

## Differences from the Android app (browser limits)
* The **AI Smart Assistant** (AccessibilityService phone control) cannot exist in a web page – it is Android-only.
* Voice chat uses the browser's Web Speech API (Chrome / Edge / Safari); it is not available in every browser (e.g. Firefox). The 病娇 (Yandere) easter egg and shake sensor are not ported.
* Data is per browser. Clearing site data deletes it – export backups regularly.
* Because the default mode relays through your server, whoever operates the server could technically see requests in transit. This code does not store or log them; if you do not want that, use "浏览器直连" or self-host.

## Files
```
server.js              static server + /api/ai relay + /healthz
render.yaml            Render Blueprint
public/index.html      app shell, manifest, icons, sounds
public/css/app.css     glass / iMessage styling
public/js/*.js         lib (AI, ZIP, IndexedDB, sounds) · state · logic · core · home · chat · forms · settings
```
