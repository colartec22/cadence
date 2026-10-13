import { MAX_ASSIGNMENTS, MAX_STUDENTS, STUDENT_COLORS } from "./constants";
import { isValidAvatar } from "../../lib/image";
import { isIsoDate, isValidTimeZone } from "./time";
import { DAYS } from "./types";
import type {
  BusyBlock,
  Day,
  PersistedStateV1,
  ScheduleSettings,
  SemesterConfig,
  ShiftBlock,
  Student,
} from "./types";

/**
 * ============================================================================
 *  BACKUP-FILE / LOCALSTORAGE GATEKEEPER
 * ============================================================================
 * Nothing loaded from outside the app in this run — a backup file the manager
 * picks, or data read back out of the browser's `localStorage` — is trusted
 * as-is. Every field is checked here field-by-field before it's allowed to
 * become real application state. Bad or unrecognized data is either rejected
 * outright (`ok: false`) or quietly repaired and reported in `notes` (e.g. "2
 * shifts belonging to a deleted student were skipped"), so a corrupted or
 * hand-edited file can never crash the app or smuggle in unexpected content.
 */
export type ValidationResult<T> = { ok: true; value: T; notes: string[] } | { ok: false; errors: string[] };

const MAX_ERRORS = 10;
const MAX_SKIP_DATES = 100;

/** True for a plain object like `{ ... }` (not null, not a list). */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** True for a whole number of minutes from midnight (0) up to the next midnight (1440). */
function isMinutes(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 24 * 60;
}

/** True for a number of hours between `min` and `max` (inclusive) that is a whole or half hour, like 19 or 19.5. */
function isHalfHours(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max && Math.round(v * 2) / 2 === v;
}

/** True for one of the five weekday codes the app uses ("mon" to "fri"). */
function isDay(v: unknown): v is Day {
  return typeof v === "string" && (DAYS as string[]).includes(v);
}

/**
 * Hidden "control characters" are codes 0-31 and 127: line breaks, tabs, the null character and
 * similar. A real name or id never has one, and the app's own text boxes can't type one; only a
 * hand-edited backup file could. A line break hidden in a name could break the calendar files and
 * publish requests the name is later copied into, so they are never let through.
 */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

/** True if the text contains any hidden control character (see above). */
function hasControlCharacters(text: string): boolean {
  return new RegExp(CONTROL_CHARACTERS.source).test(text);
}

/** The same text with every hidden control character turned into a plain space. */
function removeControlCharacters(text: string): string {
  return text.replace(CONTROL_CHARACTERS, " ");
}

/** Checks the office-wide rules (open hours, staff per slot, weekly target) and returns a clean copy, or null. */
function readSettings(input: unknown, errors: string[]): ScheduleSettings | null {
  if (!isRecord(input)) {
    errors.push("Missing settings.");
    return null;
  }
  const { openTime, closeTime, minStaffPerSlot, slotMinutes, weeklyTargetHours, term, breakWeeklyHours, minShiftHours } = input;
  if (!isMinutes(openTime) || !isMinutes(closeTime) || openTime >= closeTime) {
    errors.push("Settings: open and close times must be valid, with opening before closing.");
    return null;
  }
  if (typeof minStaffPerSlot !== "number" || !Number.isInteger(minStaffPerSlot) || minStaffPerSlot < 1 || minStaffPerSlot > 10) {
    errors.push("Settings: staff per slot must be a whole number from 1 to 10.");
    return null;
  }
  if (slotMinutes !== 30) {
    errors.push("Settings: only 30-minute slots are supported.");
    return null;
  }
  if (typeof weeklyTargetHours !== "number" || !(weeklyTargetHours > 0) || weeklyTargetHours > 40) {
    errors.push("Settings: the weekly hour target must be between 0 and 40.");
    return null;
  }
  // Optional rules added later: absent in older saved schedules (the standard value is used), but never accepted if present and silly.
  if (breakWeeklyHours !== undefined && !isHalfHours(breakWeeklyHours, 1, 40)) {
    errors.push("Settings: the break hour limit must be between 1 and 40 hours, in whole or half hours.");
    return null;
  }
  if (minShiftHours !== undefined && !isHalfHours(minShiftHours, 0.5, 4)) {
    errors.push("Settings: the shortest shift must be between half an hour and 4 hours, in half-hour steps.");
    return null;
  }
  // Schedules saved before the Semester/Break switch existed have no term; they were made for the semester.
  return {
    openTime,
    closeTime,
    minStaffPerSlot,
    slotMinutes,
    weeklyTargetHours,
    term: term === "break" ? "break" : "semester",
    ...(breakWeeklyHours !== undefined ? { breakWeeklyHours } : {}),
    ...(minShiftHours !== undefined ? { minShiftHours } : {}),
  };
}

