// ربات تلگرام MLBB — Telegraf با polling
// همهٔ متن‌ها فارسی و راست‌چین؛ فوتر منبع داده در همهٔ پاسخ‌ها
const { Telegraf, Markup } = require('telegraf');
const { roneGet, ronePost, clearCache, normRankRecord, normCounterRecord, normBuildRecord, normStanding, equipNameMap } = require('./rone');
const sd = require('./staticData');
const { faNum, faInt, pct, esc, FOOTER, cleanText, truncate, ROLES, roleFa, laneFa } = require('./fa');
const { askCoach, getCoachUsage, setCoachLimit, coachUserCapMsg, getAiUsage, AI_DAILY_NEURON_BUDGET, NEURONS_PER_TOKEN, COACH_DAILY_CAP, COACH_MODEL } = require('./coach');

function normName(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

const LANES = [
  { v: 'exp', fa: '🛡️ اکس‌پی (EXP)' },
  { v: 'mid', fa: '🔮 مید (Mid)' },
  { v: 'gold', fa: '🏹 گلد (Gold)' },
  { v: 'roam', fa: '🚶 روم (Roam)' },
  { v: 'jungle', fa: '🌿 جانگل (Jungle)' },
];
const LEAGUES = [
  { v: 'id', fa: '🇮🇩 MPL اندونزی (ID)' },
  { v: 'ph', fa: '🇵🇭 MPL فیلیپین (PH)' },
  { v: 'my', fa: '🇲🇾 MPL مالزی (MY)' },
  { v: 'kh', fa: '🇰🇭 MPL کامبوج (KH)' },
];
// تاریخ میلادی به فارسی (مثلاً «۱۱ نوامبر ۲۰۲۶») و نام ماه («November 2026» → «نوامبر ۲۰۲۶»)
const MONTH_FA = ['ژانویه', 'فوریه', 'مارس', 'آوریل', 'مه', 'ژوئن', 'ژوئیه', 'اوت', 'سپتامبر', 'اکتبر', 'نوامبر', 'دسامبر'];
function dateFa(iso) { const d = new Date(iso); if (isNaN(d.getTime())) return ''; return `${faNum(d.getUTCDate())} ${MONTH_FA[d.getUTCMonth()]} ${faNum(d.getUTCFullYear())}`; }
function monthFa(m) { const [name, year] = String(m || '').split(' '); const i = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].indexOf(name); return (i >= 0 ? MONTH_FA[i] : name) + (year ? ' ' + faNum(year) : ''); }

// تاریخ ISO را به «۲۱ نوامبر، ساعت ۲۱:۱۴» به وقت تهران تبدیل می‌کند.
function tehranDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const t = new Date(d.getTime() + (3 * 60 + 30) * 60000);
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  return `${faNum(t.getUTCDate())} ${MONTH_FA[t.getUTCMonth()]}، ساعت ${faNum(hh)}:${faNum(mm)}`;
}


// ---------- استورها ----------
// پیش‌فرض Node: کاربران در logs/users.json روی دیسک، سشن‌ها در حافظه.
// روی Workers با deps جایگزین می‌شوند (KV) و این توابع هرگز صدا نمی‌خورند —
// پس requireهای fs/path هم فقط داخل همین توابع‌اند و باندل Worker را آلوده نمی‌کنند.
function nodeUserStore() {
  let users = null; // Map — دیرلود، یک بار
  return {
    async loadAll() {
      if (users) return users;
      users = new Map();
      try {
        const fs = require('fs');
        const path = require('path');
        const arr = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'logs', 'users.json'), 'utf8'));
        for (const u of (Array.isArray(arr) ? arr : [])) if (u?.id) users.set(String(u.id), u);
      } catch { /* اولین اجرا — هنوز کاربری نیست */ }
      return users;
    },
    async persist(map) {
      users = map;
      try {
        const fs = require('fs');
        const path = require('path');
        const file = path.join(__dirname, '..', 'logs', 'users.json');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify([...map.values()], null, 1));
      } catch { /* ذخیره نشد — شمارش در حافظه می‌ماند */ }
    },
  };
}
function nodeSessionStore() {
  const playerSessions = new Map(); // chatId -> { step, gameId, zoneId, jwt }
  const adminBroadcasts = new Map(); // chatId -> { step, text } — پیش‌نویس پیام همگانی در انتظار تایید
  const counterTeamPicks = new Map(); // chatId -> { heroes: [mlid, ...] } — انتخاب تیم حریف برای کانتر تیمی
  const wrPicks = new Map(); // chatId -> { m, now, tgt } — مراحل ماشین وین‌ریت
  const maps = { player: playerSessions, broadcast: adminBroadcasts, counterTeam: counterTeamPicks, wrPick: wrPicks };
  return {
    async get(kind, chatId) { return (maps[kind] && maps[kind].get(chatId)) || null; },
    async set(kind, chatId, value) { if (maps[kind]) maps[kind].set(chatId, value); },
    async delete(kind, chatId) { if (maps[kind]) maps[kind].delete(chatId); },
    _playerSessions: playerSessions,
    _adminBroadcasts: adminBroadcasts,
    _counterTeamPicks: counterTeamPicks,
    _wrPicks: wrPicks,
  };
}
function nodeRecentLogs() {
  try {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(path.join(__dirname, '..', 'logs', 'bot.log'), 'utf8').trim().split('\n').slice(-10);
  } catch { return null; }
}
// عکس خوشامد Node: فایل assets/welcome.jpg (وگرنه logo.jpg) — اگر نبود، null
function nodeWelcomePhoto() {
  try {
    const fs = require('fs');
    const path = require('path');
    const p = [path.join(__dirname, '..', 'assets', 'welcome.jpg'), path.join(__dirname, '..', 'assets', 'logo.jpg')].find((x) => fs.existsSync(x));
    return p ? { kind: 'file', path: p } : null;
  } catch { return null; }
}
const defaultSessionStore = nodeSessionStore();


async function getRankList(days = 7, size = 10) {
  // size=140 یکجا همهٔ هیروها را می‌دهد؛ اگر API قبول نکرد با ۱۰۰ برمی‌گردیم
  let r = await roneGet(`/heroes/rank?days=${days}&size=140&index=1`);
  if (!r.ok) r = await roneGet(`/heroes/rank?days=${days}&size=100&index=1`);
  if (!r.ok) return r;
  const all = r.records.map(normRankRecord).filter((x) => x.id != null);
  return { ok: true, all };
}

async function heroHead(id) {
  const r = await roneGet(`/heroes/${id}`);
  if (!r.ok) return null;
  const rec = r.records[0];
  return rec?.data?.hero?.data?.head || rec?.data?.data?.hero?.data?.head || null;
}

function heroNotFoundText(query, suggestions) {
  let t = `❌ هیرویی با نام «${query}» پیدا نشد.`;
  if (suggestions && suggestions.length) {
    t += '\n\nشاید منظورت این‌هاست:\n' + suggestions.map((h) => `• ${h.hero_name}`).join('\n');
  }
  t += '\n\nاز دکمه‌های زیر هیرو را انتخاب کن.';
  return t + FOOTER;
}

// اگر HTTPS_PROXY ست شده (مثلاً در VM میزبان که خروج مستقیم بسته است)،
 // Telegraf باید از همان پروکسی رد شود — node-fetchِ Telegraf خودش
 // متغیرهای پروکسی را نمی‌خواند. در WispByte پروکسی نیست و agent خالی می‌ماند.
function telegramProxyAgent() {
  const proxy = (typeof process !== 'undefined' && process.env && (process.env.HTTPS_PROXY || process.env.https_proxy)) || '';
  if (!proxy) return undefined;
  try {
    const { HttpsProxyAgent } = require('hpagent');
    return new HttpsProxyAgent({ proxy });
  } catch {
    return undefined;
  }
}

