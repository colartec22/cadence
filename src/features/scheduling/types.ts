/**
 * ============================================================================
 *  SHARED "SHAPES" FOR THE SCHEDULING ENGINE
 * ============================================================================
 * This file has no logic in it — it only describes the SHAPE of the data every
 * other file in `src/features/scheduling/` reads and writes (TypeScript calls
 * these shapes "types"). Think of it as the glossary/blueprint for the app:
 * every other scheduling file imports names from here instead of re-describing
 * the same data differently in five places.
 *
 * A few conventions used everywhere below:
 * - Time of day is stored as `Minutes`, an integer number of minutes since
 *   midnight (9:00am = 540, 5:00pm = 1020). This makes comparing and adding
 *   times plain arithmetic instead of string/Date juggling. `formatMinutes`
 *   in `time.ts` turns a number like 540 back into "9:00am" for display.
 * - The work week only covers Monday–Friday (see `Day` below); there is no
 *   weekend scheduling in this app.
 */

/** One weekday, Monday through Friday. Short lowercase code used as a key everywhere (grids, lookups, calendar files). */
export type Day = "mon" | "tue" | "wed" | "thu" | "fri";

export const DAYS: Day[] = ["mon", "tue", "wed", "thu", "fri"];

export const DAY_LABEL: Record<Day, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
};

export const DAY_LONG: Record<Day, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
};

/** Minutes from midnight. See the file banner above for why times are stored this way. */
export type Minutes = number;

/** A student's preferred time of day to work, used as a soft tiebreaker by auto-fill (never overrides a hard rule like class conflicts). */
export type Preference = "any" | "morning" | "afternoon";

/**
 * A block of time a student is NOT available to work. Three kinds:
 * - "class": parsed from the student's pasted class schedule text.
 * - "lunch": reserved automatically from `Student.lunchStart` (see below).
 * - "manual": parsed from the "other times they can't work" text field (second job, appointment, etc).
 * The scheduler treats all three as equally off-limits; only the `source` differs (used for messages like "has class" vs "is unavailable").
 */
export type BusyBlock = {
  day: Day;
  start: Minutes;
  end: Minutes;
  source: "class" | "lunch" | "manual";
};

/**
 * One assigned slot of length `ScheduleSettings.slotMinutes` (the app's 30-minute
 * granularity). A contiguous shift is represented as several adjacent ShiftBlocks
 * rather than one block with its own `end`, since every consumer (the grid, the
 * scheduler, coverage/hour calculations) already works slot-by-slot.
 */
export type ShiftBlock = {
  id: string;
  studentId: string;
  day: Day;
  start: Minutes;
  source: "manual" | "autofill";
  /** Manager explicitly overrode a soft limit (weekly target / max days) for this slot. */
  override?: boolean;
};

/** One student worker: their name, their weekly rules, and the times they can't work (parsed into `busy`). */
export type Student = {
  /** Stable unique id, generated once when the student is added (see `src/lib/id.ts`). Never changes, even if the name is edited. */
  id: string;
  name: string;
  /** Hex color used for this student's chips/highlights across the grid and views. Picked from `STUDENT_COLORS` in `constants.ts`. */
  color: string;
  /** Optional profile photo: a small square JPEG stored as a data URL (see `src/lib/image.ts`). Absent means show initials. */
  avatar?: string;
  preference: Preference;
  /** Most days per week this student may be scheduled, regardless of how many hours that leaves unfilled. */
  daysPerWeek: number;
  /** Raw pasted/typed class-time text, kept for re-editing. */
  classText: string;
  /** Raw text for other times they can't work (another job, appointments), same format as class times. */
  blockedText: string;
  /** Class blocks and manually blocked times, parsed from the two text fields above. */
  busy: BusyBlock[];
  /** Latest minute-of-day the student may work until (exclusive end bound). */
  latestEnd: Minutes;
  /** Start minute of a fixed 30-minute lunch break, or null. */
  lunchStart: Minutes | null;
  /** Requires one contiguous shift starting at OPENING_SHIFT_START (7:00am). */
  needsOpeningShift: boolean;
};

/**
 * Whether classes are in session. During the "semester" nobody works during Tuesday devotional
 * and the normal weekly limit applies; during a "break" that hour is open and students may work
 * up to BREAK_WEEKLY_HOURS (see `term.ts`).
 */
export type Term = "semester" | "break";

/** The office-wide rules that apply to every student (as opposed to per-student rules, which live on `Student`). Editable in the app's "Rules" dialog. */
export type ScheduleSettings = {
  /** When the visible schedule grid starts each day. */
  openTime: Minutes;
  /** When the visible schedule grid ends each day. */
  closeTime: Minutes;
  /** How many students must be on shift at once for a slot to count as "fully staffed". */
  minStaffPerSlot: number;
  /** Size of one grid box in minutes. The whole app works in units of this size (default 30). */
  slotMinutes: number;
  /** Default weekly hour cap offered to each new student (BYU–Hawaii's student-employment limit; see `docs/DECISIONS.md`). */
  weeklyTargetHours: number;
  /** Semester or break. Missing (older saved schedules) means "semester". */
  term?: Term;
  /** Most hours a student may work in a week during a break. Missing means BREAK_WEEKLY_HOURS (40). */
  breakWeeklyHours?: number;
  /** Shortest shift allowed, in hours. Missing means MIN_SHIFT_MINUTES (2 hours). */
  minShiftHours?: number;
};

