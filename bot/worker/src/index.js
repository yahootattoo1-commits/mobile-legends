// ورودی Cloudflare Workers — ربات تلگرام Persian Mlbb در حالت وبهوک (بدون polling).
// هیچ کدی اینجا به process یا fs دست نمی‌زند؛ همه‌چیز از env می‌آید.
// دیتای استاتیک از GitHub Pages خوانده می‌شود و هر ۱۰ دقیقه تازه می‌شود،
// پس پوشِ دیتا به‌تنهایی کافی است و ری‌استارت لازم نیست.
// ایمپورت‌های استاتیک — esbuild فقط همین‌ها را در باندل ردیابی می‌کند؛
// require از طریق createRequire در باندل جا می‌ماند و زمان‌اجرا خطا می‌دهد.
import { createBot } from '../../src/bot.js';
import sd from '../../src/staticData.js';
import { askCoach } from '../../src/coach.js';
import { telegramLib } from './patch-telegram.cjs';

import { WorkerTelegram } from './telegram.js';
import { kvUserStore, kvSessionStore } from './stores.js';

// ⚠️ حیاتی: Telegraf در handleUpdate به‌ازای هر آپدیت یک Telegram تازه می‌سازد
// (new telegram_1.default(...)). با جایگزینی default، آن نمونه‌ها هم
// WorkerTelegram می‌شوند — وگرنه کلاینت stock با node-fetch خطا می‌دهد.
// (فقط bot.telegram را عوض‌کردن کافی نیست، چون Context از نمونهٔ تازه استفاده می‌کند.)
telegramLib.default = WorkerTelegram;

const DEFAULT_STATIC_BASE = 'https://yahootattoo1-commits.github.io/mobile-legends/data';

let bot = null;

async function getBot(env) {
  // دیتا اول تازه می‌شود (ensureRemote خودش TTL ده‌دقیقه‌ای و dedupe دارد)،
  // بعد ربات ساخته می‌شود؛ هندلرها state را با getter می‌خوانند، پس لود بعدی
  // هم بدون ساخت ربات تازه دیده می‌شود.
  await sd.ensureRemote(env.STATIC_BASE_URL || DEFAULT_STATIC_BASE).catch((e) => console.warn('[worker] static refresh failed', e.message));
  if (bot) return bot;
  bot = createBot(
    { BOT_TOKEN: env.BOT_TOKEN, MINIAPP_URL: env.MINIAPP_URL, ADMIN_ID: env.ADMIN_ID, AI: env.AI, USERS: env.USERS },
    {
      isWorker: true,
      userStore: kvUserStore(env),
      sessionStore: kvSessionStore(env),
      recentLogs: async () => ({ note: 'لاگ‌ها در داشبورد Cloudflare دیده می‌شوند؛ در این ربات لاگ فایل نیست.' }),
      welcomePhoto: env.WELCOME_PHOTO_URL ? { kind: 'url', url: env.WELCOME_PHOTO_URL } : null,
      telegramClient: env.BOT_TOKEN ? new WorkerTelegram(env.BOT_TOKEN) : null,
    },
  );
  return bot;
}

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // مربی هوش مصنوعی برای مینی‌اپ — POST {question} -> {answer} (CORS باز)
    if (url.pathname === '/api/ask') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }
      if (request.method === 'POST') {
        let body = null;
        try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400, headers: CORS_HEADERS }); }
        const question = typeof body?.question === 'string' ? body.question.trim() : '';
        if (!question) return Response.json({ error: 'question required' }, { status: 400, headers: CORS_HEADERS });
        await sd.ensureRemote(env.STATIC_BASE_URL || DEFAULT_STATIC_BASE).catch(() => {});
        const answer = await askCoach(env, { kv: env.USERS }, question);
        return Response.json({ answer }, { headers: CORS_HEADERS });
      }
      return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
    }

    if (request.method === 'POST' && url.pathname === '/webhook') {
      const secret = env.WEBHOOK_SECRET;
      if (secret) {
        const got = request.headers.get('x-telegram-bot-api-secret-token');
        if (got !== secret) return new Response('Forbidden', { status: 403 });
      }
      let update;
      try {
        update = await request.json();
      } catch {
        return new Response('Bad Request', { status: 400 });
      }
      try {
        const b = await getBot(env);
        if (!b) return new Response('Bot not configured', { status: 500 });
        await b.handleUpdate(update);
      } catch (e) {
        console.error('[worker] handleUpdate failed', e);
      }
      return new Response('OK', { status: 200 });
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      await sd.ensureRemote(env.STATIC_BASE_URL || DEFAULT_STATIC_BASE).catch(() => {});
      return Response.json({
        status: 'ok',
        mode: 'webhook',
        heroes: sd.heroes.length,
        items: sd.items.length,
        events: sd.events.length,
        data_ready: sd.isRemoteReady(),
        bot: env.BOT_TOKEN ? 'configured' : 'no-token',
      });
    }

    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('ربات Persian Mlbb — وبهوک تلگرام روی Cloudflare Workers.', {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};
