// 忆梦云团队开发
import crypto from 'node:crypto';
import { cachedRequest, cleanKey, inputError, request, safePaymentUrl, sessionToken, validateContact } from './upstream.js';
import { resolvePaymentInBrowser } from './payment-browser.js';

const truncate = (v, n) => Array.from(String(v || '').trim()).slice(0, n).join('');
const captchaUrl = (config, value, path) => { const url = new URL(value); const upstream = new URL(config.upstream); if (url.protocol !== upstream.protocol || url.host !== upstream.host || url.pathname.toLowerCase() !== path.toLowerCase()) throw inputError('验证码地址无效'); return url; };
const dataOf = result => result?.data ?? result ?? {};
const listOf = result => { const data = dataOf(result); return Array.isArray(data) ? data : Array.isArray(data?.list) ? data.list : []; };
const ok = data => ({ code: 1, msg: 'success', data });
const shopName = data => String(data.nickname || data.shop_name || data.name || data.shopTitle || data.shop_title || data.shopname || data.shopName || data.title || data.shop?.title || data.shop?.name || data.info?.nickname || data.info?.title || '').trim();
const publicShop = result => { const data = dataOf(result); return ok({ name: shopName(data), notice: String(data.description || data.notice || data.announcement || '').trim(), contact_qq: String(data.contact_qq || '').trim(), contact_mobile: String(data.contact_mobile || '').trim(), contact_wechat: /^https?:\/\//i.test(String(data.contact_wechat || '').trim()) ? String(data.contact_wechat).trim() : '' }); };
const publicCategories = result => ok(listOf(result).map(item => ({ id: Number(item.id), name: String(item.name || ''), goods_count: Number(item.goods_count ?? item.count ?? 0) })));
const publicGoods = result => ok(listOf(result).map(item => ({ goods_key: cleanKey(item.goods_key), name: String(item.name || ''), price: Number(item.price || 0), description: String(item.description || ''), image: String(item.image || item.cover || item.pic || item.thumbnail || '') })));
const publicChannels = result => ok(listOf(result).map(item => ({ id: Number(item.id ?? item.channel_id), name: String(item.show_name ?? item.name ?? item.paytype?.name ?? item.title ?? '') })).filter(item => item.id > 0));
const publicOrderSummary = item => { const status = item.pay_status ?? item.status ?? ''; const statusText = String(item.status_text || item.status_name || item.pay_status_text || item.pay_status_name || ''); return { trade_no: cleanKey(item.trade_no || item.order_no || item.order_id), goods_name: String(item.goods_name || item.name || item.title || ''), create_time: item.create_time || item.created_at || item.add_time || '', amount: Number(item.total_amount ?? item.amount ?? item.price ?? 0), status, status_text: statusText, paid: item.paid === true || [1, '1', 'paid', 'success', 'completed'].includes(status) || /已付款|已支付|支付成功|交易成功/.test(statusText), has_cards: Boolean(item.response || item.cards || item.card_list || item.card_info || item.card || item.kami || item.credentials) }; };
const cardStrings = data => {
  const response = data?.response;
  const source = response?.cards ?? response?.card_list ?? response?.card_info ?? response?.card ?? response?.kami ?? response?.credentials ?? data?.cards ?? data?.card_list ?? data?.card_info ?? data?.card ?? data?.kami ?? data?.credentials ?? (typeof response !== 'object' || Array.isArray(response) ? response : []);
  const values = Array.isArray(source) ? source : source ? [source] : [];
  return values.flatMap(item => {
    if (typeof item !== 'object' || item === null) {
      const value = String(item || '').trim();
      if (/^[\[{]/.test(value)) {
        try { return cardStrings({ cards: JSON.parse(value) }); } catch { return value ? [value] : []; }
      }
      return value ? [value] : [];
    }
    const value = item.card ?? item.card_no ?? item.card_number ?? item.cardNumber ?? item.code ?? item.content ?? item.kami ?? item.credentials ?? item.value;
    if (value !== undefined && value !== null) return cardStrings({ cards: value });
    const account = String(item.account ?? item.username ?? item.user ?? '').trim();
    const password = String(item.password ?? item.card_password ?? item.pass ?? item.pwd ?? '').trim();
    return account || password ? [`${account}${account && password ? ' ' : ''}${password}`] : [];
  });
};
const orderInstructions = data => String(data.instructions ?? data.instruction ?? data.use_instructions ?? data.usage_instructions ?? data.goods_instructions ?? data.goods_instruction ?? data.goods?.instructions ?? data.goods?.instruction ?? data.goods?.description ?? '').trim();
const publicOrderDetail = result => { const data = dataOf(result); return ok({ ...publicOrderSummary(data), cards: cardStrings(data), instructions: orderInstructions(data) }); };
const paymentSessions = new Map();
const captchaSessions = new Map();
const orderAuthorizations = new Map();
const opaqueId = () => crypto.randomBytes(24).toString('base64url');
const createPaymentId = (orderNo, upstreamSession, entryUrl) => { const id = opaqueId(); paymentSessions.set(id, { orderNo, upstreamSession, entryUrl, expires: Date.now() + 86400000 }); return id; };
const paymentSession = id => { const item = paymentSessions.get(String(id || '')); if (!item || item.expires < Date.now()) { paymentSessions.delete(String(id || '')); throw inputError('支付会话已失效'); } return item; };
const getOpaqueSession = (store, id, message) => { const item = store.get(String(id || '')); if (!item || item.expires < Date.now()) { store.delete(String(id || '')); throw inputError(message); } return item; };
export const actions = ['health','shop','categories','goods','channels','price','contact-check','order','payment-page','query','orders','order-info','captcha-start','captcha-image','captcha-check'];

export async function handleAction(config, action, input = {}, query = {}) {
  if (action === 'health') return ok({ ok: true });
  if (action === 'shop') return publicShop(await cachedRequest(config, '/shopApi/Shop/info', { token: config.shopToken }));
  if (action === 'categories') return publicCategories(await cachedRequest(config, '/shopApi/Shop/categoryList', { token: config.shopToken, goods_type: 'card' }));
  if (action === 'goods') return publicGoods(await cachedRequest(config, '/shopApi/Shop/goodsList', { token: config.shopToken, category_id: Number.isInteger(Number(input.category_id)) ? Number(input.category_id) : -1, keywords: truncate(input.keywords, 50), goods_type: 'card', current: 1, pageSize: 100 }));
  if (action === 'channels') { if (!cleanKey(input.goods_key)) throw inputError('请选择商品'); return publicChannels(await cachedRequest(config, '/shopApi/Shop/getUserChannel', { token: config.shopToken })); }
  if (action === 'price') { const key = cleanKey(input.goods_key), channel = Number(input.channel_id); if (!key || channel <= 0) throw inputError('商品或支付渠道无效'); const data = dataOf((await request(config, '/shopApi/Shop/getGoodsPrice', { goods_key: key, quantity: Math.max(1, Math.min(100, Number(input.quantity) || 1)), coupon_code: '', channel_id: channel })).result); return ok({ amount: Number(data.total_amount ?? data.amount ?? 0) }); }
  if (action === 'contact-check') { validateContact(input.contact); return ok({ valid: true }); }
  if (action === 'order') { const key = cleanKey(input.goods_key), channel = Number(input.channel_id), contact = validateContact(input.contact); if (!key || channel <= 0) throw inputError('请完整填写商品和支付渠道'); const { result, receivedSession } = await request(config, '/shopApi/Pay/order', { goods_key: key, channel_id: channel, quantity: Math.max(1, Math.min(100, Number(input.quantity) || 1)), contact, coupon_code: '', query_password: '', select_cards_ids: [], extend: {} }); const data = dataOf(result); if (result.code !== 1 || !data) return result; if (!receivedSession) throw new Error('上游未返回支付会话'); const orderNo = cleanKey(data.trade_no || data.order_no || data.order_id); const entryUrl = await safePaymentUrl(config, data.payurl || data.pay_url || data.url, config.upstream); return ok({ order_no: orderNo, payment_id: createPaymentId(orderNo, receivedSession, entryUrl), payment_pending: true }); }
  if (action === 'payment-page') { const session = paymentSession(input.payment_id); const payment = await resolvePaymentInBrowser(config, session.entryUrl, session.upstreamSession); return ok({ qr_code: payment.qrCode }); }
  if (action === 'query') { const session = paymentSession(input.payment_id), no = cleanKey(input.trade_no || input.order_no); if (!no || no !== session.orderNo) throw inputError('订单号无效'); const result = (await request(config, '/shopApi/Pay/query', { trade_no: no }, session.upstreamSession)).result; const data = dataOf(result); const status = data.pay_status ?? data.status ?? ''; return ok({ paid: result.code === 1 || data.paid === true || [1, '1', 'paid', 'success', 'completed'].includes(status), status }); }
  if (action === 'captcha-start') { const { result, receivedSession } = await request(config, '/shopApi/Common/captchaStart', {}); const data = dataOf(result); if (result.code === 1 && data) { if (!receivedSession) throw new Error('上游未返回验证码会话'); const id = opaqueId(); captchaSessions.set(id, { upstreamSession: receivedSession, imgUrl: data.img_url, checkUrl: data.check_url, ip: data.ip, expires: Date.now() + 600000 }); return ok({ captcha_id: id }); } return result; }
  if (action === 'captcha-check') { const code = truncate(input.code, 10), session = getOpaqueSession(captchaSessions, input.captcha_id, '验证码会话已失效'); if (!code) throw inputError('验证码参数无效'); const url = captchaUrl(config, session.checkUrl, '/shopApi/common/captchaCheck.html'); const first = crypto.createHash('md5').update(code + session.ip).digest('hex'); const sign = crypto.createHash('md5').update(first + 'JING').digest('hex'); const data = dataOf((await request(config, url.pathname + url.search, { code, sign }, session.upstreamSession)).result); const authorizationId = opaqueId(); orderAuthorizations.set(authorizationId, { upstreamSession: session.upstreamSession, ticket: String(data.ticket || ''), expires: Date.now() + 600000 }); captchaSessions.delete(String(input.captcha_id)); return ok({ authorization_id: authorizationId }); }
  if (action === 'order-info') { const no = cleanKey(input.trade_no || input.order_no); if (!no) throw inputError('订单号无效'); let upstreamSession = ''; if (input.payment_id) { const session = paymentSession(input.payment_id); if (session.orderNo !== no) throw inputError('订单号无效'); upstreamSession = session.upstreamSession; } else { upstreamSession = getOpaqueSession(orderAuthorizations, input.authorization_id, '订单查询授权已失效').upstreamSession; } return publicOrderDetail((await request(config, '/shopApi/Order/info', { trade_no: no, query_password: truncate(input.query_password, 100), dump: 1 }, upstreamSession)).result); }
  if (action === 'orders') { const keywords = truncate(input.keywords || input.trade_no || input.order_no || input.contact, 100), authorization = getOpaqueSession(orderAuthorizations, input.authorization_id, '订单查询授权已失效'); if (!keywords || !authorization.ticket) throw inputError('请输入查询内容并完成人机验证'); const result = (await request(config, '/shopApi/Order/list', { keywords, ticket: authorization.ticket, status: -1, current: 1, pageSize: 100 }, authorization.upstreamSession)).result; return ok(listOf(result).map(publicOrderSummary)); }
  throw Object.assign(new Error('接口不存在'), { status: 404 });
}

export async function captchaImage(config, query) { const session = getOpaqueSession(captchaSessions, query.captcha_id, '验证码会话已失效'), url = captchaUrl(config, session.imgUrl, '/shopApi/common/captchaImg.html'); const response = await fetch(url, { headers: { accept: 'image/*,*/*;q=0.8', referer: config.shopUrl, cookie: 'PHPSESSID=' + sessionToken(session.upstreamSession), 'user-agent': 'Mozilla/5.0 Chrome/140 Safari/537.36' } }); const type = response.headers.get('content-type') || ''; const data = Buffer.from(await response.arrayBuffer()); if (!response.ok || !type.startsWith('image/') || data.length < 32) throw new Error('验证码图片加载失败'); return { type, data }; }
