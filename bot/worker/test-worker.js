// تست ورودی Workers با fetch جعلی (بدون شبکهٔ واقعی، بدون توکن واقعی).
// دیتای استاتیک مستقیم از دیسک سرو می‌شود؛ Rone و api.telegram.org هم جعلی‌اند.
// اجرا: node worker/test-worker.js  (از ریشهٔ mlbb-bot)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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

// ---------- /api/ask — سقف روزانهٔ هر کاربر (۳ جواب) + مدیر نامحدود ----------
// initData معتبر برای کاربر ساختگی با توکن تستی (همان منطق امضای تلگرام)
function makeInitData(userId) {
  const user = JSON.stringify({ id: userId, first_name: 'Test', username: 'test' });
  const fields = { auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'TESTQUERY', user };
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(env.BOT_TOKEN).digest();
  const hash = crypto.createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}
const today = new Date().toISOString().slice(0, 10);
const askAnswer = async (body) => (await (await postAsk(body)).json()).answer;
const askUser = (uid, q = 'بهترین بیلد Miya چیست؟') => askAnswer({ question: q, initData: makeInitData(uid) });

// کاربر عادی ۲۲۲: سه جواب می‌گیرد، چهارمی سقف است
const ans222 = [];
for (let i = 0; i < 3; i++) ans222.push(await askUser(222));
const ask222cap = await askUser(222);
checks.push(['/api/ask: کاربر ۲۲۲ سه جواب می‌گیرد', ans222.every((a) => a === 'پاسخ تستی مربی')]);
checks.push(['/api/ask: کاربر ۲۲۲ شمارنده ۳ دارد', kvStore.get(`coach:user:222:${today}`) === '3']);
checks.push(['/api/ask: جواب چهارم پیام سقف با عدد ۳ است', ask222cap.includes('سهم امروزت') && ask222cap.includes('(۳ جواب در روز)')]);
checks.push(['/api/ask: جواب چهارم مدل را صدا نمی‌زند', aiCalls.length === 4]);

// شناسهٔ بدون امضا در بدنه اعتماد نمی‌شود: initData برای ۸۸۸ ولی userId بدنه ۹۹۹
const spoofAns = await askAnswer({ question: 'بهترین بیلد Miya چیست؟', initData: makeInitData(888), userId: 999 });
checks.push(['/api/ask: شناسهٔ بدنه نادیده گرفته می‌شود (۸۸۸)', spoofAns === 'پاسخ تستی مربی' && kvStore.get(`coach:user:888:${today}`) === '1' && !kvStore.has(`coach:user:999:${today}`)]);

// مدیر (ADMIN_ID تستی 999999999): پنج جواب، بدون سقف
const ansAdmin = [];
for (let i = 0; i < 5; i++) ansAdmin.push(await askUser(999999999));
checks.push(['/api/ask: مدیر ۵ جواب بدون سقف می‌گیرد', ansAdmin.every((a) => a === 'پاسخ تستی مربی')]);
checks.push(['/api/ask: مدیر شمارندهٔ خودش را هم دارد', kvStore.get(`coach:user:999999999:${today}`) === '5']);
checks.push(['/api/ask: مدیر مدل را هر بار صدا می‌زند', aiCalls.length === 10]);

// override عددی ۵ برای کاربر ۵۵۵: پنج جواب، ششمی سقف با عدد ۵
kvStore.set('coach:limit:555', '5');
const ans555 = [];
for (let i = 0; i < 5; i++) ans555.push(await askUser(555));
const ask555cap = await askUser(555);
checks.push(['/api/ask: override عددی ۵ — پنج جواب می‌گیرد', ans555.every((a) => a === 'پاسخ تستی مربی')]);
checks.push(['/api/ask: سقف override عددی ۵ نامیده می‌شود', ask555cap.includes('(۵ جواب در روز)')]);
checks.push(['/api/ask: override ۵ — شمارنده ۵', kvStore.get(`coach:user:555:${today}`) === '5']);

// override نامحدود برای کاربر ۷۷۷
kvStore.set('coach:limit:777', 'inf');
const ans777 = [];
for (let i = 0; i < 4; i++) ans777.push(await askUser(777));
checks.push(['/api/ask: override نامحدود — ۴ جواب بدون سقف', ans777.every((a) => a === 'پاسخ تستی مربی') && kvStore.get(`coach:user:777:${today}`) === '4']);

// ناشناس (سطل مشترک ۳ جوابه): ask1 یک جواب گرفته بود؛ دو تای دیگر می‌گیرد، چهارمی سقف است
const anonBad = await askAnswer({ question: 'بهترین بیلد Miya چیست؟', initData: makeInitData(222).replace(/hash=[0-9a-f]+/, 'hash=' + '0'.repeat(64)) });
checks.push(['/api/ask: initData نامعتبر → ناشناس (جواب می‌گیرد)', anonBad === 'پاسخ تستی مربی']);
const anonMiss = await askAnswer({ question: 'بهترین بیلد Miya چیست؟' });
checks.push(['/api/ask: بدون initData → ناشناس (جواب می‌گیرد)', anonMiss === 'پاسخ تستی مربی']);
const anonCap = await askAnswer({ question: 'بهترین بیلد Miya چیست؟' });
checks.push(['/api/ask: ناشناس چهارم سقف ۳ می‌گیرد', anonCap.includes('سهم امروزت') && anonCap.includes('(۳ جواب در روز)')]);
checks.push(['/api/ask: سطل ناشناس ۳ است', kvStore.get(`coach:anon:${today}`) === '3']);

// سقف روزانه: شمارندهٔ سراسری را روی ۴۰۰ می‌گذاریم — مدل نباید صدا بخورد
// (سطل ناشناس را صفر می‌کنیم تا سقف سراسری دیده شود؛ سطل ناشناس پر است)
kvStore.set(`coach:anon:${today}`, '0');
const callsBeforeCap = aiCalls.length;
kvStore.set('coach:' + today, '400');
const askCap = await postAsk({ question: 'بهترین بیلد Miya چیست؟' });
const askCapJson = await askCap.json();
checks.push(['/api/ask: سقف روزانه پیام ثابت می‌دهد', askCap.status === 200 && askCapJson.answer === 'سهم امروز مربی تمام شد، فردا دوباره بپرس']);
checks.push(['/api/ask: سقف روزانه مدل را صدا نمی‌زند', aiCalls.length === callsBeforeCap]);

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
