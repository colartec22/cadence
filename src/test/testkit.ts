import { DEFAULT_SETTINGS, NO_CUTOFF } from "../features/scheduling/constants";
import type { ScheduleSettings, ShiftBlock, Student } from "../features/scheduling/types";
import type { Day } from "../features/scheduling/types";

/** Shared builders so each test states only the facts it cares about. */
export function makeStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: "s1",
    name: "Test Student",
    color: "#1F6FB2",
    preference: "any",
    daysPerWeek: 5,
    classText: "",
    blockedText: "",
    busy: [],
    latestEnd: NO_CUTOFF,
    breaks: [],
    needsOpeningShift: false,
    ...overrides,
  };
}

/** The default office rules (Monday to Friday), with any changes a test asks for. */
export function makeSettings(overrides: Partial<ScheduleSettings> = {}): ScheduleSettings {
  // The rule tests were written for a Monday–Friday office, so they keep it unless a test asks for
  // Saturday (`openDays: "mon-sat"`); the app itself starts new schedules on Monday–Saturday.
  return { ...DEFAULT_SETTINGS, openDays: "mon-fri", ...overrides };
}

/** One half-hour shift for a student, starting at `start` minutes after midnight. */
export function slot(studentId: string, day: Day, start: number, source: ShiftBlock["source"] = "manual"): ShiftBlock {
  return { id: `${source}-${studentId}-${day}-${start}`, studentId, day, start, source };
}

/** Consecutive 30-minute slots from `start` (inclusive) to `end` (exclusive). */
export function run(studentId: string, day: Day, start: number, end: number, source: ShiftBlock["source"] = "manual"): ShiftBlock[] {
  const out: ShiftBlock[] = [];
  for (let m = start; m < end; m += 30) out.push(slot(studentId, day, m, source));
  return out;
}
