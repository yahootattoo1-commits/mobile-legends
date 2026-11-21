// تست موقت دستورهای /hero و /patch و /comps و /news با کد واقعی src/bot.js (تلگرام جعلی)
const fs = require('fs');

const USERS = '/home/hatch/workspace/mlbb-bot/logs/users.json';
const hadUsers = fs.existsSync(USERS);
const backup = hadUsers ? fs.readFileSync(USERS) : null;

async function main() {
  process.env.BOT_TOKEN = process.env.BOT_TOKEN || 'test-token-no-network';
  const { createBot } = require('/home/hatch/workspace/mlbb-bot/src/bot');
  // مربی هوش مصنوعی: استاب Workers AI (مدل واقعی صدا نمی‌خورد)
  const aiCalls = [];
  const stubAI = { run: async (model, opts) => { aiCalls.push({ model, opts }); return { response: 'پاسخ تستی مربی' }; } };
  const kvMap = new Map();
  const stubKV = { get: async (k) => (kvMap.has(k) ? kvMap.get(k) : null), put: async (k, v) => { kvMap.set(k, v); }, delete: async (k) => { kvMap.delete(k); } };
  const bot = createBot({ ADMIN_ID: '999999999' }, { coachAI: stubAI, coachKV: stubKV });
  const captured = [];
  const Telegram = require('/home/hatch/workspace/mlbb-bot/node_modules/telegraf/lib/telegram').default;
  Telegram.prototype.callApi = async function (method, payload) {
    captured.push({ method, payload });
    return { ok: true, result: { message_id: 1 } };
  };
  const upd = (text, fromId = 111, firstName = 'Test') => ({
    update_id: 1,
    message: {
      message_id: 1,
      date: 1730000000,
      text,
      entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }],
      chat: { id: fromId, type: 'private' },
      from: { id: fromId, is_bot: false, first_name: firstName },
    },
  });
  const updCb = (data, fromId = 999999999, firstName = 'Admin') => ({
    update_id: 2,
    callback_query: {
      id: 'cb1',
      from: { id: fromId, is_bot: false, first_name: firstName },
      message: { message_id: 1, date: 1730000000, chat: { id: fromId, type: 'private' }, text: 'panel' },
      data,
    },
  });
  await bot.handleUpdate(upd('/hero Miya'));
  await bot.handleUpdate(upd('/patch'));
  await bot.handleUpdate(upd('/patch 1.9.20'));
  await bot.handleUpdate(upd('/patch 2.2.16'));
  await bot.handleUpdate(upd('/comps'));
  await bot.handleUpdate(upd('/news'));
  await bot.handleUpdate(upd('/lore Miya'));
  await bot.handleUpdate(upd('/lore'));
  await bot.handleUpdate(upd('/lore Zzzzzz'));
  await bot.handleUpdate(upd('/hero Masha'));
  await bot.handleUpdate(upd('/counter Yu Zhong Pharsa'));
  await bot.handleUpdate(upd('/counter Zzzzzz'));
  await bot.handleUpdate(upd('/counter Miya Zzzzzz'));
  await bot.handleUpdate(upd('/ask بهترین بیلد Miya چیست؟'));
  // سقف روزانهٔ هر کاربر: کاربر ۱۱۱ دو جواب دیگر می‌گیرد (سه شد)، چهارمی سقف است
  await bot.handleUpdate(upd('/ask بهترین بیلد Miya چیست؟', 111));
  await bot.handleUpdate(upd('/ask بهترین بیلد Miya چیست؟', 111));
  await bot.handleUpdate(upd('/ask بهترین بیلد Miya چیست؟', 111)); // ۴ — سقف
  // مدیر نامحدود است: پنج جواب
  for (let i = 0; i < 5; i++) await bot.handleUpdate(upd('/ask بهترین بیلد Miya چیست؟', 999999999, 'Admin'));
  // override عددی ۵ برای کاربر ۲۲۲: پنج جواب، ششمی سقف با عدد ۵
  kvMap.set('coach:limit:222', '5');
  for (let i = 0; i < 5; i++) await bot.handleUpdate(upd('/ask بهترین بیلد Miya چیست؟', 222));
  await bot.handleUpdate(upd('/ask بهترین بیلد Miya چیست؟', 222)); // ۶ — سقف
  // override نامحدود برای کاربر ۳۳۳: چهار جواب بدون سقف
  kvMap.set('coach:limit:333', 'inf');
  for (let i = 0; i < 4; i++) await bot.handleUpdate(upd('/ask بهترین بیلد Miya چیست؟', 333));
  // پنل مدیریت — کاربران، جزئیات، تغییر سقف
  await bot.handleUpdate(upd('/admin', 999999999, 'Admin'));
  await bot.handleUpdate(updCb('admin_users', 999999999, 'Admin'));
  await bot.handleUpdate(updCb('coach:u:111', 999999999, 'Admin'));
  await bot.handleUpdate(updCb('coach:set:111:5', 999999999, 'Admin'));
  const limitAfterSet5 = kvMap.get('coach:limit:111');
  await bot.handleUpdate(updCb('coach:set:111:default', 999999999, 'Admin'));
  const limitAfterReset = kvMap.get('coach:limit:111');
  await bot.handleUpdate(updCb('coach:u:222', 111, 'Test')); // غیرمدیر — رد می‌شود

  // ---------- منوی دکمه‌ای — نمونهٔ دوم ربات با استاب تازه ----------
  // شمارنده‌های مربی در نمونهٔ اول سفت شده‌اند (۱۷ جواب)، پس تست‌های منو روی نمونهٔ
  // دوم با استاب و KV تازه می‌دوند تا شمارنده‌های نمونهٔ اول دست نخورند.
  const aiCalls2 = [];
  const stubAI2 = { run: async (model, opts) => { aiCalls2.push({ model, opts }); return { response: 'پاسخ تستی مربی' }; } };
  const kvMap2 = new Map();
  const stubKV2 = { get: async (k) => (kvMap2.has(k) ? kvMap2.get(k) : null), put: async (k, v) => { kvMap2.set(k, v); }, delete: async (k) => { kvMap2.delete(k); } };
  const bot2 = createBot({ ADMIN_ID: '999999999' }, { coachAI: stubAI2, coachKV: stubKV2 });
  const captured2 = [];
  Telegram.prototype.callApi = async function (method, payload) {
    captured2.push({ method, payload });
    return { ok: true, result: { message_id: 1 } };
  };
  const updText = (text, fromId = 444, firstName = 'Menu') => ({
    update_id: 3,
    message: {
      message_id: 2, date: 1730000000, text,
      chat: { id: fromId, type: 'private' },
      from: { id: fromId, is_bot: false, first_name: firstName },
    },
  });
  const U = 444; // کاربر عادی تست منو
  // /start — کپشن رنگی + دکمه‌های رنگی
  await bot2.handleUpdate(upd('/start', U, 'Menu'));
  // متا و MPL
  await bot2.handleUpdate(updCb('menu_meta', U, 'Menu'));
  await bot2.handleUpdate(updCb('menu_mpl', U, 'Menu'));
  await bot2.handleUpdate(updCb('mpl:id', U, 'Menu'));
  // بیلد: نقش → هیرو → لین → بیلد
  await bot2.handleUpdate(updCb('menu_build', U, 'Menu'));
  await bot2.handleUpdate(updCb('pick:build:role:Marksman', U, 'Menu'));
  await bot2.handleUpdate(updCb('pick:build:hero:1', U, 'Menu'));
  await bot2.handleUpdate(updCb('build:1:gold', U, 'Menu'));
  // کانتر تک‌هیرو: نقش → هیرو → کانتر
  await bot2.handleUpdate(updCb('menu_counter', U, 'Menu'));
  await bot2.handleUpdate(updCb('counter:mode:single', U, 'Menu'));
  await bot2.handleUpdate(updCb('pick:counter:role:Marksman', U, 'Menu'));
  await bot2.handleUpdate(updCb('pick:counter:hero:1', U, 'Menu'));
  // کانتر تیمی: دو هیرو → محاسبه
  await bot2.handleUpdate(updCb('menu_counter', U, 'Menu'));
  await bot2.handleUpdate(updCb('counter:mode:team', U, 'Menu'));
  await bot2.handleUpdate(updCb('pick:counterTeam:role:Marksman', U, 'Menu'));
  await bot2.handleUpdate(updCb('pick:counterTeam:hero:1', U, 'Menu'));
  await bot2.handleUpdate(updCb('pick:counterTeam:role:Marksman', U, 'Menu'));
  await bot2.handleUpdate(updCb('pick:counterTeam:hero:18', U, 'Menu'));
  await bot2.handleUpdate(updCb('counter:calc', U, 'Menu'));
  // وین‌ریت: ۱۰۰ مچ، ۵۰٪، هدف ۶۰٪
  await bot2.handleUpdate(updCb('menu_wr', U, 'Menu'));
  await bot2.handleUpdate(updCb('wr:m:100', U, 'Menu'));
  await bot2.handleUpdate(updCb('wr:now:50', U, 'Menu'));
  await bot2.handleUpdate(updCb('wr:tgt:60', U, 'Menu'));
  // اخبار، تیرلیست، ترکیب، پچ
  await bot2.handleUpdate(updCb('menu_news', U, 'Menu'));
  await bot2.handleUpdate(updCb('menu_tier', U, 'Menu'));
  await bot2.handleUpdate(updCb('menu_comps', U, 'Menu'));
  await bot2.handleUpdate(updCb('menu_patch', U, 'Menu'));
  await bot2.handleUpdate(updCb('patch:0', U, 'Menu'));
  // هیروها: نقش → هیرو → جزئیات + دکمهٔ داستان
  await bot2.handleUpdate(updCb('menu_heroes', U, 'Menu'));
  await bot2.handleUpdate(updCb('pick:heroes:role:Marksman', U, 'Menu'));
  await bot2.handleUpdate(updCb('pick:heroes:hero:1', U, 'Menu'));
  await bot2.handleUpdate(updCb('hero:lore:1', U, 'Menu'));
  // راهنمای مربی — بدون هیچ اشاره‌ای به /ask
  await bot2.handleUpdate(updCb('coach', U, 'Menu'));
  // مربی با متن آزاد
  await bot2.handleUpdate(updText('بهترین بیلد Miya چیه؟', U, 'Menu'));
  const aiCallsAfterFreeText = aiCalls2.length;
  // متن آزاد وسط جلسهٔ /player به مربی نمی‌رسد
  await bot2.handleUpdate(upd('/player', 555, 'Player'));
  await bot2.handleUpdate(updText('12345678', 555, 'Player'));
  const aiCallsAfterPlayer = aiCalls2.length;
  // مربی: سؤال Masha — هم‌تیمی‌ها + بیلد + آمار در پرامپت
  await bot2.handleUpdate(upd('/ask بهترین هم‌تیمی‌های Masha کیان؟', U, 'Menu'));
  // آیتم‌ها: دسته‌ها → آیتم‌ها → جزئیات
  await bot2.handleUpdate(updCb('menu_items', U, 'Menu'));
  await bot2.handleUpdate(updCb('itemcat:Attack', U, 'Menu'));
  await bot2.handleUpdate(updCb('item:a001', U, 'Menu'));
  await bot2.handleUpdate(upd('/item', U, 'Menu'));
  await bot2.handleUpdate(upd('/item Berserker', U, 'Menu'));
  // امبلم‌ها و اسپل‌ها: دکمه‌ها → جزئیات
  await bot2.handleUpdate(updCb('menu_emblems', U, 'Menu'));
  await bot2.handleUpdate(updCb('emblem:002', U, 'Menu'));
  await bot2.handleUpdate(updCb('spell:0', U, 'Menu'));

  const textOf = (pred) => {
    const c = captured.find((x) => pred(x.payload.text || x.payload.caption || ''));
    if (!c) return null;
    return c.payload.text || c.payload.caption || '';
  };
  const heroMsg = textOf((t) => t.includes('جنگ چیست'));
  const patchMsg = textOf((t) => t.includes('پچ ۲.۲.۱۶'));
  const patchOldMsg = textOf((t) => t.includes('پچ ۱.۹.۲۰') && t.includes('تغییرات هیروها'));
  const compsMsg = textOf((t) => t.includes('ترکیب‌های تیمی'));
  const newsMsg = textOf((t) => t.includes('اخبار و پچ‌نوت‌ها'));
  const loreBody = textOf((t) => t.includes('جنگ چیست'));
  const lorePhoto = captured.find((x) => x.method === 'sendPhoto' && (x.payload.caption || '').includes('داستان Miya'));
  const loreNoArg = captured.find((x) => (x.payload.text || '').includes('داستان‌ها') && JSON.stringify(x.payload.reply_markup || {}).includes('pick:lore:role:'));
  const patchListMsg = captured.find((x) => (x.payload.text || '').includes('کدام پچ را می‌خواهی ببینی؟') && JSON.stringify(x.payload.reply_markup || {}).includes('patch:0'));
  const loreUnknown = textOf((t) => t.includes('پیدا نشد') && t.includes('Zzzzzz'));
  const mashaMsg = textOf((t) => t.includes('هم‌تیمی‌های خوب'));
  const teamCounterMsg = textOf((t) => t.includes('کانتر تیم حریف'));
  const counterUnknownMsg = textOf((t) => t.includes('پیدا نشد') && t.includes('Zzzzzz'));
  const counterIgnoredMsg = textOf((t) => t.includes('نادیده گرفته شد'));
  const today = new Date().toISOString().slice(0, 10);
  const askMsg = textOf((t) => t.includes('پاسخ تستی مربی'));
  const askCap3 = textOf((t) => t.includes('سهم امروزت') && t.includes('(۳ جواب در روز)'));
  const askCap5 = textOf((t) => t.includes('سهم امروزت') && t.includes('(۵ جواب در روز)'));
  const stubAnswers = captured.filter((x) => (x.payload.text || '') === 'پاسخ تستی مربی').length;
  const usersListMsg = textOf((t) => t.includes('کاربران ربات'));
  const coachDetailMsg = textOf((t) => t.includes('مربی — Test'));
  const setConfirmMsg = textOf((t) => t.includes('شد ۵ جواب در روز'));
  const resetConfirmMsg = textOf((t) => t.includes('برگشت به پیش‌فرض'));
  const realNL = (t) => t && t.includes(String.fromCharCode(10)) && t.indexOf(String.fromCharCode(92) + 'n') === -1;
  const checks = [
    ['/hero رسید', !!heroMsg],
    ['/hero: داستان کوتاه', heroMsg && heroMsg.includes('جنگ چیست')],
    ['/hero: سخت‌ترین حریف‌ها', heroMsg && heroMsg.includes('سخت‌ترین حریف‌ها') && heroMsg.includes('Belerick')],
    ['/hero: آمار ۷ روز', heroMsg && heroMsg.includes('آمار ۷ روز اخیر') && heroMsg.includes('رتبهٔ')],
    ['/hero: خط‌های واقعی', realNL(heroMsg)],
    ['/hero: زیر ۴۰۹۶ کاراکتر', heroMsg && heroMsg.length < 4096],
    ['/hero: کپشن عکس زیر ۱۰۲۴ (اگر عکس دارد)', (() => { const c = captured.find((x) => x.method === 'sendPhoto' && (x.payload.caption || '').includes('Miya')); return !c || c.payload.caption.length <= 1024; })()],
    ['/patch رسید', !!patchMsg],
    ['/patch: پچ ۲.۲.۱۶', patchMsg && patchMsg.includes('پچ ۲.۲.۱۶')],
    ['/patch: تغییرات هیروها', patchMsg && patchMsg.includes('تغییرات هیروها')],
    ['/patch: خط‌های واقعی', realNL(patchMsg)],
    ['/patch: زیر ۴۰۹۶ کاراکتر', patchMsg && patchMsg.length < 4096],
    ['/patch 1.9.20 رسید', !!patchOldMsg],
    ['/patch بدون نسخه: لیست پچ‌ها', !!patchListMsg],
    ['/comps رسید', !!compsMsg],
    ['/comps: ۳ ترکیب', compsMsg && (compsMsg.match(/میانگین وین‌ریت/g) || []).length === 3],
    ['/comps: Bruno', compsMsg && compsMsg.includes('Bruno')],
    ['/comps: خط‌های واقعی', realNL(compsMsg)],
    ['/comps: زیر ۴۰۹۶ کاراکتر', compsMsg && compsMsg.length < 4096],
    ['/news: ایونت با عنوان فارسی', newsMsg && newsMsg.includes('آزمون دانش')],
    ['/news: گفتگو با عنوان فارسی', newsMsg && newsMsg.includes('گزارش متا')],
    ['/news: زیر ۴۰۹۶ کاراکتر', newsMsg && newsMsg.length < 4096],
    ['/lore Miya: عکس پرتره', !!lorePhoto],
    ['/lore Miya: داستان کامل', !!loreBody],
    ['/lore Miya: خط‌های واقعی', realNL(loreBody)],
    ['/lore Miya: زیر ۴۰۹۶ کاراکتر', loreBody && loreBody.length < 4096],
    ['/lore بدون نام: انتخاب نقش', !!loreNoArg],
    ['/lore نام اشتباه: پیدا نشد', !!loreUnknown],
    ['/hero Masha: هم‌تیمی‌های خوب', mashaMsg && mashaMsg.includes('هم‌تیمی‌های خوب') && mashaMsg.includes('Bruno')],
    ['/counter تیمی رسید', !!teamCounterMsg],
    ['/counter تیمی: Masha اول است', teamCounterMsg && teamCounterMsg.includes('Masha') && teamCounterMsg.indexOf('Masha') < teamCounterMsg.indexOf('۲.')],
    ['/counter تیمی: پوشش ۲ از ۲', teamCounterMsg && teamCounterMsg.includes('کانتر ۲ تا از ۲ هیرو')],
    ['/counter تیمی: وین‌ریت', teamCounterMsg && teamCounterMsg.includes('وین‌ریت')],
    ['/counter تیمی: زیر ۴۰۹۶ کاراکتر', teamCounterMsg && teamCounterMsg.length < 4096],
    ['/counter نام اشتباه: پیدا نشد', !!counterUnknownMsg],
    ['/counter Miya Zzzzzz: نادیده گرفته شد', !!counterIgnoredMsg],
    ['/ask رسید', !!askMsg],
    ['/ask: مدل درست', aiCalls[0] && aiCalls[0].model === '@cf/qwen/qwen3.8-27b'],
    ['/ask: پرامپت بیلد Miya را دارد', aiCalls[0] && JSON.stringify(aiCalls[0].opts.messages).includes('Windtalker')],
    ['/ask: پرامپت کانتر Miya را دارد', aiCalls[0] && JSON.stringify(aiCalls[0].opts.messages).includes('Belerick')],
    ['/ask: جهت کانتر در پرامپت صریح است', aiCalls[0] && JSON.stringify(aiCalls[0].opts.messages).includes('این هیروها Miya را کانتر می‌کنند') && JSON.stringify(aiCalls[0].opts.messages).includes('Miya این هیروها را کانتر می‌کند')],
    ['/ask: شمارندهٔ سراسری ۱۷ است', kvMap.get('coach:' + today) === '17'],
    ['/ask: شمارندهٔ کاربر ۱۱۱ سه است', kvMap.get('coach:user:111:' + today) === '3'],
    ['/ask: جواب چهارم کاربر ۱۱۱ سقف ۳ است', !!askCap3 && aiCalls.length === 17],
    ['/ask: مدیر ۵ جواب بدون سقف گرفت', kvMap.get('coach:user:999999999:' + today) === '5'],
    ['/ask: سقف override ۵ نامیده می‌شود', !!askCap5],
    ['/ask: override نامحدود — کاربر ۳۳۳ چهار جواب گرفت', kvMap.get('coach:user:333:' + today) === '4'],
    ['/ask: در مجموع ۱۷ جواب تستی فرستاده شد', stubAnswers === 17],
    ['/admin: لیست کاربران مصرف مربی را نشان می‌دهد', usersListMsg && usersListMsg.includes('۳ از ۳') && usersListMsg.includes('نامحدود')],
    ['/admin: دکمهٔ کاربر در لیست هست', !!captured.find((x) => JSON.stringify(x.payload.reply_markup || {}).includes('coach:u:111'))],
    ['/admin: جزئیات کاربر ۱۱۱ (سقف پیش‌فرض)', coachDetailMsg && coachDetailMsg.includes('۳ از ۳') && coachDetailMsg.includes('۳ (پیش‌فرض)')],
    ['/admin: دکمه‌های سقف در جزئیات هست', !!captured.find((x) => JSON.stringify(x.payload.reply_markup || {}).includes('coach:set:111:inf'))],
    ['/admin: تغییر سقف به ۵ ذخیره شد', limitAfterSet5 === '5'],
    ['/admin: تایید تغییر سقف به ۵', !!setConfirmMsg],
    ['/admin: برگشت به پیش‌فرض کلید را حذف می‌کند', limitAfterReset === undefined],
    ['/admin: تایید برگشت به پیش‌فرض', !!resetConfirmMsg],
    ['/admin: غیرمدیر به جزئیات کاربر نمی‌رسد', !!textOf((t) => t.includes('⛔ این بخش فقط برای مدیر ربات است.'))],
  ];
  const textOf2 = (pred) => {
    const c = captured2.find((x) => pred(x.payload.text || x.payload.caption || ''));
    if (!c) return null;
    return c.payload.text || c.payload.caption || '';
  };
  const kbOf2 = (pred) => captured2.find((x) => pred(JSON.stringify(x.payload.reply_markup || {})));
  const menuMetaMsg = textOf2((t) => t.includes('برترین هیروهای متا'));
  const menuMplBtns = kbOf2((k) => k.includes('mpl:id') && k.includes('mpl:ph') && k.includes('mpl:my') && k.includes('mpl:kh'));
  const menuMplMsg = textOf2((t) => t.includes('اندونزی'));
  const buildMsg = textOf2((t) => t.includes('۶ آیتم'));
  const counterMsg = textOf2((t) => t.includes('کانتر می‌کند') && t.includes('Miya'));
  const teamPickMsg = textOf2((t) => t.includes('(۲ هیرو)') && t.includes('Miya') && t.includes('Layla'));
  const teamCounterMsg2 = textOf2((t) => t.includes('کانتر تیم حریف') && t.includes('از ۲ هیرو'));
  const wrExpected = Math.max(0, Math.ceil((60 / 100 * 100 - 100 * 50 / 100) / (1 - 60 / 100) - 1e-9)); // ۲۵ برد
  const wrMsg = textOf2((t) => t.includes('ماشین‌حساب وین‌ریت') && t.includes('برد پشت سر هم'));
  const newsMenuMsg = textOf2((t) => t.includes('اخبار و پچ‌نوت‌ها'));
  const tierMenuMsg = textOf2((t) => t.includes('تیرلیست هیروها'));
  const compsMenuMsg = textOf2((t) => t.includes('ترکیب‌های تیمی'));
  const patchMenuMsg = textOf2((t) => t.includes('پچ ۲.۲.۱۶') && t.includes('تغییرات هیروها'));
  const heroDetailKb = kbOf2((k) => k.includes('hero:lore:1'));
  const loreViaBtn = textOf2((t) => t.includes('داستان Miya'));
  const coachHint = textOf2((t) => t.includes('سؤالت را همین‌جا بنویس'));
  const freeCoachMsg = textOf2((t) => t.includes('پاسخ تستی مربی'));
  const playerZoneMsg = textOf2((t) => t.includes('Zone ID'));
  const startCaption = textOf2((t) => t.includes('Persian Mlbb') && t.includes('همه‌چیز با دادهٔ زنده:'));
  const startKbEntry = kbOf2((k) => k.includes('menu_heroes') && k.includes('menu_items'));
  const startKb = startKbEntry ? JSON.stringify(startKbEntry.payload.reply_markup || {}) : null;
  const askSys = aiCalls[0] && JSON.stringify(aiCalls[0].opts.messages);
  const mashaAsk = aiCalls2[1] && JSON.stringify(aiCalls2[1].opts.messages);
  const itemCatsKb = kbOf2((k) => k.includes('itemcat:Attack') && k.includes('itemcat:Magic'));
  const itemListKb = kbOf2((k) => k.includes('item:a001'));
  const itemDetailMsg = textOf2((t) => t.includes("Berserker's Fury") && t.includes('دسته:'));
  const itemDetailCount = captured2.filter((x) => (x.payload.text || '').includes("Berserker's Fury")).length;
  const itemNoArgKb = kbOf2((k) => k.includes('itemcat:Defense'));
  const emblemKb = kbOf2((k) => k.includes('emblem:001') && k.includes('emblem:002'));
  const emblemHasSpells = !!kbOf2((k) => k.includes('spell:0'));
  const emblemDetailMsg = textOf2((t) => t.includes('Tank') && t.includes('تلنت‌ها'));
  const spellDetailMsg = captured2.find((x) => (x.payload.text || '').startsWith('🪄 <b>'));
  const allRepliesText = [...captured, ...captured2].map((x) => `${x.payload.text || ''} ${x.payload.caption || ''}`).join('\n');
  const menuChecks = [
    ['منو: متا جدول را نشان می‌دهد', !!menuMetaMsg],
    ['منو: متا هیچ دستوری نمی‌گوید', menuMetaMsg && !menuMetaMsg.includes('/meta')],
    ['منو: MPL چهار لیگ را نشان می‌دهد', !!menuMplBtns],
    ['منو: MPL جدول لیگ باز می‌شود', !!menuMplMsg],
    ['منو: بیلد نقش→هیرو→لین→۶ آیتم', buildMsg && buildMsg.includes('Windtalker')],
    ['منو: کانتر تک‌هیرو', !!counterMsg],
    ['منو: کانتر تیمی دو هیرو انتخاب شد', !!teamPickMsg],
    ['منو: کانتر تیمی نتیجه با پوشش', !!teamCounterMsg2],
    ['منو: وین‌ریت ۱۰۰/۵۰/۶۰ → ۲۵ برد', wrMsg && wrMsg.includes('۲۵ برد پشت سر هم') && wrMsg.includes('مچ فعلی: ۱۰۰') && wrExpected === 25],
    ['منو: اخبار', !!newsMenuMsg],
    ['منو: تیرلیست', !!tierMenuMsg],
    ['منو: ترکیب تیمی', !!compsMenuMsg],
    ['منو: پچ‌نوت‌ها با دکمه', !!patchMenuMsg],
    ['منو: جزئیات هیرو دکمهٔ داستان دارد', !!heroDetailKb],
    ['منو: دکمهٔ داستان، داستان را باز می‌کند', !!loreViaBtn],
    ['منو: راهنمای مربی بدون /ask', coachHint && !coachHint.includes('/ask')],
    ['منو: متن آزاد به مربی می‌رسد', !!freeCoachMsg && aiCallsAfterFreeText === 1],
    ['منو: متن آزاد وسط /player به مربی نمی‌رسد', !!playerZoneMsg && aiCallsAfterPlayer === 1],
    ['منو: کپشن /start پیام اصلی با استیکر دکمه‌ها و لینک ربات است', startCaption && startCaption.includes('ربات فارسی Mobile Legends: Bang Bang — همه‌چیز با دادهٔ زنده:') && startCaption.includes('🦸') && startCaption.includes('هیروها و متا') && startCaption.includes('⚔️') && startCaption.includes('کانتر و بیلد') && startCaption.includes('🧰') && startCaption.includes('آیتم‌ها و امبلم‌ها') && startCaption.includes('🧮') && startCaption.includes('وین‌ریت و MPL') && startCaption.includes('📰') && startCaption.includes('اخبار و پچ') && startCaption.includes('🏆') && startCaption.includes('تیرلیست و ترکیب تیمی') && startCaption.includes('📖') && startCaption.includes('داستان‌ها و مینی‌اپ') && startCaption.includes('🧠') && startCaption.includes('مربی') && startCaption.includes('https://t.me/Mlbb_Baz_bot') && !['🟡','🟢','🟤','🔵','🟠','🔴','⚪','🟣'].some((c) => startCaption.includes(c))],
    ['منو: دکمه‌ها بدون گوی رنگی‌اند', startKb && startKb.includes('🦸 هیروها') && startKb.includes('⚔️ کانتر') && startKb.includes('🧰 آیتم‌ها') && startKb.includes('🛡️ امبلم‌ها') && startKb.includes('🧮 ماشین وین‌ریت') && startKb.includes('📰 اخبار') && startKb.includes('🏆 تیرلیست') && startKb.includes('📖 داستان‌ها') && startKb.includes('🧠 مربی هوش مصنوعی') && !['🟡','🟢','🟤','🔵','🟠','🔴','⚪','🟣'].some((c) => startKb.includes(c))],
    ['منو: callbackها همان قبلی‌اند', startKb && startKb.includes('menu_meta') && startKb.includes('menu_news') && startKb.includes('menu_items') && startKb.includes('menu_emblems') && !!captured.find((x) => JSON.stringify(x.payload.reply_markup || {}).includes('admin_users'))],
    ['منو: /ask ساختار مربی را دارد', askSys && askSys.includes('خلاصه') && askSys.includes('چرا') && askSys.includes('چیکار کن')],
    ['منو: /ask مربی Masha هم‌تیمی دارد', mashaAsk && mashaAsk.includes('هم‌تیمی') && mashaAsk.includes('Bruno')],
    ['منو: /ask مربی Masha بیلد و آمار دارد', mashaAsk && mashaAsk.includes('بیلد ۶ آیتمی') && mashaAsk.includes('اسپل: Flicker') && mashaAsk.includes('امبلم: Fighter') && mashaAsk.includes('آمار ۷ روز اخیر')],
    ['منو: /ask جهت کانتر Masha صریح است', mashaAsk && mashaAsk.includes('این هیروها Masha را کانتر می‌کنند') && mashaAsk.includes('Masha این هیروها را کانتر می‌کند')],
    ['منو: آیتم‌ها دسته‌ها را نشان می‌دهد', !!itemCatsKb],
    ['منو: دسته Attack آیتم‌ها را نشان می‌دهد', !!itemListKb],
    ['منو: جزئیات Berserker', itemDetailMsg && itemDetailMsg.includes('Attack') && itemDetailMsg.includes('قیمت')],
    ['منو: /item بدون نام دسته‌ها را می‌دهد', !!itemNoArgKb],
    ['منو: /item Berserker جزئیات می‌دهد', itemDetailCount >= 2],
    ['منو: امبلم‌ها دکمه دارند', !!emblemKb],
    ['منو: جزئیات Tank تلنت دارد', emblemDetailMsg && emblemDetailMsg.includes('Tank')],
    ['منو: اسپل جزئیات می‌دهد', !emblemHasSpells || !!spellDetailMsg],
    ['منو: هیچ پاسخی /item یا /items نمی‌گوید', !allRepliesText.includes('/item')],
  ];
  for (const [name, ok] of checks) console.log((ok ? 'PASS ' : 'FAIL ') + name);
  for (const [name, ok] of menuChecks) console.log((ok ? 'PASS ' : 'FAIL ') + name);
  if (heroMsg) console.log('--- /hero length:', heroMsg.length);
  if (patchMsg) console.log('--- /patch length:', patchMsg.length);
  if (compsMsg) console.log('--- /comps length:', compsMsg.length);
  if (checks.some(([, ok]) => !ok) || menuChecks.some(([, ok]) => !ok)) process.exit(1);
}

main().finally(() => {
  if (hadUsers) fs.writeFileSync(USERS, backup);
  else if (fs.existsSync(USERS)) fs.unlinkSync(USERS);
});
