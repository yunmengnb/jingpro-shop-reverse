import { lookup } from 'node:dns/promises';
import net from 'node:net';

const cache = new Map();
export const cleanKey = value => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '');
export function sessionToken(value) { const token = String(value || '').trim(); if (!/^[a-zA-Z0-9,-]{1,128}$/.test(token)) throw inputError('验证码会话无效'); return token; }
export function inputError(message) { return Object.assign(new Error(message), { status: 422 }); }
export function validateContact(value) { const v = String(value || '').trim(); if (!/^1[3-9]\d{9}$/.test(v)) throw inputError('请输入有效的11位手机号'); if (/^(\d)\1{10}$/.test(v) || '01234567890123456789'.includes(v) || '98765432109876543210'.includes(v)) throw inputError('联系方式太简单，请使用真实手机号'); return v; }
export async function request(config, endpoint, payload, captchaSession = '') {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), config.timeout);
  try {
    const headers = { 'content-type': 'application/json', accept: 'application/json', origin: config.upstream, referer: config.shopUrl, 'user-agent': 'Yimengyun-Node-Shop-Proxy/1.0' };
    if (captchaSession) headers.cookie = 'PHPSESSID=' + sessionToken(captchaSession);
    const response = await fetch(config.upstream + endpoint, { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal });
    const text = await response.text(); let result; try { result = JSON.parse(text); } catch { throw new Error('上游返回格式异常'); }
    if (!response.ok) throw new Error(result.msg || ('上游请求失败（' + response.status + '）'));
    const cookie = response.headers.getSetCookie?.().find(v => /^PHPSESSID=/i.test(v)) || response.headers.get('set-cookie') || '';
    const match = cookie.match(/(?:^|[,;]\s*)PHPSESSID=([a-zA-Z0-9,-]{1,128})/i);
    return { result, receivedSession: match?.[1] || '' };
  } catch (error) { if (error.name === 'AbortError') throw new Error('上游服务连接超时'); throw error; } finally { clearTimeout(timer); }
}
export async function cachedRequest(config, endpoint, payload) { const key = endpoint + '\n' + JSON.stringify(payload); const item = cache.get(key); if (item && item.expires > Date.now()) return item.value; const { result } = await request(config, endpoint, payload); if (config.cacheTtl) cache.set(key, { value: result, expires: Date.now() + config.cacheTtl }); return result; }
export function hostAllowed(_config, host) { return Boolean(String(host || '').trim()); }
const privateAddress = address => {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const value = String(address).toLowerCase();
  return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb') || value.startsWith('::ffff:127.') || value.startsWith('::ffff:10.') || value.startsWith('::ffff:192.168.');
};
export async function safePaymentUrl(_config, value, base) {
  const url = new URL(String(value || '').replace(/^\/\//, 'https://'), base);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('支付渠道返回了无效的跳转地址');
  const records = await lookup(url.hostname, { all: true, verbatim: true });
  if (!records.length || records.some(record => privateAddress(record.address))) throw new Error('支付渠道返回了不安全的跳转地址');
  return url.href;
}
