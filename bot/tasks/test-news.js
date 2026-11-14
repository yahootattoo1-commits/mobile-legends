// تست موقت loadNews با کد واقعی public/app.js در vm (بدون DOM واقعی)
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('/home/hatch/workspace/mlbb-bot/public/app.js', 'utf8');

function makeEl() {
  return {
    innerHTML: '', textContent: '', value: 'win',
    addEventListener: () => {}, querySelectorAll: () => [], querySelector: () => null,
    classList: { add: () => {}, remove: () => {} },
  };
}
const elements = {};
const stub = new Proxy(function () {}, {
  get: (t, p) => {
    if (p === Symbol.toPrimitive) return () => '';
    if (p === 'forEach') return () => {};
    if (p === 'map') return () => [];
    if (p === 'then') return undefined;
    return stub;
  },
  apply: () => stub,
  set: () => true,
});
const documentStub = new Proxy({}, {
  get: (t, p) => {
    if (p === 'querySelectorAll') return () => [];
    if (p === 'querySelector') return () => stub;
    if (p === 'getElementById') return (id) => (elements[id] = elements[id] || makeEl());
    if (p === 'createElement') return () => stub;
    return stub;
  },
  set: () => true,
});

async function fakeFetch(url) {
  const u = String(url);
  if (u.startsWith('data/')) {
    const body = fs.readFileSync('/home/hatch/workspace/mlbb-bot/' + u.split('?')[0], 'utf8');
    return { ok: true, json: async () => JSON.parse(body), text: async () => body };
  }
  if (u.startsWith('/api/heroes/')) {
    return { ok: true, json: async () => ({ hero: { id: 1, name: 'Miya', class: 'Marksman', laning: ['gold lane'], rank: { win: 52.1, ban: 1.2, pick: 3.4 }, skills: [{ name: 'Moon Arrow', type: 'Passive', description: 'test desc' }], portrait: null, head_big: null, head: null, relation: { weak: [] } } }), text: async () => '' };
  }
  if (u.startsWith('/api/counters/')) {
    return { ok: true, json: async () => ({ counters: { counters: [] } }), text: async () => '' };
  }
  throw new Error('no network in test: ' + u);
}

