import { mergeContiguousBlocks } from "../scheduling/blocks";
import type { Day, SemesterConfig, ShiftBlock, Student } from "../scheduling/types";

/**
 * ============================================================================
 *  .ICS CALENDAR FILE BUILDER
 * ============================================================================
 * ".ics" is the standard file format calendar apps (Google, Apple, Outlook)
 * understand — a plain text file with a specific structure, defined by an
 * internet standard called RFC 5545. This file builds one .ics file per
 * student containing their recurring weekly shifts, so they can import it
 * into whatever calendar app they already use. No calendar account, API, or
 * network request is involved — it's just a text file the browser offers as
 * a download (see `src/lib/download.ts`).
 */

export type { SemesterConfig };

/** JavaScript weekday numbers (Sunday = 0). */
const JS_WEEKDAY: Record<Day, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MS_PER_DAY = 86_400_000;

/** A number as at least two digits, e.g. 7 -> "07" (calendar files need fixed-width dates and times). */
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** A date written the calendar-file way, with no dashes, e.g. "20261006". */
function utcDateStamp(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

/**
 * A clock time of 24:00 does not exist in calendar files (hours run 00-23), but a shift that ends
 * at midnight is stored as 1440 minutes. This turns "Monday + 1440 minutes" into "Tuesday + 0 minutes".
 */
export function rollOverMidnight(date: Date, minutes: number): { date: Date; minutes: number } {
  if (minutes < 24 * 60) return { date, minutes };
  return { date: new Date(date.getTime() + MS_PER_DAY), minutes: minutes - 24 * 60 };
}

/** Wall-clock time in the semester's timezone, written without a "Z" so it is NOT read as UTC. */
function localDateTime(rawDate: Date, rawMinutes: number): string {
  const { date, minutes } = rollOverMidnight(rawDate, rawMinutes);
  return `${utcDateStamp(date)}T${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}00`;
}

/**
 * Makes text safe to put inside one line of a .ics file. Backslashes, semicolons and commas have
 * special meaning there, so each gets a backslash in front. Every kind of line break (Windows
 * "\r\n", old-Mac "\r" on its own, Unix "\n") becomes the two characters "\n", and any other hidden
 * control character is removed. Without this, a name containing a line break could start a new line
 * in the file and add calendar instructions nobody asked for.
 */
function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/[\u0000-\u001f\u007f]/g, "");
}

/** RFC 5545 line folding: lines longer than 75 characters continue on a space-prefixed line. */
function fold(line: string): string {
  const chars = Array.from(line);
  if (chars.length <= 73) return line;
  const parts: string[] = [];
  for (let i = 0; i < chars.length; i += 73) parts.push(chars.slice(i, i + 73).join(""));
  return parts.join("\r\n ");
}

/** The "EXDATE" line listing the days off (holidays, breaks) this weekly shift should skip, or nothing. */
function exdate(semester: SemesterConfig, first: Date, count: number, startMinutes: number): string[] {
  const skipped = excludedOccurrences(semester, first, count);
  if (!skipped.length) return [];
  return [`EXDATE;TZID=${semester.timeZone}:${skipped.map((d) => localDateTime(d, startMinutes)).join(",")}`];
}

/** True once the manager has saved a start date, an end date and a timezone. Calendar export needs all three. */
export function isSemesterConfigured(semester: Partial<SemesterConfig> | null | undefined): semester is SemesterConfig {
  return Boolean(semester?.startDate && semester?.endDate && semester?.timeZone);
}

/** How many weekly occurrences fall on or between the first matching weekday and the end date. */
export function countWeeklyOccurrences(semester: SemesterConfig, day: Day): { first: Date; count: number } | null {
  const start = new Date(`${semester.startDate}T00:00:00Z`);
  const end = new Date(`${semester.endDate}T00:00:00Z`);
  const offset = (JS_WEEKDAY[day] - start.getUTCDay() + 7) % 7;
  const first = new Date(start.getTime() + offset * MS_PER_DAY);
  if (first.getTime() > end.getTime()) return null;
  return { first, count: Math.floor((end.getTime() - first.getTime()) / (7 * MS_PER_DAY)) + 1 };
}

/**
 * The dates in `skipDates` that really are one of this weekly event's occurrences. A holiday
 * on a Thursday only affects Thursday shifts, and only if it is on or after the first
 * occurrence and within the repeat count.
 */
export function excludedOccurrences(semester: SemesterConfig, first: Date, count: number): Date[] {
  const found = new Map<string, Date>();
  for (const iso of semester.skipDates ?? []) {
    const date = new Date(`${iso}T00:00:00Z`);
    const days = Math.round((date.getTime() - first.getTime()) / MS_PER_DAY);
    if (days >= 0 && days % 7 === 0 && days / 7 < count) found.set(iso, date);
  }
  return [...found.values()].sort((a, b) => a.getTime() - b.getTime());
}

/**
 * A safe download name for a student's calendar file, e.g. "shiftfit-noa-k.ics". Anything other
 * than letters and digits becomes a dash, so a name can't create folders or odd file names.
 */
export function icsFileName(student: Student): string {
  const slug = student.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "student";
  return `cadence-${slug}.ics`;
}

/**
 * Builds a weekly-recurring .ics calendar for one student, merging adjacent assigned
 * slots into single contiguous events.
 *
 * Correctness rules this deliberately follows:
 *  - Start/end are LOCAL wall-clock times tagged with `TZID`, never UTC, so a shift at
 *    8:00am shows at 8:00am in the semester's timezone.
 *  - Repetition uses `COUNT`, not `UNTIL`, because a local-time `UNTIL` would have to be
 *    converted to UTC, which needs timezone math this app doesn't guess at.
 *  - The first occurrence is the first matching weekday ON OR AFTER the semester start
 *    date, so the start date does not have to be a Monday.
 *  - Nothing is guessed: dates and timezone must come from the manager (`SemesterConfig`).
 *
 * `now` is injectable only so tests are deterministic.
 */
export function buildStudentIcs(
  student: Student,
  assignments: ShiftBlock[],
  semester: SemesterConfig,
  slotMinutes: number,
  now: Date = new Date(),
): string {
  const blocks = mergeContiguousBlocks(
    assignments.filter((a) => a.studentId === student.id),
    slotMinutes,
  );
  const stamp = `${utcDateStamp(now)}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Cadence//Shift Coverage Planner//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeText(`${student.name} — work shifts`)}`,
    `X-WR-TIMEZONE:${semester.timeZone}`,
  ];

  for (const block of blocks) {
    const occurrences = countWeeklyOccurrences(semester, block.day);
    if (!occurrences) continue;
    const uid = `${student.id}-${block.day}-${block.start}`.replace(/[^A-Za-z0-9-]/g, "");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}@shiftfit`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${semester.timeZone}:${localDateTime(occurrences.first, block.start)}`,
      `DTEND;TZID=${semester.timeZone}:${localDateTime(occurrences.first, block.end)}`,
      `RRULE:FREQ=WEEKLY;COUNT=${occurrences.count}`,
      ...exdate(semester, occurrences.first, occurrences.count, block.start),
      `SUMMARY:${escapeText(`Work shift — ${student.name}`)}`,
      `DESCRIPTION:${escapeText("Created by Cadence. Ask your manager before changing this shift.")}`,
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
