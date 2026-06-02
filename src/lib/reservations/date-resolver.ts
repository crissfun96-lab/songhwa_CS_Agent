// Date anchor + normalization for the booking engine.
//
// THE BUG THIS FIXES: dates were queried as EXACT STRINGS against `YYYY-MM-DD`
// Firestore keys, while tool descriptions invited free-form input. So "Saturday
// April 25" was matched against "2026-04-25", found nothing, and reported a
// booked night as open; find_reservation("Saturday") never matched a stored
// "2026-04-25". This module resolves ANY natural-language date the agent (or a
// returning customer on voice/WhatsApp/web) might emit into a canonical
// YYYY-MM-DD in Asia/Kuala_Lumpur BEFORE it touches Firestore.
//
// Pure & deterministic given `now` — every branch is testable. English is
// bulletproof; multilingual relative words (中文 / BM / 한국어) are best-effort.

const KL_TIMEZONE = "Asia/Kuala_Lumpur";

export type ResolvedDate =
  | { ok: true; date: string }
  | { ok: false; reason: "invalid_date" };

// ── KL "today" as a calendar date (YYYY-MM-DD) ────────────────
// `en-CA` natively formats as YYYY-MM-DD, so no part-stitching needed.
export function klToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// ── Pure calendar arithmetic on YYYY-MM-DD (no Date drift) ────
// We parse to UTC noon to dodge DST / timezone edge cases, then format back.
function ymdToUtcNoon(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

function utcDateToYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(ymd: string, days: number): string {
  const base = ymdToUtcNoon(ymd);
  base.setUTCDate(base.getUTCDate() + days);
  return utcDateToYmd(base);
}

// Day-of-week (0 = Sun .. 6 = Sat) for a YYYY-MM-DD, computed in a tz-stable way.
function dayOfWeek(ymd: string): number {
  return ymdToUtcNoon(ymd).getUTCDay();
}

// ── Validate that a YYYY-MM-DD is a REAL calendar date ────────
// Guards against "2026-02-30" / "2026-13-01" — a string regex match isn't enough.
export function isValidIsoDate(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m, d] = ymd.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

// ── Lookup tables ─────────────────────────────────────────────
// Weekday names → 0..6. Full + 3-letter EN, plus ZH (星期/周) and BM.
const WEEKDAYS: Record<string, number> = {
  // English full
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  // English abbrev
  sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6,
  // Chinese (星期日/天, 周日/天 handled via normalization below)
  "星期日": 0, "星期一": 1, "星期二": 2, "星期三": 3, "星期四": 4, "星期五": 5, "星期六": 6,
  "星期天": 0,
  "周日": 0, "周一": 1, "周二": 2, "周三": 3, "周四": 4, "周五": 5, "周六": 6,
  "周天": 0,
  // Bahasa Malaysia
  ahad: 0, isnin: 1, selasa: 2, rabu: 3, khamis: 4, jumaat: 5, sabtu: 6,
};

const MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

// Multilingual relative offsets (days from today). EN handled separately for
// "day after tomorrow" multi-word forms; these are single-token best-effort.
const RELATIVE_WORDS: Record<string, number> = {
  // English (single token)
  today: 0, tonight: 0, tomorrow: 1, tmr: 1, tmrw: 1, overmorrow: 2,
  // Chinese
  "今天": 0, "今晚": 0, "今日": 0, "明天": 1, "明日": 1, "后天": 2, "後天": 2,
  // Bahasa Malaysia
  esok: 1, lusa: 2,
  // Korean
  "오늘": 0, "내일": 1, "모레": 2,
};

// ── Helpers for cleaning input ────────────────────────────────
function normalize(input: string): string {
  // Lowercase, collapse internal whitespace, drop ordinal suffixes (25th → 25),
  // and strip a leading "on " ("on Saturday" → "saturday").
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/(\d+)(st|nd|rd|th)\b/g, "$1")
    .replace(/^on\s+/, "");
}

// Next future occurrence of a given month/day (rolls to next year if already past today).
function nextOccurrenceOfMonthDay(
  month: number,
  day: number,
  today: string,
): ResolvedDate {
  const [ty] = today.split("-").map(Number);
  for (const year of [ty, ty + 1]) {
    const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!isValidIsoDate(candidate)) continue;
    if (candidate >= today) return { ok: true, date: candidate };
  }
  // candidate this year was valid but in the past, next year invalid (e.g. Feb 29
  // with no leap next year) → search a few more years for the real next Feb 29.
  for (let year = ty + 1; year <= ty + 8; year += 1) {
    const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (isValidIsoDate(candidate) && candidate >= today) {
      return { ok: true, date: candidate };
    }
  }
  return { ok: false, reason: "invalid_date" };
}

// Next future occurrence of a bare weekday. "this/coming X" = upcoming (today
// counts if it IS that weekday). "next X" = the following week's occurrence.
function nextWeekday(target: number, today: string, forceNextWeek: boolean): string {
  const todayDow = dayOfWeek(today);
  let delta = (target - todayDow + 7) % 7;
  if (forceNextWeek) {
    // "next Saturday" — if today is the target or it's upcoming this week,
    // push to the following week.
    delta = delta === 0 ? 7 : delta + 7;
  }
  // Bare/this weekday: delta 0 means today IS that weekday → treat as upcoming (today).
  return addDays(today, delta);
}

