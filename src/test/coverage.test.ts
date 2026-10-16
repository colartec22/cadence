import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../features/scheduling/constants";
import { buildCoverageSlots, buildGapRanges, summarizeCoverage } from "../features/scheduling/coverage";
import type { ScheduleSettings, ShiftBlock } from "../features/scheduling/types";

// A Monday–Friday office open 9–11am: small enough to count by hand.
const settings: ScheduleSettings = { ...DEFAULT_SETTINGS, openTime: 9 * 60, closeTime: 11 * 60, minStaffPerSlot: 1, openDays: "mon-fri" };

describe("gap ranges", () => {
  it("merges consecutive same-day gap slots into one range", () => {
    // Nothing staffed anywhere -> every slot on every day is a gap. Monday's four
    // slots (9:00, 9:30, 10:00, 10:30) should merge into a single 9:00-11:00 range.
    const coverage = buildCoverageSlots([], settings);
    const ranges = buildGapRanges(coverage);
    const monday = ranges.filter((r) => r.day === "mon");
    expect(monday.length).toBe(1);
    expect(monday[0]).toMatchObject({ start: 9 * 60, end: 11 * 60 });
  });

  it("does not merge non-consecutive gaps on the same day", () => {
    const assignments: ShiftBlock[] = [{ id: "a1", studentId: "s1", day: "mon", start: 9 * 60 + 30, source: "manual" }];
    const coverage = buildCoverageSlots(assignments, settings);
    const ranges = buildGapRanges(coverage);
    const monday = ranges.filter((r) => r.day === "mon");
    expect(monday.length).toBe(2);
    expect(monday[0]).toMatchObject({ start: 9 * 60, end: 9 * 60 + 30 });
    expect(monday[1]).toMatchObject({ start: 10 * 60, end: 11 * 60 });
  });

  it("groups correctly across multiple days independently (day-major ordering)", () => {
    // Regression test for the original bug: iterating time-major/day-minor while
    // merging on day+time adjacency meant same-day consecutive gaps were almost
    // never adjacent in the array, so they never merged.
    const coverage = buildCoverageSlots([], settings);
    const ranges = buildGapRanges(coverage);
    expect(ranges.length).toBe(5); // one merged range per day
  });

  it("counts Saturday only when the office is open on Saturdays", () => {
    expect(buildGapRanges(buildCoverageSlots([], { ...settings, openDays: "mon-sat" })).map((r) => r.day)).toEqual(["mon", "tue", "wed", "thu", "fri", "sat"]);
    // Older saved schedules have no openDays at all: they stay Monday to Friday.
    expect(buildGapRanges(buildCoverageSlots([], { ...settings, openDays: undefined })).map((r) => r.day)).not.toContain("sat");
  });
});

describe("minimum staffing of 2", () => {
  const twoSettings: ScheduleSettings = { ...settings, minStaffPerSlot: 2 };

  it("treats a slot with 1 of 2 required as a gap with shortfall 1", () => {
    const assignments: ShiftBlock[] = [{ id: "a1", studentId: "s1", day: "mon", start: 9 * 60, source: "manual" }];
    const coverage = buildCoverageSlots(assignments, twoSettings);
    const slot = coverage.find((s) => s.day === "mon" && s.start === 9 * 60)!;
    expect(slot.fullyStaffed).toBe(false);
    const ranges = buildGapRanges(coverage);
    expect(ranges[0].shortfall).toBe(1);
  });
});

describe("coverage percentages are distinct and correct", () => {
  it("fully-staffed % and demand-fulfilled % diverge when minStaff is 2 and only 1 is ever assigned", () => {
    const twoSettings: ScheduleSettings = { ...settings, minStaffPerSlot: 2 };
    const assignments: ShiftBlock[] = ["mon", "tue", "wed", "thu", "fri"].flatMap((day, i) => [
      { id: `a${i}-1`, studentId: "s1", day: day as ShiftBlock["day"], start: 9 * 60, source: "manual" as const },
    ]);
    const coverage = buildCoverageSlots(assignments, twoSettings);
    const summary = summarizeCoverage(coverage, twoSettings);
    expect(summary.fullyStaffedPercent).toBe(0); // no slot ever reaches 2
    expect(summary.demandFulfilledPercent).toBeGreaterThan(0); // but half the demand at those slots is met
    expect(summary.fullyStaffedPercent).not.toBe(summary.demandFulfilledPercent);
  });

  it("labels the theoretical staffing minimum honestly as ignoring availability", () => {
    const coverage = buildCoverageSlots([], settings);
    const summary = summarizeCoverage(coverage, settings);
    // 5 days x 4 slots x 30 min x 1 staff = 10 labor-hours, independent of any student
    expect(summary.theoreticalStaffingHours).toBe(10);
  });
});
