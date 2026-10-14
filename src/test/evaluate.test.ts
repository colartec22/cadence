import { describe, expect, it } from "vitest";
import { evaluateSchedule } from "../features/scheduling/evaluate";
import { makeSettings, makeStudent, run } from "./testkit";

// The app now stays open until midnight by default; these tests pin the shorter 7:00am-5:00pm day so the
// numbers stay small enough to check by hand. The term is "semester", so Tuesday devotional (11am-12pm) is closed.
const settings = makeSettings({ closeTime: 17 * 60 }); // 30-minute boxes, 1 person needed, 19-hour weekly target

describe("evaluateSchedule: the one-call report", () => {
  it("counts every missing staff-hour when nobody is scheduled (5 days x 10 hours, minus the devotional hour = 49)", () => {
    const report = evaluateSchedule([makeStudent()], [], settings);
    expect(report.uncoveredStaffHours).toBe(49);
    expect(report.ok).toBe(true); // an empty schedule breaks no rule, it is just empty
    expect(report.gaps.length).toBeGreaterThan(0);
  });

  it("counts each missing PERSON, not just each empty box, when 2 people are needed", () => {
    // 100 boxes, minus the 2 devotional boxes = 98. Times 2 people needed = 196 person-boxes.
    // One student covers 2 boxes (1 hour), so 194 are missing = 97 hours.
    const two = makeSettings({ closeTime: 17 * 60, minStaffPerSlot: 2 });
    const report = evaluateSchedule([makeStudent()], run("s1", "mon", 8 * 60, 9 * 60), two);
    expect(report.uncoveredStaffHours).toBe(97);
    expect(report.coverage.fullyStaffedSlots).toBe(0);
  });

  it("reports zero missing hours when the schedule is completely covered", () => {
    const tiny = makeSettings({ openTime: 8 * 60, closeTime: 9 * 60 });
    const everyDay = (["mon", "tue", "wed", "thu", "fri"] as const).flatMap((d) => run("s1", d, 8 * 60, 9 * 60));
    expect(evaluateSchedule([makeStudent()], everyDay, tiny).uncoveredStaffHours).toBe(0);
  });

  it("is not ok when a shift sits on a class, and says which student and when", () => {
    const student = makeStudent({ busy: [{ day: "mon", start: 9 * 60, end: 9 * 60 + 50, source: "class" }] });
    const report = evaluateSchedule([student], run("s1", "mon", 9 * 60, 10 * 60), settings);
    expect(report.ok).toBe(false);
    expect(report.blockingIssues[0]).toMatchObject({ code: "class_conflict", studentId: "s1", day: "mon" });
  });

  it("treats a limit the manager knowingly passed as a warning, not a blocker", () => {
    // 20 hours on Monday and Wednesday is over the 19-hour target; one shift is marked as an override.
    // (Wednesday, not Tuesday: a Tuesday 7am-5pm shift would cross devotional, which is a real blocker.)
    const shifts = [...run("s1", "mon", 7 * 60, 17 * 60), ...run("s1", "wed", 7 * 60, 17 * 60)].map((s, i) => (i === 0 ? { ...s, override: true } : s));
    const report = evaluateSchedule([makeStudent()], shifts, settings);
    expect(report.ok).toBe(true);
    expect(report.blockingIssues).toEqual([]);
    expect(report.overriddenWarnings.some((w) => w.code === "over_weekly_target")).toBe(true);
  });

  it("lists students who still need a real opening shift, and stops listing them once they have one", () => {
    const opener = makeStudent({ id: "s1", name: "Noa K.", needsOpeningShift: true });
    expect(evaluateSchedule([opener], [], settings).openingShiftMissing).toEqual([{ studentId: "s1", name: "Noa K." }]);
    expect(evaluateSchedule([opener], run("s1", "mon", 7 * 60, 8 * 60), settings).openingShiftMissing).toEqual([]);
    // A single lone half hour at 7:00 is not a real opening shift.
    expect(evaluateSchedule([opener], run("s1", "mon", 7 * 60, 7 * 60 + 30), settings).openingShiftMissing).toHaveLength(1);
  });

  it("reports each student's hours and whether they reached the weekly target", () => {
    const report = evaluateSchedule([makeStudent({ id: "a", name: "Ana" }), makeStudent({ id: "b", name: "Bo" })], run("a", "mon", 7 * 60, 17 * 60), settings);
    expect(report.students).toEqual([
      { studentId: "a", name: "Ana", hours: 10, atTarget: false },
      { studentId: "b", name: "Bo", hours: 0, atTarget: false },
    ]);
  });

  it("gives the same version for the same shifts, whatever order they are listed in", () => {
    const a = run("s1", "mon", 8 * 60, 10 * 60);
    expect(evaluateSchedule([makeStudent()], a, settings).scheduleVersion).toBe(evaluateSchedule([makeStudent()], [...a].reverse(), settings).scheduleVersion);
  });
});
