// 忆梦云团队开发
'use strict';

const $ = (selector) => document.querySelector(selector);
const state = { categories: [], goods: [], selected: null, channelId: 0, timer: null, currentOrder: '', captcha: null, captchaResolve: null, account: '', orderAuthorization: null, orders: [], ordersLoading: null, paymentSessions: new Map(), goodsRequest: 0, channelsRequest: 0, priceRequest: 0, paymentRequest: 0, payment: null };
const ORDER_STORAGE_KEY = 'ym_shop_orders';
const ORDER_SESSION_STORAGE_KEY = 'ym_shop_order_sessions';
const PENDING_PAYMENT_STORAGE_KEY = 'ym_shop_pending_payment';
const ACCOUNT_STORAGE_KEY = 'ym_shop_account';
const ACCOUNT_HISTORY_KEY = 'ym_shop_account_history';
const API_ENTRY = '/api/index.php';

async function api(path, body) {
  const url = `${API_ENTRY}?action=${encodeURIComponent(path)}`;
  const response = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const raw = await response.text();
  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    const detail = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    throw new Error(detail || `接口未返回 JSON（HTTP ${response.status}）`);
  }
  if (!response.ok || result.code !== 1) throw new Error(result.msg || '请求失败');
  return result.data;
}
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = String(value || ''); return div.innerHTML; }
function unwrapList(data) { return Array.isArray(data) ? data : Array.isArray(data?.list) ? data.list : []; }
function imageUrl(item) { const value = String(item?.image || item?.cover || item?.pic || item?.thumbnail || '').trim(); return /^(https?:\/\/|\/)/i.test(value) ? value : ''; }
function shopContacts(data = {}) {
  return { qq: String(data.contact_qq || '').trim(), mobile: String(data.contact_mobile || '').trim(), url: String(data.contact_wechat || '').trim() };
}
function renderShopContacts(data = {}) {
  const contact = shopContacts(data);
  $('#shopContactQq').textContent = contact.qq;
  $('#shopContactMobile').textContent = contact.mobile;
  const link = $('#shopContactLink');
  if (/^https?:\/\//i.test(contact.url)) { link.textContent = '点击联系客服'; link.href = contact.url; } else { link.textContent = ''; link.removeAttribute('href'); }
}
function applyShopInfo(data = {}) {
  // 尝试从多个可能的字段名中提取店铺名称
  let name = String(
    data.nickname || data.shop_name || data.name || data.shopTitle || data.shop_title ||
    data.shopname || data.shopName || data.title || data.shop ||
    data.config?.title || data.config?.shop_name || data.config?.nickname ||
    data.shop?.title || data.shop?.name || data.shop?.nickname ||
    data.info?.nickname || data.info?.title ||
    ''
  ).trim();
  // 如果还是没有，遍历所有 value，取第一个看起来像店铺名的非空短字符串
  if (!name) {
    const candidates = Object.values(data).filter(v => typeof v === 'string' && v.trim() && v.trim().length <= 30 && !/^https?:/i.test(v) && !/^[\d-]+$/.test(v) && !/^[a-f0-9]{32}$/i.test(v));
    candidates.sort((a, b) => b.length - a.length);
    name = candidates[0] || '';
  }
  const notice = String(data.description || data.notice || data.announcement || '').trim();
  if (name) { document.title = name; const meta = document.querySelector('meta[name="application-name"]'); if (meta) meta.setAttribute('content', name); }
  renderShopContacts(data);
  if (notice) { $('#announcementText').textContent = notice; $('#announcementModal').classList.remove('hidden'); }
}
async function loadShopInfo() { try { applyShopInfo(await api('shop')); } catch { renderShopContacts(); } }
function localOrders() { try { return JSON.parse(localStorage.getItem(ORDER_STORAGE_KEY) || '[]').filter((item) => typeof item === 'string'); } catch { return []; } }
function saveOrder(orderNo) { if (orderNo) localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify([orderNo, ...localOrders().filter((item) => item !== orderNo)].slice(0, 50))); }
function restoreOrderSessions() { try { const saved = JSON.parse(sessionStorage.getItem(ORDER_SESSION_STORAGE_KEY) || '{}'); state.paymentSessions = new Map(Object.entries(saved).filter(([orderNo, id]) => orderNo && typeof id === 'string' && id)); } catch { state.paymentSessions = new Map(); } }
function saveOrderSession(orderNo, id) { if (!orderNo || !id) return; state.paymentSessions.set(String(orderNo), id); sessionStorage.setItem(ORDER_SESSION_STORAGE_KEY, JSON.stringify(Object.fromEntries(state.paymentSessions))); }
function clearOrderSessions() { state.paymentSessions.clear(); sessionStorage.removeItem(ORDER_SESSION_STORAGE_KEY); sessionStorage.removeItem(PENDING_PAYMENT_STORAGE_KEY); }
function savePendingPayment(payment) { if (payment?.orderNo) sessionStorage.setItem(PENDING_PAYMENT_STORAGE_KEY, JSON.stringify({ ...payment, account: state.account, savedAt: Date.now() })); }
function pendingPayment() { try { const payment = JSON.parse(sessionStorage.getItem(PENDING_PAYMENT_STORAGE_KEY) || 'null'); return payment && payment.account === state.account && Date.now() - Number(payment.savedAt || 0) < 86400000 ? payment : null; } catch { return null; } }
function accountHistory() { try { return JSON.parse(localStorage.getItem(ACCOUNT_HISTORY_KEY) || '[]').filter((phone) => /^1[3-9]\d{9}$/.test(phone)); } catch { return []; } }
function saveAccount(phone) { localStorage.setItem(ACCOUNT_STORAGE_KEY, phone); localStorage.setItem(ACCOUNT_HISTORY_KEY, JSON.stringify([phone, ...accountHistory().filter((item) => item !== phone)].slice(0, 10))); }
function renderAccountHistory() { const accounts = accountHistory(); $('#accountHistory').classList.toggle('hidden', accounts.length === 0); $('#accountHistoryList').innerHTML = accounts.map((phone) => `<button class="history-account" type="button" data-phone="${phone}">${phone}</button>`).join(''); }
function showAccountModal() { $('#accountPhone').value = ''; $('#accountMessage').textContent = ''; renderAccountHistory(); $('#accountModal').classList.remove('hidden'); }
function applyAccount(phone) { state.account = phone; state.orderAuthorization = null; $('#contact').value = phone; $('#accountWelcome').textContent = `欢迎你：${phone}`; $('#accountModal').classList.add('hidden'); }
function initializeAccount() { const phone = localStorage.getItem(ACCOUNT_STORAGE_KEY) || ''; if (/^1[3-9]\d{9}$/.test(phone) && !/^(\d)\1{10}$/.test(phone)) applyAccount(phone); else showAccountModal(); }
async function createAccount() { const phone = $('#accountPhone').value.trim(); const button = $('#accountSubmit'); $('#accountMessage').textContent = ''; button.disabled = true; button.textContent = '正在验证…'; try { await api('contact-check', { contact: phone }); saveAccount(phone); applyAccount(phone); } catch (error) { $('#accountMessage').textContent = error.message; } finally { button.disabled = false; button.textContent = '创建账号'; } }
function logoutAccount() { localStorage.removeItem(ACCOUNT_STORAGE_KEY); clearOrderSessions(); state.account = ''; state.orderAuthorization = null; state.orders = []; $('#contact').value = ''; showAccountModal(); }
function orderData(entry) { const result = entry?.result || {}; return result.data ?? result; }
function orderNo(data, fallback = '') { return data?.trade_no || data?.order_no || data?.order_id || fallback; }
function orderStatus(data) {
  const text = data?.status_text || data?.status_name || data?.pay_status_text || data?.pay_status_name;
  if (text) return text;
  const status = data?.pay_status ?? data?.status;
  if (status === undefined || status === null || status === '') return '待查询';
  return ({ 0: '未付款', 1: '已付款', 2: '已关闭', 3: '已退款' })[status] || '未知状态';
}
function isPaid(data) { return data?.paid === true || [1, '1', 'paid', 'success', 'completed'].includes(data?.pay_status ?? data?.status); }
function orderTime(value) {
  if (value === undefined || value === null || value === '') return '';
  const text = String(value).trim();
  if (/^\d{10,13}$/.test(text)) {
    const timestamp = Number(text) * (text.length === 10 ? 1000 : 1);
    return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
  }
  return text;
}
function cardValues(data) { const source = data?.cards ?? []; return Array.isArray(source) ? source.map(String).filter(Boolean) : []; }
async function copyText(text) {
  const value = String(text ?? '');
  if (!value) throw new Error('没有可复制的内容');
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', '');
  input.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(input);
  input.select();
  input.setSelectionRange(0, value.length);
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('复制失败，请长按卡密手动复制');
}
function copyFeedback(button, success) {
  const original = button.dataset.label || button.textContent;
  button.dataset.label = original;
  button.textContent = success ? '已复制' : '复制失败';
  button.classList.toggle('copied', success);
  clearTimeout(button._copyTimer);
  button._copyTimer = setTimeout(() => { button.textContent = original; button.classList.remove('copied'); }, 1600);
}

