import { assignedHours, studentsMissingOpeningShift } from "./availability";
import { scheduleVersion } from "./blocks";
import { buildCoverageSlots, buildGapRanges, summarizeCoverage, uncoveredStaffHours } from "./coverage";
import type { CoverageSummary } from "./coverage";
import { findIssues, isBlockingIssue } from "./issues";
import type { GapRange, ScheduleIssue, ScheduleSettings, ShiftBlock, Student } from "./types";

/**
 * ============================================================================
 *  ONE-CALL SCHEDULE REPORT: "IS THIS SCHEDULE ALLOWED, AND HOW GOOD IS IT?"
 * ============================================================================
 * The app already has separate functions for each question (rule problems in `issues.ts`, coverage in
 * `coverage.ts`, hours in `availability.ts`). This file asks all of them at once and returns a single
 * plain report. Two things use it:
 *  - the server check (`src/server/handler.ts`), which re-validates a schedule before it is published, and
 *  - any screen that wants headline numbers without doing the math itself.
 * It only READS a schedule; it never changes one. The rules themselves are not repeated here, so they
 * cannot drift apart from the ones the grid and auto-fill use.
 */

export type StudentHours = {
  studentId: string;
  name: string;
  hours: number;
  /** True when the student has reached the weekly target. */
  atTarget: boolean;
};

export type ScheduleEvaluation = {
  /** Fingerprint of who works when (same one used for publishing), so "did it change?" is a simple comparison. */
  scheduleVersion: string;
  /** True when no rule is broken (knowingly overridden limits do not count). A schedule that is not `ok` must not be published. */
  ok: boolean;
  /** Rules the schedule breaks right now, e.g. a shift on top of a class. */
  blockingIssues: ScheduleIssue[];
  /** Limits the manager chose to go past. Allowed, but worth showing. */
  overriddenWarnings: ScheduleIssue[];
  coverage: CoverageSummary;
  /** Understaffed stretches, merged into readable ranges (e.g. Mon 9:00am-11:00am, short 1). */
  gaps: GapRange[];
  /**
   * How many hours of staffing are still missing in total. If 2 people are needed and only 1 works
   * for one hour, that is 1 staff-hour missing. Zero means every slot has enough people.
   */
  uncoveredStaffHours: number;
  /** Students who need an opening shift and don't have a real one. */
  openingShiftMissing: { studentId: string; name: string }[];
  students: StudentHours[];
};

/** Builds the full report described above for one schedule. Reads only; changes nothing. */
export function evaluateSchedule(students: Student[], assignments: ShiftBlock[], settings: ScheduleSettings): ScheduleEvaluation {
  const issues = findIssues(students, assignments, settings);
  const blockingIssues = issues.filter(isBlockingIssue);

  const slots = buildCoverageSlots(assignments, settings);

  return {
    scheduleVersion: scheduleVersion(assignments),
    ok: blockingIssues.length === 0,
    blockingIssues,
    overriddenWarnings: issues.filter((issue) => !isBlockingIssue(issue)),
    coverage: summarizeCoverage(slots, settings),
    gaps: buildGapRanges(slots),
    uncoveredStaffHours: uncoveredStaffHours(slots, settings),
    openingShiftMissing: studentsMissingOpeningShift(students, assignments, settings),
    students: students.map((s) => {
      const hours = assignedHours(s.id, assignments, settings);
      return { studentId: s.id, name: s.name, hours, atTarget: hours >= settings.weeklyTargetHours };
    }),
  };
}
