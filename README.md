# ربات تلگرام MLBB + مینی‌اپ فارسی 🇮🇷 | Persian MLBB Telegram Bot + Mini App 🇬🇧

[🇮🇷 فارسی](#fa) | [🇬🇧 English](#en)

<a id="fa"></a>

## 🇮🇷 فارسی

ربات تلگرام **Mobile Legends: Bang Bang** با مینی‌اپ کاملاً فارسی — هیروها، متا، کانتر، بیلد، آیتم، امبلم/تلنت، جدول MPL، ماشین‌حساب وین‌ریت و مربی هوشمند — با دادهٔ زنده و توضیحات فارسی.

- 🤖 ربات تلگرام: **[@Mlbb_Baz_bot](https://t.me/Mlbb_Baz_bot)** (نام نمایشی: Persian Mlbb)
- 📱 مینی‌اپ زنده: **https://yahootattoo1-commits.github.io/mobile-legends/**

> 🇬🇧 Short English version below — [jump to English](#en).

### ویژگی‌ها

- **۱۳۳ هیرو** با توضیحات کامل مهارت‌ها به فارسی، وین‌ریت/پیک‌ریت/بن‌ریت زندهٔ ۷ روز اخیر و داستان هر هیرو
- **بیلد پیشنهادی ۶ آیتمی** برای ۱۳۱ هیرو از ۱۳۳ هیرو (Diggie و Joy به بیلد ۳ آیتمی Rone برمی‌گردند)، همراه با اسپل، امبلم و تلنت
- **کانتر هیرو و کانتر تیمی** — بهترین و بدترین کانترهای هر هیرو، و پیشنهاد کانتر برای ترکیب ۲ تا ۵ نفره
- **تیرلیست زنده** با تب اختصاصی، **متای هفتگی**، **اخبار و پچ‌ها**، **بحث‌های داغ** و **رویدادها**
- **مربی هوشمند (AI Coach)** — پاسخ فارسی، مربی‌وار و انسانی، فقط بر اساس دادهٔ واقعی بازی؛ ۳ جواب در روز برای هر کاربر (مدیر نامحدود)
- **ماشین‌حساب وین‌ریت** — چند برد پشت سر هم تا رسیدن به وین‌ریت هدف
- **جدول MPL** برای لیگ‌های ID ،PH ،MY و KH و **پروفایل بازیکن** (با کد تایید داخل بازی)
- **پنل مدیریت** — وضعیت ربات، کاربران، محدودیت مربی برای هر کاربر، بروزرسانی داده و پیام همگانی
- همه‌چیز با **دکمه** کار می‌کند؛ مربی تنها جایی است که سوال را با متن ساده می‌نویسید

### دستورهای ربات

| دستور | کار |
|---|---|
| `/start` | خوش‌آمد + دکمهٔ باز کردن مینی‌اپ |
| `/hero <نام>` | اطلاعات هیرو، مهارت‌ها (فارسی) و وین‌ریت زنده |
| `/heroes` | مرور فهرست هیروها |
| `/meta` | ۱۰ هیروی برتر متا (۷ روز اخیر) |
| `/counter <نام>` | بهترین و بدترین کانترهای هیرو (+ حالت تیمی) |
| `/build <نام> <lane>` | بیلد ۶ آیتمی پیشنهادی (`exp` ،`mid` ،`gold` ،`roam` ،`jungle`) |
| `/items` | دسته‌بندی آیتم‌ها |
| `/item <نام>` | جزئیات آیتم |
| `/emblems` | امبلم‌ها و تلنت‌ها |
| `/wr <مچ> <وین‌ریت فعلی> <هدف>` | چند برد پشت سر هم لازم است |
| `/mpl <id\|ph\|my\|kh>` | جدول لیگ MPL |
| `/player` | پروفایل بازیکن (با کد تایید داخل بازی) |
| `/news` | اخبار و بحث‌های داغ |
| `/tier` | تیرلیست هیروها |
| `/patch` | یادداشت‌های پچ |
| `/comps` | ترکیب‌های تیمی پیشنهادی |
| `/lore` | داستان هیروها |
| `/version` | نسخهٔ فعلی بازی |
| `/admin` | پنل مدیریت (فقط مدیر) |
| `/help` | راهنمای ربات |
| `/ask <سوال>` | سوال از مربی هوشمند |

> `/cancel` هم هست — لغو پیش‌نویس پیام همگانی (فقط مدیر).

### تب‌های مینی‌اپ

مینی‌اپ راست‌به‌چپ، با فونت وزیرمتن و طراحی شیشه‌ای طلایی/فیروزه‌ای است. ۱۲ تب دارد: **هیروها** (با صفحهٔ جزئیات هر هیرو: مهارت‌ها، بیلد، کانتر و هم‌تیمی‌ها)، **متا**، **🏆 تیرلیست** (تب اختصاصی، درست بعد از متا)، **آیتم‌ها**، **امبلم‌ها**، **ماشین‌حساب وین‌ریت**، **MPL**، **بازیکن**، **اخبار**، **ترکیب‌های تیمی**، **داستان‌ها** و **🧠 مربی**. بالای صفحه، کارت «داغ‌ترین‌های متا» ۵ هیروی برتر ۷ روز اخیر را با چرخش خودکار نشان می‌دهد.

### معماری

- **ربات تلگرام — Cloudflare Workers (حالت webhook، رایگان):** منطق ربات با Telegraf نوشته شده و روی Workers اجرا می‌شود؛ بدون سرور، بدون خوابیدن، بدون کارت بانکی. دو نیم‌اسپیس KV دارد: `USERS` (کاربران، محدودیت مربی، تنظیمات مدیر) و `DATA` (دادهٔ تازه‌شده). مربی با Workers AI کار می‌کند (`@cf/meta/llama-3.1-8b-instruct-fp8`).
- **مینی‌اپ — GitHub Pages (رایگان):** فایل‌های استاتیک از ریشهٔ همین ریپو سرو می‌شوند؛ بدون مرحلهٔ بیلد. داده را اول از Worker می‌خواند و اگر در دسترس نبود، از فایل‌های `data/` همین ریپو (فالبک).
- **تازه‌سازی خودکار داده — هر ۳۰ دقیقه:** یک اسکریپت خودکار (`scripts/refresh_auto.py` با تایمر systemd) خبرها، تیرلیست، بحث‌ها و رویدادها را می‌خواند؛ پچ‌ها و آمار سنگین را فقط وقتی لازم باشد. موردهای جدید را همان‌جا از طریق `/translate` ورکر به فارسی ترجمه می‌کند و فقط فایل‌های تغییرکرده را در KV ورکر می‌نویسد. وقتی چیزی تازه نباشد، ساکت می‌ماند؛ بعد از ۳ خطای پشت سر هم، به مدیر در تلگرام هشدار می‌دهد. برای تازه‌سازی داده، نه تایید دستی لازم است و نه دخالت ایجنت.
- **کش:** پاسخ‌های API زنده ۵ دقیقه در حافظه کش می‌شوند.

### اجرای محلی و استقرار

**پیش‌نیاز:** حساب Cloudflare (فقط ایمیل؛ کارت بانکی نمی‌خواهد)، Node.js ۱۸ یا بالاتر، `wrangler`.

```bash
git clone https://github.com/tattoozeus62-ship-it/mobile-legends.git
cd mobile-legends/bot/worker
npm install
```

**۱. ساخت نیم‌اسپیس‌های KV** و گذاشتن شناسه‌ها در `bot/worker/wrangler.toml`:

```bash
npx wrangler kv:namespace create USERS
npx wrangler kv:namespace create DATA
```

**۲. سکرت‌ها** (هرگز در فایل یا چت ننویسید — فقط با `wrangler secret put`):

```bash
npx wrangler secret put BOT_TOKEN      # توکن واقعی ربات از @BotFather
npx wrangler secret put ADMIN_ID       # شناسهٔ عددی تلگرام مدیر
npx wrangler secret put WEBHOOK_SECRET # رشتهٔ تصادفی، مثلاً: openssl rand -hex 32
```

**۳. دیپلوی ورکر:**

```bash
npx wrangler deploy
```

**۴. ست کردن وبهوک** (با همان `WEBHOOK_SECRET`) و دکمهٔ «Open App» روی آدرس مینی‌اپ، و تست سلامت:

```text
https://<worker>.workers.dev/health   →   {"status":"ok","mode":"webhook","heroes":133,...}
```

**مینی‌اپ:** GitHub Pages از شاخهٔ `main` همین ریپو سرو می‌شود؛ فایل‌های ریشه (`index.html` ،`app.js` ،`style.css` ،`data/`) را پوش کنید، کافی است. توسعهٔ محلی ورکر: `npx wrangler dev`.

### ساختار ریپو

```text
/                    مینی‌اپ (GitHub Pages) — index.html ،app.js ،style.css ،data/
/data                دادهٔ استاتیک و ترجمه‌ها (JSON)
bot/                 سورس ربات (Node.js — Telegraf؛ منطق مشترک bot/src)
bot/data/            دادهٔ آفلاین ربات (JSON)
bot/src/             bot.js ،coach.js ،fa.js ،rone.js ،staticData.js ،webappAuth.js
bot/worker/          ورکر Cloudflare — wrangler.toml ،src/ ،DEPLOY.md
bot/.env.example     متغیرهای محیطی (BOT_TOKEN ،ADMIN_ID ،MINIAPP_URL ،RONE_BASE)
```

> اسکریپت تازه‌سازی خودکار (`scripts/refresh_auto.py` و تایمر systemd) سمت اپراتور اجرا می‌شود و در ریپوی عمومی نیست.

### منبع داده

| منبع | کاربرد |
|---|---|
| **Rone Arena API** — `https://arena.rone.dev/api` (نسخهٔ API ‏۱٫۶٫۲، نسخهٔ بازی ۲٫۱٫۱۸) | دادهٔ زنده: هیروها، وین‌ریت/پیک‌ریت/بن‌ریت، کانتر، بیلد، اسپل، MPL، ماشین وین‌ریت |
| **دادهٔ آفلاین** (ریشه در p3hndrx/MLBB-API) — فایل‌های `data/` | متای هیرو/آیتم/امبلم/تلنت + ترجمهٔ فارسی؛ فالبک وقتی سرویس زنده خطا بدهد |
| **mlbb.io و Fandom** (از طریق اسکریپر) | تیرلیست، بحث‌های داغ، یادداشت‌های پچ، رویدادها |

### ترجمه‌های فارسی

همهٔ توضیحات مهارت‌ها (۵۹۰ توضیح، ۵۷۵ کلید یکتا)، آیتم‌ها (۸۴)، تلنت‌ها (۲۶) و اسپل‌ها (۱۲) به فارسی ترجمه شده‌اند و در `data/fa-overrides.json` نگه داشته می‌شوند. ترجمهٔ داستان‌ها، پچ‌ها، اخبار، رویدادها و کانترها در `data/fa-content.json` است. مینی‌اپ و ربات هر دو از همین فایل‌ها استفاده می‌کنند؛ اگر ترجمه‌ای برای موردی نباشد، متن انگلیسی نشان داده می‌شود. ترجمه‌ها هرگز داخل فایل‌های دادهٔ اصلی نوشته نمی‌شوند — اسکریپرها آن فایل‌ها را بازسازی می‌کنند.

> ⚠️ این پروژهٔ غیررسمی و کامیونیتی است و وابسته به Moonton نیست. داده‌های بازی © Moonton. ‏Rone Arena هم پروژهٔ رسمی نیست؛ اگر روزی قطع شد، بخش‌های استاتیک و محاسبهٔ محلی وین‌ریت هنوز کار می‌کنند.

### لایسنس

MIT — فایل [LICENSE](LICENSE) را ببینید.

---

<a id="en"></a>

## 🇬🇧 English

A Telegram bot for **Mobile Legends: Bang Bang** with a fully Persian Mini App — heroes, meta, counters, builds, items, emblems/talents, MPL standings, a win-rate calculator and a smart AI coach — with live data and Persian descriptions.

- 🤖 Telegram bot: **[@Mlbb_Baz_bot](https://t.me/Mlbb_Baz_bot)** (display name: Persian Mlbb)
- 📱 Live Mini App: **https://yahootattoo1-commits.github.io/mobile-legends/**

> 🇮🇷 نسخهٔ فارسی بالاتر است — [jump to Persian](#fa).

### Features

- **133 heroes** with full Persian skill descriptions, live 7-day win/pick/ban rates and each hero's lore
- **Recommended 6-item builds** for 131 of 133 heroes (Diggie and Joy fall back to Rone's 3-item builds), including spell, emblem and talents
- **Hero counters and team counters** — best and worst counters per hero, plus counter suggestions for a 2–5 hero team
- **Live tier list** with its own dedicated tab, **weekly meta**, **news and patch notes**, **hot discussions** and **events**
- **AI Coach** — answers in Persian, warm and human-like, grounded only in real game data; 3 answers per day per user (unlimited for the admin)
- **Win-rate calculator** — how many consecutive wins you need to reach a target win rate
- **MPL standings** for the ID, PH, MY and KH leagues, and a **player profile** lookup (verified with an in-game code)
- **Admin panel** — bot status, users, per-user coach limits, data refresh and broadcast messages
- Everything works with **buttons**; the coach is the only place where you type a plain-text question

### Bot commands

| Command | What it does |
|---|---|
| `/start` | Welcome + button to open the Mini App |
| `/hero <name>` | Hero info, skills (in Persian) and live win rate |
| `/heroes` | Browse the hero list |
| `/meta` | Top 10 meta heroes (last 7 days) |
| `/counter <name>` | Best and worst counters for a hero (+ team mode) |
| `/build <name> <lane>` | Recommended 6-item build (`exp`, `mid`, `gold`, `roam`, `jungle`) |
| `/items` | Item categories |
| `/item <name>` | Item details |
| `/emblems` | Emblems and talents |
| `/wr <matches> <current wr> <target>` | How many consecutive wins you need |
| `/mpl <id\|ph\|my\|kh>` | MPL league standings |
| `/player` | Player profile (verified with an in-game code) |
| `/news` | News and hot discussions |
| `/tier` | Hero tier list |
| `/patch` | Patch notes |
| `/comps` | Suggested team compositions |
| `/lore` | Hero stories |
| `/version` | Current game version |
| `/admin` | Admin panel (admin only) |
| `/help` | Bot help |
| `/ask <question>` | Ask the AI coach |

> `/cancel` also exists — cancels a broadcast draft (admin only).

### Mini App tabs

The Mini App is right-to-left, uses the Vazirmatn font and a gold/cyan glass design. It has 12 tabs: **Heroes** (with a detail page per hero: skills, build, counters and good teammates), **Meta**, **🏆 Tier List** (its own tab, right after Meta), **Items**, **Emblems**, **Win-Rate Calculator**, **MPL**, **Player**, **News**, **Team Comps**, **Lore** and **🧠 Coach**. At the top, the "Hottest in Meta" card auto-rotates the top 5 heroes of the last 7 days.

### Architecture

- **Telegram bot — Cloudflare Workers (webhook mode, free tier):** the bot logic is written with Telegraf and runs on Workers — no server, no sleeping, no credit card. It uses two KV namespaces: `USERS` (users, coach limits, admin settings) and `DATA` (refreshed JSON data). The coach runs on Workers AI (`@cf/meta/llama-3.1-8b-instruct-fp8`).
- **Mini App — GitHub Pages (free):** static files served from the root of this repo; no build step. Data is read from the Worker first, falling back to the `data/` files in this repo when the Worker is unreachable.
- **Automatic data refresh — every 30 minutes:** an autonomous script (`scripts/refresh_auto.py`, driven by a systemd timer) scrapes news, the tier list, discussions and events; patches and heavy stats only when needed. New items are translated to Persian in the same run via the Worker's `/translate` endpoint, and only changed files are written to the Worker's KV. It stays silent when there is nothing new, and alerts the admin on Telegram after 3 consecutive failures. Refreshing data needs no manual approval and no agent work.
- **Caching:** live API responses are cached in memory for 5 minutes.

### Local run and deployment

**Prerequisites:** a Cloudflare account (email only, no credit card), Node.js 18+, `wrangler`.

```bash
git clone https://github.com/tattoozeus62-ship-it/mobile-legends.git
cd mobile-legends/bot/worker
npm install
```

**1. Create the KV namespaces** and put their IDs in `bot/worker/wrangler.toml`:

```bash
npx wrangler kv:namespace create USERS
npx wrangler kv:namespace create DATA
```

**2. Secrets** (never write them in a file or in chat — use `wrangler secret put` only):

```bash
npx wrangler secret put BOT_TOKEN      # real bot token from @BotFather
npx wrangler secret put ADMIN_ID       # admin's numeric Telegram ID
npx wrangler secret put WEBHOOK_SECRET # random string, e.g.: openssl rand -hex 32
```

**3. Deploy the Worker:**

```bash
npx wrangler deploy
```

**4. Set the webhook** (with the same `WEBHOOK_SECRET`) and the "Open App" menu button pointing at the Mini App URL, then check health:

```text
https://<worker>.workers.dev/health   →   {"status":"ok","mode":"webhook","heroes":133,...}
```

**Mini App:** GitHub Pages serves the `main` branch of this repo; pushing the root files (`index.html`, `app.js`, `style.css`, `data/`) is enough. Local Worker development: `npx wrangler dev`.

### Repository structure

```text
/                    Mini App (GitHub Pages) — index.html, app.js, style.css, data/
/data                Static data and translations (JSON)
bot/                 Bot source (Node.js — Telegraf; shared logic in bot/src)
bot/data/            Bot's offline data (JSON)
bot/src/             bot.js, coach.js, fa.js, rone.js, staticData.js, webappAuth.js
bot/worker/          Cloudflare Worker — wrangler.toml, src/, DEPLOY.md
bot/.env.example     Environment variables (BOT_TOKEN, ADMIN_ID, MINIAPP_URL, RONE_BASE)
```

> The automatic refresh script (`scripts/refresh_auto.py` and its systemd timer) runs on the operator's machine and is not part of the public repo.

### Data sources

| Source | Used for |
|---|---|
| **Rone Arena API** — `https://arena.rone.dev/api` (API v1.6.2, game v2.1.18) | Live data: heroes, win/pick/ban rates, counters, builds, spells, MPL, win-rate calculator |
| **Offline data** (rooted in p3hndrx/MLBB-API) — `data/` files | Hero/item/emblem/talent metadata + Persian translations; fallback when the live service fails |
| **mlbb.io and Fandom** (via scrapers) | Tier list, hot discussions, patch notes, events |

### Persian translations

All hero skill descriptions (590 descriptions, 575 unique keys), items (84), talents (26) and spells (12) are translated to Persian and kept in `data/fa-overrides.json`. Translations of lore, patches, news, events and counters live in `data/fa-content.json`. Both the Mini App and the bot read from these files; when a translation is missing, the English text is shown. Translations are never written into the source data files — the scrapers regenerate them.

> ⚠️ This is an unofficial community project and is not affiliated with Moonton. Game data © Moonton. Rone Arena is not an official project either; if it ever goes down, the static sections and the local win-rate calculator keep working.

### License

MIT — see [LICENSE](LICENSE).
