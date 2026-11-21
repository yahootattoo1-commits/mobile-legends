// ورودی Cloudflare Workers — ربات تلگرام Persian Mlbb در حالت وبهوک (بدون polling).
// هیچ کدی اینجا به process یا fs دست نمی‌زند؛ همه‌چیز از env می‌آید.
// دیتای ۷ فایل refreshable اول از KV DATA خوانده می‌شود (اسکرپر با POST
// /data/<file> می‌نویسد) و اگر KV خالی بود، fallback به GitHub Pages است؛
// بقیهٔ فایل‌ها فقط از Pages می‌آیند. TTL ده‌دقیقه‌ای ensureRemote سر جایش است،
// پس پوشِ دیتا به‌تنهایی کافی است و ری‌استارت لازم نیست.
// ایمپورت‌های استاتیک — esbuild فقط همین‌ها را در باندل ردیابی می‌کند؛
// require از طریق createRequire در باندل جا می‌ماند و زمان‌اجرا خطا می‌دهد.
import { createBot } from '../../src/bot.js';
import sd from '../../src/staticData.js';
import { askCoach } from '../../src/coach.js';
import { validateInitData } from '../../src/webappAuth.js';
import { telegramLib } from './patch-telegram.cjs';

import { WorkerTelegram } from './telegram.js';
import { kvUserStore, kvSessionStore, kvDataStore } from './stores.js';

// ⚠️ حیاتی: Telegraf در handleUpdate به‌ازای هر آپدیت یک Telegram تازه می‌سازد
// (new telegram_1.default(...)). با جایگزینی default، آن نمونه‌ها هم
// WorkerTelegram می‌شوند — وگرنه کلاینت stock با node-fetch خطا می‌دهد.
// (فقط bot.telegram را عوض‌کردن کافی نیست، چون Context از نمونهٔ تازه استفاده می‌کند.)
telegramLib.default = WorkerTelegram;

const DEFAULT_STATIC_BASE = 'https://yahootattoo1-commits.github.io/mobile-legends/data';

// دیتای تازه: اول KV DATA، بعد Pages (fallback). اگر KV خالی/خطا بدهد،
 // ensureRemote خودش به Pages برمی‌گردد و رفتار دقیقاً مثل قبل می‌ماند.
async function refreshStatic(env) {
  const kvGet = kvDataStore(env).get;
  await sd.ensureRemote(env.STATIC_BASE_URL || DEFAULT_STATIC_BASE, undefined, kvGet)
    .catch((e) => console.warn('[worker] static refresh failed', e.message));
}

// ---------- اندپوینت دیتا: POST /data/<file> (نوشتن، با HMAC) و GET /data/<file> ----------
// فقط همین ۱۰ فایل قابل نوشتن/خواندن‌اند؛ بقیه ۴۰۰/۴۰۴ می‌گیرند.
// احراز هویت POST: هدر X-Data-Auth باید برابر باشد با
//   HMAC-SHA256(key = WEBHOOK_SECRET یا DATA_SECRET, message = 'persian-mlbb-bot-data:' + file) به‌صورت hex
// مقدار سکرت هیچ‌جا لاگ یا ذخیره نمی‌شود — فقط همین مقایسهٔ HMAC انجام می‌شود.
const DATA_FILES = new Set([
  'tierlist.json', 'news.json', 'discussions.json', 'events.json',
  'hero-stats.json', 'matchups.json', 'team-comps.json',
  'fa-content.json', 'patch-notes-full.json', 'builds-full.json',
]);
const DATA_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Data-Auth',
};

