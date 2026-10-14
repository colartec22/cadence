import { useEffect, useMemo, useReducer, useRef } from "react";
import { canAssign, isAssigned, softViolations } from "../features/scheduling/availability";
import { weeklyLimit } from "../features/scheduling/term";
import { scheduleVersion } from "../features/scheduling/blocks";
import { BREAK_WEEKLY_HOURS, DEFAULT_SETTINGS, MAX_STUDENTS, NO_CUTOFF, STUDENT_COLORS } from "../features/scheduling/constants";
import { buildDemoData } from "../features/scheduling/demo-data";
import { buildBusy } from "../features/scheduling/parser";
import { autoFill, normalizeAssignments } from "../features/scheduling/scheduler";
import { formatMinutes } from "../features/scheduling/time";
import { DAY_LABEL } from "../features/scheduling/types";
import { STORAGE_KEY, storage } from "../features/persistence/storage";
import { createId } from "../lib/id";
import type {
  AutoFillResult,
  Day,
  PersistedStateV1,
  ScheduleSettings,
  SemesterConfig,
  ShiftBlock,
  Student,
} from "../features/scheduling/types";

/**
 * ============================================================================
 *  THE APP'S "BRAIN": ALL STATE LIVES HERE
 * ============================================================================
 * This is the single most important file for understanding how Cadence
 * actually works. Every screen (`src/components/...`) is just a "view" —
 * it displays data and reports clicks, but it never changes anything by
 * itself. Instead, every user action (add a student, click a grid box, press
 * undo) becomes an `Action` object that gets sent to the `reducer` function
 * below, which is the ONLY place that is allowed to compute a new version of
 * the schedule. This pattern (used by many React apps) is sometimes called
 * "Redux-style" or "reducer" state management. It has two big benefits for a
 * scheduling app: (1) every change goes through the same rule-checking code
 * path, so nothing can sneak past a rule, and (2) Undo/Redo becomes simple —
 * `past`/`future` below are just lists of earlier and later versions of the
 * schedule (`Doc`), and undoing is just "go back one".
 *
 * Reading order:
 *   1. `Doc` / `State` / `Action` — the shapes of the data and the list of
 *      every possible thing a user can do.
 *   2. `reducer` — given the current `State` and one `Action`, compute the
 *      next `State`. Skim the `case` labels; each one is one user action.
 *   3. `useShiftFitStore` — the "hook" (a reusable bundle of React logic)
 *      that `App.tsx` calls to get the current state plus an `actions`
 *      object of plain functions (`addStudent`, `toggleSlot`, ...) that
 *      components call instead of building `Action` objects by hand.
 */

export type NewStudentInput = {
  name: string;
  /** Saved thumbnail (data URL) or null/undefined for none. */
  avatar?: string | null;
  preference: Student["preference"];
  daysPerWeek: number;
  classText: string;
  blockedText: string;
  latestEnd: number;
  lunchStart: number | null;
  needsOpeningShift: boolean;
};

/** Everything the manager can undo. Selection, toasts and dialogs are deliberately not part of it. */
type Doc = {
  settings: ScheduleSettings;
  students: Student[];
  /** The schedule that is showing: semester or break, whichever `settings.term` says. */
  assignments: ShiftBlock[];
  /** The other schedule, kept untouched until the Semester/Break switch brings it back. */
  otherTermAssignments: ShiftBlock[];
  semester: SemesterConfig | null;
};

type HistoryEntry = { doc: Doc; label: string };

export type PendingOverride = { studentId: string; day: Day; start: number; message: string };

export type LastAutofill = Pick<AutoFillResult, "explanations" | "unmet" | "openingShiftUnmet">;

export type State = {
  doc: Doc;
  past: HistoryEntry[];
  future: HistoryEntry[];
  selectedStudentId: string | null;
  toast: { id: number; message: string } | null;
  pendingOverride: PendingOverride | null;
  lastAutofill: LastAutofill | null;
  saveFailed: boolean;
  /** Another browser tab saved changes after this one loaded. */
  otherTabChanged: boolean;
};