// createBot(env, deps) — بدون آرگومان = رفتار امروز (process.env + fs)؛
// روی Workers با env/debs صریح صدا می‌شود و هیچ ارجاعی به process یا fs ندارد.
// env: { BOT_TOKEN, MINIAPP_URL, ADMIN_ID } — اولویت با env است، بعد process.env.
// deps: { isWorker, userStore, sessionStore, recentLogs, welcomePhoto, telegramClient, triggerRefresh }
//   triggerRefresh: () -> { ok, status } — fires the refresh (Workers only);
//     when absent (VM bot) the admin button only clears the cache.
//   userStore: { loadAll() -> Map, persist(map) } — Node: logs/users.json؛ Workers: KV کلید 'users'
//   sessionStore: { get/set/delete(kind, chatId) } — kind: 'player' | 'broadcast'
//   recentLogs: () -> { lines: [...] } | { note: '...' } | null
//   welcomePhoto: { kind: 'file', path } | { kind: 'url', url } | null
//   telegramClient: نمونهٔ Telegram سفارشی (روی Workers: WorkerTelegram با fetch سراسری)
function createBot(env, deps) {
  env = env || {};
  deps = deps || {};
  const envOf = (k) => (env[k] !== undefined && env[k] !== null && env[k] !== '' ? env[k] : (typeof process !== 'undefined' && process.env ? process.env[k] : undefined));
  const token = envOf('BOT_TOKEN') || '';
  if (!token) {
    console.log('[bot] BOT_TOKEN تنظیم نشده — ربات راه‌اندازی نمی‌شود، فقط سرور وب بالا می‌آید.');
    return null;
  }
  const miniappUrl = envOf('MINIAPP_URL') || '';
  // شناسهٔ عددی مدیرها از ADMIN_ID (با کاما جدا می‌شود) — هرگز در ریپوی عمومی نمی‌آید.
  const adminIds = new Set(String(envOf('ADMIN_ID') || '').split(',').map((s) => s.trim()).filter(Boolean));
  const isWorker = !!deps.isWorker;
  const userStore = deps.userStore || nodeUserStore();
  const sessionStore = deps.sessionStore || defaultSessionStore;
  const recentLogsFn = deps.recentLogs || (async () => ({ lines: nodeRecentLogs() }));
  const welcomePhoto = deps.welcomePhoto !== undefined ? deps.welcomePhoto : nodeWelcomePhoto();
  // مربی هوش مصنوعی: بایندینگ Workers AI روی ورکر (env.AI)؛ در Node نیست مگر استاب تست
  const coachAI = (env && env.AI) || deps.coachAI || null;
  const coachKV = (env && env.USERS) || deps.coachKV || null;
  const dataKV = (env && env.DATA) || null;
  const bootTime = new Date();
  const agent = telegramProxyAgent();
  const bot = new Telegraf(token, agent ? { telegram: { agent, attachmentAgent: agent } } : {});
  if (deps.telegramClient) bot.telegram = deps.telegramClient;
  console.log('[bot] admin:', adminIds.size > 0 ? 'configured' : 'not configured');

  const isAdmin = (ctx) => !!ctx?.from && adminIds.has(String(ctx.from.id));
  function requireAdmin(ctx) {
    if (isAdmin(ctx)) return true;
    ctx.replyWithHTML('⛔ این بخش فقط برای مدیر ربات است.' + FOOTER).catch(() => {});
    return false;
  }

  // کاربران ربات — برای شمارش و پیام همگانی
  let usersCache = null;
  async function getUsers() {
    if (!usersCache) usersCache = await userStore.loadAll();
    return usersCache;
  }
  async function trackUser(ctx) {
    const from = ctx?.from;
    if (!from) return;
    const users = await getUsers();
    const id = String(from.id);
    const now = new Date().toISOString();
    const prev = users.get(id);
    if (!prev) {
      users.set(id, { id, name: [from.first_name, from.last_name].filter(Boolean).join(' ') || '', username: from.username || '', firstSeen: now, lastSeen: now });
      await userStore.persist(users);
    } else {
      prev.lastSeen = now;
      if (from.username && prev.username !== from.username) { prev.username = from.username; await userStore.persist(users); }
    }
  }

  function webAppButton() {
    if (!miniappUrl) return null;
    return Markup.button.webApp('🎮 باز کردن مینی‌اپ', miniappUrl);
  }

  // رنگ هر بخش در منو — دکمه‌های تلگرام رنگ پس‌زمینه نمی‌گیرند، پس دایرهٔ رنگی
  function mainMenuKeyboard(isAdminUser = false) {
    const rows = [
      [Markup.button.callback('🦸 هیروها', 'menu_heroes'), Markup.button.callback('📊 متا', 'menu_meta')],
      [Markup.button.callback('⚔️ کانتر', 'menu_counter'), Markup.button.callback('🛠️ بیلد', 'menu_build')],
      [Markup.button.callback('🧰 آیتم‌ها', 'menu_items'), Markup.button.callback('🛡️ امبلم‌ها', 'menu_emblems')],
      [Markup.button.callback('🧮 ماشین وین‌ریت', 'menu_wr'), Markup.button.callback('🏆 MPL', 'menu_mpl')],
      [Markup.button.callback('📰 اخبار', 'menu_news'), Markup.button.callback('🏆 تیرلیست', 'menu_tier')],
      [Markup.button.callback('👥 ترکیب تیمی', 'menu_comps'), Markup.button.callback('📖 داستان‌ها', 'menu_lore')],
      [Markup.button.callback('📝 پچ‌نوت‌ها', 'menu_patch')],
      [Markup.button.callback('🧠 مربی هوش مصنوعی', 'coach')],
    ];
    if (isAdminUser) rows.push([Markup.button.callback('🛠️ پنل مدیریت', 'menu_admin')]);
    const wa = webAppButton();
    if (wa) rows.unshift([wa]);
    return Markup.inlineKeyboard(rows);
  }

  const helpText = `🤖 <b>راهنمای ربات MLBB</b>

همهٔ بخش‌ها با دکمه‌ها در دسترس‌اند — فقط بزن و انتخاب کن، چیزی لازم نیست بنویسی:

🦸 <b>هیروها</b> — لیست ۱۳۳ هیرو بر اساس نقش؛ روی هر هیرو بزن تا اطلاعات، اسکیل‌ها و وین‌ریت زنده‌اش را ببینی
📊 <b>متا</b> — برترین هیروهای متا در ۷ روز اخیر
⚔️ <b>کانتر</b> — بهترین کانتر برای یک هیرو، یا برای کل تیم حریف (۲ تا ۵ هیرو)
🛠️ <b>بیلد</b> — بیلد پیشنهادی (۶ آیتم) + بیلد هر لین
🧰 <b>آیتم‌ها</b> — همهٔ آیتم‌ها بر اساس دسته؛ روی هر آیتم بزن تا جزییاتش را ببینی
🛡️ <b>امبلم‌ها</b> — ۷ امبلم و ۱۲ اسپل؛ روی هر کدام بزن تا جزییاتش را ببینی
🧮 <b>ماشین وین‌ریت</b> — چند برد پشت سر هم لازم است تا به وین‌ریت هدفت برسی؟
🏆 <b>MPL</b> — جدول لیگ‌های اندونزی، فیلیپین، مالزی و کامبوج
📰 <b>اخبار</b> — اخبار، ایونت‌ها و گفتگوهای تازه
🏆 <b>تیرلیست</b> — رتبه‌بندی هیروها
👥 <b>ترکیب تیمی</b> — ترکیب‌های پیشنهادی + راهنما
📖 <b>داستان‌ها</b> — داستان کامل هر هیرو به فارسی
📝 <b>پچ‌نوت‌ها</b> — متن کامل پچ‌ها به فارسی
🧠 <b>مربی هوش مصنوعی</b> — سؤالت را همین‌جا بنویس؛ بدون دستور، فقط سؤال را بنویس (روزانه ۳ جواب برای هر کاربر)
🎮 <b>مینی‌اپ</b> — با دکمهٔ «باز کردن مینی‌اپ» در /start باز می‌شود

👤 اتصال پروفایل بازی با دستور /player انجام می‌شود (Game ID و کد تایید داخل بازی را خودت می‌نویسی)؛ برای لغو /cancel.

🏠 با دکمهٔ «منوی اصلی» همیشه می‌توانی به اول برگردی.` + FOOTER;

  // ---------- کمک‌کننده‌های منوی دکمه‌ای ----------
  function homeKeyboard() {
    return Markup.inlineKeyboard([[Markup.button.callback('🏠 منوی اصلی', 'menu_home')]]);
  }
  async function sendMainMenu(ctx) {
    return ctx.replyWithHTML('🏠 <b>منوی اصلی</b>\n\nیکی را انتخاب کن:' + FOOTER, mainMenuKeyboard(isAdmin(ctx)));
  }
  function heroDetailKeyboard(id) {
    return Markup.inlineKeyboard([
      [Markup.button.callback('⚔️ کانتر', `hero:counter:${id}`), Markup.button.callback('🛠️ بیلد', `hero:build:${id}`)],
      [Markup.button.callback('📖 داستان', `hero:lore:${id}`), Markup.button.callback('🏠 منوی اصلی', 'menu_home')],
    ]);
  }
  // انتخاب‌کنندهٔ هیرو بر اساس هدف: heroes | build | counter | counterTeam | lore
  function rolePickerKeyboard(purpose) {
    const rows = sd.heroesByRole().map((g) => [Markup.button.callback(`${g.emoji} ${g.en} (${faNum(g.count)})`, `pick:${purpose}:role:${g.en}`)]);
    rows.push([Markup.button.callback('🏠 منوی اصلی', 'menu_home')]);
    return Markup.inlineKeyboard(rows);
  }
  function heroPickerKeyboard(purpose, roleEn) {
    const g = sd.heroesByRole().find((x) => x.en === roleEn);
    if (!g) return null;
    const rows = [];
    for (let i = 0; i < g.heroes.length; i += 2) {
      rows.push(g.heroes.slice(i, i + 2).map((h) => Markup.button.callback(h.name, `pick:${purpose}:hero:${h.id}`)));
    }
    rows.push([Markup.button.callback('← نقش‌ها', `pick:${purpose}:roles`)]);
    rows.push([Markup.button.callback('🏠 منوی اصلی', 'menu_home')]);
    return Markup.inlineKeyboard(rows);
  }
  // ---------- کانتر: انتخاب تک‌هیرو یا تیم حریف ----------
  function counterModeKeyboard() {
    return Markup.inlineKeyboard([
      [Markup.button.callback('⚔️ یک هیرو', 'counter:mode:single')],
      [Markup.button.callback('🛡️ تیم حریف (۲ تا ۵ هیرو)', 'counter:mode:team')],
      [Markup.button.callback('🏠 منوی اصلی', 'menu_home')],
    ]);
  }
  async function sendCounterMode(ctx) {
    return ctx.replyWithHTML('⚔️ <b>کانتر</b>\n\nمی‌خواهی کانتر یک هیرو را ببینی یا کانتر کل تیم حریف را؟' + FOOTER, counterModeKeyboard());
  }
  async function sendCounterPicks(ctx) {
    const picks = (await sessionStore.get('counterTeam', ctx.chat.id)) || { heroes: [] };
    const names = picks.heroes.map((id) => sd.heroById(id)?.hero_name).filter(Boolean);
    const t = `🛡️ <b>تیم حریف</b>\n\nانتخاب شده: ${names.length ? names.map((n) => `<b>${esc(n)}</b>`).join('، ') : '—'} (${faNum(names.length)} هیرو)\n\nهیروهای تیم حریف را یکی‌یکی انتخاب کن (۲ تا ۵ هیرو).` + FOOTER;
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('➕ اضافه کردن هیروی دیگر', 'counter:addmore')],
      [Markup.button.callback('✅ محاسبه', 'counter:calc'), Markup.button.callback('❌ پاک‌کردن', 'counter:clear')],
      [Markup.button.callback('🏠 منوی اصلی', 'menu_home')],
    ]);
    return ctx.replyWithHTML(t, kb);
  }
  async function pickCounterTeamHero(ctx, hero) {
    const st = (await sessionStore.get('counterTeam', ctx.chat.id)) || { heroes: [] };
    const id = Number(hero.mlid);
    if (st.heroes.includes(id)) {
      await ctx.answerCbQuery('این هیرو قبلاً انتخاب شده است');
      return sendCounterPicks(ctx);
    }
    if (st.heroes.length >= 5) {
      await ctx.answerCbQuery('حداکثر ۵ هیرو');
      return sendCounterPicks(ctx);
    }
    st.heroes.push(id);
    await sessionStore.set('counterTeam', ctx.chat.id, st);
    await ctx.answerCbQuery();
    return sendCounterPicks(ctx);
  }
  // ---------- ماشین وین‌ریت: انتخاب سه‌مرحله‌ای با دکمه ----------
  const WR_MATCHES = [50, 100, 200, 300, 500, 1000];
  const WR_RATES = [40, 45, 50, 55, 60, 65, 70];
  const WR_TARGETS = [55, 60, 65, 70, 75, 80];
  function wrStepKeyboard(step) {
    const values = step === 'm' ? WR_MATCHES : step === 'now' ? WR_RATES : WR_TARGETS;
    const prefix = step === 'm' ? 'wr:m' : step === 'now' ? 'wr:now' : 'wr:tgt';
    const rows = [];
    for (let i = 0; i < values.length; i += 2) {
      rows.push(values.slice(i, i + 2).map((v) => Markup.button.callback(`${step === 'm' ? faNum(v) : `${faNum(v)}٪`}`, `${prefix}:${v}`)));
    }
    rows.push([Markup.button.callback('🏠 منوی اصلی', 'menu_home')]);
    return Markup.inlineKeyboard(rows);
  }
  function wrResultText(m, now, fut, n) {
    return `🧮 <b>ماشین‌حساب وین‌ریت</b>\n\nمچ فعلی: ${faInt(m)}\nوین‌ریت فعلی: ${pct(now)}\nهدف: ${pct(fut)}\n\n✅ برای رسیدن به ${pct(fut)} باید <b>${faInt(n)} برد پشت سر هم</b> بدون باخت بگیری.`;
  }
  async function sendWrStep(ctx, step) {
    const st = (await sessionStore.get('wrPick', ctx.chat.id)) || {};
    if (step === 'm') {
      return ctx.replyWithHTML('🧮 <b>ماشین‌حساب وین‌ریت</b>\n\nمچ فعلی چند تاست؟' + FOOTER, wrStepKeyboard('m'));
    }
    if (step === 'now') {
      return ctx.replyWithHTML(`🧮 <b>ماشین‌حساب وین‌ریت</b>\n\nمچ فعلی: ${faInt(st.m)}\n\nوین‌ریت فعلی چند درصد است؟` + FOOTER, wrStepKeyboard('now'));
    }
    return ctx.replyWithHTML(`🧮 <b>ماشین‌حساب وین‌ریت</b>\n\nمچ فعلی: ${faInt(st.m)} — وین‌ریت فعلی: ${pct(st.now)}\n\nهدف چند درصد است؟` + FOOTER, wrStepKeyboard('tgt'));
  }

  // ثبت هر کاربری که با ربات حرف می‌زند (برای شمارش و پیام همگانی)
  bot.use(async (ctx, next) => { await trackUser(ctx); return next(); });

  bot.start(async (ctx) => {
    const kb = mainMenuKeyboard(isAdmin(ctx));
    const waNote = miniappUrl
      ? '🎮 با دکمهٔ زیر مینی‌اپ فارسی را باز کن:'
      : '⚠️ مینی‌اپ هنوز روی هاست HTTPS تنظیم نشده است (MINIAPP_URL خالی است) — دستورهای زیر بدون مینی‌اپ هم کار می‌کنند.';
    const caption =
      `👋 سلام! به <b>Persian Mlbb</b> خوش آمدی.\n\nربات فارسی Mobile Legends: Bang Bang — همه‌چیز با دادهٔ زنده:\n\n🦸 <b>هیروها و متا</b> — همهٔ هیروها و برترین‌های متا\n⚔️ <b>کانتر و بیلد</b> — کانتر حریف و بهترین بیلد\n🧰 <b>آیتم‌ها و امبلم‌ها</b> — همهٔ آیتم‌ها، امبلم‌ها و اسپل‌ها\n🧮 <b>وین‌ریت و MPL</b> — ماشین وین‌ریت و جدول لیگ‌ها\n📰 <b>اخبار و پچ</b> — تازه‌ترین اخبار و پچ‌نوت‌ها\n🏆 <b>تیرلیست و ترکیب تیمی</b> — رتبه‌بندی و بهترین ترکیب‌ها\n📖 <b>داستان‌ها و مینی‌اپ</b> — داستان هیروها و مینی‌اپ فارسی\n🧠 <b>مربی</b> — سؤالت را همین‌جا بنویس، جواب مربی می‌گیری\n\n${waNote}\n\nبرای راهنما: /help\n\n🤖 لینک ربات: https://t.me/Mlbb_Baz_bot` +
      (isAdmin(ctx) ? '\n\n🛠️ تو مدیر ربات هستی — /admin برای پنل مدیریت.' : '') + FOOTER;
    // پیام ورود با عکس خوشامد — Node: فایل assets/welcome.jpg (وگرنه logo.jpg)؛ Workers: URL عمومی
    if (welcomePhoto) {
      try {
        if (welcomePhoto.kind === 'url') await ctx.replyWithPhoto(welcomePhoto.url, { caption, parse_mode: 'HTML', ...kb });
        else await ctx.replyWithPhoto({ source: welcomePhoto.path }, { caption, parse_mode: 'HTML', ...kb });
        return;
      } catch { /* بدون عکس ادامه بده */ }
    }
    await ctx.replyWithHTML(caption, kb);
  });

  bot.help((ctx) => ctx.replyWithHTML(helpText));

  // ---------- /hero ----------
  async function sendHeroDetail(ctx, hero) {
    const id = Number(hero.mlid);
    const rankRes = await getRankList(7);
    const rank = rankRes.ok ? rankRes.all.find((r) => r.id === id) : null;
    const head = await heroHead(id);
    const skills = sd.heroPublic(hero).skills.slice(0, 4);
    let t = `🦸 <b>${esc(hero.hero_name)}</b>`;
    if (hero.class) t += ` — ${roleFa(hero.class)}`;
    if (hero.laning?.length) t += `\n🛤️ لین: ${laneFa(hero.laning)}`;
    if (rank) {
      t += `\n\n📊 <b>آمار زنده (۷ روز اخیر)</b>\nوین‌ریت: ${pct(rank.win)}\nبن‌ریت: ${pct(rank.ban)}\nپیک‌ریت: ${pct(rank.pick)}`;
    } else {
      t += '\n\n📊 آمار زندهٔ این هیرو فعلاً در دسترس نیست.';
    }
    if (skills.length) {
      t += '\n\n✨ <b>اسکیل‌ها:</b>';
      for (const s of skills) {
        t += `\n• <b>${esc(s.name)}</b>${s.type ? ` (${esc(s.type)})` : ''}`;
        if (s.description) t += `\n  ${esc(truncate(cleanText(s.description), 220))}`;
      }
    }
    const st = sd.statByName(hero.hero_name);
    if (st) t += `\n\n📊 آمار ۷ روز اخیر: رتبهٔ ${faNum(st.position)} از ۱۳۳ — وین‌ریت ${pct(st.win_rate)} (${esc(st.win_label_fa || '')}) — تخصص: ${esc((st.specialities_fa || []).join('، '))}`;
    const lore = sd.loreById(id);
    if (lore && lore.bio_short_fa) t += `\n\n📖 ${esc(truncate(lore.bio_short_fa, 170))}`;
    const mu = sd.matchupById(id);
    if (mu && mu.countered_by && mu.countered_by.length) {
      t += '\n\n⚔️ سخت‌ترین حریف‌ها:';
      mu.countered_by.slice(0, 2).forEach((c) => {
        t += `\n• <b>${esc(c.name)}</b>${c.strength_fa ? ` (${esc(c.strength_fa)})` : ''} — ${esc(truncate(c.reason_fa || '', 110))}`;
      });
    }
    // هم‌تیمی‌های خوب: اگر هیرو در یکی از ترکیب‌های تیمی هست، ۴ هم‌تیمی دیگرش
    const comp = (sd.teamComps || []).find((c) => (c.heroes || []).some((x) => normName(x.name) === normName(hero.hero_name)));
    if (comp) {
      const mates = comp.heroes.filter((x) => normName(x.name) !== normName(hero.hero_name));
      t += `\n\n🤝 <b>هم‌تیمی‌های خوب</b> (${esc(comp.title_fa || comp.title)}):` + mates.map((x) => `\n• <b>${esc(x.name)}</b> — ${laneFa([x.lane])}`).join('');
    }
    t += FOOTER;
    const kb = heroDetailKeyboard(id);
    if (head) {
      try {
        if (t.length <= 1000) return await ctx.replyWithPhoto(head, { caption: t, parse_mode: 'HTML', ...kb });
        // کپشن عکس حداکثر ۱۰۲۴ کاراکتر است؛ برای هیروهای شلوغ عکس با خلاصه می‌آید و متن کامل پیام بعد است
        const cap = `🦸 <b>${esc(hero.hero_name)}</b>` + (hero.class ? ` — ${roleFa(hero.class)}` : '') + (hero.laning?.length ? `\n🛤️ لین: ${laneFa(hero.laning)}` : '') + (rank ? `\n\n📊 <b>آمار زنده (۷ روز اخیر)</b>\nوین‌ریت: ${pct(rank.win)}\nبن‌ریت: ${pct(rank.ban)}\nپیک‌ریت: ${pct(rank.pick)}` : '') + (skills.length ? '\n\n✨ <b>اسکیل‌ها:</b>' + skills.map((sk) => `\n• <b>${esc(sk.name)}</b>`).join('') : '') + FOOTER;
        await ctx.replyWithPhoto(head, { caption: cap, parse_mode: 'HTML' });
        return await ctx.replyWithHTML(t, kb);
      } catch { /* بدون عکس ادامه بده */ }
    }
    return ctx.replyWithHTML(t, kb);
  }

  bot.command('hero', async (ctx) => {
    const q = ctx.message.text.replace(/^\/hero(@\S+)?\s*/i, '').trim();
    if (!q) {
      return ctx.replyWithHTML(`🦸 <b>هیروها بر اساس نقش</b>\n\n${faNum(sd.heroes.length)} هیرو در ۶ نقش — یکی را انتخاب کن:` + FOOTER, rolePickerKeyboard('heroes'));
    }
    const hero = sd.findHero(q);
    if (!hero) {
      return ctx.replyWithHTML(esc(heroNotFoundText(q, sd.searchHeroes(q, 5))), rolePickerKeyboard('heroes'));
    }
    return sendHeroDetail(ctx, hero);
  });

  // ---------- /heroes — لیست هیروها بر اساس نقش ----------
  bot.command('heroes', async (ctx) => {
    const total = sd.heroes.length;
    return ctx.replyWithHTML(
      `🦸 <b>هیروها بر اساس نقش</b>\n\n${faNum(total)} هیرو در ۶ نقش — یکی را انتخاب کن:` + FOOTER,
      rolePickerKeyboard('heroes'),
    );
  });

  // ---------- /meta ----------
  async function sendMeta(ctx) {
    const r = await getRankList(7);
    if (!r.ok) return ctx.replyWithHTML(`❌ گرفتن متا فعلاً ممکن نشد: ${esc(r.error)}` + FOOTER, homeKeyboard());
    const top = [...r.all].sort((a, b) => (b.win ?? 0) - (a.win ?? 0)).slice(0, 10);
    let t = '📊 <b>برترین هیروهای متا — ۷ روز اخیر (بر اساس وین‌ریت)</b>\n';
    top.forEach((h, i) => {
      t += `\n${faNum(i + 1)}. <b>${esc(h.name)}</b> — وین ${pct(h.win)} | بن ${pct(h.ban)} | پیک ${pct(h.pick)}`;
    });
    t += FOOTER;
    return ctx.replyWithHTML(t, homeKeyboard());
  }
  bot.command('meta', async (ctx) => sendMeta(ctx));

  // ---------- /counter ----------
  async function sendCounters(ctx, hero) {
    const id = Number(hero.mlid);
    const r = await roneGet(`/heroes/${id}/counters?days=7&size=10&index=1`);
    if (!r.ok) return ctx.replyWithHTML(`❌ گرفتن کانترها فعلاً ممکن نشد: ${esc(r.error)}` + FOOTER);
    const rec = r.records[0];
    if (!rec) return ctx.replyWithHTML('❌ برای این هیرو کانتر ثبت‌نشده‌ای پیدا نشد.' + FOOTER);
    const c = normCounterRecord(rec);
    // مرتب نزولی: بزرگ‌ترین افزایش وین‌ریت اول — این‌ها هیروهایی‌اند که هیروی اصلی آن‌ها را کانتر می‌کند
    const sorted = [...c.counters].filter((x) => x.delta != null).sort((a, b) => b.delta - a.delta).slice(0, 5);
    let t = `⚔️ <b>${esc(c.name || hero.hero_name)} این هیروها را کانتر می‌کند</b>`;
    if (c.win != null) t += `\nوین‌ریت خودش: ${pct(c.win)} | بن‌ریت: ${pct(c.ban)}`;
    t += '\n\nوین‌ریت او در برابر این هیروها از همه بیشتر است:';
    if (!sorted.length) t += '\n— فعلاً کانتر مشخصی ثبت نشده است.';
    sorted.forEach((x, i) => {
      t += `\n${faNum(i + 1)}. <b>${esc(x.name)}</b> — وین‌ریت +${pct(x.delta)} در برابر او`;
    });
    // هیروهایی که این هیرو را کانتر می‌کنند — از relation هیرو در Rone
    try {
      const hr = await roneGet(`/heroes/${id}`);
      const weak = hr.records?.[0]?.data?.relation?.weak?.target_hero_id || [];
      const weakNames = weak.filter(Boolean).map((wid) => sd.heroById(wid)?.hero_name).filter(Boolean);
      if (weakNames.length) t += `\n\n⚔️ <b>جلوی این هیروها کانتر می‌شود:</b>\n${weakNames.map((n) => `• ${esc(n)}`).join('\n')}`;
    } catch { /* اگر relation نبود، فقط همان لیست بالا می‌ماند */ }
    t += FOOTER;
    return ctx.replyWithHTML(t);
  }
  // ---------- /counter — تک‌هیرو (مثل قبل) یا تیمی (۲ تا ۵ هیرو) ----------
  // رتبه‌بندی کانتر تیمی: برای هر هیروی نامزد، پوشش = چند تا از هیروهای حریف را
  // کانتر می‌کند (matchups.counters)؛ مرتب بر اساس پوشش، بعد وین‌ریت ۷ روزه.
  function teamCounterTop(enemyHeroes, limit = 5) {
    const enemyNorms = enemyHeroes.map((h) => normName(h.hero_name));
    const enemySet = new Set(enemyNorms);
    const rows = [];
    for (const h of sd.heroes) {
      if (enemySet.has(normName(h.hero_name))) continue; // هیروی حریف را نمی‌شود برداشت
      const entry = (sd.matchups || {})[String(h.mlid)] || {};
      const countered = new Set((entry.counters || []).map((c) => normName(c.slug || c.name)));
      const hit = enemyHeroes.filter((e) => countered.has(normName(e.hero_name)));
      if (!hit.length) continue;
      const st = sd.statByName(h.hero_name);
      rows.push({ hero: h, coverage: hit.length, hitNames: hit.map((e) => e.hero_name), win: st ? Number(st.win_rate) || 0 : 0 });
    }
    rows.sort((a, b) => (b.coverage - a.coverage) || (b.win - a.win));
    return rows.slice(0, limit);
  }
  async function sendTeamCounters(ctx, enemyHeroes) {
    const n = enemyHeroes.length;
    const top = teamCounterTop(enemyHeroes, 5);
    let t = `🛡️ <b>کانتر تیم حریف</b> — تیم حریف: ${enemyHeroes.map((h) => esc(h.hero_name)).join('، ')}`;
    if (!top.length) {
      t += '\n\n— هیچ هیرویی این تیم را کانتر نمی‌کند.';
    } else {
      top.forEach((r, i) => {
        t += `\n${faNum(i + 1)}. <b>${esc(r.hero.hero_name)}</b> — ${esc(roleFa(r.hero.class))} — ${esc(laneFa(r.hero.laning))} — کانتر ${faNum(r.coverage)} تا از ${faNum(n)} هیرو (${r.hitNames.map(esc).join('، ')}) — وین‌ریت ${pct(r.win)}`;
      });
    }
    t += FOOTER;
    return ctx.replyWithHTML(t);
  }
  bot.command('counter', async (ctx) => {
    const q = ctx.message.text.replace(/^\/counter(@\S+)?\s*/i, '').trim();
    if (!q) return sendCounterMode(ctx);
    // اگر کل متن یک هیروست (حتی چندکلمه‌ای مثل «Popol and Kupa»)، مسیر تک‌هیرو مثل قبل
    if (!q.includes(',')) {
      const single = sd.findHero(q);
      if (single) {
        await ctx.replyWithHTML('⏳ در حال گرفتن کانترها…');
        return sendCounters(ctx, single);
      }
    }
    // چند هیرو: اول با کاما جدا کن (نام چندکلمه‌ای سالم می‌ماند)، وگرنه با فاصله
    const parts = q.includes(',')
      ? q.split(',').map((s) => s.trim()).filter(Boolean)
      : q.split(/\s+/).filter(Boolean);
    const valid = [];
    const unknown = [];
    for (const p of parts.slice(0, 5)) {
      const h = sd.findHero(p);
      if (h && !valid.some((v) => normName(v.hero_name) === normName(h.hero_name))) valid.push(h);
      else if (!h) unknown.push(p);
    }
    if (!valid.length) return ctx.replyWithHTML(esc(heroNotFoundText(q, sd.searchHeroes(q, 5))), counterModeKeyboard());
    if (unknown.length) {
      await ctx.replyWithHTML(`⚠️ ${unknown.map((u) => `«${esc(u)}»`).join('، ')} پیدا نشد و نادیده گرفته شد.` + FOOTER);
    }
    if (valid.length === 1) {
      await ctx.replyWithHTML('⏳ در حال گرفتن کانترها…');
      return sendCounters(ctx, valid[0]);
    }
    return sendTeamCounters(ctx, valid);
  });

  // ---------- /ask — مربی هوش مصنوعی ----------
  async function askCoachQuestion(ctx, q) {
    if (!coachAI) return ctx.replyWithHTML('مربی فقط روی ورکر فعال است.' + FOOTER);
    const usage = await getCoachUsage(envOf('ADMIN_ID'), coachKV, ctx.from && ctx.from.id);
    if (usage && !usage.unlimited && usage.used >= usage.limit) {
      return ctx.replyWithHTML(esc(coachUserCapMsg(usage.limit)) + FOOTER);
    }
    await ctx.replyWithHTML('🧠 مربی دارد فکر می‌کند…');
    const ans = await askCoach({ AI: coachAI, ADMIN_ID: envOf('ADMIN_ID') }, { kv: coachKV }, q, ctx.from && ctx.from.id);
    if (!ans) return ctx.replyWithHTML('سؤالت را همین‌جا بنویس؛ مثلاً: بهترین بیلد Miya برای لین گلد چیست؟' + FOOTER);
    return ctx.replyWithHTML(esc(ans) + FOOTER);
  }
  bot.command('ask', async (ctx) => {
    const q = ctx.message.text.replace(/^\/ask(@\S+)?\s*/i, '').trim();
    if (!q) return ctx.replyWithHTML('سؤالت را همین‌جا بنویس؛ مثلاً: بهترین بیلد Miya برای لین گلد چیست؟' + FOOTER);
    return askCoachQuestion(ctx, q);
  });

  // ---------- /build ----------
  async function askLane(ctx, hero) {
    const kb = Markup.inlineKeyboard([
      ...LANES.map((l) => [Markup.button.callback(`${l.fa}`, `build:${hero.mlid}:${l.v}`)]),
      [Markup.button.callback('🏠 منوی اصلی', 'menu_home')],
    ]);
    return ctx.replyWithHTML(`🛠️ بیلد <b>${esc(hero.hero_name)}</b> برای کدام لین؟` + FOOTER, kb);
  }
  bot.command('build', async (ctx) => {
    const q = ctx.message.text.replace(/^\/build(@\S+)?\s*/i, '').trim();
    if (!q) return ctx.replyWithHTML('🛠️ <b>بیلد</b>\n\nهیرویی را انتخاب کن:' + FOOTER, rolePickerKeyboard('build'));
    const hero = sd.findHero(q);
    if (!hero) return ctx.replyWithHTML(esc(heroNotFoundText(q, sd.searchHeroes(q, 5))), rolePickerKeyboard('build'));
    return askLane(ctx, hero);
  });
  bot.action(/^build:(\d+):(exp|mid|gold|roam|jungle)$/, async (ctx) => {
    const [, idStr, lane] = ctx.match;
    const hero = sd.heroById(idStr);
    await ctx.answerCbQuery('⏳ در حال گرفتن بیلد…');
    const equipMap = await equipNameMap();
    const r = await roneGet(`/academy/heroes/${idStr}/builds?lane=${lane}`);
    if (!r.ok) {
      return ctx.replyWithHTML(`❌ گرفتن بیلد فعلاً ممکن نشد: ${esc(r.error)}\n\nلین باید یکی از این‌ها باشد: exp ،mid ،gold ،roam ،jungle` + FOOTER);
    }
    const rec = r.records[0];
    if (!rec) return ctx.replyWithHTML('❌ برای این هیرو و لین بیلدی پیدا نشد.' + FOOTER);
    const builds = normBuildRecord(rec, equipMap);
    const laneFa = (LANES.find((l) => l.v === lane) || {}).fa || lane;
    // بیلد کامل ۶ آیتمی (mlbb.io) — مستقل از لین، اول نشان داده می‌شود
    const fb = sd.fullBuilds[String(idStr)];
    let t = '';
    if (fb && (fb.items || []).length) {
      t += `🧰 <b>بیلد پیشنهادی ${esc(hero?.hero_name || '')}</b> — ۶ آیتم${fb.month ? ' (' + esc(monthFa(fb.month)) + ')' : ''}`;
      fb.items.forEach((nm, i) => { t += `\n${faNum(i + 1)}. ${esc(nm)}`; });
      if (fb.spell) t += `\n🪄 اسپل: ${esc(fb.spell)}`;
      if (fb.emblem) t += `\n🛡️ امبلم: ${esc(fb.emblem)}${(fb.emblem_talents || []).length ? ' (' + fb.emblem_talents.map(esc).join('، ') + ')' : ''}`;
      if (fb.builds_count) t += `\n📊 تجمیع ${faNum(fb.builds_count)} بیلد${(fb.builds_count || 99) <= 2 ? ' — ⚠️ نمونهٔ کوچک، با احتیاط' : ''}`;
      t += '\n';
    }
    t += fb && (fb.items || []).length
      ? `\n🔄 <b>بیلدهای دیگر — ${esc(laneFa)}</b>`
      : `\n🛠️ <b>بیلد پیشنهادی ${esc(hero?.hero_name || '')}</b> — ${esc(laneFa)}`;
    if (!builds.length) t += '\n\n— بیلدی ثبت نشده است.';
    builds.slice(0, 3).forEach((b, i) => {
      t += `\n\n<b>بیلد ${faNum(i + 1)}</b> — وین ${pct(b.win)} | پیک ${pct(b.pick)}`;
      if (b.spell) t += `\n🪄 اسپل: ${esc(b.spell)}`;
      t += '\n🧰 آیتم‌ها: ' + (b.equipNames.length ? b.equipNames.map(esc).join(' ← ') : '—');
    });
    t += FOOTER;
    return ctx.replyWithHTML(t);
  });

  // ---------- /news و /tier ----------
  async function sendNews(ctx) {
    const { patchNotes, wikiRecent } = sd.news || {};
    const disc = sd.discussions || [];
    const ev = sd.events || [];
    let t = '📰 <b>اخبار و پچ‌نوت‌ها</b>';
    if ((!patchNotes || !patchNotes.length) && (!wikiRecent || !wikiRecent.length) && !disc.length && !ev.length) {
      return ctx.replyWithHTML(t + '\n\n— فعلاً خبری نیست.' + FOOTER);
    }
    if (patchNotes && patchNotes.length) {
      t += '\n\n<b>📝 پچ‌نوت‌ها:</b>';
      patchNotes.slice(0, 5).forEach((p) => {
        t += `\n• <b>${esc(p.title_fa || p.title)}</b>` + (dateFa(p.updated) ? ` — ${dateFa(p.updated)}` : '');
      });
    }
    if (ev.length) {
      const stFa = { current: 'در حال اجرا', upcoming: 'به‌زودی', unknown: 'تاریخ مشخص نیست', ended: 'تمام‌شده' };
      t += '\n\n<b>🎉 ایونت‌ها:</b>';
      ev.slice(0, 5).forEach((e) => {
        const d1 = e.start_date ? dateFa(e.start_date) : '';
        const d2 = e.end_date ? dateFa(e.end_date) : '';
        const dates = [d1, d2].filter(Boolean).join(' تا ');
        const fev = ((sd.faContent || {}).events || {})[e.title] || {};
        t += `\n• <b>${esc(fev.title_fa || e.title)}</b> — ${esc(fev.status_fa || stFa[e.status] || '')}` + (dates ? ` — ${dates}` : '');
      });
    }
    if (wikiRecent && wikiRecent.length) {
      t += '\n\n<b>📚 تازه‌ها:</b>';
      wikiRecent.slice(0, 5).forEach((w) => {
        t += `\n• <b>${esc(w.title)}</b>` + (dateFa(w.timestamp) ? ` — ${dateFa(w.timestamp)}` : '');
      });
    }
    if (disc.length) {
      t += '\n\n<b>💬 گفتگوها:</b>';
      disc.slice(0, 5).forEach((d) => {
        const fd = ((sd.faContent || {}).discussions || {})[d.title] || {};
        t += `\n• <b>${esc(fd.title_fa || d.title)}</b>` + (d.category_fa ? ` — ${esc(d.category_fa)}` : '') + (dateFa(d.date_iso) ? ` — ${dateFa(d.date_iso)}` : '');
      });
    }
    t += FOOTER;
    return ctx.replyWithHTML(t, homeKeyboard());
  }
  bot.command('news', async (ctx) => sendNews(ctx));

  // ---------- /patch — متن کامل پچ‌نوت (فارسی) ----------
  function patchTitles() { return Object.keys((sd.faContent || {}).patches || {}); }
  async function showPatch(ctx, key) {
    const p = sd.patchByTitle(key);
    if (!p) return ctx.replyWithHTML('جزئیات این پچ پیدا نشد.' + FOOTER, homeKeyboard());
    let t = `📝 <b>${esc(p.title_fa || key)}</b>` + (p.release_date ? ` — ${esc(p.release_date)}` : '');
    if ((p.new_heroes_fa || []).length) {
      t += '\n\n🆕 <b>هیروهای تازه:</b>';
      for (const nh of p.new_heroes_fa) t += `\n• <b>${esc(nh.hero)}</b>${nh.feature_fa ? ` — ${esc(truncate(nh.feature_fa, 120))}` : ''}`;
    }
    const adj = p.hero_adjustments_fa || [];
    if (adj.length) {
      t += `\n\n⚖️ <b>تغییرات هیروها (${faNum(adj.length)}):</b>`;
      for (const a of adj.slice(0, 5)) {
        t += `\n• <b>${esc(a.hero)}</b>${a.type_fa ? ` (${esc(a.type_fa)})` : ''}${a.note_fa ? ` — ${esc(truncate(a.note_fa, 110))}` : ''}`;
        const ch = ((a.skills_fa || []).flatMap((sk) => sk.changes_fa || [])).slice(0, 2);
        for (const c of ch) t += `\n  ◦ ${esc(truncate(c, 100))}`;
      }
    }
    const eq = p.equipment_adjustments_fa || [];
    if (eq.length) t += `\n\n🛡️ تغییرات آیتم: ${faNum(eq.length)} مورد`;
    t += FOOTER;
    return ctx.replyWithHTML(t, homeKeyboard());
  }
  async function sendPatchList(ctx) {
    const titles = patchTitles();
    if (!titles.length) return ctx.replyWithHTML('پچ‌نوتی فعلاً در دسترس نیست.' + FOOTER, homeKeyboard());
    const kb = Markup.inlineKeyboard([
      ...titles.map((title, i) => [Markup.button.callback(`${(((sd.faContent || {}).patches || {})[title] || {}).title_fa || title}`, `patch:${i}`)]),
      [Markup.button.callback('🏠 منوی اصلی', 'menu_home')],
    ]);
    return ctx.replyWithHTML('📝 <b>پچ‌نوت‌ها</b>\n\nکدام پچ را می‌خواهی ببینی؟' + FOOTER, kb);
  }
  bot.command('patch', async (ctx) => {
    const q = ctx.message.text.replace(/^\/patch(@\S+)?\s*/i, '').trim();
    const titles = patchTitles();
    if (!titles.length) return ctx.replyWithHTML('پچ‌نوتی فعلاً در دسترس نیست.' + FOOTER, homeKeyboard());
    if (!q) return sendPatchList(ctx);
    const normQ = q.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[^0-9.]/g, '');
    const key = titles.find((t) => t.toLowerCase().includes(normQ.toLowerCase())) || null;
    if (!key) return sendPatchList(ctx);
    return showPatch(ctx, key);
  });

  // ---------- /comps — ترکیب‌های تیمی ----------
  async function sendComps(ctx) {
    const comps = sd.teamComps || [];
    if (!comps.length) return ctx.replyWithHTML('ترکیب تیمی فعلاً در دسترس نیست.' + FOOTER, homeKeyboard());
    let t = '👥 <b>ترکیب‌های تیمی پیشنهادی</b>';
    for (const c of comps) {
      const titleFa = (((sd.faContent || {}).comps || {})[c.id] || {}).title_fa || c.title_fa || c.title;
      t += `\n\n<b>${esc(titleFa)}</b> — میانگین وین‌ریت ${pct(c.avg_win_rate)}`;
      for (const h of c.heroes) t += `\n• <b>${esc(h.name)}</b> — ${laneFa([h.lane])} (وین ${pct(h.win_rate)})`;
    }
    t += FOOTER;
    return ctx.replyWithHTML(t, homeKeyboard());
  }
  bot.command('comps', async (ctx) => sendComps(ctx));

  // ---------- /lore — داستان کامل هیرو (فارسی) ----------
  async function sendLore(ctx, hero) {
    const id = Number(hero.mlid);
    const lore = sd.loreById(id);
    if (!lore || (!lore.bio_fa && !lore.bio_short_fa)) {
      return ctx.replyWithHTML(`داستان ${esc(hero.hero_name)} فعلاً در دسترس نیست.` + FOOTER);
    }
    const info = lore.info_fa || {};
    const infoBits = [info.title_fa, info.gender_fa, info.species_fa, info.occupation_fa, info.fighting_style_fa].filter(Boolean).join('، ');
    const pub = sd.heroPublic(hero);
    const head = pub.portrait || null;
    const body = (lore.bio_fa || lore.bio_short_fa || '').trim();
    const cap = `📖 <b>داستان ${esc(hero.hero_name)}</b>` + (infoBits ? `\n${esc(infoBits)}` : '') + FOOTER;
    if (head) {
      try {
        await ctx.replyWithPhoto(head, { caption: cap, parse_mode: 'HTML' });
        return await ctx.replyWithHTML(esc(body), homeKeyboard());
      } catch { /* بدون عکس ادامه بده */ }
    }
    return ctx.replyWithHTML(`📖 <b>داستان ${esc(hero.hero_name)}</b>` + (infoBits ? `\n${esc(infoBits)}` : '') + `\n\n${esc(body)}` + FOOTER, homeKeyboard());
  }

  bot.command('lore', async (ctx) => {
    const q = ctx.message.text.replace(/^\/lore(@\S+)?\s*/i, '').trim();
    if (!q) return ctx.replyWithHTML('📖 <b>داستان‌ها</b>\n\nهیرویی را انتخاب کن:' + FOOTER, rolePickerKeyboard('lore'));
    const hero = sd.findHero(q);
    if (!hero) return ctx.replyWithHTML(esc(heroNotFoundText(q, sd.searchHeroes(q, 5))), rolePickerKeyboard('lore'));
    return sendLore(ctx, hero);
  });

  async function sendTier(ctx) {
    const tl = sd.tierlist || {};
    const order = ['SS', 'S', 'A', 'B', 'C', 'D'];
    if (!order.some((k) => ((tl.tiers || {})[k] || []).length)) {
      return ctx.replyWithHTML('❌ تیرلیست فعلاً در دسترس نیست.' + FOOTER, homeKeyboard());
    }
    let t = '🏆 <b>تیرلیست هیروها</b>' + (tl.month ? ' — ' + esc(monthFa(tl.month)) : '');
    for (const k of order) {
      const list = (tl.tiers || {})[k] || [];
      if (!list.length) continue;
      t += `\n\n<b>${k}</b> (${faNum(list.length)}): ` + list.map((h) => esc(h.name)).join('، ');
    }
    t += FOOTER;
    return ctx.replyWithHTML(t, homeKeyboard());
  }
  bot.command('tier', async (ctx) => sendTier(ctx));

  // ---------- /items و /item ----------
  // ---------- آیتم‌ها و امبلم‌ها: دکمه‌ای ----------
  // دسته‌های آیتم از خود داده خوانده می‌شوند (Attack / Magic / Defense / ...)
  function itemCategories() {
    const byCat = {};
    for (const it of sd.items) {
      const c = it.item_category || 'سایر';
      (byCat[c] = byCat[c] || []).push(it);
    }
    return Object.entries(byCat).sort((a, b) => b[1].length - a[1].length);
  }
  function itemCategoryKeyboard() {
    const rows = itemCategories().map(([c, list]) => [Markup.button.callback(`${c} (${faNum(list.length)})`, `itemcat:${c}`)]);
    rows.push([Markup.button.callback('🏠 منوی اصلی', 'menu_home')]);
    return Markup.inlineKeyboard(rows);
  }
  function sendItemCategories(ctx) {
    return ctx.replyWithHTML(`🧰 <b>آیتم‌ها (${faNum(sd.items.length)} آیتم)</b>\n\nدسته را انتخاب کن:` + FOOTER, itemCategoryKeyboard());
  }
  function itemListKeyboard(cat) {
    const list = sd.items.filter((it) => (it.item_category || 'سایر') === cat);
    const rows = [];
    for (let i = 0; i < list.length; i += 2) {
      rows.push(list.slice(i, i + 2).map((it) => Markup.button.callback(it.item_name, `item:${it.id}`)));
    }
    rows.push([Markup.button.callback('← دسته‌ها', 'menu_items')]);
    rows.push([Markup.button.callback('🏠 منوی اصلی', 'menu_home')]);
    return Markup.inlineKeyboard(rows);
  }
  async function sendItemList(ctx, cat) {
    const list = sd.items.filter((it) => (it.item_category || 'سایر') === cat);
    if (!list.length) return ctx.replyWithHTML('❌ دسته‌ای با این نام پیدا نشد.' + FOOTER, itemCategoryKeyboard());
    return ctx.replyWithHTML(`🧰 <b>${esc(cat)}</b> (${faNum(list.length)} آیتم)\n\nآیتم را انتخاب کن:` + FOOTER, itemListKeyboard(cat));
  }
  async function sendItemDetail(ctx, it) {
    const p = sd.itemPublic(it);
    let t = `🧰 <b>${esc(p.name)}</b>`;
    t += `\nدسته: ${esc(p.category)} | تیر: ${faNum(p.tier)}`;
    if (p.cost) t += ` | قیمت: ${faInt(p.cost)} طلا`;
    if (p.summary) t += `\nخلاصه: ${esc(p.summary)}`;
    const modEntries = Object.entries(p.modifiers || {});
    if (modEntries.length) {
      t += '\n\n📈 ویژگی‌ها:\n' + modEntries.map(([k, v]) => `• ${esc(k)}: ${faNum(v)}`).join('\n');
    }
    if (p.passives.length) {
      t += '\n\n✨ پسیو:';
      for (const ps of p.passives) t += `\n• <b>${esc(ps.name)}:</b> ${esc(truncate(cleanText(ps.desc), 300))}`;
    }
    if (p.actives.length) {
      t += '\n\n🪄 اکتیو:';
      for (const a of p.actives) t += `\n• <b>${esc(a.name)}:</b> ${esc(truncate(cleanText(a.desc), 300))}`;
    }
    t += FOOTER;
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('← دسته‌ها', 'menu_items')],
      [Markup.button.callback('🏠 منوی اصلی', 'menu_home')],
    ]);
    return ctx.replyWithHTML(t, kb);
  }
  bot.command('items', async (ctx) => sendItemCategories(ctx));
  bot.command('item', async (ctx) => {
    const q = ctx.message.text.replace(/^\/item(@\S+)?\s*/i, '').trim();
    if (!q) return sendItemCategories(ctx);
    const it = sd.findItem(q);
    if (!it) {
      const sug = sd.searchItems(q, 5);
      let t = `❌ آیتمی با نام «${q}» پیدا نشد.`;
      if (!sug.length) return ctx.replyWithHTML(esc(t) + FOOTER, itemCategoryKeyboard());
      t += '\n\nشاید منظورت این‌هاست:';
      const kb = Markup.inlineKeyboard([
        ...sug.map((x) => [Markup.button.callback(`🧰 ${x.item_name}`, `item:${x.id}`)]),
        [Markup.button.callback('← دسته‌ها', 'menu_items')],
        [Markup.button.callback('🏠 منوی اصلی', 'menu_home')],
      ]);
      return ctx.replyWithHTML(esc(t) + FOOTER, kb);
    }
    return sendItemDetail(ctx, it);
  });

  // ---------- /emblems ----------
  // اسپل‌ها (Battle Spells) از دادهٔ زنده خوانده می‌شوند؛ مثل مینی‌اپ
  async function getSpells() {
    const r = await roneGet('/academy/spells?size=20&index=1');
    if (!r.ok) return [];
    return (r.records || []).map((rec) => {
      const d = rec?.data?.__data || rec?.data || {};
      const name = d.skillname || d.name || '';
      const desc = String(d.skilldesc || '').replace(/<[^>]+>/g, '');
      return { name, desc: sd.faSpell(name) || desc };
    }).filter((s) => s.name);
  }
  function emblemPickerKeyboard(spells) {
    const rows = sd.emblems.map((e) => [Markup.button.callback(`🛡️ ${e.emblem_name}`, `emblem:${e.id}`)]);
    for (let i = 0; i < spells.length; i += 2) {
      rows.push(spells.slice(i, i + 2).map((s, j) => Markup.button.callback(`🪄 ${s.name}`, `spell:${i + j}`)));
    }
    rows.push([Markup.button.callback('🏠 منوی اصلی', 'menu_home')]);
    return Markup.inlineKeyboard(rows);
  }
  async function sendEmblemPicker(ctx) {
    const spells = await getSpells();
    const t = `🛡️ <b>امبلم‌ها (${faNum(sd.emblems.length)}) و اسپل‌ها (${faNum(spells.length)})</b>\n\nیکی را انتخاب کن:` + FOOTER;
    return ctx.replyWithHTML(t, emblemPickerKeyboard(spells));
  }
  async function sendEmblemDetail(ctx, e) {
    let t = `🛡️ <b>${esc(e.emblem_name)}</b>${e.emblem_role ? ` (${esc(e.emblem_role)})` : ''}`;
    const mods = (e.modifiers || []).flatMap((m) => Object.entries(m).map(([k, v]) => `${k}: ${v}`));
    if (mods.length) t += `\n\n📈 ${esc(mods.join('، '))}`;
    const tiers = sd.talents || {};
    const allTalents = [...(tiers.tier1 || []), ...(tiers.tier2 || []), ...(tiers.tier3 || [])];
    if (allTalents.length) {
      t += `\n\n⭐ <b>تلنت‌ها (${faNum(allTalents.length)}):</b>\n` + allTalents.map((x) => `• <b>${esc(x.name)}</b> — ${esc(sd.faTalent(x.id) || x.description)}`).join('\n');
    }
    t += FOOTER;
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('← امبلم‌ها', 'menu_emblems')],
      [Markup.button.callback('🏠 منوی اصلی', 'menu_home')],
    ]);
    return ctx.replyWithHTML(t, kb);
  }
  async function sendSpellDetail(ctx, idx) {
    const spells = await getSpells();
    const s = spells[Number(idx)];
    if (!s) return ctx.replyWithHTML('❌ اسپل پیدا نشد.' + FOOTER, homeKeyboard());
    let t = `🪄 <b>${esc(s.name)}</b>`;
    if (s.desc) t += `\n\n${esc(truncate(cleanText(s.desc), 400))}`;
    t += FOOTER;
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('← امبلم‌ها', 'menu_emblems')],
      [Markup.button.callback('🏠 منوی اصلی', 'menu_home')],
    ]);
    return ctx.replyWithHTML(t, kb);
  }
  bot.command('emblems', async (ctx) => sendEmblemPicker(ctx));


  // ---------- /wr ----------
  function wrNeeded(matchNow, wrNow, wrFuture) {
    const m = matchNow, cur = wrNow / 100, tgt = wrFuture / 100;
    if (tgt >= 1) return Infinity;
    const wins = m * cur;
    const n = (tgt * m - wins) / (1 - tgt);
    return Math.max(0, Math.ceil(n - 1e-9));
  }
  bot.command('wr', async (ctx) => {
    const raw = ctx.message.text.replace(/^\/wr(@\S+)?\s*/i, '').trim();
    const args = raw ? raw.split(/\s+/).map(Number) : [];
    if (args.length < 3 || args.some((x) => !Number.isFinite(x))) {
      await sessionStore.delete('wrPick', ctx.chat.id);
      return sendWrStep(ctx, 'm');
    }
    const [m, now, fut] = args;
    if (fut <= now) return ctx.replyWithHTML('⚠️ وین‌ریت هدف باید بیشتر از وین‌ریت فعلی باشد.' + FOOTER, homeKeyboard());
    const r = await roneGet(`/addon/win-rate-calculator?match-now=${m}&wr-now=${now}&wr-future=${fut}`);
    let n = r.ok ? (r.raw?.required_no_lose_matches ?? r.raw?.data?.required_no_lose_matches) : null;
    if (n == null) n = wrNeeded(m, now, fut); // فالبک محاسبهٔ محلی
    let t = wrResultText(m, now, fut, n);
    if (!r.ok) t += '\n\n(محاسبهٔ محلی — سرویس زنده در دسترس نبود.)';
    t += FOOTER;
    return ctx.replyWithHTML(t, homeKeyboard());
  });

  // ---------- /mpl ----------
  async function sendMplLeagues(ctx) {
    const kb = Markup.inlineKeyboard([...LEAGUES.map((l) => [Markup.button.callback(`${l.fa}`, `mpl:${l.v}`)]), [Markup.button.callback('🏠 منوی اصلی', 'menu_home')]]);
    return ctx.replyWithHTML('🏆 کدام لیگ MPL؟' + FOOTER, kb);
  }
  bot.command('mpl', async (ctx) => sendMplLeagues(ctx));
  bot.action(/^mpl:(id|ph|my|kh)$/, async (ctx) => {
    const league = ctx.match[1];
    const name = (LEAGUES.find((l) => l.v === league) || {}).fa || league;
    await ctx.answerCbQuery('⏳ در حال گرفتن جدول…');
    const r = await roneGet(`/esports/${league}/standings`);
    if (!r.ok) {
      return ctx.replyWithHTML(`❌ جدول ${esc(name)} فعلاً در دسترس نیست: ${esc(r.error)}\n\nممکن است فصل این لیگ شروع نشده باشد یا سرویس بالادستی خطا بدهد.` + FOOTER, homeKeyboard());
    }
    const rows = r.records.map(normStanding).slice(0, 10);
    if (!rows.length) return ctx.replyWithHTML(`🏆 ${esc(name)}\n\nفعلاً ردیفی در جدول نیست.` + FOOTER, homeKeyboard());
    let t = `🏆 <b>جدول ${esc(name)}</b>\n`;
    rows.forEach((d) => {
      t += `\n${faNum(d.rank ?? 0)}. <b>${esc(d.team)}</b>${d.fullName ? ` (${esc(d.fullName)})` : ''}${d.wins != null ? ` — برد ${faNum(d.wins)}` : ''}${d.losses != null ? ` | باخت ${faNum(d.losses)}` : ''}${d.points != null ? ` | امتیاز ${faNum(d.points)}` : ''}${d.gameWins != null ? ` | گیم ${faNum(d.gameWins)}–${faNum(d.gameLosses)}` : ''}`;
    });
    t += FOOTER;
    return ctx.replyWithHTML(t, homeKeyboard());
  });

  // ---------- /player (ورود با کد تایید داخل بازی) ----------
  bot.command('player', async (ctx) => {
    await sessionStore.set('player', ctx.chat.id, { step: 'gameId' });
    return ctx.replyWithHTML(
      '👤 <b>اتصال پروفایل بازی</b>\n\nبرای دیدن آمار و مچ‌های خودت، اول Game ID (آیدی عددی بازی) را بفرست.\n\n⚠️ بعد از آن باید کد تاییدی را که داخل بازی می‌آید وارد کنی. توکن ورود فقط در حافظهٔ همین چت نگه داشته می‌شود و ذخیره نمی‌شود.\n\nبرای لغو، /cancel را بفرست.' + FOOTER,
    );
  });
  bot.command('cancel', async (ctx) => {
    await sessionStore.delete('player', ctx.chat.id);
    await sessionStore.delete('broadcast', ctx.chat.id);
    await sessionStore.delete('counterTeam', ctx.chat.id);
    await sessionStore.delete('wrPick', ctx.chat.id);
    return ctx.replyWithHTML('لغو شد.' + FOOTER);
  });
  bot.on('text', async (ctx, next) => {
    const text = (ctx.message.text || '').trim();
    // پیش‌نویس پیام همگانی مدیر — اول بررسی می‌شود تا با جریان /player قاطی نشود
    const bc = await sessionStore.get('broadcast', ctx.chat.id);
    if (bc && isAdmin(ctx) && !text.startsWith('/')) {
      if (bc.step === 'text') {
        if (text.length > 4000) return ctx.replyWithHTML('⚠️ متن پیام همگانی حداکثر ۴۰۰۰ کاراکتر است. کوتاه‌تر بفرست.' + FOOTER);
        bc.text = text;
        bc.step = 'confirm';
        await sessionStore.set('broadcast', ctx.chat.id, bc);
        return ctx.replyWithHTML(
          `📣 <b>پیش‌نمایش پیام همگانی</b> — به ${faNum((await getUsers()).size)} کاربر:\n\n${esc(text)}` + FOOTER,
          Markup.inlineKeyboard([
            [Markup.button.callback(`✅ ارسال به ${faNum((await getUsers()).size)} کاربر`, 'admin_bc:send')],
            [Markup.button.callback('❌ لغو', 'admin_bc:cancel')],
          ]),
        );
      }
    }
    const s = await sessionStore.get('player', ctx.chat.id);
    if (text.startsWith('/')) return next();
    const playerActive = s && s.step !== 'done';
    if (playerActive && s.step === 'gameId') {
      if (!/^\d+$/.test(text)) return ctx.replyWithHTML('⚠️ Game ID فقط عدد است. دوباره بفرست.' + FOOTER);
      s.gameId = text;
      s.step = 'zoneId';
      await sessionStore.set('player', ctx.chat.id, s);
      return ctx.replyWithHTML('حالا Zone ID (آیدی سرور/زون) را بفرست. معمولاً ۴ رقم است؛ مثلاً 1234.' + FOOTER);
    }
    if (playerActive && s.step === 'zoneId') {
      if (!/^\d+$/.test(text)) return ctx.replyWithHTML('⚠️ Zone ID فقط عدد است. دوباره بفرست.' + FOOTER);
      s.zoneId = text;
      s.step = 'sending';
      await sessionStore.set('player', ctx.chat.id, s);
      await ctx.replyWithHTML('⏳ در حال ارسال کد تایید به بازی… وارد بازی شو و کد را از صندوق پیام (اینباکس) بازی بردار.' + FOOTER);
      const r = await ronePost('/user/auth/send-vc', { game_id: s.gameId, zone_id: s.zoneId });
      // شکل دقیق body طبق OpenAPI ممکن است فرق کند؛ خطا را فارسی نشان می‌دهیم
      if (!r.ok) {
        await sessionStore.delete('player', ctx.chat.id);
        return ctx.replyWithHTML(`❌ ارسال کد ممکن نشد: ${esc(r.error)}\n\nمطمئن شو Game ID و Zone ID درست‌اند. اگر باز هم نشد، ورود به پروفایل فعلاً از این مسیر ممکن نیست.` + FOOTER);
      }
      s.step = 'code';
      await sessionStore.set('player', ctx.chat.id, s);
      return ctx.replyWithHTML('✅ کد ارسال شد. کد تایید داخل بازی را اینجا بفرست.' + FOOTER);
    }
    if (playerActive && s.step === 'code') {
      if (!/^\d{4,8}$/.test(text)) return ctx.replyWithHTML('⚠️ کد تایید عددی است (معمولاً ۴ تا ۸ رقم). دوباره بفرست.' + FOOTER);
      s.step = 'logging';
      await sessionStore.set('player', ctx.chat.id, s);
      await ctx.replyWithHTML('⏳ در حال ورود…' + FOOTER);
      const r = await ronePost('/user/auth/login', { game_id: s.gameId, zone_id: s.zoneId, verification_code: text });
      if (!r.ok) {
        s.step = 'code';
        await sessionStore.set('player', ctx.chat.id, s);
        return ctx.replyWithHTML(`❌ ورود ناموفق بود: ${esc(r.error)}\n\nاگر کد منقضی شده، با /player دوباره کد تازه بگیر.` + FOOTER);
      }
      const jwt = r.data?.token || r.data?.jwt || r.data?.access_token || (typeof r.data === 'string' ? r.data : null);
      if (!jwt) {
        await sessionStore.delete('player', ctx.chat.id);
        return ctx.replyWithHTML('❌ ورود انجام شد ولی توکن برنگشت؛ پروفایل فعلاً قابل نمایش نیست.' + FOOTER);
      }
      s.jwt = jwt;
      s.step = 'done';
      await sessionStore.set('player', ctx.chat.id, s);
      const info = await roneGet('/user/info', { useCache: false, headers: { Authorization: `Bearer ${jwt}` } });
      const nick = info?.raw?.nickname || info?.raw?.data?.nickname || info?.raw?.username || '';
      return ctx.replyWithHTML(
        `✅ وارد شدی! پروفایلت متصل است.${nick ? `\n\n👤 ${esc(nick)}` : ''}\n\n⚠️ توکن ورود فقط در حافظهٔ همین چت است و بعد از ری‌استارت سرور پاک می‌شود.` + FOOTER,
      );
    }
    // سؤال مربی با متن آزاد — فقط چت خصوصی، وقتی جریانی فعال نیست
    if (text && ctx.chat?.type === 'private' && (!s || s.step === 'done')) {
      return askCoachQuestion(ctx, text);
    }
    return next();
  });

  // ---------- /version ----------
  bot.command('version', async (ctx) => {
    const r = await roneGet('/academy/meta/version');
    if (!r.ok) return ctx.replyWithHTML(`❌ گرفتن نسخهٔ بازی ممکن نشد: ${esc(r.error)}` + FOOTER);
    const latest = r.records.find((rec) => rec?.data?.game_version);
    const v = latest?.data?.game_version || '؟';
    return ctx.replyWithHTML(`🎮 <b>نسخهٔ فعلی بازی:</b> ${esc(v)}` + FOOTER);
  });

  // ---------- /admin — پنل مدیریت (فقط مدیر) ----------
  function adminKeyboard() {
    return Markup.inlineKeyboard([
      [Markup.button.callback('📊 وضعیت ربات', 'admin_status'), Markup.button.callback('👥 کاربران', 'admin_users')],
      [Markup.button.callback('🔄 بروزرسانی داده', 'admin_refresh'), Markup.button.callback('📝 لاگ‌های اخیر', 'admin_logs')],
      [Markup.button.callback('📣 پیام همگانی', 'admin_broadcast')],
      [Markup.button.callback('⚡ مصرف و اتصال‌ها', 'admin_usage')],
      [Markup.button.callback('🔗 لینک مینی‌اپ', 'admin_miniapp')],
    ]);
  }

  bot.command('admin', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    return ctx.replyWithHTML('🛠️ <b>پنل مدیریت</b>\n\nیکی را انتخاب کن:' + FOOTER, adminKeyboard());
  });

  bot.action('menu_admin', async (ctx) => {
    if (!requireAdmin(ctx)) return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    return ctx.replyWithHTML('🛠️ <b>پنل مدیریت</b>\n\nیکی را انتخاب کن:' + FOOTER, adminKeyboard());
  });

  bot.action('admin_status', async (ctx) => {
    if (!requireAdmin(ctx)) return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    const up = Math.floor((Date.now() - bootTime.getTime()) / 1000);
    const h = Math.floor(up / 3600), m = Math.floor((up % 3600) / 60);
    const mem = (typeof process !== 'undefined' && process.memoryUsage) ? (process.memoryUsage().rss / 1048576).toFixed(0) : '—';
    let v = '؟';
    try {
      const r = await roneGet('/academy/meta/version');
      if (r.ok) v = r.records.find((rec) => rec?.data?.game_version)?.data?.game_version || '؟';
    } catch { /* نسخه خوانده نشد */ }
    return ctx.replyWithHTML(
      `📊 <b>وضعیت ربات</b>\n\n⏱️ زمان روشن بودن: ${faNum(h)} ساعت و ${faNum(m)} دقیقه\n🧠 حافظه: ${faNum(mem)} مگابایت\n🦸 هیروهای استاتیک: ${faNum(sd.heroes.length)}\n🧰 آیتم‌ها: ${faNum(sd.items.length)}\n🎮 نسخهٔ بازی: ${faNum(v)}\n👥 کاربران: ${faNum((await getUsers()).size)}\n📡 حالت: ${isWorker ? 'webhook (Cloudflare Workers)' : 'polling (تلگرام)'}\n🔗 مینی‌اپ: ${esc(miniappUrl || 'تنظیم نشده')}` + FOOTER,
    );
  });

  bot.action('admin_usage', async (ctx) => {
    if (!requireAdmin(ctx)) return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    const dateStr = new Date().toISOString().slice(0, 10);
    const usage = await getAiUsage(coachKV, dateStr);
    let coachToday = 0;
    try { coachToday = Number(await coachKV.get(`coach:${dateStr}`)) || 0; } catch { coachToday = 0; }
    // نورون‌ها را از توکن‌های اندازه‌گیری‌شده تخمین می‌زنیم؛ وقتی مدل usage
    // گزارش نمی‌دهد، هر فراخوانی را حدود ۱۲ نورون می‌گیریم. عدد دقیق فقط در
    // داشبورد کلادفلر است.
    const neurons = usage.tokens > 0 ? Math.round(usage.tokens * NEURONS_PER_TOKEN) : usage.calls * 12;
    const remaining = Math.max(0, AI_DAILY_NEURON_BUDGET - neurons);
    const [rone, pages, trigger, lastData] = await Promise.all([
      (async () => {
        try {
          const r = await roneGet('/academy/meta/version');
          if (!r.ok) return { ok: false, ver: '' };
          return { ok: true, ver: ((r.records || []).find((rec) => rec?.data?.game_version) || {}).data?.game_version || '' };
        } catch { return { ok: false, ver: '' }; }
      })(),
      (async () => {
        if (!miniappUrl) return null;
        try {
          const r = await fetch(miniappUrl, { method: 'GET', signal: AbortSignal.timeout(5000) });
          return r.ok;
        } catch { return false; }
      })(),
      (async () => {
        if (typeof deps.triggerHealth !== 'function') return null;
        try { return await deps.triggerHealth(); } catch { return false; }
      })(),
      (async () => {
        if (!dataKV) return null;
        try {
          const d = await dataKV.get('discussions.json', 'json');
          return (d && d.fetched_at) || '';
        } catch { return ''; }
      })(),
    ]);
    const kvUsersOk = !!coachKV;
    const kvDataOk = dataKV ? !!lastData : null;
    const modelShort = String(COACH_MODEL || '').replace('@cf/', '');
    const t =
      `⚡ <b>مصرف و اتصال‌ها — امروز ${dateFa(dateStr + 'T00:00:00Z')}</b>\n\n` +
      `🤖 مربی: ${faNum(coachToday)} از ${faNum(COACH_DAILY_CAP)} جواب\n` +
      `🌐 ترجمه‌ها: ${faNum(usage.translateCalls)} فراخوانی\n` +
      `📞 کل فراخوانی‌های AI: ${faNum(usage.calls)}\n` +
      `🧮 توکن‌ها: ${faInt(usage.tokens)}\n` +
      `⚡ نورون‌ها (تقریبی): ≈ ${faInt(neurons)} از ${faInt(AI_DAILY_NEURON_BUDGET)} — باقی‌مانده ≈ ${faInt(remaining)}\n\n` +
      `🔌 <b>اتصال‌ها</b>\n` +
      `• تلگرام: ✅ متصل\n` +
      `• KV کاربران: ${kvUsersOk ? '✅' : '❌'}\n` +
      `• KV دیتا: ${kvDataOk === null ? '—' : (kvDataOk ? '✅' : '❌')}\n` +
      `• Workers AI: ${coachAI ? '✅' : '❌'} (${esc(modelShort)})\n` +
      `• Rone API: ${rone.ok ? '✅' : '❌'}${rone.ver ? ` (بازی ${faNum(rone.ver)})` : ''}\n` +
      `• مینی‌اپ: ${pages === null ? 'تنظیم نشده' : (pages ? '✅' : '❌')}\n` +
      `• ماشهٔ رفرش: ${trigger === null ? '—' : (trigger ? '✅' : '❌')}\n` +
      `• آخرین بروزرسانی داده: ${lastData ? tehranDateTime(lastData) : 'نامشخص'}` +
      `\n\n⚠️ نورون‌ها تخمین است (۷٫۴ نورون برای ۳۰۴ توکن اندازه‌گیری شده)؛ عدد دقیق در داشبورد کلادفلر است.` + FOOTER;
    return ctx.replyWithHTML(t, Markup.inlineKeyboard([
      [Markup.button.callback('← پنل مدیریت', 'menu_admin')],
    ]));
  });

  bot.action('admin_users', async (ctx) => {
    if (!requireAdmin(ctx)) return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    const users = await getUsers();
    const list = [...users.values()].sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || '')).slice(0, 10);
    const usages = await Promise.all(list.map((u) => getCoachUsage(envOf('ADMIN_ID'), coachKV, u.id)));
    let t = `👥 <b>کاربران ربات — ${faNum(users.size)} نفر</b>\n`;
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      const usage = usages[i];
      const usageLabel = usage.unlimited ? `نامحدود (${faNum(usage.used)})` : `${faNum(usage.used)} از ${faNum(usage.limit)}`;
      t += `\n• ${esc(u.name || '—')}${u.username ? ` (@${esc(u.username)})` : ''} — ${faNum((u.firstSeen || '').slice(0, 10))} — 🧠 ${usageLabel}`;
    }
    if (!list.length) t += '\n\nهنوز کسی ربات را استارت نکرده است.';
    const kb = Markup.inlineKeyboard([
      ...list.map((u) => [Markup.button.callback(`🧠 ${String(u.name || u.id).slice(0, 22)}`, `coach:u:${u.id}`)]),
      [Markup.button.callback('← پنل مدیریت', 'menu_admin')],
    ]);
    return ctx.replyWithHTML(t + FOOTER, kb);
  });

  // ---------- مربی: جزئیات کاربر + تغییر سقف روزانه (فقط مدیر) ----------
  async function coachUserDetail(ctx, id) {
    const users = await getUsers();
    const u = users.get(String(id));
    const usage = await getCoachUsage(envOf('ADMIN_ID'), coachKV, id);
    const name = u?.name || 'کاربر';
    const usedLine = usage.unlimited
      ? `${faNum(usage.used)} جواب استفاده شده (نامحدود)`
      : `${faNum(usage.used)} از ${faNum(usage.limit)} جواب استفاده شده`;
    const limitLine = usage.unlimited ? 'نامحدود' : (!usage.hasOverride ? '۳ (پیش‌فرض)' : faNum(usage.limit));
    const t = `🧠 <b>مربی — ${esc(name)}</b>\n\n🆔 شناسه: <code>${esc(id)}</code>\n📅 امروز: ${usedLine}\n🎚️ سقف روزانه: ${limitLine}`;
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('۳ (پیش‌فرض)', `coach:set:${id}:default`), Markup.button.callback('۵', `coach:set:${id}:5`), Markup.button.callback('۱۰', `coach:set:${id}:10`)],
      [Markup.button.callback('۲۰', `coach:set:${id}:20`), Markup.button.callback('♾️ نامحدود', `coach:set:${id}:inf`)],
      [Markup.button.callback('← بازگشت به کاربران', 'admin_users')],
    ]);
    return ctx.replyWithHTML(t + FOOTER, kb);
  }

  bot.action(/^coach:u:(\d+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    return coachUserDetail(ctx, ctx.match[1]);
  });

  bot.action(/^coach:set:(\d+):(default|5|10|20|inf)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    const id = ctx.match[1];
    const val = ctx.match[2];
    const users = await getUsers();
    const name = users.get(String(id))?.name || 'کاربر';
    if (val === 'default') {
      await setCoachLimit(coachKV, id, null);
      await ctx.replyWithHTML(`✅ سقف مربی برای «${esc(name)}» برگشت به پیش‌فرض (۳ جواب در روز).` + FOOTER);
    } else {
      const limit = val === 'inf' ? 'inf' : Number(val);
      await setCoachLimit(coachKV, id, limit);
      const label = limit === 'inf' ? 'نامحدود' : `${faNum(limit)} جواب در روز`;
      await ctx.replyWithHTML(`✅ سقف مربی برای «${esc(name)}» شد ${label}.` + FOOTER);
    }
    return coachUserDetail(ctx, id);
  });

  // بروزرسانی دستی (فقط مدیر): ماشهٔ رفرش را می‌زند؛ گزارش اجرا بعداً همین‌جا می‌آید.
  bot.action('admin_refresh', async (ctx) => {
    if (!requireAdmin(ctx)) return ctx.answerCbQuery();
    try { await ctx.answerCbQuery(); } catch { /* شناسهٔ query منقضی — مهم نیست */ }
    const n = clearCache();
    const trigger = deps.triggerRefresh;
    if (typeof trigger !== 'function') {
      return ctx.replyWithHTML(`🔄 کش دادهٔ زنده پاک شد (${faNum(n)} مورد).` + FOOTER);
    }
    let res = null;
    try { res = await trigger(); } catch { res = { ok: false, status: 0 }; }
    if (res && res.ok) {
      return ctx.replyWithHTML(`🔄 بروزرسانی شروع شد (کش هم پاک شد: ${faNum(n)} مورد).\n\n⏳ چند دقیقه صبر کن — گزارشش همین‌جا می‌آید.` + FOOTER);
    }
    return ctx.replyWithHTML(`❌ شروع بروزرسانی نشد (وضعیت: ${res && res.status ? faNum(res.status) : 'نامشخص'}). دوباره تلاش کن.` + FOOTER);
  });

  bot.action('admin_logs', async (ctx) => {
    if (!requireAdmin(ctx)) return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    const logs = await recentLogsFn();
    if (logs && logs.note) return ctx.replyWithHTML(`📝 ${esc(logs.note)}` + FOOTER);
    const lines = (logs && logs.lines) || [];
    if (!lines.length) return ctx.replyWithHTML('📝 لاگی پیدا نشد.' + FOOTER);
    return ctx.replyWithHTML(`📝 <b>۱۰ خط آخر لاگ</b>\n\n<pre>${esc(lines.join('\n')).slice(-3000)}</pre>` + FOOTER);
  });

  bot.action('admin_miniapp', async (ctx) => {
    if (!requireAdmin(ctx)) return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    return ctx.replyWithHTML(
      `🔗 <b>مینی‌اپ</b>\n\nآدرس فعلی: ${esc(miniappUrl || 'تنظیم نشده')}\n\n` + (isWorker ? 'برای تغییر آن، متغیر MINIAPP_URL را در داشبورد Cloudflare عوض کن.' : 'برای تغییر آن، فایل miniapp.url را عوض کن و ربات را ری‌استارت کن.') + FOOTER,
    );
  });

  bot.action('admin_broadcast', async (ctx) => {
    if (!requireAdmin(ctx)) return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    await sessionStore.set('broadcast', ctx.chat.id, { step: 'text' });
    return ctx.replyWithHTML(`📣 <b>پیام همگانی</b>\n\nمتن پیامی را که می‌خواهی به همهٔ کاربران ربات (${faNum((await getUsers()).size)} نفر) برود بفرست.\n\nبرای لغو، /cancel را بفرست.` + FOOTER);
  });

  bot.action(/^admin_bc:(send|cancel)$/, async (ctx) => {
    const chatId = ctx.chat.id;
    const draft = await sessionStore.get('broadcast', chatId);
    if (!requireAdmin(ctx)) return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    if (!draft?.text) { await sessionStore.delete('broadcast', chatId); return ctx.replyWithHTML('پیش‌نویسی برای ارسال نیست.' + FOOTER); }
    if (ctx.match[1] === 'cancel') { await sessionStore.delete('broadcast', chatId); return ctx.replyWithHTML('❌ ارسال پیام همگانی لغو شد.' + FOOTER); }
    await sessionStore.delete('broadcast', chatId);
    const targets = [...(await getUsers()).keys()].filter((id) => id !== String(ctx.from.id));
    let ok = 0, fail = 0;
    for (const id of targets) {
      try { await ctx.telegram.sendMessage(id, draft.text); ok++; }
      catch { fail++; }
      await new Promise((r) => setTimeout(r, 50));
    }
    return ctx.replyWithHTML(`✅ پیام همگانی ارسال شد.\n\n📬 موفق: ${faNum(ok)} نفر\n❌ ناموفق: ${faNum(fail)} نفر` + FOOTER);
  });

  // ---------- منوی شیشه‌ای ----------
  bot.action('menu_heroes', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.replyWithHTML(
      `🦸 <b>هیروها بر اساس نقش</b>\n\n${faNum(sd.heroes.length)} هیرو در ۶ نقش — یکی را انتخاب کن:` + FOOTER,
      rolePickerKeyboard('heroes'),
    );
  });
  bot.action('menu_meta', async (ctx) => { await ctx.answerCbQuery(); return sendMeta(ctx); });
  bot.action('menu_counter', async (ctx) => { await ctx.answerCbQuery(); return sendCounterMode(ctx); });
  bot.action('menu_build', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.replyWithHTML('🛠️ <b>بیلد</b>\n\nهیرویی را انتخاب کن:' + FOOTER, rolePickerKeyboard('build'));
  });
  bot.action('menu_wr', async (ctx) => {
    await ctx.answerCbQuery();
    await sessionStore.delete('wrPick', ctx.chat.id);
    return sendWrStep(ctx, 'm');
  });
  bot.action('menu_mpl', async (ctx) => { await ctx.answerCbQuery(); return sendMplLeagues(ctx); });
  bot.action('menu_news', async (ctx) => { await ctx.answerCbQuery(); return sendNews(ctx); });
  bot.action('menu_tier', async (ctx) => { await ctx.answerCbQuery(); return sendTier(ctx); });
  bot.action('menu_comps', async (ctx) => { await ctx.answerCbQuery(); return sendComps(ctx); });
  bot.action('menu_lore', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.replyWithHTML('📖 <b>داستان‌ها</b>\n\nهیرویی را انتخاب کن:' + FOOTER, rolePickerKeyboard('lore'));
  });
  bot.action('menu_patch', async (ctx) => { await ctx.answerCbQuery(); return sendPatchList(ctx); });
  bot.action('menu_items', async (ctx) => { await ctx.answerCbQuery(); return sendItemCategories(ctx); });
  bot.action('menu_emblems', async (ctx) => { await ctx.answerCbQuery(); return sendEmblemPicker(ctx); });
  bot.action(/^itemcat:(.+)$/, async (ctx) => { await ctx.answerCbQuery(); return sendItemList(ctx, ctx.match[1]); });
  bot.action(/^item:([a-zA-Z0-9]+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const it = (sd.items || []).find((x) => String(x.id) === ctx.match[1]);
    if (!it) return ctx.replyWithHTML('❌ آیتم پیدا نشد.' + FOOTER, itemCategoryKeyboard());
    return sendItemDetail(ctx, it);
  });
  bot.action(/^emblem:([a-zA-Z0-9]+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const e = (sd.emblems || []).find((x) => String(x.id) === ctx.match[1]);
    if (!e) return ctx.replyWithHTML('❌ امبلم پیدا نشد.' + FOOTER, homeKeyboard());
    return sendEmblemDetail(ctx, e);
  });
  bot.action(/^spell:(\d+)$/, async (ctx) => { await ctx.answerCbQuery(); return sendSpellDetail(ctx, ctx.match[1]); });
  bot.action('menu_home', async (ctx) => { await ctx.answerCbQuery(); return sendMainMenu(ctx); });
  bot.action('coach', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.replyWithHTML('🧠 <b>مربی هوش مصنوعی</b>\n\nسؤالت را همین‌جا بنویس — بدون دستور، فقط سؤال را بنویس.\n\nمثلاً: بهترین بیلد Miya برای لین گلد چیست؟' + FOOTER);
  });

  // ---------- انتخاب‌کنندهٔ هیرو (نقش → هیرو) ----------
  // «roles» باید قبل از «role:» ثبت شود، وگرنه regex نقش «roles» را هم می‌گیرد
  bot.action(/^pick:([a-zA-Z]+):roles$/, async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.replyWithHTML('یکی از نقش‌ها را انتخاب کن:' + FOOTER, rolePickerKeyboard(ctx.match[1]));
  });
  bot.action(/^pick:([a-zA-Z]+):role:(.+)$/, async (ctx) => {
    const [, purpose, role] = ctx.match;
    const kb = heroPickerKeyboard(purpose, role);
    if (!kb) return ctx.answerCbQuery('نقش پیدا نشد');
    await ctx.answerCbQuery();
    const g = sd.heroesByRole().find((x) => x.en === role);
    return ctx.replyWithHTML(`${g.emoji} <b>${g.en} (${faNum(g.count)})</b>\n\nیکی از هیروها را انتخاب کن:` + FOOTER, kb);
  });
  bot.action(/^pick:([a-zA-Z]+):hero:(\d+)$/, async (ctx) => {
    const [, purpose, idStr] = ctx.match;
    const hero = sd.heroById(idStr);
    if (!hero) return ctx.answerCbQuery('هیرو پیدا نشد');
    if (purpose === 'counterTeam') return pickCounterTeamHero(ctx, hero);
    await ctx.answerCbQuery();
    if (purpose === 'build') return askLane(ctx, hero);
    if (purpose === 'counter') {
      await ctx.replyWithHTML('⏳ در حال گرفتن کانترها…');
      return sendCounters(ctx, hero);
    }
    if (purpose === 'lore') return sendLore(ctx, hero);
    return sendHeroDetail(ctx, hero);
  });

  // ---------- کانتر تیمی ----------
  bot.action('counter:mode:single', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.replyWithHTML('⚔️ <b>کانتر یک هیرو</b>\n\nهیرویی را انتخاب کن:' + FOOTER, rolePickerKeyboard('counter'));
  });
  bot.action('counter:mode:team', async (ctx) => {
    await ctx.answerCbQuery();
    await sessionStore.set('counterTeam', ctx.chat.id, { heroes: [] });
    return ctx.replyWithHTML('🛡️ <b>تیم حریف</b>\n\nهیروهای تیم حریف را یکی‌یکی انتخاب کن (۲ تا ۵ هیرو):' + FOOTER, rolePickerKeyboard('counterTeam'));
  });
  bot.action('counter:addmore', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.replyWithHTML('🛡️ <b>تیم حریف</b>\n\nهیروی دیگری را انتخاب کن:' + FOOTER, rolePickerKeyboard('counterTeam'));
  });
  bot.action('counter:calc', async (ctx) => {
    const st = (await sessionStore.get('counterTeam', ctx.chat.id)) || { heroes: [] };
    const heroes = st.heroes.map((id) => sd.heroById(id)).filter(Boolean);
    if (heroes.length < 2) {
      await ctx.answerCbQuery('اول حداقل ۲ هیرو انتخاب کن');
      return sendCounterPicks(ctx);
    }
    await ctx.answerCbQuery();
    await sessionStore.delete('counterTeam', ctx.chat.id);
    return sendTeamCounters(ctx, heroes);
  });
  bot.action('counter:clear', async (ctx) => {
    await ctx.answerCbQuery();
    await sessionStore.delete('counterTeam', ctx.chat.id);
    return sendCounterMode(ctx);
  });

  // ---------- پچ و جزئیات هیرو ----------
  bot.action(/^patch:(\d+)$/, async (ctx) => {
    const titles = patchTitles();
    const key = titles[Number(ctx.match[1])];
    if (!key) return ctx.answerCbQuery('پچ پیدا نشد');
    await ctx.answerCbQuery();
    return showPatch(ctx, key);
  });
  bot.action(/^hero:(counter|build|lore):(\d+)$/, async (ctx) => {
    const [, kind, idStr] = ctx.match;
    const hero = sd.heroById(idStr);
    if (!hero) return ctx.answerCbQuery('هیرو پیدا نشد');
    await ctx.answerCbQuery();
    if (kind === 'counter') {
      await ctx.replyWithHTML('⏳ در حال گرفتن کانترها…');
      return sendCounters(ctx, hero);
    }
    if (kind === 'build') return askLane(ctx, hero);
    return sendLore(ctx, hero);
  });

  // ---------- ماشین وین‌ریت ----------
  bot.action(/^wr:m:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await sessionStore.set('wrPick', ctx.chat.id, { m: Number(ctx.match[1]) });
    return sendWrStep(ctx, 'now');
  });
  bot.action(/^wr:now:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const st = (await sessionStore.get('wrPick', ctx.chat.id)) || {};
    if (!st.m) return sendWrStep(ctx, 'm');
    st.now = Number(ctx.match[1]);
    await sessionStore.set('wrPick', ctx.chat.id, st);
    return sendWrStep(ctx, 'tgt');
  });
  bot.action(/^wr:tgt:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const st = (await sessionStore.get('wrPick', ctx.chat.id)) || {};
    if (!st.m || st.now == null) return sendWrStep(ctx, 'm');
    const fut = Number(ctx.match[1]);
    if (fut <= st.now) {
      return ctx.replyWithHTML('⚠️ وین‌ریت هدف باید بیشتر از وین‌ریت فعلی باشد. هدف دیگری انتخاب کن:' + FOOTER, wrStepKeyboard('tgt'));
    }
    const n = wrNeeded(st.m, st.now, fut);
    await sessionStore.delete('wrPick', ctx.chat.id);
    return ctx.replyWithHTML(wrResultText(st.m, st.now, fut, n) + FOOTER, homeKeyboard());
  });

  bot.catch((err, ctx) => {
    console.error('[bot] error', err);
    ctx.replyWithHTML('❌ خطایی پیش آمد؛ دوباره تلاش کن.' + FOOTER).catch(() => {});
  });

  return bot;
}

module.exports = { createBot, playerSessions: defaultSessionStore._playerSessions };
