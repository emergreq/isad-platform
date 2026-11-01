import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCSV, parseSchedule, SHEETS } from "../server/schedule.js";
const fixture =
  'Дата,Номер,Время,БИВТ-25-6-1,,,,БИВТ-25-6-2,,,\r\n,,,1,,2,,1,,2,\r\nПонедельник,1,09:00:00 - 10:35:00,"Предмет\nПреподаватель",А-1,,,,,,\r\n,,,"Другой предмет\nУточнение времени",А-2,,,,,,\r\n';
test("CSV preserves quoted newlines, commas and escaped quotes", () =>
  assert.deepEqual(parseCSV('a,"b,c","d""e"\r\n1,"line\nline",3'), [
    ["a", "b,c", 'd"e'],
    ["1", "line\nline", "3"],
  ]));
test("schedule retains upper/lower rows without guessing parity or dates", () => {
  const s = parseSchedule(fixture);
  assert.equal(s.entries.length, 2);
  assert.equal(s.entries[0].time, "09:00 — 10:35");
  assert.equal(s.entries[0].week, "upper");
  assert.equal(s.entries[1].week, "lower");
  assert.equal(s.entries[0].sheet, "2 курс");
  assert.equal(s.entries[1].teacher, "Уточнение времени");
  assert.equal(s.entries[0].sourceRow, 3);
});
test("unsupported source shape and truncated quoting fail closed", () => {
  assert.throws(() => parseSchedule("new format"));
  assert.throws(() => parseSchedule(fixture.replace("БИВТ-25-6-1", "OTHER")));
  assert.throws(() => parseCSV('"unfinished'));
  assert.equal(SHEETS.length, 3);
});
