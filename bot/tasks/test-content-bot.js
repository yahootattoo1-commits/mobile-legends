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
  const loreNoArg = textOf((t) => t.includes('نام هیرو را بنویس') && t.includes('/lore Miya'));
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
    ['/lore بدون نام: راهنما', !!loreNoArg],
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
    ['/ask: مدل درست', aiCalls[0] && aiCalls[0].model === '@cf/meta/llama-3.1-8b-instruct-fp8'],
    ['/ask: پرامپت بیلد Miya را دارد', aiCalls[0] && JSON.stringify(aiCalls[0].opts.messages).includes('Windtalker')],
    ['/ask: پرامپت کانتر Miya را دارد', aiCalls[0] && JSON.stringify(aiCalls[0].opts.messages).includes('Belerick')],
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
  for (const [name, ok] of checks) console.log((ok ? 'PASS ' : 'FAIL ') + name);
  if (heroMsg) console.log('--- /hero length:', heroMsg.length);
  if (patchMsg) console.log('--- /patch length:', patchMsg.length);
  if (compsMsg) console.log('--- /comps length:', compsMsg.length);
  if (checks.some(([, ok]) => !ok)) process.exit(1);
}

main().finally(() => {
  if (hadUsers) fs.writeFileSync(USERS, backup);
  else if (fs.existsSync(USERS)) fs.unlinkSync(USERS);
});
