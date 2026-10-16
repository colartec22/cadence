import { describe, expect, it } from "vitest";
import { autoFill } from "../features/scheduling/scheduler";
import { assignedHours, hasOpeningShift } from "../features/scheduling/availability";
import { openDays } from "../features/scheduling/days";
import { summarizeByDay } from "../features/scheduling/summary";
import { validatePersistedState } from "../features/scheduling/validation";
import { parseBackup } from "../features/persistence/storage";
import { buildStudentIcs } from "../features/calendar/ics";
import { validateExtractedSchedule } from "../features/import/schemas";
import { DEFAULT_SETTINGS } from "../features/scheduling/constants";
import { makeSettings, makeStudent, run } from "./testkit";

/**
 * Tests for Saturday (the "Days open" setting) and for students' breaks, which replaced the single
 * lunch time. They also check that schedules saved before these changes still load the same way.
 */

const monSat = makeSettings({ openDays: "mon-sat" });

describe("Saturday", () => {
  it("is open by default for new schedules, but not for older ones saved without the setting", () => {
    expect(openDays(DEFAULT_SETTINGS)).toContain("sat");
    expect(openDays({ ...DEFAULT_SETTINGS, openDays: undefined })).not.toContain("sat");
    expect(openDays(makeSettings({ openDays: "mon-fri" }))).toEqual(["mon", "tue", "wed", "thu", "fri"]);
  });

  it("gets shifts from auto-fill only when the office opens on Saturdays", () => {
    // In class all day Monday to Friday, so Saturday is the only day this student can work.
    const weekdays = (["mon", "tue", "wed", "thu", "fri"] as const).map((day) => ({ day, start: 7 * 60, end: 24 * 60, source: "class" as const }));
    const student = makeStudent({ daysPerWeek: 6, busy: weekdays });
    const open = autoFill([student], [], monSat);
    expect(open.assignments.some((a) => a.day === "sat")).toBe(true);
    const closed = autoFill([student], [], makeSettings({ openDays: "mon-fri" }));
    expect(closed.assignments.some((a) => a.day === "sat")).toBe(false);
  });

  it("keeps a student out of a Saturday class", () => {
    const student = makeStudent({ busy: [{ day: "sat", start: 8 * 60, end: 10 * 60, source: "class" }] });
    const result = autoFill([student], [], monSat);
    expect(result.assignments.filter((a) => a.day === "sat" && a.start >= 8 * 60 && a.start < 10 * 60)).toEqual([]);
  });

  it("counts a Saturday opening shift only when Saturday is open", () => {
    const shifts = run("s1", "sat", 7 * 60, 9 * 60);
    expect(hasOpeningShift("s1", shifts, monSat)).toBe(true);
    expect(hasOpeningShift("s1", shifts, makeSettings({ openDays: "mon-fri" }))).toBe(false);
  });

  it("still lists a closed Saturday in 'By day' if shifts are saved on it, so none are hidden", () => {
    const students = [makeStudent()];
    const shifts = run("s1", "sat", 9 * 60, 11 * 60);
    expect(summarizeByDay(students, shifts, makeSettings({ openDays: "mon-fri" })).map((d) => d.day)).toContain("sat");
    expect(summarizeByDay(students, [], makeSettings({ openDays: "mon-fri" })).map((d) => d.day)).not.toContain("sat");
  });

  it("puts Saturday shifts in calendar files on real Saturdays", () => {
    const semester = { startDate: "2026-08-24", endDate: "2026-12-11", timeZone: "Pacific/Honolulu", skipDates: [] };
    const ics = buildStudentIcs(makeStudent(), run("s1", "sat", 9 * 60, 11 * 60), semester, 30, new Date("2026-08-01T00:00:00Z"));
    expect(ics).toContain("DTSTART;TZID=Pacific/Honolulu:20260829T090000"); // Aug 29, 2026 is the first Saturday
    expect(ics).toContain("DTEND;TZID=Pacific/Honolulu:20260829T110000");
  });

  it("is accepted in saved data, with up to 6 days a week but not 7", () => {
    const state = (daysPerWeek: number) => ({
      version: 1,
      settings: monSat,
      students: [{ ...makeStudent(), daysPerWeek }],
      assignments: run("s1", "sat", 9 * 60, 11 * 60),
      selectedStudentId: null,
    });
    const ok = validatePersistedState(state(6));
    expect(ok.ok && ok.value.assignments).toHaveLength(4);
    expect(ok.ok && ok.value.settings.openDays).toBe("mon-sat");
    expect(validatePersistedState(state(7)).ok).toBe(false);
  });

  it("is accepted from the screenshot reader, with up to 6 days a week", () => {
    const reading = validateExtractedSchedule({
      requestId: "r1",
      status: "ok",
      confidence: 0.9,
      meetings: [{ day: "sat", start: 540, end: 600 }],
      constraints: { daysPerWeek: 6 },
      warnings: [],
      unresolved: [],
    });
    expect(reading.ok && reading.value.meetings[0].day).toBe("sat");
    expect(reading.ok && reading.value.constraints.daysPerWeek).toBe(6);
  });
});