export type Action =
  | { type: "ADD_STUDENT"; id: string; input: NewStudentInput }
  | { type: "ADD_STUDENTS"; entries: { id: string; input: NewStudentInput }[] }
  | { type: "UPDATE_STUDENT"; id: string; input: NewStudentInput }
  | { type: "REMOVE_STUDENT"; id: string }
  | { type: "SELECT_STUDENT"; id: string | null }
  | { type: "TOGGLE_SLOT"; day: Day; start: number }
  | { type: "CONFIRM_OVERRIDE" }
  | { type: "CANCEL_OVERRIDE" }
  | { type: "SET_RANGE"; day: Day; from: number; to: number; assign: boolean }
  | { type: "FILL_GAP"; studentId: string; day: Day; from: number; to: number }
  | { type: "IMPORT_SHIFTS"; entries: { studentId: string; day: Day; start: number; end: number }[] }
  | { type: "SET_SETTINGS"; settings: Partial<ScheduleSettings> }
  | { type: "SET_SEMESTER"; semester: SemesterConfig | null }
  | { type: "AUTOFILL"; replace: boolean }
  | { type: "CLEAR_SHIFTS" }
  | { type: "RESET_DEMO" }
  | { type: "CLEAR_ALL" }
  | { type: "LOAD_STATE"; state: PersistedStateV1; notes: string[] }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "TOAST"; message: string | null }
  | { type: "SAVE_STATUS"; failed: boolean }
  | { type: "OTHER_TAB_CHANGED" };

/** How many undo steps are kept; older ones are forgotten so memory doesn't grow forever. */
const HISTORY_LIMIT = 100;
/** Counts up for every message, so showing the same text twice still counts as a new message. */
let toastSeq = 0;

/** A short pop-up message (a "toast") with a fresh id. */
function toast(message: string): State["toast"] {
  toastSeq += 1;
  return { id: toastSeq, message };
}

/** Ids come from content, so reducers stay pure and a shift keeps the same id across undo/redo. */
function manualId(studentId: string, day: Day, start: number): string {
  return `manual-${studentId}-${day}-${start}`;
}

/** Turns what the manager typed in the student form into a full student record. */
function toStudent(id: string, input: NewStudentInput, color: string): Student {
  return {
    id,
    name: input.name.trim(),
    color,
    ...(input.avatar ? { avatar: input.avatar } : {}),
    preference: input.preference,
    daysPerWeek: input.daysPerWeek,
    classText: input.classText,
    blockedText: input.blockedText,
    busy: buildBusy(input.classText, input.blockedText).busy,
    latestEnd: input.latestEnd,
    lunchStart: input.lunchStart,
    needsOpeningShift: input.needsOpeningShift,
  };
}

/** First palette color no current student uses, so two students never share a color until the palette runs out. */
function nextColor(students: Student[]): string {
  const used = new Set(students.map((s) => s.color));
  return STUDENT_COLORS.find((c) => !used.has(c)) ?? STUDENT_COLORS[students.length % STUDENT_COLORS.length];
}

/** What the app starts with: the schedule saved in this browser if there is one, otherwise the demo data. */
export function initialState(): State {
  const saved = storage.load();
  const base = { past: [], future: [], toast: null, pendingOverride: null, lastAutofill: null, saveFailed: false, otherTabChanged: false };
  if (saved) {
    return {
      ...base,
      doc: {
        settings: saved.settings,
        students: saved.students,
        assignments: saved.assignments,
        otherTermAssignments: saved.otherTermAssignments ?? [],
        semester: saved.semester ?? null,
      },
      selectedStudentId: saved.selectedStudentId,
    };
  }
  const demo = buildDemoData();
  return {
    ...base,
    doc: { settings: DEFAULT_SETTINGS, students: demo.students, assignments: demo.assignments, otherTermAssignments: [], semester: null },
    selectedStudentId: demo.students[0]?.id ?? null,
  };
}

/**
 * Applies a change to the schedule and records the old version as an undo step (named by
 * `label`, e.g. "Auto-fill"). Any "redo" steps are cleared, since the history has now branched.
 */