/** Checks one student's list of class/blocked times; any bad entry rejects the list. */
function readBusy(input: unknown, label: string, errors: string[]): BusyBlock[] | null {
  if (!Array.isArray(input)) {
    errors.push(`${label}: busy must be a list.`);
    return null;
  }
  const out: BusyBlock[] = [];
  for (const [i, b] of input.entries()) {
    if (!isRecord(b) || !isDay(b.day) || !isMinutes(b.start) || !isMinutes(b.end) || b.start >= b.end) {
      errors.push(`${label}: class time #${i + 1} is not valid.`);
      return null;
    }
    const source = b.source === "lunch" || b.source === "manual" ? b.source : "class";
    out.push({ day: b.day, start: b.start, end: b.end, source });
  }
  return out;
}

/**
 * Checks every student field by field and returns clean copies. Problems that can be safely
 * repaired are (a bad color gets a default, hidden characters in a name become spaces, an
 * unreadable photo is dropped); anything else is reported as an error.
 */
function readStudents(input: unknown, errors: string[]): Student[] | null {
  if (!Array.isArray(input)) {
    errors.push("students must be a list.");
    return null;
  }
  if (input.length > MAX_STUDENTS) {
    errors.push(`Too many students (limit ${MAX_STUDENTS}).`);
    return null;
  }
  const out: Student[] = [];
  const ids = new Set<string>();
  for (const [i, s] of input.entries()) {
    const label = `Student #${i + 1}`;
    if (!isRecord(s)) {
      errors.push(`${label} is not an object.`);
      continue;
    }
    if (typeof s.id !== "string" || !s.id || s.id.length > 100 || hasControlCharacters(s.id)) errors.push(`${label}: id is required.`);
    else if (ids.has(s.id)) errors.push(`${label}: duplicate id.`);
    // Hidden characters in a name are replaced with spaces (below) rather than rejecting the whole
    // file, so one odd name in the browser's saved data can never wipe out the manager's schedule.
    const cleanName = typeof s.name === "string" ? removeControlCharacters(s.name).trim() : "";
    if (!cleanName || cleanName.length > 80) errors.push(`${label}: name is required (80 characters max).`);
    if (typeof s.daysPerWeek !== "number" || !Number.isInteger(s.daysPerWeek) || s.daysPerWeek < 1 || s.daysPerWeek > 5) {
      errors.push(`${label}: days per week must be 1 to 5.`);
    }
    if (!isMinutes(s.latestEnd)) errors.push(`${label}: latest end time is not valid.`);
    if (s.lunchStart !== null && !isMinutes(s.lunchStart)) errors.push(`${label}: lunch time is not valid.`);
    if (typeof s.needsOpeningShift !== "boolean") errors.push(`${label}: needsOpeningShift must be true or false.`);
    const busy = readBusy(s.busy, label, errors);
    if (errors.length || busy === null) continue;
    ids.add(s.id as string);
    const preference = s.preference === "morning" || s.preference === "afternoon" ? s.preference : "any";
    const color =
      typeof s.color === "string" && /^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : STUDENT_COLORS[i % STUDENT_COLORS.length];
    out.push({
      id: s.id as string,
      name: cleanName,
      color,
      // A photo that is not a thumbnail this app made (wrong type, too long, hand-edited) is dropped and initials show instead.
      ...(isValidAvatar(s.avatar) ? { avatar: s.avatar } : {}),
      preference,
      daysPerWeek: s.daysPerWeek as number,
      classText: typeof s.classText === "string" ? s.classText.slice(0, 5000) : "",
      blockedText: typeof s.blockedText === "string" ? s.blockedText.slice(0, 5000) : "",
      busy: busy as BusyBlock[],
      latestEnd: s.latestEnd as number,
      lunchStart: (s.lunchStart as number | null) ?? null,
      needsOpeningShift: s.needsOpeningShift as boolean,
    });
  }
  return errors.length ? null : out;
}

