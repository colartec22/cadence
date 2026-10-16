import { mergeContiguousBlocks, scheduleVersion } from "../../features/scheduling/blocks";
import { countWeeklyOccurrences, excludedOccurrences, isSemesterConfigured, rollOverMidnight } from "../../features/calendar/ics";
import type { Day, ScheduleSettings, SemesterConfig, ShiftBlock, Student } from "../../features/scheduling/types";

/**
 * ============================================================================
 *  THE "CONTRACT" WITH THE CALENDAR-PUBLISHING SERVER (n8n)
 * ============================================================================
 * Cadence itself never talks to Google Calendar. Instead, when the manager
 * presses "Save & share" -> publish, this app sends a plain description of
 * the approved shifts to a separate server (an automation tool called n8n —
 * see `docs/N8N_ARCHITECTURE.md` and the `n8n/` folder) which is responsible
 * for actually creating Google Calendar events. This file defines the exact
 * shape of that request and response (a "contract" both sides agree to), and
 * `validatePublishResponse` makes sure whatever comes back matches it before
 * the app trusts it — the same "never trust outside data blindly" pattern
 * used in `../../features/scheduling/validation.ts`.
 */

/**
 * A shift's real, repeatable calendar placement — a weekday + minutes-of-day alone isn't
 * enough for Google Calendar, which needs an actual first date, a timezone, and a recurrence
 * rule. This is only ever built from `SemesterConfig` (never guessed — same rule as the .ics
 * export in `../../features/calendar/ics.ts`, whose already-tested date math this reuses).
 */
export type PublishRecurrence = {
  /** ISO 8601 local date-time (no offset) of the FIRST occurrence's start, e.g. "2026-10-06T09:00:00". */
  startIso: string;
  /** Same, for the first occurrence's end. */
  endIso: string;
  /** IANA zone the times above are local to, e.g. "Pacific/Honolulu". */
  timeZone: string;
  /** RFC 5545 recurrence rule, weekly, e.g. "FREQ=WEEKLY;COUNT=12". */
  rrule: string;
  /** ISO 8601 local date-times to exclude from the recurrence (holidays/breaks that fall on this weekday). */
  exdates: string[];
};

export type PublishEventPayload = {
  studentId: string;
  studentName: string;
  day: Day;
  start: number;
  end: number;
  /** Stable per shift (student + day + start) so retries update instead of duplicating. */
  shiftId: string;
  /** Present only when the manager has saved semester dates and a timezone (see `isSemesterConfigured`). */
  recurrence?: PublishRecurrence;
};

export type PublishRequest = {
  scheduleVersion: string;
  events: PublishEventPayload[];
};

export type PublishEventStatus = "created" | "updated" | "unchanged" | "failed" | "dry_run";

export type PublishEventResult = {
  shiftId: string;
  status: PublishEventStatus;
  googleEventId?: string;
  error?: string;
};

export type PublishResponse = {
  scheduleVersion: string;
  results: PublishEventResult[];
  /**
   * Shifts that are still on Google Calendar from an EARLIER publish but are no longer in this
   * schedule (moved or removed). They are only reported here, never deleted automatically: the
   * manager is asked first, then `removeEvents` deletes them.
   */
  staleShiftIds?: string[];
};

export type SyncState = "not_synced" | "syncing" | "synced" | "partially_synced" | "sync_failed";

/** What happened to one old calendar event the manager asked to remove. */
export type RemoveEventStatus = "removed" | "not_found" | "failed" | "dry_run";

export type RemoveResponse = {
  results: { shiftId: string; status: RemoveEventStatus; error?: string }[];
};

/**
 * Only the schedule facts the server needs to re-check the rules and rebuild the calendar events.
 * Photos and the raw pasted class text are left out on purpose: the server doesn't need them, and
 * personal data that is never sent can never leak.
 */
export type ScheduleForServer = {
  students: Omit<Student, "avatar" | "classText" | "blockedText">[];
  assignments: ShiftBlock[];
  settings: ScheduleSettings;
  semester: SemesterConfig | null;
};

