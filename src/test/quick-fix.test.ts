import { describe, expect, it } from "vitest";
import { suggestFillers } from "../features/scheduling/issues";
import { initialState, reducer } from "../hooks/useShiftFitStore";
import type { Action, State } from "../hooks/useShiftFitStore";
import { makeSettings, makeStudent, run, slot } from "./testkit";
import { assignedHours } from "../features/scheduling/availability";

/**
 * Tests for the "who could cover this gap?" suggestions (`suggestFillers` in `issues.ts`) and for
 * the one-click fix that assigns a suggested student through the store.
 */

const settings = makeSettings();
// Runs several store actions in a row, starting from state `s`, and returns the final state.
const apply = (s: State, ...a: Action[]) => a.reduce(reducer, s);

describe("suggestFillers", () => {
  // A one-item class list: busy on Monday from `start` to `end`.
  const busyAt =(day: "mon", start: number, end: number) => [{ day, start, end, source: "class" as const }];

  it("suggests only students who can really work the stretch, best coverage first", () => {
    const full = makeStudent({ id: "a", name: "Ana" });
    const partial = makeStudent({ id: "b", name: "Ben", busy: busyAt("mon", 11 * 60, 12 * 60) });
    // Cy is free only 11–12, which would make a 1-hour shift, so Cy is not suggested.
    const tooShort = makeStudent({ id: "c", name: "Cy", busy: busyAt("mon", 9 * 60, 11 * 60) });
    const out = suggestFillers([partial, tooShort, full], [], settings, "mon", 9 * 60, 12 * 60);
    expect(out.map((o) => [o.student.name, o.slots, o.total])).toEqual([
      ["Ana", 6, 6],
      ["Ben", 4, 6],
    ]);
  });

  it("plays the stretch forward, so the weekly limit stops a student partway", () => {
    const tight = makeSettings({ weeklyTargetHours: 3 });
    const out = suggestFillers([makeStudent({ id: "a", name: "Ana" })], [], tight, "mon", 9 * 60, 13 * 60);
    expect(out[0]).toMatchObject({ slots: 6, total: 8 }); // 3 hours = 6 boxes, then she is at her limit
  });

  it("respects the days-per-week limit", () => {
    const s = makeStudent({ id: "a", name: "Ana", daysPerWeek: 1 });
    expect(suggestFillers([s], [slot("a", "tue", 540)], settings, "mon", 9 * 60, 10 * 60)).toEqual([]);
  });

  it("breaks ties in favour of whoever has fewer hours, then roster order", () => {
    const a = makeStudent({ id: "a", name: "Ana" });
    const b = makeStudent({ id: "b", name: "Ben" });
    const c = makeStudent({ id: "c", name: "Cy" });
    const shifts = run("a", "tue", 540, 660); // Ana already has 2 hours
    const out = suggestFillers([a, b, c], shifts, settings, "mon", 9 * 60, 11 * 60);
    expect(out.map((o) => o.student.name)).toEqual(["Ben", "Cy", "Ana"]);
  });

  it("skips boxes a student already works and honours the limit", () => {
    const a = makeStudent({ id: "a", name: "Ana" });
    const out = suggestFillers([a], run("a", "mon", 9 * 60, 10 * 60), settings, "mon", 9 * 60, 11 * 60);
    expect(out[0].slots).toBe(2); // only 10:00 and 10:30 are new
    const many = Array.from({ length: 6 }, (_, i) => makeStudent({ id: `s${i}`, name: `S${i}` }));
    expect(suggestFillers(many, [], settings, "mon", 9 * 60, 11 * 60, 2)).toHaveLength(2);
  });

  it("never suggests anyone for a stretch that is already gone", () => {
    expect(suggestFillers([makeStudent()], [], settings, "mon", 10 * 60, 10 * 60)).toEqual([]);
  });
});

describe("the FILL_GAP action", () => {
  // An empty schedule with no undo history or messages, to start each test clean.
  const base = () => {
    const empty = apply(initialState(), { type: "CLEAR_ALL" });
    return { ...empty, past: [], future: [], toast: null };
  };
  const ana = { name: "Ana K.", preference: "any" as const, daysPerWeek: 5, classText: "", blockedText: "", latestEnd: 24 * 60, breaks: [], needsOpeningShift: false };

  it("fills the stretch for that student, as one undoable step, without changing who is selected", () => {
    let s = apply(base(), { type: "ADD_STUDENT", id: "a", input: ana }, { type: "ADD_STUDENT", id: "b", input: { ...ana, name: "Ben P." } });
    s = apply(s, { type: "SELECT_STUDENT", id: "b" });
    const filled = apply(s, { type: "FILL_GAP", studentId: "a", day: "mon", from: 9 * 60, to: 10 * 60 + 30 });
    expect(filled.doc.assignments.filter((x) => x.studentId === "a")).toHaveLength(4);
    expect(filled.selectedStudentId).toBe("b");
    expect(filled.toast?.message).toBe("Added 4 slots on Mon 9:00am–11:00am.");
    expect(filled.past.at(-1)?.label).toBe("Filled a gap with Ana K.");
    expect(apply(filled, { type: "UNDO" }).doc.assignments).toHaveLength(0);
  });

  it("skips boxes that break a rule and says so, instead of forcing them", () => {
    let s = apply(base(), { type: "ADD_STUDENT", id: "a", input: { ...ana, classText: "MWF 9:30am-10:20am" } });
    const filled = apply(s, { type: "FILL_GAP", studentId: "a", day: "mon", from: 9 * 60, to: 10 * 60 + 30 });
    expect(filled.doc.assignments.map((x) => x.start)).toEqual([540, 630]);
    expect(filled.toast?.message).toMatch(/Skipped 2 slots/);
  });

  it("does nothing for a student who no longer exists", () => {
    const s = base();
    expect(apply(s, { type: "FILL_GAP", studentId: "ghost", day: "mon", from: 540, to: 570 })).toBe(s);
  });

  it("never pushes anyone over their weekly hours", () => {
    let s = apply(base(), { type: "ADD_STUDENT", id: "a", input: ana }, { type: "SET_SETTINGS", settings: { weeklyTargetHours: 1 } });
    const filled = apply(s, { type: "FILL_GAP", studentId: "a", day: "mon", from: 9 * 60, to: 11 * 60 });
    expect(assignedHours("a", filled.doc.assignments, filled.doc.settings)).toBe(1);
    expect(filled.doc.assignments.every((x) => !x.override)).toBe(true);
  });
});
