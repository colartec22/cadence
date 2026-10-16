import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../features/scheduling/constants";
import { assignedHours, blockedBySlot, canAssign, canUseDay, hasOpeningShift } from "../features/scheduling/availability";
import { autoFill } from "../features/scheduling/scheduler";
import type { ScheduleSettings, ShiftBlock } from "../features/scheduling/types";
import { makeStudent } from "./testkit";

/**
 * Tests for the core "can this student work this half hour?" rules (`availability.ts`): classes,
 * blocked times, cutoffs, breaks, weekly hours and days per week, plus a few auto-fill checks.
 */

describe("blockedBySlot / canAssign — hard constraints", () => {
  it("blocks a slot that overlaps a class", () => {
    const student = makeStudent({ busy: [{ day: "mon", start: 9 * 60, end: 9 * 60 + 15, source: "class" }] });
    const violation = blockedBySlot(student, "mon", 9 * 60, DEFAULT_SETTINGS);
    expect(violation?.code).toBe("class_conflict");
  });

  it("a 9:00-9:15 class blocks the 9:00-9:30 slot even though the class ends before the slot does", () => {
    const student = makeStudent({ busy: [{ day: "mon", start: 9 * 60, end: 9 * 60 + 15, source: "class" }] });
    expect(blockedBySlot(student, "mon", 9 * 60, DEFAULT_SETTINGS)).not.toBeNull();
  });

  it("enforces the cutoff time", () => {
    const student = makeStudent({ latestEnd: 15 * 60 });
    expect(blockedBySlot(student, "mon", 15 * 60, DEFAULT_SETTINGS)?.code).toBe("after_cutoff");
    expect(blockedBySlot(student, "mon", 14 * 60 + 30, DEFAULT_SETTINGS)).toBeNull();
  });

  it("enforces a break", () => {
    const student = makeStudent({ breaks: [{ start: 12 * 60, minutes: 30 }] });
    expect(blockedBySlot(student, "mon", 12 * 60, DEFAULT_SETTINGS)?.code).toBe("break_conflict");
    expect(blockedBySlot(student, "mon", 12 * 60 + 30, DEFAULT_SETTINGS)).toBeNull();
  });

  it("blocks every half hour a break touches, whatever its length", () => {
    const short = makeStudent({ breaks: [{ start: 10 * 60, minutes: 15 }] });
    expect(blockedBySlot(short, "mon", 10 * 60, DEFAULT_SETTINGS)?.code).toBe("break_conflict"); // 10:00–10:15 is inside 10:00–10:30
    expect(blockedBySlot(short, "mon", 10 * 60 + 30, DEFAULT_SETTINGS)).toBeNull();
    const long = makeStudent({ breaks: [{ start: 12 * 60, minutes: 60 }] });
    expect(blockedBySlot(long, "mon", 12 * 60 + 30, DEFAULT_SETTINGS)?.message).toMatch(/break at 12:00pm–1:00pm/);
    expect(blockedBySlot(long, "mon", 13 * 60, DEFAULT_SETTINGS)).toBeNull();
    const offGrid = makeStudent({ breaks: [{ start: 10 * 60 + 15, minutes: 30 }] }); // 10:15–10:45 touches two boxes
    expect(blockedBySlot(offGrid, "mon", 10 * 60, DEFAULT_SETTINGS)?.code).toBe("break_conflict");
    expect(blockedBySlot(offGrid, "mon", 10 * 60 + 30, DEFAULT_SETTINGS)?.code).toBe("break_conflict");
  });

  it("handles several breaks a day", () => {
    const student = makeStudent({ breaks: [{ start: 10 * 60, minutes: 15 }, { start: 13 * 60, minutes: 30 }] });
    expect(blockedBySlot(student, "wed", 10 * 60, DEFAULT_SETTINGS)?.code).toBe("break_conflict");
    expect(blockedBySlot(student, "wed", 13 * 60, DEFAULT_SETTINGS)?.code).toBe("break_conflict");
    expect(blockedBySlot(student, "wed", 11 * 60, DEFAULT_SETTINGS)).toBeNull();
  });

  it("enforces max work days", () => {
    const student = makeStudent({ daysPerWeek: 1 });
    const assignments: ShiftBlock[] = [{ id: "a1", studentId: "s1", day: "mon", start: 9 * 60, source: "manual" }];
    expect(canUseDay(student, "tue", assignments, DEFAULT_SETTINGS)).toBe(false);
    expect(canAssign(student, "tue", 9 * 60, assignments, DEFAULT_SETTINGS)?.code).toBe("over_max_days");
  });
});

