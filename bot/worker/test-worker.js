// تست ورودی Workers با fetch جعلی (بدون شبکهٔ واقعی، بدون توکن واقعی).
// دیتای استاتیک مستقیم از دیسک سرو می‌شود؛ Rone و api.telegram.org هم جعلی‌اند.
// اجرا: node worker/test-worker.js  (از ریشهٔ mlbb-bot)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES_BASE = 'https://yahootattoo1-commits.github.io/mobile-legends/data';
const RONE_BASE = 'https://arena.rone.dev/api';
const TG_BASE = 'https://api.telegram.org';
const WELCOME_URL = 'https://yahootattoo1-commits.github.io/mobile-legends/assets/welcome.jpg';

const captured = []; // { method, payload } — تماس‌های خروجی به api.telegram.org
const roneCalls = [];

function pagesFile(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', file), 'utf8'));
}
function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}

globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith(PAGES_BASE + '/')) {
    const file = decodeURIComponent(u.slice(PAGES_BASE.length + 1).split('?')[0]);
    return jsonRes(pagesFile(file));
  }
  if (u.startsWith(RONE_BASE)) {
    roneCalls.push(u);
    if (u.includes('/heroes/rank')) {
      return jsonRes({ code: 0, message: 'OK', data: { records: [{ data: { main_heroid: 1, main_hero: { data: { name: 'Miya', head: 'https://example.com/miya-head.png' } }, main_hero_win_rate: 0.521, main_hero_ban_rate: 0.012, main_hero_appearance_rate: 0.034 } }] } });
    }
    if (/\/heroes\/1(\?|$)/.test(u)) {
      return jsonRes({ code: 0, message: 'OK', data: { records: [{ data: { hero: { data: { head: 'https://example.com/miya-head.png' } } } }] } });
    }
    if (u.includes('/academy/meta/version')) {
      return jsonRes({ code: 0, message: 'OK', data: { records: [{ data: { game_version: '2.1.18' } }] } });
    }
    return jsonRes({ code: 0, message: 'OK', data: { records: [] } });
  }
  if (u.startsWith(TG_BASE + '/bot')) {
    const method = u.slice((TG_BASE + '/bot').length).split('/').pop();
    const payload = init && init.body ? JSON.parse(init.body) : {};
    captured.push({ method, payload });
    if (method === 'getMe') {
      return jsonRes({ ok: true, result: { id: 9048853379, is_bot: true, first_name: 'Persian Mlbb', username: 'Mlbb_Baz_bot' } });
    }
    return jsonRes({ ok: true, result: { message_id: 1 } });
  }
  throw new Error('unexpected fetch: ' + u);
};

const kvStore = new Map();
const aiCalls = []; // { model, opts } — تماس‌های Workers AI
const env = {
  BOT_TOKEN: '123456:TEST-TOKEN-NOT-REAL',
  MINIAPP_URL: 'https://yahootattoo1-commits.github.io/mobile-legends/',
  STATIC_BASE_URL: PAGES_BASE,
  WELCOME_PHOTO_URL: WELCOME_URL,
  WEBHOOK_SECRET: 'test-secret',
  ADMIN_ID: '999999999', // شناسهٔ ساختگیِ تست — هرگز شناسهٔ واقعی اینجا ننویس
  AI: {
    async run(model, opts) {
      aiCalls.push({ model, opts });
      return { response: 'پاسخ تستی مربی' };
    },
  },
  USERS: {
    async get(k, type) {
      const v = kvStore.get(k);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(k, v) { kvStore.set(k, typeof v === 'string' ? v : JSON.stringify(v)); },
    async delete(k) { kvStore.delete(k); },
  },
};

const worker = (await import('./src/index.js')).default;

const msgUpd = (text, fromId = 111) => ({
  update_id: 1,
  message: {
    message_id: 1, date: 1730000000, text,
    entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }],
    chat: { id: fromId, type: 'private' },
    from: { id: fromId, is_bot: false, first_name: 'Test' },
  },
});

async function postUpdate(update, secret = 'test-secret') {
  const headers = { 'content-type': 'application/json' };
  if (secret) headers['x-telegram-bot-api-secret-token'] = secret;
  const req = new Request('https://worker.test/webhook', {
    method: 'POST', headers, body: JSON.stringify(update),
  });
  return worker.fetch(req, env, {});
}

const visibleText = () => captured
  .map((c) => `${c.payload.text || ''} ${c.payload.caption || ''}`)
  .join('\n');
const hasSourceName = (t) => ['Rone', 'rone.dev', 'mlbb.io', 'Fandom', 'fandom', 'ویکی'].some((w) => t.includes(w));

const checks = [];

const r1 = await postUpdate(msgUpd('/start'));
const startPhoto = captured.find((c) => c.method === 'sendPhoto');
checks.push(['/start: 200', r1.status === 200]);
checks.push(['/start: عکس خوشامد با URL', !!startPhoto && startPhoto.payload.photo === WELCOME_URL]);
checks.push(['/start: کپشن «Persian Mlbb» + خوش آمدی', !!startPhoto && (startPhoto.payload.caption || '').includes('Persian Mlbb') && (startPhoto.payload.caption || '').includes('خوش آمدی')]);
checks.push(['/start: دکمهٔ مینی‌اپ', !!startPhoto && JSON.stringify(startPhoto.payload.reply_markup || {}).includes('باز کردن مینی‌اپ')]);
checks.push(['/start: دکمهٔ مربی هوش مصنوعی', !!startPhoto && JSON.stringify(startPhoto.payload.reply_markup || {}).includes('مربی هوش مصنوعی')]);
checks.push(['/start: کاربر در KV ثبت شد', (() => {
  const raw = kvStore.get('users');
  return !!raw && JSON.parse(raw).some((u) => String(u.id) === '111');
})()]);

