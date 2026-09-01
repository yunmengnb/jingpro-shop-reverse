// 忆梦云团队开发
import { hostAllowed } from './upstream.js';
import { resolvePaymentInBrowser } from './payment-browser.js';

const CALLBACK_PATH = /(?:^|[\/_-])(?:notify|notification|callback|webhook|return|query|status|success)(?:[\/_-]|$)/i;

export function isCallbackUrl(value) {
  try {
    return CALLBACK_PATH.test(new URL(value).pathname);
  } catch {
    return true;
  }
}

export async function resolvePayment(config, data) {
  const entryUrl = String(data.payurl || data.pay_url || data.url || '').trim();
  let parsed;
  try {
    parsed = new URL(entryUrl);
  } catch {
    throw new Error('支付接口未返回有效的支付页面地址');
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !await hostAllowed(config, parsed.hostname)) {
    throw new Error('支付页面地址不可用');
  }
  return resolvePaymentInBrowser(config, data);
}
