// تست موقت دستورهای /hero و /patch و /comps و /news با کد واقعی src/bot.js (تلگرام جعلی)
const fs = require('fs');

const USERS = '/home/hatch/workspace/mlbb-bot/logs/users.json';
const hadUsers = fs.existsSync(USERS);
const backup = hadUsers ? fs.readFileSync(USERS) : null;

async function main() {
  process.env.BOT_TOKEN = process.env.BOT_TOKEN || 'test-token-no-network';
  const { createBot } = require('/home/hatch/workspace/mlbb-bot/src/bot');
  const bot = createBot();
  const captured = [];
  const Telegram = require('/home/hatch/workspace/mlbb-bot/node_modules/telegraf/lib/telegram').default;
  Telegram.prototype.callApi = async function (method, payload) {
    captured.push({ method, payload });
    return { ok: true, result: { message_id: 1 } };
  };
  const upd = (text) => ({
    update_id: 1,
    message: {
      message_id: 1,
      date: 1730000000,
      text,
      entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }],
      chat: { id: 111, type: 'private' },
      from: { id: 111, is_bot: false, first_name: 'Test' },
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
