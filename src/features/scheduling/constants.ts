import type { ScheduleSettings, Minutes } from "./types";

/**
 * ============================================================================
 *  TUNABLE NUMBERS FOR THE SCHEDULING RULES
 * ============================================================================
 * Every "magic number" the scheduler cares about (default hours, shift-length
 * limits, how many students the app allows) lives in this one file instead of
 * being typed directly into the logic files. If a rule needs to change later
 * (say, the weekly hour cap), this is the one place to look.
 */

/** All scheduling rules live here instead of scattered magic numbers. */
export const DEFAULT_SETTINGS: ScheduleSettings = {
  openTime: 7 * 60,
  closeTime: 24 * 60, // midnight — the day runs 7:00am to 12:00am
  minStaffPerSlot: 1,
  slotMinutes: 30,
  weeklyTargetHours: 19,
  term: "semester",
  // The pilot office (a library desk) is open Monday to Saturday. Older saved schedules have no
  // value here and are read as Monday to Friday, so nothing changes for them (see `openDays`).
  openDays: "mon-sat",
};

/** During a semester break students may work up to this many hours a week (instead of `weeklyTargetHours`). */
export const BREAK_WEEKLY_HOURS = 40;

/** Tuesday devotional: during the semester nobody is scheduled in this hour, and it isn't counted as a gap. */
export const DEVOTIONAL = { day: "tue", start: 11 * 60, end: 12 * 60 } as const;

/**
 * The office-hours choices a manager picks from (Settings → Office hours): open at 7:00am or 8:00am,
 * close at 5:00pm or midnight. `closeTime` 24 * 60 means midnight at the END of the day.
 */
export const OFFICE_HOURS_OPTIONS: { openTime: Minutes; closeTime: Minutes }[] = [
  { openTime: 7 * 60, closeTime: 24 * 60 },
  { openTime: 7 * 60, closeTime: 17 * 60 },
  { openTime: 8 * 60, closeTime: 24 * 60 },
  { openTime: 8 * 60, closeTime: 17 * 60 },
];

/** Break lengths a manager can pick for a student's break, in minutes. */
export const BREAK_LENGTH_OPTIONS = [15, 30, 45, 60];

/** The break a new break row starts as (lunch at noon for 30 minutes), and what an old saved lunch time becomes. */
export const DEFAULT_BREAK_MINUTES = 30;
export const DEFAULT_BREAK_START: Minutes = 12 * 60;

/** Most days a week anyone can work: Monday to Saturday. */
export const MAX_DAYS_PER_WEEK = 6;

/** Most breaks one student can have in a day. Three covers lunch plus two short rests on a long day. */
export const MAX_BREAKS = 3;

export const MIN_STAFF_OPTIONS = [1, 2];

/** The clock time a "required opening shift" must start at. Independent of the visible open-hours view. */
export const OPENING_SHIFT_START: Minutes = 7 * 60;

/**
 * A "required opening shift" must be a real contiguous block, not a single slot —
 * the prototype this replaces treated any one 30-minute assignment at the opening
 * time as satisfying the requirement.
 */
export const MIN_OPENING_SHIFT_MINUTES = 60;

/** "No cutoff" for a student: they can work until the office closes, whenever that is. */
export const NO_CUTOFF: Minutes = 24 * 60;

/** Shortest shift allowed. Auto-fill never makes a shorter one; a shorter hand-made shift is flagged as a problem. */
export const MIN_SHIFT_MINUTES = 120;

/** Auto-fill never creates a single contiguous block longer than this. */
export const MAX_SHIFT_MINUTES = 240;

/**
 * Auto-fill first spreads a student's hours evenly across their work days. If that leaves them short
 * of their weekly hours, it may add this many extra hours to a single day before giving up.
 */
export const RELAXED_DAY_EXTRA_HOURS = 2;

/** Largest photo a person may pick. The app shrinks it to a small thumbnail before saving. */
export const MAX_AVATAR_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Side length (px) of the saved square thumbnail. */
export const AVATAR_SIZE = 128;
/**
 * Longest saved thumbnail data URL we accept (about 12 KB). Browser storage holds roughly 5 MB in
 * total and backup files are capped at 5 MB, so 200 students x 16,000 characters (3.2 MB worst
 * case) still fits. The resizer lowers JPEG quality until a photo is under this.
 */
export const MAX_AVATAR_CHARS = 16_000;

export const MAX_STUDENTS = 200;
export const MAX_ASSIGNMENTS = 5000;

/** Every color keeps >= 4.5:1 contrast with white chip text (enforced in src/test/contrast.test.ts). */
export const STUDENT_COLORS = [
  "#1F6FB2",
  "#1F7A5C",
  "#8E44AD",
  "#B3144F",
  "#A86200",
  "#0E7C86",
  "#5563D0",
  "#5E6E24",
];
