import { formatMinutes } from "./time";
import type { BusyBlock, Day, Minutes, ParseResult, ParsedMeetingLine } from "./types";

/**
 * ============================================================================
 *  CLASS-TIME TEXT PARSER
 * ============================================================================
 * Turns text a manager pastes in — "MWF 9:00-9:50", "Tuesday/Thursday 8:00 AM -
 * 9:15 AM", or a row copied from Workday — into structured `BusyBlock`s the
 * rest of the app can compare against shift times. This is plain string
 * parsing, not AI: the same text always parses the same way, and anything it
 * can't confidently read is reported back as an error or warning rather than
 * guessed. Read `parseClassText` first — it's the entry point everything else
 * in this file supports.
 */

const MAX_LINES = 200;
const MAX_LINE_LENGTH = 300;

const LETTER_DAY: Record<string, Day> = { M: "mon", T: "tue", W: "wed", R: "thu", F: "fri", S: "sat" };

const FULL_DAY_NAMES: [RegExp, Day][] = [
  [/^mon(day)?$/i, "mon"],
  [/^tue(s(day)?)?$/i, "tue"],
  [/^wed(nesday)?$/i, "wed"],
  [/^thu(r(s(day)?)?)?$/i, "thu"],
  [/^fri(day)?$/i, "fri"],
  [/^sat(urday)?$/i, "sat"],
];
/** Sunday, written out or as "Su". The office is never open on Sunday, so it is reported instead of read. */
const SUNDAY_NAME = /^(sun(day)?|su)$/i;

/**
 * Compact day codes: "MWF", "TTh", "TR", "Th", "MW", "MWFS". "Th"/"Tu"/"Sa" are read before
 * single letters, a lone "T" is Tuesday (Thursday is "Th" or "R") and a lone "S" is Saturday. A code that
 * repeats a day ("TT") is ambiguous, so it is rejected rather than guessed.
 */
function parseCompactDays(token: string): Day[] | null {
  const s = token.toUpperCase();
  const out: Day[] = [];
  let i = 0;
  while (i < s.length) {
    if (s.startsWith("TH", i)) {
      out.push("thu");
      i += 2;
    } else if (s.startsWith("TU", i)) {
      out.push("tue");
      i += 2;
    } else if (s.startsWith("SA", i)) {
      out.push("sat");
      i += 2;
    } else if (s[i] in LETTER_DAY) {
      out.push(LETTER_DAY[s[i]]);
      i += 1;
    } else {
      return null;
    }
  }
  if (!out.length || new Set(out).size !== out.length) return null;
  return out;
}

/** Reads one word of a day list: a full day name ("Tuesday") first, otherwise letters like "MWF". */
function parseDayToken(token: string): Day[] | null {
  for (const [re, day] of FULL_DAY_NAMES) if (re.test(token)) return [day];
  return parseCompactDays(token);
}

const DAY_SEPARATORS = /[\s,&/]+/;

/** Parses "MWF", "TTh", "Tuesday/Thursday", "Mon, Wed, Fri", "M/W/F", "T Th". */
export function parseDays(input: string): Day[] | null {
  const tokens = input.split(DAY_SEPARATORS).filter(Boolean);
  if (!tokens.length) return null;
  const days: Day[] = [];
  for (const token of tokens) {
    const parsed = parseDayToken(token);
    if (!parsed) return null;
    for (const d of parsed) if (!days.includes(d)) days.push(d);
  }
  return days;
}

/** True if the text names Sunday, so the parser can explain why that part was skipped. */
export function mentionsSunday(input: string): boolean {
  return input.split(DAY_SEPARATORS).some((t) => SUNDAY_NAME.test(t));
}

type Meridiem = "am" | "pm";
type TimeParts = { hour: number; minute: number; meridiem: Meridiem | null; twentyFour: boolean };

/**
 * Matches one clock time. In words: either the word "noon", OR 1-2 digits for the hour, then
 * optionally ":" and 2 digits for the minutes, then optionally "am"/"pm" (also "a.m.", "p. m.").
 * Capture groups: 1 = "noon", 2 = hour, 3 = minutes, 4 = "a" or "p".
 */
const TIME_RE = /^(?:(noon)|(\d{1,2})(?::(\d{2}))?\s*(?:([ap])\.?\s*m\.?)?)$/i;

/**
 * Splits one clock time into its pieces (hour, minute, am/pm) without deciding yet what a bare
 * "9" means. Hours 13-23 with no am/pm are read as 24-hour time. Returns null for anything that
 * isn't a real time (e.g. "25:00" or "9:75").
 */