async function hmacHex(keyString, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(keyString), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// احراز هویت HMAC برای اسکریپت خودکار — دو کلید پذیرفته می‌شود:
//   WEBHOOK_SECRET (موجود، بدون تغییر) یا DATA_SECRET (جدید، برای GitHub Actions).
// DATA_SECRET تا وقتی roozbeh خودش در داشبورد Cloudflare ست نکرده، unset است
// و فقط مسیر قدیمی کار می‌کند. سکرتِ وبهوک تلگرام (/webhook) جدا می‌ماند و
// این تابع هیچ‌وقت آنجا استفاده نمی‌شود.
async function verifyDataAuth(request, env, message) {
  const got = (request.headers.get('x-data-auth') || '').trim().toLowerCase();
  if (!got) return false;
  for (const secret of [env.WEBHOOK_SECRET, env.DATA_SECRET]) {
    if (!secret) continue;
    const want = await hmacHex(secret, message);
    if (timingSafeEqual(got, want)) return true;
  }
  return false;
}

async function handleDataRoute(request, env) {
  const url = new URL(request.url);
  const file = decodeURIComponent(url.pathname.slice('/data/'.length));
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: DATA_CORS_HEADERS });
  }
  if (request.method === 'POST') {
    if (!DATA_FILES.has(file)) return new Response('Bad file', { status: 400 });
    if (!env.DATA) return new Response('Data store not configured', { status: 503 });
    if (!env.WEBHOOK_SECRET && !env.DATA_SECRET) return new Response('Forbidden', { status: 403 });
    if (!(await verifyDataAuth(request, env, 'persian-mlbb-bot-data:' + file))) {
      return new Response('Forbidden', { status: 403 });
    }
    const raw = await request.text();
    try { JSON.parse(raw); } catch { return new Response('Bad JSON', { status: 400 }); }
    await env.DATA.put(file, raw);
    return Response.json({ ok: true }, { headers: DATA_CORS_HEADERS });
  }
  if (request.method === 'GET') {
    if (!DATA_FILES.has(file)) return new Response('Not found', { status: 404 });
    if (!env.DATA) return new Response('Not found', { status: 404 });
    const raw = await env.DATA.get(file);
    if (raw === null) return new Response('Not found', { status: 404 });
    return new Response(raw, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...DATA_CORS_HEADERS,
      },
    });
  }
  return new Response('Method not allowed', { status: 405 });
}

// ---------- ترجمهٔ خودکار (بدون ایجنت): POST /translate ----------
// اسکریپت خودکار VM آیتم‌های تازه را می‌فرستد و فیلدهای فارسی را می‌گیرد.
// احراز هویت: هدر X-Data-Auth = HMAC-SHA256(key = WEBHOOK_SECRET یا DATA_SECRET,
// message = 'persian-mlbb-bot-translate') به‌صورت hex.
// ورودی: {kind: 'event'|'discussion'|'patch', ...فیلدهای خام انگلیسی}
//   event: {title, summary, status} -> {title_fa, summary_fa, status_fa}
//     (status_fa قطعی است و با کد ساخته می‌شود: ended -> «تمام‌شده»، بقیه -> «تاریخ مشخص نیست»)
//   discussion: {title} -> {title_fa}
//   patch: {part: 'meta'|'hero'|'equipment'|'section', ...}
//     meta: {title, whats_new[], intro, designers_note, new_heroes[]}
//       -> {title_fa, whats_new_fa[], intro_fa, designers_note_fa, new_heroes_fa[]}
//     hero: {hero, type, note, skills:[{skill, type, changes[]}]} (type_fa قطعی از type)
//       -> {hero, type_fa, note_fa, skills_fa:[{skill, type_fa, changes_fa[]}]} — mlid را اسکریپت می‌زند
//     equipment: {item, type, note, groups} -> {item, type_fa, note_fa, groups_fa}
//     section: {heading, text} -> {heading_fa, text_fa}
// type_fa فقط تقویت/تضعیف/تعدیل (buff/nerf/adjust) و با کد ساخته می‌شود، نه مدل.
// مدل فقط متن را ترجمه می‌کند؛ اگر JSON خروجی خراب یا ناقص بود، ۵۰۲ برمی‌گردد
// و اسکریپت آیتم را ناتمام می‌گذارد تا اجرای بعد دوباره تلاش کند.
const TRANSLATE_MODEL = '@cf/qwen/qwen3.8-27b';
const TRANSLATE_SYSTEM = [
  'You translate Mobile Legends: Bang Bang game content from English to Persian (Farsi) for Iranian players.',
  'RULES (always):',
  '- Hero names, skill names, item names and place names stay in English exactly as written.',
  '- NEVER transliterate a hero, skill or item name into Persian script, even inside a sentence — always write names in Latin letters (Aulus stays Aulus, never آولوس; Masha stays Masha, never ماشا).',
  '- All numbers, percentages and formulas stay EXACTLY as written, with Latin digits and parentheses (e.g. 150 (+50% Extra Physical Attack), 0.88 -> 1). In "Label: value" change lines, translate only the label before the colon.',
  '- Fluent natural Persian, the way Iranian MLBB players speak; not word-for-word machine translation. Keep paragraph breaks.',
  '- NEVER mention or include source names: Rone, mlbb.io, Fandom, wiki (or ویکی).',
  '- A title that is only a hero name stays in English unchanged.',
  'GLOSSARY (use these exact Persian words): Physical Damage=آسیب فیزیکی, Magic Damage=آسیب جادویی, True Damage=آسیب واقعی, Physical Attack=حمله فیزیکی, Magic Power=قدرت جادویی, Attack Speed=سرعت حمله, Movement Speed=سرعت حرکت, Critical Chance=شانس ضربه بحرانی, Crit Damage=آسیب ضربه بحرانی, Physical Penetration=نفوذ فیزیکی, Magic Penetration=نفوذ جادویی, Physical Defense=دفاع فیزیکی, Magic Defense=دفاع جادویی, Damage Reduction=کاهش آسیب, Cooldown=زمان انتظار, Cooldown Reduction=کاهش زمان انتظار, HP=جان, Max HP=حداکثر جان, Mana=مانا, Shield=سپر, Lifesteal=دزدی جان, Spell Vamp=دزدی جادویی, HP Regen=بازسازی جان, Mana Regen=بازسازی مانا, Stun=گیج کردن, Slow=کند کردن, Silence=سکوت, Immobilize=بی‌حرکت کردن, Knockback=به عقب پرتاب کردن, Airborne=به هوا پرتاب کردن, Taunt=تحریک, Buff=تقویت, Debuff=اثر منفی, Stack=لایه, Mark=علامت, Dash=جهش, Blink=چشمک زدن, Heal=درمان, Revive=زنده کردن, Basic Attack=حمله پایه, Enemy hero=قهرمان دشمن, Ally=هم‌تیمی, Target=هدف, Turret=برج, Base=پایگاه, Minion=سرباز, Creep=هیولای جنگل, Lord=لرد, Turtle=لاک‌پشت, Jungle=جنگل, Lane=مسیر, Range=برد, Duration=مدت, Marksman=تیرانداز, Assassin=قاتل, Mage=جادوگر, Tank=تانک, Fighter=مبارز, Support=پشتیبان, Skin=اسکین, Quiz=کوییز, Trial=آزمون, Season=فصل, Event=ایونت, Survey=نظرسنجی, Guide=راهنما, Matchmaking=مچ‌میکینگ.',
  'OUTPUT: reply with ONLY a JSON object with exactly the requested keys, no markdown fences, no explanation.',
].join('\n');

