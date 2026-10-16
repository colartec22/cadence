import { Plus, X } from "lucide-react";
import { Button } from "../ui/Button";
import { HelpTip } from "../help/HelpTip";
import { BREAK_LENGTH_OPTIONS, DEFAULT_BREAK_MINUTES, DEFAULT_BREAK_START, MAX_BREAKS } from "../../features/scheduling/constants";
import { formatMinutes, formatRange } from "../../features/scheduling/time";
import type { WorkBreak } from "../../features/scheduling/types";

/**
 * ============================================================================
 *  A STUDENT'S BREAKS (LUNCH OR REST)
 * ============================================================================
 * Part of the add/edit student form. The manager picks when each break starts and how long it lasts,
 * and can add up to MAX_BREAKS of them. Breaks repeat every day: nobody is scheduled during them, and
 * they don't count toward the student's weekly hours (the rule itself is in `availability.ts`).
 *
 * The schedule grid works in 30-minute boxes, so a break keeps every box it touches free: a 15-minute
 * break at 12:00pm keeps the 12:00–12:30pm box free. The help tip says so in plain words.
 */

/** Break start times offered: every half hour from 6:00am to 11:30pm. A saved odd time is added (see `startOptions`). */
const START_TIMES = Array.from({ length: 36 }, (_, i) => 6 * 60 + i * 30);

/** The start times to offer for one break: the standard list, plus its own time if that isn't on the list. */
function startOptions(current: number): number[] {
  return START_TIMES.includes(current) ? START_TIMES : [...START_TIMES, current].sort((a, b) => a - b);
}

/** The lengths to offer for one break: the standard list, plus its own length if that isn't on the list. */
function lengthOptions(current: number): number[] {
  return BREAK_LENGTH_OPTIONS.includes(current) ? BREAK_LENGTH_OPTIONS : [...BREAK_LENGTH_OPTIONS, current].sort((a, b) => a - b);
}

/** "15 minutes", "1 hour", "45 minutes": a break length in words. */
function lengthLabel(minutes: number): string {
  if (minutes === 60) return "1 hour";
  return minutes % 60 === 0 ? `${minutes / 60} hours` : `${minutes} minutes`;
}

/** The list of breaks with a start time and a length for each, plus "Add a break". */
export function BreakEditor({ breaks, onChange }: { breaks: WorkBreak[]; onChange: (next: WorkBreak[]) => void }) {
  // Replaces one break with a changed copy, leaving the others as they are.
  const update = (index: number, change: Partial<WorkBreak>) => onChange(breaks.map((b, i) => (i === index ? { ...b, ...change } : b)));
  // A new break starts at noon, or half an hour after the last one so two breaks don't start together.
  const nextStart = breaks.length ? Math.min(breaks[breaks.length - 1].start + 60, START_TIMES[START_TIMES.length - 1]) : DEFAULT_BREAK_START;

  return (
    <fieldset className="space-y-2">
      <legend className="flex items-center gap-1 text-sm font-medium">
        Breaks
        <HelpTip label="Breaks">
          Lunch or rest breaks, the same time every day. Cadence never schedules the student during a break, and breaks don&apos;t count
          toward their weekly hours. The schedule works in half hours, so a 15-minute break at 12:00pm keeps 12:00–12:30pm free.
        </HelpTip>
      </legend>
      {breaks.length === 0 && <p className="text-xs text-muted">No breaks. Add one if this student needs lunch or a rest.</p>}
      <ul className="space-y-2">
        {breaks.map((b, i) => (
          <li key={i} className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor={`break-start-${i}`} className="block text-xs text-muted">
                Break {i + 1} starts at
              </label>
              <select
                id={`break-start-${i}`}
                value={b.start}
                onChange={(e) => update(i, { start: Number(e.target.value) })}
                className="mt-1 rounded-lg border border-line bg-bg p-2 text-sm"
              >
                {startOptions(b.start).map((m) => (
                  <option key={m} value={m}>
                    {formatMinutes(m)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`break-length-${i}`} className="block text-xs text-muted">
                and lasts
              </label>
              <select
                id={`break-length-${i}`}
                value={b.minutes}
                onChange={(e) => update(i, { minutes: Number(e.target.value) })}
                className="mt-1 rounded-lg border border-line bg-bg p-2 text-sm"
              >
                {lengthOptions(b.minutes).map((m) => (
                  <option key={m} value={m}>
                    {lengthLabel(m)}
                  </option>
                ))}
              </select>
            </div>
            <span className="pb-2 text-xs text-muted">{formatRange(b.start, b.start + b.minutes)}</span>
            <Button
              variant="ghost"
              className="mb-0.5 px-2"
              onClick={() => onChange(breaks.filter((_, j) => j !== i))}
              aria-label={`Remove break ${i + 1}`}
              title={`Remove break ${i + 1}`}
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      {breaks.length < MAX_BREAKS && (
        <Button variant="ghost" onClick={() => onChange([...breaks, { start: nextStart, minutes: DEFAULT_BREAK_MINUTES }])}>
          <Plus className="h-4 w-4" aria-hidden /> Add a break
        </Button>
      )}
    </fieldset>
  );
}
