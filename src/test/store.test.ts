import { beforeEach, describe, expect, it } from "vitest";
import { assignedHours } from "../features/scheduling/availability";
import { DEFAULT_SETTINGS } from "../features/scheduling/constants";
import { findIssues } from "../features/scheduling/issues";
import { validatePersistedState } from "../features/scheduling/validation";
import { initialState, reducer } from "../hooks/useShiftFitStore";
import type { Action, NewStudentInput, State } from "../hooks/useShiftFitStore";

/**
 * Tests for the app's central state (`hooks/useShiftFitStore.ts`): adding and editing students,
 * assigning shifts, auto-fill, undo/redo and overrides. Each test sends actions to the reducer
 * (the function that turns "current state + action" into the next state) and checks the result.
 */

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

/** Runs several store actions in a row, starting from `state`, and returns the final state. */
function apply(state: State, ...actions: Action[]): State {
  return actions.reduce(reducer, state);
}

let empty: State;
beforeEach(() => {
  window.localStorage.clear();
  empty = apply(initialState(), { type: "CLEAR_ALL" });
  empty = { ...empty, past: [], future: [], toast: null };
});

describe("students", () => {
  it("adds, selects, edits and removes a student, with classes parsed for them", () => {
    let s = apply(empty, { type: "ADD_STUDENT", id: "n1", input: noa });
    expect(s.doc.students).toHaveLength(1);
    expect(s.selectedStudentId).toBe("n1");
    expect(s.doc.students[0].busy).toHaveLength(3);

    s = apply(s, { type: "UPDATE_STUDENT", id: "n1", input: { ...noa, name: "Noa Kai", classText: "" } });
    expect(s.doc.students[0]).toMatchObject({ name: "Noa Kai", busy: [] });

    s = apply(s, { type: "REMOVE_STUDENT", id: "n1" });
    expect(s.doc.students).toHaveLength(0);
    expect(s.selectedStudentId).toBeNull();
  });

  it("gives each new student a different color until the palette runs out", () => {
    let s = empty;
    for (let i = 0; i < 4; i++) s = apply(s, { type: "ADD_STUDENT", id: `n${i}`, input: { ...noa, name: `S${i}` } });
    expect(new Set(s.doc.students.map((x) => x.color)).size).toBe(4);
  });

  it("removing a student removes only their shifts", () => {
    let s = apply(empty, { type: "ADD_STUDENT", id: "a", input: noa }, { type: "ADD_STUDENT", id: "b", input: { ...noa, name: "B" } });
    s = apply(s, { type: "SELECT_STUDENT", id: "a" }, { type: "TOGGLE_SLOT", day: "tue", start: 600 }, { type: "SELECT_STUDENT", id: "b" }, { type: "TOGGLE_SLOT", day: "tue", start: 600 });
    s = apply(s, { type: "REMOVE_STUDENT", id: "a" });
    expect(s.doc.assignments.map((a) => a.studentId)).toEqual(["b"]);
    expect(s.selectedStudentId).toBe("b");
  });
});

describe("clicking the schedule", () => {
  // An empty schedule with one student, Noa, already added.
  const withNoa = () => apply(empty, { type: "ADD_STUDENT", id: "n1", input: noa });

  it("assigns then unassigns the same slot", () => {
    let s = apply(withNoa(), { type: "TOGGLE_SLOT", day: "tue", start: 600 });
    expect(s.doc.assignments).toHaveLength(1);
    s = apply(s, { type: "TOGGLE_SLOT", day: "tue", start: 600 });
    expect(s.doc.assignments).toHaveLength(0);
  });

  it("explains why a class slot can't be used, and changes nothing", () => {
    const s = apply(withNoa(), { type: "TOGGLE_SLOT", day: "mon", start: 9 * 60 });
    expect(s.doc.assignments).toHaveLength(0);
    expect(s.toast?.message).toMatch(/Noa K\. has class on Mon/);
  });

  it("asks first before going over the weekly hours, and flags it once confirmed", () => {
    const thu = (start: number): Action => ({ type: "TOGGLE_SLOT", day: "thu", start });
    let s = apply(withNoa(), { type: "SET_SETTINGS", settings: { weeklyTargetHours: 2 } }, thu(600), thu(630), thu(660), thu(690));
    expect(assignedHours("n1", s.doc.assignments, s.doc.settings)).toBe(2);
    s = apply(s, thu(720));
    expect(s.pendingOverride?.message).toMatch(/already at 2 hours./);
    expect(s.doc.assignments).toHaveLength(4); // nothing added yet

    const cancelled = apply(s, { type: "CANCEL_OVERRIDE" });
    expect(cancelled.pendingOverride).toBeNull();
    expect(cancelled.doc.assignments).toHaveLength(4);

    const confirmed = apply(s, { type: "CONFIRM_OVERRIDE" });
    expect(confirmed.doc.assignments).toHaveLength(5);
    expect(confirmed.doc.assignments[4].override).toBe(true);
    const issues = findIssues(confirmed.doc.students, confirmed.doc.assignments, confirmed.doc.settings);
    expect(issues.every((i) => i.overridden)).toBe(true);
  });

  it("never lets an override break a class conflict", () => {
    const s = apply(withNoa(), { type: "TOGGLE_SLOT", day: "wed", start: 9 * 60 });
    expect(s.pendingOverride).toBeNull();
    expect(s.doc.assignments).toHaveLength(0);
  });

  it("asks the user to pick a student first", () => {
    const s = apply(empty, { type: "TOGGLE_SLOT", day: "tue", start: 600 });
    expect(s.toast?.message).toMatch(/Pick a student/);
  });
});

