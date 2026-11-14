// مربی هوش مصنوعی MLBB — ماژول مشترک ربات (Node) و ورکر Cloudflare.
// فقط روی ورکر (env.AI = بایندینگ Workers AI) جواب واقعی می‌دهد؛ بدون آن،
///ask در ربات می‌گوید مربی فقط روی ورکر فعال است.
// خروجی askCoach همیشه یک رشتهٔ فارسی آمادهٔ نمایش است (پیام ثابت برای سقف و خطا).
const sd = require('./staticData');
const { faNum, pct, roleFa, laneFa } = require('./fa');

const COACH_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8';
const COACH_DAILY_CAP = 400;
const COACH_DEFAULT_LIMIT = 3;
const COACH_CAP_MSG = 'سهم امروز مربی تمام شد، فردا دوباره بپرس';
const COACH_UNAVAILABLE_MSG = 'مربی الان در دسترس نیست، کمی بعد دوباره بپرس';
const COACH_NO_AI_MSG = 'مربی فقط روی ورکر فعال است';
const COACH_MAX_QUESTION = 500;
const COACH_LIMIT_TTL = 48 * 3600; // شمارنده‌های روزانه بعد از ۴۸ ساعت منقضی می‌شوند

// پیام سقف روزانه برای یک کاربر — عدد سقف در پیام می‌آید (فارسی)
function coachUserCapMsg(limit) {
  return `سهم امروزت از مربی تمام شد (${faNum(limit)} جواب در روز). فردا دوباره بپرس.`;
}

// مدیر بودن: ADMIN_ID ممکن است چند شناسه با کاما باشد؛ مقایسه رشته‌ای
function coachIsAdmin(adminIdValue, userId) {
  if (userId === null || userId === undefined) return false;
  const ids = String(adminIdValue || '').split(',').map((s) => s.trim()).filter(Boolean);
  return ids.includes(String(userId));
}

function coachLimitKey(userId) { return `coach:limit:${userId}`; }
function coachUserKey(userId, dateStr) { return `coach:user:${userId}:${dateStr}`; }
function coachAnonKey(dateStr) { return `coach:anon:${dateStr}`; }
function coachGlobalKey(dateStr) { return `coach:${dateStr}`; }

// مقدار خام override را به سقف تبدیل می‌کند: 'inf' → نامحدود، عدد مثبت → همان، بقیه → پیش‌فرض ۳
function coachLimitFromOverride(raw) {
  if (raw === 'inf' || raw === 'Infinity') return 'inf';
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return COACH_DEFAULT_LIMIT;
}

// سقف یک کاربر را در KV می‌نویسد: عدد، 'inf' (نامحدود)، یا null برای برگشت به پیش‌فرض (حذف override)
async function setCoachLimit(kv, userId, limit) {
  if (!kv) return;
  const key = coachLimitKey(userId);
  try {
    if (limit === null || limit === undefined) {
      if (typeof kv.delete === 'function') await kv.delete(key);
      else await kv.put(key, '');
    } else {
      await kv.put(key, limit === 'inf' ? 'inf' : String(limit));
    }
  } catch { /* ذخیره نشد */ }
}

// مصرف امروز یک کاربر برای پنل مدیریت: { used, limit, unlimited, hasOverride }
// used = جواب‌های امروز؛ limit = عدد یا 'inf'؛ مدیر همیشه unlimited است؛
// hasOverride = آیا کلید coach:limit برای او ست شده است.
async function getCoachUsage(adminIdValue, kv, userId) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const id = userId === null || userId === undefined ? null : String(userId);
  if (!kv || id === null) return { used: 0, limit: COACH_DEFAULT_LIMIT, unlimited: false, hasOverride: false };
  const isAdmin = coachIsAdmin(adminIdValue, id);
  try {
    const rawCount = await kv.get(coachUserKey(id, dateStr));
    const used = Number(rawCount) || 0;
    if (isAdmin) return { used, limit: 'inf', unlimited: true, hasOverride: false };
    const rawLimit = await kv.get(coachLimitKey(id));
    const hasOverride = rawLimit !== null && rawLimit !== undefined && rawLimit !== '';
    return { used, limit: coachLimitFromOverride(rawLimit), unlimited: false, hasOverride };
  } catch { return { used: 0, limit: COACH_DEFAULT_LIMIT, unlimited: false, hasOverride: false }; }
}

