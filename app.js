// مینی‌اپ MLBB — نسخهٔ مستقل (GitHub Pages): بدون سرور پراکسی.
// دادهٔ زنده مستقیم از Rone Arena API خوانده می‌شود (CORS باز است) و
// دیتای استاتیک (هیرو/آیتم/امبلم/تلنت) از پوشهٔ data/ همین سایت.
// تابع api() همان مسیرهای قدیمی ‎/api/*‎ را می‌گیرد و همان شکل خروجی
// پراکسی را برمی‌گرداند، پس بقیهٔ فایل بدون هیچ تغییری مانده است.

// ======= DATA LAYER START (standalone: Rone direct + static JSON) =======
const RONE_BASE = 'https://arena.rone.dev/api';
const STATIC_BASE = 'data/';
const COACH_API = 'https://persian-mlbb-bot.yahootattoo1.workers.dev/api/ask';
const DATA_VERSION = '20261115-0312'; // با هر انتشار، همراه با ?v= اسکریپت بالا می‌رود تا دیتا کهنه نماند
const TTL_MS = 5 * 60 * 1000; // کش ۵ دقیقه‌ای، مثل سرور پراکسی
const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) { cache.delete(key); return null; }
  return hit.value;
}
function cacheSet(key, value) {
  if (cache.size > 500) cache.clear();
  cache.set(key, { value, at: Date.now() });
}

