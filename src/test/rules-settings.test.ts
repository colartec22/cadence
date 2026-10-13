import { describe, expect, it } from "vitest";
import { studentsMissingOpeningShift } from "../features/scheduling/availability";
import { buildCoverageSlots, uncoveredStaffHours } from "../features/scheduling/coverage";
import { evaluateSchedule } from "../features/scheduling/evaluate";
import { findIssues } from "../features/scheduling/issues";
import { autoFill } from "../features/scheduling/scheduler";
import { breakLimit, minShiftMinutes, weeklyLimit } from "../features/scheduling/term";
import { validatePersistedState } from "../features/scheduling/validation";
import { makeSettings, makeStudent, run } from "./testkit";

/**
 * Tests for the two office rules a manager can now change in the Rules dialog (the weekly hour limit
 * during a break, and the shortest shift allowed), and for the two "Schedule health" numbers
 * (hours still missing, opening shifts missing) that share their code with the server check.
 */

describe("break hour limit and shortest shift: defaults and overrides", () => {
  it("use the standard 40 hours and 2 hours when nothing is chosen", () => {
    const settings = makeSettings();
    expect(breakLimit(settings)).toBe(40);
    expect(minShiftMinutes(settings)).toBe(120);
  });

  it("use the manager's choice when there is one, and only the break limit changes the break week", () => {
    const settings = makeSettings({ term: "break", breakWeeklyHours: 30, minShiftHours: 1 });
    expect(weeklyLimit(settings)).toBe(30);
    expect(minShiftMinutes(settings)).toBe(60);
    expect(weeklyLimit({ ...settings, term: "semester" })).toBe(settings.weeklyTargetHours);
  });
});

describe("saved settings validation for the new rules", () => {
  const base = { version: 1, students: [], assignments: [], semester: null, selectedStudentId: null };

  it("keeps good values, leaves them out when absent, and rejects silly ones", () => {
    const good = validatePersistedState({ ...base, settings: { ...makeSettings(), breakWeeklyHours: 30.5, minShiftHours: 1.5 } });
    expect(good.ok && good.value.settings.breakWeeklyHours).toBe(30.5);
    expect(good.ok && good.value.settings.minShiftHours).toBe(1.5);

    const absent = validatePersistedState({ ...base, settings: makeSettings() });
    expect(absent.ok && "breakWeeklyHours" in absent.value.settings).toBe(false);

    for (const bad of [{ breakWeeklyHours: 0 }, { breakWeeklyHours: 41 }, { breakWeeklyHours: 20.3 }, { breakWeeklyHours: "40" }, { minShiftHours: 0 }, { minShiftHours: 5 }, { minShiftHours: 1.2 }]) {
      expect(validatePersistedState({ ...base, settings: { ...makeSettings(), ...bad } }).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("the rules really follow the new settings", () => {
  const student = makeStudent({ id: "s1", name: "Noa K." });
  const oneHour = run("s1", "mon", 9 * 60, 10 * 60);

  it("a 1-hour shift is a problem at the standard 2 hours, but fine once the shortest shift is 1 hour", () => {
    expect(findIssues([student], oneHour, makeSettings()).some((i) => i.code === "shift_too_short")).toBe(true);
    expect(findIssues([student], oneHour, makeSettings({ minShiftHours: 1 })).some((i) => i.code === "shift_too_short")).toBe(false);
  });

  it("the problem message names the chosen minimum", () => {
    const message = findIssues([student], oneHour, makeSettings({ minShiftHours: 3 })).find((i) => i.code === "shift_too_short")?.message;
    expect(message).toMatch(/at least 3 hours/);
  });

  it("auto-fill never makes a shift shorter than the chosen minimum", () => {
    const settings = makeSettings({ minShiftHours: 3 });
    const { assignments } = autoFill([student], [], settings);
    expect(findIssues([student], assignments, settings).filter((i) => i.code === "shift_too_short")).toEqual([]);
  });

  it("auto-fill stops at the chosen break limit", () => {
    const settings = makeSettings({ term: "break", breakWeeklyHours: 25 });
    const { assignments } = autoFill([student], [], settings);
    expect(assignments.length * (settings.slotMinutes / 60)).toBeLessThanOrEqual(25);
  });
});

describe("Schedule health numbers shared with the server check", () => {
  it("hours still missing and missing opening shifts match the full report", () => {
    const students = [makeStudent({ id: "s1", name: "Noa K.", needsOpeningShift: true }), makeStudent({ id: "s2", name: "Lea P." })];
    const assignments = run("s2", "mon", 8 * 60, 10 * 60);
    const settings = makeSettings({ minStaffPerSlot: 2 });
    const report = evaluateSchedule(students, assignments, settings);
    expect(uncoveredStaffHours(buildCoverageSlots(assignments, settings), settings)).toBe(report.uncoveredStaffHours);
    expect(report.uncoveredStaffHours).toBeGreaterThan(0);
    expect(studentsMissingOpeningShift(students, assignments, settings)).toEqual(report.openingShiftMissing);
    expect(report.openingShiftMissing.map((s) => s.name)).toEqual(["Noa K."]);
  });
});
