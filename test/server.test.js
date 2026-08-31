// 忆梦云团队开发
import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/server.js';
import { loadConfig, parseShopUrl } from '../src/config.js';

test('解析完整店铺链接', () => assert.deepEqual(parseShopUrl('https://shop.example.com/shop/demo'), { upstream:'https://shop.example.com', shopToken:'demo', shopUrl:'https://shop.example.com/shop/demo' }));
test('拒绝无店铺标识的链接', () => assert.throws(() => parseShopUrl('https://shop.example.com/shop/')));
test('health、静态页可用且不存在网页重置路由', async () => {
  const config = loadConfig({ SHOP_URL:'https://shop.example.com/shop/demo', PORT:'0' });
  const server = createApp(config).listen(0, '127.0.0.1'); await once(server, 'listening'); const base = 'http://127.0.0.1:' + server.address().port;
  try { const health = await fetch(base + '/api/health').then(v => v.json()); assert.equal(health.code, 1); assert.equal(health.data.environment.shop_url, config.shopUrl); const page = await fetch(base + '/').then(v => v.text()); assert.match(page, /鲸pro店铺反代程序/); const reset = await fetch(base + '/shop-pro/reset'); assert.equal(reset.status, 404); } finally { server.close(); }
});
