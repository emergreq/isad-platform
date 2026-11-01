import { createHash } from "node:crypto";
export const SOURCE_URL =
  "https://docs.google.com/spreadsheets/d/1pdaNyN6E758FPuXSMx9RQdSzUL_y1aZ15pzGuAS0up0/edit?gid=61443210";
export const CSV_URL =
  "https://docs.google.com/spreadsheets/d/1pdaNyN6E758FPuXSMx9RQdSzUL_y1aZ15pzGuAS0up0/export?format=csv&gid=61443210";
export function parseCSV(text) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (!quoted && cell !== "")
        throw Error("Некорректная кавычка CSV");
      else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (quoted) throw Error("Незакрытая кавычка CSV");
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
export const SHEETS = [
  { name: "2 курс", gid: "61443210", groups: ["БИВТ-25-6-1", "БИВТ-25-6-2"] },
  { name: "3 курс", gid: "2060620224", groups: ["БИВТ-24-10", "БИВТ-24-9"] },
  { name: "4 курс", gid: "1092942553", groups: ["БИВТ-23-10", "БИВТ-23-9"] },
];
export function parseSchedule(text, sheet = SHEETS[0]) {
  const rows = parseCSV(text.replace(/^\uFEFF/, ""));
  if (
    rows[0]?.[0] !== "Дата" ||
    rows[0]?.[1] !== "Номер" ||
    rows[0]?.[2] !== "Время"
  )
    throw Error("Структура расписания изменилась");
  const groups = [];
  for (let c = 3; c < rows[0].length; c += 4) {
    const name = rows[0][c]?.trim();
    if (!name || rows[1]?.[c] !== "1" || rows[1]?.[c + 2] !== "2")
      throw Error("Неизвестная структура групп и подгрупп");
    groups.push({ name, col: c });
  }
  if (
    groups.length !== sheet.groups.length ||
    groups.some((g, i) => g.name !== sheet.groups[i])
  )
    throw Error("Изменился подтверждённый набор групп");
  const days = [
    "Понедельник",
    "Вторник",
    "Среда",
    "Четверг",
    "Пятница",
    "Суббота",
  ];
  let day = "";
  const entries = [];
  for (let i = 2; i < rows.length; i += 2) {
    const first = rows[i];
    if (first[0]) day = first[0];
    if (
      !days.includes(day) ||
      !/^\d$/.test(first[1]) ||
      !/^\d\d:\d\d:\d\d - \d\d:\d\d:\d\d$/.test(first[2])
    )
      throw Error("Не удалось определить день, пару или время");
    for (const [offset, week] of [
      [0, "upper"],
      [1, "lower"],
    ]) {
      const row = rows[i + offset] || [];
      for (const group of groups)
        for (let sub = 1; sub <= 2; sub++) {
          const col = group.col + (sub - 1) * 2,
            raw = row[col]?.trim();
          if (!raw) continue;
          const [title, ...teacher] = raw.split("\n");
          entries.push({
            sheet: sheet.name,
            key: `${sheet.gid}:${day}:${first[1]}:${week}:${group.name}:${sub}`,
            day,
            lesson: Number(first[1]),
            time: first[2]
              .split(" - ")
              .map((t) => t.slice(0, 5))
              .join(" — "),
            group: group.name,
            subgroup: sub,
            week,
            title,
            teacher: teacher.join(" ").trim(),
            room: row[col + 1]?.trim() || "",
            sourceRow: i + offset + 1,
          });
        }
    }
  }
  if (!entries.length) throw Error("Расписание пустое");
  return {
    entries,
    groups: groups.map((g) => g.name),
    checksum: createHash("sha256").update(text).digest("hex"),
  };
}
async function fetchSheet(sheet) {
  const response = await fetch(
    CSV_URL.replace("gid=61443210", `gid=${sheet.gid}`),
    { signal: AbortSignal.timeout(20000) },
  );
  if (!response.ok) throw Error("Источник расписания недоступен");
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2_000_000) {
      await reader.cancel();
      throw Error("Источник слишком большой");
    }
    chunks.push(value);
  }
  return parseSchedule(Buffer.concat(chunks).toString("utf8"), sheet);
}
export async function fetchSchedule() {
  const results = await Promise.all(SHEETS.map(fetchSheet));
  return {
    entries: results.flatMap((x) => x.entries),
    groups: results.flatMap((x) => x.groups),
    checksum: createHash("sha256")
      .update(results.map((x) => x.checksum).join(":"))
      .digest("hex"),
  };
}