export type AutomationClient = {
  /** "server" when VITE_AUTOMATION_API_URL is set, "mock" otherwise. The UI must never imply a mock run reached Google Calendar. */
  kind: "server" | "mock";
  /**
   * Sends the schedule the manager approved. `request` is the same publish request built here in the
   * browser; the server rebuilds its own copy from `schedule` and refuses if they don't match.
   */
  publishSchedule(schedule: ScheduleForServer, request: PublishRequest): Promise<PublishResponse>;
  /** Deletes old calendar events (by shift id) that the manager has confirmed should go. */
  removeEvents(shiftIds: string[]): Promise<RemoveResponse>;
};

/** Largest number of old events one removal request may name (same as the most shifts a schedule can hold). */
export const MAX_REMOVALS = 5000;
/** Longest shift id accepted from a server (real ones are about 30 characters). */
const MAX_SHIFT_ID_LENGTH = 200;

/** The part of the schedule to send to the server: everything it needs, nothing it doesn't (see ScheduleForServer). */
export function scheduleForServer(
  students: Student[],
  assignments: ShiftBlock[],
  settings: ScheduleSettings,
  semester: SemesterConfig | null,
): ScheduleForServer {
  return {
    students: students.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      preference: s.preference,
      daysPerWeek: s.daysPerWeek,
      busy: s.busy,
      latestEnd: s.latestEnd,
      breaks: s.breaks,
      needsOpeningShift: s.needsOpeningShift,
    })),
    assignments,
    settings,
    semester,
  };
}