// ── Main resolver ─────────────────────────────────────────────
export function resolveDate(input: string, now: Date = new Date()): ResolvedDate {
  if (typeof input !== "string" || input.trim() === "") {
    return { ok: false, reason: "invalid_date" };
  }

  const today = klToday(now);
  const raw = input.trim();

  // 1. Already YYYY-MM-DD → validate it's a real calendar date, pass through.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return isValidIsoDate(raw) ? { ok: true, date: raw } : { ok: false, reason: "invalid_date" };
  }

  const s = normalize(input);

  // 2a. Multi-word relative phrases (matched before single-token words so
  //     "day after tomorrow" isn't shadowed by "tomorrow", and BM "hari ini"
  //     — two words for "today" — is handled).
  if (/\bhari ini\b/.test(s)) {
    return { ok: true, date: today };
  }

  // 2. English multi-word relative ("day after tomorrow" / "the day after tomorrow").
  if (/\bday after tomorrow\b/.test(s)) {
    return { ok: true, date: addDays(today, 2) };
  }
  if (/\bday before yesterday\b/.test(s)) {
    // Not a future date — booking engine rejects past, but resolve correctly.
    return { ok: true, date: addDays(today, -2) };
  }
  if (/\byesterday\b/.test(s)) {
    return { ok: true, date: addDays(today, -1) };
  }

  // 3. Single-token relative words (EN + multilingual best-effort).
  //    Match on whole-token boundaries for latin words; CJK/hangul matched by inclusion.
  for (const [word, offset] of Object.entries(RELATIVE_WORDS)) {
    const isLatin = /^[a-z]+$/.test(word);
    const hit = isLatin
      ? new RegExp(`\\b${word}\\b`).test(s)
      : input.includes(word);
    if (hit) return { ok: true, date: addDays(today, offset) };
  }

  // 4. Weekday names (EN full/abbrev, ZH, BM) with optional this/next/coming.
  const weekdayResult = tryWeekday(s, input, today);
  if (weekdayResult) return weekdayResult;

  // 5. Month-name forms: "25 April [2026]" or "April 25 [2026]" / "Apr 25".
  const monthResult = tryMonthName(s, today);
  if (monthResult) return monthResult;

  // 6. Numeric Malaysian day-first "DD/MM[/YYYY]" or "DD-MM[-YYYY]".
  const numericResult = tryNumericDayFirst(s, today);
  if (numericResult) return numericResult;

  // Anything else is unparseable.
  return { ok: false, reason: "invalid_date" };
}

// ── Sub-parsers (exported as small helpers for direct testing) ─

export function tryWeekday(
  normalized: string,
  original: string,
  today: string,
): ResolvedDate | null {
  // English/BM "next|this|coming <weekday>" plus bare weekday.
  const enModifier = /\b(next|this|coming)\b/.test(normalized);
  const forceNextWeek = /\bnext\b/.test(normalized);

  for (const [name, dow] of Object.entries(WEEKDAYS)) {
    const isLatin = /^[a-z]+$/.test(name);
    const hit = isLatin
      ? new RegExp(`\\b${name}\\b`).test(normalized)
      : original.includes(name);
    if (!hit) continue;
    // ZH "下星期六" / "下周六" = next week; "这" / "这个" = this week.
    const zhNext = isLatin ? false : /下[星期周]/.test(original) || original.includes("下个");
    return { ok: true, date: nextWeekday(dow, today, forceNextWeek || zhNext || (enModifier && forceNextWeek)) };
  }
  return null;
}

export function tryMonthName(normalized: string, today: string): ResolvedDate | null {
  // Build an alternation of all month spellings.
  const monthNames = Object.keys(MONTHS).join("|");

  // "25 April [2026]" — DAY FIRST. The `(?!\d)` guards stop the day/year groups
  // from swallowing extra digits.
  const dayFirst = new RegExp(`\\b(\\d{1,2})(?!\\d)\\s+(${monthNames})\\b(?:\\s*,?\\s*(\\d{4})(?!\\d))?`);
  // "April 25 [2026]" / "Apr 25, 2026" — MONTH FIRST.
  const monthFirst = new RegExp(`\\b(${monthNames})\\b\\s+(\\d{1,2})(?!\\d)(?:\\s*,?\\s*(\\d{4})(?!\\d))?`);

  let month: number | undefined;
  let day: number | undefined;
  let year: number | undefined;

  // Check DAY-FIRST before MONTH-FIRST: "25 April 2026" must not be mis-read by a
  // greedy month-first pass that grabs "20" out of the year ("April 20").
  const df = normalized.match(dayFirst);
  const mf = normalized.match(monthFirst);
  if (df) {
    day = Number(df[1]);
    month = MONTHS[df[2]];
    year = df[3] ? Number(df[3]) : undefined;
  } else if (mf) {
    month = MONTHS[mf[1]];
    day = Number(mf[2]);
    year = mf[3] ? Number(mf[3]) : undefined;
  } else {
    return null;
  }

  if (month === undefined || day === undefined) return null;

  if (year !== undefined) {
    const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return isValidIsoDate(candidate)
      ? { ok: true, date: candidate }
      : { ok: false, reason: "invalid_date" };
  }
  return nextOccurrenceOfMonthDay(month, day, today);
}

export function tryNumericDayFirst(normalized: string, today: string): ResolvedDate | null {
  // Malaysian day-first: DD/MM[/YYYY] or DD-MM[-YYYY]. (ISO YYYY-MM-DD is handled
  // earlier, so a 4-digit FIRST group here would be rejected by range checks.)
  const m = normalized.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (!m) return null;

  const day = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { ok: false, reason: "invalid_date" };
  }

  if (m[3]) {
    let year = Number(m[3]);
    if (year < 100) year += 2000; // "26" → 2026
    const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return isValidIsoDate(candidate)
      ? { ok: true, date: candidate }
      : { ok: false, reason: "invalid_date" };
  }
  return nextOccurrenceOfMonthDay(month, day, today);
}
