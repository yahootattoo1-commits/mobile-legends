// مربی هوش مصنوعی MLBB — ماژول مشترک ربات (Node) و ورکر Cloudflare.
// فقط روی ورکر (env.AI = بایندینگ Workers AI) جواب واقعی می‌دهد؛ بدون آن،
///ask در ربات می‌گوید مربی فقط روی ورکر فعال است.
// خروجی askCoach همیشه یک رشتهٔ فارسی آمادهٔ نمایش است (پیام ثابت برای سقف و خطا).
const sd = require('./staticData');
const { faNum, pct, roleFa, laneFa } = require('./fa');

const COACH_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8';
const COACH_DAILY_CAP = 400;
const COACH_CAP_MSG = 'سهم امروز مربی تمام شد، فردا دوباره بپرس';
const COACH_UNAVAILABLE_MSG = 'مربی الان در دسترس نیست، کمی بعد دوباره بپرس';
const COACH_NO_AI_MSG = 'مربی فقط روی ورکر فعال است';
const COACH_MAX_QUESTION = 500;

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

// askCoach(env, deps, question) -> رشتهٔ فارسی جواب.
// env: { AI } — بایندینگ Workers AI (روی ورکر). deps: { kv } — KV برای شمارندهٔ روزانه
// (روی ورکر: env.USERS؛ در تست: استاب Mapای). بدون AI پیام ثابت برمی‌گردد.
async function askCoach(env, deps, question) {
  const ai = env && env.AI;
  if (!ai || typeof ai.run !== 'function') return COACH_NO_AI_MSG;
  const q = String(question || '').trim().slice(0, COACH_MAX_QUESTION);
  if (!q) return '';
  const kv = deps && deps.kv;
  const key = 'coach:' + new Date().toISOString().slice(0, 10); // تاریخ UTC
  let count = 0;
  if (kv) {
    try {
      const raw = await kv.get(key);
      count = Number(raw) || 0;
    } catch { count = 0; }
    if (count >= COACH_DAILY_CAP) return COACH_CAP_MSG;
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
        await kv.put(key, String(count + 1), { expirationTtl: 48 * 3600 });
      } catch { /* شمارنده ذخیره نشد — جواب را داریم */ }
    }
    return answer;
  } catch (e) {
    try { console.error('[coach] ai.run failed', e && e.message ? e.message : e); } catch { /* ignore */ }
    return COACH_UNAVAILABLE_MSG;
  }
}

module.exports = { askCoach, detectHeroes, COACH_MODEL, COACH_DAILY_CAP, COACH_CAP_MSG, COACH_UNAVAILABLE_MSG, COACH_NO_AI_MSG };
