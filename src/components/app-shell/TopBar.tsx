import { useState } from "react";
import { CalendarDays, ChevronDown, HelpCircle, Redo2, Settings, SlidersHorizontal, Sparkles, Undo2, Wand2 } from "lucide-react";
import { clsx } from "../../lib/clsx";
import { Segmented } from "../ui/Segmented";
import { Button } from "../ui/Button";
import { HelpTip } from "../help/HelpTip";
import { ThemeControl } from "./ThemeControl";
import type { ThemeChoice } from "../../hooks/useTheme";
import type { ScheduleSettings } from "../../features/scheduling/types";
import { BREAK_WEEKLY_HOURS, MIN_STAFF_OPTIONS, OPEN_TIME_OPTIONS } from "../../features/scheduling/constants";
import { formatMinutes } from "../../features/scheduling/time";

/**
 * The header bar shown on every screen. Deliberately built around ONE clear
 * primary action ("Fill schedule for me" — solid accent color, the only
 * button with visible label text at full size) with everything else quieter:
 * Undo/Redo and Rules/Help are icon-only ghost buttons (a tooltip and
 * `aria-label` still name them for a mouse or screen-reader user), and the
 * office-hours/people-needed settings live behind a single "Settings" toggle
 * that's collapsed by default at every screen width — not just on narrow
 * ones — so the bar a manager sees on first load is short and unambiguous
 * about what to click. This component only displays buttons and calls the
 * callback props it's given — it doesn't decide what clicking them does
 * (that logic lives in `App.tsx` and `useShiftFitStore.ts`).
 */
type Props = {
  settings: ScheduleSettings;
  onSettingsChange: (s: Partial<ScheduleSettings>) => void;
  onAutoFill: () => void;
  onRebuild: () => void;
  onClearShifts: () => void;
  onImportShifts: () => void;
  hasAutoShifts: boolean;
  hasShifts: boolean;
  hasStudents: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  onUndo: () => void;
  onRedo: () => void;
  onOpenHelp: () => void;
  onOpenRules: () => void;
  onOpenShare: () => void;
  theme: ThemeChoice;
  onThemeChange: (t: ThemeChoice) => void;
};

/** The bar across the top: the main "Fill schedule for me" button, undo/redo, help, and the collapsible settings. */
export function TopBar({
  settings,
  onSettingsChange,
  onAutoFill,
  onRebuild,
  onClearShifts,
  onImportShifts,
  hasAutoShifts,
  hasShifts,
  hasStudents,
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
  onUndo,
  onRedo,
  onOpenHelp,
  onOpenRules,
  onOpenShare,
  theme,
  onThemeChange,
}: Props) {
  const [showOptions, setShowOptions] = useState(false);

  return (
    <header className="border-b border-line bg-panel">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:px-6">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-accent-ink">
            <Sparkles className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h1 className="font-display text-lg font-semibold leading-none">Cadence</h1>
            <p className="hidden text-xs text-muted sm:block">Work schedules that fit around classes</p>
          </div>
        </div>

        {/* The main action lives in the header so it is always in view, whatever the window size. It is the only button here with a solid accent fill — everything else is deliberately quieter. */}
        <Button variant="primary" onClick={onAutoFill} disabled={!hasStudents} title={hasStudents ? "Places shifts for everyone, following every rule" : "Add a student first"}>
          <Wand2 className="h-4 w-4" aria-hidden /> Fill schedule for me
        </Button>
        <div className="flex items-center gap-1">
          <Segmented
            label="Semester or break"
            value={settings.term ?? "semester"}
            onChange={(v) => onSettingsChange({ term: v })}
            options={[
              { value: "semester", label: "Semester" },
              { value: "break", label: "Break" },
            ]}
          />
          <HelpTip label="Semester or break">
            <b>Semester:</b> nobody works during Tuesday devotional (11am–12pm), and the weekly limit is {settings.weeklyTargetHours} hours.
            <br />
            <b>Break:</b> 11am–12pm on Tuesday is open, and students may work up to {BREAK_WEEKLY_HOURS} hours a week.
          </HelpTip>
        </div>
        <Button variant="ghost" aria-expanded={showOptions} aria-controls="plan-options" onClick={() => setShowOptions((v) => !v)}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden /> Settings
          <ChevronDown className={clsx("h-4 w-4 transition-transform", showOptions && "rotate-180")} aria-hidden />
        </Button>

        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Button variant="ghost" onClick={onUndo} disabled={!canUndo} aria-label="Undo" title={undoLabel ? `Undo: ${undoLabel}` : "Nothing to undo yet"}>
            <Undo2 className="h-4 w-4" aria-hidden />
          </Button>
          <Button variant="ghost" onClick={onRedo} disabled={!canRedo} aria-label="Redo" title={redoLabel ? `Redo: ${redoLabel}` : "Nothing to redo"}>
            <Redo2 className="h-4 w-4" aria-hidden />
          </Button>
          <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden />
          <Button variant="secondary" onClick={onOpenShare}>
            <CalendarDays className="h-4 w-4" aria-hidden /> Save &amp; share
          </Button>
          <Button variant="ghost" onClick={onOpenRules} aria-label="Rules" title="Rules">
            <Settings className="h-4 w-4" aria-hidden />
          </Button>
          <Button variant="ghost" onClick={onOpenHelp} aria-label="Help" title="Help">
            <HelpCircle className="h-4 w-4" aria-hidden />
          </Button>
          <ThemeControl theme={theme} onChange={onThemeChange} />
        </div>
      </div>

      {/* Collapsed by default at every screen width (not only on narrow ones): these are "set
          once at the start of the semester" controls, not something a manager needs staring at
          them on every visit. */}
      <div
        id="plan-options"
        className={clsx(showOptions ? "flex" : "hidden", "flex-wrap items-center gap-x-5 gap-y-2 border-t border-line bg-bg px-4 py-2 sm:px-6")}
      >
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">
            Office hours
            <HelpTip label="Office hours">
              The hours someone must be working. Pick when the office opens. If you pick 8:00am, the 7:00am row is hidden, but
              any 7:00am shifts already placed still count toward that student&apos;s hours.
            </HelpTip>
          </span>
          <Segmented
            label="Office hours"
            value={settings.openTime}
            onChange={(v) => onSettingsChange({ openTime: v })}
            options={OPEN_TIME_OPTIONS.map((m) => ({ value: m, label: `${formatMinutes(m)}–${formatMinutes(settings.closeTime)}` }))}
          />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">
            People needed at once
            <HelpTip label="People needed at once">
              How many workers must be on duty at the same time. If you pick 2, a half hour with only one person turns pink.
            </HelpTip>
          </span>
          <Segmented
            label="People needed at once"
            value={settings.minStaffPerSlot}
            onChange={(v) => onSettingsChange({ minStaffPerSlot: v })}
            options={MIN_STAFF_OPTIONS.map((n) => ({ value: n, label: String(n) }))}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Button variant="secondary" onClick={onImportShifts} disabled={!hasStudents} title={hasStudents ? "Paste a schedule you already wrote as text" : "Add a student first"}>
            Paste existing shifts
          </Button>
          <Button variant="secondary" onClick={onRebuild} disabled={!hasAutoShifts} title={hasAutoShifts ? "Remakes only the shifts Cadence added. Yours stay." : "There are no automatic shifts yet"}>
            Rebuild automatic shifts
          </Button>
          <Button variant="secondary" onClick={onClearShifts} disabled={!hasShifts}>
            Clear all shifts
          </Button>
        </div>
      </div>
    </header>
  );
}
