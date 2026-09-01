// 忆梦云团队开发
import { chromium } from 'playwright-core';
import { safePaymentUrl } from './upstream.js';

const TRACK_DURATION_MS = 3000;
const QR_WAIT_MS = 15000;
const QR_SELECTORS = [
  '[id*="qrcode" i]', '[class*="qrcode" i]', '[id*="qr-code" i]', '[class*="qr-code" i]',
  '[id*="qr_code" i]', '[class*="qr_code" i]', 'canvas', 'img', 'svg', '[style*="background-image" i]'
];

async function qrCandidates(page) {
  const candidates = [];
  for (const frame of page.frames()) {
    for (const selector of QR_SELECTORS) {
      const elements = await frame.locator(selector).all().catch(() => []);
      for (const element of elements) {
        const box = await element.boundingBox().catch(() => null);
        if (!box || box.width < 120 || box.height < 120) continue;
        const ratio = box.width / box.height;
        if (ratio < 0.72 || ratio > 1.38) continue;
        const hint = await element.evaluate(node => `${node.id} ${node.className} ${node.getAttribute('alt') || ''}`.toLowerCase()).catch(() => '');
        const hinted = /qr|code|码|支付|alipay|wechat/.test(hint);
        const area = box.width * box.height;
        if (!hinted && area > 360000) continue;
        candidates.push({ element, score: area + (hinted ? 1000000 : 0) });
      }
    }
  }
  return candidates.sort((a, b) => b.score - a.score);
}

async function captureQrCode(page) {
  const deadline = Date.now() + QR_WAIT_MS;
  do {
    const candidates = await qrCandidates(page);
    for (const candidate of candidates) {
      const image = await candidate.element.screenshot({ type: 'png' }).catch(() => null);
      if (image) return `data:image/png;base64,${image.toString('base64')}`;
    }
    await page.waitForTimeout(500);
  } while (Date.now() < deadline);
  throw new Error('最终支付页面未找到可识别的二维码');
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
