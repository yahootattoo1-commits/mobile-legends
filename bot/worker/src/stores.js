// استورهای KV برای Cloudflare Workers — همان اینترفیسی که src/bot.js می‌خواهد.
//
// userStore: لیست کاربران در یک کلید 'users' (آرایهٔ JSON)؛ فقط وقتی کاربر
// تازه‌ای می‌آید (یا یوزرنیمش عوض می‌شود) نوشته می‌شود.
// sessionStore: سشن‌های /player و پیش‌نویس پیام همگانی، کلید جدا برای هر چت
// با TTL یک ساعته (JWT ورود به بازی هم فقط همین‌قدر زنده می‌ماند).

export function kvUserStore(env) {
  const kv = env.USERS;
  let cache = null;
  return {
    async loadAll() {
      if (cache) return cache;
      cache = new Map();
      try {
        const arr = await kv.get('users', 'json');
        for (const u of (Array.isArray(arr) ? arr : [])) if (u?.id) cache.set(String(u.id), u);
      } catch { /* اولین اجرا — هنوز کاربری نیست */ }
      return cache;
    },
    async persist(map) {
      cache = map;
      try { await kv.put('users', JSON.stringify([...map.values()])); } catch { /* ذخیره نشد */ }
    },
  };
}

export function kvSessionStore(env) {
  const kv = env.USERS;
  const key = (kind, chatId) => `${kind}:${chatId}`;
  return {
    async get(kind, chatId) {
      try { return await kv.get(key(kind, chatId), 'json'); } catch { return null; }
    },
    async set(kind, chatId, value) {
      try { await kv.put(key(kind, chatId), JSON.stringify(value), { expirationTtl: 3600 }); } catch { /* ذخیره نشد */ }
    },
    async delete(kind, chatId) {
      try { await kv.delete(key(kind, chatId)); } catch { /* پاک نشد */ }
    },
  };
}
