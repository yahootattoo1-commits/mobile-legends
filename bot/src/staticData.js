// دیتای استاتیک آفلاین p3hndrx/MLBB-API (فایل‌های v1 در data/)
// hero-meta-final.json: ۱۳۴ هیرو (رکورد اول placeholder با hero_name="None" است — نادیده گرفته می‌شود)
// item-meta-final.json: ۸۹ آیتم | emblem-meta-final.json: ۷ امبلم | talent-meta-final.json: ۳ تلنت
//
// دو مسیر لود دارد و هر دو همان state را می‌سازند:
//   ۱) Node (پیش‌فرض): فایل‌ها موقع require از دیسک خوانده می‌شوند (همگام، مثل قبل).
//   ۲) Workers: ensureRemote(baseUrl) فایل‌ها را با fetch می‌گیرد و state را جایگزین می‌کند.
// همهٔ خروجی‌ها getter هستند تا بعد از لود ریموت، خواننده‌ها همان دادهٔ تازه را ببینند.
const fs = require('fs');
const path = require('path');

// روی Workers ‏__dirname‏ نیست (باندل ESM) — پس DATA_DIR فقط روی Node ست می‌شود؛
// روی Workers لود دیسک رد می‌شود و ensureRemote دیتا را با fetch می‌گیرد.
const DATA_DIR = (typeof __dirname !== 'undefined') ? path.join(__dirname, '..', 'data') : null;

// فایل‌ها + کلیدشان در state — همین لیست در لودر ریموت (Workers) هم استفاده می‌شود
const DATA_FILES = [
  ['heroFile', 'hero-meta-final.json'],
  ['itemFile', 'item-meta-final.json'],
  ['emblemFile', 'emblem-meta-final.json'],
  ['talentFile', 'talent-meta-final.json'],
  ['faFile', 'fa-overrides.json'],
  ['fullBuildsFile', 'builds-full.json'],
  ['newsFile', 'news.json'],
  ['tierlistFile', 'tierlist.json'],
  ['discussionsFile', 'discussions.json'],
  ['eventsFile', 'events.json'],
  ['channelNewsFile', 'channel-news.json'],
  ['faContentFile', 'fa-content.json'],
  ['heroStatsFile', 'hero-stats.json'],
  ['teamCompsFile', 'team-comps.json'],
  ['teamCompGuideFile', 'team-comp-guide.json'],
  ['patchFullFile', 'patch-notes-full.json'],
  ['matchupsFile', 'matchups.json'],
];

function loadJson(file) {
  if (!DATA_DIR) return { data: [] }; // Workers: no disk — remote load fills state
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
  } catch (e) {
    console.warn('[static] cannot load', file, e.message);
    return { data: [] };
  }
}

function loadDiskFiles() {
  const out = {};
  for (const [key, file] of DATA_FILES) out[key] = loadJson(file);
  return out;
}