/** Checks the optional semester dates, timezone and days off used for calendar export. Missing is fine. */
function readSemester(input: unknown, errors: string[]): SemesterConfig | null {
  if (input == null) return null;
  if (
    !isRecord(input) ||
    typeof input.startDate !== "string" ||
    typeof input.endDate !== "string" ||
    typeof input.timeZone !== "string" ||
    !isIsoDate(input.startDate) ||
    !isIsoDate(input.endDate) ||
    input.endDate < input.startDate ||
    !isValidTimeZone(input.timeZone)
  ) {
    errors.push("Semester dates or timezone are not valid.");
    return null;
  }
  const rawSkips = input.skipDates;
  if (rawSkips !== undefined && (!Array.isArray(rawSkips) || rawSkips.length > MAX_SKIP_DATES || !rawSkips.every((d) => typeof d === "string" && isIsoDate(d)))) {
    errors.push("The list of days off is not valid.");
    return null;
  }
  const skipDates = rawSkips ? Array.from(new Set(rawSkips as string[])).sort() : [];
  return { startDate: input.startDate, endDate: input.endDate, timeZone: input.timeZone, skipDates };
}

/**
 * Reads one list of shifts from a backup, keeping only valid shifts for known students.
 * Returns null when the list itself is unusable (the error is recorded instead).
 */
function readShifts(list: unknown, students: Student[] | null, prefix: string, errors: string[], notes: string[]): ShiftBlock[] | null {
  if (!Array.isArray(list)) {
    errors.push(`${prefix}assignments must be a list.`);
    return null;
  }
  if (list.length > MAX_ASSIGNMENTS) {
    errors.push(`${prefix}Too many shifts (limit ${MAX_ASSIGNMENTS}).`);
    return null;
  }
  if (!students) return null;
  const known = new Set(students.map((s) => s.id));
  const seen = new Set<string>();
  const out: ShiftBlock[] = [];
  let orphans = 0;
  let duplicates = 0;
  for (const [i, a] of list.entries()) {
    if (!isRecord(a) || typeof a.studentId !== "string" || !isDay(a.day) || !isMinutes(a.start) || a.start % 30 !== 0) {
      errors.push(`${prefix}Shift #${i + 1} is not valid.`);
      if (errors.length >= MAX_ERRORS) break;
      continue;
    }
    if (!known.has(a.studentId)) {
      orphans++;
      continue;
    }
    const key = `${a.studentId}|${a.day}|${a.start}`;
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    out.push({
      id: typeof a.id === "string" && a.id ? a.id.slice(0, 120) : `shift-${key}`,
      studentId: a.studentId,
      day: a.day,
      start: a.start,
      source: a.source === "autofill" ? "autofill" : "manual",
      ...(a.override === true ? { override: true } : {}),
    });
  }
  if (orphans) notes.push(`${prefix}Skipped ${orphans} shift${orphans === 1 ? "" : "s"} that belonged to students not in the file.`);
  if (duplicates) notes.push(`${prefix}Skipped ${duplicates} duplicate shift${duplicates === 1 ? "" : "s"}.`);
  return out;
}

/**
 * Validates a backup/localStorage blob BEFORE it can reach application state, and
 * returns a sanitized copy (unknown fields stripped, orphan shifts dropped) instead
 * of trusting the file. `notes` lists anything that was quietly dropped.
 */
export function validatePersistedState(input: unknown): ValidationResult<PersistedStateV1> {
  const errors: string[] = [];
  const notes: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["That file is not a Cadence backup."] };
  if (input.version !== 1) errors.push(`Unsupported backup version: ${String(input.version)}.`);

  const settings = readSettings(input.settings, errors);
  const students = readStudents(input.students, errors);
  const semester = readSemester(input.semester, errors);

  const assignments = readShifts(input.assignments, students, "", errors, notes) ?? [];
  // Optional: older saved data has only one schedule.
  const otherTermAssignments =
    input.otherTermAssignments === undefined ? [] : (readShifts(input.otherTermAssignments, students, "In the other schedule: ", errors, notes) ?? []);

  if (errors.length || !settings || !students) {
    return { ok: false, errors: errors.length ? errors.slice(0, MAX_ERRORS) : ["That file is not a Cadence backup."] };
  }

  const selected = typeof input.selectedStudentId === "string" && students.some((s) => s.id === input.selectedStudentId);
  return {
    ok: true,
    notes,
    value: {
      version: 1,
      settings,
      students,
      assignments,
      otherTermAssignments,
      selectedStudentId: selected ? (input.selectedStudentId as string) : (students[0]?.id ?? null),
      semester,
    },
  };
}