// askCoach(env, deps, question, userId) -> رشتهٔ فارسی جواب.
// env: { AI, ADMIN_ID } — بایندینگ Workers AI (روی ورکر) + شناسهٔ مدیر.
// deps: { kv } — KV برای شمارنده‌ها (روی ورکر: env.USERS؛ در تست: استاب Mapای).
// userId: شناسهٔ تلگرام کاربر؛ null/undefined = ناشناس (مینی‌اپ بدون initData معتبر).
// سقف‌ها: پیش‌فرض ۳ جواب در روز برای هر کاربر (override با coach:limit:<id> یا 'inf')؛
// مدیر نامحدود است (سقف کاربری و سقف سراسری ۴۰۰ او را نمی‌گیرد، ولی شمارندهٔ سراسری
// برای حساب بودجه زیاد می‌شود). ناشناس یک سطل مشترک ۳ جوابه در روز دارد.
// بدون AI پیام ثابت برمی‌گردد.
async function askCoach(env, deps, question, userId) {
  const ai = env && env.AI;
  if (!ai || typeof ai.run !== 'function') return COACH_NO_AI_MSG;
  const q = String(question || '').trim().slice(0, COACH_MAX_QUESTION);
  if (!q) return '';
  const kv = deps && deps.kv;
  const dateStr = new Date().toISOString().slice(0, 10);
  const id = userId === null || userId === undefined ? null : String(userId);
  const isAdmin = coachIsAdmin(env && env.ADMIN_ID, id);
  const userKey = id === null ? coachAnonKey(dateStr) : coachUserKey(id, dateStr);
  const globalKey = coachGlobalKey(dateStr);
  let userCount = 0;
  let globalCount = 0;
  let limit = COACH_DEFAULT_LIMIT;
  if (kv) {
    try {
      const rawUser = await kv.get(userKey);
      userCount = Number(rawUser) || 0;
    } catch { userCount = 0; }
    try {
      const rawGlobal = await kv.get(globalKey);
      globalCount = Number(rawGlobal) || 0;
    } catch { globalCount = 0; }
    if (!isAdmin) {
      if (id !== null) {
        try {
          const rawLimit = await kv.get(coachLimitKey(id));
          limit = coachLimitFromOverride(rawLimit);
        } catch { limit = COACH_DEFAULT_LIMIT; }
      }
      if (limit !== 'inf' && userCount >= limit) return coachUserCapMsg(limit);
      if (globalCount >= COACH_DAILY_CAP) return COACH_CAP_MSG;
    }
  }
  const heroes = detectHeroes(q);
  const grounding = heroes.length
    ? heroes.map(heroGrounding).join('\n\n')
    : topMetaGrounding();
  const userText = `سؤال: ${q}` + (grounding ? `\n\nداده‌های مربوط:\n${grounding}` : '');
  try {
    const res = await ai.run(COACH_MODEL, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userText },
      ],
      temperature: 0.3,
      max_tokens: 400,
    });
    const answer = res && typeof res.response === 'string' ? res.response.trim() : '';
    if (!answer) throw new Error('empty model response');
    if (kv) {
      try {
        await kv.put(userKey, String(userCount + 1), { expirationTtl: COACH_LIMIT_TTL });
      } catch { /* شمارنده ذخیره نشد — جواب را داریم */ }
      try {
        await kv.put(globalKey, String(globalCount + 1), { expirationTtl: COACH_LIMIT_TTL });
      } catch { /* شمارنده ذخیره نشد — جواب را داریم */ }
    }
    return answer;
  } catch (e) {
    try { console.error('[coach] ai.run failed', e && e.message ? e.message : e); } catch { /* ignore */ }
    return COACH_UNAVAILABLE_MSG;
  }
}

module.exports = { askCoach, detectHeroes, coachIsAdmin, coachUserCapMsg, coachLimitFromOverride, getCoachUsage, setCoachLimit, COACH_MODEL, COACH_DAILY_CAP, COACH_DEFAULT_LIMIT, COACH_CAP_MSG, COACH_UNAVAILABLE_MSG, COACH_NO_AI_MSG };

