/**
 * Пересборка `ekaterinburgWeekdaysFromScreenshots.ts` из сырого JSON первого OCR
 * (`tmp_ekb_weekdays_from_imgs.json`).
 *
 * Исходные картинки — страницы станций с
 * https://metro-ektb.ru/rezhim-raboty-metropolitena-grafik_1211/
 *
 * Двустрочная вёрстка: под часом (напр. 7) первая строка — одни минуты, вторая — ещё две
 * колонки минут. OCR даёт одну «ячейку» как «40:45»: это **два** отправления **07:40** и **07:45**
 * (час — последний валидный из строки выше). То же для «43:47» → 07:43 и 07:47.
 * Правило: если левое число > 23, но оба 0…59 — это две минуты того же lastHour.
 *
 * Запуск: npm run rebuild:ekb-weekdays
 */
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.join(import.meta.dirname, "..");
const rawPath = path.join(root, "tmp_ekb_weekdays_from_imgs.json");
const outPath = path.join(root, "src/data/ekaterinburgWeekdaysFromScreenshots.ts");

function opMinute(h: number, mi: number): number {
  let x = h * 60 + mi;
  if (x < 180) x += 1440;
  return x;
}

function formatOpMinute(x: number): string {
  const m = ((x % 1440) + 1440) % 1440;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function displayHourFromOp(x: number): number {
  const m = ((x % 1440) + 1440) % 1440;
  return Math.floor(m / 60);
}

/**
 * Исправление списка времён одного направления (порядок в файле ≈ хронология).
 */
function fixDirectionTimes(raw: readonly string[]): string[] {
  const out: number[] = [];
  let lastOp = -1;
  let lastH = 6;

  for (const t of raw) {
    const parts = t.split(":");
    if (parts.length !== 2) continue;
    const a = parseInt(parts[0], 10);
    const b = parseInt(parts[1], 10);
    if (Number.isNaN(a) || Number.isNaN(b)) continue;

    if (a >= 0 && a <= 23 && b >= 0 && b <= 59) {
      const o = opMinute(a, b);
      if (o > lastOp) {
        out.push(o);
        lastOp = o;
        lastH = a;
      }
      continue;
    }

    // Вторая строка часа: «40:45» → lastHour:40 и lastHour:45 (оба — минуты).
    if (a > 23 && a <= 59 && b >= 0 && b <= 59) {
      const pair = [opMinute(lastH, a), opMinute(lastH, b)].sort((x, y) => x - y);
      for (const o of pair) {
        if (o > lastOp) {
          out.push(o);
          lastOp = o;
          lastH = displayHourFromOp(o);
        }
      }
      continue;
    }

    const candidates: number[] = [];
    if (b >= 0 && b <= 59) candidates.push(opMinute(lastH, b));
    if (a >= 0 && a <= 59 && a !== b) candidates.push(opMinute(lastH, a));

    const good = [...new Set(candidates)].filter((o) => o > lastOp).sort((x, y) => x - y);
    for (const o of good) {
      out.push(o);
      lastOp = o;
      lastH = displayHourFromOp(o);
    }
  }

  return [...new Set(out)].sort((x, y) => x - y).map(formatOpMinute);
}

function main(): void {
  const raw = JSON.parse(fs.readFileSync(rawPath, "utf8")) as Record<
    string,
    Record<string, string[]>
  >;

  const fixed: Record<string, Record<string, string[]>> = {};
  for (const [station, dirs] of Object.entries(raw)) {
    fixed[station] = {};
    for (const [dirKey, arr] of Object.entries(dirs)) {
      fixed[station][dirKey] = fixDirectionTimes(arr);
    }
  }

  const body = `export const ekaterinburgWeekdaysFromScreenshots = ${JSON.stringify(fixed, null, 2)} as const;\n`;
  const header = `/**\n * Будние отправления по станциям.\n * Первоисточник (картинки по станциям): https://metro-ektb.ru/rezhim-raboty-metropolitena-grafik_1211/\n * OCR + двустрочная вёрстка: «40:45» после ряда 7:xx → 07:40 и 07:45 (scripts/rebuild-ekb-weekdays-from-raw-ocr.ts).\n */\n\n`;
  fs.writeFileSync(outPath, header + body, "utf8");
  console.log("Wrote", outPath);
}

main();