async function loadCategories() {
  state.categories = unwrapList(await api('categories'));
  $('#categories').innerHTML = state.categories.map((item, index) => `<button class="category ${index === 0 ? 'active' : ''}" data-id="${Number(item.id)}">${escapeHtml(item.name)} <small>(${Number(item.goods_count ?? item.count ?? 0)})</small></button>`).join('');
  await loadGoods(state.categories[0]?.id ?? -1);
}
async function loadGoods(categoryId, keywords = '') {
  const requestId = ++state.goodsRequest;
  $('#goods').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  try {
    const goods = unwrapList(await api('goods', { category_id: categoryId, keywords }));
    if (requestId !== state.goodsRequest) return;
    state.goods = goods;
    $('#goods').innerHTML = state.goods.length ? state.goods.map((item) => `<article class="goods-card no-image" tabindex="0" data-key="${escapeHtml(item.goods_key)}"><div><h3>${escapeHtml(item.name)}</h3><span class="price">￥${Number(item.price || 0).toFixed(2)}</span></div></article>`).join('') : '<p class="muted">该分类暂无商品</p>';
  } catch (error) {
    if (requestId !== state.goodsRequest) return;
    $('#goods').innerHTML = `<div class="load-error"><p class="message">${escapeHtml(error.message)}</p><button class="retry-button" type="button" data-retry="goods">重新加载</button></div>`;
  }
}
async function selectGoods(card) {
  const selected = state.goods.find((item) => String(item.goods_key) === card.dataset.key);
  if (!selected) return;
  const requestId = ++state.channelsRequest;
  state.selected = selected; state.channelId = 0; state.priceRequest++;
  document.querySelectorAll('.goods-card').forEach((item) => item.classList.toggle('active', item === card));
  const image = imageUrl(selected); $('#chosenImage').classList.toggle('hidden', !image); $('#chosenImage').src = image; $('#chosenImage').onerror = () => $('#chosenImage').classList.add('hidden');
  $('#chosenName').textContent = selected.name;
  $('#chosenDescription').textContent = String(selected.description || '').replace(/<[^>]+>/g, '').trim() || '暂无商品详情';
  $('#chosenPrice').textContent = `￥${Number(selected.price || 0).toFixed(2)}`; $('#total').textContent = '—'; $('#checkout').classList.remove('hidden'); $('#channels').innerHTML = '<span class="muted">正在获取支付方式…</span>'; $('#checkout').scrollIntoView({ behavior: 'smooth', block: 'start' });
  try { const channels = unwrapList(await api('channels', { goods_key: selected.goods_key })); if (requestId !== state.channelsRequest) return; $('#channels').innerHTML = channels.map((channel) => `<button class="channel" data-id="${Number(channel.id ?? channel.channel_id)}">${escapeHtml(channel.show_name ?? channel.name ?? channel.paytype?.name ?? channel.title)}</button>`).join('') || '<span class="muted">暂无可用支付方式</span>'; } catch (error) { if (requestId === state.channelsRequest) $('#channels').innerHTML = `<div class="load-error"><p class="message">${escapeHtml(error.message)}</p><button class="retry-button" type="button" data-retry="channels">重新加载</button></div>`; }
}
async function updatePrice() { if (!state.selected || !state.channelId) return; const requestId = ++state.priceRequest; const goodsKey = state.selected.goods_key; const channelId = state.channelId; const quantity = Number($('#quantity').value) || 1; try { const data = await api('price', { goods_key: goodsKey, channel_id: channelId, quantity }); if (requestId !== state.priceRequest) return; $('#total').textContent = `￥${Number(data.total_amount ?? data.amount ?? state.selected.price).toFixed(2)}`; } catch (error) { if (requestId === state.priceRequest) $('#message').textContent = error.message; } }
function paymentFields(source = {}) {
  return { orderNo: source.order_no || '', paymentId: source.payment_id || '' };
}
function showPaymentPage(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('未能获取最终支付页面');
  const frame = $('#paymentFrame');
  frame.src = url;
  frame.classList.remove('hidden');
  $('#paymentBrowserUrl').classList.add('hidden');
  $('#payStatus').textContent = '请在上方支付页面完成付款';
}
async function openPayment(data) { const payment = paymentFields(data); if (!payment.orderNo || !payment.paymentId) throw new Error('支付会话创建失败'); state.payment = payment; $('#orderText').textContent = `订单号：${payment.orderNo}`; state.currentOrder = payment.orderNo; saveOrderSession(payment.orderNo, payment.paymentId); savePendingPayment(payment); saveOrder(payment.orderNo); $('#paymentModal').classList.remove('hidden'); $('#paymentFrame').classList.add('hidden'); $('#paymentBrowserUrl').classList.remove('hidden'); $('#paymentBrowserUrl').textContent = '服务器正在打开最终支付页面…'; pollOrder(payment.orderNo); const result = await api('payment-page', { payment_id: payment.paymentId }); showPaymentPage(result.url); }
async function createOrder() {
  $('#message').textContent = '';
  if (!state.selected || !state.channelId || !state.account) {
    $('#message').textContent = '请选择商品和支付方式，并完成本地账号创建';
    return;
  }

  const button = $('#payButton');
  button.disabled = true;
  button.textContent = '正在创建订单…';
  $('#orderLoadingText').textContent = '正在连接支付平台，请稍候…';
  $('#orderLoadingModal').classList.remove('hidden');

  try {
    const data = await api('order', {
      goods_key: state.selected.goods_key,
      channel_id: state.channelId,
      quantity: Number($('#quantity').value) || 1,
      contact: $('#contact').value.trim()
    });
    $('#orderLoadingText').textContent = '订单创建成功，正在获取支付信息…';
    $('#orderLoadingModal').classList.add('hidden');
    await openPayment(data);
  } catch (error) {
    $('#orderLoadingModal').classList.add('hidden');
    $('#message').textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = '去支付';
  }
}
function pollOrder(orderNo) { clearInterval(state.timer); state.timer = setInterval(async () => { try { const data = await api('query', { trade_no: orderNo, payment_id: state.paymentSessions.get(String(orderNo)) || '' }); if (isPaid(data)) { clearInterval(state.timer); sessionStorage.removeItem(PENDING_PAYMENT_STORAGE_KEY); $('#payStatus').textContent = '支付成功，正在打开订单详情'; setTimeout(() => showOrderDetail(orderNo), 600); } } catch { if (!$('#paymentModal').classList.contains('hidden')) $('#paymentBrowserUrl').textContent = '支付状态查询暂时失败，正在自动重试…'; } }, 3000); }
function showView(orders, shouldLoad = true) { $('#shopView').classList.toggle('hidden', orders); $('#ordersView').classList.toggle('hidden', !orders); $('#showShop').classList.toggle('active', !orders); $('#showOrders').classList.toggle('active', orders); if (orders && shouldLoad) loadOrders(); }
function renderOrder(entry) { if (entry.error) return `<article class="order-card"><div><small>${escapeHtml(entry.trade_no)}</small><h3>查询失败</h3><p class="message">${escapeHtml(entry.error)}</p></div></article>`; const data = orderData(entry); const no = orderNo(data, entry.trade_no); const amount = data.total_amount ?? data.amount ?? data.price; const cards = cardValues(data); return `<article class="order-card"><div><small>订单号：${escapeHtml(no)}</small><h3>${escapeHtml(data.goods_name || data.name || data.title || '自助商城订单')}</h3><p>${escapeHtml(orderTime(data.create_time || data.created_at || data.add_time || ''))}</p></div><div class="order-side"><span class="status-badge ${isPaid(data) ? 'paid' : ''}">${escapeHtml(orderStatus(data))}</span>${amount !== undefined ? `<strong>￥${Number(amount).toFixed(2)}</strong>` : ''}<button class="detail-button" data-order="${escapeHtml(no)}" type="button">${cards.length ? '查看卡密' : '查看详情'}</button></div></article>`; }
async function refreshCaptcha() {
  const image = $('#captchaImage');
  image.removeAttribute('src');
  image.classList.add('hidden');
  $('#captchaMessage').textContent = '正在加载验证码…';
  const data = await api('captcha-start', {});
  const src = `${API_ENTRY}?action=captcha-image&captcha_id=${encodeURIComponent(data.captcha_id)}&t=${Date.now()}`;
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('验证码图片加载失败，请点击重试'));
    image.src = src;
  });
  state.captcha = data;
  image.classList.remove('hidden');
  $('#captchaMessage').textContent = '';
}
function requestCaptcha() { $('#captchaMessage').textContent = ''; $('#captchaCode').value = ''; $('#captchaImage').classList.add('hidden'); $('#captchaModal').classList.remove('hidden'); refreshCaptcha().catch((error) => { state.captcha = null; $('#captchaMessage').textContent = error.message; }); return new Promise((resolve) => { state.captchaResolve = resolve; }); }
async function submitCaptcha() { const code = $('#captchaCode').value.trim(); if (!code || !state.captcha) { $('#captchaMessage').textContent = '请输入验证码'; return; } const button = $('#captchaSubmit'); button.disabled = true; try { const data = await api('captcha-check', { code, captcha_id: state.captcha.captcha_id }); $('#captchaModal').classList.add('hidden'); state.captchaResolve?.({ authorization_id: data.authorization_id }); state.captchaResolve = null; } catch (error) { $('#captchaMessage').textContent = error.message; $('#captchaCode').value = ''; await refreshCaptcha(); } finally { button.disabled = false; } }
async function loadOrders() { if (state.ordersLoading) return state.ordersLoading; state.ordersLoading = (async () => { $('#ordersMessage').textContent = ''; $('#ordersList').innerHTML = '<div class="skeleton"></div>'; try { if (!state.orderAuthorization) { const captcha = await requestCaptcha(); if (!captcha) { $('#ordersList').innerHTML = ''; return; } state.orderAuthorization = { keywords: state.account, authorization_id: captcha.authorization_id }; } state.orders = unwrapList(await api('orders', state.orderAuthorization)); $('#ordersList').innerHTML = state.orders.length ? state.orders.map((item) => renderOrder({ trade_no: orderNo(item), result: { data: item } })).join('') : '<div class="empty-orders"><h2>暂无订单</h2><p>当前账号还没有历史订单。</p></div>'; } catch (error) { $('#ordersList').innerHTML = ''; $('#ordersMessage').textContent = error.message; } finally { state.ordersLoading = null; } })(); return state.ordersLoading; }
function authorizeOrder(tradeNo) { if (!state.orderAuthorization || !state.orders.some((item) => String(orderNo(item)) === String(tradeNo))) throw new Error('当前账号未授权该订单'); return state.orderAuthorization; }
async function showOrderDetail(tradeNo, queryPassword = '') { $('#paymentModal').classList.add('hidden'); showView(true, false); $('#orderDetail').innerHTML = '<p class="muted">正在查询订单…</p>'; $('#orderModal').classList.remove('hidden'); try { const paymentId = state.paymentSessions.get(String(tradeNo)); const authorization = paymentId ? null : authorizeOrder(tradeNo); const data = await api('order-info', { trade_no: tradeNo, query_password: queryPassword, payment_id: paymentId || '', authorization_id: authorization?.authorization_id || '' }); const cards = cardValues(data); const amount = data.total_amount ?? data.amount ?? data.price; $('#orderDetail').innerHTML = `<dl class="order-fields"><div><dt>订单号</dt><dd>${escapeHtml(orderNo(data, tradeNo))}</dd></div><div><dt>商品</dt><dd>${escapeHtml(data.goods_name || data.name || data.title || '—')}</dd></div><div><dt>状态</dt><dd>${escapeHtml(orderStatus(data))}</dd></div>${amount !== undefined ? `<div><dt>金额</dt><dd>￥${Number(amount).toFixed(2)}</dd></div>` : ''}</dl><section class="cards-detail"><div class="cards-heading"><h3>卡密详情</h3>${cards.length > 1 ? `<button class="copy-card copy-all" type="button">复制全部</button>` : ''}</div>${cards.length ? cards.map((card, index) => `<article class="card-code"><div class="card-code-head"><span class="card-index">卡密 ${String(index + 1).padStart(2, '0')}</span><button class="copy-card" data-card="${escapeHtml(card)}" type="button">复制此卡密</button></div><code title="点击或长按可选择卡密">${escapeHtml(card)}</code></article>`).join('') : '<p class="muted">卡密尚未发放，请稍后刷新订单。</p>'}</section>`; } catch (error) { $('#orderDetail').innerHTML = `<p class="message">${escapeHtml(error.message)}</p>`; } }