/** "2026-10-06" + 540 minutes -> "2026-10-06T09:00:00" (no timezone offset — paired with a separate `timeZone` field, same convention as the .ics export). */
function isoLocal(rawDate: Date, rawMinutes: number): string {
  // A shift ending at midnight is 1440 minutes; "24:00" is not a valid time, so it becomes 00:00 the next day.
  const { date, minutes } = rollOverMidnight(rawDate, rawMinutes);
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mi = String(minutes % 60).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${mi}:00`;
}

/** Builds the real-dates recurrence info for one weekly shift, or `undefined` if it has no calendar occurrence in the configured semester (or no semester is configured yet). */
function buildRecurrence(semester: SemesterConfig | null, day: Day, start: number, end: number): PublishRecurrence | undefined {
  if (!isSemesterConfigured(semester)) return undefined;
  const occurrences = countWeeklyOccurrences(semester, day);
  if (!occurrences) return undefined;
  const exdates = excludedOccurrences(semester, occurrences.first, occurrences.count).map((d) => isoLocal(d, start));
  return {
    startIso: isoLocal(occurrences.first, start),
    endIso: isoLocal(occurrences.first, end),
    timeZone: semester.timeZone,
    rrule: `FREQ=WEEKLY;COUNT=${occurrences.count}`,
    exdates,
  };
}

/**
 * Builds what gets sent to the calendar server: one event per whole shift (back-to-back half
 * hours joined), each with a stable `shiftId` so re-sending updates the same event instead of
 * making a copy, plus real dates (`recurrence`) once semester dates are saved.
 */
export function buildPublishRequest(
  students: Student[],
  assignments: ShiftBlock[],
  settings: ScheduleSettings,
  semester: SemesterConfig | null,
): PublishRequest {
  const names = new Map(students.map((s) => [s.id, s.name]));
  return {
    scheduleVersion: scheduleVersion(assignments),
    events: mergeContiguousBlocks(assignments, settings.slotMinutes).map((b) => {
      const recurrence = buildRecurrence(semester, b.day, b.start, b.end);
      return {
        studentId: b.studentId,
        studentName: names.get(b.studentId) ?? b.studentId,
        day: b.day,
        start: b.start,
        end: b.end,
        shiftId: `${b.studentId}-${b.day}-${b.start}`,
        ...(recurrence ? { recurrence } : {}),
      };
    }),
  };
}

const STATUSES: PublishEventStatus[] = ["created", "updated", "unchanged", "failed", "dry_run"];

/** Never trust a webhook's JSON: check the shape and that every result maps to something we sent. */
export function validatePublishResponse(
  json: unknown,
  request: PublishRequest,
): { ok: true; value: PublishResponse } | { ok: false; error: string } {
  if (typeof json !== "object" || json === null) return { ok: false, error: "The publish service sent back something unexpected." };
  const body = json as Record<string, unknown>;
  if (typeof body.scheduleVersion !== "string" || !Array.isArray(body.results)) {
    return { ok: false, error: "The publish service response is missing its results." };
  }
  const sent = new Set(request.events.map((e) => e.shiftId));
  const results: PublishEventResult[] = [];
  for (const r of body.results) {
    if (typeof r !== "object" || r === null) return { ok: false, error: "A publish result was malformed." };
    const row = r as Record<string, unknown>;
    if (typeof row.shiftId !== "string" || !sent.has(row.shiftId) || !STATUSES.includes(row.status as PublishEventStatus)) {
      return { ok: false, error: "A publish result did not match the shifts that were sent." };
    }
    results.push({
      shiftId: row.shiftId,
      status: row.status as PublishEventStatus,
      ...(typeof row.googleEventId === "string" ? { googleEventId: row.googleEventId } : {}),
      ...(typeof row.error === "string" ? { error: row.error.slice(0, 300) } : {}),
    });
  }
  const stale = readShiftIdList(body.staleShiftIds);
  if (stale === null) return { ok: false, error: "The publish service sent a malformed list of old events." };
  // A shift we just sent can't also be "old", so anything in both lists is ignored rather than risk deleting it.
  const staleShiftIds = stale.filter((id) => !sent.has(id));
  return { ok: true, value: { scheduleVersion: body.scheduleVersion, results, ...(staleShiftIds.length ? { staleShiftIds } : {}) } };
}

/**
 * Reads an optional list of shift ids from a server reply: missing means an empty list; anything
 * other than a list of short strings (or a list far too long) means null ("don't trust this").
 */
function readShiftIdList(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_REMOVALS) return null;
  if (!value.every((id) => typeof id === "string" && id.length > 0 && id.length <= MAX_SHIFT_ID_LENGTH)) return null;
  return Array.from(new Set(value as string[]));
}

const REMOVE_STATUSES: RemoveEventStatus[] = ["removed", "not_found", "failed", "dry_run"];

/** Never trust a server's removal reply: every result must be about a shift we asked to remove, with a known status. */
export function validateRemoveResponse(
  json: unknown,
  sentShiftIds: string[],
): { ok: true; value: RemoveResponse } | { ok: false; error: string } {
  if (typeof json !== "object" || json === null || !Array.isArray((json as { results?: unknown }).results)) {
    return { ok: false, error: "The calendar service sent back something unexpected." };
  }
  const sent = new Set(sentShiftIds);
  const results: RemoveResponse["results"] = [];
  for (const r of (json as { results: unknown[] }).results) {
    const row = (typeof r === "object" && r !== null ? r : {}) as Record<string, unknown>;
    if (typeof row.shiftId !== "string" || !sent.has(row.shiftId) || !REMOVE_STATUSES.includes(row.status as RemoveEventStatus)) {
      return { ok: false, error: "A removal result did not match the events we asked to remove." };
    }
    results.push({
      shiftId: row.shiftId,
      status: row.status as RemoveEventStatus,
      ...(typeof row.error === "string" ? { error: row.error.slice(0, 300) } : {}),
    });
  }
  return { ok: true, value: { results } };
}

export type PublishSummary = {
  state: SyncState;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  /** Shifts we sent that the service never reported on. */
  missing: number;
  dryRun: boolean;
  /** Old events still on the calendar that are no longer in the schedule (the manager may remove them). */
  staleShiftIds: string[];
};

/** Turns a validated response into an honest sync state — a mock run is never "synced". */
export function summarizePublish(request: PublishRequest, response: PublishResponse): PublishSummary {
  // How many results came back with this status (e.g. how many were "created").
  const count = (s: PublishEventStatus) => response.results.filter((r) => r.status === s).length;
  const reported = new Set(response.results.map((r) => r.shiftId));
  const missing = request.events.filter((e) => !reported.has(e.shiftId)).length;
  const dryRun = response.results.length > 0 && response.results.every((r) => r.status === "dry_run");
  const failed = count("failed");
  const ok = count("created") + count("updated") + count("unchanged");

  let state: SyncState;
  if (dryRun) state = "not_synced";
  else if (failed + missing === 0 && ok > 0) state = "synced";
  else if (ok > 0) state = "partially_synced";
  else if (request.events.length === 0) state = "not_synced";
  else state = "sync_failed";

  return {
    state,
    created: count("created"),
    updated: count("updated"),
    unchanged: count("unchanged"),
    failed,
    missing,
    dryRun,
    staleShiftIds: response.staleShiftIds ?? [],
  };
}
