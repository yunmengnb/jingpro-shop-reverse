// 忆梦云团队开发
import { chromium } from 'playwright-core';

const QR_PROTOCOL = /^(?:https?:\/\/|alipays?:|weixin:|wxp:)/i;
const CALLBACK_PATH = /(?:^|[\/_-])(?:notify|notification|callback|webhook|return|query|status|success)(?:[\/_-]|$)/i;
const isCallbackUrl = value => { try { return CALLBACK_PATH.test(new URL(value).pathname); } catch { return true; } };
const decode = value => String(value || '').replaceAll('&amp;', '&').replaceAll('\\/', '/').replaceAll('\\u0026', '&').replaceAll('\\u003d', '=');

function cleanResult(data, values) {
  const result = { ...data };
  for (const key of ['actual_pay_content', 'actual_qr_image', 'qrcode', 'qr_code', 'qr', 'code_url']) delete result[key];
  return { ...result, ...values };
}

export async function resolvePaymentInBrowser(config, data) {
  const entryUrl = String(data.payurl || data.pay_url || data.url || '').trim();
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: !config.verifySsl, userAgent: 'Mozilla/5.0 Chrome/140 Safari/537.36' });
  try {
    if (data.session_token) await context.addCookies([{ name: 'PHPSESSID', value: String(data.session_token), url: config.upstream + '/' }]);
    const page = await context.newPage();
    const candidates = [];
    page.on('request', request => {
      const url = request.url();
      if (QR_PROTOCOL.test(url) && !isCallbackUrl(url)) candidates.push(url);
    });
    await page.addInitScript(() => {
      window.__shopProQrValues = [];
      const collect = value => {
        if (typeof value === 'string' && value.length > 5) window.__shopProQrValues.push(value);
        else if (value && typeof value === 'object') {
          for (const [key, item] of Object.entries(value)) if (/^(qrCode|qrCodeUrl|code_url|codeUrl|qr_code|qrcode|qrUrl|nativeUrl|payInfo)$/i.test(key)) collect(item);
        }
      };
      const originalFetch = window.fetch;
      window.fetch = async (...args) => { const response = await originalFetch(...args); response.clone().json().then(collect).catch(() => {}); return response; };
      const open = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (...args) { this.addEventListener('load', () => { try { collect(JSON.parse(this.responseText)); } catch {} }); return open.apply(this, args); };
    });
    await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: config.timeout });
    await page.waitForTimeout(Math.min(5000, config.timeout));
    const extracted = await page.evaluate(() => {
      const values = [...(window.__shopProQrValues || [])];
      const source = document.documentElement.innerHTML;
      const patterns = [
        /["']?(?:qrCode|qrCodeUrl|code_url|codeUrl|qr_code|qrcode|qrUrl|nativeUrl|payInfo)["']?\s*[:=]\s*["']([^"']+)["']/gi,
        /(?:new\s+)?QRCode\s*\([^,]+,\s*(?:\{[^}]*text\s*:\s*)?["']([^"']+)["']/gi
      ];
      for (const pattern of patterns) for (const match of source.matchAll(pattern)) values.push(match[1]);
      for (const image of document.images) if (image.src) values.push(image.src);
      return values;
    });
    for (const value of [...extracted, ...candidates].map(decode)) {
      if (!QR_PROTOCOL.test(value) || isCallbackUrl(value)) continue;
      if (value === entryUrl || value === page.url()) continue;
      return cleanResult(data, { actual_pay_content: value, resolved_pay_url: page.url(), payment_content_type: 'qr_content' });
    }
    const finalUrl = page.url();
    if (!isCallbackUrl(finalUrl) && finalUrl !== entryUrl) return cleanResult(data, { actual_pay_content: '', actual_qr_image: '', payment_page_url: finalUrl, resolved_pay_url: finalUrl, payment_content_type: 'payment_page' });
    throw new Error('最终支付页面未返回可识别的二维码内容');
  } finally {
    await context.close();
    await browser.close();
  }
}
