import type { BusyBlock, ConstraintViolation, Day, Minutes, ScheduleSettings, ShiftBlock, Student, WorkBreak } from "./types";
import { DAY_LABEL } from "./types";
import { openDays } from "./days";
import { DEVOTIONAL, MIN_OPENING_SHIFT_MINUTES, OPENING_SHIFT_START } from "./constants";
import { isDevotional, weeklyLimit } from "./term";
import { formatMinutes, formatRange, hoursLabel } from "./time";

/**
 * ============================================================================
 *  RULE-CHECKING: "CAN THIS STUDENT WORK THIS SLOT?"
 * ============================================================================
 * This file answers yes/no questions about one student and one 30-minute grid
 * box at a time: are they busy then, would it push them over their weekly
 * hours, have they already worked their max days, etc. It is the single
 * source of truth for the scheduling rules — the grid (when you click a box),
 * "Fill schedule for me" (`scheduler.ts`), and the health checker
 * (`issues.ts`) all call into these same functions, so a rule only ever has
 * to be written once. Start with `canAssign` — it's the main entry point.
 */

/** Slot starts between open and close, inclusive of open, exclusive of close. */
export function daySlots(settings: ScheduleSettings): Minutes[] {
  const out: Minutes[] = [];
  for (let m = settings.openTime; m < settings.closeTime; m += settings.slotMinutes) out.push(m);
  return out;
}

/** The class or blocked time that overlaps this slot, if any. */
export function busyBlockAt(student: Student, day: Day, slotStart: Minutes, slotMinutes: number): BusyBlock | undefined {
  return student.busy.find((b) => b.day === day && b.start < slotStart + slotMinutes && b.end > slotStart);
}

/** True if the student has a class or blocked time anywhere inside this half-hour slot. */
export function isBusy(student: Student, day: Day, slotStart: Minutes, slotMinutes: number): boolean {
  return busyBlockAt(student, day, slotStart, slotMinutes) !== undefined;
}

/**
 * Assignment helpers always look at ALL of a student's assignments, never only the
 * ones inside the currently visible open-hours window. The prototype this replaces
 * counted hours only over visible slots, so the 19-hour cap silently disagreed with
 * reality when the manager switched between the 7am and 8am views.
 */
export function studentAssignments(studentId: string, assignments: ShiftBlock[]): ShiftBlock[] {
  return assignments.filter((a) => a.studentId === studentId);
}

/** Total hours this student is scheduled for in the whole week (number of slots x slot length). */
export function assignedHours(studentId: string, assignments: ShiftBlock[], settings: ScheduleSettings): number {
  return (studentAssignments(studentId, assignments).length * settings.slotMinutes) / 60;
}

/** Hours this student is scheduled for on one particular day. */
export function assignedHoursOnDay(
  studentId: string,
  day: Day,
  assignments: ShiftBlock[],
  settings: ScheduleSettings,
): number {
  return (
    (studentAssignments(studentId, assignments).filter((a) => a.day === day).length * settings.slotMinutes) / 60
  );
}

/** How many different weekdays the student works at least one slot on. */
export function workedDayCount(studentId: string, assignments: ShiftBlock[]): number {
  return new Set(studentAssignments(studentId, assignments).map((a) => a.day)).size;
}

/**
 * May the student work on this day without going over their "days per week" limit? Yes if they
 * already work that day (adding more hours doesn't add a day), or if they still have days to spare.
 */
export function canUseDay(student: Student, day: Day, assignments: ShiftBlock[], settings: ScheduleSettings): boolean {
  return (
    assignedHoursOnDay(student.id, day, assignments, settings) > 0 ||
    workedDayCount(student.id, assignments) < student.daysPerWeek
  );
}

/** True if this exact student is already scheduled in this exact slot. */
export function isAssigned(studentId: string, day: Day, slotStart: Minutes, assignments: ShiftBlock[]): boolean {
  return assignments.some((a) => a.studentId === studentId && a.day === day && a.start === slotStart);
}

/** The ids of everyone working this slot, each listed once. */
export function staffAt(day: Day, slotStart: Minutes, assignments: ShiftBlock[]): string[] {
  const ids = assignments.filter((a) => a.day === day && a.start === slotStart).map((a) => a.studentId);
  return Array.from(new Set(ids));
}

/**
 * True when the student has a real contiguous opening shift: at least
 * `MIN_OPENING_SHIFT_MINUTES` of back-to-back slots starting exactly at
 * `OPENING_SHIFT_START` on some day. One lone 30-minute slot does not count.
 */
export function hasOpeningShift(studentId: string, assignments: ShiftBlock[], settings: ScheduleSettings): boolean {
  const requiredSlots = Math.ceil(MIN_OPENING_SHIFT_MINUTES / settings.slotMinutes);
  for (const day of openDays(settings)) {
    let run = 0;
    let cursor = OPENING_SHIFT_START;
    while (isAssigned(studentId, day, cursor, assignments)) {
      run += 1;
      cursor += settings.slotMinutes;
    }
    if (run >= requiredSlots) return true;
  }
  return false;
}

/**
 * The constraint that makes this slot itself invalid for `student`, or null.
 * Only slot-level hard rules live here; weekly-target and day-count limits depend
 * on the rest of the student's schedule and are checked in `canAssign`.
 */
