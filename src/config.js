// 忆梦云团队开发
import { URL } from 'node:url';

const bool = (value, fallback = false) => value === undefined ? fallback : /^(1|true|yes|on)$/i.test(value);
const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function parseShopUrl(value) {
  const url = new URL(String(value || '').trim());
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('店铺链接必须使用 HTTP 或 HTTPS');
  const match = url.pathname.match(/^\/shop\/([a-zA-Z0-9_-]+)\/?$/);
  if (!match) throw new Error('店铺链接格式应为 https://域名/shop/店铺标识');
  return { upstream: url.origin, shopToken: match[1], shopUrl: url.origin + '/shop/' + match[1] };
}

export function loadConfig(env = process.env) {
  if (!env.SHOP_URL) throw new Error('缺少 SHOP_URL 配置，请先运行安装程序配置店铺链接');
  const parsed = parseShopUrl(env.SHOP_URL);
  return {
    programName: '鲸pro店铺反代程序', version: '1.2.0',
    ...parsed,
    port: number(env.PORT, 3000), connectTimeout: number(env.CONNECT_TIMEOUT, 10000), timeout: number(env.REQUEST_TIMEOUT, 25000),
    verifySsl: bool(env.VERIFY_SSL, true),
    cacheTtl: Math.max(0, number(env.CACHE_TTL, 60) * 1000), bodyLimit: 1024 * 1024,
  };
}
