// شیم CJS برای پچِ Telegram — باید CJS باشد تا esbuild، require مستقیم را
// در باندل ردیابی کند (require از طریق createRequire ردیابی نمی‌شود و در
// باندل به‌صورت مسیرِ زمان‌اجرا باقی می‌ماند).
// نکته: telegraf بابت exports نقشه‌اش اجازهٔ require('telegraf/lib/telegram')
// را نمی‌دهد؛ پس با مسیر فایل نسبی لود می‌شود (همان ماژولی که خود
// telegraf.js از ./telegram می‌خواند — هویت ماژول حفظ می‌شود).
const telegramLib = require('../../node_modules/telegraf/lib/telegram.js');

module.exports = { telegramLib };
