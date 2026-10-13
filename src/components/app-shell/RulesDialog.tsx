import { useState } from "react";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { formatMinutes } from "../../features/scheduling/time";
import { BREAK_WEEKLY_HOURS, MIN_SHIFT_MINUTES } from "../../features/scheduling/constants";
import { breakLimit, minShiftMinutes } from "../../features/scheduling/term";
import type { ScheduleSettings } from "../../features/scheduling/types";

/** The shortest-shift choices offered, in hours (half an hour up to four). */
const MIN_SHIFT_CHOICES = [0.5, 1, 1.5, 2, 2.5, 3, 4];

/** A plain-language problem with a typed number of hours (whole or half hours between 1 and 40), or null when it is fine. */
function hoursProblem(text: string): string | null {
  const value = Number(text);
  if (text.trim() === "" || Number.isNaN(value)) return "Type a number of hours, like 19.";
  if (value < 1 || value > 40) return "Choose between 1 and 40 hours.";
  if (Math.round(value * 2) / 2 !== value) return "Use whole or half hours, like 19 or 19.5.";
  return null;
}

/**
 * The "Rules" popup (opened from the header). Lets the manager change the
 * office-wide settings that are meant to be edited occasionally, not per
 * student: the weekly hour cap, the weekly cap during a break, the shortest
 * shift, and the closing time. Each is validated live as the manager
 * types/picks, and the Save button is disabled until all are valid — see
 * `hoursError` / `breakError` / `closeError` below.
 */
const CLOSE_OPTIONS = Array.from({ length: 25 }, (_, i) => 12 * 60 + i * 30); // 12:00pm .. 12:00am (midnight)

/** The "Rules" dialog where the manager changes office-wide settings (open hours, people per slot, weekly hours). */
export function RulesDialog({
  settings,
  onSave,
  onClose,
}: {
  settings: ScheduleSettings;
  onSave: (s: Partial<ScheduleSettings>) => void;
  onClose: () => void;
}) {
  const [hours, setHours] = useState(String(settings.weeklyTargetHours));
  const [breakHours, setBreakHours] = useState(String(breakLimit(settings)));
  const [minShiftHours, setMinShiftHours] = useState(minShiftMinutes(settings) / 60);
  const [closeTime, setCloseTime] = useState(settings.closeTime);

  const parsed = Number(hours);
  const hoursError = hoursProblem(hours);
  const breakError = hoursProblem(breakHours);
  const closeError = closeTime <= settings.openTime + 60 ? "The office must be open for at least an hour after it opens." : null;

  return (
    <Modal
      title="Rules"
      description="These apply to everyone. Changing them never deletes a shift."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={Boolean(hoursError || breakError || closeError)}
            onClick={() => {
              // Only write a choice down when it differs from the standard, so untouched settings stay untouched.
              onSave({
                weeklyTargetHours: parsed,
                closeTime,
                breakWeeklyHours: Number(breakHours) === BREAK_WEEKLY_HOURS ? undefined : Number(breakHours),
                minShiftHours: minShiftHours * 60 === MIN_SHIFT_MINUTES ? undefined : minShiftHours,
              });
              onClose();
            }}
          >
            Save rules
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <label htmlFor="rule-hours" className="block text-sm font-medium">
            Most hours a student can work in a week
          </label>
          <p id="rule-hours-help" className="text-xs text-muted">
            Cadence warns you before a student goes over this. Check your own employer&apos;s policy for the right number.
          </p>
          <input
            id="rule-hours"
            data-autofocus
            inputMode="decimal"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            aria-describedby="rule-hours-help rule-hours-err"
            aria-invalid={Boolean(hoursError)}
            className="mt-1 w-28 rounded-lg border border-line bg-bg p-2 text-sm"
          />
          <span className="ml-2 text-sm text-muted">hours</span>
          {hoursError && (
            <p id="rule-hours-err" role="alert" className="mt-1 text-xs text-gap">
              {hoursError}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="rule-break-hours" className="block text-sm font-medium">
            Weekly hour limit during a break
          </label>
          <p id="rule-break-hours-help" className="text-xs text-muted">
            Used when the Semester / Break switch is on Break. Students are usually allowed more hours while classes are out.
          </p>
          <input
            id="rule-break-hours"
            inputMode="decimal"
            value={breakHours}
            onChange={(e) => setBreakHours(e.target.value)}
            aria-describedby="rule-break-hours-help rule-break-hours-err"
            aria-invalid={Boolean(breakError)}
            className="mt-1 w-28 rounded-lg border border-line bg-bg p-2 text-sm"
          />
          <span className="ml-2 text-sm text-muted">hours</span>
          {breakError && (
            <p id="rule-break-hours-err" role="alert" className="mt-1 text-xs text-gap">
              {breakError}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="rule-min-shift" className="block text-sm font-medium">
            Shortest shift allowed
          </label>
          <p className="text-xs text-muted">
            Shorter shifts are flagged as a problem, and &ldquo;Fill schedule for me&rdquo; never makes one. Changing this never deletes a shift.
          </p>
          <select
            id="rule-min-shift"
            value={minShiftHours}
            onChange={(e) => setMinShiftHours(Number(e.target.value))}
            className="mt-1 rounded-lg border border-line bg-bg p-2 text-sm"
          >
            {MIN_SHIFT_CHOICES.map((h) => (
              <option key={h} value={h}>
                {h === 1 ? "1 hour" : `${h} hours`}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="rule-close" className="block text-sm font-medium">
            The office closes at
          </label>
          <p className="text-xs text-muted">Shifts after this time stay saved and still count toward hours, but they are hidden from the grid.</p>
          <select
            id="rule-close"
            value={closeTime}
            onChange={(e) => setCloseTime(Number(e.target.value))}
            className="mt-1 rounded-lg border border-line bg-bg p-2 text-sm"
          >
            {CLOSE_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {formatMinutes(m)}
              </option>
            ))}
          </select>
          {closeError && (
            <p role="alert" className="mt-1 text-xs text-gap">
              {closeError}
            </p>
          )}
        </div>

        <p className="rounded-lg bg-bg p-3 text-xs text-muted">
          Each box in the schedule is 30 minutes. That is fixed so shifts always line up.
        </p>
      </div>
    </Modal>
  );
}