describe("assignedHours — must include hidden/non-visible assignments", () => {
  it("counts a 7am assignment toward the weekly cap even when the visible window starts at 8am", () => {
    const settingsAt7: ScheduleSettings = { ...DEFAULT_SETTINGS, openTime: 7 * 60 };
    const settingsAt8: ScheduleSettings = { ...DEFAULT_SETTINGS, openTime: 8 * 60 };
    const assignments: ShiftBlock[] = [{ id: "a1", studentId: "s1", day: "mon", start: 7 * 60, source: "manual" }];
    // Hours must be identical regardless of which open-hours view is active —
    // the prototype this replaces filtered hours by the visible window, so
    // switching to 8am made a real 7am assignment invisible AND uncounted.
    expect(assignedHours("s1", assignments, settingsAt7)).toBe(assignedHours("s1", assignments, settingsAt8));
    expect(assignedHours("s1", assignments, settingsAt8)).toBe(0.5);
  });

  it("blocks new assignments once the weekly target is reached, counting all assignments not just visible ones", () => {
    const student = makeStudent();
    const settings: ScheduleSettings = { ...DEFAULT_SETTINGS, openTime: 8 * 60, weeklyTargetHours: 0.5 };
    const assignments: ShiftBlock[] = [{ id: "a1", studentId: "s1", day: "mon", start: 7 * 60, source: "manual" }];
    expect(canAssign(student, "tue", 8 * 60, assignments, settings)?.code).toBe("over_weekly_target");
  });
});

describe("hasOpeningShift — a real contiguous shift, not one slot", () => {
  it("is false for a single 30-minute assignment at the opening time", () => {
    const assignments: ShiftBlock[] = [{ id: "a1", studentId: "s1", day: "mon", start: DEFAULT_SETTINGS.openTime, source: "manual" }];
    expect(hasOpeningShift("s1", assignments, DEFAULT_SETTINGS)).toBe(false);
  });

  it("is true once enough contiguous slots from opening time are assigned", () => {
    const assignments: ShiftBlock[] = [
      { id: "a1", studentId: "s1", day: "mon", start: DEFAULT_SETTINGS.openTime, source: "manual" },
      { id: "a2", studentId: "s1", day: "mon", start: DEFAULT_SETTINGS.openTime + 30, source: "manual" },
    ];
    expect(hasOpeningShift("s1", assignments, DEFAULT_SETTINGS)).toBe(true);
  });
});

describe("autoFill", () => {
  const settings: ScheduleSettings = { ...DEFAULT_SETTINGS, openTime: 8 * 60, closeTime: 12 * 60, minStaffPerSlot: 1, weeklyTargetHours: 2 };

  it("is deterministic for the same input", () => {
    const students = [makeStudent({ id: "s1", name: "A" }), makeStudent({ id: "s2", name: "B" })];
    const first = autoFill(students, [], settings);
    const second = autoFill(students, [], settings);
    expect(first.assignments).toEqual(second.assignments);
  });

  it("never assigns a student during a class", () => {
    const student = makeStudent({ busy: [{ day: "mon", start: 8 * 60, end: 9 * 60, source: "class" }] });
    const result = autoFill([student], [], settings);
    const duringClass = result.assignments.some((a) => a.day === "mon" && a.start >= 8 * 60 && a.start < 9 * 60);
    expect(duringClass).toBe(false);
  });

  it("keeps existing manual assignments unless the manager removes them", () => {
    const student = makeStudent();
    const manual: ShiftBlock[] = [{ id: "m1", studentId: "s1", day: "mon", start: 8 * 60, source: "manual" }];
    const result = autoFill([student], manual, settings);
    expect(result.assignments.some((a) => a.id === "m1" || (a.day === "mon" && a.start === 8 * 60 && a.studentId === "s1"))).toBe(true);
  });

  it("returns explicit unmet constraints when full coverage/target hours are impossible", () => {
    const impossible = makeStudent({ latestEnd: 8 * 60 + 30 }); // only one usable slot per day
    const tinySettings: ScheduleSettings = { ...settings, weeklyTargetHours: 10 };
    const result = autoFill([impossible], [], tinySettings);
    expect(result.unmet.length).toBeGreaterThan(0);
  });

  it("satisfies a required opening shift with a real contiguous block when possible", () => {
    const student = makeStudent({ needsOpeningShift: true });
    const openSettings: ScheduleSettings = { ...settings, openTime: 7 * 60, closeTime: 12 * 60 };
    const result = autoFill([student], [], openSettings);
    expect(result.openingShiftUnmet).toEqual([]);
    expect(hasOpeningShift("s1", result.assignments, openSettings)).toBe(true);
  });
});