const TYPE_FA = { buff: 'تقویت', nerf: 'تضعیف', adjust: 'تعدیل' };

function parseModelJson(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  // First complete {...} object (brace-matched, string-aware) — the model
  // sometimes adds trailing commentary or a second object after the JSON.
  const sub = extractFirstJsonObject(t);
  if (sub) {
    try { return JSON.parse(sub); } catch { /* model sometimes puts raw line breaks inside strings */ }
    try { return JSON.parse(repairJsonStringLiterals(sub)); } catch { /* fall through to the slice fallback */ }
  }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const sliced = t.slice(start, end + 1);
  try { return JSON.parse(sliced); } catch { return null; }
}

// Returns the first complete {...} object in the text (brace counting that
// respects string literals and escapes), or null when the output is cut off.
function extractFirstJsonObject(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
    }
  }
  return null;
}

// The model sometimes emits raw line breaks inside JSON string values
// (invalid JSON) — escape control characters inside strings and retry.
function repairJsonStringLiterals(text) {
  let out = '';
  let inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) { out += ch; esc = false; }
      // The model sometimes writes a stray backslash before a Persian word
      // (e.g. \نقشه‌برداری — it meant a newline) — that is an invalid JSON
      // escape, so drop the backslash unless the escape is valid.
      else if (ch === '\\') {
        const nx = text[i + 1];
        if (nx === '"' || nx === '\\' || nx === '/' || nx === 'b' || nx === 'f'
          || nx === 'n' || nx === 'r' || nx === 't') { out += ch; esc = true; }
        else if (nx === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) { out += ch; esc = true; }
        // else: invalid escape — drop the backslash, keep the next char as-is
      }
      else if (ch === '"') { out += ch; inStr = false; }
      else if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else if (ch.charCodeAt(0) < 0x20) out += ' ';
      else out += ch;
    } else {
      if (ch === '"') inStr = true;
      out += ch;
    }
  }
  return out;
}