export function blockedBySlot(
  student: Student,
  day: Day,
  slotStart: Minutes,
  settings: ScheduleSettings,
): ConstraintViolation | null {
  if (isDevotional(day, slotStart, settings)) {
    return { code: "devotional", message: `can't work during Tuesday devotional (${formatRange(DEVOTIONAL.start, DEVOTIONAL.end)})` };
  }
  const busy = busyBlockAt(student, day, slotStart, settings.slotMinutes);
  if (busy) {
    return busy.source === "class"
      ? { code: "class_conflict", message: `has class on ${DAY_LABEL[day]} at this time` }
      : { code: "unavailable", message: `is unavailable on ${DAY_LABEL[day]} at this time` };
  }
  if (slotStart + settings.slotMinutes > student.latestEnd) {
    return { code: "after_cutoff", message: `can't work past ${formatMinutes(student.latestEnd)}` };
  }
  const onBreak = breakAt(student, slotStart, settings.slotMinutes);
  if (onBreak) {
    return { code: "break_conflict", message: `is on a break at ${formatRange(onBreak.start, onBreak.start + onBreak.minutes)}` };
  }
  return null;
}

/**
 * The student's break that overlaps this box, if any. A break blocks every box it touches: with
 * 30-minute boxes, a 15-minute break at 12:00 keeps the whole 12:00–12:30 box free.
 */
export function breakAt(student: Student, slotStart: Minutes, slotMinutes: number): WorkBreak | undefined {
  return student.breaks.find((b) => b.start < slotStart + slotMinutes && b.start + b.minutes > slotStart);
}

/**
 * Every soft limit this assignment would break (weekly hours, days per week). Unlike a class
 * or break conflict, a manager may knowingly allow these, so an override dialog must list
 * ALL of them, not just the first one `canAssign` happens to report.
 */
export function softViolations(
  student: Student,
  day: Day,
  slotStart: Minutes,
  assignments: ShiftBlock[],
  settings: ScheduleSettings,
): ConstraintViolation[] {
  if (blockedBySlot(student, day, slotStart, settings) || isAssigned(student.id, day, slotStart, assignments)) return [];
  const out: ConstraintViolation[] = [];
  if (assignedHours(student.id, assignments, settings) >= weeklyLimit(settings)) {
    out.push({ code: "over_weekly_target", message: `is already at ${hoursLabel(weeklyLimit(settings))}` });
  }
  if (!canUseDay(student, day, assignments, settings)) {
    out.push({ code: "over_max_days", message: `only works ${student.daysPerWeek} ${student.daysPerWeek === 1 ? "day" : "days"} a week` });
  }
  return out;
}

/**
 * The main "can this student take this slot?" check used by clicks and auto-fill. Returns the
 * FIRST rule it breaks (hard rules first: class, blocked time, cutoff, break, already there; then
 * the soft limits: weekly hours, days per week), or null if the slot is fine.
 */
export function canAssign(
  student: Student,
  day: Day,
  slotStart: Minutes,
  assignments: ShiftBlock[],
  settings: ScheduleSettings,
): ConstraintViolation | null {
  const slotViolation = blockedBySlot(student, day, slotStart, settings);
  if (slotViolation) return slotViolation;
  if (isAssigned(student.id, day, slotStart, assignments)) {
    return { code: "already_assigned", message: "is already working this slot" };
  }
  if (assignedHours(student.id, assignments, settings) >= weeklyLimit(settings)) {
    return { code: "over_weekly_target", message: `is already at ${hoursLabel(weeklyLimit(settings))}` };
  }
  if (!canUseDay(student, day, assignments, settings)) {
    return { code: "over_max_days", message: `only works ${student.daysPerWeek} ${student.daysPerWeek === 1 ? "day" : "days"} a week` };
  }
  return null;
}

/**
 * One student's shifts on one day, merged into continuous runs ("9:00am–11:00am").
 * Used to enforce MIN_SHIFT_MINUTES, which is about whole shifts, not single boxes.
 */
export function shiftRuns(
  studentId: string,
  day: Day,
  assignments: ShiftBlock[],
  settings: ScheduleSettings,
): { start: Minutes; end: Minutes }[] {
  const starts = studentAssignments(studentId, assignments)
    .filter((a) => a.day === day)
    .map((a) => a.start)
    .sort((a, b) => a - b);
  const runs: { start: Minutes; end: Minutes }[] = [];
  for (const start of starts) {
    const last = runs[runs.length - 1];
    if (last && last.end === start) last.end = start + settings.slotMinutes;
    else if (!last || last.end < start) runs.push({ start, end: start + settings.slotMinutes });
  }
  return runs;
}

/** Students who need an opening shift and don't have a real one yet. Shared by the server check and the Schedule health panel. */
export function studentsMissingOpeningShift(
  students: Student[],
  assignments: ShiftBlock[],
  settings: ScheduleSettings,
): { studentId: string; name: string }[] {
  return students
    .filter((s) => s.needsOpeningShift && !hasOpeningShift(s.id, assignments, settings))
    .map((s) => ({ studentId: s.id, name: s.name }));
}
