// 忆梦云团队开发
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { actions, captchaImage, handleAction } from './api.js';
import { loadConfig } from './config.js';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const mime = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml' };
const json = (res, data, status = 200) => { res.writeHead(status, { 'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff' }); res.end(JSON.stringify(data)); };
async function body(req, limit) { let size = 0, text = ''; for await (const chunk of req) { size += chunk.length; if (size > limit) throw Object.assign(new Error('请求内容过大'), { status: 413 }); text += chunk; } if (!text) return {}; try { const value = JSON.parse(text); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { throw Object.assign(new Error('JSON 请求格式无效'), { status: 400 }); } }
function staticFile(res, pathname) { const relative = pathname === '/' ? 'index.html' : pathname.slice(1); const target = normalize(join(root, relative)); if (!target.startsWith(normalize(root))) return false; try { if (!statSync(target).isFile()) return false; res.writeHead(200, { 'content-type': mime[extname(target)] || 'application/octet-stream','x-content-type-options':'nosniff' }); createReadStream(target).pipe(res); return true; } catch { return false; } }
export function createApp(config = loadConfig()) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost'); let action = '';
    if (url.pathname === '/api/index.php') action = String(url.searchParams.get('action') || '').replace(/[^a-zA-Z0-9_-]/g, '');
    else { const match = url.pathname.match(/^\/api\/([a-zA-Z0-9_-]+)$/); if (match) action = match[1]; }
    try {
      if (action) { if (!actions.includes(action)) throw Object.assign(new Error('接口不存在'), { status: 404 }); const query = Object.fromEntries(url.searchParams); if (action === 'captcha-image') { const image = await captchaImage(config, query); res.writeHead(200, { 'content-type': image.type, 'cache-control':'no-store' }); res.end(image.data); return; } json(res, await handleAction(config, action, req.method === 'POST' ? await body(req, config.bodyLimit) : {}, query)); return; }
      if (req.method === 'GET' && staticFile(res, url.pathname)) return;
      json(res, { code:0, msg:'页面不存在' }, 404);
    } catch (error) { const status = error.status || 502; if (status >= 500) console.error('[request-error]', { action: action || 'static', method: req.method, message: error.message, stack: error.stack }); json(res, { code:0, msg:status < 500 ? (error.message || '请求参数无效') : '服务暂时不可用，请稍后重试' }, status); }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { const config = loadConfig(); createApp(config).listen(config.port, '0.0.0.0', () => process.stdout.write('Node shop listening on 0.0.0.0:' + config.port + '\n')); }