function commit(state: State, doc: Doc, label: string, extra: Partial<State> = {}): State {
  return {
    ...state,
    doc,
    past: [...state.past, { doc: state.doc, label }].slice(-HISTORY_LIMIT),
    future: [],
    ...extra,
  };
}

/** Keeps the selected student if they still exist; otherwise selects the first student (or nobody). */
function fixSelection(doc: Doc, selected: string | null): string | null {
  return selected && doc.students.some((s) => s.id === selected) ? selected : (doc.students[0]?.id ?? null);
}

/** A count with the right word form, e.g. plural(1, "shift") -> "1 shift", plural(3, "shift") -> "3 shifts". */
function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Adds (or clears) a student's shifts across a stretch of one day. Boxes that break a rule are
 * skipped rather than forced, and the message says how many and why.
 */
function fillRange(doc: Doc, student: Student, day: Day, from: number, to: number, assign: boolean) {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const step = doc.settings.slotMinutes;
  let assignments = doc.assignments;
  let changed = 0;
  let skipped = 0;
  let firstSkip = "";
  for (let m = lo; m <= hi; m += step) {
    if (assign) {
      if (isAssigned(student.id, day, m, assignments)) continue;
      const violation = canAssign(student, day, m, assignments, doc.settings);
      if (violation) {
        skipped++;
        if (!firstSkip) firstSkip = `${student.name} ${violation.message}`;
        continue;
      }
      assignments = [...assignments, { id: manualId(student.id, day, m), studentId: student.id, day, start: m, source: "manual" }];
      changed++;
    } else if (isAssigned(student.id, day, m, assignments)) {
      assignments = assignments.filter((a) => !(a.studentId === student.id && a.day === day && a.start === m));
      changed++;
    }
  }
  const range = `${DAY_LABEL[day]} ${formatMinutes(lo)}–${formatMinutes(hi + step)}`;
  const verb = assign ? "Added" : "Cleared";
  const message =
    skipped > 0
      ? `${verb} ${plural(changed, "slot")} on ${range}. Skipped ${plural(skipped, "slot")} (${firstSkip}).`
      : `${verb} ${plural(changed, "slot")} on ${range}.`;
  return { assignments, changed, skipped, firstSkip, message, verb };
}

/**
 * The one function that turns "the current state + something the user did" into
 * "the new state". React calls this automatically (via `useReducer` below) every
 * time `dispatch(action)` is called anywhere in the app. Each `case` below handles
 * one `Action` type; most end by calling `commit`, which also pushes the previous
 * `doc` onto the undo stack (`past`) so it's the standard way to make a change that
 * should be undoable. A few actions (selecting a student, dismissing a toast) skip
 * `commit` on purpose, because they aren't schedule changes worth an Undo step.
 */
