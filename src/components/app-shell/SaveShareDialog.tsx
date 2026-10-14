import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Download, FileSpreadsheet, RotateCcw, Save, Send, Trash2, Upload, X } from "lucide-react";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Modal } from "../ui/Modal";
import { buildStudentIcs, icsFileName, isSemesterConfigured } from "../../features/calendar/ics";
import { MAX_BACKUP_BYTES, exportBackup, parseBackup } from "../../features/persistence/storage";
import { shiftsToCsv } from "../../features/scheduling/blocks";
import { isIsoDate, isValidTimeZone } from "../../features/scheduling/time";
import { downloadTextFile, todayStamp } from "../../lib/download";
import { buildPublishRequest, scheduleForServer, summarizePublish } from "../../services/automation/contracts";
import type { PublishSummary } from "../../services/automation/contracts";
import { getAutomationClient } from "../../services/automation/n8nClient";
import { useManagerSession } from "../../hooks/useManagerSession";
import { ManagerSignIn } from "./ManagerSignIn";
import type { PersistedStateV1, ScheduleSettings, SemesterConfig, ShiftBlock, Student } from "../../features/scheduling/types";

/**
 * ============================================================================
 *  THE "SAVE & SHARE" POPUP
 * ============================================================================
 * The biggest dialog in the app — it's really five features bundled behind
 * one button, each in its own `<Section>` below: backup file (save/load),
 * spreadsheet export, per-student calendar (.ics) files, publishing to
 * Google Calendar through the ShiftFit server (after a manager signs in), or a
 * harmless "practice run" if no server is connected — see `client.kind` and
 * `../../services/automation`, and the
 * "start over" reset/clear actions. Read each `Section` block independently;
 * they don't depend on each other.
 */
type Props = {
  settings: ScheduleSettings;
  students: Student[];
  assignments: ShiftBlock[];
  /** The schedule that isn't showing (semester or break), so a backup keeps both. */
  otherTermAssignments: ShiftBlock[];
  semester: SemesterConfig | null;
  selectedStudentId: string | null;
  blockingIssues: number;
  onImport: (state: PersistedStateV1, notes: string[]) => void;
  onSetSemester: (s: SemesterConfig | null) => void;
  onResetDemo: () => void;
  onClearAll: () => void;
  onClose: () => void;
};

/** One boxed part of the Save & share dialog, with an icon, a title and a "?" help tip. */
function Section({ icon, title, help, children }: { icon: ReactNode; title: string; help: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line p-4">
      <h3 className="flex items-center gap-2 font-display font-semibold">
        {icon}
        {title}
      </h3>
      <p className="mb-3 mt-1 text-sm text-muted">{help}</p>
      {children}
    </section>
  );
}

