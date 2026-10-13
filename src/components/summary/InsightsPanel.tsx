import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Plus } from "lucide-react";
import { HelpTip } from "../help/HelpTip";
import { assignedHours, studentsMissingOpeningShift } from "../../features/scheduling/availability";
import { buildCoverageSlots, buildGapRanges, summarizeCoverage, uncoveredStaffHours } from "../../features/scheduling/coverage";
import { describeGap, suggestFillers } from "../../features/scheduling/issues";
import { weeklyLimit } from "../../features/scheduling/term";
import { formatRange, hoursLabel } from "../../features/scheduling/time";
import { DAY_LABEL } from "../../features/scheduling/types";
import type { Day } from "../../features/scheduling/types";
import type { LastAutofill } from "../../hooks/useShiftFitStore";
import { clsx } from "../../lib/clsx";
import type { ScheduleIssue, ScheduleSettings, ShiftBlock, Student } from "../../features/scheduling/types";

/**
 * ============================================================================
 *  "SCHEDULE HEALTH" SIDE PANEL
 * ============================================================================
 * The right-hand column: the two coverage percentage meters, the "needs
 * attention" problem/warning list, the list of understaffed times with
 * one-click "Quick fix" buttons (each is a real candidate from
 * `suggestFillers`, not a guess — see `../../features/scheduling/issues.ts`),
 * and a collapsible log of what the last "Fill schedule for me" run did. Only the
 * status, the problems and the first few empty times show by default; the
 * percentages sit behind "More numbers" so the panel stays short and calm.
 * Everything here is read-only except the Quick fix buttons and "Pick to fix
 * it" links, which call back up to `App.tsx`/the store.
 */
function Meter({ label, help, percent, detail }: { label: string; help: string; percent: number; detail: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          {label}
          <HelpTip label={label} align="right">
            {help}
          </HelpTip>
        </p>
        <p className="font-display text-xl font-bold">{percent}%</p>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-line" role="img" aria-label={`${percent} percent`}>
        <div className={clsx("h-full", percent === 100 ? "bg-ok" : "bg-accent")} style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted">{detail}</p>
    </div>
  );
}