/** Explicit dates + timezone are required for recurring calendar export; nothing is guessed. */
export type SemesterConfig = {
  /** ISO date (YYYY-MM-DD) recurrence begins on or after. */
  startDate: string;
  /** ISO date (YYYY-MM-DD), inclusive, recurrence ends. */
  endDate: string;
  /** IANA timezone, e.g. "Pacific/Honolulu". */
  timeZone: string;
  /** Holidays and breaks (ISO dates). Shifts that would fall on these days are skipped in calendar files. */
  skipDates?: string[];
};

/** Staffing snapshot of one grid box: who is assigned, how many are required, and whether that's enough. Computed fresh from `assignments` — never stored. */
export type CoverageSlot = {
  day: Day;
  start: Minutes;
  end: Minutes;
  assignedStudentIds: string[];
  minRequired: number;
  fullyStaffed: boolean;
};

/** A run of consecutive under-staffed CoverageSlots on the same day, merged into one readable range for "Schedule health" (e.g. "Mon 9:00am-11:00am, short 1"). */
export type GapRange = {
  day: Day;
  start: Minutes;
  end: Minutes;
  /** How many more students are needed to fully staff this range. */
  shortfall: number;
};

/**
 * Why a specific assignment attempt was rejected (used when the manager clicks a grid box,
 * or auto-fill tries a placement). Each code maps to one plain-language message in `availability.ts`.
 * "Hard" rules (class_conflict, unavailable, after_cutoff, lunch_conflict, devotional, already_assigned) can
 * never be overridden. "Soft" rules (over_weekly_target, over_max_days) can be, with a confirmation.
 */
export type ConstraintViolationCode =
  | "class_conflict"
  | "unavailable"
  | "after_cutoff"
  | "lunch_conflict"
  | "devotional"
  | "over_weekly_target"
  | "over_max_days"
  | "already_assigned";

export type ConstraintViolation = {
  code: ConstraintViolationCode;
  message: string;
};

/** A problem found in an existing schedule (as opposed to a rejected attempted assignment). */
export type ScheduleIssueCode =
  | "class_conflict"
  | "unavailable"
  | "after_cutoff"
  | "lunch_conflict"
  | "devotional"
  | "shift_too_short"
  | "over_weekly_target"
  | "over_max_days"
  | "opening_shift_missing";

export type ScheduleIssue = {
  code: ScheduleIssueCode;
  studentId: string;
  day?: Day;
  start?: Minutes;
  /** Exclusive end of a merged run of slots, when the issue spans several. */
  end?: Minutes;
  message: string;
  /** True when the manager knowingly overrode this soft limit — shown as a warning, not an error. */
  overridden: boolean;
};

/** The result of reading ONE line of pasted class-time text (see `parser.ts`). `ok: false` means the line could not be understood and is reported to the manager, never silently guessed. */
export type ParsedMeetingLine = {
  raw: string;
  ok: boolean;
  days?: Day[];
  start?: Minutes;
  end?: Minutes;
  /** Set even when `ok: true` — e.g. "no am/pm given, read as 9:00am-9:50am. Review before saving." */
  warning?: string;
  /** True for a course with no meeting time (online, asynchronous, TBA). It is understood, blocks nothing, and is not an error. */
  noMeeting?: boolean;
};

/** The result of reading a whole pasted block of text (many lines). `errors` are lines that were dropped; `warnings` are lines that were kept but should be double-checked. */
export type ParseResult = {
  busy: BusyBlock[];
  errors: string[];
  warnings: string[];
  lines: ParsedMeetingLine[];
};

/** One shift auto-fill decided to add, with the plain-language reason shown to the manager. `phase` records which pass of the algorithm placed it (see `scheduler.ts`). */
export type AutoFillExplanation = {
  studentId: string;
  day: Day;
  start: Minutes;
  end: Minutes;
  phase: "opening" | "coverage" | "top-up";
  reason: string;
};

/** Everything "Fill schedule for me" produces in one run: the shifts it added, who it couldn't fully place, and why (see `scheduler.ts`). */
export type AutoFillResult = {
  assignments: ShiftBlock[];
  /** Students who could not reach the weekly target hours. */
  unmet: { studentId: string; reason: string }[];
  /** Students whose required opening shift could not be placed. */
  openingShiftUnmet: { studentId: string; reason: string }[];
  explanations: AutoFillExplanation[];
  /** Always `true`. A reminder to callers that this is a rules-based planner, not AI — the same input always produces this exact same output. */
  deterministic: true;
};

/**
 * The whole app's state as it is saved to and loaded from the browser's `localStorage`
 * (see `src/features/persistence/storage.ts`). `version: 1` lets a future redesign of
 * this shape migrate old saved data instead of breaking it — see `PersistedStateV1` usages
 * in `storage.ts` for how that migration would be added.
 */
export type PersistedStateV1 = {
  version: 1;
  settings: ScheduleSettings;
  students: Student[];
  /** Shifts of the schedule that is showing (semester or break, whichever `settings.term` says). */
  assignments: ShiftBlock[];
  /**
   * Shifts of the OTHER schedule, set aside while it isn't showing. The semester and break
   * schedules are kept separately; switching swaps them. Missing in older saved data.
   */
  otherTermAssignments?: ShiftBlock[];
  selectedStudentId: string | null;
  /** Optional: only present once the manager configures calendar export. */
  semester?: SemesterConfig | null;
};
