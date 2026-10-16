import { describe, expect, it } from "vitest";
import { describeGap, explainSlot, findIssues, isBlockingIssue } from "../features/scheduling/issues";
import { makeSettings, makeStudent, run, slot } from "./testkit";

/**
 * Tests for rule-problem finding (`features/scheduling/issues.ts`): a shift on top of a class, over
 * the weekly hours, and so on, merged into readable messages, plus the per-box explanations.
 */

const settings = makeSettings();

describe("findIssues", () => {
  it("finds nothing in a clean schedule", () => {
    const s = makeStudent();
    expect(findIssues([s], run("s1", "mon", 9 * 60, 11 * 60), settings)).toEqual([]);
  });

  it("merges consecutive class-conflict slots into one readable issue", () => {
    const s = makeStudent({ name: "Troy", busy: [{ day: "mon", start: 9 * 60, end: 10 * 60 + 30, source: "class" }] });
    const issues = findIssues([s], run("s1", "mon", 9 * 60, 11 * 60), settings);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "class_conflict", day: "mon", start: 540, end: 630, overridden: false });
    expect(issues[0].message).toBe("Troy has a class then: Mon 9:00am–10:30am.");
  });

  it("catches a shift left behind after a student's class times change", () => {
    const before = makeStudent();
    const shifts = run("s1", "tue", 8 * 60, 10 * 60);
    expect(findIssues([before], shifts, settings)).toEqual([]);
    const after = makeStudent({ busy: [{ day: "tue", start: 8 * 60, end: 9 * 60, source: "class" }] });
    expect(findIssues([after], shifts, settings)).toHaveLength(1);
  });

  it("flags cutoff and break problems separately", () => {
    const s = makeStudent({ latestEnd: 12 * 60, breaks: [{ start: 10 * 60, minutes: 30 }] });
    const codes = findIssues([s], run("s1", "mon", 10 * 60, 12 * 60 + 30), settings).map((i) => i.code);
    expect(codes.sort()).toEqual(["after_cutoff", "break_conflict"]);
  });

  it("flags going over the weekly hours and treats an override as a warning, not a blocker", () => {
    const s = makeStudent({ name: "Ana" });
    const tight = makeSettings({ weeklyTargetHours: 1 });
    const shifts = run("s1", "mon", 9 * 60, 11 * 60);
    const plain = findIssues([s], shifts, tight);
    expect(plain.map((i) => i.code)).toEqual(["over_weekly_target"]);
    expect(plain.every(isBlockingIssue)).toBe(true);

    const overridden = shifts.map((a) => ({ ...a, override: true }));
    const issues = findIssues([s], overridden, tight);
    expect(issues[0].overridden).toBe(true);
    expect(issues.some(isBlockingIssue)).toBe(false);
  });

  it("flags too many work days", () => {
    const s = makeStudent({ daysPerWeek: 1 });
    const issues = findIssues([s], [...run("s1", "mon", 9 * 60, 11 * 60), ...run("s1", "tue", 9 * 60, 11 * 60)], settings);
    expect(issues.map((i) => i.code)).toEqual(["over_max_days"]);
  });

  it("flags a missing opening shift, but not once it exists", () => {
    const s = makeStudent({ needsOpeningShift: true });
    expect(findIssues([s], [], settings).map((i) => i.code)).toEqual(["opening_shift_missing"]);
    expect(findIssues([s], run("s1", "mon", 7 * 60, 9 * 60), settings)).toEqual([]);
  });

  it("flags a shift shorter than 2 hours as a problem, judging the whole shift", () => {
    const s = makeStudent({ name: "Ana" });
    const issues = findIssues([s], run("s1", "mon", 9 * 60, 10 * 60 + 30), settings);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "shift_too_short", day: "mon", start: 540, end: 630, overridden: false });
    expect(issues[0].message).toBe("Ana's shift on Mon 9:00am–10:30am is too short. Shifts must be at least 2 hours.");
    expect(isBlockingIssue(issues[0])).toBe(true);
    // Two separate 2-hour shifts on one day are both fine.
    expect(findIssues([s], [...run("s1", "mon", 8 * 60, 10 * 60), ...run("s1", "mon", 13 * 60, 15 * 60)], settings)).toEqual([]);
  });

  it("flags Tuesday devotional during the semester, but not during a break", () => {
    const s = makeStudent({ name: "Ana" });
    const shifts = run("s1", "tue", 10 * 60, 12 * 60);
    const semester = findIssues([s], shifts, settings);
    expect(semester.map((i) => i.code)).toEqual(["devotional"]);
    expect(semester[0].message).toBe("Ana is scheduled during Tuesday devotional: Tue 11:00am–12:00pm.");
    expect(findIssues([s], shifts, makeSettings({ term: "break" }))).toEqual([]);
  });

  it("allows up to 40 hours a week during a break", () => {
    const s = makeStudent();
    const days = ["mon", "tue", "wed", "thu", "fri"] as const;
    const thirtyHours = days.flatMap((d) => run("s1", d, 8 * 60, 14 * 60));
    expect(findIssues([s], thirtyHours, settings).map((i) => i.code)).toEqual(["devotional", "over_weekly_target"]);
    expect(findIssues([s], thirtyHours, makeSettings({ term: "break" }))).toEqual([]);
  });

  it("ignores shifts that belong to students who no longer exist", () => {
    expect(findIssues([makeStudent()], [slot("ghost", "mon", 9 * 60)], settings)).toEqual([]);
  });
});

describe("explaining empty times", () => {
  const troy = makeStudent({ id: "a", name: "Troy", busy: [{ day: "mon", start: 9 * 60, end: 10 * 60, source: "class" }] });
  const ana = makeStudent({ id: "b", name: "Ana" });

  it("says who could still cover a gap", () => {
    const text = describeGap([troy, ana], [], settings, "mon", 9 * 60);
    expect(text).toContain("Ana");
    expect(text).not.toContain("Troy");
    expect(text).toMatch(/could work this/);
  });

  it("says why nobody can when everyone is blocked", () => {
    const text = describeGap([troy], [], settings, "mon", 9 * 60);
    expect(text).toBe("Nobody is free: Troy (in class).");
  });

  it("says devotional when Tuesday 11am is closed", () => {
    expect(explainSlot([ana], [], settings, "tue", 11 * 60).map((r) => r.text)).toEqual(["devotional"]);
    expect(explainSlot([ana], [], makeSettings({ term: "break" }), "tue", 11 * 60).map((r) => r.text)).toEqual(["free"]);
  });

  it("uses plain reasons for every kind of block", () => {
    const rows = explainSlot(
      [
        makeStudent({ id: "1", latestEnd: 8 * 60 }),
        makeStudent({ id: "2", breaks: [{ start: 9 * 60, minutes: 30 }] }),
        makeStudent({ id: "3", daysPerWeek: 1 }),
      ],
      [slot("3", "tue", 9 * 60)],
      settings,
      "mon",
      9 * 60,
    );
    expect(rows.map((r) => r.text)).toEqual(["can't stay this late", "on a break", "only works 1 day"]);
  });

  it("handles an empty roster kindly", () => {
    expect(describeGap([], [], settings, "mon", 9 * 60)).toMatch(/Add a student/);
  });
});
