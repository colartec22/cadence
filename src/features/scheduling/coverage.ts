import { daySlots, staffAt } from "./availability";
import { isDevotional, weeklyLimit } from "./term";
import { DAYS } from "./types";
import type { CoverageSlot, Day, GapRange, ScheduleSettings, ShiftBlock } from "./types";

/**
 * ============================================================================
 *  STAFFING COVERAGE: "IS EVERY TIME SLOT STAFFED?"
 * ============================================================================
 * Where `availability.ts` asks about one student, this file looks at the
 * WHOLE schedule at once and reports which grid boxes have enough people
 * assigned. It powers the pink/empty boxes on the grid, the "Schedule
 * health" panel's gap list, and the coverage percentages in the summary.
 * Nothing here is stored — it's recalculated from `assignments` every time
 * the schedule changes, so it can never drift out of sync.
 */

/** One entry per box that needs staff. Tuesday devotional (during the semester) needs nobody, so it is left out. */
export function buildCoverageSlots(assignments: ShiftBlock[], settings: ScheduleSettings): CoverageSlot[] {
  const slots = daySlots(settings);
  const out: CoverageSlot[] = [];
  for (const day of DAYS) {
    for (const start of slots) {
      if (isDevotional(day, start, settings)) continue;
      const assignedStudentIds = staffAt(day, start, assignments);
      out.push({
        day,
        start,
        end: start + settings.slotMinutes,
        assignedStudentIds,
        minRequired: settings.minStaffPerSlot,
        fullyStaffed: assignedStudentIds.length >= settings.minStaffPerSlot,
      });
    }
  }
  return out;
}

/**
 * Groups consecutive under-staffed slots on the same day into readable ranges.
 * The slots this reads from `buildCoverageSlots` are already ordered day-major,
 * time-minor, so a simple adjacency check is correct here — the prototype this
 * replaces iterated time-major/day-minor while merging with a day+time adjacency
 * check, so same-day gaps were almost never adjacent in the array and never merged.
 */
export function buildGapRanges(coverage: CoverageSlot[]): GapRange[] {
  const gaps = coverage.filter((s) => !s.fullyStaffed);
  const ranges: GapRange[] = [];
  for (const slot of gaps) {
    const shortfall = slot.minRequired - slot.assignedStudentIds.length;
    const last = ranges[ranges.length - 1];
    if (last && last.day === slot.day && last.end === slot.start && last.shortfall === shortfall) {
      last.end = slot.end;
    } else {
      ranges.push({ day: slot.day, start: slot.start, end: slot.end, shortfall });
    }
  }
  return ranges;
}

export type CoverageSummary = {
  /** % of slots that meet the minimum staffing requirement. */
  fullyStaffedPercent: number;
  /** % of total staffing DEMAND (slots x minStaff) that is actually filled. */
  demandFulfilledPercent: number;
  totalSlots: number;
  fullyStaffedSlots: number;
  /** Theoretical minimum labor-hours to staff every slot at minStaff — ignores availability. */
  theoreticalStaffingHours: number;
  /** Theoretical headcount if every student worked exactly the weekly target with zero conflicts. */
  theoreticalMinimumStudents: number;
};

/**
 * Boils the per-slot coverage down to the headline numbers: what percent of half hours have
 * enough people, what percent of the needed people-slots are filled, and the rough minimum
 * staff-hours and headcount the week would need if nobody had any classes.
 */
export function summarizeCoverage(coverage: CoverageSlot[], settings: ScheduleSettings): CoverageSummary {
  const totalSlots = coverage.length;
  const fullyStaffedSlots = coverage.filter((s) => s.fullyStaffed).length;
  const demandSlots = totalSlots * settings.minStaffPerSlot;
  const filledSlots = coverage.reduce((sum, s) => sum + Math.min(s.assignedStudentIds.length, s.minRequired), 0);
  const theoreticalStaffingHours = (totalSlots * settings.slotMinutes * settings.minStaffPerSlot) / 60;
  return {
    fullyStaffedPercent: totalSlots ? Math.round((fullyStaffedSlots / totalSlots) * 100) : 100,
    demandFulfilledPercent: demandSlots ? Math.round((filledSlots / demandSlots) * 100) : 100,
    totalSlots,
    fullyStaffedSlots,
    theoreticalStaffingHours,
    theoreticalMinimumStudents: Math.ceil(theoreticalStaffingHours / weeklyLimit(settings)),
  };
}

/**
 * How many hours of staffing are missing in total. If 2 people are needed and only 1 works for one
 * hour, that is 1 staff-hour missing. Zero means every box has enough people. Shared by the
 * server check (`evaluate.ts`) and the Schedule health panel so both always give the same number.
 */
export function uncoveredStaffHours(coverage: CoverageSlot[], settings: ScheduleSettings): number {
  const missingPersonSlots = coverage.reduce((sum, slot) => sum + Math.max(0, slot.minRequired - slot.assignedStudentIds.length), 0);
  return (missingPersonSlots * settings.slotMinutes) / 60;
}

/** A day's position in the week (Monday = 0), for sorting things Monday to Friday. */
export function dayLabelOrder(day: Day): number {
  return DAYS.indexOf(day);
}