describe("ranges", () => {
  // An empty schedule with one student, Noa, already added.
  const withNoa = () => apply(empty, { type: "ADD_STUDENT", id: "n1", input: noa });

  it("fills a stretch and clears it again", () => {
    let s = apply(withNoa(), { type: "SET_RANGE", day: "thu", from: 600, to: 720, assign: true });
    expect(s.doc.assignments).toHaveLength(5); // 10:00 .. 12:00 inclusive of the last box
    s = apply(s, { type: "SET_RANGE", day: "thu", from: 720, to: 600, assign: false });
    expect(s.doc.assignments).toHaveLength(0);
  });

  it("skips blocked boxes and says how many", () => {
    const s = apply(withNoa(), { type: "SET_RANGE", day: "mon", from: 8 * 60, to: 10 * 60, assign: true });
    // Monday 9:00-9:50 is class: 9:00 and 9:30 are skipped
    expect(s.doc.assignments.map((a) => a.start)).toEqual([480, 510, 600]);
    expect(s.toast?.message).toMatch(/Skipped 2 slots/);
  });

  it("stops at the weekly hour limit instead of overriding it", () => {
    const s = apply(withNoa(), { type: "SET_SETTINGS", settings: { weeklyTargetHours: 1 } }, { type: "SET_RANGE", day: "tue", from: 600, to: 720, assign: true });
    expect(s.doc.assignments).toHaveLength(2);
  });
});

describe("undo and redo", () => {
  it("undoes and redoes a change, with a label", () => {
    let s = apply(empty, { type: "ADD_STUDENT", id: "n1", input: noa });
    expect(s.past.at(-1)?.label).toBe("Added Noa K.");
    s = apply(s, { type: "UNDO" });
    expect(s.doc.students).toHaveLength(0);
    expect(s.toast?.message).toBe("Undid: Added Noa K.");
    s = apply(s, { type: "REDO" });
    expect(s.doc.students).toHaveLength(1);
  });

  it("can bring back a removed student along with their shifts", () => {
    let s = apply(empty, { type: "ADD_STUDENT", id: "n1", input: noa }, { type: "TOGGLE_SLOT", day: "tue", start: 600 });
    s = apply(s, { type: "REMOVE_STUDENT", id: "n1" }, { type: "UNDO" });
    expect(s.doc.students).toHaveLength(1);
    expect(s.doc.assignments).toHaveLength(1);
    expect(s.selectedStudentId).toBe("n1");
  });

  it("can undo clearing everything and loading a backup", () => {
    const start = apply(empty, { type: "ADD_STUDENT", id: "n1", input: noa });
    expect(apply(start, { type: "CLEAR_ALL" }, { type: "UNDO" }).doc.students).toHaveLength(1);
    const backup = { version: 1 as const, settings: DEFAULT_SETTINGS, students: [], assignments: [], selectedStudentId: null, semester: null };
    expect(apply(start, { type: "LOAD_STATE", state: backup, notes: [] }, { type: "UNDO" }).doc.students).toHaveLength(1);
  });

  it("clears the redo stack when something new happens", () => {
    let s = apply(empty, { type: "ADD_STUDENT", id: "n1", input: noa }, { type: "UNDO" });
    expect(s.future).toHaveLength(1);
    s = apply(s, { type: "ADD_STUDENT", id: "n2", input: { ...noa, name: "Other" } });
    expect(s.future).toHaveLength(0);
  });

  it("does nothing when there is nothing to undo or redo", () => {
    expect(apply(empty, { type: "UNDO" })).toBe(empty);
    expect(apply(empty, { type: "REDO" })).toBe(empty);
  });

  it("caps its memory", () => {
    let s = empty;
    for (let i = 0; i < 150; i++) s = apply(s, { type: "SET_SETTINGS", settings: { minStaffPerSlot: (i % 2) + 1 } });
    expect(s.past.length).toBe(100);
  });
});

