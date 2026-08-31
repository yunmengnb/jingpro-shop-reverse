// 忆梦云团队开发
import { hostAllowed, safePaymentUrl } from './upstream.js';

const decode = value => String(value || '').replaceAll('&amp;', '&').replaceAll('\/', '/').replaceAll('\u0026', '&').replaceAll('\u003d', '=').replaceAll('\x26', '&').replaceAll('\x3d', '=');
export async function resolvePayment(config, data) {
  let url = String(data.payurl || data.pay_url || data.url || '').trim();
  let parsed; try { parsed = new URL(url); } catch { return data; }
  if (parsed.protocol !== 'https:' || !await hostAllowed(config, parsed.hostname)) return data;
  let previous = config.upstream + '/', lastDisplayUrl = url, postFields = null;
  for (let step = 0; step < 12; step++) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), config.timeout);
    try {
      const headers = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8', referer: previous, 'user-agent': 'Mozilla/5.0 Chrome/140 Safari/537.36' };
      if (new URL(url).hostname === new URL(config.upstream).hostname && data.session_token) headers.cookie = 'PHPSESSID=' + data.session_token;
      if (postFields !== null) headers['content-type'] = 'application/x-www-form-urlencoded';
      const response = await fetch(url, { method: postFields === null ? 'GET' : 'POST', headers, body: postFields, redirect: 'manual', signal: controller.signal });
      if (response.status >= 400) throw new Error('支付渠道响应异常（HTTP ' + response.status + '）');
      const location = response.headers.get('location'); if (location) { previous = url; url = await safePaymentUrl(config, location, url); postFields = null; continue; }
      const type = response.headers.get('content-type') || '';
      if (type.toLowerCase().startsWith('image/')) return { ...data, actual_qr_image: url, resolved_pay_url: url };
      if (!/^(?:openapi|gateway)\.alipay\.com$/i.test(new URL(url).hostname) && postFields === null) lastDisplayUrl = url;
      const html = (await response.text()).slice(0, 4194304); const source = decode(html);
      const patterns = [/https:\/\/qr\.alipay\.com\/[a-zA-Z0-9]+/i, /https:\/\/mobilecodec\.alipay\.com\/show\.htm\?code=[a-zA-Z0-9]+/i, /["']?(?:qrCode|qrCodeUrl|code_url|codeUrl|qr_code|qrcode|qrUrl|nativeUrl|payInfo)["']?\s*[:=]\s*["']([^"']+)["']/i, /(?:new\s+)?QRCode\s*\([^,]+,\s*(?:\{[^}]*text\s*:\s*)?["']([^"']+)["']/i];
      for (const pattern of patterns) { const match = source.match(pattern); if (!match) continue; const qr = decode(match[1] || match[0]); if (/^(?:alipays?:|weixin:|wxp:)/i.test(qr)) return { ...data, actual_pay_content: qr }; if (/^https?:/i.test(qr)) return { ...data, actual_pay_content: await safePaymentUrl(config, qr, url), resolved_pay_url: url }; }
      const autoSubmit = /(?:document\.(?:forms\[[^\]]+\]|getElementById\([^)]+\))|[a-zA-Z_$][\w$]*)\.submit\s*\(/i.test(source);
      const forms = source.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi);
      for (const form of forms) {
        const formUrl = await safePaymentUrl(config, form[1].match(/action=["']([^"']+)["']/i)?.[1] || url, url);
        const host = new URL(formUrl).hostname;
        if ((!autoSubmit && !/(?:openapi|excashier|cashier|gateway)\.alipay\.com$/i.test(host)) || /help\.alipay\.com|\/support\/search|search_new_result/i.test(formUrl)) continue;
        const fields = new URLSearchParams();
        for (const input of form[2].matchAll(/<input\b([^>]*)>/gi)) { const name = input[1].match(/name=["']([^"']+)["']/i)?.[1]; if (name) fields.set(decode(name), decode(input[1].match(/value=["']([^"']*)["']/i)?.[1] || '')); }
        previous = url; url = formUrl; const method = form[1].match(/method=["']([^"']+)["']/i)?.[1]?.toUpperCase() || 'GET'; postFields = method === 'POST' ? fields.toString() : null; if (method !== 'POST' && fields.size) { const target = new URL(url); for (const [key, value] of fields) target.searchParams.set(key, value); url = target.href; } break;
      }
      if (previous !== url && (postFields !== null || url !== lastDisplayUrl)) continue;
      const jump = source.match(/(?:(?:window|top)\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i) || source.match(/location\.replace\s*\(\s*["']([^"']+)["']/i) || source.match(/<iframe[^>]+src=["']([^"']+)["']/i) || source.match(/<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^;]+;\s*url=([^"']+)/i);
      if (jump) { previous = url; url = await safePaymentUrl(config, decode(jump[1]), url); postFields = null; continue; }
      return { ...data, actual_pay_content: lastDisplayUrl, resolved_pay_url: lastDisplayUrl, payment_content_type: 'payment_page' };
    } finally { clearTimeout(timer); }
  }
  if (/^https:/i.test(lastDisplayUrl)) return { ...data, actual_pay_content: lastDisplayUrl, resolved_pay_url: lastDisplayUrl, payment_content_type: 'payment_page' };
  throw new Error('支付跳转次数过多，未获取到支付界面');
}