// ساخت state مشتق‌شده از فایل‌های خام — برای هر دو مسیر لود یکسان است
function buildState(f) {
  // ترجمهٔ فارسی توضیحات (data/fa-overrides.json) — اگر نباشد، متن انگلیسی نشان داده می‌شود
  const FA = {
    heroSkills: (f.faFile && f.faFile.heroSkills) || {},
    items: (f.faFile && f.faFile.items) || {},
    talents: (f.faFile && f.faFile.talents) || {},
    spells: (f.faFile && f.faFile.spells) || {},
  };
  // بیلد کامل ۶ آیتمی از mlbb.io (data/builds-full.json) — اگر نباشد، خالی است
  const fullBuilds = (f.fullBuildsFile && f.fullBuildsFile.heroes) || {};
  // اخبار و تیرلیست + انجمن + ایونت‌ها — اگر نباشند، خالی است
  const news = { patchNotes: (f.newsFile && f.newsFile.patch_notes) || [], wikiRecent: (f.newsFile && f.newsFile.wiki_recent) || [] };
  const discussions = (f.discussionsFile && f.discussionsFile.threads) || [];
  const events = (f.eventsFile && f.eventsFile.events) || [];
  const channelNews = (f.channelNewsFile && f.channelNewsFile.items) || [];
  const faContent = (f.faContentFile && f.faContentFile.version) ? f.faContentFile : { lore: {}, matchups: {}, patches: {}, events: {}, stats: { heroes: {} }, guide: {}, comps: {} };
  const heroStats = (f.heroStatsFile && f.heroStatsFile.heroes) || [];
  const teamComps = (f.teamCompsFile && f.teamCompsFile.comps) || [];
  const teamCompGuide = f.teamCompGuideFile || { faqs: [], how_it_works: '' };
  const patchFull = (f.patchFullFile && f.patchFullFile.patches) || [];
  const matchups = (f.matchupsFile && f.matchupsFile.heroes) || {};
  const tierlist = {
    month: (f.tierlistFile && f.tierlistFile.month) || null,
    tiers: (f.tierlistFile && f.tierlistFile.tiers) || {},
    counts: (f.tierlistFile && f.tierlistFile.counts) || {},
  };
  const heroes = (f.heroFile.data || []).filter((h) => h && h.hero_name && h.hero_name !== 'None');
  const items = f.itemFile.data || [];
  const emblems = f.emblemFile.data || [];
  const talents = f.talentFile.data || {}; // { tier1: [...], tier2: [...], tier3: [...] }
  return {
    heroes, items, emblems, talents, fullBuilds, news, tierlist, discussions, events, channelNews,
    faContent, heroStats, teamComps, teamCompGuide, patchFull, matchups, FA,
    heroRevdate: (f.heroFile && f.heroFile.revdate) || null,
    itemRevdate: (f.itemFile && f.itemFile.revdate) || null,
    faCounts: {
      heroSkills: Object.keys(FA.heroSkills).length,
      items: Object.keys(FA.items).length,
      talents: Object.keys(FA.talents).length,
      spells: Object.keys(FA.spells).length,
    },
  };
}

let state = buildState(loadDiskFiles());

function logState(prefix) {
  console.log(`[static] ${prefix}heroes=${state.heroes.length} items=${state.items.length} emblems=${state.emblems.length} news=${state.news.patchNotes.length + state.news.wikiRecent.length} tierlist=${Object.values(state.tierlist.counts).reduce((a, b) => a + b, 0)} discussions=${state.discussions.length} events=${state.events.length} channelnews=${state.channelNews.length} facontent=${Object.keys(state.faContent.lore || {}).length}/${Object.keys(state.faContent.matchups || {}).length}/${Object.keys(state.faContent.patches || {}).length}/${Object.keys(state.faContent.events || {}).length} stats=${state.heroStats.length} comps=${state.teamComps.length} revdate=${state.heroRevdate || '?'}`);
}
logState('');

// ---------- لود ریموت (Cloudflare Workers): همهٔ فایل‌ها با fetch، با TTL ده دقیقه ----------
// روی Workers فایل دیسک نیست؛ ورودی مینی‌اپ/ربات قبل از هر هندل، ensureRemote را صدا می‌زند.
// اگر لود ناموفق باشد، state قبلی (دیسک یا لود قبلی) حفظ می‌شود و false برمی‌گردد.
const REMOTE_TTL_MS = 10 * 60 * 1000;
let remoteLoadedAt = 0;
let remotePromise = null;

// فایل‌هایی که اسکرپر ۳۰ دقیقه‌ای تازه می‌کند و در KV DATA ورکر هم هست؛
// بقیهٔ فایل‌ها فقط از Pages خوانده می‌شوند.
const KV_REFRESHABLE_FILES = new Set([
  'tierlist.json', 'news.json', 'discussions.json', 'events.json',
  'hero-stats.json', 'matchups.json', 'team-comps.json',
  'fa-content.json', 'patch-notes-full.json', 'builds-full.json',
]);