/** "Thu, Nov 26, 2026": read in UTC so the day never shifts with the viewer's timezone. */
function formatDayOff(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const zoneList: string[] = (() => {
  try {
    const anyIntl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
    return anyIntl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
})();

/** Save & share: backups, spreadsheet, semester dates, per-student calendar files, and sending to Google Calendar. */
export function SaveShareDialog(props: Props) {
  const { settings, students, assignments, otherTermAssignments, semester, selectedStudentId, blockingIssues, onImport, onSetSemester, onResetDemo, onClearAll, onClose } = props;
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pendingImport, setPendingImport] = useState<{ state: PersistedStateV1; notes: string[] } | null>(null);
  const [confirm, setConfirm] = useState<"reset" | "clear" | "publish" | "remove-old" | null>(null);

  const [startDate, setStartDate] = useState(semester?.startDate ?? "");
  const [endDate, setEndDate] = useState(semester?.endDate ?? "");
  const [timeZone, setTimeZone] = useState(semester?.timeZone ?? "");
  const [skipDates, setSkipDates] = useState<string[]>(semester?.skipDates ?? []);
  const [dayOff, setDayOff] = useState("");
  const [dayOffProblem, setDayOffProblem] = useState<string | null>(null);

  const client = useMemo(() => getAutomationClient(), []);
  const request = useMemo(() => buildPublishRequest(students, assignments, settings, semester), [students, assignments, settings, semester]);
  const [busy, setBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [lastPublish, setLastPublish] = useState<{ version: string; summary: PublishSummary } | null>(null);
  const [removeMessage, setRemoveMessage] = useState<string | null>(null);
  const signedIn = useManagerSession();
  // With a real server, nothing can be sent until a manager has signed in on this tab.
  const needsSignIn = client.kind === "server" && !signedIn;
  const oldEvents = lastPublish?.summary.staleShiftIds ?? [];

  const dateProblem =
    startDate && !isIsoDate(startDate)
      ? "Pick a real start date."
      : endDate && !isIsoDate(endDate)
        ? "Pick a real end date."
        : startDate && endDate && endDate < startDate
          ? "The last day can't be before the first day."
          : timeZone && !isValidTimeZone(timeZone)
            ? "That timezone isn't recognized. Try a name like Pacific/Honolulu or America/Denver."
            : null;
  const draftComplete = Boolean(startDate && endDate && timeZone && !dateProblem);
  const draftMatchesSaved =
    semester?.startDate === startDate &&
    semester?.endDate === endDate &&
    semester?.timeZone === timeZone &&
    JSON.stringify(skipDates) === JSON.stringify(semester?.skipDates ?? []);

  // Adds a holiday/break date, but only a real date inside the semester.
  function addDayOff() {
    if (!isIsoDate(dayOff)) {
      setDayOffProblem("Pick a real date to add.");
    } else if (startDate && endDate && (dayOff < startDate || dayOff > endDate)) {
      setDayOffProblem("That day is outside the first and last day above.");
    } else {
      setSkipDates((list) => Array.from(new Set([...list, dayOff])).sort());
      setDayOff("");
      setDayOffProblem(null);
    }
  }
  const calendarReady = isSemesterConfigured(semester) && draftMatchesSaved;

  // Downloads the whole schedule as a backup file.
  function handleBackup() {
    const state: PersistedStateV1 = { version: 1, settings, students, assignments, otherTermAssignments, selectedStudentId, semester };
    downloadTextFile(`cadence-backup-${todayStamp()}.json`, exportBackup(state), "application/json");
    setMessage({ tone: "ok", text: "Backup saved to your Downloads folder. It contains student names and class times, so keep it private." });
  }

  // Opens a backup file the manager picked, checks it, and asks before replacing the current schedule.
  async function handleFile(file: File) {
    // Check the size first: reading a huge file into memory would freeze the page.
    if (file.size > MAX_BACKUP_BYTES) {
      setMessage({ tone: "error", text: "That file is too big to be a Cadence backup, so it wasn't opened." });
      return;
    }
    const result = parseBackup(await file.text());
    if (!result.ok) {
      setMessage({ tone: "error", text: `That file couldn't be loaded. ${result.errors.join(" ")}` });
      return;
    }
    setMessage(null);
    setPendingImport({ state: result.value, notes: result.notes });
  }

  // Sends the approved shifts to the calendar server and records an honest summary of what happened.
  async function runPublish() {
    setBusy(true);
    setPublishError(null);
    setRemoveMessage(null);
    try {
      // Only the facts the server needs are sent (no photos, no pasted text); it rebuilds `request` itself.
      const response = await client.publishSchedule(scheduleForServer(students, assignments, settings, semester), request);
      setLastPublish({ version: request.scheduleVersion, summary: summarizePublish(request, response) });
    } catch (err) {
      setLastPublish(null);
      setPublishError(err instanceof Error ? err.message : "Something went wrong while publishing.");
    } finally {
      setBusy(false);
    }
  }

  // Deletes the old calendar events (moved or removed shifts) the manager just confirmed, then reports what happened.
  async function runRemoveOld() {
    setBusy(true);
    try {
      const { results } = await client.removeEvents(oldEvents);
      const removed = results.filter((r) => r.status === "removed").length;
      const failed = results.filter((r) => r.status === "failed").length;
      const practice = results.length > 0 && results.every((r) => r.status === "dry_run");
      setRemoveMessage(
        practice
          ? `Practice run: ${oldEvents.length} old events would be removed. Nothing was deleted.`
          : `Removed ${removed} old ${removed === 1 ? "event" : "events"}.${failed ? ` ${failed} could not be removed; try again.` : ""}`,
      );
      // Forget the ones that are gone, so the button only offers what is really still there.
      const stillThere = new Set(results.filter((r) => r.status === "failed").map((r) => r.shiftId));
      setLastPublish((last) => (last ? { ...last, summary: { ...last.summary, staleShiftIds: last.summary.staleShiftIds.filter((id) => stillThere.has(id)) } } : last));
    } catch (err) {
      setRemoveMessage(err instanceof Error ? err.message : "Something went wrong while removing old events.");
    } finally {
      setBusy(false);
    }
  }

  const hasShifts = assignments.length > 0;
  const stale = lastPublish && lastPublish.version !== request.scheduleVersion;

  return (
    <>
      <Modal title="Save & share" description="Keep your work safe, or send it to other people." size="lg" onClose={onClose}>
        <div className="space-y-4">
          {message && (
            <p role={message.tone === "error" ? "alert" : "status"} className={`rounded-lg p-3 text-sm ${message.tone === "error" ? "bg-gap-bg text-ink" : "bg-ok-bg text-ink"}`}>
              {message.text}
            </p>
          )}

          <Section icon={<Save className="h-4 w-4" aria-hidden />} title="Backup" help="Your schedule is saved in this browser automatically. A backup file lets you move it to another computer or keep a safe copy.">
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={handleBackup}>
                <Download className="h-4 w-4" aria-hidden /> Save a backup file
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                  e.target.value = "";
                }}
              />
              <Button variant="secondary" onClick={() => fileInput.current?.click()}>
                <Upload className="h-4 w-4" aria-hidden /> Load a backup file
              </Button>
            </div>
          </Section>

          <Section icon={<FileSpreadsheet className="h-4 w-4" aria-hidden />} title="Spreadsheet" help="A simple table of who works when, one row per shift. Opens in Excel or Google Sheets.">
            <Button
              variant="secondary"
              disabled={!hasShifts}
              onClick={() => downloadTextFile(`cadence-schedule-${todayStamp()}.csv`, shiftsToCsv(students, assignments, settings.slotMinutes), "text/csv")}
            >
              <Download className="h-4 w-4" aria-hidden /> Download spreadsheet
            </Button>
            {!hasShifts && <p className="mt-2 text-xs text-muted">Add some shifts first.</p>}
          </Section>

          <Section
            icon={<Send className="h-4 w-4" aria-hidden />}
            title="Calendar files for students"
            help="Gives each student a file that puts their weekly shifts on their own phone or computer calendar. Cadence needs the semester dates and timezone from you. It never guesses."
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="sem-start" className="block text-sm font-medium">
                  First day
                </label>
                <input id="sem-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-bg p-2 text-sm" />
              </div>
              <div>
                <label htmlFor="sem-end" className="block text-sm font-medium">
                  Last day
                </label>
                <input id="sem-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-bg p-2 text-sm" />
              </div>
              <div>
                <label htmlFor="sem-zone" className="block text-sm font-medium">
                  Timezone
                </label>
                <input
                  id="sem-zone"
                  list="zone-list"
                  value={timeZone}
                  onChange={(e) => setTimeZone(e.target.value)}
                  placeholder="e.g. Pacific/Honolulu"
                  className="mt-1 w-full rounded-lg border border-line bg-bg p-2 text-sm"
                />
                <datalist id="zone-list">
                  {zoneList.map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
              </div>
            </div>
            <div className="mt-3">
              <label htmlFor="day-off" className="block text-sm font-medium">
                Days off <span className="font-normal text-muted">(holidays and breaks, optional)</span>
              </label>
              <p className="text-xs text-muted">Shifts that would fall on these days are left out of the calendar files. Without this, they repeat on holidays too.</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <input
                  id="day-off"
                  type="date"
                  value={dayOff}
                  onChange={(e) => setDayOff(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addDayOff();
                    }
                  }}
                  className="rounded-lg border border-line bg-bg p-2 text-sm"
                />
                <Button variant="secondary" onClick={addDayOff} disabled={!dayOff}>
                  Add day off
                </Button>
              </div>
              {dayOffProblem && (
                <p role="alert" className="mt-1 text-xs text-gap">
                  {dayOffProblem}
                </p>
              )}
              {skipDates.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Days off">
                  {skipDates.map((d) => (
                    <li key={d} className="flex items-center gap-1 rounded-full border border-line bg-bg py-0.5 pl-2.5 pr-1 text-xs">
                      {formatDayOff(d)}
                      <button
                        type="button"
                        onClick={() => setSkipDates((list) => list.filter((x) => x !== d))}
                        aria-label={`Remove day off ${formatDayOff(d)}`}
                        className="rounded-full p-0.5 text-muted hover:bg-gap-bg hover:text-gap"
                      >
                        <X className="h-3 w-3" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={() => setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)}>
                Use this computer&apos;s timezone
              </Button>
              <Button
                variant="secondary"
                disabled={!draftComplete || draftMatchesSaved}
                onClick={() => {
                  onSetSemester({ startDate, endDate, timeZone, skipDates });
                  setMessage({ tone: "ok", text: "Semester dates saved." });
                }}
              >
                Save dates
              </Button>
            </div>
            {dateProblem && (
              <p role="alert" className="mt-2 text-xs text-gap">
                {dateProblem}
              </p>
            )}
            <p className="mt-2 text-xs text-muted">Shifts repeat every week from the first day to the last day, at the times shown in the schedule.</p>

            <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
              {students.map((s) => {
                const mine = assignments.filter((a) => a.studentId === s.id).length;
                const reason = !calendarReady ? "Save the dates above first" : mine === 0 ? "No shifts yet" : null;
                return (
                  <li key={s.id} className="flex items-center justify-between gap-2 p-2 text-sm">
                    <span className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
                      {s.name}
                      <span className="text-xs text-muted">({(mine * settings.slotMinutes) / 60} hrs)</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {reason && <span className="text-xs text-muted">{reason}</span>}
                      <Button
                        variant="secondary"
                        disabled={Boolean(reason)}
                        aria-label={`Download calendar file for ${s.name}`}
                        onClick={() => {
                          if (!semester) return;
                          downloadTextFile(icsFileName(s), buildStudentIcs(s, assignments, semester, settings.slotMinutes), "text/calendar");
                        }}
                      >
                        <Download className="h-4 w-4" aria-hidden /> Calendar file
                      </Button>
                    </span>
                  </li>
                );
              })}
              {!students.length && <li className="p-3 text-sm text-muted">Add a student first.</li>}
            </ul>
          </Section>

          <Section
            icon={<Send className="h-4 w-4" aria-hidden />}
            title="Send to Google Calendar"
            help={
              client.kind === "server"
                ? "Sends the approved schedule to the shared Google Calendar. Running it again updates the same events instead of making duplicates."
                : "This copy of Cadence isn't connected to Google Calendar, so this only does a practice run: it checks your schedule and shows what would be sent. Nothing leaves your computer."
            }
          >
            {/* With a real server: the passcode box, which becomes "Signed in as manager" + Sign out once accepted. */}
            {client.kind === "server" && (
              <div className="mb-3">
                <ManagerSignIn purpose="needed to send to Google Calendar" />
              </div>
            )}
            {blockingIssues > 0 ? (
              <p role="alert" className="rounded-lg bg-gap-bg p-3 text-sm">
                Fix the {blockingIssues} {blockingIssues === 1 ? "problem" : "problems"} shown in Schedule health first. A schedule that breaks a rule can&apos;t be sent.
              </p>
            ) : !calendarReady ? (
              <p className="rounded-lg bg-bg p-3 text-sm text-muted">
                Save the semester dates and timezone above first — a real calendar event needs a real date, not just a weekday.
              </p>
            ) : (
              <Button
                variant={client.kind === "server" ? "primary" : "secondary"}
                disabled={busy || !hasShifts || needsSignIn}
                onClick={() => (client.kind === "server" ? setConfirm("publish") : void runPublish())}
              >
                <Send className="h-4 w-4" aria-hidden /> {busy ? "Working…" : client.kind === "server" ? "Approve and send" : "Do a practice run"}
              </Button>
            )}
            {calendarReady && !hasShifts && <p className="mt-2 text-xs text-muted">Add some shifts first.</p>}
            <div role="status" className="mt-3 text-sm">
              {publishError && <p className="rounded-lg bg-gap-bg p-3">{publishError} Nothing was changed on the calendar that we can confirm. Try again.</p>}
              {!publishError && !lastPublish && <p className="text-muted">Status: not sent.</p>}
              {lastPublish && !publishError && (
                <p className="rounded-lg bg-bg p-3">
                  {lastPublish.summary.dryRun
                    ? `Practice run finished: ${request.events.length} shifts checked. Nothing was sent, so this is still “not synced”.`
                    : `Status: ${{ synced: "sent", partially_synced: "only partly sent", sync_failed: "not sent (it failed)", not_synced: "not sent", syncing: "sending" }[lastPublish.summary.state]}. ${lastPublish.summary.created} created, ${lastPublish.summary.updated} updated, ${lastPublish.summary.unchanged} already up to date, ${lastPublish.summary.failed + lastPublish.summary.missing} failed.`}
                  {stale && " The schedule has changed since then, so send it again to update the calendar."}
                </p>
              )}
              {oldEvents.length > 0 && !publishError && (
                <div className="mt-2 rounded-lg bg-bg p-3">
                  <p>
                    {oldEvents.length} older {oldEvents.length === 1 ? "event is" : "events are"} still on the calendar for shifts you moved or removed.
                  </p>
                  <Button variant="danger" className="mt-2" disabled={busy || needsSignIn} onClick={() => setConfirm("remove-old")}>
                    <Trash2 className="h-4 w-4" aria-hidden /> Remove old events
                  </Button>
                </div>
              )}
              {removeMessage && <p className="mt-2 rounded-lg bg-bg p-3">{removeMessage}</p>}
            </div>
          </Section>

          <Section icon={<RotateCcw className="h-4 w-4" aria-hidden />} title="Start over" help="Both of these can be undone with the Undo button.">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setConfirm("reset")}>
                <RotateCcw className="h-4 w-4" aria-hidden /> Restore the sample students
              </Button>
              <Button variant="danger" onClick={() => setConfirm("clear")}>
                <Trash2 className="h-4 w-4" aria-hidden /> Clear everything
              </Button>
            </div>
          </Section>
        </div>
      </Modal>

      {pendingImport && (
        <ConfirmDialog
          title="Replace your schedule with this backup?"
          confirmLabel="Yes, load it"
          onCancel={() => setPendingImport(null)}
          onConfirm={() => {
            onImport(pendingImport.state, pendingImport.notes);
            setPendingImport(null);
            onClose();
          }}
        >
          <p>
            The backup has {pendingImport.state.students.length} students and {pendingImport.state.assignments.length} shift slots. Loading it replaces what you have now.
          </p>
          <p className="text-muted">You can press Undo afterwards to go back.</p>
        </ConfirmDialog>
      )}
      {confirm === "reset" && (
        <ConfirmDialog title="Restore the sample students?" confirmLabel="Yes, restore" onCancel={() => setConfirm(null)} onConfirm={() => { onResetDemo(); setConfirm(null); onClose(); }}>
          <p>This replaces your students and shifts with the made-up sample ones. You can press Undo afterwards.</p>
        </ConfirmDialog>
      )}
      {confirm === "clear" && (
        <ConfirmDialog title="Clear everything?" danger confirmLabel="Yes, clear everything" onCancel={() => setConfirm(null)} onConfirm={() => { onClearAll(); setConfirm(null); onClose(); }}>
          <p>This removes every student and shift. You can press Undo afterwards, but a backup is safer.</p>
        </ConfirmDialog>
      )}
      {confirm === "publish" && (
        <ConfirmDialog
          title="Send this schedule to Google Calendar?"
          confirmLabel="Yes, send it"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            void runPublish();
          }}
        >
          <p>
            This will create or update {request.events.length} calendar events for {new Set(request.events.map((e) => e.studentId)).size} students. It
            doesn&apos;t delete anything. If older events are left over from shifts you moved, you&apos;ll be asked about them separately.
          </p>
        </ConfirmDialog>
      )}
      {confirm === "remove-old" && (
        <ConfirmDialog
          title="Remove old events from Google Calendar?"
          danger
          confirmLabel="Yes, remove them"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            void runRemoveOld();
          }}
        >
          <p>
            This deletes {oldEvents.length} {oldEvents.length === 1 ? "event" : "events"} (every week of each) that Cadence made earlier for shifts that
            are no longer in the schedule. Students will no longer see them. This can&apos;t be undone from Cadence.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
