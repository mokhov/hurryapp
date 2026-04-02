import dotenv from "dotenv";
import TelegramBot, { type InlineKeyboardButton, type Message, type CallbackQuery } from "node-telegram-bot-api";
import { ekaterinburgMetro } from "./data/ekaterinburgMetro.js";

dotenv.config();

const token = process.env.NEXT_METRO_EKB_BOT_TOKEN ?? process.env.NEXT_TRAIN_EKB_BOT_TOKEN;
if (!token) {
  throw new Error("NEXT_METRO_EKB_BOT_TOKEN is required");
}

type DirectionKey = "toYungorodok" | "toAlabinskaya";
type Session = { from?: string; lastSelectionKey?: string; lastSelectionAt?: number; lastStartMessageId?: number; lastStartAt?: number; lastMenuAt?: number };
const EKB_TIME_ZONE = "Asia/Yekaterinburg";

const sessions = new Map<number, Session>();
const processedCallbacks = new Map<string, number>();
const bot = new TelegramBot(token, { polling: true });

function getSession(chatId: number): Session {
  const s = sessions.get(chatId) ?? {};
  sessions.set(chatId, s);
  return s;
}

function stationGenitive(station: string): string {
  const map: Record<string, string> = {
    "Проспект Космонавтов": "Проспекта Космонавтов",
    "Площадь 1905 года": "Площади 1905 года",
    Уралмаш: "Уралмаша",
    Машиностроителей: "Машиностроителей",
    Уральская: "Уральской",
    Динамо: "Динамо",
    Геологическая: "Геологической",
    Чкаловская: "Чкаловской",
    Ботаническая: "Ботанической",
  };
  return map[station] ?? station;
}

function parseClockToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const [h, m] = value.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function getDayType(day: number): "weekdays" | "weekendsAndHolidays" {
  return day === 0 || day === 6 ? "weekendsAndHolidays" : "weekdays";
}

function getZonedNowParts(timeZone: string): { day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    day: dayMap[values.weekday] ?? 0,
    hour: Number(values.hour ?? 0),
    minute: Number(values.minute ?? 0),
    second: Number(values.second ?? 0),
  };
}

function getNowOperationalMinutes(now: { hour: number; minute: number; second: number }): number {
  const minute = now.hour * 60 + now.minute + now.second / 60;
  return minute < 180 ? minute + 1440 : minute;
}

function normalizeDepartureMinute(minute: number, firstMinuteHint: number | null): number {
  if (firstMinuteHint === null) return minute;
  return minute < firstMinuteHint ? minute + 1440 : minute;
}

function computeNextTrain(station: string, directionKey: DirectionKey) {
  const detailed = (ekaterinburgMetro as Record<string, unknown>).detailedDepartures as
    | Record<string, Record<DirectionKey, Record<string, string[]>>>
    | undefined;
  if (!detailed) return null;
  const stationData = detailed[station];
  if (!stationData || !stationData[directionKey]) return null;

  const zonedNow = getZonedNowParts(EKB_TIME_ZONE);
  const dayType = getDayType(zonedNow.day);
  const departures = stationData[directionKey][dayType];
  if (!Array.isArray(departures) || departures.length === 0) return null;

  const parsed = departures.map(parseClockToMinutes).filter((v): v is number => v !== null);
  if (!parsed.length) return null;

  const first = Math.min(...parsed);
  const nowOp = getNowOperationalMinutes(zonedNow);
  const operational = parsed.map((m) => normalizeDepartureMinute(m, first)).sort((a, b) => a - b);
  for (const dep of operational) {
    if (dep >= nowOp) return { waitMinutes: dep - nowOp, nextAt: dep };
  }
  return { ended: true as const };
}

function plural(value: number, one: string, two: string, five: string): string {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return two;
  return five;
}