async function loadRemoteFiles(baseUrl, fetchImpl, kvGet) {
  const fetchFn = fetchImpl || fetch;
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const entries = await Promise.all(DATA_FILES.map(async ([key, file]) => {
    // اول KV (دیتای تازهٔ POSTشده)؛ اگر خالی/خطا بود، fallback به Pages.
    if (kvGet && KV_REFRESHABLE_FILES.has(file)) {
      try {
        const kvData = await kvGet(file);
        if (kvData && typeof kvData === 'object') return [key, kvData];
      } catch { /* fallback به fetch پایین */ }
    }
    try {
      const res = await fetchFn(`${base}/${file}`);
      if (!res.ok) return [key, { data: [] }];
      return [key, await res.json()];
    } catch {
      return [key, { data: [] }];
    }
  }));
  return Object.fromEntries(entries);
}

async function ensureRemote(baseUrl, fetchImpl, kvGet) {
  const now = Date.now();
  if (remoteLoadedAt && now - remoteLoadedAt < REMOTE_TTL_MS) return true;
  if (remotePromise) return remotePromise;
  remotePromise = (async () => {
    try {
      const files = await loadRemoteFiles(baseUrl, fetchImpl, kvGet);
      const next = buildState(files);
      if (!next.heroes.length) {
        console.warn('[static] remote load returned no heroes — keeping previous state');
        return false;
      }
      state = next;
      remoteLoadedAt = Date.now();
      logState('remote ');
      return true;
    } catch (e) {
      console.warn('[static] remote load failed — keeping previous state:', e.message);
      return false;
    } finally {
      remotePromise = null;
    }
  })();
  return remotePromise;
}

function isRemoteReady() {
  return remoteLoadedAt > 0;
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[m][n];
}

function faSkill(heroId, skillName) { return state.FA.heroSkills[`${heroId}|${norm(skillName)}`] || null; }
function faItem(itemId, name) { return state.FA.items[`${itemId}|${norm(name)}`] || null; }
function faTalent(id) { return state.FA.talents[String(id)] || null; }
function faSpell(name) { return state.FA.spells[norm(name)] || null; }
function loreById(id) { return (state.faContent.lore || {})[String(id)] || null; }
function statByName(name) {
  const s = state.heroStats.find((x) => norm(x.name) === norm(name));
  if (!s) return null;
  const f = ((state.faContent.stats || {}).heroes || {})[s.slug] || {};
  return { ...s, win_label_fa: f.win_label_fa || s.win_label, pick_label_fa: f.pick_label_fa || s.pick_label, ban_label_fa: f.ban_label_fa || s.ban_label, specialities_fa: f.specialities_fa || s.specialities || [] };
}
function matchupById(id) {
  const m = state.matchups[String(id)];
  if (!m) return null;
  const f = (state.faContent.matchups || {})[String(id)] || {};
  const cbFa = f.countered_by_fa || {};
  const rnFa = f.rank_notes_fa || {};
  return {
    ...m,
    countered_by: (m.countered_by || []).map((c) => ({ ...c, reason_fa: (cbFa[c.slug] || {}).reason_fa || c.reason, strength_fa: (cbFa[c.slug] || {}).strength_fa || c.strength })),
    rank_notes: (m.rank_notes || []).map((r) => ({ ...r, text_fa: (rnFa[r.slug] || {}).text_fa || r.text })),
  };
}
function patchByTitle(title) {
  const f = (state.faContent.patches || {})[title];
  if (!f) return null;
  const src = state.patchFull.find((p) => p.title === title) || {};
  return { ...src, ...f };
}

