import { DAYS } from "./types";
import type { Day, ScheduleSettings } from "./types";

/**
 * ============================================================================
 *  WHICH DAYS THE OFFICE IS OPEN
 * ============================================================================
 * The app knows Monday to Saturday (`DAYS` in `types.ts`). Each office chooses in Settings whether it
 * is open on Saturday. Everything that walks through "the week" (the grid, coverage, auto-fill, the
 * opening-shift rule) asks `openDays` instead of using `DAYS` directly, so a Monday–Friday office
 * never sees Saturday as an empty, uncovered day.
 */

/** The days the office is open, in week order. Older saved schedules with no setting are Monday to Friday. */
export function openDays(settings: ScheduleSettings): Day[] {
  return settings.openDays === "mon-sat" ? DAYS : DAYS.filter((day) => day !== "sat");
}

/** True if the office is open on this day. */
export function isOpenDay(day: Day, settings: ScheduleSettings): boolean {
  return openDays(settings).includes(day);
}
