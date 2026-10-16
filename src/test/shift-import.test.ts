import { beforeEach, describe, expect, it } from "vitest";
import { assignedHours } from "../features/scheduling/availability";
import { parseShiftText } from "../features/scheduling/shift-import";
import { initialState, reducer } from "../hooks/useShiftFitStore";
import type { Action, NewStudentInput, State } from "../hooks/useShiftFitStore";
import { makeStudent } from "./testkit";

/**
 * Tests for pasting existing shifts (`features/scheduling/shift-import.ts`): matching names to
 * students, reading days and times, and adding the shifts through the store without breaking rules.
 */

const students = [makeStudent({ id: "s1", name: "Noa K." }), makeStudent({ id: "s2", name: "Kai P." })];

describe("parsing pasted shifts", () => {
  it("reads name, days and times, matching students by name (ignoring case)", () => {
    const r = parseShiftText("noa k.: MWF 9:00am-1:00pm", students, 30);
    expect(r.rows[0]).toMatchObject({ ok: true, studentId: "s1", name: "noa k." });
    expect(r.rows[0].shifts).toEqual([
      { day: "mon", start: 540, end: 780 },
      { day: "wed", start: 540, end: 780 },
      { day: "fri", start: 540, end: 780 },
    ]);
    expect(r.shiftCount).toBe(3);
  });

  it("accepts several shifts on one line, tab-separated rows, comments and blank lines", () => {
    const text = "# supervisor's list\n\nKai P.: Tuesday/Thursday 8:00am-12:00pm; F 1:00pm-5:00pm\nNoa K.\tM 9:00am-10:00am";
    const r = parseShiftText(text, students, 30);
    expect(r.rows).toHaveLength(2);
    expect(r.valid).toHaveLength(2);
    expect(r.rows[0].shifts).toHaveLength(3);
    expect(r.rows[1].line).toBe(4);
  });

  it("never guesses: unknown names, duplicate names, unreadable or off-the-half-hour times are reported per line", () => {
    const dupes = [...students, makeStudent({ id: "s3", name: "Noa K." })];
    const r = parseShiftText("Zed: M 9:00am-10:00am\nNoa K.: M 9:00am-10:00am\nKai P.: sometime tomorrow\nKai P.: M 9:10am-10:00am\njust words", dupes, 30);
    expect(r.valid).toHaveLength(0);
    expect(r.rows[0].errors[0]).toMatch(/No student named "Zed"/);
    expect(r.rows[1].errors[0]).toMatch(/More than one student/);
    expect(r.rows[2].errors[0]).toMatch(/sometime tomorrow/);
    expect(r.rows[3].errors[0]).toMatch(/half hour/);
    expect(r.rows[4].errors[0]).toMatch(/name first/);
    expect(r.shiftCount).toBe(0);
  });

  it("keeps a colon inside a time from being read as the name separator", () => {
    const r = parseShiftText("Noa K.: M 9:00am-10:30am", students, 30);
    expect(r.rows[0].ok).toBe(true);
  });
});

const noa: NewStudentInput = {
  name: "Noa K.",
  preference: "any",
  daysPerWeek: 5,
  classText: "MWF 9:00am-9:50am",
  blockedText: "",
  latestEnd: 24 * 60,
  breaks: [],
  needsOpeningShift: false,
};

let s0: State;
beforeEach(() => {
  window.localStorage.clear();
  s0 = [{ type: "CLEAR_ALL" } as Action, { type: "ADD_STUDENT", id: "n1", input: noa } as Action].reduce(reducer, initialState());
  s0 = { ...s0, past: [], future: [], toast: null };
});

describe("placing pasted shifts", () => {
  it("adds allowed shifts as manual shifts in ONE undo step", () => {
    let s = reducer(s0, { type: "IMPORT_SHIFTS", entries: [{ studentId: "n1", day: "tue", start: 9 * 60, end: 11 * 60 }] });
    expect(assignedHours("n1", s.doc.assignments, s.doc.settings)).toBe(2);
    expect(s.doc.assignments.every((a) => a.source === "manual")).toBe(true);
    expect(s.past).toHaveLength(1);
    s = reducer(s, { type: "UNDO" });
    expect(s.doc.assignments).toHaveLength(0);
  });

  it("skips half hours that hit a class and says so, but still adds the rest", () => {
    // Noa has class Monday 9:00-9:50, so 9:00 and 9:30 are blocked; 10:00 and 10:30 are fine.
    const s = reducer(s0, { type: "IMPORT_SHIFTS", entries: [{ studentId: "n1", day: "mon", start: 9 * 60, end: 11 * 60 }] });
    expect(assignedHours("n1", s.doc.assignments, s.doc.settings)).toBe(1);
    expect(s.toast?.message).toMatch(/Skipped 2 half hours that broke a rule/);
    expect(s.toast?.message).toMatch(/has class/);
  });

  it("adds nothing (and does not create an undo step) when every half hour breaks a rule or already exists", () => {
    const blocked = reducer(s0, { type: "IMPORT_SHIFTS", entries: [{ studentId: "n1", day: "mon", start: 9 * 60, end: 10 * 60 }] });
    expect(blocked.doc.assignments).toHaveLength(0);
    expect(blocked.past).toHaveLength(0);
    expect(blocked.toast?.message).toMatch(/Nothing was added/);

    const once = reducer(s0, { type: "IMPORT_SHIFTS", entries: [{ studentId: "n1", day: "tue", start: 9 * 60, end: 10 * 60 }] });
    const twice = reducer(once, { type: "IMPORT_SHIFTS", entries: [{ studentId: "n1", day: "tue", start: 9 * 60, end: 10 * 60 }] });
    expect(twice.doc.assignments).toHaveLength(2);
    expect(twice.past).toHaveLength(1);
    expect(twice.toast?.message).toMatch(/already on the schedule/);
  });

  it("stops at the weekly hour limit instead of overriding it", () => {
    const s = reducer(s0, { type: "IMPORT_SHIFTS", entries: [{ studentId: "n1", day: "tue", start: 7 * 60, end: 17 * 60 }, { studentId: "n1", day: "thu", start: 7 * 60, end: 17 * 60 }] });
    expect(assignedHours("n1", s.doc.assignments, s.doc.settings)).toBeLessThanOrEqual(19);
  });
});
