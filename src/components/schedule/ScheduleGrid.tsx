import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { AlertTriangle } from "lucide-react";
import { HelpTip } from "../help/HelpTip";
import { assignedHours, canAssign, daySlots, isAssigned, staffAt } from "../../features/scheduling/availability";
import { describeGap } from "../../features/scheduling/issues";
import { isDevotional, isOnBreak, weeklyLimit } from "../../features/scheduling/term";
import { formatMinutes, initials } from "../../features/scheduling/selectors";
import { endSentence } from "../../features/scheduling/time";
import { DAY_LABEL, DAY_LONG } from "../../features/scheduling/types";
import { openDays } from "../../features/scheduling/days";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { clsx } from "../../lib/clsx";
import type { Day, ScheduleIssue, ScheduleSettings, ShiftBlock, Student } from "../../features/scheduling/types";

/**
 * ============================================================================
 *  THE WEEKLY SCHEDULE GRID
 * ============================================================================
 * The main "build the schedule" screen: one table, days across the top, 30-
 * minute time slots down the side. This is the most interaction-heavy
 * component in the app — it supports click, Shift+click, mouse-drag, and
 * full keyboard navigation (arrow keys / Home / End / Page Up / Page Down) on
 * ONE shared Tab stop (see the AUDIT.md note about ~100 Tab stops in an
 * earlier version). `model` below is recomputed whenever the schedule
 * changes and holds everything one grid box needs to render (who's on it,
 * whether it's short-staffed, its screen-reader label) so the render loop
 * itself stays simple. Read `activate` (click), `beginDrag`/`extendDrag`
 * (mouse drag-to-fill), and `onCellKeyDown` (keyboard) to see the three ways
 * a box gets toggled.
 */
type Anchor = { day: Day; start: number; assign: boolean };

type CellModel = {
  staffIds: string[];
  need: number;
  /** Tuesday devotional during the semester: nobody works, nobody is needed. */
  closed: boolean;
  mine: boolean;
  hardBlocked: boolean;
  label: string;
};

const STRIPES =
  "bg-[repeating-linear-gradient(135deg,transparent_0px,transparent_5px,rgb(var(--busy)/0.55)_5px,rgb(var(--busy)/0.55)_7px)]";

/**
 * The week grid: one row per half hour, one column per weekday. Clicking a box adds or removes
 * the selected student; dragging (or Shift+click) fills a stretch; arrow keys move around.
 */
