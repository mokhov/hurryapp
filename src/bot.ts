import dotenv from "dotenv";
import TelegramBot, { type InlineKeyboardButton, type Message, type CallbackQuery } from "node-telegram-bot-api";
import { samaraMetroIntervals } from "./data/samaraMetro.js";
import { ekaterinburgMetro } from "./data/ekaterinburgMetro.js";

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is required");
}

type MetroData = typeof samaraMetroIntervals;
type DirectionKey = "toYungorodok" | "toAlabinskaya";
type Session = { city?: "samara" | "ekaterinburg"; from?: string; lastSelectionKey?: string; lastSelectionAt?: number };

const metros: Record<"samara" | "ekaterinburg", MetroData> = {
  samara: samaraMetroIntervals,
  ekaterinburg: ekaterinburgMetro as unknown as MetroData,
};
const cityTimeZones: Record<"samara" | "ekaterinburg", string> = {
  samara: "Europe/Samara",
  ekaterinburg: "Asia/Yekaterinburg",
};

const sessions = new Map<number, Session>();
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
    Юнгородок: "Юнгородка",
    Кировская: "Кировской",
    Безымянка: "Безымянки",
    Победа: "Победы",
    Советская: "Советской",
    Спортивная: "Спортивной",
    Гагаринская: "Гагаринской",
    Московская: "Московской",
    Российская: "Российской",
    Алабинская: "Алабинской",
    Уралмаш: "Уралмаша",
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

function parseIntervalMinutes(value: string): number {
  if (value.includes("-")) {
    const [a, b] = value.split("-").map(Number);
    return (a + b) / 2;
  }
  return Number(value);
}

function getDayType(day: number): "weekdays" | "weekendsAndHolidays" {
  return day === 0 || day === 6 ? "weekendsAndHolidays" : "weekdays";
}

function intervalForMinute(data: MetroData, dayType: "weekdays" | "weekendsAndHolidays", minuteOfDay: number): number {
  const ranges = data.averageIntervals[dayType];
  const normalized = minuteOfDay >= 1440 ? minuteOfDay - 1440 : minuteOfDay;
  for (const range of ranges) {
    const [start, end] = range.timeRange.split("-");
    const startMin = parseClockToMinutes(start);
    const endMin = parseClockToMinutes(end);
    if (startMin === null || endMin === null) continue;
    if (normalized >= startMin && normalized < endMin) {
      return parseIntervalMinutes(range.minutes);
    }
  }
  return parseIntervalMinutes(ranges[ranges.length - 1].minutes);
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

function computeNextTrainFromDetailed(data: MetroData, station: string, directionKey: DirectionKey, timeZone: string) {
  const detailed = (data as Record<string, unknown>).detailedDepartures as
    | Record<string, Record<DirectionKey, Record<string, string[]>>>
    | undefined;
  if (!detailed) return null;
  const stationData = detailed[station];
  if (!stationData || !stationData[directionKey]) return null;
  const zonedNow = getZonedNowParts(timeZone);
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

function computeNextTrainByIntervals(data: MetroData, station: string, directionKey: DirectionKey, timeZone: string) {
  const firstLast = data.firstLastDepartures as Record<
    string,
    Record<DirectionKey, { weekdayFirst: string | null; weekendFirst: string | null; weekdayLast: string | null; weekendLast: string | null }>
  >;
  const stationSchedule = firstLast?.[station]?.[directionKey];
  if (!stationSchedule) return null;

  const zonedNow = getZonedNowParts(timeZone);
  const dayType = getDayType(zonedNow.day);
  const first = parseClockToMinutes(dayType === "weekdays" ? stationSchedule.weekdayFirst : stationSchedule.weekendFirst);
  const lastRaw = parseClockToMinutes(dayType === "weekdays" ? stationSchedule.weekdayLast : stationSchedule.weekendLast);
  if (first === null || lastRaw === null) return null;

  const last = lastRaw < first ? lastRaw + 1440 : lastRaw;
  const nowOp = getNowOperationalMinutes(zonedNow);
  if (nowOp > last) return { ended: true as const };
  if (nowOp <= first) return { waitMinutes: first - nowOp, nextAt: first };

  let t = first;
  while (t <= last + 0.01) {
    if (t >= nowOp) return { waitMinutes: t - nowOp, nextAt: t };
    const step = intervalForMinute(data, dayType, t);
    if (!step || step <= 0) break;
    t += step;
  }
  return { ended: true as const };
}

function computeNextTrain(data: MetroData, station: string, directionKey: DirectionKey, timeZone: string) {
  return computeNextTrainFromDetailed(data, station, directionKey, timeZone) || computeNextTrainByIntervals(data, station, directionKey, timeZone);
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

function cityKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Екатеринбург", callback_data: "city:ekaterinburg" },
        { text: "Самара", callback_data: "city:samara" },
      ],
    ],
  };
}

function stationsKeyboard(stations: string[]) {
  const buttons: InlineKeyboardButton[] = stations.map((s) => ({ text: s, callback_data: `station:${s}` }));
  return { inline_keyboard: rows(buttons, 2) };
}

bot.onText(/\/start|\/next/, async (msg: Message) => {
  if (!msg.chat) return;
  sessions.set(msg.chat.id, {});
  await bot.sendMessage(msg.chat.id, "1/3 Выберите город", { reply_markup: cityKeyboard() });
});

bot.on("callback_query", async (q: CallbackQuery) => {
  if (!q.message?.chat?.id || !q.data) return;
  const chatId = q.message.chat.id;
  const s = getSession(chatId);

  if (q.data.startsWith("city:")) {
    const city = q.data.split(":")[1] as "samara" | "ekaterinburg";
    s.city = city;
    s.from = undefined;
    const data = metros[city];
    await bot.sendMessage(chatId, "Откуда едете", {
      reply_markup: stationsKeyboard(data.stations),
    });
    await bot.answerCallbackQuery(q.id);
    return;
  }

  if (q.data.startsWith("station:")) {
    if (!s.city) return;
    s.from = q.data.slice(8);
    const fromStation = s.from;
    const selectionKey = `${s.city}:station:${fromStation}`;
    const nowMs = Date.now();
    if (s.lastSelectionKey === selectionKey && nowMs - (s.lastSelectionAt ?? 0) < 2000) {
      await bot.answerCallbackQuery(q.id);
      return;
    }
    s.lastSelectionKey = selectionKey;
    s.lastSelectionAt = nowMs;
    if (q.message.message_id) {
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: q.message.message_id }).catch(() => {});
    }
    const data = metros[s.city];
    const fromIdx = data.stations.indexOf(fromStation);
    if (fromIdx < 0) {
      await bot.answerCallbackQuery(q.id);
      return;
    }

    const directions: Array<{ key: DirectionKey; terminal: string }> = [];
    if (fromIdx > 0) directions.push({ key: "toYungorodok", terminal: data.stations[0] });
    if (fromIdx < data.stations.length - 1) directions.push({ key: "toAlabinskaya", terminal: data.stations[data.stations.length - 1] });

    const lines: string[] = [];
    for (const direction of directions) {
      const next = computeNextTrain(data, fromStation, direction.key, cityTimeZones[s.city]);
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
    await bot.sendMessage(chatId, `${header}\n${lines.join("\n")}`);

    await bot.answerCallbackQuery(q.id);
  }
});

bot.onText(/\/reset/, async (msg: Message) => {
  if (!msg.chat) return;
  sessions.set(msg.chat.id, {});
  await bot.sendMessage(msg.chat.id, "Сброшено. Введите /start");
});