function parseTimeParts(str: string): TimeParts | null {
  const m = TIME_RE.exec(str.trim());
  if (!m) return null;
  if (m[1]) return { hour: 12, minute: 0, meridiem: "pm", twentyFour: false };
  const hour = Number(m[2]);
  const minute = Number(m[3] ?? 0);
  if (minute > 59) return null;
  const meridiem = m[4] ? (m[4].toLowerCase() === "a" ? "am" : "pm") : null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    return { hour, minute, meridiem, twentyFour: false };
  }
  if (hour >= 13 && hour <= 23) return { hour, minute, meridiem: null, twentyFour: true };
  if (hour < 1 || hour > 12) return null;
  return { hour, minute, meridiem: null, twentyFour: false };
}

/** Turns the pieces into minutes after midnight, using the given am/pm (12pm = noon, 12am = midnight). */
function toMinutes(p: TimeParts, meridiem: Meridiem | null): Minutes {
  if (p.twentyFour) return p.hour * 60 + p.minute;
  let h = p.hour;
  if (meridiem === "pm" && h < 12) h += 12;
  if (meridiem === "am" && h === 12) h = 0;
  return h * 60 + p.minute;
}

/** School-hours heuristic for a bare hour: 12 and 1-6 are afternoon/noon, 7-11 are morning. */
function guessMeridiem(hour: number): Meridiem {
  return hour === 12 || hour <= 6 ? "pm" : "am";
}

/** A bare hour is only "inferred" when it could genuinely be read two ways. */
function isInferred(p: TimeParts): boolean {
  return p.meridiem === null && !p.twentyFour && p.hour !== 12;
}

export type TimeParse = { minutes: Minutes; explicitMeridiem: boolean };

/**
 * Parses one clock time ("9", "9:00", "9:00am", "1:00 p.m.", "13:30", "noon"). A bare
 * hour gets the school-hours heuristic and reports `explicitMeridiem: false` so the
 * caller can surface a review warning. Prefer `parseTimeRange` for start/end pairs.
 */
export function parseTime(str: string): TimeParse | null {
  const p = parseTimeParts(str);
  if (!p) return null;
  const meridiem = p.meridiem ?? (p.twentyFour ? null : guessMeridiem(p.hour));
  return { minutes: toMinutes(p, meridiem), explicitMeridiem: !isInferred(p) };
}

/** A meeting whose times are all spelled out may run up to 12 hours; a guessed one is held to a normal class length. */
const MAX_EXPLICIT_MINUTES = 12 * 60;
const MAX_GUESSED_MINUTES = 5 * 60;
/** Only readings inside this window count as sensible when am/pm is missing. */
const EARLIEST_SENSIBLE_START = 6 * 60;
const LATEST_SENSIBLE_END = 23 * 60 + 59;

/**
 * Resolves a start/end pair together. When am/pm is missing it tries every reading, keeps
 * only the sensible ones (forward in time, a normal class length, a normal time of day),
 * and picks the school-hours guess among them. It reports `inferred: true` only when more
 * than one sensible reading exists, so a standard "8:00-9:15 PM" or "11:00-12:15 PM" is
 * read quietly, while a truly ambiguous "9:00-9:50" asks the manager to check.
 */
export function parseTimeRange(startStr: string, endStr: string): { start: Minutes; end: Minutes; inferred: boolean } | null {
  const s = parseTimeParts(startStr);
  const e = parseTimeParts(endStr);
  if (!s || !e) return null;

  // Every am/pm reading a time could have: the written one, none (24-hour time), or both if missing.
  const options = (p: TimeParts): (Meridiem | null)[] => (p.meridiem ? [p.meridiem] : p.twentyFour ? [null] : ["am", "pm"]);
  // A "bare" time is like "9:00": no am/pm and not 24-hour, so it could be morning or evening.
  const isBare = (p: TimeParts) => p.meridiem === null && !p.twentyFour;
  const limit = isBare(s) || isBare(e) ? MAX_GUESSED_MINUTES : MAX_EXPLICIT_MINUTES;

  const readings: { start: Minutes; end: Minutes; a: Meridiem | null; b: Meridiem | null }[] = [];
  for (const a of options(s)) {
    for (const b of options(e)) {
      const start = toMinutes(s, a);
      const end = toMinutes(e, b);
      if (end > start && end - start <= limit) readings.push({ start, end, a, b });
    }
  }
  if (!readings.length) return null;

  const sensible = readings.filter((r) => r.start >= EARLIEST_SENSIBLE_START && r.end <= LATEST_SENSIBLE_END);
  const pool = sensible.length ? sensible : readings;
  const wantA = s.meridiem ?? (s.twentyFour ? null : guessMeridiem(s.hour));
  const wantB = e.meridiem ?? (e.twentyFour ? null : guessMeridiem(e.hour));
  const chosen = pool.find((r) => r.a === wantA && r.b === wantB) ?? pool[0];
  return { start: chosen.start, end: chosen.end, inferred: pool.length > 1 };
}