export function ScheduleGrid({
  settings,
  students,
  assignments,
  issues,
  selectedStudent,
  onToggle,
  onRange,
}: {
  settings: ScheduleSettings;
  students: Student[];
  assignments: ShiftBlock[];
  issues: ScheduleIssue[];
  selectedStudent: Student | null;
  onToggle: (day: Day, start: number) => void;
  onRange: (day: Day, from: number, to: number, assign: boolean) => void;
}) {
  const slots = useMemo(() => daySlots(settings), [settings]);
  const wide = useMediaQuery("(min-width: 640px)");
  // Saturday shows only when the office is open on Saturdays (Settings → Days open).
  const days = useMemo(() => openDays(settings), [settings]);
  const [chosenMobileDay, setMobileDay] = useState<Day>("mon");
  // If the office stops opening on the day picked on a phone (Saturday), fall back to Monday.
  const mobileDay = days.includes(chosenMobileDay) ? chosenMobileDay : days[0];
  const visibleDays: Day[] = wide ? days : [mobileDay];

  const [active, setActive] = useState({ row: 0, col: 0 });
  const [info, setInfo] = useState<{ day: Day; start: number } | null>(null);
  const anchor = useRef<Anchor | null>(null);
  // Mouse drag-to-fill: where the press started and how it should act (add or clear), plus a live preview.
  const dragStart = useRef<{ day: Day; start: number; assign: boolean } | null>(null);
  const dragLast = useRef<{ day: Day; start: number } | null>(null);
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState<{ day: Day; from: number; to: number; assign: boolean } | null>(null);
  const onRangeRef = useRef(onRange);
  onRangeRef.current = onRange;
  const cells = useRef(new Map<string, HTMLButtonElement>());

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  // Slots holding a rule-breaking shift, so the cell can show a warning icon (not just a color).
  const problemSlots = useMemo(() => {
    const set = new Set<string>();
    for (const issue of issues) {
      if (issue.day && issue.start != null && issue.end != null) {
        for (let m = issue.start; m < issue.end; m += settings.slotMinutes) set.add(`${issue.studentId}|${issue.day}|${m}`);
      }
    }
    return set;
  }, [issues, settings.slotMinutes]);

  // Everything a cell needs, worked out once per data change (not on every hover).
  const model = useMemo(() => {
    const out = new Map<string, CellModel>();
    for (const day of days) {
      for (const start of slots) {
        const staffIds = staffAt(day, start, assignments);
        const names = staffIds.map((id) => studentById.get(id)?.name ?? "Unknown");
        const closed = isDevotional(day, start, settings);
        const need = closed ? 0 : settings.minStaffPerSlot - staffIds.length;
        const mine = selectedStudent ? isAssigned(selectedStudent.id, day, start, assignments) : false;
        const violation = selectedStudent && !mine ? canAssign(selectedStudent, day, start, assignments, settings) : null;
        const hardBlocked = Boolean(
          violation && (violation.code === "class_conflict" ||
            violation.code === "unavailable" ||
            violation.code === "after_cutoff" ||
            violation.code === "break_conflict" ||
          violation.code === "devotional"),
        );

        let label = `${DAY_LONG[day]} ${formatMinutes(start)} to ${formatMinutes(start + settings.slotMinutes)}.`;
        label += names.length ? ` ${endSentence(`Working: ${names.join(", ")}`)}` : " Nobody is working.";
        if (closed) label += " Tuesday devotional. Nobody works now.";
        else label += need > 0 ? ` Needs ${need} more. ${describeGap(students, assignments, settings, day, start)}` : " Enough people.";
        if (selectedStudent) {
          if (mine) label += ` ${selectedStudent.name} is working here. Press to remove.`;
          else label += violation ? ` ${selectedStudent.name} ${violation.message}.` : ` Press to add ${selectedStudent.name}.`;
        }
        out.set(`${day}|${start}`, { staffIds, need, closed, mine, hardBlocked, label });
      }
    }
    return out;
  }, [slots, assignments, students, studentById, settings, selectedStudent]);

  const row = Math.min(active.row, Math.max(0, slots.length - 1));
  const col = Math.min(active.col, Math.max(0, visibleDays.length - 1));

  useEffect(() => {
    anchor.current = null;
  }, [selectedStudent?.id]);

  // Moves keyboard focus to a box, keeping the row and column inside the grid's edges.
  function focusCell(r: number, c: number) {
    const rr = Math.max(0, Math.min(slots.length - 1, r));
    const cc = Math.max(0, Math.min(visibleDays.length - 1, c));
    setActive({ row: rr, col: cc });
    cells.current.get(`${cc}-${rr}`)?.focus();
  }

  // Arrow keys, Home and End move between boxes, like in a spreadsheet.
  function onCellKeyDown(e: KeyboardEvent<HTMLButtonElement>, r: number, c: number) {
    const move: Record<string, [number, number]> = {
      ArrowUp: [r - 1, c],
      ArrowDown: [r + 1, c],
      ArrowLeft: [r, c - 1],
      ArrowRight: [r, c + 1],
      Home: [r, 0],
      End: [r, visibleDays.length - 1],
      PageUp: [r - 8, c],
      PageDown: [r + 8, c],
    };
    const target = move[e.key];
    if (target) {
      e.preventDefault();
      focusCell(target[0], target[1]);
    }
  }

  // Mouse pressed on a box: remember where the drag started and whether it adds or removes shifts.
  function beginDrag(e: PointerEvent<HTMLButtonElement>, day: Day, start: number) {
    // Mouse and pen only. Touch keeps scrolling the page, and the keyboard has its own range keys.
    if (e.button !== 0 || e.pointerType === "touch" || !selectedStudent) return;
    const mine = model.get(`${day}|${start}`)?.mine ?? false;
    dragStart.current = { day, start, assign: !mine };
    dragLast.current = { day, start };
  }

  // Mouse moved over another box on the same day while dragging: stretch the highlighted range to it.
  function extendDrag(day: Day, start: number) {
    const from = dragStart.current;
    if (!from || from.day !== day) return;
    dragLast.current = { day, start };
    if (start !== from.start) setDrag({ day, from: from.start, to: start, assign: from.assign });
  }

  // A drag can end anywhere, even outside the grid, so it is finished from the window.
  useEffect(() => {
    function finish() {
      const from = dragStart.current;
      const last = dragLast.current;
      dragStart.current = null;
      dragLast.current = null;
      setDrag(null);
      if (!from || !last || last.day !== from.day || last.start === from.start) return;
      // The mouse-up is followed by a click; that click was the end of the drag, so it must not toggle a box.
      suppressClick.current = true;
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      onRangeRef.current(from.day, from.start, last.start, from.assign);
    }
    function cancel() {
      dragStart.current = null;
      dragLast.current = null;
      setDrag(null);
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") cancel();
    }
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // True if this box is inside the range currently being dragged (so it can be highlighted).
  const inDrag = (day: Day, slot: number) =>
    drag !== null && drag.day === day && slot >= Math.min(drag.from, drag.to) && slot <= Math.max(drag.from, drag.to);

  // A box was clicked or pressed with Enter/Space. With Shift held, fill from the last box to this one.
  function activate(day: Day, start: number, shift: boolean) {
    if (!selectedStudent) {
      onToggle(day, start); // the store explains "pick a student first"
      return;
    }
    const cell = model.get(`${day}|${start}`);
    if (shift && anchor.current && anchor.current.day === day && anchor.current.start !== start) {
      onRange(day, anchor.current.start, start, anchor.current.assign);
      return;
    }
    const mine = cell?.mine ?? false;
    const allowed = mine || canAssign(selectedStudent, day, start, assignments, settings) === null;
    onToggle(day, start);
    // Remember what this click meant (add or clear) so Shift+click can extend it — only if it actually worked.
    anchor.current = allowed ? { day, start, assign: !mine } : null;
  }

  const selectedHours = selectedStudent ? assignedHours(selectedStudent.id, assignments, settings) : 0;
  const infoCell = info ? model.get(`${info.day}|${info.start}`) : null;

  return (
    <section aria-labelledby="grid-heading" className="flex h-full min-h-0 flex-col gap-2 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="grid-heading" className="font-display text-lg font-semibold">
          {isOnBreak(settings) ? "Break schedule" : "Semester schedule"}
          <HelpTip label="Weekly schedule">
            Each box is 30 minutes. Pick a student on the left, then click a box to give them that half hour. Click again to take
            it away. To fill a stretch, drag down a column or hold Shift and click. A blue outline means the picked student works
            that box, and a ⚠ means a rule is broken there. Shifts must be at least 2 hours. The semester and break schedules
            are kept separately: the Semester / Break switch at the top chooses which one you see and change.
          </HelpTip>
        </h2>
        <p className="text-sm" aria-live="polite">
          {selectedStudent ? (
            <>
              Scheduling <strong>{selectedStudent.name}</strong>{" "}
              <span className="text-muted">
                ({selectedHours} of {weeklyLimit(settings)} hours)
              </span>
            </>
          ) : (
            <span className="text-muted">Pick a student on the left to start.</span>
          )}
        </p>
      </div>

      {/* Only the three things a manager looks for; the rest is explained behind the "?" above. */}
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted" aria-label="What the boxes mean">
        <li className="flex items-center gap-1.5">
          <span className="h-4 w-4 rounded-sm bg-ok-bg ring-1 ring-inset ring-ok/40" aria-hidden /> Enough people
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-4 w-4 rounded-sm bg-gap-bg ring-1 ring-inset ring-gap" aria-hidden /> Needs someone
        </li>
        <li className="flex items-center gap-1.5">
          <span className={clsx("h-4 w-4 rounded-sm bg-panel ring-1 ring-inset ring-line", STRIPES)} aria-hidden /> Picked student can&apos;t work
        </li>
      </ul>

      {!wide && (
        <div role="group" aria-label="Choose a day" className="flex gap-1">
          {days.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={d === mobileDay}
              onClick={() => setMobileDay(d)}
              className={clsx(
                "flex-1 rounded-lg border px-2 py-2 text-sm font-medium",
                d === mobileDay ? "border-accent bg-accent text-accent-ink" : "border-line bg-panel",
              )}
            >
              {DAY_LABEL[d]}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto soft-shadow rounded-xl border border-line bg-panel">
        <table role="grid" aria-label="Weekly schedule. Use the arrow keys to move between boxes." className="w-full min-w-[280px] select-none border-separate border-spacing-0">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 top-0 z-20 w-16 bg-panel p-1 text-right text-xs font-normal text-muted">
                <span className="sr-only">Time</span>
              </th>
              {visibleDays.map((day) => (
                <th key={day} scope="col" className="sticky top-0 z-10 border-b border-line bg-panel px-1.5 py-2 text-left text-[11px] font-semibold uppercase tracking-widest text-muted">
                  <span aria-hidden>{DAY_LABEL[day]}</span>
                  <span className="sr-only">{DAY_LONG[day]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody onMouseLeave={() => setInfo(null)}>
            {slots.map((slot, r) => (
              <tr key={slot}>
                <th
                  scope="row"
                  className={clsx(
                    "sticky left-0 z-10 whitespace-nowrap bg-panel p-1 pr-2 text-right align-top text-xs",
                    slot % 60 === 0 ? "border-t border-line/70 font-semibold text-ink" : "border-t border-dashed border-line/40 font-normal text-muted",
                  )}
                >
                  {formatMinutes(slot)}
                </th>
                {visibleDays.map((day, c) => {
                  const cell = model.get(`${day}|${slot}`)!;
                  const isActive = r === row && c === col;
                  return (
                    <td
                      key={day}
                      role="gridcell"
                      className={clsx("border-l border-line/50 p-[3px] align-middle", slot % 60 === 0 ? "border-t border-line/70" : "border-t border-dashed border-line/40")}
                    >
                      <button
                        type="button"
                        ref={(el) => {
                          if (el) cells.current.set(`${c}-${r}`, el);
                          else cells.current.delete(`${c}-${r}`);
                        }}
                        tabIndex={isActive ? 0 : -1}
                        aria-label={cell.label}
                        aria-pressed={selectedStudent ? cell.mine : undefined}
                        aria-disabled={cell.hardBlocked ? true : undefined}
                        onFocus={() => {
                          setActive({ row: r, col: c });
                          setInfo({ day, start: slot });
                        }}
                        onMouseEnter={() => setInfo({ day, start: slot })}
                        onPointerDown={(e) => beginDrag(e, day, slot)}
                        onPointerEnter={() => extendDrag(day, slot)}
                        onKeyDown={(e) => onCellKeyDown(e, r, c)}
                        onClick={(e: MouseEvent<HTMLButtonElement>) => {
                          if (suppressClick.current) return; // this click was the end of a drag, which already did the work
                          activate(day, slot, e.shiftKey);
                        }}
                        className={clsx(
                          "relative flex h-10 w-full min-w-[56px] items-center gap-0.5 overflow-hidden rounded-lg px-1 text-left transition duration-100 ease-out",
                          cell.closed ? "bg-line/40" : cell.need > 0 ? "bg-gap-bg ring-1 ring-inset ring-gap" : "bg-ok-bg/70",
                          cell.mine && "ring-2 ring-inset ring-accent",
                          inDrag(day, slot) &&
                            (drag?.assign
                              ? "bg-accent/25 outline outline-2 -outline-offset-2 outline-accent"
                              : "outline outline-2 -outline-offset-2 outline-dashed outline-muted"),
                          cell.hardBlocked ? "cursor-not-allowed" : "hover:brightness-95",
                        )}
                      >
                        {cell.hardBlocked && !cell.closed && <span className={clsx("pointer-events-none absolute inset-0", STRIPES)} aria-hidden />}
                        {cell.closed && !cell.staffIds.length && (
                          <span className="relative text-xs font-semibold text-muted" aria-hidden>
                            Devotional
                          </span>
                        )}
                        {cell.staffIds.map((id) => {
                          const s = studentById.get(id);
                          if (!s) return null;
                          const broken = problemSlots.has(`${id}|${day}|${slot}`);
                          return (
                            <span
                              key={id}
                              className="relative inline-flex h-6 min-w-6 items-center justify-center gap-0.5 rounded px-1 text-xs font-bold text-white"
                              style={{ backgroundColor: s.color }}
                              aria-hidden
                            >
                              {initials(s.name)}
                              {broken && <AlertTriangle className="h-3 w-3" />}
                            </span>
                          );
                        })}
                        {cell.need > 0 && (
                          <span className="relative ml-auto pr-0.5 text-xs font-semibold text-gap" aria-hidden>
                            Need {cell.need}
                          </span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Sighted helper text. Screen readers already hear the same words from the focused box. */}
      <p aria-hidden className="min-h-10 rounded-lg bg-bg px-3 py-2 text-sm leading-snug">
        {infoCell ? infoCell.label : "Point at a box to see who is working."}
      </p>
    </section>
  );
}