const SYSTEM_PROMPT = 'تو «مربی هوش مصنوعی» ربات Persian MLBB هستی. فقط به فارسی جواب بده؛ کوتاه و کاربردی (حداکثر حدود ۳۰۰ کلمه). برای هر واقعیتی دربارهٔ هیروها، آیتم‌ها، بیلد، کانتر و متا فقط از داده‌هایی که در پیام کاربر داده شده استفاده کن؛ هیچ عدد، بیلد یا کانتری را از خودت نساز و اگر داده‌ای نداری، بگو نمی‌دانی. اگر سؤال ربطی به موبایل لجندز ندارد، خیلی کوتاه بگو فقط دربارهٔ این بازی جواب می‌دهی. هیچ‌وقت از منبع داده حرف نزن و هیچ لینکی نده.';

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// تشخیص هیروها در متن سؤال (نام انگلیسی هیرو، بدون حساسیت به بزرگی/کوچکی).
// نام تک‌کلمه‌ای باید کلمه‌ای جدا باشد (تا «Sun» داخل «Sunday» گیر نکند)؛
// نام چندکلمه‌ای («Yu Zhong»، «Popol and Kupa»، «Chang\'e») به‌صورت عبارت
// در متن جست‌وجو می‌شود. حداکثر ۲ هیرو برمی‌گردد.
function detectHeroes(question) {
  const qKey = String(question || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!qKey) return [];
  const tokens = qKey.split(' ').filter(Boolean);
  const found = [];
  for (const h of sd.heroes || []) {
    const nameKey = String(h.hero_name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!nameKey) continue;
    const hit = nameKey.includes(' ') ? qKey.includes(nameKey) : tokens.includes(nameKey);
    if (hit) found.push(h);
    if (found.length >= 2) break;
  }
  return found;
}

// بلوک دادهٔ یک هیرو برای تزریق به پرامپت (فقط دادهٔ واقعی خود ربات)
function heroGrounding(hero) {
  const lines = [`هیرو: ${hero.hero_name}`];
  if (hero.class) lines.push(`نقش: ${hero.class} (${roleFa(hero.class)})`);
  if (hero.laning && hero.laning.length) lines.push(`لین: ${laneFa(hero.laning)}`);
  const st = sd.statByName(hero.hero_name);
  if (st) {
    lines.push(`آمار ۷ روز اخیر: رتبهٔ ${faNum(st.position)} از ۱۳۳ — وین‌ریت ${pct(st.win_rate)} — پیک ${pct(st.pick_rate)} — بن ${pct(st.ban_rate)}`);
  }
  const fb = (sd.fullBuilds || {})[String(hero.mlid)];
  if (fb && (fb.items || []).length) {
    let b = `بیلد ۶ آیتمی: ${(fb.items || []).join('، ')}`;
    if (fb.spell) b += ` — اسپل: ${fb.spell}`;
    if (fb.emblem) b += ` — امبلم: ${fb.emblem}${(fb.emblem_talents || []).length ? ` (${fb.emblem_talents.join('، ')})` : ''}`;
    lines.push(b);
  }
  const mu = sd.matchupById(Number(hero.mlid));
  if (mu) {
    if ((mu.countered_by || []).length) {
      lines.push(`بهترین کانترهای ${hero.hero_name}: ` + mu.countered_by.slice(0, 3).map((c) => `${c.name}${c.strength_fa ? ` (${c.strength_fa})` : ''}${c.reason_fa ? ` — ${c.reason_fa}` : ''}`).join('؛ '));
    }
    if ((mu.counters || []).length) {
      lines.push(`${hero.hero_name} این هیروها را کانتر می‌کند: ` + mu.counters.slice(0, 3).map((c) => c.name).join('، '));
    }
  }
  return lines.join('\n');
}

// وقتی هیرویی در سؤال نیست: ۵ هیروی برتر متا (۷ روز اخیر)
function topMetaGrounding() {
  const top = [...(sd.heroStats || [])]
    .filter((s) => s && Number.isFinite(Number(s.win_rate)))
    .sort((a, b) => Number(b.win_rate) - Number(a.win_rate))
    .slice(0, 5);
  if (!top.length) return '';
  return '۵ هیروی برتر متا (۷ روز اخیر، بر اساس وین‌ریت): ' + top.map((s) => `${s.name} ${pct(s.win_rate)}`).join('، ');
}

