'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const { createProxyMiddleware } = require('http-proxy-middleware');

const PORT = parseInt(process.env.PORT || '3000', 10);
const PASSWORD = process.env.PASSWORD;
const MEDIAMTX_URL = (process.env.MEDIAMTX_URL || 'http://mediamtx:8888').replace(/\/$/, '');
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

if (!PASSWORD) {
  console.error('ERROR: PASSWORD environment variable is required');
  process.exit(1);
}

function parseCameras() {
  return (process.env.CAMERAS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(entry => {
      const idx = entry.indexOf(':');
      if (idx === -1) return { id: entry, label: entry };
      return { id: entry.slice(0, idx).trim(), label: entry.slice(idx + 1).trim() };
    })
    .filter(c => /^[a-zA-Z0-9_-]+$/.test(c.id));
}

const cameras = parseCameras();

const AUTH_TOKEN = crypto
  .createHmac('sha256', SESSION_SECRET)
  .update(PASSWORD)
  .digest('hex');

function isAuthed(req) {
  return req.cookies?.auth === AUTH_TOKEN;
}

function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  res.redirect('/');
}

const app = express();
app.disable('x-powered-by');
app.use(cookieParser());
app.use(express.urlencoded({ extended: false }));

app.get('/hls.js', (_req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules/hls.js/dist/hls.min.js'));
});

app.get('/', (req, res) => {
  if (isAuthed(req)) return res.redirect('/watch');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(loginHtml(!!req.query.error));
});

app.post('/login', (req, res) => {
  const input = String(req.body.password ?? '');
  const inputBuf = Buffer.from(input);
  const passBuf = Buffer.from(PASSWORD);
  const ok =
    inputBuf.length === passBuf.length && crypto.timingSafeEqual(inputBuf, passBuf);
  if (ok) {
    res.cookie('auth', AUTH_TOKEN, {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 365 * 24 * 60 * 60 * 1000,
    });
    return res.redirect('/watch');
  }
  res.redirect('/?error=1');
});

app.get('/logout', (_req, res) => {
  res.clearCookie('auth');
  res.redirect('/');
});

app.get('/watch', requireAuth, (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(watchHtml(cameras));
});

app.use(
  '/streams',
  requireAuth,
  createProxyMiddleware({
    target: MEDIAMTX_URL,
    changeOrigin: true,
    pathRewrite: { '^/streams': '' },
    onProxyRes(proxyRes) {
      // mediamtx issues a cookie-check redirect with a path like /cam1/index.m3u8?cookieCheck=1
      // which strips the /streams prefix. Rewrite it so the browser stays on the proxied path.
      if (proxyRes.headers.location) {
        proxyRes.headers.location = '/streams' + proxyRes.headers.location;
      }
    },
    onError(_err, _req, res) {
      if (!res.headersSent) res.status(502).end();
    },
  })
);

app.listen(PORT, () => {
  console.log(`Watchman on :${PORT} — ${cameras.length} camera${cameras.length !== 1 ? 's' : ''}`);
  if (cameras.length === 0) {
    console.log('  Set CAMERAS env var, e.g.: cam1:Front Door,cam2:Back Yard');
  }
});

// ── HTML templates ──────────────────────────────────────────────────────────

