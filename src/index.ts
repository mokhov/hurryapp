import Fastify from "fastify";
import cors from "@fastify/cors";
import dotenv from "dotenv";
import { samaraMetroIntervals } from "./data/samaraMetro.js";
import { samaraMetroGeo } from "./data/samaraMetroGeo.js";
import { ekaterinburgMetro } from "./data/ekaterinburgMetro.js";
import { ekaterinburgMetroGeo } from "./data/ekaterinburgMetroGeo.js";

dotenv.config();

const app = Fastify({
  logger: true,
});

await app.register(cors, {
  origin: true,
});

app.get("/health", async () => {
  return {
    status: "ok",
    service: "hurrytrain",
    ts: new Date().toISOString(),
  };
});

app.get("/", async () => {
  return {
    message: "Hurrytrain API stub is running",
  };
});

app.get("/api/samara-metro", async () => {
  return samaraMetroIntervals;
});

app.get("/next-train", async (_request, reply) => {
  return reply.type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Ближайший поезд</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        margin: 0;
        background: #f6f7fb;
        color: #1f2937;
      }
      .container {
        max-width: 860px;
        margin: 0 auto;
        padding: 24px;
      }
      .card {
        background: #fff;
        border-radius: 12px;
        padding: 20px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
      }
      .hidden {
        display: none;
      }
      .btn-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 10px;
        margin-top: 12px;
      }
      button {
        border: 1px solid #d1d5db;
        background: #fff;
        border-radius: 10px;
        padding: 10px 12px;
        cursor: pointer;
        font: inherit;
      }
      button:hover {
        border-color: #2563eb;
      }
      .selected {
        background: #2563eb;
        color: #fff;
        border-color: #2563eb;
      }
      .muted {
        color: #6b7280;
      }
      .result {
        margin-top: 12px;
        padding: 12px;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        background: #fafafa;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="card">
        <h1>Ближайший поезд</h1>

        <div id="step-1">
          <h3>1. Выберите город</h3>
          <div class="btn-grid">
            <button data-city="ekaterinburg">Екатеринбург</button>
            <button data-city="samara">Самара</button>
          </div>
        </div>

        <div id="step-2" class="hidden">
          <h3>2. Станция отправления</h3>
          <div id="from-stations" class="btn-grid"></div>
        </div>

        <div id="step-3" class="hidden">
          <h3>3. Станция назначения</h3>
          <div id="to-stations" class="btn-grid"></div>
        </div>

        <div id="result" class="result hidden"></div>
      </div>
    </div>

    <script>
      const metros = {
        samara: ${JSON.stringify(samaraMetroIntervals)},
        ekaterinburg: ${JSON.stringify(ekaterinburgMetro)},
      };

      let city = null;
      let fromStation = null;
      let toStation = null;

      const step2 = document.getElementById("step-2");
      const step3 = document.getElementById("step-3");
      const fromStations = document.getElementById("from-stations");
      const toStations = document.getElementById("to-stations");
      const resultEl = document.getElementById("result");

      function parseClockToMinutes(value) {
        if (!value) return null;
        const [h, m] = value.split(":").map(Number);
        if (Number.isNaN(h) || Number.isNaN(m)) return null;
        return h * 60 + m;
      }

      function parseIntervalMinutes(value) {
        if (value.includes("-")) {
          const [a, b] = value.split("-").map(Number);
          return (a + b) / 2;
        }
        return Number(value);
      }

      function getDayType(now) {
        const day = now.getDay();
        return day === 0 || day === 6 ? "weekendsAndHolidays" : "weekdays";
      }

      function intervalForMinute(data, dayType, minuteOfDay) {
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

      function getNowOperationalMinutes(now) {
        const minute = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
        return minute < 180 ? minute + 1440 : minute;
      }

      function normalizeDepartureMinute(minute, firstMinuteHint) {
        if (firstMinuteHint === null) return minute;
        return minute < firstMinuteHint ? minute + 1440 : minute;
      }

      function computeNextTrainFromDetailed(data, station, directionKey, now) {
        const detailed = data.detailedDepartures;
        if (!detailed) return null;
        const stationData = detailed[station];
        if (!stationData || !stationData[directionKey]) return null;

        const dayType = getDayType(now);
        const departures = stationData[directionKey][dayType];
        if (!Array.isArray(departures) || departures.length === 0) return null;

        const parsed = departures.map(parseClockToMinutes).filter((v) => v !== null);
        if (parsed.length === 0) return null;

        const first = Math.min(...parsed);
        const nowOp = getNowOperationalMinutes(now);
        const operational = parsed
          .map((minute) => normalizeDepartureMinute(minute, first))
          .sort((a, b) => a - b);

        for (const dep of operational) {
          if (dep >= nowOp) {
            return { waitMinutes: dep - nowOp, nextAt: dep, mode: "расписание" };
          }
        }
        return { ended: true, mode: "расписание" };
      }

      function computeNextTrainByIntervals(data, station, directionKey, now) {
        const stationSchedule = data.firstLastDepartures?.[station];
        if (!stationSchedule || !stationSchedule[directionKey]) return null;
        const directionSchedule = stationSchedule[directionKey];

        const dayType = getDayType(now);
        const first = parseClockToMinutes(
          dayType === "weekdays" ? directionSchedule.weekdayFirst : directionSchedule.weekendFirst
        );
        const lastRaw = parseClockToMinutes(
          dayType === "weekdays" ? directionSchedule.weekdayLast : directionSchedule.weekendLast
        );
        if (first === null || lastRaw === null) return null;

        const last = lastRaw < first ? lastRaw + 1440 : lastRaw;
        const nowOp = getNowOperationalMinutes(now);
        if (nowOp > last) return { ended: true, mode: "интервалы" };
        if (nowOp <= first) return { waitMinutes: first - nowOp, nextAt: first, mode: "интервалы" };

        let t = first;
        while (t <= last + 0.01) {
          if (t >= nowOp) return { waitMinutes: t - nowOp, nextAt: t, mode: "интервалы" };
          const step = intervalForMinute(data, dayType, t);
          if (!step || step <= 0) break;
          t += step;
        }
        return { ended: true, mode: "интервалы" };
      }

      function computeNextTrain(data, station, directionKey, now) {
        return (
          computeNextTrainFromDetailed(data, station, directionKey, now) ||
          computeNextTrainByIntervals(data, station, directionKey, now)
        );
      }

      function formatWait(waitMinutes) {
        const totalSeconds = Math.max(0, Math.round(waitMinutes * 60));
        return Math.floor(totalSeconds / 60) + " мин " + String(totalSeconds % 60).padStart(2, "0") + " сек";
      }

      function minuteToClock(minute) {
        const normalized = Math.floor(minute) % 1440;
        const h = Math.floor(normalized / 60);
        const m = normalized % 60;
        return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
      }

      function stationGenitive(station) {
        const map = {
          "Проспект Космонавтов": "Проспекта Космонавтов",
          "Площадь 1905 года": "Площади 1905 года",
          "Проспект Космонавтов ": "Проспекта Космонавтов",
          "Площадь 1905 года ": "Площади 1905 года",
          "Юнгородок": "Юнгородка",
          "Кировская": "Кировской",
          "Безымянка": "Безымянки",
          "Победа": "Победы",
          "Советская": "Советской",
          "Спортивная": "Спортивной",
          "Гагаринская": "Гагаринской",
          "Московская": "Московской",
          "Российская": "Российской",
          "Алабинская": "Алабинской",
          "Уралмаш": "Уралмаша",
          "Машиностроителей": "Машиностроителей",
          "Уральская": "Уральской",
          "Динамо": "Динамо",
          "Геологическая": "Геологической",
          "Чкаловская": "Чкаловской",
          "Ботаническая": "Ботанической",
        };
        return map[station] ?? station;
      }

      function renderStations(container, stations, onClick) {
        container.innerHTML = "";
        stations.forEach((station) => {
          const btn = document.createElement("button");
          btn.textContent = station;
          btn.setAttribute("data-station", station);
          btn.addEventListener("click", () => onClick(station, btn));
          container.appendChild(btn);
        });
      }

      function renderResult() {
        const data = metros[city];
        const fromIdx = data.stations.indexOf(fromStation);
        const toIdx = data.stations.indexOf(toStation);
        if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) {
          resultEl.classList.remove("hidden");
          resultEl.textContent = "Выберите разные станции.";
          return;
        }

        const directionKey = toIdx < fromIdx ? "toYungorodok" : "toAlabinskaya";
        const now = new Date();
        const next = computeNextTrain(data, fromStation, directionKey, now);

        resultEl.classList.remove("hidden");
        if (!next) {
          resultEl.textContent = "Для выбранного направления нет данных.";
          return;
        }
        if (next.ended) {
          resultEl.textContent = "Движение по этому направлению завершено на сегодня.";
          return;
        }
        resultEl.textContent =
          "Ближайший поезд от " +
          stationGenitive(fromStation) +
          " до " +
          stationGenitive(toStation) +
          " через " +
          formatWait(next.waitMinutes) +
          " (" +
          minuteToClock(next.nextAt) +
          ")";
      }

      document.querySelectorAll("[data-city]").forEach((btn) => {
        btn.addEventListener("click", () => {
          document.querySelectorAll("[data-city]").forEach((b) => b.classList.remove("selected"));
          btn.classList.add("selected");
          city = btn.getAttribute("data-city");
          fromStation = null;
          toStation = null;
          resultEl.classList.add("hidden");
          step2.classList.remove("hidden");
          step3.classList.add("hidden");
          renderStations(fromStations, metros[city].stations, (station, stationBtn) => {
            fromStations.querySelectorAll("button").forEach((b) => b.classList.remove("selected"));
            stationBtn.classList.add("selected");
            fromStation = station;
            toStation = null;
            resultEl.classList.add("hidden");
            step3.classList.remove("hidden");
            renderStations(
              toStations,
              metros[city].stations.filter((s) => s !== fromStation),
              (target, targetBtn) => {
                toStations.querySelectorAll("button").forEach((b) => b.classList.remove("selected"));
                targetBtn.classList.add("selected");
                toStation = target;
                renderResult();
              }
            );
          });
        });
      });

      setInterval(() => {
        if (city && fromStation && toStation) {
          renderResult();
        }
      }, 1000);
    </script>
  </body>
</html>`);
});

app.get("/metro", async (_request, reply) => {
  return reply.type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Самарское метро - время до станций</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        margin: 0;
        background: #f6f7fb;
        color: #1f2937;
      }
      .container {
        max-width: 900px;
        margin: 0 auto;
        padding: 24px;
      }
      .card {
        background: #fff;
        border-radius: 12px;
        padding: 20px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
      }
      h1 {
        margin-top: 0;
      }
      select {
        margin: 4px 0 10px;
        padding: 6px 8px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        text-align: left;
        padding: 10px 8px;
        border-bottom: 1px solid #e5e7eb;
      }
      .muted {
        color: #6b7280;
        font-size: 14px;
      }
      .eta-cell {
        color: #6b7280;
      }
      .next-trains {
        margin: 10px 0 16px;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        background: #fafafa;
        display: grid;
        grid-template-columns: 1fr 1fr;
      }
      .next-trains div {
        margin: 0;
        padding: 10px 12px;
      }
      .next-trains div + div {
        border-left: 1px solid #e5e7eb;
      }
      .next-title {
        display: block;
        color: #111827;
        font-weight: 600;
        margin-bottom: 4px;
      }
      .footer-meta {
        margin-top: 14px;
      }
      .footer-city {
        margin-bottom: 8px;
      }
      .station-btn {
        border: none;
        background: none;
        padding: 0;
        color: #2563eb;
        cursor: pointer;
        font: inherit;
      }
      .station-btn:hover {
        text-decoration: underline;
      }
      .station-btn.active {
        color: #111827;
        font-weight: 600;
        cursor: default;
        text-decoration: none;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="card">
        <h1 id="page-title">Метро: время проезда</h1>
        <p class="muted" id="geo-status" style="display: none;"></p>
        <div class="next-trains">
          <div id="next-to-yungorodok" class="muted"><span class="next-title">Юнгородок</span>Считаем...</div>
          <div id="next-to-alabinskaya" class="muted"><span class="next-title">Алабинская</span>Считаем...</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Станция назначения</th>
              <th>Время в пути</th>
              <th>Примерное время прибытия</th>
            </tr>
          </thead>
          <tbody id="times"></tbody>
        </table>
        <div class="footer-meta">
          <div class="footer-city">
            <label class="muted" for="city-select">Город:</label><br />
            <select id="city-select">
              <option value="samara">Самара</option>
              <option value="ekaterinburg">Екатеринбург</option>
            </select>
          </div>
          <p class="muted">Текущее время: <strong id="current-time">--:--:--</strong></p>
          <p class="muted" id="source-text">Источник данных: metrosamara.ru</p>
        </div>
      </div>
    </div>
    <script>
      const metros = {
        samara: {
          title: "Самара",
          sourceHost: "metrosamara.ru",
          data: ${JSON.stringify(samaraMetroIntervals)},
          geo: ${JSON.stringify(samaraMetroGeo)},
        },
        ekaterinburg: {
          title: "Екатеринбург",
          sourceHost: "metro-ektb.ru",
          data: ${JSON.stringify(ekaterinburgMetro)},
          geo: ${JSON.stringify(ekaterinburgMetroGeo)},
        },
      };
      const timesBody = document.getElementById("times");
      const citySelect = document.getElementById("city-select");
      const pageTitle = document.getElementById("page-title");
      const sourceTextEl = document.getElementById("source-text");
      const geoStatus = document.getElementById("geo-status");
      const currentTimeEl = document.getElementById("current-time");
      const nextToYungorodokEl = document.getElementById("next-to-yungorodok");
      const nextToAlabinskayaEl = document.getElementById("next-to-alabinskaya");
      let currentCity = "samara";
      let currentStation = metros[currentCity].data.stations[0];
      let hasStateFromUrl = false;

      function currentMetro() {
        return metros[currentCity];
      }

      function applyStateFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const city = params.get("city");
        const station = params.get("station");

        if (city && Object.prototype.hasOwnProperty.call(metros, city)) {
          currentCity = city;
          citySelect.value = city;
        }

        const stations = currentMetro().data.stations;
        if (station && stations.includes(station)) {
          currentStation = station;
          hasStateFromUrl = true;
        } else {
          currentStation = stations[0];
        }
      }

      function persistStateToUrl() {
        const url = new URL(window.location.href);
        url.searchParams.set("city", currentCity);
        url.searchParams.set("station", currentStation);
        window.history.replaceState({}, "", url);
      }

      function formatClock(date) {
        return date.toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
      }

      function parseClockToMinutes(value) {
        if (!value) return null;
        const [h, m] = value.split(":").map(Number);
        if (Number.isNaN(h) || Number.isNaN(m)) return null;
        return h * 60 + m;
      }

      function parseIntervalMinutes(value) {
        if (value.includes("-")) {
          const [a, b] = value.split("-").map(Number);
          return (a + b) / 2;
        }
        return Number(value);
      }

      function getDayType(now) {
        const day = now.getDay();
        return day === 0 || day === 6 ? "weekendsAndHolidays" : "weekdays";
      }

      function intervalForMinute(dayType, minuteOfDay) {
        const data = currentMetro().data;
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
        const fallback = ranges[ranges.length - 1];
        return parseIntervalMinutes(fallback.minutes);
      }

      function formatWait(waitMinutes) {
        const totalSeconds = Math.max(0, Math.round(waitMinutes * 60));
        const mm = Math.floor(totalSeconds / 60);
        const ss = totalSeconds % 60;
        return mm + " мин " + String(ss).padStart(2, "0") + " сек";
      }

      function toRad(deg) {
        return (deg * Math.PI) / 180;
      }

      function distanceKm(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
      }

      function getNearestStation(lat, lon) {
        const data = currentMetro().data;
        const geo = currentMetro().geo;
        if (!geo) return null;
        let nearest = null;
        data.stations.forEach((station) => {
          const point = geo[station];
          if (!point) return;
          const km = distanceKm(lat, lon, point.lat, point.lon);
          if (!nearest || km < nearest.km) {
            nearest = { station, km };
          }
        });
        return nearest;
      }

      function addTravelTime(baseDate, travelTime) {
        if (!travelTime) return null;
        const parts = String(travelTime).split(":");
        if (parts.length !== 2) return null;
        const minutes = Number(parts[0]);
        const seconds = Number(parts[1]);
        if (Number.isNaN(minutes) || Number.isNaN(seconds)) return null;
        return new Date(baseDate.getTime() + (minutes * 60 + seconds) * 1000);
      }

      function getNowOperationalMinutes(now) {
        const minute = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
        return minute < 180 ? minute + 1440 : minute;
      }

      function normalizeDepartureMinute(minute, firstMinuteHint) {
        if (firstMinuteHint === null) return minute;
        return minute < firstMinuteHint ? minute + 1440 : minute;
      }

      function computeNextTrainFromDetailed(directionKey, now) {
        const data = currentMetro().data;
        const detailed = data.detailedDepartures;
        if (!detailed) return null;
        const station = detailed[currentStation];
        if (!station) return null;

        const dayType = getDayType(now);
        const direction = station[directionKey];
        if (!direction) return null;
        const departures = direction[dayType];
        if (!Array.isArray(departures) || departures.length === 0) return null;

        const parsed = departures
          .map((value) => parseClockToMinutes(value))
          .filter((value) => value !== null);
        if (parsed.length === 0) return null;

        const first = Math.min(...parsed);
        const nowOp = getNowOperationalMinutes(now);
        const operational = parsed
          .map((minute) => normalizeDepartureMinute(minute, first))
          .sort((a, b) => a - b);

        for (const dep of operational) {
          if (dep >= nowOp) {
            return { waitMinutes: dep - nowOp, nextAt: dep };
          }
        }

        return { ended: true };
      }

      function computeNextTrain(directionKey, now) {
        const data = currentMetro().data;
        const byDetailedSchedule = computeNextTrainFromDetailed(directionKey, now);
        if (byDetailedSchedule) return byDetailedSchedule;

        const stationSchedule = data.firstLastDepartures[currentStation];
        if (!stationSchedule) return null;
        const directionSchedule = stationSchedule[directionKey];
        if (!directionSchedule) return null;

        const dayType = getDayType(now);
        const first = parseClockToMinutes(
          dayType === "weekdays" ? directionSchedule.weekdayFirst : directionSchedule.weekendFirst
        );
        const lastRaw = parseClockToMinutes(
          dayType === "weekdays" ? directionSchedule.weekdayLast : directionSchedule.weekendLast
        );
        if (first === null || lastRaw === null) return null;

        const last = lastRaw < first ? lastRaw + 1440 : lastRaw;
        const nowOp = getNowOperationalMinutes(now);
        if (nowOp > last) return { ended: true };
        if (nowOp <= first) return { waitMinutes: first - nowOp, nextAt: first };

        let t = first;
        while (t <= last + 0.01) {
          if (t >= nowOp) return { waitMinutes: t - nowOp, nextAt: t };
          const step = intervalForMinute(dayType, t);
          if (!step || step <= 0) break;
          t += step;
        }
        return { ended: true };
      }

      function minuteToClock(minute) {
        const normalized = Math.floor(minute) % 1440;
        const h = Math.floor(normalized / 60);
        const m = normalized % 60;
        return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
      }

      function operationalMinutesToClockWithSeconds(totalMinutes) {
        const totalSeconds = Math.round(totalMinutes * 60);
        const secondsInDay = 24 * 60 * 60;
        const normalized = ((totalSeconds % secondsInDay) + secondsInDay) % secondsInDay;
        const h = Math.floor(normalized / 3600);
        const m = Math.floor((normalized % 3600) / 60);
        const s = normalized % 60;
        return (
          String(h).padStart(2, "0") + ":" +
          String(m).padStart(2, "0") + ":" +
          String(s).padStart(2, "0")
        );
      }

      function renderNextTrains() {
        const data = currentMetro().data;
        const labels = data.directionLabels ?? {
          toYungorodok: "До Юнгородка",
          toAlabinskaya: "До Алабинской",
        };
        const normalizeDirectionTitle = (label) =>
          label
            .replace(/^До\\s+/u, "")
            .replace("Проспекта Космонавтов", "Проспект Космонавтов")
            .replace("Юнгородка", "Юнгородок")
            .replace("Алабинской", "Алабинская")
            .replace("Ботанической", "Ботаническая");

        const titleY = normalizeDirectionTitle(labels.toYungorodok);
        const titleA = normalizeDirectionTitle(labels.toAlabinskaya);
        const now = new Date();
        const toY = computeNextTrain("toYungorodok", now);
        const toA = computeNextTrain("toAlabinskaya", now);

        if (!toY) {
          nextToYungorodokEl.innerHTML =
            "Конечная, поезд дальше не идёт, просьба освободить вагоны";
        } else if (toY.ended) {
          nextToYungorodokEl.innerHTML =
            "<span class='next-title'>" + titleY + "</span>движение завершено на сегодня";
        } else {
          nextToYungorodokEl.innerHTML =
            "<span class='next-title'>" +
            titleY +
            "</span>через " +
            formatWait(toY.waitMinutes) +
            " (в " +
            minuteToClock(toY.nextAt) +
            ")";
        }

        if (!toA) {
          nextToAlabinskayaEl.innerHTML =
            "Конечная, поезд дальше не идёт, просьба освободить вагоны";
        } else if (toA.ended) {
          nextToAlabinskayaEl.innerHTML =
            "<span class='next-title'>" + titleA + "</span>движение завершено на сегодня";
        } else {
          nextToAlabinskayaEl.innerHTML =
            "<span class='next-title'>" +
            titleA +
            "</span>через " +
            formatWait(toA.waitMinutes) +
            " (в " +
            minuteToClock(toA.nextAt) +
            ")";
        }
      }

      function updateCurrentTime() {
        currentTimeEl.textContent = formatClock(new Date());
        renderTimes();
        renderNextTrains();
      }

      function renderTimes() {
        const data = currentMetro().data;
        const row = data.travelTimesLine1.find((item) => item.station === currentStation);
        timesBody.innerHTML = "";
        if (!row) return;
        const now = new Date();
        const currentIndex = data.stations.indexOf(currentStation);
        const nextToStart = computeNextTrain("toYungorodok", now);
        const nextToEnd = computeNextTrain("toAlabinskaya", now);

        data.stations.forEach((toStation) => {
          const tr = document.createElement("tr");
          const isCurrent = toStation === currentStation;
          const time = isCurrent ? "вы здесь" : row.to[toStation];
          let eta = "сейчас";

          if (!isCurrent) {
            const targetIndex = data.stations.indexOf(toStation);
            const direction = targetIndex < currentIndex ? "toYungorodok" : "toAlabinskaya";
            const nextTrain = direction === "toYungorodok" ? nextToStart : nextToEnd;
            const travelDate = addTravelTime(now, row.to[toStation]);

            if (!nextTrain || nextTrain.ended || !travelDate || typeof nextTrain.nextAt !== "number") {
              eta = "-";
            } else {
              const [mPart, sPart] = String(row.to[toStation]).split(":");
              const travelMinutes = Number(mPart);
              const travelSeconds = Number(sPart);
              if (Number.isNaN(travelMinutes) || Number.isNaN(travelSeconds)) {
                eta = "-";
              } else {
                const arrivalOpMinutes = nextTrain.nextAt + travelMinutes + travelSeconds / 60;
                eta = operationalMinutesToClockWithSeconds(arrivalOpMinutes);
              }
            }
          }
          const buttonClass = isCurrent ? "station-btn active" : "station-btn";
          tr.innerHTML =
            "<td><button class='" + buttonClass + "' data-station='" + toStation + "'>" +
            toStation +
            "</button></td><td>" +
            (time ?? "-") +
            "</td><td class='eta-cell'>" +
            eta +
            "</td>";
          timesBody.appendChild(tr);
        });
      }

      function detectNearest() {
        if (hasStateFromUrl) return;
        const metro = currentMetro();
        if (!metro.geo) {
          geoStatus.textContent = "Для этого города геоданные станций пока не добавлены.";
          return;
        }
        if (!navigator.geolocation) {
          geoStatus.textContent = "Геолокация не поддерживается в вашем браузере.";
          return;
        }
        geoStatus.textContent = "Определяем ближайшую станцию по геолокации...";
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const nearest = getNearestStation(position.coords.latitude, position.coords.longitude);
            if (!nearest) {
              geoStatus.textContent = "Не удалось подобрать ближайшую станцию.";
              return;
            }
            currentStation = nearest.station;
            geoStatus.textContent =
              "Ближайшая станция: " +
              nearest.station +
              " (примерно " +
              nearest.km.toFixed(2) +
              " км).";
            renderTimes();
            renderNextTrains();
          },
          () => {
            geoStatus.textContent = "Геолокация недоступна, выбрана станция по умолчанию.";
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000,
          }
        );
      }

      timesBody.addEventListener("click", (event) => {
        const data = currentMetro().data;
        const target = event.target;
        if (!target || !target.matches("button[data-station]")) return;

        const nextStation = target.getAttribute("data-station");
        if (!nextStation || nextStation === currentStation) return;

        currentStation = nextStation;
        renderTimes();
        renderNextTrains();
        persistStateToUrl();
      });

      citySelect.addEventListener("change", (event) => {
        currentCity = event.target.value;
        currentStation = currentMetro().data.stations[0];
        pageTitle.textContent = currentMetro().title + ": время проезда";
        sourceTextEl.textContent = "Источник данных: " + currentMetro().sourceHost;
        renderTimes();
        renderNextTrains();
        persistStateToUrl();
        detectNearest();
      });

      applyStateFromUrl();
      pageTitle.textContent = currentMetro().title + ": время проезда";
      sourceTextEl.textContent = "Источник данных: " + currentMetro().sourceHost;
      renderTimes();
      updateCurrentTime();
      persistStateToUrl();
      setInterval(updateCurrentTime, 1000);
      detectNearest();
    </script>
  </body>
</html>`);
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
