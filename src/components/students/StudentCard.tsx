import { AlertTriangle, CheckCircle2, Clock, Pencil, Trash2 } from "lucide-react";
import { clsx } from "../../lib/clsx";
import { Avatar } from "../ui/Avatar";
import { hoursLabel } from "../../features/scheduling/time";
import type { StudentSummary } from "../../features/scheduling/selectors";

/**
 * One student's card in the left-hand list. Deliberately shows only what a manager needs at a
 * glance while scheduling — name, hours-so-far vs. target, and anything that needs their
 * attention (over hours, missing opening shift, an unfixed problem). Preference, days-per-week,
 * cutoff and lunch are real settings, but they're settings, not status — they live in the Edit
 * form (`StudentFormSheet`), not repeated as a line of text on every card, so a roster of 20
 * doesn't read as a wall of text. Purely display — every number here is pre-computed by
 * `summarizeStudent` in `../../features/scheduling/selectors.ts`.
 */
export function StudentCard({
  summary,
  targetHours,
  limitHours,
  selected,
  issueCount,
  onSelect,
  onEdit,
  onRemove,
}: {
  summary: StudentSummary;
  targetHours: number;
  /** Most hours allowed (higher than targetHours during a semester break). */
  limitHours: number;
  selected: boolean;
  issueCount: number;
  onSelect: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { student, hours, pctOfTarget, atTarget, needsOpeningShift, openingShiftSatisfied } = summary;
  const over = hours > limitHours;
  const status = over
    ? { text: `Over by ${hoursLabel(hours - limitHours)}`, icon: AlertTriangle, cls: "text-warn" }
    : atTarget
      ? { text: "At their hours", icon: CheckCircle2, cls: "text-ok" }
      : { text: `Needs ${hoursLabel(targetHours - hours)} more`, icon: Clock, cls: "text-warn" };
  const StatusIcon = status.icon;

  return (
    <li
      className={clsx("mb-2 rounded-xl border border-line border-l-4 bg-panel p-3 transition duration-150 hover:-translate-y-px hover:shadow-md", selected && "ring-2 ring-accent")}
      style={{ borderLeftColor: student.color }}
    >
      {/* One real button owns "pick this student"; Edit and Remove are siblings, never nested inside it. */}
      <button type="button" aria-pressed={selected} onClick={onSelect} className="block w-full rounded text-left">
        <div className="flex items-center gap-2">
          <Avatar name={student.name} color={student.color} avatar={student.avatar} />
          <span className="min-w-0 flex-1 truncate font-semibold">{student.name}</span>
          {selected && <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-ink">Selected</span>}
        </div>
        <p className="mt-1.5 text-sm">
          <span className="font-semibold">{hours}</span>
          <span className="text-muted"> of {hoursLabel(targetHours)} · </span>
          <span className={clsx("inline-flex items-center gap-1 font-medium", status.cls)}>
            <StatusIcon className="h-3.5 w-3.5" aria-hidden />
            {status.text}
          </span>
        </p>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line" aria-hidden>
          <div className={clsx("h-full transition-[width] duration-500 ease-out", over ? "bg-warn" : atTarget ? "bg-ok" : "bg-accent")} style={{ width: `${pctOfTarget}%` }} />
        </div>
        {needsOpeningShift && (
          <p className={clsx("mt-1 text-xs", openingShiftSatisfied ? "text-muted" : "font-semibold text-warn")}>
            {openingShiftSatisfied ? "✓ Has their 7:00am opening shift" : "Still needs a 7:00am opening shift"}
          </p>
        )}
        {issueCount > 0 && (
          <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-gap">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {issueCount} {issueCount === 1 ? "problem" : "problems"} to fix
          </p>
        )}
      </button>
      {/* Icon-only, same quiet treatment as the header's secondary buttons — the name/state that
          matters is above, in the button that picks this student; these two are housekeeping. */}
      <div className="mt-1 flex justify-end gap-0.5">
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${student.name}`}
          title="Edit"
          className="rounded-md p-2 text-muted hover:bg-line/40 hover:text-ink"
        >
          <Pencil className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${student.name}`}
          title="Remove"
          className="rounded-md p-2 text-muted hover:bg-gap-bg hover:text-gap"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </li>
  );
}
