import {
  assignedHours,
  blockedBySlot,
  canAssign,
  canUseDay,
  hasOpeningShift,
  isAssigned,
  shiftRuns,
  workedDayCount,
} from "./availability";
import { OPENING_SHIFT_START } from "./constants";
import { minShiftMinutes, weeklyLimit } from "./term";
import { formatMinutes, formatRange, hoursLabel } from "./time";
import { DAYS, DAY_LABEL } from "./types";
import type { ConstraintViolationCode, Day, Minutes, ScheduleIssue, ScheduleSettings, ShiftBlock, Student } from "./types";

/**
 * ============================================================================
 *  "SCHEDULE HEALTH": FINDING AND EXPLAINING PROBLEMS
 * ============================================================================
 * `availability.ts` checks rules before a slot is assigned (when you click a
 * box). This file checks rules AFTER the fact, across the whole schedule —
 * because a shift that was fine when it was placed can become a problem later
 * (e.g. the manager edits a student's class times, and an old shift now sits
 * on top of the new class). It also writes the plain-language "who's free /
 * why not" text used throughout the app.
 */

const SLOT_LEVEL_TEXT: Record<"class_conflict" | "unavailable" | "after_cutoff" | "break_conflict" | "devotional", string> = {
  class_conflict: "has a class then",
  unavailable: "is marked unavailable then",
  after_cutoff: "is scheduled past their cutoff time",
  break_conflict: "is scheduled during their break",
  devotional: "is scheduled during Tuesday devotional",
};

/**
 * Finds every rule the CURRENT schedule breaks. This matters because rules can be
 * broken after the fact: editing a student's class times, cutoff or breaks does not
 * move shifts that were already placed. Consecutive slots with the same problem are
 * merged into one readable issue ("Mon 9:00am–10:30am").
 */
export function findIssues(students: Student[], assignments: ShiftBlock[], settings: ScheduleSettings): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];

  for (const student of students) {
    const mine = assignments
      .filter((a) => a.studentId === student.id)
      .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.start - b.start);

    const open: Partial<Record<string, ScheduleIssue>> = {};
    const slotIssues: ScheduleIssue[] = [];
    for (const a of mine) {
      const v = blockedBySlot(student, a.day, a.start, settings);
      if (!v || v.code === "already_assigned" || v.code === "over_weekly_target" || v.code === "over_max_days") continue;
      const code = v.code as keyof typeof SLOT_LEVEL_TEXT;
      const key = `${code}-${a.day}`;
      const current = open[key];
      if (current && current.end === a.start) {
        current.end = a.start + settings.slotMinutes;
      } else {
        const issue: ScheduleIssue = {
          code,
          studentId: student.id,
          day: a.day,
          start: a.start,
          end: a.start + settings.slotMinutes,
          message: "",
          overridden: false,
        };
        open[key] = issue;
        slotIssues.push(issue);
      }
    }
    for (const issue of slotIssues) {
      const code = issue.code as keyof typeof SLOT_LEVEL_TEXT;
      issue.message = `${student.name} ${SLOT_LEVEL_TEXT[code]}: ${DAY_LABEL[issue.day!]} ${formatRange(issue.start!, issue.end!)}.`;
      issues.push(issue);
    }

    // A shift is judged as a whole: 9:00–10:00am is too short even though each box on its own is fine.
    for (const day of DAYS) {
      for (const run of shiftRuns(student.id, day, assignments, settings)) {
        if (run.end - run.start >= minShiftMinutes(settings)) continue;
        issues.push({
          code: "shift_too_short",
          studentId: student.id,
          day,
          start: run.start,
          end: run.end,
          message: `${student.name}'s shift on ${DAY_LABEL[day]} ${formatRange(run.start, run.end)} is too short. Shifts must be at least ${hoursLabel(minShiftMinutes(settings) / 60)}.`,
          overridden: false,
        });
      }
    }

    const overridden = mine.some((a) => a.override);
    const hours = assignedHours(student.id, assignments, settings);
    if (hours > weeklyLimit(settings)) {
      issues.push({
        code: "over_weekly_target",
        studentId: student.id,
        message: `${student.name} is scheduled ${hoursLabel(hours)}, over the weekly limit of ${hoursLabel(weeklyLimit(settings))}.`,
        overridden,
      });
    }
    const days = workedDayCount(student.id, assignments);
    if (days > student.daysPerWeek) {
      issues.push({
        code: "over_max_days",
        studentId: student.id,
        message: `${student.name} is scheduled on ${days} days but only works ${student.daysPerWeek} ${student.daysPerWeek === 1 ? "day" : "days"} a week.`,
        overridden,
      });
    }
    if (student.needsOpeningShift && !hasOpeningShift(student.id, assignments, settings)) {
      issues.push({
        code: "opening_shift_missing",
        studentId: student.id,
        message: `${student.name} still needs a ${formatMinutes(OPENING_SHIFT_START)} opening shift (at least 1 hour in a row).`,
        overridden: false,
      });
    }
  }
  return issues;
}