function formatWait(waitMinutes: number): string {
  const totalSeconds = Math.max(0, Math.round(waitMinutes * 60));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} ${plural(seconds, "секунду", "секунды", "секунд")}`;
  return `${minutes} ${plural(minutes, "минуту", "минуты", "минут")} ${seconds} ${plural(seconds, "секунду", "секунды", "секунд")}`;
}

function minuteToClock(minute: number): string {
  const normalized = Math.floor(minute) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function rows<T>(arr: T[], size = 2): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function stationsKeyboard(stations: string[]) {
  const buttons: InlineKeyboardButton[] = stations.map((s) => ({ text: s, callback_data: `station:${s}` }));
  return { inline_keyboard: rows(buttons, 2) };
}

function nextTrainKeyboard() {
  return {
    inline_keyboard: [[{ text: "Другая станция", callback_data: "menu:next-train" }]],
  };
}

bot.onText(/\/start|\/next/, async (msg: Message) => {
  if (!msg.chat) return;
  const s = getSession(msg.chat.id);
  const nowMs = Date.now();
  if (s.lastStartMessageId === msg.message_id && nowMs - (s.lastStartAt ?? 0) < 15000) return;
  s.lastStartMessageId = msg.message_id;
  s.lastStartAt = nowMs;
  s.from = undefined;
  await bot.sendMessage(msg.chat.id, "Откуда едете", {
    reply_markup: stationsKeyboard(ekaterinburgMetro.stations),
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

  if (q.data === "menu:next-train") {
    if (s.lastMenuAt !== undefined && nowMs - s.lastMenuAt < 1500) {
      await bot.answerCallbackQuery(q.id).catch(() => {});
      return;
    }
    s.lastMenuAt = nowMs;
    if (q.message.message_id) {
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: q.message.message_id }).catch(() => {});
    }
    await bot.sendMessage(chatId, "Откуда едете", {
      reply_markup: stationsKeyboard(ekaterinburgMetro.stations),
    });
    await bot.answerCallbackQuery(q.id);
    return;
  }

  const selectedStation = q.data.startsWith("station:") ? q.data.slice(8) : null;
  if (selectedStation) {
    s.from = selectedStation;
    const fromStation = s.from;
    const selectionKey = `station:${fromStation}`;
    if (q.data.startsWith("station:") && s.lastSelectionKey === selectionKey && nowMs - (s.lastSelectionAt ?? 0) < 2000) {
      await bot.answerCallbackQuery(q.id);
      return;
    }
    s.lastSelectionKey = selectionKey;
    s.lastSelectionAt = nowMs;
    if (q.data.startsWith("station:") && q.message.message_id) {
      await bot.deleteMessage(chatId, q.message.message_id).catch(() => {});
    }
    const stations = ekaterinburgMetro.stations;
    const fromIdx = stations.indexOf(fromStation);
    if (fromIdx < 0) {
      await bot.answerCallbackQuery(q.id);
      return;
    }

    const directions: Array<{ key: DirectionKey; terminal: string }> = [];
    if (fromIdx > 0) directions.push({ key: "toYungorodok", terminal: stations[0] });
    if (fromIdx < stations.length - 1) directions.push({ key: "toAlabinskaya", terminal: stations[stations.length - 1] });

    const lines: string[] = [];
    for (const direction of directions) {
      const next = computeNextTrain(fromStation, direction.key);
      if (!next) {
        lines.push(`До ${stationGenitive(direction.terminal)} нет данных.`);
        continue;
      }
      if ("ended" in next && next.ended) {
        lines.push(`До ${stationGenitive(direction.terminal)} движение завершено на сегодня.`);
        continue;
      }
      lines.push(`До ${stationGenitive(direction.terminal)} через ${formatWait(next.waitMinutes)} (в ${minuteToClock(next.nextAt)})`);
    }
    const headerTail = lines.length === 1 ? "ближайший поезд" : "ближайшие поезда";
    const header = `Станция «${fromStation}», ${headerTail}`;
    await bot.sendMessage(chatId, `${header}\n${lines.join("\n")}`, {
      reply_markup: nextTrainKeyboard(),
    });

    await bot.answerCallbackQuery(q.id);
  }
});

bot.onText(/\/reset/, async (msg: Message) => {
  if (!msg.chat) return;
  sessions.set(msg.chat.id, {});
  await bot.sendMessage(msg.chat.id, "Сброшено. Введите /start");
});
