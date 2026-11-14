// ربات تلگرام MLBB — Telegraf با polling
// همهٔ متن‌ها فارسی و راست‌چین؛ فوتر منبع داده در همهٔ پاسخ‌ها
const { Telegraf, Markup } = require('telegraf');
const { roneGet, ronePost, clearCache, normRankRecord, normCounterRecord, normBuildRecord, normStanding, equipNameMap } = require('./rone');
const sd = require('./staticData');
const { faNum, faInt, pct, esc, FOOTER, cleanText, truncate, ROLES, roleFa, laneFa } = require('./fa');
const { askCoach } = require('./coach');

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
  const maps = { player: playerSessions, broadcast: adminBroadcasts };
  return {
    async get(kind, chatId) { return (maps[kind] && maps[kind].get(chatId)) || null; },
    async set(kind, chatId, value) { if (maps[kind]) maps[kind].set(chatId, value); },
    async delete(kind, chatId) { if (maps[kind]) maps[kind].delete(chatId); },
    _playerSessions: playerSessions,
    _adminBroadcasts: adminBroadcasts,
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
    t += '\n\nنام انگلیسی هیرو را بنویس؛ مثلاً: /hero Miya';
  } else {
    t += '\nنام انگلیسی هیرو را کامل یا بخشی از آن را بنویس؛ مثلاً: /hero Miya یا /hero Gusion';
  }
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
// deps: { isWorker, userStore, sessionStore, recentLogs, welcomePhoto, telegramClient }
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

  function mainMenuKeyboard(isAdminUser = false) {
    const rows = [
      [Markup.button.callback('🦸 هیروها', 'menu_heroes'), Markup.button.callback('📊 متا', 'menu_meta')],
      [Markup.button.callback('⚔️ کانتر', 'menu_counter'), Markup.button.callback('🛠️ بیلد', 'menu_build')],
      [Markup.button.callback('🧮 ماشین وین‌ریت', 'menu_wr'), Markup.button.callback('🏆 MPL', 'menu_mpl')],
      [Markup.button.callback('🧠 مربی هوش مصنوعی', 'coach')],
    ];
    if (isAdminUser) rows.push([Markup.button.callback('🛠️ پنل مدیریت', 'menu_admin')]);
    const wa = webAppButton();
    if (wa) rows.unshift([wa]);
    return Markup.inlineKeyboard(rows);
  }

  const helpText = `🤖 <b>راهنمای ربات MLBB</b>

<b>دستورها:</b>
/hero &lt;نام هیرو&gt; — اطلاعات هیرو، اسکیل‌ها و وین‌ریت زنده
/lore &lt;نام هیرو&gt; — داستان کامل هیرو (فارسی)
/heroes — لیست هیروها بر اساس نقش (۱۳۳ هیرو در ۶ نقش)
/meta — برترین هیروهای متا (۷ روز اخیر، وین‌ریت)
/counter &lt;نام هیرو&gt; — بهترین کانترهای آن هیرو؛ چند هیرو: /counter Miya Layla
/ask &lt;سؤال&gt; — مربی هوش مصنوعی؛ مثلاً: /ask بهترین بیلد Miya چیست؟
/build &lt;نام هیرو&gt; — بیلد پیشنهادی (بعد لین را انتخاب کن)
/items — لیست آیتم‌ها
/item &lt;نام آیتم&gt; — جزییات آیتم
/emblems — امبلم‌ها و تلنت‌ها
/wr &lt;مچ فعلی&gt; &lt;وین‌ریت فعلی&gt; &lt;وین‌ریت هدف&gt; — چند برد پشت سر هم لازم است؟
/mpl — جدول لیگ‌های MPL (ID / PH / MY / KH)
/player — اتصال پروفایل بازی (با کد تایید داخل بازی)
/news — اخبار و پچ‌نوت‌های بازی
/patch [نسخه] — متن کامل پچ‌نوت (فارسی)؛ بدون نسخه، تازه‌ترین پچ
/comps — ترکیب‌های تیمی پیشنهادی + راهنما
/tier — تیرلیست هیروها
/version — نسخهٔ فعلی بازی
/admin — پنل مدیریت (فقط مدیر)
/help — همین راهنما

🔍 نام هیرو را می‌توانی به انگلیسی، کامل یا بخشی از آن بنویسی؛ مثلاً <code>/hero miy</code> هم Miya را پیدا می‌کند.

🎮 مینی‌اپ فارسی هم از دکمهٔ «باز کردن مینی‌اپ» در /start باز می‌شود.` + FOOTER;

  // ثبت هر کاربری که با ربات حرف می‌زند (برای شمارش و پیام همگانی)
  bot.use(async (ctx, next) => { await trackUser(ctx); return next(); });

  bot.start(async (ctx) => {
    const kb = mainMenuKeyboard(isAdmin(ctx));
    const waNote = miniappUrl
      ? '🎮 با دکمهٔ زیر مینی‌اپ فارسی را باز کن:'
      : '⚠️ مینی‌اپ هنوز روی هاست HTTPS تنظیم نشده است (MINIAPP_URL خالی است) — دستورهای زیر بدون مینی‌اپ هم کار می‌کنند.';
    const caption =
      `👋 سلام! به <b>Persian Mlbb</b> خوش آمدی.\n\nربات فارسی Mobile Legends: Bang Bang — هیروها بر اساس نقش، متا، کانتر، بیلد، آیتم، امبلم، اخبار و تیرلیست و جدول MPL، همه به فارسی و با دادهٔ زنده.\n\n${waNote}\n\nبرای راهنما: /help` +
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
  bot.command('hero', async (ctx) => {
    const q = ctx.message.text.replace(/^\/hero(@\S+)?\s*/i, '').trim();
    if (!q) return ctx.replyWithHTML('نام هیرو را بنویس؛ مثلاً: <code>/hero Miya</code>' + FOOTER);
    const hero = sd.findHero(q);
    if (!hero) {
      return ctx.replyWithHTML(esc(heroNotFoundText(q, sd.searchHeroes(q, 5))));
    }
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
    t += `\n\nبرای کانتر: <code>/counter ${esc(hero.hero_name)}</code>\nبرای بیلد: <code>/build ${esc(hero.hero_name)}</code>\nبرای داستان: <code>/lore ${esc(hero.hero_name)}</code>`;
    t += FOOTER;
    if (head) {
      try {
        if (t.length <= 1000) return await ctx.replyWithPhoto(head, { caption: t, parse_mode: 'HTML' });
        // کپشن عکس حداکثر ۱۰۲۴ کاراکتر است؛ برای هیروهای شلوغ عکس با خلاصه می‌آید و متن کامل پیام بعد است
        const cap = `🦸 <b>${esc(hero.hero_name)}</b>` + (hero.class ? ` — ${roleFa(hero.class)}` : '') + (hero.laning?.length ? `\n🛤️ لین: ${laneFa(hero.laning)}` : '') + (rank ? `\n\n📊 <b>آمار زنده (۷ روز اخیر)</b>\nوین‌ریت: ${pct(rank.win)}\nبن‌ریت: ${pct(rank.ban)}\nپیک‌ریت: ${pct(rank.pick)}` : '') + (skills.length ? '\n\n✨ <b>اسکیل‌ها:</b>' + skills.map((sk) => `\n• <b>${esc(sk.name)}</b>`).join('') : '') + FOOTER;
        await ctx.replyWithPhoto(head, { caption: cap, parse_mode: 'HTML' });
        return await ctx.replyWithHTML(t);
      } catch { /* بدون عکس ادامه بده */ }
    }
    return ctx.replyWithHTML(t);
  });

  // ---------- /heroes — لیست هیروها بر اساس نقش ----------
  function heroesRoleKeyboard() {
    const groups = sd.heroesByRole();
    const rows = groups.map((g) => [Markup.button.callback(`${g.emoji} ${g.en} (${faNum(g.count)})`, `heroes_role:${g.en}`)]);
    return Markup.inlineKeyboard(rows);
  }

  bot.command('heroes', async (ctx) => {
    const total = sd.heroes.length;
    return ctx.replyWithHTML(
      `🦸 <b>هیروها بر اساس نقش</b>\n\n${faNum(total)} هیرو در ۶ نقش — یکی را انتخاب کن:` + FOOTER,
      heroesRoleKeyboard(),
    );
  });

  bot.action(/^heroes_role:(.+)$/, async (ctx) => {
    const role = ctx.match[1];
    const g = sd.heroesByRole().find((x) => x.en === role);
    if (!g) return ctx.answerCbQuery('نقش پیدا نشد');
    await ctx.answerCbQuery();
    let t = `${g.emoji} <b>${g.en} (${faNum(g.count)})</b>\n`;
    for (const h of g.heroes) {
      t += `\n• <b>${esc(h.name)}</b> — ${laneFa(h.laning)}`;
    }
    t += `\n\nبرای جزئیات هر هیرو: <code>/hero نام</code>` + FOOTER;
    // پیام تلگرام حداکثر ۴۰۹۶ کاراکتر — لیست نقش‌ها زیر این حد است، ولی برای اطمینان تکه‌تکه می‌فرستیم
    for (let i = 0; i < t.length; i += 3500) {
      await ctx.replyWithHTML(t.slice(i, i + 3500));
    }
  });

  // ---------- /meta ----------
  bot.command('meta', async (ctx) => {
    const r = await getRankList(7);
    if (!r.ok) return ctx.replyWithHTML(`❌ گرفتن متا فعلاً ممکن نشد: ${esc(r.error)}` + FOOTER);
    const top = [...r.all].sort((a, b) => (b.win ?? 0) - (a.win ?? 0)).slice(0, 10);
    let t = '📊 <b>برترین هیروهای متا — ۷ روز اخیر (بر اساس وین‌ریت)</b>\n';
    top.forEach((h, i) => {
      t += `\n${faNum(i + 1)}. <b>${esc(h.name)}</b> — وین ${pct(h.win)} | بن ${pct(h.ban)} | پیک ${pct(h.pick)}`;
    });
    t += FOOTER;
    return ctx.replyWithHTML(t);
  });

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
    if (!q) return ctx.replyWithHTML('نام هیرو را بنویس؛ مثلاً: <code>/counter Miya</code> یا تیمی: <code>/counter Miya Layla</code>' + FOOTER);
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
    if (!valid.length) return ctx.replyWithHTML(esc(heroNotFoundText(q, sd.searchHeroes(q, 5))));
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
  bot.command('ask', async (ctx) => {
    const q = ctx.message.text.replace(/^\/ask(@\S+)?\s*/i, '').trim();
    if (!q) return ctx.replyWithHTML('سؤالت را بنویس؛ مثلاً: <code>/ask بهترین بیلد Miya برای لین گلد چیست؟</code>' + FOOTER);
    if (!coachAI) return ctx.replyWithHTML('مربی فقط روی ورکر فعال است.' + FOOTER);
    await ctx.replyWithHTML('🧠 مربی دارد فکر می‌کند…');
    const ans = await askCoach({ AI: coachAI }, { kv: coachKV }, q);
    if (!ans) return ctx.replyWithHTML('سؤالت را بنویس؛ مثلاً: <code>/ask بهترین بیلد Miya چیست؟</code>' + FOOTER);
    return ctx.replyWithHTML(esc(ans) + FOOTER);
  });

  // ---------- /build ----------
  async function askLane(ctx, hero) {
    const kb = Markup.inlineKeyboard(
      LANES.map((l) => [Markup.button.callback(l.fa, `build:${hero.mlid}:${l.v}`)]),
    );
    return ctx.replyWithHTML(`🛠️ بیلد <b>${esc(hero.hero_name)}</b> برای کدام لین؟` + FOOTER, kb);
  }
  bot.command('build', async (ctx) => {
    const q = ctx.message.text.replace(/^\/build(@\S+)?\s*/i, '').trim();
    if (!q) return ctx.replyWithHTML('نام هیرو را بنویس؛ مثلاً: <code>/build Miya</code>' + FOOTER);
    const hero = sd.findHero(q);
    if (!hero) return ctx.replyWithHTML(esc(heroNotFoundText(q, sd.searchHeroes(q, 5))));
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
  bot.command('news', async (ctx) => {
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
    return ctx.replyWithHTML(t);
  });

  // ---------- /patch — متن کامل پچ‌نوت (فارسی) ----------
  bot.command('patch', async (ctx) => {
    const q = ctx.message.text.replace(/^\/patch(@\S+)?\s*/i, '').trim();
    const patches = (sd.faContent || {}).patches || {};
    const titles = Object.keys(patches);
    if (!titles.length) return ctx.replyWithHTML('پچ‌نوتی فعلاً در دسترس نیست.' + FOOTER);
    let key = titles[0];
    if (q) {
      const normQ = q.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[^0-9.]/g, '');
      key = titles.find((t) => t.toLowerCase().includes(normQ.toLowerCase())) || null;
      if (!key) return ctx.replyWithHTML('پچی با این نسخه پیدا نشد؛ مثلاً: <code>/patch 2.2.16</code>' + FOOTER);
    }
    const p = sd.patchByTitle(key);
    if (!p) return ctx.replyWithHTML('جزئیات این پچ پیدا نشد.' + FOOTER);
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
    return ctx.replyWithHTML(t);
  });

  // ---------- /comps — ترکیب‌های تیمی ----------
  bot.command('comps', async (ctx) => {
    const comps = sd.teamComps || [];
    if (!comps.length) return ctx.replyWithHTML('ترکیب تیمی فعلاً در دسترس نیست.' + FOOTER);
    let t = '👥 <b>ترکیب‌های تیمی پیشنهادی</b>';
    for (const c of comps) {
      const titleFa = (((sd.faContent || {}).comps || {})[c.id] || {}).title_fa || c.title_fa || c.title;
      t += `\n\n<b>${esc(titleFa)}</b> — میانگین وین‌ریت ${pct(c.avg_win_rate)}`;
      for (const h of c.heroes) t += `\n• <b>${esc(h.name)}</b> — ${laneFa([h.lane])} (وین ${pct(h.win_rate)})`;
    }
    t += FOOTER;
    return ctx.replyWithHTML(t);
  });

  // ---------- /lore — داستان کامل هیرو (فارسی) ----------
  bot.command('lore', async (ctx) => {
    const q = ctx.message.text.replace(/^\/lore(@\S+)?\s*/i, '').trim();
    if (!q) return ctx.replyWithHTML('نام هیرو را بنویس؛ مثلاً: <code>/lore Miya</code>' + FOOTER);
    const hero = sd.findHero(q);
    if (!hero) {
      return ctx.replyWithHTML(esc(heroNotFoundText(q, sd.searchHeroes(q, 5))));
    }
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
        return await ctx.replyWithHTML(esc(body));
      } catch { /* بدون عکس ادامه بده */ }
    }
    return ctx.replyWithHTML(`📖 <b>داستان ${esc(hero.hero_name)}</b>` + (infoBits ? `\n${esc(infoBits)}` : '') + `\n\n${esc(body)}` + FOOTER);
  });

  bot.command('tier', async (ctx) => {
    const tl = sd.tierlist || {};
    const order = ['SS', 'S', 'A', 'B', 'C', 'D'];
    if (!order.some((k) => ((tl.tiers || {})[k] || []).length)) {
      return ctx.replyWithHTML('❌ تیرلیست فعلاً در دسترس نیست.' + FOOTER);
    }
    let t = '🏆 <b>تیرلیست هیروها</b>' + (tl.month ? ' — ' + esc(monthFa(tl.month)) : '');
    for (const k of order) {
      const list = (tl.tiers || {})[k] || [];
      if (!list.length) continue;
      t += `\n\n<b>${k}</b> (${faNum(list.length)}): ` + list.map((h) => esc(h.name)).join('، ');
    }
    t += FOOTER;
    return ctx.replyWithHTML(t);
  });

  // ---------- /items و /item ----------
  bot.command('items', async (ctx) => {
    const byCat = {};
    for (const it of sd.items) {
      const c = it.item_category || 'سایر';
      (byCat[c] = byCat[c] || []).push(it);
    }
    let t = `🧰 <b>آیتم‌ها (${faNum(sd.items.length)} آیتم)</b>\n`;
    for (const [cat, list] of Object.entries(byCat)) {
      t += `\n<b>${esc(cat)}:</b> ` + list.slice(0, 12).map((i) => esc(i.item_name)).join('، ');
      if (list.length > 12) t += ` و ${faNum(list.length - 12)} تای دیگر…`;
    }
    t += '\n\nبرای جزییات یک آیتم: <code>/item Berserker</code>';
    t += FOOTER;
    return ctx.replyWithHTML(t);
  });
  bot.command('item', async (ctx) => {
    const q = ctx.message.text.replace(/^\/item(@\S+)?\s*/i, '').trim();
    if (!q) return ctx.replyWithHTML('نام آیتم را بنویس؛ مثلاً: <code>/item Berserker</code>' + FOOTER);
    const it = sd.findItem(q);
    if (!it) {
      const sug = sd.searchItems(q, 5);
      let t = `❌ آیتمی با نام «${q}» پیدا نشد.`;
      if (sug.length) t += '\n\nشاید منظورت این‌هاست:\n' + sug.map((x) => `• ${x.item_name}`).join('\n');
      return ctx.replyWithHTML(esc(t) + FOOTER);
    }
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
    return ctx.replyWithHTML(t);
  });

  // ---------- /emblems ----------
  bot.command('emblems', async (ctx) => {
    let t = `🛡️ <b>امبلم‌ها (${faNum(sd.emblems.length)})</b>\n`;
    for (const e of sd.emblems) {
      t += `\n<b>${esc(e.emblem_name)}</b>${e.emblem_role ? ` (${esc(e.emblem_role)})` : ''}`;
      const mods = (e.modifiers || []).flatMap((m) => Object.entries(m).map(([k, v]) => `${k}: ${v}`));
      if (mods.length) t += `\n  ${esc(mods.join('، '))}`;
    }
    const tiers = sd.talents || {};
    const allTalents = [...(tiers.tier1 || []), ...(tiers.tier2 || []), ...(tiers.tier3 || [])];
    if (allTalents.length) {
      t += `\n\n⭐ <b>تلنت‌ها (${faNum(allTalents.length)}):</b>\n` + allTalents.map((x) => `• <b>${esc(x.name)}</b> — ${esc(sd.faTalent(x.id) || x.description)}`).join('\n');
    }
    t += '\n\n⚠️ اسپل‌ها (Battle Spells) از دادهٔ زنده خوانده می‌شوند؛ در مینی‌اپ تب «امبلم/اسپل» را ببین.';
    t += FOOTER;
    return ctx.replyWithHTML(t);
  });

  // ---------- /wr ----------
  function wrNeeded(matchNow, wrNow, wrFuture) {
    const m = matchNow, cur = wrNow / 100, tgt = wrFuture / 100;
    if (tgt >= 1) return Infinity;
    const wins = m * cur;
    const n = (tgt * m - wins) / (1 - tgt);
    return Math.max(0, Math.ceil(n - 1e-9));
  }
  bot.command('wr', async (ctx) => {
    const args = ctx.message.text.replace(/^\/wr(@\S+)?\s*/i, '').trim().split(/\s+/).map(Number);
    if (args.length < 3 || args.some((x) => !Number.isFinite(x))) {
      return ctx.replyWithHTML('فرمت درست: <code>/wr 100 50 60</code>\nیعنی: ۱۰۰ مچ، وین‌ریت فعلی ۵۰٪، هدف ۶۰٪' + FOOTER);
    }
    const [m, now, fut] = args;
    if (fut <= now) return ctx.replyWithHTML('⚠️ وین‌ریت هدف باید بیشتر از وین‌ریت فعلی باشد.' + FOOTER);
    const r = await roneGet(`/addon/win-rate-calculator?match-now=${m}&wr-now=${now}&wr-future=${fut}`);
    let n = r.ok ? (r.raw?.required_no_lose_matches ?? r.raw?.data?.required_no_lose_matches) : null;
    if (n == null) n = wrNeeded(m, now, fut); // فالبک محاسبهٔ محلی
    let t = `🧮 <b>ماشین‌حساب وین‌ریت</b>\n\nمچ فعلی: ${faInt(m)}\nوین‌ریت فعلی: ${pct(now)}\nهدف: ${pct(fut)}\n\n✅ برای رسیدن به ${pct(fut)} باید <b>${faInt(n)} برد پشت سر هم</b> بدون باخت بگیری.`;
    if (!r.ok) t += '\n\n(محاسبهٔ محلی — سرویس زنده در دسترس نبود.)';
    t += FOOTER;
    return ctx.replyWithHTML(t);
  });

  // ---------- /mpl ----------
  bot.command('mpl', async (ctx) => {
    const kb = Markup.inlineKeyboard(LEAGUES.map((l) => [Markup.button.callback(l.fa, `mpl:${l.v}`)]));
    return ctx.replyWithHTML('🏆 کدام لیگ MPL؟' + FOOTER, kb);
  });
  bot.action(/^mpl:(id|ph|my|kh)$/, async (ctx) => {
    const league = ctx.match[1];
    const name = (LEAGUES.find((l) => l.v === league) || {}).fa || league;
    await ctx.answerCbQuery('⏳ در حال گرفتن جدول…');
    const r = await roneGet(`/esports/${league}/standings`);
    if (!r.ok) {
      return ctx.replyWithHTML(`❌ جدول ${esc(name)} فعلاً در دسترس نیست: ${esc(r.error)}\n\nممکن است فصل این لیگ شروع نشده باشد یا سرویس بالادستی خطا بدهد.` + FOOTER);
    }
    const rows = r.records.map(normStanding).slice(0, 10);
    if (!rows.length) return ctx.replyWithHTML(`🏆 ${esc(name)}\n\nفعلاً ردیفی در جدول نیست.` + FOOTER);
    let t = `🏆 <b>جدول ${esc(name)}</b>\n`;
    rows.forEach((d) => {
      t += `\n${faNum(d.rank ?? 0)}. <b>${esc(d.team)}</b>${d.fullName ? ` (${esc(d.fullName)})` : ''}${d.wins != null ? ` — برد ${faNum(d.wins)}` : ''}${d.losses != null ? ` | باخت ${faNum(d.losses)}` : ''}${d.points != null ? ` | امتیاز ${faNum(d.points)}` : ''}${d.gameWins != null ? ` | گیم ${faNum(d.gameWins)}–${faNum(d.gameLosses)}` : ''}`;
    });
    t += FOOTER;
    return ctx.replyWithHTML(t);
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
    if (!s || text.startsWith('/')) return next();
    if (s.step === 'gameId') {
      if (!/^\d+$/.test(text)) return ctx.replyWithHTML('⚠️ Game ID فقط عدد است. دوباره بفرست.' + FOOTER);
      s.gameId = text;
      s.step = 'zoneId';
      await sessionStore.set('player', ctx.chat.id, s);
      return ctx.replyWithHTML('حالا Zone ID (آیدی سرور/زون) را بفرست. معمولاً ۴ رقم است؛ مثلاً 1234.' + FOOTER);
    }
    if (s.step === 'zoneId') {
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
    if (s.step === 'code') {
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

  bot.action('admin_users', async (ctx) => {
    if (!requireAdmin(ctx)) return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    const users = await getUsers();
    const list = [...users.values()].sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || '')).slice(0, 10);
    let t = `👥 <b>کاربران ربات — ${faNum(users.size)} نفر</b>\n`;
    for (const u of list) {
      t += `\n• ${esc(u.name || '—')}${u.username ? ` (@${esc(u.username)})` : ''} — ${faNum((u.firstSeen || '').slice(0, 10))}`;
    }
    if (!list.length) t += '\n\nهنوز کسی ربات را استارت نکرده است.';
    return ctx.replyWithHTML(t + FOOTER);
  });

  bot.action('admin_refresh', async (ctx) => {
    if (!requireAdmin(ctx)) return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    const n = clearCache();
    return ctx.replyWithHTML(`🔄 کش دادهٔ زنده پاک شد (${faNum(n)} مورد). درخواست‌های بعدی مستقیم از سرور زنده خوانده می‌شوند.\n\n` + (isWorker ? 'دیتای استاتیک هر ۱۰ دقیقه از مینی‌اپ تازه می‌شود؛ نیازی به ری‌استارت نیست.' : 'دیتای استاتیک (هیرو/آیتم) موقع بالا آمدن ربات خوانده می‌شود؛ برای تغییر آن ری‌استارت لازم است.') + FOOTER);
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
      `🦸 <b>هیروها بر اساس نقش</b>\n\n${faNum(sd.heroes.length)} هیرو در ۶ نقش — یکی را انتخاب کن، یا نام هیرو را با دستور بفرست؛ مثلاً: <code>/hero Miya</code>` + FOOTER,
      heroesRoleKeyboard(),
    );
  });
  bot.action('menu_meta', async (ctx) => { await ctx.answerCbQuery(); return ctx.replyWithHTML('برای دیدن متا: /meta' + FOOTER); });
  bot.action('menu_counter', (ctx) => ctx.answerCbQuery().then(() => ctx.replyWithHTML('نام هیرو را بفرست؛ مثلاً: <code>/counter Gusion</code>' + FOOTER)));
  bot.action('menu_build', (ctx) => ctx.answerCbQuery().then(() => ctx.replyWithHTML('نام هیرو را بفرست؛ مثلاً: <code>/build Miya</code>' + FOOTER)));
  bot.action('menu_wr', (ctx) => ctx.answerCbQuery().then(() => ctx.replyWithHTML('فرمت: <code>/wr 100 50 60</code>' + FOOTER)));
  bot.action('menu_mpl', (ctx) => ctx.answerCbQuery().then(() => ctx.replyWithHTML('برای جدول MPL: /mpl' + FOOTER)));
  bot.action('coach', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.replyWithHTML('🧠 <b>مربی هوش مصنوعی</b>\n\nسؤالت را با دستور /ask بپرس؛ مثلاً:\n<code>/ask بهترین بیلد Miya برای لین گلد چیست؟</code>' + FOOTER);
  });

  bot.catch((err, ctx) => {
    console.error('[bot] error', err);
    ctx.replyWithHTML('❌ خطایی پیش آمد؛ دوباره تلاش کن.' + FOOTER).catch(() => {});
  });

  return bot;
}

module.exports = { createBot, playerSessions: defaultSessionStore._playerSessions };
