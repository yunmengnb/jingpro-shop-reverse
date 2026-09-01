// 忆梦云团队开发
import { chromium } from 'playwright-core';
import { safePaymentUrl } from './upstream.js';

export async function resolvePaymentInBrowser(config, entryUrl, upstreamSession = '') {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
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
    await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: config.timeout });
    let lastUrl = page.url();
    let stableRounds = 0;
    const deadline = Date.now() + Math.max(config.timeout, 15000);
    while (Date.now() < deadline && stableRounds < 3) {
      await page.waitForTimeout(1000);
      const currentUrl = page.url();
      if (currentUrl === lastUrl) stableRounds++;
      else { lastUrl = currentUrl; stableRounds = 0; }
    }
    return await safePaymentUrl(config, page.url(), entryUrl);
  } finally {
    await context.close();
    await browser.close();
  }
}