// مدل کوچک گاهی JSON خراب یا ناقص برمی‌گرداند — تا ۲ بار تلاش می‌کند؛
// validate(parsed) باید true برگرداند وگرنه تلاش بعدی انجام می‌شود.
async function runTranslate(env, instruction, inputObj, maxTokens, validate, label, keepNames) {
  const keep = Array.isArray(keepNames) && keepNames.length
    ? ' Keep these names exactly as written in Latin script, never transliterated: ' + keepNames.join(', ') + '.'
    : '';
  const baseUserText = instruction + keep + '\nInput JSON:\n' + JSON.stringify(inputObj) + '\nOutput JSON only:';
  let lastErr = new Error('empty model response');
  for (let attempt = 0; attempt < 2; attempt++) {
    const userText = attempt === 0 ? baseUserText : baseUserText + '\nPrevious attempt failed: ' + lastErr.message + ' Fix it and return valid JSON only.';
    try {
      const res = await env.AI.run(TRANSLATE_MODEL, {
        messages: [
          { role: 'system', content: TRANSLATE_SYSTEM },
          { role: 'user', content: userText },
        ],
        temperature: 0.2,
        max_tokens: maxTokens,
      });
      const text = res && typeof res.response === 'string' ? res.response.trim() : '';
      if (!text) throw new Error('empty model response');
      const parsed = parseModelJson(text);
      if (!parsed) throw new Error((label ? label + ': ' : '') + 'model did not return JSON; raw_len=' + text.length + '; raw=' + text.slice(0, 1200));
      if (validate) {
        const v = validate(parsed);
        if (v !== true) throw new Error((label ? label + ': ' : '') + 'validation failed: ' + (typeof v === 'string' ? v : 'output'));
      }
      return parsed;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function handleTranslate(request, env) {
  if (!env.AI || typeof env.AI.run !== 'function') {
    return Response.json({ error: 'ai unavailable' }, { status: 503 });
  }
  if (!env.WEBHOOK_SECRET && !env.DATA_SECRET) return new Response('Forbidden', { status: 403 });
  if (!(await verifyDataAuth(request, env, 'persian-mlbb-bot-translate'))) {
    return new Response('Forbidden', { status: 403 });
  }
  let body = null;
  try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  const kind = body && body.kind;
  const keepNames = Array.isArray(body.keep_names)
    ? body.keep_names.filter((n) => typeof n === 'string' && n.trim()).slice(0, 20)
    : [];
  try {
    if (kind === 'event') {
      const title = String(body.title || '').trim();
      const summary = String(body.summary || '').trim();
      if (!title) return Response.json({ error: 'title required' }, { status: 400 });
      const out = await runTranslate(env,
        'Translate this game event to Persian. Return JSON with exactly these keys: title_fa (Persian title), summary_fa (Persian summary). Example: input {"title": "515 Unite", "summary": "1. Time (server time): April 22nd to May 20th"} -> output {"title_fa": "515 Unite", "summary_fa": "1. زمان (به وقت سرور): 22 آوریل تا 20 مه"}.',
        { title, summary }, 1024,
        (o) => typeof o.title_fa === 'string' && !!o.title_fa.trim() && typeof o.summary_fa === 'string', keepNames);
      return Response.json({
        title_fa: out.title_fa.trim(),
        summary_fa: out.summary_fa,
        status_fa: body.status === 'ended' ? 'تمام‌شده' : 'تاریخ مشخص نیست',
      });
    }
    if (kind === 'discussion') {
      const title = String(body.title || '').trim();
      if (!title) return Response.json({ error: 'title required' }, { status: 400 });
      const out = await runTranslate(env,
        'Translate this forum thread title to Persian. Return JSON with exactly this key: title_fa. Example: input {"title": "Hero recommendation for me"} -> output {"title_fa": "معرفی هیرو برای من"}.',
        { title }, 256,
        (o) => typeof o.title_fa === 'string' && !!o.title_fa.trim(), keepNames);
      return Response.json({ title_fa: out.title_fa.trim() });
    }
    if (kind === 'patch') {
      const part = body.part || 'meta';
      if (part === 'meta') {
        const input = {
          title: body.title || '',
          whats_new: body.whats_new || [],
          intro: body.intro || '',
          designers_note: body.designers_note || '',
          new_heroes: body.new_heroes || [],
        };
        // متا در یک فراخوانی جا نمی‌شود (مدل برای متن‌های بلند JSON برنمی‌گرداند) —
        // پس دو فراخوانی جدا: سرخط + لیست تازه‌ها، بعد مقدمه/یادداشت/هیروهای تازه.
        const head = await runTranslate(env,
          'Translate this patch-notes header to Persian. Return JSON with exactly these keys: title_fa, whats_new_fa. whats_new_fa MUST be a JSON array of strings, one item per whats_new entry, same order. Example: input {"title": "Patch Notes 2.2.16", "whats_new": ["Revamp Hero: Bruno", "10th Anniversary art overhaul"]} -> output {"title_fa": "پچ ۲.۲.۱۶", "whats_new_fa": ["بازسازی هیرو: Bruno", "بازطراحی هنری دهمین سالگرد"]}. Do NOT add any text before or after the JSON object.',
          { title: input.title, whats_new: input.whats_new }, 2048,
          (o) => {
            if (typeof o.title_fa !== 'string' || !o.title_fa.trim()) return 'title_fa';
            if (!Array.isArray(o.whats_new_fa)) return 'whats_new_fa not array';
            if (o.whats_new_fa.length !== input.whats_new.length) return 'whats_new_fa length ' + o.whats_new_fa.length + ' vs ' + input.whats_new.length;
            return true;
          }, 'meta-head', keepNames);
        // مقدمه + یادداشت طراح در یک فراخوانی جا نمی‌شد (خروجی مدل ناقص می‌ماند) —
        // پس دو فراخوانی جدا: مقدمه، بعد یادداشت طراح + هیروهای تازه.
        const introOut = await runTranslate(env,
          'Translate this patch-notes introduction to Persian. Return JSON with exactly this key: intro_fa. Hero names stay in Latin even inside sentences — example: input {\"intro\": \"This includes the revamped heroes Masha and Bruno.\"} -> output {\"intro_fa\": \"این شامل هیروهای بازسازی‌شده Masha و Bruno است.\"}. Do NOT add any text before or after the JSON object.',
          { intro: input.intro }, 4096,
          (o) => typeof o.intro_fa === 'string' ? true : 'intro_fa', 'meta-intro', keepNames);
        // وقتی هیروی تازه‌ای نیست، new_heroes_fa را اصلاً از مدل نمی‌خواهیم —
        // وگرنه نام‌های داخل یادداشت طراح را هیروی تازه جا می‌زند (۸ مورد).
        const hasNewHeroes = (input.new_heroes || []).length > 0;
        const restOut = await runTranslate(env,
          hasNewHeroes
            ? 'Translate this patch-notes designer note to Persian. Return JSON with exactly these keys: designers_note_fa, new_heroes_fa (array, same length and order as new_heroes; each entry keeps hero unchanged and has feature_fa translated and skills_fa array with skill unchanged and changes_fa translated). Do NOT add any text before or after the JSON object.'
            : 'Translate this patch-notes designer note to Persian. Return JSON with exactly this key: designers_note_fa. Do NOT add any text before or after the JSON object.',
          hasNewHeroes
            ? { designers_note: input.designers_note, new_heroes: input.new_heroes }
            : { designers_note: input.designers_note }, 8192,
          (o) => {
            if (typeof o.designers_note_fa !== 'string') return 'designers_note_fa';
            if (hasNewHeroes) {
              if (!Array.isArray(o.new_heroes_fa)) return 'new_heroes_fa not array';
              if (o.new_heroes_fa.length !== input.new_heroes.length) return 'new_heroes_fa length ' + o.new_heroes_fa.length + ' vs ' + input.new_heroes.length;
            }
            return true;
          }, 'meta-rest', keepNames);
        const out = { ...head, ...introOut, ...restOut, new_heroes_fa: hasNewHeroes ? restOut.new_heroes_fa : [] };
        return Response.json({
          title_fa: out.title_fa,
          whats_new_fa: out.whats_new_fa,
          intro_fa: out.intro_fa,
          designers_note_fa: out.designers_note_fa,
          // شکل canonical مثل پچ‌های قبلی: {hero, feature_fa, skills_fa:[{skill, changes_fa[]}]}
          new_heroes_fa: out.new_heroes_fa.map((h) => ({
            hero: h.hero || '',
            feature_fa: typeof h.feature_fa === 'string' ? h.feature_fa : '',
            skills_fa: (Array.isArray(h.skills_fa) ? h.skills_fa : []).map((s) => ({
              skill: s.skill || '',
              changes_fa: Array.isArray(s.changes_fa) ? s.changes_fa : [],
            })),
          })),
        });
      }
      if (part === 'hero') {
        const input = { hero: body.hero || '', note: body.note || '', skills: body.skills || [] };
        // نام هیرو را مدل مدام به خط فارسی برمی‌گرداند (آولوس) — پس جای نام،
        // نگهدارندهٔ {HERO} می‌خواهد و ورکر بعد از ترجمه آن را با نام لاتین عوض می‌کند.
        const out = await runTranslate(env,
          'Translate this hero adjustment to Persian. Return JSON with exactly these keys: note_fa, skills_fa (array, same length and order as skills; each entry keeps skill and type unchanged and has changes_fa translated). IMPORTANT: wherever the hero name appears in the Persian text, write the placeholder {HERO} instead of the name (never in Persian script, never in Latin) — the system substitutes the real name afterwards. Example: input {"hero": "Lukas", "note": "Lukas was slightly weak in the Exp Lane but too strong as a jungler.", "skills": [{"skill": "Passive", "type": "buff", "changes": ["Resolve Gained from Attacking Enemies: 2 → 3.5"]}]} -> output {"note_fa": "{HERO} در مسیر تجربه کمی ضعیف بود اما به‌عنوان جنگل‌بان خیلی قوی بود.", "skills_fa": [{"skill": "Passive", "type": "buff", "changes_fa": ["عزم به دست‌آمده از حمله به دشمنان: 2 → 3.5"]}]}.',
          input, 2048,
          (o) => {
            if (typeof o.note_fa !== 'string') return 'note_fa';
            if (!Array.isArray(o.skills_fa)) return 'skills_fa not array';
            if (o.skills_fa.length !== input.skills.length) return 'skills_fa length';
            // اگر یادداشت انگلیسی نام هیرو را دارد، ترجمه باید {HERO} یا نام لاتین را داشته باشد
            if (input.hero && input.note.includes(input.hero)
              && !o.note_fa.includes('{HERO}') && !o.note_fa.includes(input.hero)) return 'hero name missing';
            return true;
          }, 'hero', keepNames);
        const sub = (s) => String(s || '').split('{HERO}').join(input.hero);
        const noteFa = sub(out.note_fa);
        if (input.note.includes(input.hero) && input.hero && !noteFa.includes(input.hero)) {
          throw new Error('hero name missing from translation');
        }
        return Response.json({
          hero: input.hero, type_fa: TYPE_FA[body.type] || 'تعدیل',
          note_fa: noteFa,
          skills_fa: out.skills_fa.map((s) => ({
            skill: s.skill || '', type_fa: TYPE_FA[s.type] || 'تعدیل',
            changes_fa: (Array.isArray(s.changes_fa) ? s.changes_fa : []).map(sub),
          })),
        });
      }
      if (part === 'equipment') {
        const input = { item: body.item || '', note: body.note || '', groups: body.groups || [] };
        // مثل هیرو: نام آیتم با نگهدارندهٔ {ITEM} می‌آید تا به خط فارسی برنگردد.
        const out = await runTranslate(env,
          'Translate this equipment adjustment to Persian. Return JSON with exactly these keys: note_fa (null when the input note is null), groups_fa (array, same length and order as groups; each entry keeps group and type unchanged and has changes_fa translated). IMPORTANT: wherever the item name appears in the Persian text, write the placeholder {ITEM} instead of the name (never in Persian script, never in Latin) — the system substitutes the real name afterwards.',
          input, 1024,
          (o) => (o.note_fa === null || typeof o.note_fa === 'string')
            && Array.isArray(o.groups_fa) && o.groups_fa.length === input.groups.length, 'equipment', keepNames);
        const sub = (s) => String(s || '').split('{ITEM}').join(input.item);
        const noteFa = typeof out.note_fa === 'string' ? sub(out.note_fa) : null;
        return Response.json({
          item: input.item, type_fa: TYPE_FA[body.type] || 'تعدیل',
          note_fa: noteFa,
          // شکل canonical: [{group, type_fa, changes_fa[]}]
          groups_fa: (Array.isArray(out.groups_fa) ? out.groups_fa : []).map((g) => ({
            group: g.group || '',
            type_fa: TYPE_FA[g.type] || (['تقویت', 'تضعیف', 'تعدیل'].includes(g.type_fa) ? g.type_fa : 'تعدیل'),
            changes_fa: (Array.isArray(g.changes_fa) ? g.changes_fa : []).map(sub),
          })),
        });
      }
      if (part === 'section') {
        const input = { heading: body.heading || '', text: body.text || '' };
        const out = await runTranslate(env,
          'Translate this patch-notes section to Persian. Return JSON with exactly these keys: heading_fa, text_fa.',
          input, 2048,
          (o) => typeof o.heading_fa === 'string' && typeof o.text_fa === 'string', undefined, keepNames);
        return Response.json({ heading_fa: out.heading_fa, text_fa: out.text_fa });
      }
      return Response.json({ error: 'unknown patch part' }, { status: 400 });
    }
    return Response.json({ error: 'unknown kind' }, { status: 400 });
  } catch (e) {
    const detail = String((e && e.message) || e || 'unknown').slice(0, 500);
    console.error('[worker] translate failed', detail);
    return Response.json({ error: 'translate failed', detail }, { status: 502 });
  }
}

// ---------- هشدار خرابی (بدون ایجنت): POST /alert ----------
// فقط اسکریپت خودکار بعد از ۳ اجرای ناموفق پشت سر هم صدا می‌زند.
// احراز هویت: هدر X-Data-Auth = HMAC-SHA256(key = WEBHOOK_SECRET یا DATA_SECRET,
// message = 'persian-mlbb-bot-alert') به‌صورت hex.
// ورودی: {message} (فارسی، کوتاه). ورکر آن را با BOT_TOKEN برای ADMIN_ID تلگرام می‌فرستد.
async function handleAlert(request, env) {
  if (!env.WEBHOOK_SECRET && !env.DATA_SECRET) return new Response('Forbidden', { status: 403 });
  if (!(await verifyDataAuth(request, env, 'persian-mlbb-bot-alert'))) {
    return new Response('Forbidden', { status: 403 });
  }
  let body = null;
  try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 1000) : '';
  if (!message) return Response.json({ error: 'message required' }, { status: 400 });
  if (!env.BOT_TOKEN || !env.ADMIN_ID) {
    return Response.json({ error: 'alert not configured' }, { status: 503 });
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.ADMIN_ID, text: message }),
    });
    if (!r.ok) return Response.json({ ok: false }, { status: 502 });
    return Response.json({ ok: true });
  } catch (e) {
    console.error('[worker] alert send failed', e && e.message ? e.message : e);
    return Response.json({ ok: false }, { status: 502 });
  }
}