describe("auto-fill in the store", () => {
  it("fills, remembers why, and is a no-op the second time", () => {
    let s = apply(empty, { type: "ADD_STUDENT", id: "n1", input: noa });
    s = apply(s, { type: "AUTOFILL", replace: false });
    expect(assignedHours("n1", s.doc.assignments, s.doc.settings)).toBe(19);
    expect(s.lastAutofill?.explanations.length).toBeGreaterThan(0);
    const before = s.past.length;
    const again = apply(s, { type: "AUTOFILL", replace: false });
    expect(again.past.length).toBe(before); // nothing changed, so no undo step was created
    expect(again.toast?.message).toMatch(/Nothing to change/);
  });

  it("can be undone in one step", () => {
    const s = apply(empty, { type: "ADD_STUDENT", id: "n1", input: noa }, { type: "AUTOFILL", replace: false }, { type: "UNDO" });
    expect(s.doc.assignments).toHaveLength(0);
  });

  it("rebuild keeps manual shifts", () => {
    let s = apply(empty, { type: "ADD_STUDENT", id: "n1", input: noa });
    s = apply(s, { type: "TOGGLE_SLOT", day: "fri", start: 8 * 60 }, { type: "AUTOFILL", replace: false }, { type: "AUTOFILL", replace: true });
    expect(s.doc.assignments.some((a) => a.source === "manual" && a.day === "fri" && a.start === 480)).toBe(true);
  });
});

describe("other actions", () => {
  it("keeps the selection valid after loading a backup that lacks the selected student", () => {
    const start = apply(empty, { type: "ADD_STUDENT", id: "n1", input: noa });
    const other = { version: 1 as const, settings: DEFAULT_SETTINGS, students: [{ ...start.doc.students[0], id: "z9", name: "Zed" }], assignments: [], selectedStudentId: "gone", semester: null };
    expect(apply(start, { type: "LOAD_STATE", state: other, notes: [] }).selectedStudentId).toBe("z9");
  });

  it("stores the calendar semester and can undo it", () => {
    const semester = { startDate: "2026-08-24", endDate: "2026-12-11", timeZone: "Pacific/Honolulu" };
    const s = apply(empty, { type: "SET_SEMESTER", semester });
    expect(s.doc.semester).toEqual(semester);
    expect(apply(s, { type: "UNDO" }).doc.semester).toBeNull();
  });

  it("manual shift ids are deterministic so reducers stay pure", () => {
    const a = apply(empty, { type: "ADD_STUDENT", id: "n1", input: noa }, { type: "TOGGLE_SLOT", day: "tue", start: 600 });
    const b = apply(empty, { type: "ADD_STUDENT", id: "n1", input: noa }, { type: "TOGGLE_SLOT", day: "tue", start: 600 });
    expect(a.doc.assignments).toEqual(b.doc.assignments);
    expect(a.doc.assignments[0].id).toBe("manual-n1-tue-600");
  });

  it("sample data starts valid and undoable reset works", () => {
    const fresh = initialState();
    expect(fresh.doc.students.length).toBeGreaterThan(0);
    expect(findIssues(fresh.doc.students, fresh.doc.assignments, fresh.doc.settings)).toEqual([]);
    const s = apply(empty, { type: "RESET_DEMO" });
    expect(s.doc.students.length).toBeGreaterThan(0);
  });
});

describe("adding several students", () => {
  // `n` new students named "Student 0", "Student 1", ... ready to add in one go.
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `b${i}`, input: { ...noa, name: `Student ${i}`, classText: "MWF 9:00am-9:50am" } }));

  it("adds them all as one undo step, with different colors", () => {
    let s = apply(empty, { type: "ADD_STUDENTS", entries: rows(5) });
    expect(s.doc.students).toHaveLength(5);
    expect(new Set(s.doc.students.map((x) => x.color)).size).toBe(5);
    expect(s.doc.students.every((x) => x.busy.length === 3)).toBe(true);
    expect(s.selectedStudentId).toBe("b0");
    expect(s.past).toHaveLength(1);
    s = apply(s, { type: "UNDO" });
    expect(s.doc.students).toHaveLength(0);
  });

  it("keeps whoever was already selected", () => {
    let s = apply(empty, { type: "ADD_STUDENT", id: "first", input: noa });
    s = apply(s, { type: "ADD_STUDENTS", entries: rows(2) });
    expect(s.selectedStudentId).toBe("first");
  });

  it("never goes past the student limit, and says how many were left out", () => {
    const s = apply(empty, { type: "ADD_STUDENTS", entries: rows(203) });
    expect(s.doc.students).toHaveLength(200);
    expect(s.toast?.message).toMatch(/3 more didn't fit under the limit of 200/);
    const full = apply(s, { type: "ADD_STUDENTS", entries: rows(1) });
    expect(full.doc.students).toHaveLength(200);
    expect(full.toast?.message).toMatch(/nobody was added/);
  });

  it("does nothing for an empty list", () => {
    expect(apply(empty, { type: "ADD_STUDENTS", entries: [] }).doc.students).toHaveLength(0);
  });
});

