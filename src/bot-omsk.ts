import dotenv from "dotenv";
import TelegramBot, { type InlineKeyboardButton, type Message, type CallbackQuery } from "node-telegram-bot-api";

dotenv.config();

const token = process.env.NEXT_METRO_OMSK_BOT_TOKEN;
if (!token) {
  throw new Error("NEXT_METRO_OMSK_BOT_TOKEN is required");
}

/** Единственная «станция» омского метро (мем). Кнопка — полное имя, callback — короткий slug (лимит 64 байта). */
const OMSK_STATION = "Библиотека имени Пушкина";
const OMSK_STATION_CALLBACK = "station:pushkin";

type Session = { lastSelectionKey?: string; lastSelectionAt?: number; lastStartMessageId?: number; lastStartAt?: number };

const sessions = new Map<number, Session>();
const processedCallbacks = new Map<string, number>();
const bot = new TelegramBot(token, { polling: true });

function getSession(chatId: number): Session {
  const s = sessions.get(chatId) ?? {};
  sessions.set(chatId, s);
  return s;
}

function stationsKeyboard(): TelegramBot.InlineKeyboardMarkup {
  const buttons: InlineKeyboardButton[] = [{ text: OMSK_STATION, callback_data: OMSK_STATION_CALLBACK }];
  return { inline_keyboard: [buttons] };
}

function againKeyboard(): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ text: "Выбрать снова", callback_data: "menu:stations" }]],
  };
}

bot.onText(/\/start|\/next/, async (msg: Message) => {
  if (!msg.chat) return;
  const s = getSession(msg.chat.id);
  const nowMs = Date.now();
  if (s.lastStartMessageId === msg.message_id && nowMs - (s.lastStartAt ?? 0) < 15000) return;
  s.lastStartMessageId = msg.message_id;
  s.lastStartAt = nowMs;
  await bot.sendMessage(msg.chat.id, "Выберите станцию", {
    reply_markup: stationsKeyboard(),
  });
});

bot.on("callback_query", async (q: CallbackQuery) => {
  if (!q.message?.chat?.id || !q.data) return;
  const chatId = q.message.chat.id;
  const s = getSession(chatId);
  const nowMs = Date.now();
  const prev = processedCallbacks.get(q.id);
  if (prev && nowMs - prev < 15000) {
    await bot.answerCallbackQuery(q.id).catch(() => {});
    return;
  }
  processedCallbacks.set(q.id, nowMs);
  for (const [id, ts] of processedCallbacks) {
    if (nowMs - ts > 60000) processedCallbacks.delete(id);
  }

  if (q.data === "menu:stations") {
    if (q.message.message_id) {
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: q.message.message_id }).catch(() => {});
    }
    await bot.sendMessage(chatId, "Выберите станцию", {
      reply_markup: stationsKeyboard(),
    });
    await bot.answerCallbackQuery(q.id);
    return;
  }

  if (q.data === OMSK_STATION_CALLBACK) {
    const selectionKey = OMSK_STATION_CALLBACK;
    if (s.lastSelectionKey === selectionKey && nowMs - (s.lastSelectionAt ?? 0) < 2000) {
      await bot.answerCallbackQuery(q.id);
      return;
    }
    s.lastSelectionKey = selectionKey;
    s.lastSelectionAt = nowMs;
    if (q.message.message_id) {
      await bot.deleteMessage(chatId, q.message.message_id).catch(() => {});
    }
    const text = `Станция «${OMSK_STATION}»\n\nБлижайшие поезда будут через 100 лет. Но это не точно :)`;
    await bot.sendMessage(chatId, text, { reply_markup: againKeyboard() });
    await bot.answerCallbackQuery(q.id);
  }
});

bot.onText(/\/reset/, async (msg: Message) => {
  if (!msg.chat) return;
  sessions.set(msg.chat.id, {});
  await bot.sendMessage(msg.chat.id, "Сброшено. Введите /start");
});
