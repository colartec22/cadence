import { BREAK_WEEKLY_HOURS, DEVOTIONAL, MIN_SHIFT_MINUTES } from "./constants";
import type { Day, Minutes, ScheduleSettings } from "./types";

/**
 * ============================================================================
 *  SEMESTER VS. BREAK
 * ============================================================================
 * Two rules change depending on whether classes are in session (the
 * "Semester / Break" switch at the top of the app):
 * - Tuesday devotional (11:00am–12:00pm) is closed during the semester and
 *   open during a break.
 * - The weekly hour limit is the normal one (19) during the semester and
 *   BREAK_WEEKLY_HOURS (40) during a break.
 * Every other file asks these helpers instead of checking `settings.term`
 * itself, so the two rules are written only here.
 */

export function isOnBreak(settings: ScheduleSettings): boolean {
  return settings.term === "break";
}

/** Most hours a student may be scheduled this week. */
export function weeklyLimit(settings: ScheduleSettings): number {
  return isOnBreak(settings) ? breakLimit(settings) : settings.weeklyTargetHours;
}

/** Most hours a student may work in a week during a break: the manager's choice in Rules, or the standard 40. */
export function breakLimit(settings: ScheduleSettings): number {
  return settings.breakWeeklyHours ?? BREAK_WEEKLY_HOURS;
}

/** Shortest shift allowed, in minutes: the manager's choice in Rules, or the standard 2 hours. */
export function minShiftMinutes(settings: ScheduleSettings): number {
  return settings.minShiftHours === undefined ? MIN_SHIFT_MINUTES : Math.round(settings.minShiftHours * 60);
}

/** True for a half-hour box that falls inside Tuesday devotional while the semester is on. */
export function isDevotional(day: Day, slotStart: Minutes, settings: ScheduleSettings): boolean {
  return (
    !isOnBreak(settings) &&
    day === DEVOTIONAL.day &&
    slotStart < DEVOTIONAL.end &&
    slotStart + settings.slotMinutes > DEVOTIONAL.start
  );
}