// ---------- گزارش بروزرسانی: POST /refresh-report ----------
// اسکریپت بعد از هر اجرا خلاصه را می‌فرستد و ورکر آن را برای ADMIN_ID تلگرام می‌کند.
// احراز هویت مثل /alert با پیام 'persian-mlbb-bot-refresh-report'.
async function handleRefreshReport(request, env) {
  if (!env.WEBHOOK_SECRET && !env.DATA_SECRET) return new Response('Forbidden', { status: 403 });
  if (!(await verifyDataAuth(request, env, 'persian-mlbb-bot-refresh-report'))) {
    return new Response('Forbidden', { status: 403 });
  }
  let body = null;
  try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 2000) : '';
  if (!message) return Response.json({ error: 'message required' }, { status: 400 });
  if (!env.BOT_TOKEN || !env.ADMIN_ID) {
    return Response.json({ error: 'report not configured' }, { status: 503 });
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.ADMIN_ID, text: message }),
    });
    if (!r.ok) return Response.json({ ok: false }, { status: 502 });
    return Response.json({ ok: true });
  } catch (e) {
    console.error('[worker] refresh report send failed', e && e.message ? e.message : e);
    return Response.json({ ok: false }, { status: 502 });
  }
}

let bot = null;

async function getBot(env) {
  // دیتا اول تازه می‌شود (ensureRemote خودش TTL ده‌دقیقه‌ای و dedupe دارد)،
  // بعد ربات ساخته می‌شود؛ هندلرها state را با getter می‌خوانند، پس لود بعدی
  // هم بدون ساخت ربات تازه دیده می‌شود.
  await refreshStatic(env);
  if (bot) return bot;
  bot = createBot(
    { BOT_TOKEN: env.BOT_TOKEN, MINIAPP_URL: env.MINIAPP_URL, ADMIN_ID: env.ADMIN_ID, AI: env.AI, USERS: env.USERS },
    {
      isWorker: true,
      userStore: kvUserStore(env),
      sessionStore: kvSessionStore(env),
      recentLogs: async () => ({ note: 'لاگ‌ها در داشبورد Cloudflare دیده می‌شوند؛ در این ربات لاگ فایل نیست.' }),
      welcomePhoto: env.WELCOME_PHOTO_URL ? { kind: 'url', url: env.WELCOME_PHOTO_URL } : null,
      telegramClient: env.BOT_TOKEN ? new WorkerTelegram(env.BOT_TOKEN) : null,
      // دکمهٔ «بروزرسانی داده» در پنل مدیریت: ماشهٔ رفرش را می‌زند.
      // ماشهٔ رفرش از طریق service binding (همان اکانت) — فراخوانی مستقیم
      // workers.dev از داخل ورکر با خطای ۱۰۴۲ رد می‌شود، پس binding لازم است.
      triggerRefresh: async () => {
        try {
          const init = {
            method: 'POST',
            headers: { 'X-Trigger-Auth': env.TRIGGER_SECRET || '' },
          };
          const r = env.TRIGGER
            ? await env.TRIGGER.fetch('https://trigger/', init)
            : await fetch('https://mlbb-refresh-trigger.yahootattoo1.workers.dev/', init);
          return { ok: r.ok, status: r.status };
        } catch {
          return { ok: false, status: 0 };
        }
      },
    },
  );
  return bot;
}

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // دیتای تازهٔ KV — مینی‌اپ و اسکرپر؛ بدون احراز هویت برای خواندن، با HMAC برای نوشتن.
    if (url.pathname === '/data' || url.pathname.startsWith('/data/')) {
      return handleDataRoute(request, env);
    }

    // ترجمهٔ خودکار و هشدار خرابی — اسکریپت خودکار (VM یا GitHub Actions)، با HMAC.
    if (url.pathname === '/translate' && request.method === 'POST') {
      return handleTranslate(request, env);
    }
    if (url.pathname === '/alert' && request.method === 'POST') {
      return handleAlert(request, env);
    }
    if (url.pathname === '/refresh-report' && request.method === 'POST') {
      return handleRefreshReport(request, env);
    }
    if ((url.pathname === '/translate' || url.pathname === '/alert' || url.pathname === '/refresh-report') && request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // مربی هوش مصنوعی برای مینی‌اپ — POST {question, initData?} -> {answer} (CORS باز)
    // کاربر فقط از initData معتبر تلگرام خوانده می‌شود؛ بدون آن یا با initData
    // نامعتبر، درخواست ناشناس حساب می‌شود (سطل مشترک ۳ جوابه) — هرگز رد نمی‌شود
    // و شناسهٔ بدون امضا در بدنه اعتماد نمی‌شود.
    if (url.pathname === '/api/ask') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }
      if (request.method === 'POST') {
        let body = null;
        try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400, headers: CORS_HEADERS }); }
        const question = typeof body?.question === 'string' ? body.question.trim() : '';
        if (!question) return Response.json({ error: 'question required' }, { status: 400, headers: CORS_HEADERS });
        await refreshStatic(env);
        let userId = null;
        if (env.BOT_TOKEN && typeof body?.initData === 'string' && body.initData) {
          const checked = await validateInitData(body.initData, env.BOT_TOKEN);
          if (checked.ok) userId = checked.userId;
        }
        const answer = await askCoach(env, { kv: env.USERS }, question, userId);
        return Response.json({ answer }, { headers: CORS_HEADERS });
      }
      return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
    }

    if (request.method === 'POST' && url.pathname === '/webhook') {
      const secret = env.WEBHOOK_SECRET;
      if (secret) {
        const got = request.headers.get('x-telegram-bot-api-secret-token');
        if (got !== secret) return new Response('Forbidden', { status: 403 });
      }
      let update;
      try {
        update = await request.json();
      } catch {
        return new Response('Bad Request', { status: 400 });
      }
      try {
        const b = await getBot(env);
        if (!b) return new Response('Bot not configured', { status: 500 });
        await b.handleUpdate(update);
      } catch (e) {
        console.error('[worker] handleUpdate failed', e);
      }
      return new Response('OK', { status: 200 });
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      await refreshStatic(env);
      return Response.json({
        status: 'ok',
        mode: 'webhook',
        heroes: sd.heroes.length,
        items: sd.items.length,
        events: sd.events.length,
        data_ready: sd.isRemoteReady(),
        bot: env.BOT_TOKEN ? 'configured' : 'no-token',
      });
    }

    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('ربات Persian Mlbb — وبهوک تلگرام روی Cloudflare Workers.', {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};