describe("breaks", () => {
  /** An older saved schedule: one student with the old single `lunchStart` field and no `breaks`. */
  const oldSave = (lunchStart: number | null) => ({
    version: 1,
    settings: { openTime: 420, closeTime: 1440, minStaffPerSlot: 1, slotMinutes: 30, weeklyTargetHours: 19 },
    students: [{ id: "s1", name: "Noa K.", color: "#1F6FB2", preference: "any", daysPerWeek: 5, classText: "", busy: [], latestEnd: 1440, lunchStart, needsOpeningShift: false }],
    assignments: [],
    selectedStudentId: null,
  });

  it("turn an old saved lunch time into one 30-minute break, so existing schedules keep working", () => {
    const result = parseBackup(JSON.stringify(oldSave(12 * 60)));
    expect(result.ok && result.value.students[0].breaks).toEqual([{ start: 720, minutes: 30 }]);
    const none = parseBackup(JSON.stringify(oldSave(null)));
    expect(none.ok && none.value.students[0].breaks).toEqual([]);
    // Older schedules also had no Saturday: they stay Monday to Friday.
    expect(result.ok && openDays(result.value.settings)).not.toContain("sat");
  });

  it("reject break lists that can't be real (too many, too long, past midnight)", () => {
    const withBreaks = (breaks: unknown) => validatePersistedState({ ...oldSave(null), students: [{ ...oldSave(null).students[0], breaks }] });
    expect(withBreaks([{ start: 600, minutes: 15 }, { start: 780, minutes: 30 }]).ok).toBe(true);
    expect(withBreaks([1, 2, 3, 4]).ok).toBe(false);
    expect(withBreaks([{ start: 600, minutes: 500 }]).ok).toBe(false);
    expect(withBreaks([{ start: 1430, minutes: 30 }]).ok).toBe(false);
    expect(withBreaks([{ start: 600 }]).ok).toBe(false);
  });

  it("are never worked: auto-fill leaves every break free, and break time is not counted as hours", () => {
    const student = makeStudent({ breaks: [{ start: 10 * 60, minutes: 15 }, { start: 12 * 60, minutes: 60 }] });
    const result = autoFill([student], [], makeSettings({ closeTime: 17 * 60 }));
    const onBreak = result.assignments.filter((a) => a.start === 10 * 60 || a.start === 12 * 60 || a.start === 12 * 60 + 30);
    expect(onBreak).toEqual([]);
    expect(assignedHours("s1", result.assignments, makeSettings())).toBe(result.assignments.length / 2);
  });

  it("can come from the screenshot reader as a list, or as an older single lunch time", () => {
    const base = { requestId: "r1", status: "ok", confidence: 0.9, meetings: [], warnings: [], unresolved: [] };
    const list = validateExtractedSchedule({ ...base, constraints: { breaks: [{ start: 600, minutes: 15 }, { start: 9999, minutes: 15 }] } });
    expect(list.ok && list.value.constraints.breaks).toEqual([{ start: 600, minutes: 15 }]); // the impossible one is dropped
    const lunch = validateExtractedSchedule({ ...base, constraints: { lunchStart: 720 } });
    expect(lunch.ok && lunch.value.constraints.breaks).toEqual([{ start: 720, minutes: 30 }]);
    const nothing = validateExtractedSchedule({ ...base, constraints: {} });
    expect(nothing.ok && nothing.value.constraints.breaks).toEqual([]);
  });
});