function esc(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loginHtml(error) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Watchman</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:#080808;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif}
body{display:flex;align-items:center;justify-content:center}
.card{width:310px;padding:40px 30px;background:#111;border:1px solid #1c1c1c;border-radius:14px}
.icon{width:42px;height:42px;margin:0 auto 22px;display:flex;align-items:center;justify-content:center;
  background:#181818;border:1px solid #222;border-radius:10px;color:#555}
h1{font-size:16px;font-weight:600;color:#ddd;text-align:center;margin-bottom:5px}
.sub{font-size:12px;color:#3a3a3a;text-align:center;margin-bottom:26px}
input{display:block;width:100%;padding:9px 13px;background:#0c0c0c;
  border:1px solid #1e1e1e;border-radius:8px;color:#ddd;font-size:14px;
  outline:none;transition:border-color .15s;margin-bottom:10px;letter-spacing:.05em}
input:focus{border-color:#333}
button{width:100%;padding:9px;background:#ddd;color:#080808;border:none;
  border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;transition:background .15s}
button:hover{background:#fff}
.err{font-size:12px;color:#c94040;text-align:center;margin-top:11px}
</style>
</head>
<body>
<div class="card">
  <div class="icon">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M15 10l4.55-2.07A1 1 0 0121 8.82v6.36a1 1 0 01-1.45.89L15 14"/>
      <rect x="2" y="7" width="13" height="10" rx="2"/>
    </svg>
  </div>
  <h1>Watchman</h1>
  <p class="sub">Enter password to view cameras</p>
  <form method="POST" action="/login">
    <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password">
    <button type="submit">Unlock</button>
  </form>
  ${error ? '<p class="err">Incorrect password</p>' : ''}
</div>
</body>
</html>`;
}

function watchHtml(cams) {
  const cols = cams.length <= 1 ? 1 : cams.length <= 4 ? 2 : 3;
  const rows = Math.max(1, Math.ceil(cams.length / cols));

  const tiles = cams.length === 0
    ? `<div class="empty">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 10l4.55-2.07A1 1 0 0121 8.82v6.36a1 1 0 01-1.45.89L15 14"/>
          <rect x="2" y="7" width="13" height="10" rx="2"/>
        </svg>
        <span>No cameras configured</span>
        <small>Set the CAMERAS environment variable</small>
       </div>`
    : cams.map(({ id, label }) => `
    <div class="tile" id="tile-${esc(id)}">
      <video id="v-${esc(id)}" autoplay muted playsinline></video>
      <div class="loading">
        <div class="spinner"></div>
      </div>
      <div class="offline">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
          <line x1="2" y1="2" x2="22" y2="22"/>
          <path d="M15 10l4.55-2.07A1 1 0 0121 8.82v5.5M11.5 7H13a2 2 0 012 2v.5M2 9a2 2 0 012-2h.5"/>
          <rect x="2" y="7" width="13" height="10" rx="2"/>
        </svg>
        <span>Offline</span>
      </div>
      <div class="label">${esc(label)}</div>
    </div>`).join('');

  const camsJson = JSON.stringify(cams.map(c => ({ id: c.id, label: c.label })));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Watchman</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:#000;overflow:hidden}

.grid{
  display:grid;
  width:100vw;
  height:100dvh;
  grid-template-columns:repeat(${cols},1fr);
  grid-template-rows:repeat(${rows},1fr);
  gap:2px;
  background:#0e0e0e
}

.tile{
  position:relative;overflow:hidden;
  background:#080808;
  display:flex;align-items:center;justify-content:center
}
.tile video{width:100%;height:100%;object-fit:contain;display:block}

/* Loading spinner */
.loading{
  position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  pointer-events:none
}
.spinner{
  width:28px;height:28px;border:2px solid #1e1e1e;border-top-color:#444;
  border-radius:50%;animation:spin .8s linear infinite
}
@keyframes spin{to{transform:rotate(360deg)}}

/* Offline state */
.offline{
  position:absolute;inset:0;display:none;flex-direction:column;align-items:center;
  justify-content:center;gap:10px;color:#2a2a2a;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px
}
.offline span{color:#333;font-size:12px}

/* Camera label */
.label{
  position:absolute;bottom:0;left:0;right:0;
  padding:22px 10px 8px;
  background:linear-gradient(transparent,rgba(0,0,0,.7));
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  font-size:11px;font-weight:500;color:rgba(255,255,255,.75);
  opacity:0;transition:opacity .2s;pointer-events:none
}
.grid:hover .label{opacity:1}

/* State modifiers */
.tile.is-live .loading{display:none}
.tile.is-offline .loading{display:none}
.tile.is-offline .offline{display:flex}
.tile.is-offline video{opacity:0}
.tile.is-offline .label{display:none}

/* Empty state */
.empty{
  grid-column:1/-1;grid-row:1/-1;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:12px;color:#282828;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif
}
.empty span{color:#333;font-size:14px}
.empty small{color:#222;font-size:12px}

/* Logout button */
.logout{
  position:fixed;top:12px;right:12px;z-index:10;
  opacity:0;transition:opacity .2s;
  background:rgba(0,0,0,.8);border:1px solid #252525;border-radius:7px;
  padding:6px 11px;color:#555;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  font-size:11px;text-decoration:none;display:flex;align-items:center;gap:6px
}
body:hover .logout{opacity:1}
.logout:hover{color:#aaa;border-color:#3a3a3a}
</style>
</head>
<body>
<a href="/logout" class="logout">
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
  </svg>
  Logout
</a>
<div class="grid">${tiles}</div>
<script src="/hls.js"></script>
<script>
const cameras = ${camsJson};
const RETRY_MS = 6000;

cameras.forEach(({ id }) => {
  const tile  = document.getElementById('tile-' + id);
  const video = document.getElementById('v-' + id);
  const src   = '/streams/' + id + '/index.m3u8';

  function setLive()    { tile.className = 'tile is-live'; }
  function setLoading() { tile.className = 'tile'; }
  function setOffline() { tile.className = 'tile is-offline'; }

  function start() {
    setLoading();

    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      const hls = new Hls({
        lowLatencyMode: false,
        maxBufferLength: 8,
        maxMaxBufferLength: 16,
        fragLoadingTimeOut: 8000,
        manifestLoadingTimeOut: 8000,
      });
      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });

      video.addEventListener('playing', setLive, { once: true });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          hls.destroy();
          setOffline();
          setTimeout(start, RETRY_MS);
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS
      video.src = src;
      video.addEventListener('playing', setLive, { once: true });
      video.addEventListener('error', () => {
        setOffline();
        setTimeout(start, RETRY_MS);
      }, { once: true });
      video.play().catch(() => {});
    } else {
      setOffline();
    }
  }

  start();
});
</script>
</body>
</html>`;
}
