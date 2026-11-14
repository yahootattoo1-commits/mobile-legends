// اعتبارسنجی initData تلگرام برای مینی‌اپ (Telegram WebApp).
// طرح رسمی تلگرام: secret_key = HMAC-SHA256 با کلید «WebAppData» و پیام = توکن ربات؛
// data_check_string = فیلدهای initData به‌جز hash، مرتب‌شده، با «key=value» و جداکنندهٔ \n؛
// HMAC-SHA256 با secret_key روی آن باید با hash برابر باشد؛ auth_date هم حداکثر ۲۴ ساعت قدیمی.
// با Web Crypto کار می‌کند (globalThis.crypto) — هم در Workers و هم در Node تست‌ها.
// validateInitData(initData, botToken) -> { ok, userId }؛ userId فقط وقتی معتبر است برمی‌گردد.
// اگر initData یا توکن نباشد، یا نامعتبر/قدیمی باشد، { ok: false, userId: null } برمی‌گردد
// (caller در آن حالت کاربر را ناشناس حساب می‌کند و هیچ شناسه‌ای را اعتماد نمی‌کند).

async function validateInitData(initData, botToken) {
  if (!initData || !botToken) return { ok: false, userId: null };
  let params;
  try {
    params = new URLSearchParams(String(initData));
  } catch { return { ok: false, userId: null }; }
  const hash = params.get('hash');
  if (!hash) return { ok: false, userId: null };
  const authDate = Number(params.get('auth_date') || 0);
  if (!Number.isFinite(authDate) || !authDate) return { ok: false, userId: null };
  if (Date.now() / 1000 - authDate > 24 * 3600) return { ok: false, userId: null };
  const entries = [...params.entries()]
    .filter(([k]) => k !== 'hash')
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');
  try {
    const subtle = globalThis.crypto && globalThis.crypto.subtle;
    if (!subtle) return { ok: false, userId: null };
    const enc = new TextEncoder();
    const step1 = await subtle.importKey('raw', enc.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const secret = await subtle.sign('HMAC', step1, enc.encode(String(botToken)));
    const step2 = await subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await subtle.sign('HMAC', step2, enc.encode(dataCheckString));
    const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (hex !== String(hash).toLowerCase()) return { ok: false, userId: null };
  } catch { return { ok: false, userId: null }; }
  let userId = null;
  try {
    const u = JSON.parse(params.get('user') || 'null');
    if (u && Number.isFinite(Number(u.id))) userId = Number(u.id);
  } catch { /* user خراب — همچنان ok ولی بدون شناسه */ }
  return { ok: true, userId };
}

module.exports = { validateInitData };