const sandbox = {
  console, setTimeout, clearTimeout, fetch: fakeFetch,
  document: documentStub,
  localStorage: { getItem: () => null, setItem: () => {} },
  AbortController, URL, URLSearchParams,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

(async () => {
  await sandbox.loadNews();
  const newsHTML = elements.newsBox.innerHTML;
  const tierHTML = elements.tierBox.innerHTML;
  const checks = [
    ['پچ ۱.۹.۲۰ (جداکننده نقطهٔ ASCII)', newsHTML.includes('پچ ۱.۹.۲۰')],
    ['تاریخ فارسی ۱۱ نوامبر ۲۰۲۶', newsHTML.includes('۱۱ نوامبر ۲۰۲۶')],
    ['تازه‌ها (بدون کلمهٔ «ویکی»)', newsHTML.includes('تازه‌ها') && !newsHTML.includes('ویکی')],
    ['هیچ لینک/نام منبعی در اخبار نیست', !newsHTML.includes('fandom') && !newsHTML.includes('href=') && !newsHTML.includes('منبع')],
    ['هیچ نام منبعی در تیرلیست نیست', !tierHTML.includes('mlbb.io') && !tierHTML.includes('Rone') && !tierHTML.includes('ویکی') && !tierHTML.includes('منبع')],
    ['بخش گفتگوها هست', newsHTML.includes('💬 گفتگوها')],
    ['ترد Season skin change با عنوان فارسی', newsHTML.includes('تغییر اسکین فصل')],
    ['دستهٔ فارسی «باگ اندروید»', newsHTML.includes('باگ اندروید')],
    ['تاریخ گفتگو ۱۴ نوامبر ۲۰۲۶', newsHTML.includes('۱۴ نوامبر ۲۰۲۶')],
    ['گفتگوها بدون لینک/نام منبع', !newsHTML.includes('href=') && !newsHTML.includes('mlbb.io')],
    ['گفتگو با عنوان فارسی «گزارش متا»', newsHTML.includes('گزارش متا')],
    ['همهٔ گفتگوها عنوان فارسی دارند', (() => {
      const threads = JSON.parse(fs.readFileSync('/home/hatch/workspace/mlbb-bot/data/discussions.json', 'utf8')).threads;
      const fa = JSON.parse(fs.readFileSync('/home/hatch/workspace/mlbb-bot/data/fa-content.json', 'utf8'));
      return threads.every((t) => ((fa.discussions || {})[t.title] || {}).title_fa);
    })()],
    ['بخش ایونت‌ها هست', newsHTML.includes('🎉 ایونت‌ها')],
    ['ایونت با عنوان فارسی «آزمون دانش»', newsHTML.includes('آزمون دانش')],
    ['خلاصهٔ فارسی ایونت', newsHTML.includes('آزمونی درباره بازی')],
    ['کارت پچ قابل کلیک (data-patch)', newsHTML.includes('data-patch="Patch Notes 2.2.16"')],
    ['برچسب «تاریخ مشخص نیست»', newsHTML.includes('تاریخ مشخص نیست')],
    ['عکس پچ‌نوت (news-thumb)', newsHTML.includes('news-thumb')],
    ['عکس بدون ریفرر (no-referrer)', newsHTML.includes('referrerpolicy="no-referrer"')],
    ['عکس از wsrv.nl رد می‌شود', newsHTML.includes('wsrv.nl/?url=static.wikia.nocookie.net')],
    ['عکس ایونت', newsHTML.includes('static.wikia.nocookie.net')],
    ['ایونت‌ها بدون نام منبع', !newsHTML.includes('Fandom') && !newsHTML.includes('fandom.com') && !newsHTML.includes('ویکی') && !newsHTML.includes('منبع')],
    ['تیرلیست ماه نوامبر ۲۰۲۶', tierHTML.includes('نوامبر ۲۰۲۶')],
    ['SS شامل Sun', tierHTML.includes('<b>SS</b>') && tierHTML.includes('Sun')],
    ['SS شامل Obsidia', tierHTML.includes('Obsidia')],
    ['۱۳۳ هیرو در تیرلیست', tierHTML.includes('۱۳۳')],
    ['لینک هیرو در تیرلیست (data-hero)', tierHTML.includes('data-hero=')],
    ['تیر D هم هست', tierHTML.includes('<b>D</b>')],
  ];
  for (const [name, ok] of checks) console.log((ok ? 'PASS ' : 'FAIL ') + name);
  console.log('patch notes count:', (newsHTML.match(/class="item-card"/g) || []).length, '(10 patch + 10 events + 10 wiki + 10 discussions = 40 expected)');
  console.log('tier tier-cards:', (tierHTML.match(/class="item-card"/g) || []).length, '(6 expected)');
  await sandbox.loadComps();
  const compsHTML = elements.compsBox.innerHTML;
  const checks2 = [
    ['تب ترکیب تیمی: ۳ ترکیب', (compsHTML.match(/میانگین وین‌ریت/g) || []).length === 3],
    ['ترکیب بهترین وین‌ریت', compsHTML.includes('بهترین ترکیب')],
    ['هیروی Bruno در ترکیب', compsHTML.includes('Bruno')],
    ['راهنمای ترکیب', compsHTML.includes('پرسش‌های متداول')],
    ['سؤال راهنما فارسی', compsHTML.includes('ترکیب تیم خوب')],
    ['ترکیب‌ها بدون نام منبع', !compsHTML.includes('Fandom') && !compsHTML.includes('mlbb.io') && !compsHTML.includes('Rone') && !compsHTML.includes('ویکی')],
  ];
  for (const [name, ok] of checks2) console.log((ok ? 'PASS ' : 'FAIL ') + name);
  await sandbox.showPatchDetail('Patch Notes 2.2.16');
  const patchHTML = elements.newsBox.innerHTML;
  const checks3 = [
    ['جزئیات پچ ۲.۲.۱۶', patchHTML.includes('پچ ۲.۲.۱۶')],
    ['تغییرات هیروها', patchHTML.includes('تغییرات هیروها')],
    ['هیروی Aulus در پچ', patchHTML.includes('Aulus')],
    ['دکمهٔ بازگشت', patchHTML.includes('بازگشت به اخبار')],
    ['بخش‌ها collapsible', patchHTML.includes('<details')],
    ['پچ بدون نام منبع', !patchHTML.includes('Fandom') && !patchHTML.includes('mlbb.io') && !patchHTML.includes('Rone') && !patchHTML.includes('ویکی')],
  ];
  for (const [name, ok] of checks3) console.log((ok ? 'PASS ' : 'FAIL ') + name);
  await sandbox.openHero(1);
  const heroHTML = elements.heroDetail.innerHTML;
  const checks4 = [
    ['جزئیات هیرو: داستان کوتاه', heroHTML.includes('جنگ چیست')],
    ['جزئیات هیرو: داستان کامل', heroHTML.includes('داستان کامل')],
    ['جزئیات هیرو: سخت‌ترین حریف‌ها', heroHTML.includes('سخت‌ترین حریف‌ها') && heroHTML.includes('Belerick')],
    ['جزئیات هیرو: آمار ۷ روز', heroHTML.includes('آمار ۷ روز اخیر') && heroHTML.includes('رتبهٔ')],
    ['جزئیات هیرو بدون نام منبع', !heroHTML.includes('Fandom') && !heroHTML.includes('mlbb.io') && !heroHTML.includes('Rone') && !heroHTML.includes('ویکی')],
  ];
  for (const [name, ok] of checks4) console.log((ok ? 'PASS ' : 'FAIL ') + name);
  await sandbox.loadLore();
  const loreHTML = elements.loreBox.innerHTML;
  const checks5 = [
    ['تب داستان‌ها: ۱۳۳ هیرو', (loreHTML.match(/hero-card/g) || []).length === 133],
    ['تب داستان‌ها: Miya هست', loreHTML.includes('Miya')],
    ['تب داستان‌ها: عکس پرتره', loreHTML.includes('akmweb.youngjoygame.com')],
    ['تب داستان‌ها: هیچ پرترهٔ ویکی نیست', !loreHTML.includes('static.wikia')],
    ['تب داستان‌ها: بج تیر', loreHTML.includes('tier-badge')],
    ['تب داستان‌ها: چیپ لین', loreHTML.includes('lane-chip')],
    ['تب داستان‌ها بدون نام منبع', !loreHTML.includes('Fandom') && !loreHTML.includes('mlbb.io') && !loreHTML.includes('Rone') && !loreHTML.includes('ویکی')],
  ];
  for (const [name, ok] of checks5) console.log((ok ? 'PASS ' : 'FAIL ') + name);
  await sandbox.showLore(1);
  const loreDetailHTML = elements.loreBox.innerHTML;
  const checks6 = [
    ['جزئیات داستان: داستان کوتاه', loreDetailHTML.includes('جنگ چیست')],
    ['جزئیات داستان: داستان کامل', loreDetailHTML.includes('داستان کامل')],
    ['جزئیات داستان: عکس پرتره', loreDetailHTML.includes('akmweb.youngjoygame.com')],
    ['جزئیات داستان: دکمهٔ بازگشت', loreDetailHTML.includes('بازگشت به داستان‌ها')],
    ['جزئیات داستان بدون نام منبع', !loreDetailHTML.includes('Fandom') && !loreDetailHTML.includes('mlbb.io') && !loreDetailHTML.includes('Rone') && !loreDetailHTML.includes('ویکی')],
  ];
  for (const [name, ok] of checks6) console.log((ok ? 'PASS ' : 'FAIL ') + name);
  await sandbox.renderSpotlight();
  const spotHTML = elements.spotlightBox.innerHTML;
  const checks7 = [
    ['اسپات‌لایت: Masha (رتبهٔ ۱)', spotHTML.includes('Masha')],
    ['اسپات‌لایت: وین‌ریت', spotHTML.includes('۵۸')],
    ['اسپات‌لایت: ۵ چیپ', (spotHTML.match(/spot-chip/g) || []).length === 5],
    ['اسپات‌لایت: عکس واقعی', spotHTML.includes('akmweb.youngjoygame.com')],
    ['اسپات‌لایت: بدون three.js', !spotHTML.includes('threejs')],
  ];
  for (const [name, ok] of checks7) console.log((ok ? 'PASS ' : 'FAIL ') + name);
  if ([...checks, ...checks2, ...checks3, ...checks4, ...checks5, ...checks6, ...checks7].some(([, ok]) => !ok)) process.exit(1);
})();