describe("separate semester and break schedules", () => {
  const withNoa = () => apply(empty, { type: "ADD_STUDENT", id: "n1", input: noa });
  const toBreak: Action = { type: "SET_SETTINGS", settings: { term: "break" } };
  const toSemester: Action = { type: "SET_SETTINGS", settings: { term: "semester" } };
  const starts = (s: State) => s.doc.assignments.map((a) => `${a.day} ${a.start}`).sort();

  it("keeps the semester schedule untouched while the break schedule is edited", () => {
    const semester = apply(withNoa(), { type: "SET_RANGE", day: "thu", from: 600, to: 690, assign: true });
    const semesterShifts = starts(semester);
    expect(semesterShifts).toHaveLength(4);

    let s = apply(semester, toBreak);
    expect(s.doc.assignments).toEqual([]); // the break schedule starts empty
    expect(s.toast?.message).toMatch(/Showing the break schedule.*semester schedule is kept as it was/);
    s = apply(s, { type: "SET_RANGE", day: "mon", from: 13 * 60, to: 14 * 60 + 30, assign: true }, { type: "AUTOFILL", replace: false });
    const breakShifts = starts(s);
    expect(breakShifts.length).toBeGreaterThan(4);

    s = apply(s, toSemester);
    expect(starts(s)).toEqual(semesterShifts);
    s = apply(s, toBreak);
    expect(starts(s)).toEqual(breakShifts);
  });

  it("undoes a switch like any other change", () => {
    const semester = apply(withNoa(), { type: "SET_RANGE", day: "thu", from: 600, to: 690, assign: true });
    const back = apply(semester, toBreak, { type: "UNDO" });
    expect(back.doc.settings.term).toBe("semester");
    expect(starts(back)).toEqual(starts(semester));
  });

  it("clearing shifts only clears the schedule that is showing", () => {
    let s = apply(withNoa(), { type: "SET_RANGE", day: "thu", from: 600, to: 690, assign: true }, toBreak);
    s = apply(s, { type: "SET_RANGE", day: "mon", from: 600, to: 690, assign: true }, { type: "CLEAR_SHIFTS" });
    expect(s.doc.assignments).toEqual([]);
    expect(s.toast?.message).toMatch(/Cleared all shifts in the break schedule\. The other schedule is untouched/);
    expect(starts(apply(s, toSemester))).toHaveLength(4);
  });

  it("removing a student removes their shifts from both schedules", () => {
    let s = apply(withNoa(), { type: "SET_RANGE", day: "thu", from: 600, to: 690, assign: true }, toBreak);
    s = apply(s, { type: "SET_RANGE", day: "mon", from: 600, to: 690, assign: true }, { type: "REMOVE_STUDENT", id: "n1" });
    expect(s.doc.assignments).toEqual([]);
    expect(s.doc.otherTermAssignments).toEqual([]);
  });

  it("a backup keeps both schedules", () => {
    let s = apply(withNoa(), { type: "SET_RANGE", day: "thu", from: 600, to: 690, assign: true }, toBreak);
    s = apply(s, { type: "SET_RANGE", day: "mon", from: 600, to: 690, assign: true });
    const saved = validatePersistedState(
      JSON.parse(JSON.stringify({ version: 1, settings: s.doc.settings, students: s.doc.students, assignments: s.doc.assignments, otherTermAssignments: s.doc.otherTermAssignments, selectedStudentId: "n1", semester: null })),
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const loaded = apply(empty, { type: "LOAD_STATE", state: saved.value, notes: [] });
    expect(loaded.doc.settings.term).toBe("break");
    expect(starts(loaded)).toEqual(["mon 600", "mon 630", "mon 660", "mon 690"]);
    expect(starts(apply(loaded, toSemester))).toEqual(["thu 600", "thu 630", "thu 660", "thu 690"]);
  });
});
