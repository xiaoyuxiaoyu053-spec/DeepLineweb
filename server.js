'use strict';
/**
 * DeepLine web server — zero dependencies.
 *  - serves ./public
 *  - POST /api/ai : stateless relay to the 4 supported AI providers (fixes browser CORS).
 *      * the upstream URL is chosen by the server from a fixed allow-list (never from the client)
 *      * the user's API key is forwarded for that one request only; nothing is stored or logged
 *  - GET /healthz  : Render health check
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 16 * 1024 * 1024; // vision requests carry base64 images
const RATE_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN) || 90;

const PROVIDERS = {
  'DeepSeek': 'https://api.deepseek.com/chat/completions',
  'Claude': 'https://api.anthropic.com/v1/messages',
  '豆包': 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
  'ChatGPT / OpenAI': 'https://api.openai.com/v1/chat/completions',
};
const FORWARD_HEADERS = ['authorization', 'x-api-key', 'anthropic-version'];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg', '.txt']);

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  // direct (browser→provider) mode is optional; the default path goes through /api/ai
  "connect-src 'self' https://api.deepseek.com https://api.anthropic.com https://ark.cn-beijing.volces.com https://api.openai.com",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=()');
}

// ---- tiny in-memory rate limiter (per client IP) ----
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > 60_000) hits.delete(k);
  return arr.length > RATE_PER_MIN;
}
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0, failed = false;
    const chunks = [];
    req.on('data', (c) => {
      if (failed) return;
      size += c.length;
      if (size > MAX_BODY) { failed = true; chunks.length = 0; reject(Object.assign(new Error('请求体过大'), { status: 413 })); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (!failed) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', (e) => { if (!failed) reject(e); });
  });
}

async function handleAi(req, res) {
  if (limited(clientIp(req))) return sendJson(res, 429, { error: { message: '请求太频繁，请稍后再试。' } });
  let payload;
  try { payload = JSON.parse(await readBody(req)); } catch (e) {
    if (e.status === 413) {
      // answer first, then drop the connection so an oversized upload cannot keep streaming
      res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8', Connection: 'close' });
      res.end(JSON.stringify({ error: { message: '请求体过大' } }));
      res.on('finish', () => req.destroy());
      return;
    }
    return sendJson(res, 400, { error: { message: '请求格式错误' } });
  }
  const url = PROVIDERS[payload && payload.provider];
  if (!url) return sendJson(res, 400, { error: { message: '不支持的 AI 服务商' } });
  if (!payload.body || typeof payload.body !== 'object') return sendJson(res, 400, { error: { message: '缺少请求内容' } });
  const headers = { 'Content-Type': 'application/json' };
  for (const [k, v] of Object.entries(payload.headers || {})) {
    if (FORWARD_HEADERS.includes(String(k).toLowerCase()) && typeof v === 'string') headers[k] = v;
  }
  try {
    const upstream = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload.body), signal: AbortSignal.timeout(120_000) });
    const text = await upstream.text();
    res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(text);
  } catch (e) {
    sendJson(res, 502, { error: { message: '服务器无法连接 AI 服务商：' + (e && e.name === 'TimeoutError' ? '超时' : (e && e.message) || '未知错误') } });
  }
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // SPA fallback for extension-less paths
      if (!path.extname(rel)) return serveStatic(req, res, '/index.html');
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const ext = path.extname(file).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    headers['Cache-Control'] = ext === '.html' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=604800';
    const wantsGzip = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (wantsGzip) {
      headers['Content-Encoding'] = 'gzip';
      headers['Vary'] = 'Accept-Encoding';
      res.writeHead(200, headers);
      fs.createReadStream(file).pipe(zlib.createGzip()).pipe(res);
    } else {
      headers['Content-Length'] = st.size;
      res.writeHead(200, headers);
      fs.createReadStream(file).pipe(res);
    }
  });
}

const server = http.createServer((req, res) => {
  securityHeaders(res);
  const { pathname } = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && pathname === '/healthz') return sendJson(res, 200, { ok: true });
  if (req.method === 'POST' && pathname === '/api/ai') return handleAi(req, res);
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
  res.writeHead(405); res.end('Method Not Allowed');
});

server.listen(PORT, '0.0.0.0', () => console.log(`DeepLine web listening on :${PORT}`));