async function fetchJson(url, { method = 'GET', body = null, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, {
      method,
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* پاسخ غیر JSON */ }
    return { status: res.status, ok: res.ok, json, text };
  } catch (e) {
    return { status: 0, ok: false, json: null, text: '', error: e.name === 'AbortError' ? 'timeout' : String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

// GET با کش؛ خروجی: { ok:true, records:[...], raw } یا { ok:false, error, status }
async function roneGet(path, { useCache = true, headers = {} } = {}) {
  const url = RONE_BASE + path;
  if (useCache) {
    const hit = cacheGet(url);
    if (hit) return hit;
  }
  const r = await fetchJson(url, { headers });
  let out;
  if (!r.json) {
    const snippet = (r.text || '').trim().slice(0, 100);
    out = { ok: false, error: snippet ? `پاسخ غیر JSON از سرور: ${snippet}` : (r.error || `خطای شبکه (HTTP ${r.status || '؟'})`), status: r.status, records: [] };
  } else if (typeof r.json.code === 'number') {
    if (r.json.code === 0) {
      out = { ok: true, records: r.json.data?.records ?? [], raw: r.json.data ?? {}, status: r.status };
    } else {
      out = { ok: false, error: r.json.message || `خطای API (code ${r.json.code})`, status: r.status, records: [] };
    }
  } else if (r.json.status === 'success') {
    out = { ok: true, records: [], raw: r.json, status: r.status };
  } else if (r.json.status === 'error') {
    const det = r.json.details?.[0];
    const msg = det ? `${det.msg} (${det.loc?.join('.')})` : r.json.message || 'خطای اعتبارسنجی';
    out = { ok: false, error: msg, status: r.status, records: [], details: r.json.details };
  } else if (r.json && typeof r.json === 'object' && !Array.isArray(r.json)) {
    // بعضی اندپوینت‌ها (مثل esports) پاکت {code,data} ندارند و مستقیم
    // {"standings":[...]} یا {"weeks":[...]} برمی‌گردانند
    out = { ok: true, records: r.json.records ?? r.json.standings ?? r.json.weeks ?? [], raw: r.json, status: r.status };
  } else {
    out = { ok: false, error: r.json.message || r.json.detail || `پاسخ نامشخص (HTTP ${r.status})`, status: r.status, records: [] };
  }
  // نتیجهٔ خالی را کش نمی‌کنیم: اگر Rone لحظه‌ای رکورد خالی برگرداند،
  // کش مسموم نمی‌شود و درخواست بعدی دوباره لایو می‌خواند
  if (out.ok && useCache && out.records.length > 0) cacheSet(url, out);
  return out;
}

async function ronePost(path, body, headers = {}) {
  const r = await fetchJson(RONE_BASE + path, { method: 'POST', body, headers });
  if (!r.json) {
    const snippet = (r.text || '').trim().slice(0, 100);
    return { ok: false, error: snippet ? `پاسخ غیر JSON از سرور: ${snippet}` : (r.error || `خطای شبکه (HTTP ${r.status || '؟'})`), status: r.status };
  }
  if (r.json.code === 0) return { ok: true, data: r.json.data ?? r.json, status: r.status };
  if (r.json.status === 'success') return { ok: true, data: r.json, status: r.status };
  return { ok: false, error: r.json.message || r.json.detail || 'خطای API', status: r.status, raw: r.json };
}

// ---------- دیتای استاتیک (data/*.json — همان فایل‌های p3hndrx/MLBB-API) ----------
let staticPromise = null;
let tierByName = {}; // نام هیرو → حرف تیر (SS/S/A/B/C/D)
// ترجمهٔ فارسی توضیحات (data/fa-overrides.json) — اگر نباشد، متن انگلیسی نشان داده می‌شود
let FA = { heroSkills: {}, items: {}, talents: {}, spells: {} };
async function loadStatic() {
  if (!staticPromise) {
    staticPromise = (async () => {
      const load = async (file) => {
        const r = await fetch(STATIC_BASE + file + '?v=' + DATA_VERSION);
        if (!r.ok) throw new Error('خطا در خواندن ' + file);
        return r.json();
      };
      const loadOptional = async (file) => {
        try {
          const r = await fetch(STATIC_BASE + file + '?v=' + DATA_VERSION);
          if (!r.ok) return {};
          return r.json();
        } catch { return {}; }
      };
      const [heroFile, itemFile, emblemFile, talentFile] = await Promise.all([
        load('hero-meta-final.json'),
        load('item-meta-final.json'),
        load('emblem-meta-final.json'),
        load('talent-meta-final.json'),
      ]);
      const faFile = await loadOptional('fa-overrides.json');
      const fbFile = await loadOptional('builds-full.json');
      const newsFile = await loadOptional('news.json');
      const tierFile = await loadOptional('tierlist.json');
      const discFile = await loadOptional('discussions.json');
      const evFile = await loadOptional('events.json');
      const faContentFile = await loadOptional('fa-content.json');
      const heroStatsFile = await loadOptional('hero-stats.json');
      const teamCompsFile = await loadOptional('team-comps.json');
      const teamCompGuideFile = await loadOptional('team-comp-guide.json');
      const patchFullFile = await loadOptional('patch-notes-full.json');
      const matchupsFile = await loadOptional('matchups.json');
      FA = {
        heroSkills: faFile.heroSkills || {},
        items: faFile.items || {},
        talents: faFile.talents || {},
        spells: faFile.spells || {},
      };
      const heroes = (heroFile.data || []).filter((h) => h && h.hero_name && h.hero_name !== 'None');
      const heroByMlid = new Map();
      for (const h of heroes) if (h.mlid) heroByMlid.set(String(h.mlid), h);
      tierByName = {};
      for (const [letter, names] of Object.entries(tierFile.tiers || {})) {
        for (const n of names || []) if (n && n.name) tierByName[n.name] = letter;
      }
      return {
        heroes,
        heroByMlid,
        items: itemFile.data || [],
        emblems: emblemFile.data || [],
        talents: talentFile.data || {},
        itemRevdate: itemFile.revdate || null,
        fullBuilds: fbFile.heroes || {},
        news: { patchNotes: newsFile.patch_notes || [], wikiRecent: newsFile.wiki_recent || [] },
        tierlist: { month: tierFile.month || null, tiers: tierFile.tiers || {}, counts: tierFile.counts || {} },
        discussions: discFile.threads || [],
        events: evFile.events || [],
        faContent: faContentFile && faContentFile.version ? faContentFile : { lore: {}, matchups: {}, patches: {}, events: {}, stats: { heroes: {} }, guide: {}, comps: {}, discussions: {} },
        heroStats: heroStatsFile.heroes || [],
        teamComps: teamCompsFile.comps || [],
        teamCompGuide: teamCompGuideFile || {},
        patchFull: patchFullFile.patches || [],
        matchups: matchupsFile.heroes || {},
      };
    })();
  }
  return staticPromise;
}

function normStr(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function faSkill(heroId, skillName) { return FA.heroSkills[`${heroId}|${normStr(skillName)}`] || null; }
function faItem(itemId, name) { return FA.items[`${itemId}|${normStr(name)}`] || null; }
function faTalent(id) { return FA.talents[String(id)] || null; }
function faSpell(name) { return FA.spells[normStr(name)] || null; }

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

// جست‌وجوی هیرو: نام دقیق، شروع‌شونده، شامل‌شونده؛ اگر نبود نزدیک‌ترین‌ها
function searchHeroes(heroes, query, limit = 5) {
  const q = normStr(query);
  if (!q) return [];
  const scored = heroes.map((h) => {
    const name = normStr(h.hero_name);
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

function searchItems(items, query, limit = 5) {
  const q = normStr(query);
  if (!q) return items.slice(0, limit);
  const scored = items.map((it) => {
    const name = normStr(it.item_name);
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

function heroById(sd, id) {
  const n = String(id);
  return sd.heroes.find((h) => String(h.mlid) === n || String(h.id) === n || normStr(h.hero_name) === normStr(id)) || null;
}

// ---------- نرمال‌سازها (شکل Rone را به شکل ساده و یکدست تبدیل می‌کنند) ----------
function normHeroRecord(rec) {
  const d = rec?.data || {};
  const h = d.hero?.data || {};
  return {
    id: d.hero_id ?? rec?.hero_id ?? null,
    name: h.name || d.hero_name || '',
    head: h.head || null,
    smallmap: h.smallmap || null,
    relation: d.relation || null,
  };
}

function normRankRecord(rec) {
  const d = rec?.data || {};
  const h = d.main_hero?.data || {};
  return {
    id: d.main_heroid ?? null,
    name: h.name || '',
    head: h.head || null,
    win: d.main_hero_win_rate ?? null,
    ban: d.main_hero_ban_rate ?? null,
    pick: d.main_hero_appearance_rate ?? null,
  };
}

// رکوردهای sub_hero در counters فقط heroid و head دارند و نام ندارند؛
// نام را از دیتای استاتیک (mlid همان hero_id است) می‌گیریم.
function normCounterRecord(rec, heroByMlid) {
  const d = rec?.data || {};
  const subs = (d.sub_hero || []).map((s) => ({
    id: s.heroid ?? null,
    name: s.hero?.data?.name || heroByMlid.get(String(s.heroid))?.hero_name || '',
    head: s.hero?.data?.head || null,
    // منفی یعنی این هیرو وین‌ریت هیروی اصلی را پایین می‌آورد = کانتر قوی‌تر
    delta: s.increase_win_rate ?? null,
  }));
  return {
    id: d.main_heroid ?? null,
    name: d.main_hero?.data?.name || '',
    head: d.main_hero?.data?.head || null,
    win: d.main_hero_win_rate ?? null,
    ban: d.main_hero_ban_rate ?? null,
    pick: d.main_hero_appearance_rate ?? null,
    counters: subs,
  };
}

function normBuildRecord(rec, equipNameById) {
  const d = rec?.data || {};
  return (d.build || []).map((b) => ({
    equipIds: b.equipid || [],
    equipNames: (b.equipid || []).map((id) => equipNameById?.get?.(id) || equipNameById?.get?.(String(id)) || `آیتم #${id}`),
    equipIcons: (b.equipid || []).map((id) => equipIconById.get(id) || equipIconById.get(String(id)) || null),
    win: b.build_win_rate ?? null,
    pick: b.build_pick_rate ?? null,
    spell: b.battleskill?.data?.__data?.skillname || b.battleskill?.data?.skillshortdesc || '',
    spellDesc: b.battleskill?.data?.__data?.skilldesc || '',
  }));
}

// جدول MPL: شکل {"standings":[{rank, team:{name,full_name,logo}, match_point, match_wl:{win,lose}, net_game_win, game_wl:{win,lose}}]}
function normStanding(s) {
  return {
    rank: s.rank ?? null,
    team: s.team?.name || '',
    fullName: s.team?.full_name || '',
    logo: s.team?.logo || null,
    points: s.match_point ?? null,
    wins: s.match_wl?.win ?? null,
    losses: s.match_wl?.lose ?? null,
    gameWins: s.game_wl?.win ?? null,
    gameLosses: s.game_wl?.lose ?? null,
    netGameWin: s.net_game_win ?? null,
  };
}

// نگاشت equipid -> equipname (برای اسم آیتم‌های بیلد) + عکس آیتم‌ها — یک بار لود و کش می‌شود
let equipMapCache = null;
let equipMapAt = 0;
const equipIconById = new Map(); // equipid -> equipicon (عکس اصلی آیتم از Rone)
const equipIconByName = new Map(); // normStr(name) -> equipicon
async function equipNameMap() {
  if (equipMapCache && Date.now() - equipMapAt < TTL_MS) return equipMapCache;
  const map = new Map();
  const r = await roneGet('/academy/equipment?size=200&index=1');
  if (r.ok) {
    for (const rec of r.records) {
      const d = rec?.data || {};
      if (d.equipid != null && d.equipname) {
        map.set(d.equipid, d.equipname);
        map.set(String(d.equipid), d.equipname);
      }
      if (d.equipicon) {
        if (d.equipid != null) { equipIconById.set(d.equipid, d.equipicon); equipIconById.set(String(d.equipid), d.equipicon); }
        if (d.equipname) equipIconByName.set(normStr(d.equipname), d.equipicon);
      }
    }
  }
  equipMapCache = map;
  equipMapAt = Date.now();
  return map;
}

// ---------- آداپتورها: مسیرهای قدیمی ‎/api/*‎ با همان خروجی پراکسی ----------
async function versionAdapter() {
  const r = await roneGet('/academy/meta/version');
  if (!r.ok) throw new Error(r.error);
  const latest = r.records.find((rec) => rec?.data?.game_version);
  return { ok: true, game_version: latest?.data?.game_version || null, records: r.records.slice(0, 5).map((x) => x?.data?.game_version).filter(Boolean) };
}

async function heroesAdapter(size, index, q) {
  size = Math.min(Math.max(size || 20, 1), 140);
  index = Math.max(index || 1, 1);
  q = (q || '').trim();
  // جست‌وجو اول از دیتای استاتیک (نام/کلاس/لین)
  if (q) {
    const sd = await loadStatic();
    const hits = searchHeroes(sd.heroes, q, size).map(heroPublic);
    if (hits.length) return { ok: true, source: 'static', heroes: hits };
  }
  const r = await roneGet(`/heroes?size=${size}&index=${index}`);
  if (!r.ok) {
    // فالبک استاتیک
    const sd = await loadStatic();
    const page = sd.heroes.slice((index - 1) * size, index * size).map(heroPublic);
    return { ok: true, source: 'static-fallback', error: r.error, heroes: page };
  }
  return { ok: true, source: 'live', heroes: r.records.map(normHeroRecord) };
}

async function heroDetailAdapter(id) {
  const sd = await loadStatic();
  const st = heroById(sd, id);
  const r = await roneGet(`/heroes/${encodeURIComponent(id)}`);
  const rank = await roneGet('/heroes/rank?days=7&size=140&index=1');
  const rankRec = rank.ok ? rank.records.map(normRankRecord).find((x) => String(x.id) === String(st?.mlid || id)) : null;
  if (!r.ok && !st) throw new Error(r.error);
  const rec = r.records?.[0];
  const detail = rec?.data || {};
  const heroData = detail.hero?.data || {};
  return {
    ok: true,
    source: r.ok ? 'live' : 'static-fallback',
    hero: {
      id: st?.mlid ? Number(st.mlid) : (detail.hero_id ?? null),
      name: heroData.name || st?.hero_name || '',
      head: heroData.head || null,
      head_big: detail.head_big || null,
      class: st?.class || '',
      laning: st?.laning || [],
      portrait: st?.portrait || '',
      skills: st ? heroPublic(st).skills : [],
      rank: rankRec || null,
      // relation از Rone: strong = هیروهایی که این هیرو کانتر می‌کند، weak = هیروهایی که این هیرو را کانتر می‌کنند
      relation: mapRelationTargets(detail.relation || null, sd.heroByMlid),
    },
  };
}

// relation هیرو را به لیست {id, name, head} تبدیل می‌کند؛ نام را از دیتای استاتیک می‌گیرد
function mapRelationTargets(rel, heroByMlid) {
  const out = { strong: [], weak: [] };
  if (!rel) return out;
  for (const key of ['strong', 'weak']) {
    const r = rel[key];
    if (!r) continue;
    const ids = r.target_hero_id || [];
    const heads = r.target_hero || [];
    out[key] = ids.map((id, i) => {
      if (!id) return null;
      const st = heroByMlid?.get?.(String(id));
      return { id: Number(id), name: st?.hero_name || '', head: heads[i]?.data?.head || st?.portrait || null };
    }).filter(Boolean);
  }
  return out;
}

async function metaAdapter(days, size) {
  days = Math.min(Math.max(days || 7, 1), 90);
  size = Math.min(Math.max(size || 15, 1), 50);
  const r = await roneGet(`/heroes/rank?days=${days}&size=140&index=1`);
  if (!r.ok) throw new Error(r.error);
  const all = r.records.map(normRankRecord).filter((x) => x.id != null);
  const byWin = [...all].sort((a, b) => (b.win ?? 0) - (a.win ?? 0)).slice(0, size);
  const byBan = [...all].sort((a, b) => (b.ban ?? 0) - (a.ban ?? 0)).slice(0, size);
  return { ok: true, days, byWin, byBan };
}

async function countersAdapter(id, days) {
  days = Math.min(Math.max(days || 7, 1), 90);
  const r = await roneGet(`/heroes/${encodeURIComponent(id)}/counters?days=${days}&size=10&index=1`);
  if (!r.ok) throw new Error(r.error);
  const rec = r.records[0];
  if (!rec) throw new Error('کانتر پیدا نشد');
  const sd = await loadStatic();
  const c = normCounterRecord(rec, sd.heroByMlid);
  // مرتب نزولی: بزرگ‌ترین افزایش وین‌ریت اول — یعنی قوی‌ترین کانترِ این هیرو اول می‌آید
  c.counters = [...c.counters].filter((x) => x.delta != null).sort((a, b) => b.delta - a.delta);
  return { ok: true, counters: c };
}

async function buildsAdapter(id, lane) {
  lane = (lane || '').toLowerCase();
  const valid = ['exp', 'mid', 'gold', 'roam', 'jungle'];
  if (!valid.includes(lane)) throw new Error('lane باید یکی از این‌ها باشد: ' + valid.join('، '));
  const equipMap = await equipNameMap();
  const r = await roneGet(`/academy/heroes/${encodeURIComponent(id)}/builds?lane=${lane}`);
  if (!r.ok) throw new Error(r.error);
  const rec = r.records[0];
  if (!rec) throw new Error('بیلدی پیدا نشد');
  return {
    ok: true,
    hero_name: rec.data?.hero_name || null,
    heroid: rec.data?.heroid ?? null,
    lane,
    builds: normBuildRecord(rec, equipMap),
  };
}

async function itemsAdapter(q) {
  q = (q || '').trim();
  const sd = await loadStatic();
  await equipNameMap(); // عکس اصلی آیتم‌ها را هم لود می‌کند
  const list = q ? searchItems(sd.items, q, 50) : sd.items;
  return { ok: true, source: 'static', revdate: sd.itemRevdate, items: list.map((it) => { const p = itemPublic(it); p.icon = equipIconByName.get(normStr(p.name)) || null; return p; }) };
}

async function emblemsAdapter() {
  // اسپل‌های زنده از Rone؛ امبلم و تلنت از دیتای استاتیک
  // عکس‌ها از mlbb.tools (عکس رسمی خودشان): امبلم‌ها در /emblems/*.webp و
  // تلنت‌ها در /emblems/talents/*.webp — مسیر ذخیره‌شدهٔ تلنت‌ها (/talents/*.webp)
  // پیشوند /emblems را ندارد، پس اینجا اضافه می‌شود. هر ۳۳ عکس ۲۰۲۶-۱۱-۱۴ چک شد (HTTP 200).
  const ICON_BASE = 'https://mlbb.tools';
  const sd = await loadStatic();
  const spellsRes = await roneGet('/academy/spells?size=20&index=1');
  const spells = spellsRes.ok ? spellsRes.records.map((rec) => {
    const d = rec?.data?.__data || rec?.data || {};
    const name = d.skillname || d.name || '';
    const desc = (d.skilldesc || '').replace(/<[^>]+>/g, '');
    return { name, desc: faSpell(name) || desc, icon: (d.skillicon && /^https?:/.test(d.skillicon)) ? d.skillicon : null };
  }).filter((s) => s.name) : [];
  const mapTalents = (tiers) => {
    const out = {};
    for (const [k, arr] of Object.entries(tiers || {})) {
      out[k] = (arr || []).map((t) => ({ ...t, description: faTalent(t.id) || t.description, icon: t.icon ? ICON_BASE + '/emblems' + t.icon : null }));
    }
    return out;
  };
  return {
    ok: true,
    emblems: (sd.emblems || []).map((e) => ({ ...e, icon: e.icon ? ICON_BASE + e.icon : null })),
    talents: mapTalents(sd.talents),
    spells,
    spells_error: spellsRes.ok ? null : spellsRes.error,
  };
}

async function wrAdapter(m, now, fut) {
  if (![m, now, fut].every(Number.isFinite)) throw new Error('هر سه پارامتر الزامی‌اند: match-now و wr-now و wr-future');
  const r = await roneGet(`/addon/win-rate-calculator?match-now=${m}&wr-now=${now}&wr-future=${fut}`, { useCache: false });
  if (r.ok && r.raw?.required_no_lose_matches != null) {
    return { ok: true, match_now: m, wr_now: now, wr_future: fut, required_no_lose_matches: r.raw.required_no_lose_matches, source: 'live' };
  }
  // فالبک محاسبهٔ محلی
  if (fut <= now) throw new Error('وین‌ریت هدف باید بیشتر از فعلی باشد');
  const n = Math.max(0, Math.ceil(((fut / 100) * m - (now / 100) * m) / (1 - fut / 100) - 1e-9));
  return { ok: true, match_now: m, wr_now: now, wr_future: fut, required_no_lose_matches: n, source: 'local-fallback' };
}

async function mplStandingsAdapter(league) {
  const r = await roneGet(`/esports/${league}/standings`);
  if (!r.ok) throw new Error(r.error + ' — ممکن است فصل این لیگ شروع نشده باشد یا سرویس بالادستی خطا بدهد.');
  const standings = (r.raw?.standings || r.records || []).map(normStanding);
  return { ok: true, league, standings };
}

// تابع api(): همان رابط قدیمی — بقیهٔ فایل بدون تغییر از آن استفاده می‌کند
async function api(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const url = new URL(path, 'https://x/');
  const p = url.pathname;
  const q = url.searchParams;
  if (method === 'POST' && p === '/api/user/send-vc') {
    const body = JSON.parse(opts.body || '{}');
    const r = await ronePost('/user/auth/send-vc', { game_id: body.game_id, zone_id: body.zone_id });
    if (!r.ok) throw new Error(r.error);
    return { ok: true, sent: true, data: r.data };
  }
  if (method === 'POST' && p === '/api/user/login') {
    const body = JSON.parse(opts.body || '{}');
    const r = await ronePost('/user/auth/login', { game_id: body.game_id, zone_id: body.zone_id, verification_code: body.verification_code });
    if (!r.ok) throw new Error(r.error);
    return { ok: true, data: r.data };
  }
  if (p === '/api/version') return versionAdapter();
  if (p === '/api/meta') return metaAdapter(Number(q.get('days')), Number(q.get('size')));
  if (p === '/api/items') return itemsAdapter(q.get('q') || '');
  if (p === '/api/emblems') return emblemsAdapter();
  if (p === '/api/wr') return wrAdapter(Number(q.get('match-now')), Number(q.get('wr-now')), Number(q.get('wr-future')));
  const mStand = p.match(/^\/api\/mpl\/(id|ph|my|kh)\/standings$/);
  if (mStand) return mplStandingsAdapter(mStand[1]);
  const mBuild = p.match(/^\/api\/builds\/(.+)$/);
  if (mBuild) return buildsAdapter(decodeURIComponent(mBuild[1]), q.get('lane') || '');
  const mCnt = p.match(/^\/api\/counters\/(.+)$/);
  if (mCnt) return countersAdapter(decodeURIComponent(mCnt[1]), Number(q.get('days')));
  const mHero = p.match(/^\/api\/heroes\/(.+)$/);
  if (mHero) return heroDetailAdapter(decodeURIComponent(mHero[1]));
  if (p === '/api/heroes') return heroesAdapter(Number(q.get('size')), Number(q.get('index')), q.get('q') || '');
  throw new Error('مسیر ناشناخته: ' + p);
}
// ======= DATA LAYER END =======
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

const FA_DIGITS = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
const faNum = (v) => v == null ? '—' : String(v).replace(/[0-9]/g, (d) => FA_DIGITS[+d]).replace(/\./g, '٫');
const faInt = (v) => { const n = Number(v); return Number.isFinite(n) ? faNum(Math.round(n).toLocaleString('en-US').replace(/,/g, '٬')) : '—'; };
const pct = (x, d = 1) => { const n = Number(x); if (!Number.isFinite(n)) return '—'; return faNum(((n <= 1 ? n * 100 : n)).toFixed(d)) + '٪'; };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clean = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();

// ---------- نقش و لین هیرو — نام فارسی ----------
const ROLES = [
  { en: 'Marksman', fa: 'تیرانداز', emoji: '🏹' },
  { en: 'Fighter', fa: 'مبارز', emoji: '⚔️' },
  { en: 'Assassin', fa: 'قاتل', emoji: '🗡️' },
  { en: 'Mage', fa: 'جادوگر', emoji: '🔮' },
  { en: 'Tank', fa: 'تانک', emoji: '🛡️' },
  { en: 'Support', fa: 'پشتیبان', emoji: '💚' },
];
const ROLE_FA = Object.fromEntries(ROLES.map((r) => [r.en, r.fa]));
const LANE_FA = { gold: 'گلد', exp: 'اکس‌پی', mid: 'مید', jungle: 'جانگل', roam: 'روم' };
const normLaneKey = (s) => String(s || '').toLowerCase().replace(/\s*lane\s*$/, '').replace(/jungling/g, 'jungle').replace(/roaming/g, 'roam').trim();
const roleFa = (classStr) => String(classStr || '').split(',').map((s) => ROLE_FA[s.trim()] || s.trim()).filter(Boolean).join('، ');
const laneFa = (laning) => {
  const out = [];
  for (const l of (laning || [])) for (const p of String(l).split(',')) {
    const k = normLaneKey(p);
    if (k && LANE_FA[k] && !out.includes(LANE_FA[k])) out.push(LANE_FA[k]);
  }
  return out.join('، ');
};
const roleList = (classStr) => String(classStr || '').split(',').map((s) => s.trim()).filter((s) => ROLE_FA[s]);
// دسته‌بندی هیروها بر اساس نقش — هیروی دورنقشه در هر دو گروه می‌آید
const groupHeroesByRole = (list) => ROLES.map((r) => {
  const heroes = list.filter((h) => roleList(h.class).includes(r.en)).sort((a, b) => a.name.localeCompare(b.name));
  return { en: r.en, fa: r.fa, emoji: r.emoji, count: heroes.length, heroes };
});

const loading = (el, msg = '⏳ در حال بارگذاری…') => { el.innerHTML = `<div class="status">${msg}</div>`; };
const showError = (el, e) => { el.innerHTML = `<div class="status error">❌ ${esc(e.message || 'خطا در گرفتن داده')}</div>`; };

// ---------- تب‌ها ----------
const tabs = document.querySelectorAll('#tabs button');
tabs.forEach((b) => b.addEventListener('click', () => {
  tabs.forEach((x) => x.classList.remove('active'));
  b.classList.add('active');
  document.querySelectorAll('main .tab').forEach((s) => s.classList.remove('active'));
  document.getElementById('tab-' + b.dataset.tab).classList.add('active');
  if (b.dataset.tab === 'meta') loadMeta();
  if (b.dataset.tab === 'emblems') loadEmblems();
  if (b.dataset.tab === 'news') loadNews();
  if (b.dataset.tab === 'comps') loadComps();
  if (b.dataset.tab === 'lore') loadLore();
}));
function showTab(name) {
  document.querySelector(`#tabs button[data-tab="${name}"]`)?.click();
}

// ---------- نسخهٔ بازی ----------
api('/api/version').then((j) => {
  document.getElementById('version').textContent = j.game_version ? 'نسخهٔ بازی: ' + faNum(j.game_version) : '';
}).catch(() => {});

// ---------- هیروها ----------
let currentHeroId = null;
let heroRoleFilter = null; // null = همهٔ نقش‌ها
let allHeroesCache = null;

function heroCard(h) {
  const img = h.portrait || h.head;
  const tier = tierByName[h.name] || '';
  const tierCls = tier === 'SS' ? 'ss' : tier === 'S' ? 's' : tier === 'A' ? 'a' : tier === 'B' ? 'b' : '';
  const lane = laneFa(h.laning);
  return `
      <div class="hero-card" data-id="${h.id}" data-name="${esc(h.name)}">
        <div class="hero-img-wrap">
          ${img ? `<img src="${esc(img)}" alt="${esc(h.name)}" loading="lazy">` : '<div style="height:100px">🦸</div>'}
          ${tier ? `<span class="tier-badge ${tierCls}">${esc(tier)}</span>` : ''}
          ${lane ? `<span class="lane-chip">${esc(lane)}</span>` : ''}
        </div>
        <div class="name">${esc(h.name)}</div>
        <div class="cls">${esc(roleFa(h.class))}</div>
      </div>`;
}

function bindHeroCards(grid) {
  grid.querySelectorAll('.hero-card').forEach((c) => c.addEventListener('click', () => openHero(c.dataset.id)));
}

function renderRoleChips(groups, total) {
  const box = document.getElementById('roleChips');
  if (!box) return;
  const chips = [{ en: null, fa: 'همه', emoji: '🦸', count: total }, ...groups];
  box.innerHTML = chips.map((c) =>
    `<button class="role-chip${heroRoleFilter === c.en ? ' active' : ''}" data-role="${c.en || ''}">${c.emoji} ${c.en || c.fa} (${faNum(c.count)})</button>`
  ).join('');
  box.querySelectorAll('.role-chip').forEach((b) => b.addEventListener('click', () => {
    heroRoleFilter = b.dataset.role || null;
    document.getElementById('heroSearch').value = '';
    loadHeroes();
  }));
}

async function loadHeroes(q = '') {
  const grid = document.getElementById('heroGrid');
  const st = document.getElementById('heroStatus');
  st.textContent = '';
  loading(grid);
  try {
    // جست‌وجو: نتایج تخت (مثل قبل)
    if (q) {
      const j = await api('/api/heroes?size=140&index=1' + '&q=' + encodeURIComponent(q));
      const list = j.heroes || [];
      if (!list.length) { grid.innerHTML = ''; st.textContent = 'هیرویی پیدا نشد.'; return; }
      grid.innerHTML = `<div class="grid">${list.map(heroCard).join('')}</div>`;
      bindHeroCards(grid);
      return;
    }
    // نمای پیش‌فرض: همهٔ ۱۳۳ هیرو، دسته‌بندی‌شده بر اساس نقش (از دیتای استاتیک که نقش و لین دارد)
    if (!allHeroesCache) {
      const sd = await loadStatic();
      allHeroesCache = sd.heroes.map(heroPublic);
    }
    const groups = groupHeroesByRole(allHeroesCache);
    const total = allHeroesCache.length;
    renderRoleChips(groups, total);
    const shown = heroRoleFilter ? groups.filter((g) => g.en === heroRoleFilter) : groups;
    grid.innerHTML = shown.map((g) => `
      <div class="role-section">
        <h3>${g.emoji} ${g.en} <span class="count">${faNum(g.count)}</span></h3>
        <div class="grid">${g.heroes.map(heroCard).join('')}</div>
      </div>`).join('');
    bindHeroCards(grid);
  } catch (e) { showError(grid, e); }
}
document.getElementById('heroSearchBtn').addEventListener('click', () => loadHeroes(document.getElementById('heroSearch').value.trim()));
document.getElementById('heroSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadHeroes(e.target.value.trim()); });
document.getElementById('loreSearchBtn').addEventListener('click', () => loadLore(document.getElementById('loreSearch').value.trim()));
document.getElementById('loreSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadLore(e.target.value.trim()); });

// ---------- جزییات هیرو ----------
// ---------- بیلد کامل ۶ آیتمی (mlbb.io) ----------
let fullBuildHTML = '';
const MONTH_FA = { January: 'ژانویه', February: 'فوریه', March: 'مارس', April: 'آوریل', May: 'مه', June: 'ژوئن', July: 'ژوئیه', August: 'اوت', September: 'سپتامبر', October: 'اکتبر', November: 'نوامبر', December: 'دسامبر' };
function monthFa(m) { const [name, year] = String(m || '').split(' '); return (MONTH_FA[name] || name) + (year ? ' ' + faNum(year) : ''); }
function dateFa(iso) { const d = new Date(iso); if (isNaN(d.getTime())) return ''; const names = Object.keys(MONTH_FA); return `${faNum(d.getUTCDate())} ${MONTH_FA[names[d.getUTCMonth()]]} ${faNum(d.getUTCFullYear())}`; }
function emblemIconByName(sd, name) { const e = (sd.emblems || []).find((x) => normStr(x.emblem_name) === normStr(name)); return e && e.icon ? 'https://mlbb.tools' + e.icon : null; }
function talentIconByName(sd, name) { for (const tier of Object.values(sd.talents || {})) { const t = (tier || []).find((x) => normStr(x.name) === normStr(name)); if (t && t.icon) return 'https://mlbb.tools/emblems' + t.icon; } return null; }
async function computeFullBuild(id) {
  try {
    const sd = await loadStatic();
    const fb = sd.fullBuilds[String(id)];
    if (!fb || !(fb.items || []).length) return '';
    await equipNameMap(); // عکس اصلی آیتم‌ها
    const items = fb.items.map((nm, i) => { const ic = equipIconByName.get(normStr(nm)) || null; return `<div class="bi">${ic ? `<img src="${esc(ic)}" alt="${esc(nm)}" loading="lazy" onerror="this.style.display='none'">` : ''}<div>${faNum(i + 1)}. ${esc(nm)}</div></div>`; }).join('');
    const emIc = fb.emblem ? emblemIconByName(sd, fb.emblem) : null;
    const tl = (fb.emblem_talents || []).map((tn) => { const ic = talentIconByName(sd, tn); return `<span style="display:inline-flex;align-items:center;gap:4px">${ic ? `<img src="${esc(ic)}" alt="" loading="lazy" onerror="this.remove()" style="width:22px;height:22px;border-radius:6px">` : ''}${esc(tn)}</span>`; }).join('، ');
    const small = (fb.builds_count || 99) <= 2;
    return `<div class="build"><b>🧰 بیلد پیشنهادی — ۶ آیتم</b><div class="bitems">${items}</div>
      ${fb.spell ? `<div>🪄 اسپل: ${esc(fb.spell)}</div>` : ''}
      ${fb.emblem ? `<div class="it-row" style="margin-top:6px">${emIc ? `<img src="${esc(emIc)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<div>🛡️ امبلم: <b>${esc(fb.emblem)}</b>${tl ? `<br><span class="sub">${tl}</span>` : ''}</div></div>` : ''}
      <div class="sub" style="margin-top:6px">${fb.month ? 'بیلد ' + esc(monthFa(fb.month)) : ''}${fb.builds_count ? `، تجمیع ${faNum(fb.builds_count)} بیلد` : ''}${small ? ' — ⚠️ نمونهٔ کوچک، با احتیاط استفاده کن' : ''}</div></div>`;
  } catch { return ''; }
}

async function openHero(id) {
  currentHeroId = id;
  document.querySelectorAll('main .tab').forEach((s) => s.classList.remove('active'));
  document.getElementById('tab-hero').classList.add('active');
  const box = document.getElementById('heroDetail');
  const buildBox = document.getElementById('buildBox');
  const laneRow = document.getElementById('laneRow');
  laneRow.innerHTML = ''; buildBox.innerHTML = ''; fullBuildHTML = '';
  loading(box);
  try {
    const j = await api('/api/heroes/' + encodeURIComponent(id));
    const h = j.hero;
    const counters = await api('/api/counters/' + encodeURIComponent(id)).catch(() => null);
    box.innerHTML = `
      <div class="detail-head">
        ${h.portrait || h.head_big || h.head ? `<img src="${esc(h.portrait || h.head_big || h.head)}" alt="${esc(h.name)}">` : ''}
        <div><h2>${esc(h.name)}</h2><div>${esc(roleFa(h.class))} — ${esc(laneFa(h.laning))}</div></div>
      </div>
      ${h.rank ? `<div class="stat-chips">
        <span class="chip">وین‌ریت <b>${pct(h.rank.win)}</b></span>
        <span class="chip">بن‌ریت <b>${pct(h.rank.ban)}</b></span>
        <span class="chip">پیک‌ریت <b>${pct(h.rank.pick)}</b></span>
      </div>` : '<p class="hint">آمار زندهٔ این هیرو فعلاً در دسترس نیست.</p>'}
      ${(h.skills || []).map((s) => `<div class="skill"><b>${esc(s.name)}</b> <span class="meta">${esc(s.type || '')}${s.cooldown && s.cooldown !== 'null' ? ' | کول‌داون: ' + faNum(s.cooldown) + ' ثانیه' : ''}</span><p>${esc(clean(s.description))}</p></div>`).join('')}
      ${counters?.counters ? `
      <h2>✅ این هیرو این‌ها را کانتر می‌کند</h2>
      ${(counters.counters.counters || []).slice(0, 5).map((c) => `<div class="skill hrow">${c.head ? `<img class="h-ic" src="${esc(c.head)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}<div><b>${esc(c.name)}</b><br><span class="meta">وین‌ریت در برابر او: +${pct(c.delta)}</span></div></div>`).join('') || '<p class="hint">—</p>'}
      <h2>⚔️ جلوی این هیروها کانتر می‌شود</h2>
      ${(h.relation?.weak || []).map((w) => `<div class="skill hrow">${w.head ? `<img class="h-ic" src="${esc(w.head)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}<div><b>${esc(w.name)}</b></div></div>`).join('') || '<p class="hint">—</p>'}` : ''}`;
    const sd = await loadStatic();
    const stat = (sd.heroStats || []).find((x) => normStr(x.name) === normStr(h.name));
    const statFa = stat ? (((sd.faContent.stats || {}).heroes || {})[stat.slug] || {}) : {};
    const lore = (sd.faContent.lore || {})[String(id)];
    const muSrc = (sd.matchups || {})[String(id)];
    const muFa = (sd.faContent.matchups || {})[String(id)] || {};
    let extra = '';
    if (stat) extra += `<p class="hint">📊 آمار ۷ روز اخیر: رتبهٔ ${faNum(stat.position)} از ۱۳۳ — وین‌ریت ${pct(stat.win_rate)} (${esc(statFa.win_label_fa || stat.win_label || '')}) — تخصص: ${esc((statFa.specialities_fa || stat.specialities || []).join('، '))}</p>`;
    if (lore) {
      const info = lore.info_fa || {};
      const infoBits = [info.title_fa, info.gender_fa, info.species_fa, info.occupation_fa, info.fighting_style_fa].filter(Boolean).join('، ');
      extra += `<h2>📖 داستان</h2>` + (lore.bio_short_fa ? `<p>${esc(lore.bio_short_fa)}</p>` : '') + (infoBits ? `<p class="hint">${esc(infoBits)}</p>` : '') + (lore.bio_fa ? `<details><summary>داستان کامل</summary><p>${esc(lore.bio_fa)}</p></details>` : '');
    }
    if (muSrc && (muSrc.countered_by || []).length) {
      const cbFa = muFa.countered_by_fa || {};
      extra += `<h2>⚔️ سخت‌ترین حریف‌ها</h2>` + muSrc.countered_by.slice(0, 3).map((cb) => {
        const f = cbFa[cb.slug] || {};
        return `<div class="skill hrow"><div><b>${esc(cb.name)}</b> <span class="meta">${esc(f.strength_fa || cb.strength || '')}</span><br>${esc(f.reason_fa || cb.reason || '')}</div></div>`;
      }).join('');
    }
    // هم‌تیمی‌های خوب: اگر هیرو در یکی از ترکیب‌های تیمی هست، ۴ هم‌تیمی دیگرش
    const comp = (sd.teamComps || []).find((c) => (c.heroes || []).some((x) => normStr(x.name) === normStr(h.name)));
    if (comp) {
      const mates = comp.heroes.filter((x) => normStr(x.name) !== normStr(h.name));
      const laneName = { exp: 'اکس‌پی', mid: 'مید', gold: 'گلد', roam: 'روم', jungle: 'جانگل' };
      extra += `<h2>🤝 هم‌تیمی‌های خوب</h2>` + mates.map((m) => `<div class="skill hrow"><div><b>${esc(m.name)}</b> — ${esc(laneName[m.lane] || m.lane)} (وین ${pct(m.win_rate)})</div></div>`).join('');
    }
    if (extra) box.innerHTML += extra;
    laneRow.innerHTML = '<span style="align-self:center">🛠️ بیلد برای لین:</span>' +
      [['exp', 'اکس‌پی'], ['mid', 'مید'], ['gold', 'گلد'], ['roam', 'روم'], ['jungle', 'جانگل']]
        .map(([v, fa]) => `<button data-lane="${v}">${fa}</button>`).join('');
    laneRow.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => loadBuild(id, b.dataset.lane, b)));
    // بیلد کامل ۶ آیتمی (mlbb.io) اول محاسبه می‌شود تا loadBuild آن را بالای بیلدهای لین نشان دهد
    fullBuildHTML = await computeFullBuild(id);
    // آیتم‌های پیشنهادی برای لین اصلی هیرو، خودکار در انتهای صفحه لود می‌شود
    const laneMap = { 'gold lane': 'gold', 'exp lane': 'exp', 'mid lane': 'mid', 'roam': 'roam', 'jungle': 'jungle' };
    const firstLane = (h.laning || []).flatMap((l) => String(l).split(',')).map((s) => laneMap[s.trim().toLowerCase()]).find(Boolean);
    if (firstLane) {
      const btn = laneRow.querySelector(`button[data-lane="${firstLane}"]`);
      if (btn) loadBuild(id, firstLane, btn);
    }
  } catch (e) { showError(box, e); }
}
document.getElementById('heroBack').addEventListener('click', () => showTab('heroes'));

async function loadBuild(id, lane, btn) {
  document.querySelectorAll('#laneRow button').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  const box = document.getElementById('buildBox');
  loading(box);
  try {
    const j = await api(`/api/builds/${encodeURIComponent(id)}?lane=${lane}`);
    const list = (j.builds || []).slice(0, 3);
    box.innerHTML = (fullBuildHTML || '') + (list.length
      ? `<h2>${fullBuildHTML ? '🔄 بیلدهای دیگر بر اساس لین' : '🧰 آیتم‌های پیشنهادی'}</h2>` + list.map((b, i) => `
      <div class="build"><b>بیلد ${faNum(i + 1)}</b> — وین ${pct(b.win)} | پیک ${pct(b.pick)}
      ${b.spell ? `<br>🪄 اسپل: ${esc(b.spell)}` : ''}
      <div class="bitems">${(b.equipIds || []).map((eid, ix) => { const nm = (b.equipNames || [])[ix] || ''; const ic = (b.equipIcons || [])[ix]; return `<div class="bi">${ic ? `<img src="${esc(ic)}" alt="${esc(nm)}" loading="lazy" onerror="this.style.display='none'">` : ''}<div>${esc(nm)}</div></div>`; }).join('')}</div></div>`).join('')
      : (fullBuildHTML ? '' : '<p class="hint">بیلدی ثبت نشده است.</p>'));
  } catch (e) { showError(box, e); }
}

// ---------- متا ----------
let metaData = null;
async function loadMeta() {
  const box = document.getElementById('metaTable');
  const st = document.getElementById('metaStatus');
  st.textContent = '';
  loading(box);
  try {
    metaData = await api('/api/meta?days=7&size=15');
    renderMeta();
  } catch (e) { showError(box, e); }
}
function renderMeta() {
  const sort = document.getElementById('metaSort').value;
  const list = sort === 'ban' ? metaData.byBan : metaData.byWin;
  document.getElementById('metaTable').innerHTML = `
    <table><thead><tr><th>#</th><th>هیرو</th><th>وین‌ریت</th><th>بن‌ریت</th><th>پیک‌ریت</th></tr></thead>
    <tbody>${list.map((h, i) => `<tr>
      <td>${faNum(i + 1)}</td>
      <td>${h.head ? `<img src="${esc(h.head)}" alt=""> ` : ''}<b>${esc(h.name)}</b></td>
      <td>${pct(h.win)}</td><td>${pct(h.ban)}</td><td>${pct(h.pick)}</td>
    </tr>`).join('')}</tbody></table>`;
}
document.getElementById('metaSort').addEventListener('change', renderMeta);

// ---------- کانتر تیمی (داخل تب متا) ----------
// ورودی را مثل ربات تجزیه می‌کند: کاما اولویت دارد (نام چندکلمه‌ای سالم می‌ماند)؛
// وگرنه کل متن یک هیروست و بعد با فاصله جدا می‌شود. برمی‌گرداند { valid, unknown }
function parseCounterInput(q, heroes) {
  const find = (name) => (searchHeroes(heroes, name, 1) || [])[0] || null;
  const trimmed = String(q || '').trim();
  if (!trimmed) return { valid: [], unknown: [] };
  if (!trimmed.includes(',')) {
    const single = find(trimmed);
    if (single) return { valid: [single], unknown: [] };
  }
  const parts = trimmed.includes(',')
    ? trimmed.split(',').map((s) => s.trim()).filter(Boolean)
    : trimmed.split(/\s+/).filter(Boolean);
  const valid = [];
  const unknown = [];
  for (const p of parts.slice(0, 5)) {
    const h = find(p);
    if (h && !valid.some((v) => normStr(v.hero_name) === normStr(h.hero_name))) valid.push(h);
    else if (!h) unknown.push(p);
  }
  return { valid, unknown };
}
// رتبه‌بندی کانتر تیمی از دیتای استاتیک: پوشش (چند تا از حریف‌ها را کانتر می‌کند)، بعد وین‌ریت
function teamCounterTop(sd, enemyHeroes, limit = 5) {
  const enemyNorms = enemyHeroes.map((h) => normStr(h.hero_name));
  const enemySet = new Set(enemyNorms);
  const rows = [];
  for (const h of sd.heroes || []) {
    if (enemySet.has(normStr(h.hero_name))) continue;
    const entry = (sd.matchups || {})[String(h.mlid)] || {};
    const countered = new Set((entry.counters || []).map((c) => normStr(c.slug || c.name)));
    const hit = enemyHeroes.filter((e) => countered.has(normStr(e.hero_name)));
    if (!hit.length) continue;
    const st = (sd.heroStats || []).find((x) => normStr(x.name) === normStr(h.hero_name));
    rows.push({ hero: h, coverage: hit.length, hitNames: hit.map((e) => e.hero_name), win: st ? Number(st.win_rate) || 0 : 0 });
  }
  rows.sort((a, b) => (b.coverage - a.coverage) || (b.win - a.win));
  return rows.slice(0, limit);
}
async function renderTeamCounter() {
  const box = document.getElementById('teamCounterBox');
  const q = document.getElementById('teamCounterQ').value.trim();
  if (!q) { box.innerHTML = '<p class="hint">نام هیروها را بنویس؛ مثلاً: Yu Zhong, Pharsa</p>'; return; }
  loading(box, '⏳ در حال محاسبه…');
  try {
    const sd = await loadStatic();
    const { valid, unknown } = parseCounterInput(q, sd.heroes || []);
    if (!valid.length) { box.innerHTML = '<p class="hint">هیرویی با این نام پیدا نشد؛ نام انگلیسی هیرو را بنویس.</p>'; return; }
    if (valid.length === 1) {
      box.innerHTML = `<p class="hint">فقط یک هیرو پیدا شد (${esc(valid[0].hero_name)}) — برای کانتر تیمی دست‌کم ۲ هیرو بده.${unknown.length ? ' «' + esc(unknown.join('، ')) + '» پیدا نشد.' : ''}</p>`;
      return;
    }
    const top = teamCounterTop(sd, valid, 5);
    box.innerHTML = (unknown.length ? `<p class="hint">⚠️ «${esc(unknown.join('، '))}» پیدا نشد و نادیده گرفته شد.</p>` : '') +
      `<h3>🛡️ کانتر تیم حریف — ${valid.map((h) => esc(h.hero_name)).join('، ')}</h3>` +
      (top.length ? top.map((r, i) => `<div class="item-card"><b>${faNum(i + 1)}. ${esc(r.hero.hero_name)}</b> <span class="sub">${esc(roleFa(r.hero.class))} — ${esc(laneFa(r.hero.laning))} — کانتر ${faNum(r.coverage)} تا از ${faNum(valid.length)} هیرو (${r.hitNames.map(esc).join('، ')}) — وین‌ریت ${pct(r.win)}</span></div>`).join('')
        : '<p class="hint">— هیچ هیرویی این تیم را کانتر نمی‌کند.</p>');
  } catch (e) { showError(box, e); }
}
document.getElementById('teamCounterBtn').addEventListener('click', renderTeamCounter);
document.getElementById('teamCounterQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') renderTeamCounter(); });

// ---------- مربی هوش مصنوعی ----------
async function sendCoach() {
  const box = document.getElementById('coachBox');
  const q = document.getElementById('coachQ').value.trim();
  if (!q) { box.innerHTML = '<p class="hint">سؤالت را بنویس؛ مثلاً: بهترین بیلد Miya برای لین گلد چیست؟</p>'; return; }
  loading(box, '🧠 مربی دارد فکر می‌کند…');
  try {
    const r = await fetchJson(COACH_API, { method: 'POST', body: { question: q, initData: (tg && tg.initData) || '' } });
    if (!r.ok || !r.json || typeof r.json.answer !== 'string' || !r.json.answer) {
      throw new Error('مربی الان در دسترس نیست، کمی بعد دوباره بپرس');
    }
    box.innerHTML = `<div class="result">${esc(r.json.answer).replace(/\n/g, '<br>')}</div>`;
  } catch (e) { showError(box, e); }
}
document.getElementById('coachSend').addEventListener('click', sendCoach);
document.getElementById('coachQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendCoach(); });

// ---------- اخبار و تیرلیست ----------
async function loadNews() {
  const box = document.getElementById('newsBox');
  const tb = document.getElementById('tierBox');
  const st = document.getElementById('newsStatus');
  st.textContent = '';
  loading(box);
  tb.innerHTML = '';
  try {
    const sd = await loadStatic();
    const pn = (sd.news && sd.news.patchNotes) || [];
    const wr = (sd.news && sd.news.wikiRecent) || [];
    const dc = sd.discussions || [];
    const ev = sd.events || [];
    const tl = sd.tierlist || {};
    const evStatusFa = { current: 'در حال اجرا', upcoming: 'به‌زودی', unknown: 'تاریخ مشخص نیست', ended: 'تمام‌شده' };
    // عکس‌های ویکی مستقیم در صفحه لود نمی‌شوند (هاست‌شان درخواست داخل صفحه را رد می‌کند؛ با curl و بازشدن مستقیم سالم‌اند) — پس از wsrv.nl رد می‌شوند، مثل آیکون آیتم‌ها
const thumb = (u) => {
  if (!u) return '';
  const proxied = u.startsWith('https://static.wikia.nocookie.net/') ? 'https://wsrv.nl/?url=' + u.slice(8) : u;
  return `<img class="news-thumb" src="${esc(proxied)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">`;
};
    const order = ['SS', 'S', 'A', 'B', 'C', 'D'];
    const nameToId = new Map((sd.heroes || []).map((h) => [normStr(h.hero_name), String(h.mlid)]));
    box.innerHTML =
      (pn.length ? '<h2>📝 پچ‌نوت‌ها</h2>' + pn.slice(0, 10).map((p) => `<div class="item-card" data-patch="${esc(p.title)}" style="cursor:pointer">${thumb(p.image_url)}<b>${esc(p.title_fa || p.title)}</b><br><span class="sub">${esc(dateFa(p.updated))} — ${esc(p.title)}</span><br><span class="sub">👆 برای متن کامل پچ بزن</span></div>`).join('') : '') +
      (ev.length ? '<h2>🎉 ایونت‌ها</h2>' + ev.slice(0, 10).map((e) => {
        const fev = ((sd.faContent || {}).events || {})[e.title] || {};
        const d1 = e.start_date ? dateFa(e.start_date) : '';
        const d2 = e.end_date ? dateFa(e.end_date) : '';
        const dates = [d1, d2].filter(Boolean).join(' تا ');
        const summary = fev.summary_fa || e.summary;
        return `<div class="item-card">${thumb(e.image_url)}<b>${esc(fev.title_fa || e.title)}</b> <span class="sub">${esc(fev.status_fa || evStatusFa[e.status] || '')}${dates ? ' — ' + esc(dates) : ''}</span>${summary ? `<br><span class="sub">${esc(summary.slice(0, 160))}${summary.length > 160 ? '…' : ''}</span>` : ''}</div>`;
      }).join('') : '') +
      (wr.length ? '<h2>📚 تازه‌ها</h2>' + wr.slice(0, 10).map((w) => `<div class="item-card">${thumb(w.image_url)}<b>${esc(w.title)}</b><br><span class="sub">${esc(dateFa(w.timestamp))}${w.comment ? ' — ' + esc(w.comment) : ''}</span></div>`).join('') : '') +
      (dc.length ? '<h2>💬 گفتگوها</h2>' + dc.slice(0, 10).map((d) => { const fd = ((sd.faContent || {}).discussions || {})[d.title] || {}; return `<div class="item-card"><b>${esc(fd.title_fa || d.title)}</b><br><span class="sub">${esc(dateFa(d.date_iso))}${d.category_fa ? ' — ' + esc(d.category_fa) : ''}</span></div>`; }).join('') : '') ||
      '<p class="hint">خبری پیدا نشد.</p>';
    box.querySelectorAll('[data-patch]').forEach((el) => el.addEventListener('click', () => showPatchDetail(el.dataset.patch)));
    tb.innerHTML =
      (tl.month ? `<p class="hint">تیرلیست ${esc(monthFa(tl.month))} — ${faNum(Object.values(tl.counts || {}).reduce((a, b) => a + b, 0))} هیرو</p>` : '') +
      (order.map((k) => {
        const list = (tl.tiers || {})[k] || [];
        if (!list.length) return '';
        return `<div class="item-card"><b>${k}</b> <span class="sub">${faNum(list.length)} هیرو</span><br>${list.map((h) => {
          const id = nameToId.get(normStr(h.name));
          return id ? `<a href="#" data-hero="${id}">${esc(h.name)}</a>` : esc(h.name);
        }).join('، ')}</div>`;
      }).join('') || '<p class="hint">تیرلیست فعلاً در دسترس نیست.</p>');
    tb.querySelectorAll('a[data-hero]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); openHero(a.dataset.hero); }));
  } catch (e) { showError(box, e); }
}

// ---------- جزئیات پچ ----------
async function showPatchDetail(title) {
  const box = document.getElementById('newsBox');
  const tb = document.getElementById('tierBox');
  loading(box);
  tb.innerHTML = '';
  try {
    const sd = await loadStatic();
    const p = (sd.faContent.patches || {})[title];
    const src = (sd.patchFull || []).find((x) => x.title === title) || {};
    if (!p) { box.innerHTML = '<p class="hint">جزئیات این پچ پیدا نشد.</p>'; return; }
    const det = (heading, inner) => inner ? `<details class="item-card"><summary>${heading}</summary>${inner}</details>` : '';
    const news = (p.new_heroes_fa || []).map((nh) => det(`<b>${esc(nh.hero)}</b> — هیروی تازه`, `${nh.feature_fa ? `<p>${esc(nh.feature_fa)}</p>` : ''}${(nh.skills_fa || []).map((sk) => `<p><b>${esc(sk.skill)}</b></p>${(sk.changes_fa || []).map((c) => `<p>◦ ${esc(c)}</p>`).join('')}`).join('')}`)).join('');
    const heroAdj = (p.hero_adjustments_fa || []).map((a) => det(`<b>${esc(a.hero)}</b>${a.type_fa ? ` — ${esc(a.type_fa)}` : ''}`, `${a.note_fa ? `<p>${esc(a.note_fa)}</p>` : ''}${(a.skills_fa || []).map((sk) => `<p><b>${esc(sk.skill)}</b>${sk.type_fa ? ` <span class="sub">${esc(sk.type_fa)}</span>` : ''}</p>${(sk.changes_fa || []).map((c) => `<p>◦ ${esc(c)}</p>`).join('')}`).join('')}`)).join('');
    const equipAdj = (p.equipment_adjustments_fa || []).map((a) => det(`<b>${esc(a.item)}</b>${a.type_fa ? ` — ${esc(a.type_fa)}` : ''}`, `${a.note_fa ? `<p>${esc(a.note_fa)}</p>` : ''}${(a.groups_fa || []).map((g) => `<p><b>${esc(g.group)}</b>${g.type_fa ? ` <span class="sub">${esc(g.type_fa)}</span>` : ''}</p>${(g.changes_fa || []).map((c) => `<p>◦ ${esc(c)}</p>`).join('')}`).join('')}`)).join('');
    const others = (p.other_sections_fa || []).map((o) => det(`<b>${esc(o.heading_fa)}</b>`, `<p>${esc(o.text_fa)}</p>`)).join('');
    box.innerHTML = `<button class="back" id="patchBack">← بازگشت به اخبار</button>
      <h2>📝 ${esc(p.title_fa || title)}</h2>${src.release_date ? `<p class="hint">تاریخ انتشار: ${esc(src.release_date)}</p>` : ''}
      ${news ? `<h2>🆕 هیروهای تازه</h2>${news}` : ''}
      ${heroAdj ? `<h2>⚖️ تغییرات هیروها (${faNum((p.hero_adjustments_fa || []).length)})</h2>${heroAdj}` : ''}
      ${equipAdj ? `<h2>🛡️ تغییرات آیتم‌ها</h2>${equipAdj}` : ''}
      ${others ? `<h2>📋 بخش‌های دیگر</h2>${others}` : ''}`;
    document.getElementById('patchBack').addEventListener('click', () => loadNews());
  } catch (e) { showError(box, e); }
}

// ---------- ترکیب تیمی ----------
async function loadComps() {
  const box = document.getElementById('compsBox');
  const st = document.getElementById('compsStatus');
  st.textContent = '';
  loading(box);
  try {
    const sd = await loadStatic();
    const comps = sd.teamComps || [];
    const guide = (sd.faContent.guide || {});
    const laneName = { exp: 'اکس‌پی', mid: 'مید', gold: 'گلد', roam: 'روم', jungle: 'جانگل' };
    box.innerHTML =
      (comps.length ? comps.map((c) => {
        const titleFa = ((sd.faContent.comps || {})[c.id] || {}).title_fa || c.title_fa || c.title;
        return `<div class="item-card"><b>${esc(titleFa)}</b> <span class="sub">— میانگین وین‌ریت ${pct(c.avg_win_rate)}</span><br>${(c.heroes || []).map((h) => `<div class="skill hrow"><div><b>${esc(h.name)}</b> — ${esc(laneName[h.lane] || h.lane)} (وین ${pct(h.win_rate)})</div></div>`).join('')}</div>`;
      }).join('') : '<p class="hint">ترکیب تیمی فعلاً در دسترس نیست.</p>') +
      (guide.how_it_works_fa ? `<h2>🧭 ترکیب تیمی چطور ساخته می‌شود؟</h2><p>${esc(guide.how_it_works_fa)}</p>` : '') +
      ((guide.faqs_fa || []).length ? `<h2>❓ پرسش‌های متداول</h2>` + guide.faqs_fa.map((f) => `<details class="item-card"><summary><b>${esc(f.question_fa)}</b></summary><p>${esc(f.answer_fa)}</p></details>`).join('') : '');
  } catch (e) { showError(box, e); }
}

// ---------- داستان هیروها ----------
async function loadLore(q = '') {
  const box = document.getElementById('loreBox');
  const st = document.getElementById('loreStatus');
  st.textContent = '';
  loading(box);
  try {
    const sd = await loadStatic();
    const all = (sd.heroes || []).map(heroPublic);
    const list = q ? all.filter((h) => normStr(h.name).includes(normStr(q))) : all;
    if (!list.length) { box.innerHTML = ''; st.textContent = 'هیرویی پیدا نشد.'; return; }
    box.innerHTML = `<div class="grid">${list.map(heroCard).join('')}</div>`;
    box.querySelectorAll('.hero-card').forEach((c) => c.addEventListener('click', () => showLore(c.dataset.id)));
  } catch (e) { showError(box, e); }
}
async function showLore(id) {
  const box = document.getElementById('loreBox');
  loading(box);
  try {
    const sd = await loadStatic();
    const h = (sd.heroes || []).map(heroPublic).find((x) => String(x.id) === String(id));
    const lore = (sd.faContent.lore || {})[String(id)];
    if (!h || !lore) { box.innerHTML = '<p class="hint">داستانی پیدا نشد.</p>'; return; }
    const info = lore.info_fa || {};
    const infoBits = [info.title_fa, info.gender_fa, info.species_fa, info.occupation_fa, info.fighting_style_fa].filter(Boolean).join('، ');
    box.innerHTML = `<button class="back" id="loreBack">← بازگشت به داستان‌ها</button>
      <div class="detail-head">${h.portrait ? `<img src="${esc(h.portrait)}" alt="${esc(h.name)}">` : ''}<div><h2>${esc(h.name)}</h2><div>${esc(roleFa(h.class))} — ${esc(laneFa(h.laning))}</div></div></div>
      ${infoBits ? `<p class="hint">${esc(infoBits)}</p>` : ''}
      ${lore.bio_short_fa ? `<p>${esc(lore.bio_short_fa)}</p>` : ''}
      ${lore.bio_fa ? `<details open><summary>داستان کامل</summary><p>${esc(lore.bio_fa)}</p></details>` : ''}`;
    document.getElementById('loreBack').addEventListener('click', () => loadLore());
  } catch (e) { showError(box, e); }
}

// ---------- آیتم‌ها ----------
async function loadItems(q = '') {
  const box = document.getElementById('itemList');
  const st = document.getElementById('itemStatus');
  st.textContent = '';
  loading(box);
  try {
    const j = await api('/api/items' + (q ? '?q=' + encodeURIComponent(q) : ''));
    const list = j.items || [];
    if (!list.length) { box.innerHTML = ''; st.textContent = 'آیتمی پیدا نشد.'; return; }
    box.innerHTML = list.map((it) => {
      const mods = Object.entries(it.modifiers || {}).map(([k, v]) => `${esc(k)}: ${faNum(v)}`).join('، ');
      const ps = (it.passives || []).map((p) => `<b>${esc(p.name)}</b>: ${esc(clean(p.desc))}`).join('<br>');
      return `<div class="item-card"><div class="it-row">${it.icon ? `<img src="${esc(it.icon)}" alt="${esc(it.name)}" loading="lazy" onerror="this.style.display='none'">` : ''}<div><b>${esc(it.name)}</b> <span class="sub">${esc(it.category)} | تیر ${faNum(it.tier)}${it.cost ? ' | ' + faInt(it.cost) + ' طلا' : ''}</span></div></div>
        ${mods ? `<br>${mods}` : ''}${ps ? `<br>${ps}` : ''}</div>`;
    }).join('');
  } catch (e) { showError(box, e); }
}
document.getElementById('itemSearchBtn').addEventListener('click', () => loadItems(document.getElementById('itemSearch').value.trim()));
document.getElementById('itemSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadItems(e.target.value.trim()); });

// ---------- امبلم / اسپل ----------
async function loadEmblems() {
  const eb = document.getElementById('emblemList');
  const sb = document.getElementById('spellList');
  const st = document.getElementById('emblemStatus');
  st.textContent = '';
  loading(eb); sb.innerHTML = '';
  try {
    const j = await api('/api/emblems');
    const img = (u) => u ? `<img src="${esc(u)}" alt="" loading="lazy" onerror="this.remove()">` : '';
    eb.innerHTML = (j.emblems || []).map((e) => {
      const mods = (e.modifiers || []).flatMap((m) => Object.entries(m).map(([k, v]) => `${esc(k)}: ${faNum(v)}`)).join('، ');
      return `<div class="item-card"><div class="it-row">${img(e.icon)}<div><b>${esc(e.emblem_name)}</b> <span class="sub">${esc(e.emblem_role || '')}</span></div></div>${mods ? `<div class="sub">${mods}</div>` : ''}</div>`;
    }).join('') + '<h2>⭐ تلنت‌ها</h2>' +
      [...(j.talents.tier1 || []), ...(j.talents.tier2 || []), ...(j.talents.tier3 || [])]
        .map((t) => `<div class="item-card"><div class="it-row">${img(t.icon)}<div><b>${esc(t.name)}</b><br><span class="sub">${esc(t.description)}</span></div></div></div>`).join('');
    sb.innerHTML = (j.spells || []).map((s) => `<div class="item-card"><div class="it-row">${img(s.icon)}<div><b>${esc(s.name)}</b><br><span class="sub">${esc(clean(s.desc))}</span></div></div></div>`).join('')
      || (j.spells_error ? `<p class="hint error">اسپل‌ها فعلاً در دسترس نیستند: ${esc(j.spells_error)}</p>` : '<p class="hint">اسپلی پیدا نشد.</p>');
  } catch (e) { showError(eb, e); }
}

// ---------- ماشین وین‌ریت ----------
document.getElementById('wrCalc').addEventListener('click', async () => {
  const box = document.getElementById('wrResult');
  const m = document.getElementById('wrMatch').value;
  const now = document.getElementById('wrNow').value;
  const fut = document.getElementById('wrFuture').value;
  loading(box, '⏳ در حال محاسبه…');
  try {
    const j = await api(`/api/wr?match-now=${m}&wr-now=${now}&wr-future=${fut}`);
    box.innerHTML = `برای رسیدن از ${pct(now)} به ${pct(fut)} با ${faInt(m)} مچ، باید <b>${faInt(j.required_no_lose_matches)} برد پشت سر هم</b> بدون باخت بگیری.`;
  } catch (e) { showError(box, e); }
});

// ---------- MPL ----------
document.querySelectorAll('.league-row button').forEach((b) => b.addEventListener('click', async () => {
  document.querySelectorAll('.league-row button').forEach((x) => x.classList.remove('active'));
  b.classList.add('active');
  const box = document.getElementById('mplBox');
  loading(box);
  try {
    const j = await api('/api/mpl/' + b.dataset.league + '/standings');
    const rows = j.standings || [];
    if (!rows.length) { box.innerHTML = '<p class="hint">فعلاً ردیفی در جدول نیست.</p>'; return; }
    box.innerHTML = rows.slice(0, 10).map((d) => {
      return `<div class="item-card"><b>${faNum(d.rank)}. ${esc(d.team)}</b>${d.fullName ? ` <span class="sub">${esc(d.fullName)}</span>` : ''}${d.wins != null ? ' — برد ' + faNum(d.wins) : ''}${d.losses != null ? ' | باخت ' + faNum(d.losses) : ''}${d.points != null ? ' | امتیاز ' + faNum(d.points) : ''}${d.gameWins != null ? ' | گیم ' + faNum(d.gameWins) + '–' + faNum(d.gameLosses) : ''}</div>`;
    }).join('');
  } catch (e) { showError(box, e); }
}));

// ---------- پروفایل ----------
document.getElementById('plSendVc').addEventListener('click', async () => {
  const box = document.getElementById('plResult');
  const game_id = document.getElementById('plGame').value.trim();
  const zone_id = document.getElementById('plZone').value.trim();
  if (!/^\d+$/.test(game_id) || !/^\d+$/.test(zone_id)) { box.innerHTML = '⚠️ Game ID و Zone ID فقط عددند.'; return; }
  loading(box, '⏳ در حال ارسال کد…');
  try {
    await api('/api/user/send-vc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game_id, zone_id }) });
    box.innerHTML = '✅ کد ارسال شد؛ کد داخل بازی را وارد کن.';
  } catch (e) { showError(box, e); }
});
document.getElementById('plLogin').addEventListener('click', async () => {
  const box = document.getElementById('plResult');
  const game_id = document.getElementById('plGame').value.trim();
  const zone_id = document.getElementById('plZone').value.trim();
  const verification_code = document.getElementById('plCode').value.trim();
  if (!verification_code) { box.innerHTML = '⚠️ کد تایید را وارد کن.'; return; }
  loading(box, '⏳ در حال ورود…');
  try {
    const j = await api('/api/user/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game_id, zone_id, verification_code }) });
    const token = j.data?.token || j.data?.jwt || j.data?.access_token || (typeof j.data === 'string' ? j.data : null);
    if (token) localStorage.setItem('mlbb_jwt', token);
    box.innerHTML = '✅ وارد شدی! توکن فقط در همین مرورگر ذخیره شد.';
  } catch (e) { showError(box, e); }
});

// ---------- اسپات‌لایت متا (۵ هیروی برتر ۷ روز اخیر با عکس واقعی) ----------
async function renderSpotlight() {
  const box = document.getElementById('spotlightBox');
  if (!box) return;
  try {
    const sd = await loadStatic();
    const stats = (sd.heroStats || []).filter((s) => s && Number.isFinite(Number(s.win_rate)))
      .sort((a, b) => Number(b.win_rate) - Number(a.win_rate)).slice(0, 5);
    const card = box.closest ? box.closest('.spotlight-card') : null;
    if (!stats.length) { if (card) card.style.display = 'none'; return; }
    const byName = new Map((sd.heroes || []).map((h) => [h.hero_name, h]));
    const items = stats.map((s) => {
      const h = byName.get(s.name);
      return h ? { stat: s, pub: heroPublic(h) } : null;
    }).filter(Boolean);
    if (!items.length) { if (card) card.style.display = 'none'; return; }
    let cur = 0;
    let timer = null;
    const mainHTML = (i) => {
      const { stat: s, pub: h } = items[i];
      const fa = (sd.faContent.stats.heroes || {})[s.slug] || {};
      const specs = (fa.specialities_fa || s.specialities || []).join('، ');
      return `<div class="spot-main">
        <img src="${esc(h.portrait)}" alt="${esc(h.name)}">
        <div>
          <div class="spot-rank">رتبهٔ ${faNum(s.position)} وین‌ریت — ۷ روز اخیر</div>
          <h3>${esc(h.name)}</h3>
          <div class="spot-tags">${esc(roleFa(h.class))} — ${esc(laneFa(h.laning))}</div>
          <div class="spot-win">وین‌ریت <b>${pct(s.win_rate)}</b> <span>(${esc(fa.win_label_fa || s.win_label || '')})</span></div>
          <div class="spot-sub">پیک ${pct(s.pick_rate)} — بن ${pct(s.ban_rate)}${specs ? ' — ' + esc(specs) : ''}</div>
        </div>
      </div>
      <div class="spot-strip">${items.map((it, j) => `<img src="${esc(it.pub.portrait)}" class="spot-chip${j === i ? ' active' : ''}" data-i="${j}" alt="${esc(it.pub.name)}">`).join('')}</div>`;
    };
    const show = (i) => {
      cur = i;
      box.classList.add('fade');
      setTimeout(() => { box.innerHTML = mainHTML(cur); bindChips(); box.classList.remove('fade'); }, 250);
    };
    const bindChips = () => box.querySelectorAll('.spot-chip').forEach((c) => c.addEventListener('click', () => { show(Number(c.dataset.i) || 0); schedule(); }));
    const schedule = () => {
      if (timer) clearTimeout(timer);
      if (!box.isConnected) return;
      timer = setTimeout(() => { show((cur + 1) % items.length); schedule(); }, 4500);
    };
    box.innerHTML = mainHTML(0);
    bindChips();
    schedule();
  } catch { const card = box.closest ? box.closest('.spotlight-card') : null; if (card) card.style.display = 'none'; }
}

// شروع
loadHeroes();
loadItems();
renderSpotlight();