const MERIDIEM = String.raw`[ap]\.?\s*m\.?(?![a-z])`;
const TIME_TOKEN = String.raw`(?:noon|\d{1,2}(?::\d{2})?\s*(?:${MERIDIEM})?)`;
const LINE_RE = new RegExp(String.raw`^([^\d]+?)\s*(${TIME_TOKEN})\s*(?:-|to|until)\s*(${TIME_TOKEN})`, "i");

const NO_MEETING = /\b(online|on-line|asynchronous|async|tba|tbd|arranged|by arrangement|no meeting|does not meet|no set time|independent study)\b/i;
const CLOCK_TIME = /\d{1,2}\s*(?::\d{2}|[ap]\.?\s*m\b)/i;

/** Parses one line of pasted class-time text into a structured result (never throws). */
export function parseMeetingLine(rawLine: string): ParsedMeetingLine {
  const raw = rawLine.trim();
  if (raw.length > MAX_LINE_LENGTH) {
    return { raw: raw.slice(0, 60) + "…", ok: false, warning: "This line is too long to be a class time." };
  }
  const cleaned = raw.replace(/\|/g, " ").replace(/[–—−]/g, "-").replace(/\s+/g, " ").trim();
  const match = LINE_RE.exec(cleaned);
  if (!match) {
    // Registration exports list online and to-be-announced courses with no meeting time. That is
    // not a typo to fix: there is simply nothing to keep the student out of. Only lines with no
    // clock time in them count, so a real "MWF 9:00" line can never be skipped by mistake.
    if (NO_MEETING.test(cleaned) && !CLOCK_TIME.test(cleaned)) {
      return { raw, ok: true, noMeeting: true, warning: "No meeting time listed (online or to be announced), so nothing is blocked for this course." };
    }
    return { raw, ok: false, warning: "Could not find a day + time range on this line." };
  }
  const [, dayToken, startToken, endToken] = match;
  if (mentionsSunday(dayToken)) {
    return { raw, ok: false, warning: "Sunday isn't part of the Monday to Saturday schedule — remove this line." };
  }
  const days = parseDays(dayToken);
  if (!days) {
    return { raw, ok: false, warning: `Could not read the days ("${dayToken.trim()}").` };
  }
  const range = parseTimeRange(startToken, endToken);
  if (!range) {
    return { raw, ok: false, warning: "Could not read a valid start and end time (is the end after the start?)." };
  }
  const warning = range.inferred
    ? `No am/pm given — read as ${formatMinutes(range.start)}–${formatMinutes(range.end)}. Review before saving.`
    : undefined;
  return { raw, ok: true, days, start: range.start, end: range.end, warning };
}

/**
 * Combines a student's class times and their other "can't work" times into one list of busy
 * blocks. Blocked times are tagged `manual` so messages can say "unavailable" rather than
 * "has class".
 */
export function buildBusy(classText: string, blockedText: string): { busy: BusyBlock[]; classes: ParseResult; blocked: ParseResult } {
  const classes = parseClassText(classText);
  const blocked = parseClassText(blockedText);
  return {
    busy: [...classes.busy, ...blocked.busy.map((b) => ({ ...b, source: "manual" as const }))],
    classes,
    blocked,
  };
}

/**
 * Parses multi-line pasted text (short form like "MWF 9:00-9:50" or Workday
 * "Meeting Patterns" rows like "Tuesday/Thursday | 8:00 AM - 9:15 AM | SCB 211")
 * into normalized busy blocks. Never throws; malformed lines are reported, not guessed.
 */
export function parseClassText(text: string): ParseResult {
  const rawLines = text
    .split(/[\n;]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const lines = rawLines.slice(0, MAX_LINES).map(parseMeetingLine);

  const busy: BusyBlock[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  if (rawLines.length > MAX_LINES) errors.push(`Too many lines — only the first ${MAX_LINES} were read.`);

  for (const line of lines) {
    if (line.ok && line.noMeeting) {
      warnings.push(`"${line.raw}" — ${line.warning}`);
      continue;
    }
    if (!line.ok || !line.days || line.start == null || line.end == null) {
      errors.push(`"${line.raw}" — ${line.warning ?? "could not be read"}`);
      continue;
    }
    if (line.warning) warnings.push(`"${line.raw}" — ${line.warning}`);
    for (const day of line.days) {
      if (!busy.some((b) => b.day === day && b.start === line.start && b.end === line.end)) {
        busy.push({ day, start: line.start, end: line.end, source: "class" });
      }
    }
  }

  return { busy, errors, warnings, lines };
}