/** Only "error" issues should block publishing; overridden limits are warnings the manager chose. */
export function isBlockingIssue(issue: ScheduleIssue): boolean {
  return !issue.overridden;
}

export type SlotReason = ConstraintViolationCode | "available";

export type SlotAvailability = {
  student: Student;
  reason: SlotReason;
  /** Plain-language reason, written so a first-time user understands it. */
  text: string;
};

/**
 * For one time slot, says for every student whether they could work it and, if not,
 * why. This powers the "why is this gap still empty?" explanations.
 */
export function explainSlot(
  students: Student[],
  assignments: ShiftBlock[],
  settings: ScheduleSettings,
  day: Day,
  slotStart: Minutes,
): SlotAvailability[] {
  return students.map((student) => {
    if (isAssigned(student.id, day, slotStart, assignments)) {
      return { student, reason: "already_assigned", text: "already working" };
    }
    const slot = blockedBySlot(student, day, slotStart, settings);
    if (slot) {
      const text =
        slot.code === "class_conflict"
          ? "in class"
          : slot.code === "unavailable"
            ? "not available"
            : slot.code === "after_cutoff"
              ? "can't stay this late"
              : slot.code === "devotional"
                ? "devotional"
                : "on a break";
      return { student, reason: slot.code, text };
    }
    if (assignedHours(student.id, assignments, settings) >= weeklyLimit(settings)) {
      return { student, reason: "over_weekly_target", text: `already at ${hoursLabel(weeklyLimit(settings))}` };
    }
    if (!canUseDay(student, day, assignments, settings)) {
      return { student, reason: "over_max_days", text: `only works ${student.daysPerWeek} ${student.daysPerWeek === 1 ? "day" : "days"}` };
    }
    return { student, reason: "available", text: "free" };
  });
}

export type GapSuggestion = {
  student: Student;
  /** How many half-hour boxes of the gap this student can actually take. */
  slots: number;
  /** How many half-hour boxes the gap has in total. */
  total: number;
};

/**
 * Who could fill an empty stretch, best first. For each student it plays the stretch forward
 * one box at a time under every rule (class, break, cutoff, weekly hours, days per week), so
 * "Ana can take 3 of the 4 half-hours" is true, not a guess. Students who can't take any of it
 * are left out, and so is anyone who would end up with a shift shorter than the minimum shift length. Ties go to whoever has fewer hours so far, then roster order.
 */
export function suggestFillers(
  students: Student[],
  assignments: ShiftBlock[],
  settings: ScheduleSettings,
  day: Day,
  start: Minutes,
  end: Minutes,
  limit = 3,
): GapSuggestion[] {
  const total = Math.max(0, Math.round((end - start) / settings.slotMinutes));
  const out: (GapSuggestion & { hours: number; index: number })[] = [];
  students.forEach((student, index) => {
    let simulated = assignments;
    let slots = 0;
    for (let m = start; m < end; m += settings.slotMinutes) {
      if (isAssigned(student.id, day, m, simulated)) continue;
      if (canAssign(student, day, m, simulated, settings)) continue;
      simulated = [...simulated, { id: `sim-${student.id}-${day}-${m}`, studentId: student.id, day, start: m, source: "manual" }];
      slots++;
    }
    const leavesShortShift = shiftRuns(student.id, day, simulated, settings).some(
      (run) => run.end > start && run.start < end && run.end - run.start < minShiftMinutes(settings),
    );
    if (slots > 0 && !leavesShortShift) out.push({ student, slots, total, hours: assignedHours(student.id, assignments, settings), index });
  });
  return out
    .sort((a, b) => b.slots - a.slots || a.hours - b.hours || a.index - b.index)
    .slice(0, limit)
    .map(({ student, slots, total: t }) => ({ student, slots, total: t }));
}

/** One sentence explaining an empty slot: who could still take it, or why nobody can. */
export function describeGap(
  students: Student[],
  assignments: ShiftBlock[],
  settings: ScheduleSettings,
  day: Day,
  slotStart: Minutes,
): string {
  if (!students.length) return "Add a student worker to fill this.";
  const rows = explainSlot(students, assignments, settings, day, slotStart);
  const free = rows.filter((r) => r.reason === "available");
  if (free.length) {
    const names = free.slice(0, 3).map((r) => r.student.name);
    const more = free.length > 3 ? ` +${free.length - 3} more` : "";
    return `${names.join(", ")}${more} could work this. Click the slot to assign them.`;
  }
  const blockers = rows.filter((r) => r.reason !== "already_assigned").slice(0, 4);
  return `Nobody is free: ${blockers.map((r) => `${r.student.name} (${r.text})`).join(", ")}.`;
}
