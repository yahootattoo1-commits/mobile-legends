// کلاینت Rone Arena API — fetch با تایم‌اوت ۱۰ ثانیه + کش ۵ دقیقه‌ای در حافظه
// Base: https://arena.rone.dev/api — پاسخ: {"code":0,"message":"OK","data":{"records":[...]}}
// نکتهٔ کشف‌شده: پارامتر index از ۱ شروع می‌شود (index=0 خطای VALIDATION_ERROR می‌دهد)
// lane فقط این ۵ مقدار کوچک را قبول می‌کند: exp | mid | roam | jungle | gold
const BASE = (typeof process !== 'undefined' && process.env && process.env.RONE_BASE) || 'https://arena.rone.dev/api';
const TTL_MS = 5 * 60 * 1000;
const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}
function cacheSet(key, value) {
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), value });
}

// پاک‌کردن کش دادهٔ زنده — برای پنل مدیریت؛ تعداد موارد پاک‌شده را برمی‌گرداند
function clearCache() {
  const n = cache.size;
  cache.clear();
  return n;
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
  const url = BASE + path;
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
  const r = await fetchJson(BASE + path, { method: 'POST', body, headers });
  if (!r.json) {
    const snippet = (r.text || '').trim().slice(0, 100);
    return { ok: false, error: snippet ? `پاسخ غیر JSON از سرور: ${snippet}` : (r.error || `خطای شبکه (HTTP ${r.status || '؟'})`), status: r.status };
  }
  if (r.json.code === 0) return { ok: true, data: r.json.data ?? r.json, status: r.status };
  if (r.json.status === 'success') return { ok: true, data: r.json, status: r.status };
  return { ok: false, error: r.json.message || r.json.detail || 'خطای API', status: r.status, raw: r.json };
}

// ---- نرمال‌سازها (شکل Rone را به شکل ساده و یکدست تبدیل می‌کنند) ----

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

// NOTE: رکوردهای sub_hero در counters فقط heroid و head دارند و نام ندارند؛
// نام را از دیتای استاتیک (mlid همان hero_id است) می‌گیریم.
let _sd = null;
function staticHeroName(id) {
  if (!_sd) { try { _sd = require('./staticData'); } catch { return ''; } }
  return _sd.heroById(id)?.hero_name || '';
}

function normCounterRecord(rec) {
  const d = rec?.data || {};
  const subs = (d.sub_hero || []).map((s) => ({
    id: s.heroid ?? null,
    name: s.hero?.data?.name || staticHeroName(s.heroid),
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

// نگاشت equipid -> equipname (برای اسم آیتم‌های بیلد) — یک بار لود و کش می‌شود
let equipMapCache = null;
let equipMapAt = 0;
async function equipNameMap() {
  if (equipMapCache && Date.now() - equipMapAt < TTL_MS) return equipMapCache;
  const map = new Map();
  const r = await roneGet('/academy/equipment?size=100&index=1');
  if (r.ok) {
    for (const rec of r.records) {
      const d = rec?.data || {};
      if (d.equipid != null && d.equipname) {
        map.set(d.equipid, d.equipname);
        map.set(String(d.equipid), d.equipname);
      }
    }
  }
  equipMapCache = map;
  equipMapAt = Date.now();
  return map;
}

module.exports = { BASE, roneGet, ronePost, clearCache, normHeroRecord, normRankRecord, normCounterRecord, normBuildRecord, normStanding, equipNameMap };