$('#goods').addEventListener('click', (event) => { const retry = event.target.closest('[data-retry="goods"]'); if (retry) { loadGoods(Number($('.category.active')?.dataset.id ?? -1), $('#search').value.trim()); return; } const card = event.target.closest('.goods-card'); if (card) selectGoods(card); });
$('#goods').addEventListener('keydown', (event) => { if (event.key === 'Enter') { const card = event.target.closest('.goods-card'); if (card) selectGoods(card); } });
$('#categories').addEventListener('click', (event) => { if (event.target.closest('[data-retry="categories"]')) { initializeApp(); return; } const button = event.target.closest('.category'); if (!button) return; document.querySelectorAll('.category').forEach((item) => item.classList.toggle('active', item === button)); loadGoods(Number(button.dataset.id)); });
$('#channels').addEventListener('click', (event) => { if (event.target.closest('[data-retry="channels"]')) { const card = Array.from(document.querySelectorAll('.goods-card')).find((item) => item.dataset.key === String(state.selected?.goods_key)); if (card) selectGoods(card); return; } const button = event.target.closest('.channel'); if (!button) return; state.channelId = Number(button.dataset.id); document.querySelectorAll('.channel').forEach((item) => item.classList.toggle('active', item === button)); updatePrice(); });
$('#quantity').addEventListener('change', updatePrice); $('#payButton').addEventListener('click', createOrder); $('#closeModal').addEventListener('click', () => { $('#paymentModal').classList.add('hidden'); $('#paymentFrame').removeAttribute('src'); clearInterval(state.timer); });
$('#showShop').addEventListener('click', () => showView(false)); $('#showOrders').addEventListener('click', () => showView(true)); $('#refreshOrders').addEventListener('click', loadOrders); $('#ordersView').addEventListener('click', (event) => { const button = event.target.closest('.detail-button'); if (!button) return; const password = button.dataset.password === '1' ? prompt('请输入下单时设置的安全密码') : ''; if (password !== null) showOrderDetail(button.dataset.order, password); }); $('#closeOrderModal').addEventListener('click', () => $('#orderModal').classList.add('hidden')); $('#orderModal').addEventListener('click', (event) => { if (event.target === $('#orderModal')) $('#closeOrderModal').click(); }); $('#orderDetail').addEventListener('click', async (event) => { const button = event.target.closest('.copy-card'); if (!button) return; const text = button.classList.contains('copy-all') ? Array.from($('#orderDetail').querySelectorAll('.copy-card[data-card]')).map((item) => item.dataset.card).join('\n') : button.dataset.card; try { await copyText(text); copyFeedback(button, true); } catch (error) { copyFeedback(button, false); } });
$('#captchaImage').addEventListener('click', () => refreshCaptcha().catch((error) => { $('#captchaMessage').textContent = error.message; })); $('#captchaSubmit').addEventListener('click', submitCaptcha); $('#captchaCode').addEventListener('keydown', (event) => { if (event.key === 'Enter') submitCaptcha(); }); $('#closeCaptchaModal').addEventListener('click', () => { $('#captchaModal').classList.add('hidden'); state.captchaResolve?.(''); state.captchaResolve = null; });
$('#accountSubmit').addEventListener('click', createAccount); $('#accountPhone').addEventListener('keydown', (event) => { if (event.key === 'Enter') createAccount(); });
$('#logoutAccount').addEventListener('click', logoutAccount); $('#accountHistoryList').addEventListener('click', (event) => { const button = event.target.closest('.history-account'); if (!button) return; saveAccount(button.dataset.phone); applyAccount(button.dataset.phone); });
$('#closeAnnouncement').addEventListener('click', () => $('#announcementModal').classList.add('hidden')); $('#confirmAnnouncement').addEventListener('click', () => $('#closeAnnouncement').click());
$('#showCustomerService').addEventListener('click', async () => { $('#customerServiceModal').classList.remove('hidden'); try { renderShopContacts(await api('shop')); } catch { renderShopContacts(); } }); $('#closeCustomerService').addEventListener('click', () => $('#customerServiceModal').classList.add('hidden')); $('#customerServiceModal').addEventListener('click', (event) => { if (event.target === $('#customerServiceModal')) $('#closeCustomerService').click(); });
let searchTimer; $('#search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadGoods(Number($('.category.active')?.dataset.id ?? -1), $('#search').value.trim()), 350); });
async function initializeApp() {
  restoreOrderSessions();
  initializeAccount();
  loadShopInfo();
  const pending = pendingPayment();
  if (pending) openPayment(pending).catch(() => {});
  try {
    await loadCategories();
  } catch (error) {
    $('#categories').innerHTML = `<p class="message">${escapeHtml(error.message)}</p>`;
    $('#goods').innerHTML = '';
  }
}

initializeApp();
