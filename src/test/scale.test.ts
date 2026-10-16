import { describe, expect, it } from "vitest";
import { assignedHours } from "../features/scheduling/availability";
import { findIssues } from "../features/scheduling/issues";
import { autoFill } from "../features/scheduling/scheduler";
import { buildBusy } from "../features/scheduling/parser";
import { makeSettings, makeStudent } from "./testkit";
import type { Student } from "../features/scheduling/types";

/**
 * Stress tests: auto-fill on large, randomly made rosters (up to the 200-student limit) must still
 * break no rule and finish quickly. The "random" numbers come from a fixed seed, so every run
 * builds exactly the same rosters and a failure can always be reproduced.
 */

/** A small deterministic random generator so this test is reproducible. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const PATTERNS = ["MWF", "TTh", "MW", "TR", "MWF", "TTh"];
const HOURS = ["8:00-8:50", "9:00-9:50", "10:00-10:50", "11:00-11:50", "1:00pm-1:50pm", "2:00pm-2:50pm", "3:00pm-3:50pm"];

/** `n` made-up students, each with 3-5 random class meetings, always the same for the same `seed`. */
function roster(n: number, seed: number): Student[] {
  const rand = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const lines = Array.from({ length: 3 + Math.floor(rand() * 3) }, () => `${PATTERNS[Math.floor(rand() * PATTERNS.length)]} ${HOURS[Math.floor(rand() * HOURS.length)]}`);
    const classText = lines.join("\n");
    return makeStudent({
      id: `s${i}`,
      name: `Student ${i}`,
      daysPerWeek: 3 + Math.floor(rand() * 3),
      preference: (["any", "morning", "afternoon"] as const)[Math.floor(rand() * 3)],
      classText,
      busy: buildBusy(classText, "").busy,
      latestEnd: rand() < 0.3 ? 16 * 60 : 24 * 60,
      breaks: rand() < 0.6 ? [{ start: 12 * 60, minutes: 30 }] : [],
      needsOpeningShift: rand() < 0.15,
    });
  });
}

describe("auto-fill at a realistic department size", () => {
  it.each([12, 40, 80])("stays fast and correct with %i students", (n) => {
    const students = roster(n, n);
    const settings = makeSettings({ minStaffPerSlot: 2 });
    const t0 = performance.now();
    const result = autoFill(students, [], settings);
    const ms = performance.now() - t0;

    // never breaks a rule, however many students there are
    expect(findIssues(students, result.assignments, settings).filter((i) => i.code !== "opening_shift_missing")).toEqual([]);
    for (const s of students) expect(assignedHours(s.id, result.assignments, settings)).toBeLessThanOrEqual(settings.weeklyTargetHours);

    // and stays interactive: a generous bound so slow CI machines don't make this flaky
    expect(ms, `${n} students took ${Math.round(ms)}ms`).toBeLessThan(4000);
  });

  it("gives the same answer twice for a big roster", () => {
    const students = roster(40, 7);
    const settings = makeSettings();
    expect(autoFill(students, [], settings)).toEqual(autoFill(students, [], settings));
  });
});
