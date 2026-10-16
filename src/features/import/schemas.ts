import { DEFAULT_BREAK_MINUTES, MAX_BREAKS, MAX_DAYS_PER_WEEK } from "../scheduling/constants";
import { DAYS } from "../scheduling/types";
import type { WorkBreak } from "../scheduling/types";

/** Structured, review-required output of AI/OCR schedule extraction. Never applied to state unmodified. */
export type ExtractedSchedule = {
  requestId: string;
  status: "ok" | "needs_review" | "error";
  confidence: number;
  meetings: { day: string; start: number; end: number; source: "class" }[];
  constraints: {
    latestEnd: number | null;
    /** The student's breaks. Older readers send one `lunchStart` time instead; it becomes a 30-minute break here. */
    breaks: WorkBreak[];
    needsOpeningShift: boolean;
    preference: "any" | "morning" | "afternoon";
    daysPerWeek: number | null;
  };
  warnings: string[];
  unresolved: string[];
};

/** True for a plain object like `{ ... }` (not null, not a list). */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const FULL_DAYS = new Set(DAYS);

/** True for a whole number of minutes from midnight (0) up to the next midnight (1440). */
function inDay(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 24 * 60;
}

/** Longest break accepted from a reader, in minutes (same limit as saved data). */
const MAX_BREAK_MINUTES = 240;

/**
 * Reads the breaks a reader found: a `breaks` list of { start, minutes }, or (from older readers) a single
 * `lunchStart` time, which becomes one 30-minute break. Bad entries are dropped, never guessed at, and at
 * most MAX_BREAKS are kept. The manager still reviews the result before anything is saved.
 */
function readExtractedBreaks(constraints: Record<string, unknown>): WorkBreak[] {
  if (Array.isArray(constraints.breaks)) {
    return constraints.breaks
      .filter(
        (b): b is { start: number; minutes: number } =>
          isRecord(b) &&
          inDay(b.start) &&
          typeof b.minutes === "number" &&
          Number.isInteger(b.minutes) &&
          b.minutes > 0 &&
          b.minutes <= MAX_BREAK_MINUTES &&
          (b.start as number) + (b.minutes as number) <= 24 * 60,
      )
      .slice(0, MAX_BREAKS)
      .map((b) => ({ start: b.start, minutes: b.minutes }));
  }
  return inDay(constraints.lunchStart) ? [{ start: constraints.lunchStart, minutes: DEFAULT_BREAK_MINUTES }] : [];
}

/**
 * Validates untrusted AI/OCR extraction output against a strict schema before it
 * is allowed anywhere near application state or the add-student form. Pasted
 * text and OCR/AI output are data, never instructions — this only ever produces
 * a plain data object, and the caller still requires manager review before save.
 */
export function validateExtractedSchedule(input: unknown): { ok: true; value: ExtractedSchedule } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["Response was not a JSON object."] };

  if (typeof input.requestId !== "string") errors.push("requestId must be a string.");
  if (!["ok", "needs_review", "error"].includes(input.status as string)) errors.push("status is invalid.");
  if (typeof input.confidence !== "number" || input.confidence < 0 || input.confidence > 1) {
    errors.push("confidence must be a number between 0 and 1.");
  }

  const meetings = input.meetings;
  const cleanMeetings: ExtractedSchedule["meetings"] = [];
  if (!Array.isArray(meetings)) {
    errors.push("meetings must be an array.");
  } else {
    meetings.forEach((m, i) => {
      if (!isRecord(m) || !FULL_DAYS.has(m.day as never) || !inDay(m.start) || !inDay(m.end)) {
        errors.push(`meetings[${i}] is malformed.`);
        return;
      }
      if (m.end <= m.start) {
        errors.push(`meetings[${i}] end must be after start.`);
        return;
      }
      cleanMeetings.push({ day: m.day as string, start: m.start, end: m.end, source: "class" });
    });
  }

  const constraints = isRecord(input.constraints) ? input.constraints : {};

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      requestId: input.requestId as string,
      status: input.status as ExtractedSchedule["status"],
      confidence: input.confidence as number,
      meetings: cleanMeetings,
      constraints: {
        latestEnd: inDay(constraints.latestEnd) ? constraints.latestEnd : null,
        breaks: readExtractedBreaks(constraints),
        needsOpeningShift: Boolean(constraints.needsOpeningShift),
        preference: ["any", "morning", "afternoon"].includes(constraints.preference as string)
          ? (constraints.preference as ExtractedSchedule["constraints"]["preference"])
          : "any",
        daysPerWeek:
          typeof constraints.daysPerWeek === "number" && Number.isInteger(constraints.daysPerWeek) && constraints.daysPerWeek >= 1 && constraints.daysPerWeek <= MAX_DAYS_PER_WEEK
            ? constraints.daysPerWeek
            : null,
      },
      warnings: Array.isArray(input.warnings) ? input.warnings.slice(0, 20).map((w) => String(w).slice(0, 300)) : [],
      unresolved: Array.isArray(input.unresolved) ? input.unresolved.slice(0, 20).map((w) => String(w).slice(0, 300)) : [],
    },
  };
}
