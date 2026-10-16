import { describe, expect, it } from "vitest";
import { assignedHours, hasOpeningShift, shiftRuns, workedDayCount } from "../features/scheduling/availability";
import { mergeContiguousBlocks } from "../features/scheduling/blocks";
import { buildCoverageSlots, summarizeCoverage } from "../features/scheduling/coverage";
import { buildDemoData } from "../features/scheduling/demo-data";
import { findIssues } from "../features/scheduling/issues";
import { autoFill } from "../features/scheduling/scheduler";
import { makeSettings, makeStudent, run, slot } from "./testkit";

describe("autoFill on the sample roster", () => {
  const { students } = buildDemoData();
  const settings = makeSettings();
  const result = autoFill(students, [], settings);

  it("breaks no rule", () => {
    expect(findIssues(students, result.assignments, settings)).toEqual([]);
  });

  it("brings every student to their weekly hours", () => {
    for (const s of students) expect(assignedHours(s.id, result.assignments, settings), s.name).toBe(19);
    expect(result.unmet).toEqual([]);
  });

  it("reaches 19 for Troy by moving part of a shift someone else also covers", () => {
    // Troy (3 days, lunch at noon, 4pm cutoff) would otherwise stop at 18.5, because a 30-minute shift isn't allowed.
    expect(result.explanations.some((e) => /^Moved .* of Troy C\.'s .* shift \(someone else covers it\)/.test(e.reason))).toBe(true);
  });

  it("never makes a shift shorter than 2 hours, and leaves Tuesday devotional empty", () => {
    for (const s of students) {
      for (const day of ["mon", "tue", "wed", "thu", "fri"] as const) {
        for (const r of shiftRuns(s.id, day, result.assignments, settings)) expect(r.end - r.start, `${s.name} ${day}`).toBeGreaterThanOrEqual(120);
      }
    }
    expect(result.assignments.filter((a) => a.day === "tue" && a.start >= 11 * 60 && a.start < 12 * 60)).toEqual([]);
  });

  it("never exceeds a student's days per week", () => {
    for (const s of students) expect(workedDayCount(s.id, result.assignments)).toBeLessThanOrEqual(s.daysPerWeek);
  });

  it("covers every half hour when one person is needed", () => {
    const summary = summarizeCoverage(buildCoverageSlots(result.assignments, settings), settings);
    expect(summary.fullyStaffedPercent).toBe(100);
  });

  it("builds real shifts, not lone half-hours", () => {
    const blocks = mergeContiguousBlocks(result.assignments, settings.slotMinutes);
    expect(blocks.filter((b) => b.end - b.start === settings.slotMinutes)).toHaveLength(0);
    // most blocks are at least two hours long
    const long = blocks.filter((b) => b.end - b.start >= 120).length;
    expect(long / blocks.length).toBeGreaterThan(0.7);
  });

  it("gives Troy a real opening shift (7:00am, at least an hour in a row)", () => {
    expect(hasOpeningShift("s1", result.assignments, settings)).toBe(true);
    expect(result.openingShiftUnmet).toEqual([]);
  });

  it("explains every shift it added", () => {
    const explained = result.explanations.reduce((n, e) => n + (e.end - e.start) / settings.slotMinutes, 0);
    expect(explained).toBe(result.assignments.filter((a) => a.source === "autofill").length);
    expect(result.explanations.every((e) => e.reason.length > 10)).toBe(true);
  });

  it("is deterministic, ids included, and stable when run again", () => {
    expect(autoFill(students, [], settings)).toEqual(result);
    const again = autoFill(students, result.assignments, settings);
    expect(again.assignments).toEqual(result.assignments);
  });

  it("stays valid when two people are needed at once", () => {
    const two = makeSettings({ minStaffPerSlot: 2 });
    const r = autoFill(students, [], two);
    expect(findIssues(students, r.assignments, two)).toEqual([]);
    for (const s of students) expect(assignedHours(s.id, r.assignments, two)).toBeLessThanOrEqual(19);
  });
});

describe("autoFill during a semester break", () => {
  const { students } = buildDemoData();
  const settings = makeSettings({ term: "break" });
  const result = autoFill(students, [], settings);

  it("aims for 40 hours each, breaking no rule", () => {
    expect(findIssues(students, result.assignments, settings)).toEqual([]);
    for (const s of students) {
      // Troy only works 3 days and must leave by 4pm, so 25.5 hours is the most he can do.
      expect(assignedHours(s.id, result.assignments, settings), s.name).toBe(s.name === "Troy C." ? 25.5 : 40);
    }
    expect(result.unmet.map((u) => u.studentId)).toEqual(["s1"]);
    expect(result.unmet[0].reason).toMatch(/only 25\.5 of 40 hours/);
  });
});

describe("autoFill rules", () => {
  const settings = makeSettings({ openTime: 8 * 60, closeTime: 12 * 60, weeklyTargetHours: 4 });

  it("never places anyone during a class", () => {
    const student = makeStudent({ busy: [{ day: "mon", start: 8 * 60, end: 9 * 60, source: "class" }] });
    const r = autoFill([student], [], settings);
    expect(r.assignments.some((a) => a.day === "mon" && a.start >= 8 * 60 && a.start < 9 * 60)).toBe(false);
  });

  it("respects a cutoff and lunch", () => {
    const student = makeStudent({ latestEnd: 10 * 60, breaks: [{ start: 9 * 60, minutes: 30 }] });
    const r = autoFill([student], [], settings);
    expect(findIssues([student], r.assignments, settings)).toEqual([]);
    expect(r.assignments.every((a) => a.start + 30 <= 10 * 60 && a.start !== 9 * 60)).toBe(true);
  });

  it("keeps manual shifts, and rebuild only replaces automatic ones", () => {
    const student = makeStudent();
    const manual = run("s1", "fri", 8 * 60, 9 * 60);
    const first = autoFill([student], manual, settings);
    expect(manual.every((m) => first.assignments.some((a) => a.id === m.id))).toBe(true);
    const rebuilt = autoFill([student], first.assignments, settings, { replaceAutoFilled: true });
    expect(manual.every((m) => rebuilt.assignments.some((a) => a.id === m.id))).toBe(true);
    expect(rebuilt.assignments).toEqual(first.assignments);
  });

  it("does not exceed the weekly hours even with existing manual shifts", () => {
    const student = makeStudent();
    const r = autoFill([student], run("s1", "mon", 8 * 60, 11 * 60), settings);
    expect(assignedHours("s1", r.assignments, settings)).toBeLessThanOrEqual(settings.weeklyTargetHours);
  });

  it("reports, in plain words, when the target can't be reached", () => {
    const student = makeStudent({ latestEnd: 10 * 60, daysPerWeek: 1 });
    const r = autoFill([student], [], makeSettings({ openTime: 8 * 60, closeTime: 12 * 60, weeklyTargetHours: 10 }));
    expect(r.unmet).toHaveLength(1);
    expect(r.unmet[0].reason).toMatch(/only 2 of 10 hours/);
  });

  it("is a no-op with nobody to schedule", () => {
    expect(autoFill([], [], settings).assignments).toEqual([]);
  });

  it("respects a one-day-a-week limit", () => {
    const student = makeStudent({ daysPerWeek: 1 });
    const r = autoFill([student], [], makeSettings({ weeklyTargetHours: 6 }));
    expect(workedDayCount("s1", r.assignments)).toBe(1);
  });
});

describe("required opening shift", () => {
  it("places a real block starting at 7:00am", () => {
    const student = makeStudent({ needsOpeningShift: true });
    const settings = makeSettings({ closeTime: 12 * 60 });
    const r = autoFill([student], [], settings);
    expect(hasOpeningShift("s1", r.assignments, settings)).toBe(true);
    const opening = r.explanations.find((e) => e.phase === "opening")!;
    expect(opening.start).toBe(7 * 60);
    expect(opening.end - opening.start).toBeGreaterThanOrEqual(60);
  });

  it("is not satisfied by a single half hour", () => {
    expect(hasOpeningShift("s1", [slot("s1", "mon", 7 * 60)], makeSettings())).toBe(false);
    expect(hasOpeningShift("s1", run("s1", "mon", 7 * 60, 8 * 60), makeSettings())).toBe(true);
  });

  it("says clearly why it can't be placed when the office opens at 8:00am", () => {
    const student = makeStudent({ needsOpeningShift: true });
    const r = autoFill([student], [], makeSettings({ openTime: 8 * 60 }));
    expect(r.openingShiftUnmet).toHaveLength(1);
    expect(r.openingShiftUnmet[0].reason).toMatch(/opens at 8:00am/);
  });

  it("explains when a class blocks every day", () => {
    const busy = (["mon", "tue", "wed", "thu", "fri"] as const).map((day) => ({ day, start: 7 * 60, end: 8 * 60, source: "class" as const }));
    const student = makeStudent({ needsOpeningShift: true, busy });
    const r = autoFill([student], [], makeSettings());
    expect(r.openingShiftUnmet[0].reason).toMatch(/2 hours free in a row/);
  });

  it("keeps a 7:00am shift counted toward hours when the view starts at 8:00am", () => {
    const shifts = run("s1", "mon", 7 * 60, 9 * 60);
    expect(assignedHours("s1", shifts, makeSettings({ openTime: 8 * 60 }))).toBe(2);
    expect(hasOpeningShift("s1", shifts, makeSettings({ openTime: 8 * 60 }))).toBe(true);
  });
});