// جست‌وجوی هیرو: نام دقیق، شروع‌شونده، شامل‌شونده؛ اگر نبود نزدیک‌ترین‌ها
function searchHeroes(query, limit = 5) {
  const q = norm(query);
  if (!q) return [];
  const scored = state.heroes.map((h) => {
    const name = norm(h.hero_name);
    let score = -1;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 60;
    else {
      const d = levenshtein(name, q);
      if (d <= 2 && q.length >= 3) score = 40 - d * 5;
    }
    return { h, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.h);
}

function findHero(query) {
  const r = searchHeroes(query, 1);
  return r[0] || null;
}

function heroById(id) {
  const n = String(id);
  return state.heroes.find((h) => String(h.mlid) === n || String(h.id) === n || norm(h.hero_name) === norm(id)) || null;
}

function searchItems(query, limit = 5) {
  const q = norm(query);
  if (!q) return state.items.slice(0, limit);
  const scored = state.items.map((it) => {
    const name = norm(it.item_name);
    let score = -1;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 60;
    else {
      const d = levenshtein(name, q);
      if (d <= 3 && q.length >= 4) score = 40 - d * 5;
    }
    return { it, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.it);
}

function findItem(query) {
  const r = searchItems(query, 1);
  return r[0] || null;
}

function heroPublic(h) {
  return {
    id: h.mlid ? Number(h.mlid) : null,
    name: h.hero_name,
    class: h.class || '',
    laning: h.laning || [],
    portrait: h.portrait || '',
    hero_icon: h.hero_icon || '',
    skills: (h.skills || []).map((s) => ({
      name: s.skill_name,
      type: s.type,
      cooldown: s.cooldown,
      manacost: s.manacost,
      description: faSkill(h.mlid, s.skill_name) || s.description,
      icon: s.skill_icon,
      tags: s.tags || [],
    })),
  };
}

function itemPublic(it) {
  const d0 = (it.data && it.data[0]) || {};
  const mods = {};
  for (const m of d0.modifiers || []) Object.assign(mods, m);
  const passives = [
    ...((d0.passive || []).filter((p) => p.passive_name && p.passive_name !== 'null').map((p) => ({ name: p.passive_name, desc: faItem(it.id, p.passive_name) || p.description }))),
    ...((d0.unique_passive || []).filter((p) => p.unique_passive_name && p.unique_passive_name !== 'null').map((p) => ({ name: p.unique_passive_name, desc: faItem(it.id, p.unique_passive_name) || p.description }))),
  ];
  const actives = (d0.active || []).filter((a) => a.active_name && a.active_name !== 'null').map((a) => ({ name: a.active_name, desc: faItem(it.id, a.active_name) || a.description }));
  return {
    id: it.id,
    name: it.item_name,
    tier: it.item_tier,
    category: it.item_category,
    cost: d0.cost || null,
    summary: d0.summary || '',
    modifiers: mods,
    passives,
    actives,
  };
}

const { ROLES, roleList } = require('./fa');

// هیروها دسته‌بندی‌شده بر اساس نقش — هر هیروی دورنقشه در هر دو گروه می‌آید
// برمی‌گرداند: [{ en, fa, emoji, count, heroes: [heroPublic...] }, ...] به ترتیب ROLES
function heroesByRole() {
  return ROLES.map((r) => {
    const list = state.heroes
      .filter((h) => roleList(h.class).includes(r.en))
      .sort((a, b) => a.hero_name.localeCompare(b.hero_name))
      .map(heroPublic);
    return { en: r.en, fa: r.fa, emoji: r.emoji, count: list.length, heroes: list };
  });
}

module.exports = {
  get heroes() { return state.heroes; },
  get items() { return state.items; },
  get emblems() { return state.emblems; },
  get talents() { return state.talents; },
  get fullBuilds() { return state.fullBuilds; },
  get news() { return state.news; },
  get tierlist() { return state.tierlist; },
  get discussions() { return state.discussions; },
  get channelNews() { return state.channelNews; },
  get events() { return state.events; },
  get faContent() { return state.faContent; },
  get heroStats() { return state.heroStats; },
  get teamComps() { return state.teamComps; },
  get teamCompGuide() { return state.teamCompGuide; },
  get patchFull() { return state.patchFull; },
  get matchups() { return state.matchups; },
  get heroRevdate() { return state.heroRevdate; },
  get itemRevdate() { return state.itemRevdate; },
  get faCounts() { return state.faCounts; },
  loreById, statByName, matchupById, patchByTitle,
  searchHeroes, findHero, heroById,
  searchItems, findItem,
  heroPublic, itemPublic,
  heroesByRole,
  faSkill, faItem, faTalent, faSpell,
  ensureRemote, isRemoteReady,
  DATA_FILES: DATA_FILES.map(([, f]) => f),
};
