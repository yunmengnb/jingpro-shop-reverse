// 忆梦云团队开发
import { chromium } from 'playwright-core';

const CALLBACK_PATH = /(?:^|[\/_-])(?:notify|notification|callback|webhook|return|query|status|success)(?:[\/_-]|$)/i;
const isCallbackUrl = value => { try { return CALLBACK_PATH.test(new URL(value).pathname); } catch { return true; } };

function cleanResult(data, finalUrl) {
  const result = { ...data };
  for (const key of ['actual_pay_content', 'actual_qr_image', 'qrcode', 'qr_code', 'qr', 'code_url']) delete result[key];
  return { ...result, actual_pay_content: '', actual_qr_image: '', payment_page_url: finalUrl, resolved_pay_url: finalUrl, payment_content_type: 'payment_page' };
}

export async function resolvePaymentInBrowser(config, data) {
  const entryUrl = String(data.payurl || data.pay_url || data.url || '').trim();
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: !config.verifySsl, userAgent: 'Mozilla/5.0 Chrome/140 Safari/537.36' });
  try {
    if (data.session_token) await context.addCookies([{ name: 'PHPSESSID', value: String(data.session_token), url: config.upstream + '/' }]);
    const page = await context.newPage();
    await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: config.timeout });
    await page.waitForTimeout(Math.min(5000, config.timeout));
    const finalUrl = page.url();
    if (finalUrl === entryUrl || isCallbackUrl(finalUrl)) throw new Error('未跳转到有效的最终支付页面');
    return cleanResult(data, finalUrl);
  } finally {
    await context.close();
    await browser.close();
  }
}
