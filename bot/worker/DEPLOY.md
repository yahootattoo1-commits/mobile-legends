# استقرار ربات روی Cloudflare Workers — ران‌بوک فاز ۲ (برای ایجنت والد)

> دیپلوی اول انجام شد ۱۵ نوامبر ۲۰۲۶ (ورژن bbef21a0)؛ این ران‌بوک برای دیپلوی‌های بعدی است.
> هیچ سکرتی (توکن ربات، شناسهٔ مدیر، سکرت وبهوک) در هیچ فایلی نوشته نمی‌شود —
> همه با `wrangler secret put` ست می‌شوند و مقدارشان را کاربر می‌دهد.

## پیش‌نیاز
- حساب Cloudflare: فقط ایمیل لازم است، **کارت بانکی نمی‌خواهد**.
- ‏`wrangler` در همین پوشه نصب است (`npm install` در `worker/`).

## مرحله‌ها
1. **ورود:** `cd ~/workspace/mlbb-bot/worker && npx wrangler login`
   (OAuth در مرورگر؛ حساب با ایمیل کاربر ساخته می‌شود.)
2. **ساخت KV:**
   ```sh
   npx wrangler kv:namespace create USERS
   ```
   شناسهٔ برگشتی (`id`) را در `wrangler.toml` جای placeholder
   (`00000000000000000000000000000000`) بگذار.
3. **سکرت‌ها** (هر کدام یک بار؛ مقدار را تایپ کن، در فایل ننویس):
   ```sh
   npx wrangler secret put BOT_TOKEN      # توکن ربات از @BotFather (‎/mybots ← API Token)
   npx wrangler secret put ADMIN_ID       # شناسهٔ عددی تلگرام مدیر (از کاربر بگیر)
   npx wrangler secret put WEBHOOK_SECRET # یک رشتهٔ تصادفی، مثلاً: openssl rand -hex 32
   ```
   ⚠️ برای BOT_TOKEN فقط **توکن واقعی** @BotFather را بگذار — نه جانشینِ Vault
   (`hsurr:...`). جانشین فقط روی همین ماشین کار می‌کند (Sentinel موقع درخواست
   به api.telegram.org آن را عوض می‌کند)؛ ورکر آن رشته را همان‌طور به تلگرام
   می‌فرستد و تلگرام با 404 جواب می‌دهد (دقیقاً همین اتفاق ۱۵ نوامبر افتاد و
   ربات جواب نمی‌داد). اگر سکرت اشتباه ست شد، مقدار درست را کاربر خودش در
   داشبورد Cloudflare (Workers ← persian-mlbb-bot ← Settings ← Variables and
   Secrets ← BOT_TOKEN) جایگذاری کند — هرگز توکن را در چت نفرستد.
4. **دیپلوی (فقط ساخت، بدونِ هیچ تغییر دیگری):**
   ```sh
   npx wrangler deploy
   ```
   آدرس خروجی را یادداشت کن: `https://persian-mlbb-bot.<subdomain>.workers.dev`
   (نام Worker همان `persian-mlbb-bot` است.)
5. **تست سلامت:** آدرس `https://<worker>.workers.dev/health` را باز کن —
   باید `{"status":"ok","mode":"webhook","heroes":133,...,"data_ready":true}` برگردد.
6. **کات‌اور — دقیقاً به این ترتیب** (تا ربات دوبار جواب ندهد):
   1. کرون نگهبان را خاموش کن: `cron.update mlbb-bot-watchdog` با `enabled: false`
      (بعداً می‌شود حذفش کرد؛ روی Workers نگهبانی لازم نیست.)
   2. ربات VM را متوقف کن: `~/workspace/mlbb-bot/run-bot.sh stop`
      (اول stop، بعد وبهوک — وگرنه polling و وبهوک با هم درگیر می‌شوند.)
   3. وبهوک را ست کن (مقدار WEBHOOK_SECRET را همان مقدار مرحلهٔ ۳ بده؛
      در فایل یا لاگ ننویس — دستور را تعاملی اجرا کن):
      ```sh
      python3 ~/workspace/custom-connectors/custom.telegram-bot-api/bin/telegram.py setWebhook \
        --url https://<worker>.workers.dev/webhook \
        --secret-token <WEBHOOK_SECRET> --drop-pending-updates
      ```
   4. بررسی: `telegram.py getWebhookInfo` — باید همان url را نشان بدهد و
      `pending_update_count` نزدیک صفر باشد.
   5. دکمهٔ «Open App» را ست کن:
      ```sh
      python3 ~/workspace/custom-connectors/custom.telegram-bot-api/bin/telegram.py setChatMenuButton \
        --web-app-url https://yahootattoo1-commits.github.io/mobile-legends/ --text "Open App"
      ```
7. **تست زنده:** از گوشی کاربر `/start` بفرست؛ باید عکس خوشامد + منو بیاید.
   لاگ زنده: `npx wrangler tail`.

## بعد از کات‌اور (کرون‌ها)
- کرون‌های `mlbb-news-refresh` و `mlbb-builds-weekly-refresh` دیگر نیازی به
  «ری‌استارت ربات» ندارند: دیتا از GitHub Pages خوانده می‌شود و Worker هر
  ۱۰ دقیقه خودش تازه می‌کند. مرحلهٔ ری‌استارت را از بدنهٔ هر دو کرون حذف کن.
- کرون `mlbb-bot-watchdog` را حذف کن (Workers خودش سرویس را بالا نگه می‌دارد).

## نکات و مرزها — حتماً به کاربر بگو
- **عکس خوشامد هنوز روی Pages نیست:** `WELCOME_PHOTO_URL` به
  `.../mobile-legends/assets/welcome.jpg` اشاره می‌کند، ولی این فایل باینری
  هیچ‌وقت به ریپوی عمومی پوش نشده و الان 404 می‌دهد. تا وقتی عکس آنجا نیست،
  `/start` بدون عکس (فقط متن) می‌آید — خطا نیست، فالبکِ خودِ کد است.
  راه‌حل: welcome.jpg را به Pages فورک آپلود کن (از مرورگر) یا
  WELCOME_PHOTO_URL را به یک عکس عمومی دیگر بده.
- **لیست کاربران از صفر شروع می‌شود:** شمارش کاربران و پیام همگانی از KV
  خوانده می‌شود؛ KV اول خالی است و با استفادهٔ کاربران پر می‌شود.
  (لیست قدیمی logs/users.json روی VM می‌ماند و منتقل نمی‌شود.)
- **JWT ورود به بازی** در KV با TTL یک ساعته نگه داشته می‌شود (مثل قبل،
  ولی بین درخواست‌ها پایدار است؛ قبلاً با ری‌استارت VM پاک می‌شد).
- **محدودیت‌های پلن رایگان Cloudflare:** ۱۰۰٬۰۰۰ درخواست در روز،
  باندل فشرده حداکثر ۱ مگابایت (نتیجهٔ dry-run را در گزارش ساخت ببین)،
  KV: ۱۰۰٬۰۰۰ خواندن و ۱٬۰۰۰ نوشتن در روز — برای این ربات با اختلاف کافی است.
- **برگشت:** اگر وبهوک را با `setWebhook --url ""` پاک کنی و ربات VM را
  دوباره `start` کنی، همه‌چیز به حالت قبل برمی‌گردد (polling).
