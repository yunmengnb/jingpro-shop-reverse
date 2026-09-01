// 忆梦云团队开发
import { chromium } from 'playwright-core';
import { safePaymentUrl } from './upstream.js';

const TRACK_DURATION_MS = 3000;
const QR_SELECTORS = [
  '[id*="qrcode" i]', '[class*="qrcode" i]', '[id*="qr-code" i]', '[class*="qr-code" i]',
  '[id*="qr_code" i]', '[class*="qr_code" i]', 'canvas', 'img[src^="data:image"]', 'svg'
];

async function captureQrCode(page) {
  const candidates = [];
  for (const frame of page.frames()) {
    for (const selector of QR_SELECTORS) {
      const elements = await frame.locator(selector).all();
      for (const element of elements) {
        const box = await element.boundingBox().catch(() => null);
        if (!box || box.width < 120 || box.height < 120) continue;
        const ratio = box.width / box.height;
        if (ratio < 0.72 || ratio > 1.38) continue;
        candidates.push({ element, score: box.width * box.height });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length) throw new Error('最终支付页面未找到可识别的二维码');
  const image = await candidates[0].element.screenshot({ type: 'png' });
  return `data:image/png;base64,${image.toString('base64')}`;
}

export async function resolvePaymentInBrowser(config, entryUrl, upstreamSession = '') {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: !config.verifySsl, userAgent: 'Mozilla/5.0 Chrome/140 Safari/537.36' });
  try {
    if (upstreamSession) await context.addCookies([{ name: 'PHPSESSID', value: upstreamSession, url: config.upstream + '/' }]);
    const page = await context.newPage();
    await page.route('**/*', async route => {
      const request = route.request();
      if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return route.continue();
      try {
        await safePaymentUrl(config, request.url(), entryUrl);
        await route.continue();
      } catch {
        await route.abort('blockedbyclient');
      }
    });
    await page.goto(entryUrl, { waitUntil: 'commit', timeout: config.timeout });
    await page.waitForTimeout(TRACK_DURATION_MS);
    await safePaymentUrl(config, page.url(), entryUrl);
    const qrCode = await captureQrCode(page);
    return { qrCode };
  } finally {
    await context.close();
    await browser.close();
  }
}