export function reducer(state: State, action: Action): State {
  const { doc } = state;
  switch (action.type) {
    case "ADD_STUDENT": {
      const student = toStudent(action.id, action.input, nextColor(doc.students));
      return commit(state, { ...doc, students: [...doc.students, student] }, `Added ${student.name}`, {
        selectedStudentId: student.id,
        toast: toast(`Added ${student.name}. Click the schedule to give them shifts, or press Auto-fill.`),
      });
    }
    case "ADD_STUDENTS": {
      const room = Math.max(0, MAX_STUDENTS - doc.students.length);
      const entries = action.entries.slice(0, room);
      if (!entries.length) return { ...state, toast: toast(`Cadence can hold up to ${MAX_STUDENTS} students, so nobody was added.`) };
      const students = [...doc.students];
      for (const e of entries) students.push(toStudent(e.id, e.input, nextColor(students)));
      const cut = action.entries.length - entries.length;
      return commit(state, { ...doc, students }, `Added ${plural(entries.length, "student")}`, {
        selectedStudentId: state.selectedStudentId ?? students[doc.students.length].id,
        toast: toast(
          `Added ${plural(entries.length, "student")}${cut ? ` (${cut} more didn't fit under the limit of ${MAX_STUDENTS})` : ""}. Press Fill schedule for me to place their shifts.`,
        ),
      });
    }
    case "UPDATE_STUDENT": {
      const existing = doc.students.find((s) => s.id === action.id);
      if (!existing) return state;
      const updated = toStudent(action.id, action.input, existing.color);
      return commit(
        state,
        { ...doc, students: doc.students.map((s) => (s.id === action.id ? updated : s)) },
        `Edited ${updated.name}`,
        { toast: toast(`Saved changes to ${updated.name}.`) },
      );
    }
    case "REMOVE_STUDENT": {
      const student = doc.students.find((s) => s.id === action.id);
      if (!student) return state;
      const next: Doc = {
        ...doc,
        students: doc.students.filter((s) => s.id !== action.id),
        assignments: doc.assignments.filter((a) => a.studentId !== action.id),
        otherTermAssignments: doc.otherTermAssignments.filter((a) => a.studentId !== action.id),
      };
      return commit(state, next, `Removed ${student.name}`, {
        selectedStudentId: fixSelection(next, state.selectedStudentId),
        toast: toast(`Removed ${student.name}. You can press Undo to bring them back.`),
      });
    }
    case "SELECT_STUDENT":
      return { ...state, selectedStudentId: action.id };
    case "TOGGLE_SLOT": {
      const student = doc.students.find((s) => s.id === state.selectedStudentId);
      if (!student) return { ...state, toast: toast("Pick a student on the left first.") };
      const existing = doc.assignments.find(
        (a) => a.studentId === student.id && a.day === action.day && a.start === action.start,
      );
      if (existing) {
        return commit(
          state,
          { ...doc, assignments: doc.assignments.filter((a) => a !== existing) },
          `Removed a shift for ${student.name}`,
        );
      }
      const violation = canAssign(student, action.day, action.start, doc.assignments, doc.settings);
      if (violation) {
        const soft = violation.code === "over_weekly_target" || violation.code === "over_max_days";
        if (soft) {
          const all = softViolations(student, action.day, action.start, doc.assignments, doc.settings).map((v) => v.message);
          const message = `${student.name} ${all.join(" and ")}.`;
          return {
            ...state,
            pendingOverride: { studentId: student.id, day: action.day, start: action.start, message },
          };
        }
        return { ...state, toast: toast(`${student.name} ${violation.message}. Pick a different time.`) };
      }
      const block: ShiftBlock = { id: manualId(student.id, action.day, action.start), studentId: student.id, day: action.day, start: action.start, source: "manual" };
      return commit(state, { ...doc, assignments: [...doc.assignments, block] }, `Added a shift for ${student.name}`);
    }
    case "CONFIRM_OVERRIDE": {
      const pending = state.pendingOverride;
      if (!pending) return state;
      const student = doc.students.find((s) => s.id === pending.studentId);
      if (!student) return { ...state, pendingOverride: null };
      const block: ShiftBlock = {
        id: manualId(pending.studentId, pending.day, pending.start),
        studentId: pending.studentId,
        day: pending.day,
        start: pending.start,
        source: "manual",
        override: true,
      };
      return commit(state, { ...doc, assignments: [...doc.assignments, block] }, `Added an extra shift for ${student.name}`, {
        pendingOverride: null,
        toast: toast(`Added anyway. ${student.name} is now over a limit and will show a warning.`),
      });
    }
    case "CANCEL_OVERRIDE":
      return { ...state, pendingOverride: null };
    case "SET_RANGE": {
      const student = doc.students.find((s) => s.id === state.selectedStudentId);
      if (!student) return { ...state, toast: toast("Pick a student on the left first.") };
      const outcome = fillRange(doc, student, action.day, action.from, action.to, action.assign);
      if (!outcome.changed) return { ...state, toast: toast(outcome.message) };
      return commit(state, { ...doc, assignments: outcome.assignments }, `${outcome.verb} a range for ${student.name}`, { toast: toast(outcome.message) });
    }
    case "FILL_GAP": {
      const student = doc.students.find((s) => s.id === action.studentId);
      if (!student) return state;
      const outcome = fillRange(doc, student, action.day, action.from, action.to, true);
      if (!outcome.changed) return { ...state, toast: toast(outcome.message) };
      return commit(state, { ...doc, assignments: outcome.assignments }, `Filled a gap with ${student.name}`, { toast: toast(outcome.message) });
    }
    case "SET_SETTINGS": {
      const settings = { ...doc.settings, ...action.settings };
      const termChanged = (settings.term ?? "semester") !== (doc.settings.term ?? "semester");
      if (!termChanged) return commit(state, { ...doc, settings }, "Changed settings");
      // The semester and break schedules are separate: put the showing one aside and bring the other back.
      const swapped: Doc = { ...doc, settings, assignments: doc.otherTermAssignments, otherTermAssignments: doc.assignments };
      const message =
        settings.term === "break"
          ? `Showing the break schedule. Tuesday 11am–12pm is open, and students can work up to ${BREAK_WEEKLY_HOURS} hours a week. Your semester schedule is kept as it was.`
          : `Showing the semester schedule. Nobody works during Tuesday devotional (11am–12pm), and the limit is ${settings.weeklyTargetHours} hours a week. Your break schedule is kept as it was.`;
      return commit(state, swapped, settings.term === "break" ? "Switched to semester break" : "Switched to semester", {
        lastAutofill: null,
        toast: toast(message),
      });
    }
    case "IMPORT_SHIFTS": {
      // Each pasted shift goes through the same rule checks as a click on the grid. A shift that
      // breaks a hard rule (class, lunch, cutoff) or a limit is skipped and counted, never forced.
      let assignments = doc.assignments;
      let placed = 0;
      let skipped = 0;
      let firstSkip = "";
      for (const entry of action.entries) {
        const student = doc.students.find((s) => s.id === entry.studentId);
        if (!student) continue;
        const from = entry.start;
        const to = entry.end - doc.settings.slotMinutes;
        if (to < from) continue;
        const outcome = fillRange({ ...doc, assignments }, student, entry.day, from, to, true);
        assignments = outcome.assignments;
        placed += outcome.changed;
        skipped += outcome.skipped;
        if (!firstSkip && outcome.firstSkip) firstSkip = outcome.firstSkip;
      }
      if (!placed) {
        return { ...state, toast: toast(skipped ? `Nothing was added: every shift broke a rule (${firstSkip}).` : "Nothing new to add — those shifts are already on the schedule.") };
      }
      const tail = skipped ? ` Skipped ${plural(skipped, "half hour")} that broke a rule (${firstSkip}).` : "";
      return commit(state, { ...doc, assignments }, "Imported pasted shifts", {
        toast: toast(`Added ${plural((placed * doc.settings.slotMinutes) / 60, "hour")} of pasted shifts.${tail}`),
      });
    }
    case "SET_SEMESTER":
      return commit(state, { ...doc, semester: action.semester }, "Changed calendar dates");
    case "AUTOFILL": {
      const result = autoFill(doc.students, doc.assignments, doc.settings, { replaceAutoFilled: action.replace });
      const lastAutofill: LastAutofill = {
        explanations: result.explanations,
        unmet: result.unmet,
        openingShiftUnmet: result.openingShiftUnmet,
      };
      const changed = scheduleVersion(result.assignments) !== scheduleVersion(doc.assignments);
      const notes: string[] = [];
      if (result.openingShiftUnmet.length) notes.push(`${plural(result.openingShiftUnmet.length, "student")} still need an opening shift`);
      if (result.unmet.length) notes.push(`${plural(result.unmet.length, "student")} can't reach ${weeklyLimit(doc.settings)} hours`);
      const tail = notes.length ? ` Heads up: ${notes.join("; ")}. See Insights for why.` : " Everyone is at their target.";
      const added = Math.max(0, result.assignments.length - doc.assignments.length);
      const message = !changed
        ? `Nothing to change — the schedule is already as full as the rules allow.${tail}`
        : action.replace
          ? `Rebuilt the automatic shifts.${tail}`
          : `Added ${plural((added * doc.settings.slotMinutes) / 60, "hour")} of shifts.${tail}`;
      if (!changed) return { ...state, lastAutofill, toast: toast(message) };
      return commit(state, { ...doc, assignments: result.assignments }, action.replace ? "Rebuilt auto-fill" : "Auto-filled shifts", {
        lastAutofill,
        toast: toast(message),
      });
    }
    case "CLEAR_SHIFTS": {
      const which = doc.settings.term === "break" ? "break" : "semester";
      return commit(state, { ...doc, assignments: [] }, `Cleared the ${which} shifts`, {
        lastAutofill: null,
        toast: toast(`Cleared all shifts in the ${which} schedule. The other schedule is untouched. You can press Undo to get them back.`),
      });
    }
    case "RESET_DEMO": {
      const demo = buildDemoData();
      // The sample shifts are semester shifts; during a break the break schedule starts empty.
      const onBreak = doc.settings.term === "break";
      const next: Doc = {
        ...doc,
        students: demo.students,
        assignments: onBreak ? [] : demo.assignments,
        otherTermAssignments: onBreak ? demo.assignments : [],
      };
      return commit(state, next, "Reset to sample data", {
        selectedStudentId: fixSelection(next, null),
        lastAutofill: null,
        toast: toast("Sample data restored."),
      });
    }
    case "CLEAR_ALL": {
      const next: Doc = { ...doc, students: [], assignments: [], otherTermAssignments: [] };
      return commit(state, next, "Cleared everything", {
        selectedStudentId: null,
        lastAutofill: null,
        toast: toast("Everything cleared. Press Undo if that was a mistake."),
      });
    }
    case "LOAD_STATE": {
      const next: Doc = {
        settings: action.state.settings,
        students: action.state.students,
        assignments: normalizeAssignments(action.state.assignments),
        otherTermAssignments: normalizeAssignments(action.state.otherTermAssignments ?? []),
        semester: action.state.semester ?? null,
      };
      return commit(state, next, "Imported a backup", {
        selectedStudentId: fixSelection(next, action.state.selectedStudentId),
        lastAutofill: null,
        toast: toast(["Backup imported.", ...action.notes].join(" ")),
      });
    }
    case "UNDO": {
      const entry = state.past[state.past.length - 1];
      if (!entry) return state;
      return {
        ...state,
        doc: entry.doc,
        past: state.past.slice(0, -1),
        future: [{ doc, label: entry.label }, ...state.future],
        selectedStudentId: fixSelection(entry.doc, state.selectedStudentId),
        toast: toast(`Undid: ${entry.label}`),
      };
    }
    case "REDO": {
      const entry = state.future[0];
      if (!entry) return state;
      return {
        ...state,
        doc: entry.doc,
        past: [...state.past, { doc, label: entry.label }],
        future: state.future.slice(1),
        selectedStudentId: fixSelection(entry.doc, state.selectedStudentId),
        toast: toast(`Redid: ${entry.label}`),
      };
    }
    case "TOAST":
      return { ...state, toast: action.message ? toast(action.message) : null };
    case "SAVE_STATUS":
      return { ...state, saveFailed: action.failed };
    case "OTHER_TAB_CHANGED":
      return state.otherTabChanged ? state : { ...state, otherTabChanged: true };
    default:
      return state;
  }
}

/**
 * React "hook" that `App.tsx` calls once. It wires the reducer above into React
 * (`useReducer` — React's built-in helper for "state that changes via actions"),
 * automatically saves to the browser after every change, and returns a single
 * object holding both the current data (`students`, `assignments`, ...) and an
 * `actions` object of easy-to-call functions. Components never call `dispatch`
 * or build `Action` objects directly — they call things like
 * `store.addStudent(...)` or `store.toggleSlot(...)`.
 */
export function useShiftFitStore() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Auto-save: any time the schedule data changes, write it to localStorage.
  // If the browser refuses to save (storage full/blocked), flag it so the UI
  // can warn the manager instead of silently losing their work.
  useEffect(() => {
    const persisted: PersistedStateV1 = {
      version: 1,
      settings: state.doc.settings,
      students: state.doc.students,
      assignments: state.doc.assignments,
      otherTermAssignments: state.doc.otherTermAssignments,
      selectedStudentId: state.selectedStudentId,
      semester: state.doc.semester,
    };
    const ok = storage.save(persisted);
    if (!ok && !stateRef.current.saveFailed) {
      dispatch({ type: "SAVE_STATUS", failed: true });
    } else if (ok && stateRef.current.saveFailed) {
      dispatch({ type: "SAVE_STATUS", failed: false });
    }
  }, [state.doc, state.selectedStudentId]);

  // If another tab saves, this tab's next save would silently overwrite it, so say so.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY || e.key === null) dispatch({ type: "OTHER_TAB_CHANGED" });
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const selectedStudent = useMemo(
    () => state.doc.students.find((s) => s.id === state.selectedStudentId) ?? null,
    [state.doc.students, state.selectedStudentId],
  );

  const actions = useMemo(
    () => ({
      addStudent: (input: NewStudentInput) => dispatch({ type: "ADD_STUDENT", id: createId("student"), input }),
      addStudents: (rows: { name: string; classText: string }[]) =>
        dispatch({
          type: "ADD_STUDENTS",
          entries: rows.map((r) => ({
            id: createId("student"),
            input: {
              name: r.name,
              preference: "any",
              daysPerWeek: 5,
              classText: r.classText,
              blockedText: "",
              latestEnd: NO_CUTOFF,
              lunchStart: 12 * 60,
              needsOpeningShift: false,
            },
          })),
        }),
      updateStudent: (id: string, input: NewStudentInput) => dispatch({ type: "UPDATE_STUDENT", id, input }),
      removeStudent: (id: string) => dispatch({ type: "REMOVE_STUDENT", id }),
      selectStudent: (id: string | null) => dispatch({ type: "SELECT_STUDENT", id }),
      toggleSlot: (day: Day, start: number) => dispatch({ type: "TOGGLE_SLOT", day, start }),
      setRange: (day: Day, from: number, to: number, assign: boolean) => dispatch({ type: "SET_RANGE", day, from, to, assign }),
      fillGap: (studentId: string, day: Day, from: number, to: number) => dispatch({ type: "FILL_GAP", studentId, day, from, to }),
      importShifts: (entries: { studentId: string; day: Day; start: number; end: number }[]) => dispatch({ type: "IMPORT_SHIFTS", entries }),
      confirmOverride: () => dispatch({ type: "CONFIRM_OVERRIDE" }),
      cancelOverride: () => dispatch({ type: "CANCEL_OVERRIDE" }),
      setSettings: (settings: Partial<ScheduleSettings>) => dispatch({ type: "SET_SETTINGS", settings }),
      setSemester: (semester: SemesterConfig | null) => dispatch({ type: "SET_SEMESTER", semester }),
      runAutoFill: (replace = false) => dispatch({ type: "AUTOFILL", replace }),
      clearShifts: () => dispatch({ type: "CLEAR_SHIFTS" }),
      resetDemo: () => dispatch({ type: "RESET_DEMO" }),
      clearAll: () => dispatch({ type: "CLEAR_ALL" }),
      loadState: (s: PersistedStateV1, notes: string[] = []) => dispatch({ type: "LOAD_STATE", state: s, notes }),
      undo: () => dispatch({ type: "UNDO" }),
      redo: () => dispatch({ type: "REDO" }),
      notify: (message: string) => dispatch({ type: "TOAST", message }),
      dismissToast: () => dispatch({ type: "TOAST", message: null }),
    }),
    [],
  );

  return {
    settings: state.doc.settings,
    students: state.doc.students,
    assignments: state.doc.assignments,
    otherTermAssignments: state.doc.otherTermAssignments,
    semester: state.doc.semester,
    selectedStudent,
    toast: state.toast,
    pendingOverride: state.pendingOverride,
    lastAutofill: state.lastAutofill,
    saveFailed: state.saveFailed,
    otherTabChanged: state.otherTabChanged,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    undoLabel: state.past[state.past.length - 1]?.label ?? null,
    redoLabel: state.future[0]?.label ?? null,
    ...actions,
  };
}

export type ShiftFitStore = ReturnType<typeof useShiftFitStore>;
