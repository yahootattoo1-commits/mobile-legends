// اسکریپر بیلدهای ۶ آیتمی mlbb.io — خروجی: data/builds-full.json
// منبع: https://mlbb.io/en/hero/{slug}/build
//   - ترتیب ۶ آیتم از JSON-LD (ItemList، همان چیزی که صفحه رسماً نشان می‌دهد)
//   - ماه بیلد از تیتر صفحه («Miya Build — November 2026»)
//   - تعداد بیلدهای تجمیع‌شده و بازهٔ ثبت آن‌ها از متن provenance
//   - امبلم و اسپل غالب از emblemConsensus / battleSpellConsensus (اگر در صفحه بود)
// اجرا: node scripts/scrape-mlbbio-builds.js [--slugs miya,layla]
// بدون آرگومان: همهٔ هیروها از sitemap-0.xml خوانده می‌شوند.
// خروج: data/builds-full.json + خلاصه در stdout + کد خروج ۱ اگر هیرویی جا ماند.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};
const DELAY_MS = 400;
const OUT = path.join(ROOT, 'data', 'builds-full.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, tries = 2) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      await sleep(1000);
    }
  }
  throw lastErr;
}

function parseBuildPage(html) {
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)]
    .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } })
    .filter(Boolean);
  const list = scripts.find((s) => s['@type'] === 'ItemList' && Array.isArray(s.itemListElement));
  if (!list) return { error: 'no ItemList JSON-LD' };
  const items = [...list.itemListElement]
    .sort((a, b) => (a.position || 0) - (b.position || 0))
    .map((e) => e.name)
    .filter(Boolean);
  const title = (html.match(/<h1[^>]*>([^<]*Build[^<]*)<\/h1>/) || [])[1] || '';
  const month = (title.match(/—\s*(.+)$/) || [])[1]?.trim() || null;
  const prov = html.match(/Aggregated from (\d+) community builds for [^,]+, submitted between ([^.]+)\./);
  // امبلم و اسپل غالب: در صفحهٔ بیلد به‌صورت HTML رندرشده‌اند («Emblem» / «Battle Spell» + نام اصلی)
  const sectionValue = (heading) => {
    const i = html.indexOf(`>${heading}</h3>`);
    if (i < 0) return null;
    const m = html.slice(i, i + 3000).match(/<span class="text-sm font-medium[^>]*>([^<]+)<\/span>/);
    return m ? m[1].trim() : null;
  };
  const emblem = sectionValue('Emblem');
  const spell = sectionValue('Battle Spell');
  // تلنت‌های امبلم غالب (۳ تلنت، به ترتیب بخش ۱ تا ۳)
  let talents = [];
  const ei = html.indexOf('>Emblem</h3>');
  if (ei >= 0) {
    talents = [...html.slice(ei, ei + 4000).matchAll(/<span class="text-xs[^"]*">([^<]+)<\/span>/g)].map((m) => m[1].trim()).slice(0, 3);
  }
  return {
    items,
    month,
    builds_count: prov ? Number(prov[1]) : null,
    submitted_range: prov ? prov[2].trim() : null,
    emblem,
    emblem_talents: talents,
    spell,
  };
}

function normName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function main() {
  const argSlugs = (process.argv.find((a) => a.startsWith('--slugs=')) || '').slice('--slugs='.length)
    .split(',').map((s) => s.trim()).filter(Boolean);

  const heroFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'hero-meta-final.json'), 'utf8'));
  const recs = Array.isArray(heroFile) ? heroFile : heroFile.data || [];
  const heroes = recs.filter((h) => h && h.hero_name && h.hero_name !== 'None');
  const bySlug = new Map();
  for (const h of heroes) {
    const slug = h.hero_name.toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9-]/g, '');
    bySlug.set(slug, h);
  }

  let slugs = argSlugs;
  if (!slugs.length) {
    const sm = await fetchText('https://mlbb.io/sitemap-0.xml');
    slugs = [...new Set([...sm.matchAll(/https:\/\/mlbb\.io\/en\/hero\/([^/<]+)\/build/g)].map((m) => m[1]))];
  }
  console.log(`slugs: ${slugs.length}`);

  const out = { generated_at: new Date().toISOString(), source: 'https://mlbb.io/en/hero/{slug}/build (JSON-LD ItemList)', heroes: {} };
  let ok = 0, bad = 0, notSix = 0;
  const missing = [];
  for (const slug of slugs) {
    const hero = bySlug.get(slug);
    if (!hero) { console.log(`SKIP ${slug}: no matching hero in static data`); missing.push(slug); continue; }
    try {
      const html = await fetchText(`https://mlbb.io/en/hero/${slug}/build`);
      const p = parseBuildPage(html);
      if (p.error || p.items.length === 0) { console.log(`FAIL ${slug} (${hero.hero_name}): ${p.error || 'no items'}`); bad++; continue; }
      if (p.items.length !== 6) { console.log(`WARN ${slug} (${hero.hero_name}): ${p.items.length} items, not 6`); notSix++; }
      out.heroes[String(hero.mlid)] = {
        name: hero.hero_name,
        slug,
        items: p.items,
        spell: p.spell,
        emblem: p.emblem,
        emblem_talents: p.emblem_talents || [],
        builds_count: p.builds_count,
        submitted_range: p.submitted_range,
        month: p.month,
      };
      ok++;
    } catch (e) {
      console.log(`FAIL ${slug} (${hero.hero_name}): ${e.message}`);
      bad++;
    }
    await sleep(DELAY_MS);
  }
  // ادغام با خروجی قبلی: اجرای گزینشی (--slugs=) نباید هیروهای دیگر را پاک کند
  let prev = { heroes: {} };
  try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {}
  out.heroes = { ...(prev.heroes || {}), ...out.heroes };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`DONE ok=${ok} bad=${bad} notSix=${notSix} missing_slugs=${missing.length} total_heroes=${Object.keys(out.heroes).length} -> ${OUT}`);
  if (bad > 0 || missing.length > 0) process.exit(1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