const beforeHero = captured.length;
const r2 = await postUpdate(msgUpd('/hero Miya'));
const heroCalls = captured.slice(beforeHero);
const heroText = heroCalls.map((c) => `${c.payload.text || ''} ${c.payload.caption || ''}`).join('\n');
checks.push(['/hero Miya: 200', r2.status === 200]);
checks.push(['/hero: پرتره با URL (نه فایل)', heroCalls.some((c) => c.method === 'sendPhoto' && typeof c.payload.photo === 'string' && c.payload.photo.startsWith('https://'))]);
checks.push(['/hero: نام + وین‌ریت', heroText.includes('Miya') && heroText.includes('وین‌ریت')]);
checks.push(['/hero: اسکیل‌ها', heroText.includes('اسکیل‌ها') || heroText.includes('Moon Arrow')]);
checks.push(['/hero: داستان کوتاه', heroText.includes('جنگ چیست')]);
checks.push(['/hero: زیر ۴۰۹۶ کاراکتر', heroCalls.every((c) => (c.payload.text || '').length < 4096 && (c.payload.caption || '').length <= 1024)]);

async function postAsk(body) {
  return worker.fetch(new Request('https://worker.test/api/ask', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), env, {});
}

// ---------- /api/ask — مربی هوش مصنوعی ----------
const ask1 = await postAsk({ question: 'بهترین بیلد Miya چیست؟' });
const ask1Json = await ask1.json();
checks.push(['/api/ask: 200 + جواب تستی', ask1.status === 200 && ask1Json.answer === 'پاسخ تستی مربی']);
checks.push(['/api/ask: هدر CORS', ask1.headers.get('access-control-allow-origin') === '*']);
checks.push(['/api/ask: مدل درست', aiCalls.length === 1 && aiCalls[0].model === '@cf/meta/llama-3.1-8b-instruct-fp8']);
checks.push(['/api/ask: پرامپت بیلد Miya را دارد', aiCalls.length === 1 && JSON.stringify(aiCalls[0].opts.messages).includes('Windtalker')]);
checks.push(['/api/ask: پرامپت کانتر Miya را دارد', aiCalls.length === 1 && JSON.stringify(aiCalls[0].opts.messages).includes('Belerick')]);
checks.push(['/api/ask: جواب فارسی (سیستم فارسی)', aiCalls.length === 1 && JSON.stringify(aiCalls[0].opts.messages).includes('مربی هوش مصنوعی')]);

const askOpt = await worker.fetch(new Request('https://worker.test/api/ask', { method: 'OPTIONS' }), env, {});
checks.push(['/api/ask: OPTIONS 204 + CORS', askOpt.status === 204 && askOpt.headers.get('access-control-allow-origin') === '*']);

// سقف روزانه: شمارنده را روی ۴۰۰ می‌گذاریم — مدل نباید صدا بخورد
kvStore.set('coach:' + new Date().toISOString().slice(0, 10), '400');
const askCap = await postAsk({ question: 'بهترین بیلد Miya چیست؟' });
const askCapJson = await askCap.json();
checks.push(['/api/ask: سقف روزانه پیام ثابت می‌دهد', askCap.status === 200 && askCapJson.answer === 'سهم امروز مربی تمام شد، فردا دوباره بپرس']);
checks.push(['/api/ask: سقف روزانه مدل را صدا نمی‌زند', aiCalls.length === 1]);

const r3 = await postUpdate(msgUpd('/start'), 'wrong-secret');
checks.push(['وبهوک با سکرت اشتباه: 403', r3.status === 403]);
checks.push(['وبهوک با سکرت اشتباه: هیچ تماسی نرفت', captured.length === beforeHero + heroCalls.length]);

const r4 = await worker.fetch(new Request('https://worker.test/health'), env, {});
const health = await r4.json();
checks.push(['/health: 200 + ok', r4.status === 200 && health.status === 'ok']);
checks.push(['/health: ۱۳۳ هیرو + دیتای ریموت', health.heroes === 133 && health.data_ready === true]);
checks.push(['/health: حالت webhook', health.mode === 'webhook']);

const r5 = await worker.fetch(new Request('https://worker.test/'), env, {});
checks.push(['GET /: متن فارسی', r5.status === 200 && (await r5.text()).includes('Persian Mlbb')]);

checks.push(['هیچ نام منبعی در متن‌های خروجی نیست', !hasSourceName(visibleText())]);
checks.push(['همهٔ تماس‌ها از fetch سراسری گذشتند (نه node-fetch)', captured.every((c) => !!c.method) && roneCalls.length >= 2]);

for (const [name, ok] of checks) console.log((ok ? 'PASS ' : 'FAIL ') + name);
if (checks.some(([, ok]) => !ok)) process.exit(1);