/** The "Schedule health" panel: how many hours still need someone, which times, and any rule problems. */
export function InsightsPanel({
  students,
  assignments,
  settings,
  issues,
  lastAutofill,
  onSelectStudent,
  onFillGap,
}: {
  students: Student[];
  assignments: ShiftBlock[];
  settings: ScheduleSettings;
  issues: ScheduleIssue[];
  lastAutofill: LastAutofill | null;
  onSelectStudent: (id: string) => void;
  onFillGap: (studentId: string, day: Day, from: number, to: number) => void;
}) {
  const coverage = buildCoverageSlots(assignments, settings);
  const gaps = buildGapRanges(coverage);
  const summary = summarizeCoverage(coverage, settings);
  // A student's name from their id ("Someone" if they were removed).
  const nameOf = (id: string) => students.find((s) => s.id === id)?.name ?? "Someone";
  const atTarget = students.filter((s) => assignedHours(s.id, assignments, settings) >= weeklyLimit(settings)).length;
  const emptyHalfHours = summary.totalSlots - summary.fullyStaffedSlots;
  // The two headline numbers also used by the server check (same functions, so they can never disagree).
  const missingStaffHours = uncoveredStaffHours(coverage, settings);
  const missingOpeners = studentsMissingOpeningShift(students, assignments, settings);
  const problems = issues.filter((i) => !i.overridden);
  const warnings = issues.filter((i) => i.overridden);
  const allGood = emptyHalfHours === 0 && problems.length === 0;

  // Quick fixes are worked out for the first few gaps only, so a huge roster can't slow the panel down.
  const QUICK_FIX_LIMIT = 10;
  // A short list is easier to act on; the rest is one click away.
  const GAPS_SHOWN = 5;
  const [showAllGaps, setShowAllGaps] = useState(false);
  const visibleGaps = showAllGaps ? gaps : gaps.slice(0, GAPS_SHOWN);
  const fixes = useMemo(
    () => gaps.slice(0, QUICK_FIX_LIMIT).map((g) => suggestFillers(students, assignments, settings, g.day, g.start, g.end)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [students, assignments, settings],
  );

  return (
    <section aria-labelledby="insights-heading" className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto bg-panel p-3 sm:p-4">
      <h2 id="insights-heading" className="font-display text-lg font-semibold">
        Schedule health
      </h2>

      <div
        role="status"
        className={clsx(
          "flex items-start gap-2 rounded-xl border p-3",
          allGood ? "border-ok/40 bg-ok-bg" : problems.length ? "border-gap/50 bg-gap-bg" : "border-line bg-bg",
        )}
      >
        {allGood ? <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-ok" aria-hidden /> : <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-gap" aria-hidden />}
        <div>
          <p className="text-lg font-semibold">
            {!students.length
              ? "Add a student to begin"
              : allGood
                ? "Every hour is covered"
                : emptyHalfHours > 0
                  ? `${emptyHalfHours / 2} ${emptyHalfHours / 2 === 1 ? "hour needs" : "hours need"} someone`
                  : "A rule is being broken"}
          </p>
          <p className="text-sm text-muted">
            {!students.length
              ? "The schedule will show how well the week is covered."
              : allGood
                ? "No rules are broken and nobody is missing."
                : "Start with the first item below."}
          </p>
        </div>
      </div>

      <details className="rounded-xl border border-line p-3">
        <summary className="cursor-pointer text-sm font-semibold">More numbers</summary>
        <div className="mt-3 flex flex-col gap-4">
          <Meter
            label="Hours with enough people"
            help={`Of every 30-minute box in the week, how many have at least ${settings.minStaffPerSlot} ${settings.minStaffPerSlot === 1 ? "person" : "people"} working.`}
            percent={summary.fullyStaffedPercent}
            detail={`${summary.fullyStaffedSlots} of ${summary.totalSlots} boxes are covered.`}
          />
          <Meter
            label="Staffing filled"
            help="Counts every person you need, not just every box. If you need 2 people and only 1 is working, the box isn't covered, but half of the staffing is filled."
            percent={summary.demandFulfilledPercent}
            detail={`You need ${settings.minStaffPerSlot} at once, all ${summary.totalSlots} boxes.`}
          />

          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl border border-line p-3">
              <dt className="text-xs text-muted">
                Hours still missing
                <HelpTip label="Hours still missing" align="right">
                  Add up every hour where someone is needed but nobody is there. If you need 2 people and only 1 works for an hour, that is 1 hour missing.
                </HelpTip>
              </dt>
              <dd className={clsx("font-display text-xl font-semibold", missingStaffHours > 0 ? "text-gap" : "text-ok")}>{hoursLabel(missingStaffHours)}</dd>
            </div>
            <div className="rounded-xl border border-line p-3">
              <dt className="text-xs text-muted">
                Opening shifts missing
                <HelpTip label="Opening shifts missing" align="right">
                  Some students must open the office with a shift that starts at 7:00am. This counts the ones who don&apos;t have it yet.
                </HelpTip>
              </dt>
              <dd className={clsx("font-display text-xl font-semibold", missingOpeners.length > 0 ? "text-gap" : "text-ok")}>
                {missingOpeners.length}
                {missingOpeners.length > 0 && <span className="block text-sm font-normal text-muted">{missingOpeners.map((s) => s.name).join(", ")}</span>}
              </dd>
            </div>
            <div className="rounded-xl border border-line p-3">
              <dt className="text-xs text-muted">Students at their hours</dt>
              <dd className="font-display text-xl font-semibold">
                {atTarget} <span className="text-sm font-normal text-muted">of {students.length}</span>
              </dd>
            </div>
            <div className="rounded-xl border border-line p-3">
              <dt className="text-xs text-muted">
                Students needed (best case)
                <HelpTip label="Students needed (best case)" align="right">
                  Total hours to cover ({summary.theoreticalStaffingHours}) divided by the weekly limit. It pretends everyone is free at every hour, so treat it as the
                  fewest students you could possibly need, not a promise.
                </HelpTip>
              </dt>
              <dd className="font-display text-xl font-semibold">
                {summary.theoreticalMinimumStudents}
                <span className="block text-sm font-normal text-muted">you have {students.length}</span>
              </dd>
            </div>
          </dl>
        </div>
      </details>

      {(problems.length > 0 || warnings.length > 0) && (
        <div>
          <h3 className="mb-1.5 font-semibold">Needs attention</h3>
          <ul className="space-y-2">
            {problems.map((issue, i) => (
              <li key={`p${i}`} className="rounded-lg border border-gap/40 bg-gap-bg p-3">
                <p className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-gap" aria-hidden />
                  <span>{issue.message}</span>
                </p>
                <button type="button" onClick={() => onSelectStudent(issue.studentId)} className="mt-1.5 text-sm font-medium text-accent underline underline-offset-2">
                  Pick {nameOf(issue.studentId)} to fix it
                </button>
              </li>
            ))}
            {warnings.map((issue, i) => (
              <li key={`w${i}`} className="rounded-lg border border-line bg-warn-bg p-3 text-sm">
                <p className="flex items-start gap-1.5">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
                  <span>
                    {issue.message} <span className="text-muted">(You chose to allow this.)</span>
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-1.5 font-semibold">Times that need someone</h3>
        {gaps.length ? (
          <>
            <ul className="space-y-2">
              {visibleGaps.map((g, gi) => (
                <li key={`${g.day}-${g.start}`} className="rounded-lg border border-line p-3">
                  <p>
                    <span className="font-semibold text-gap">{DAY_LABEL[g.day]}</span> {formatRange(g.start, g.end)}{" "}
                    <span className="text-muted">needs {g.shortfall} more</span>
                  </p>
                  {fixes[gi]?.length ? (
                    <div className="mt-2">
                      <div className="flex flex-wrap gap-2">
                        {fixes[gi].map((f) => {
                          const partial = f.slots < f.total;
                          const range = `${DAY_LABEL[g.day]} ${formatRange(g.start, g.end)}`;
                          return (
                            <button
                              key={f.student.id}
                              type="button"
                              onClick={() => onFillGap(f.student.id, g.day, g.start, g.end - settings.slotMinutes)}
                              aria-label={`Add ${f.student.name} to ${range}${partial ? `, ${hoursLabel((f.slots * settings.slotMinutes) / 60)} of ${hoursLabel((f.total * settings.slotMinutes) / 60)}` : ""}`}
                              className="inline-flex items-center gap-1 rounded-full border border-accent/50 bg-accent/10 py-1.5 pl-2.5 pr-3 text-sm font-medium hover:bg-accent/20"
                            >
                              <Plus className="h-4 w-4" aria-hidden />
                              {f.student.name}
                              {partial && <span className="font-normal text-muted">({hoursLabel((f.slots * settings.slotMinutes) / 60)} of {hoursLabel((f.total * settings.slotMinutes) / 60)})</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-muted">{describeGap(students, assignments, settings, g.day, g.start)}</p>
                  )}
                </li>
              ))}
            </ul>
            {gaps.length > GAPS_SHOWN && (
              <button type="button" onClick={() => setShowAllGaps((v) => !v)} className="mt-2 text-sm font-medium text-accent underline underline-offset-2">
                {showAllGaps ? "Show fewer" : `Show all ${gaps.length} times`}
              </button>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">Nothing is missing. Every box has enough people.</p>
        )}
      </div>

      {lastAutofill && (lastAutofill.explanations.length > 0 || lastAutofill.unmet.length > 0 || lastAutofill.openingShiftUnmet.length > 0) && (
        <details className="rounded-xl border border-line p-3">
          <summary className="cursor-pointer text-sm font-semibold">What did “Fill schedule for me” do?</summary>
          <div className="mt-2 space-y-2 text-sm">
            {[...lastAutofill.openingShiftUnmet, ...lastAutofill.unmet].map((u, i) => (
              <p key={`u${i}`} className="rounded-lg bg-warn-bg p-2 text-xs">
                {u.reason}
              </p>
            ))}
            {lastAutofill.explanations.length > 0 && (
              <ul className="max-h-64 space-y-1 overflow-y-auto text-xs text-muted">
                {lastAutofill.explanations.map((e, i) => (
                  <li key={`e${i}`}>
                    <span className="font-medium text-ink">{nameOf(e.studentId)}</span> · {DAY_LABEL[e.day]} {formatRange(e.start, e.end)} — {e.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      )}
    </section>
  );
}
