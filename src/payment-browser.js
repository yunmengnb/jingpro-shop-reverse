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
    await page.goto(entryUrl, { waitUntil: 'commit', timeout: config.timeout });
    let lastUrl = page.url();
    let stableSince = Date.now();
    const deadline = Date.now() + Math.min(Math.max(config.timeout, 10000), 30000);
    while (Date.now() < deadline) {
      await page.waitForTimeout(500);
      const currentUrl = page.url();
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        stableSince = Date.now();
      }
      if (Date.now() - stableSince >= 2000) break;
    }
    return await safePaymentUrl(config, lastUrl, entryUrl);
  } finally {
    await context.close();
    await browser.close();
  }
}
