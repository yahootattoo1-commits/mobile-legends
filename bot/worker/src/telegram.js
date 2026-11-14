// کلاینت تلگرام برای Cloudflare Workers — مستقل از Telegraf، با fetch سراسری.
// چرا مستقل: ایمپورتِ کلاس Telegram از داخل telegraf در باندل esbuild خراب
// می‌شد (زمان‌اجرا: «import_error.default is not a constructor» در callApi،
// و همهٔ پیام‌های ربات بی‌صدا می‌مردند)؛ پس این کلاس هیچ ایمپورتی از telegraf
// ندارد و فقط همان متدهایی را پیاده کرده که ربات استفاده می‌کند:
// sendMessage، sendPhoto، answerCbQuery، getMe، setChatMenuButton.
// فقط JSON فرستاده می‌شود (عکس‌ها با URL)؛ آپلود فایل پشتیبانی نمی‌شود.

const TELEGRAM_API = 'https://api.telegram.org';

// هم‌شکلِ TelegramError خودِ telegraf، تا کدهایی که .code یا .response
// می‌خوانند همان رفتار را ببینند.
class TelegramError extends Error {
  constructor(response, on = {}) {
    super(`${response.error_code}: ${response.description}`);
    this.response = response;
    this.on = on;
  }
  get code() { return this.response.error_code; }
  get description() { return this.response.description; }
  get parameters() { return this.response.parameters; }
}

function hasFileSource(v, seen = new Set()) {
  if (!v || typeof v !== 'object' || seen.has(v)) return false;
  seen.add(v);
  if (Object.prototype.hasOwnProperty.call(v, 'source') && v.source != null) return true;
  return Object.values(v).some((x) => hasFileSource(x, seen));
}

class WorkerTelegram {
  constructor(token) {
    this.token = token;
    this.webhookReply = false;
    this.options = {};
  }

  getMe() {
    return this.callApi('getMe', {});
  }

  sendMessage(chatId, text, extra = {}) {
    return this.callApi('sendMessage', { chat_id: chatId, text, ...extra });
  }

  sendPhoto(chatId, photo, extra = {}) {
    return this.callApi('sendPhoto', { chat_id: chatId, photo, ...extra });
  }

  // نام متد در Telegraf همین است (Context آن را answerCbQuery صدا می‌زند)؛
  // answerCallbackQuery همان کار را می‌کند، برای سازگاریِ کامل.
  answerCbQuery(callbackQueryId, text = '', extra = {}) {
    return this.callApi('answerCallbackQuery', { callback_query_id: callbackQueryId, text, ...extra });
  }

  answerCallbackQuery(callbackQueryId, text = '', extra = {}) {
    return this.answerCbQuery(callbackQueryId, text, extra);
  }

  setChatMenuButton(menuButton) {
    return this.callApi('setChatMenuButton', { menu_button: menuButton });
  }

  async callApi(method, payload = {}, { signal } = {}) {
    if (hasFileSource(payload)) {
      throw new TelegramError(
        { error_code: 400, description: 'WorkerTelegram: file upload is not supported, URL only' },
        { method, payload },
      );
    }
    const res = await fetch(`${TELEGRAM_API}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // nullها مثل کلاینت اصلی حذف می‌شوند
      body: JSON.stringify(payload ?? {}, (_k, v) => (v == null ? undefined : v)),
      signal,
    });
    if (res.status >= 500) {
      throw new TelegramError(
        { error_code: res.status, description: res.statusText || 'Telegram API error' },
        { method, payload },
      );
    }
    const data = await res.json().catch(() => null);
    if (!data || !data.ok) {
      throw new TelegramError(
        {
          error_code: (data && data.error_code) || res.status,
          description: (data && data.description) || `Telegram API error (${method})`,
          parameters: data && data.parameters,
        },
        { method, payload },
      );
    }
    return data.result;
  }
}

export { WorkerTelegram, TelegramError };
