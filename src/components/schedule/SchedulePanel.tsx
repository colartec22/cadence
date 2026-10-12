import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { CalendarRange, LayoutGrid, Users } from "lucide-react";
import { ScheduleGrid } from "./ScheduleGrid";
import { ScheduleList } from "./ScheduleList";
import { clsx } from "../../lib/clsx";
import type { Day, ScheduleIssue, ScheduleSettings, ShiftBlock, Student } from "../../features/scheduling/types";

type View = "grid" | "student" | "day";

const VIEWS: { id: View; label: string; icon: typeof LayoutGrid; hint: string }[] = [
  { id: "grid", label: "Grid", icon: LayoutGrid, hint: "Build and edit the schedule" },
  { id: "student", label: "By student", icon: Users, hint: "See each person's shifts" },
  { id: "day", label: "By day", icon: CalendarRange, hint: "See who works each day" },
];

/**
 * Three ways to look at the same schedule. The grid is for building it; the two word views
 * are for reading it, sending it to someone, or printing it.
 */
export function SchedulePanel(props: {
  settings: ScheduleSettings;
  students: Student[];
  assignments: ShiftBlock[];
  issues: ScheduleIssue[];
  selectedStudent: Student | null;
  onToggle: (day: Day, start: number) => void;
  onRange: (day: Day, from: number, to: number, assign: boolean) => void;
  onNotify: (message: string) => void;
}) {
  const [view, setView] = useState<View>("grid");
  const refs = useRef<Record<View, HTMLButtonElement | null>>({ grid: null, student: null, day: null });

  // Left/right arrow keys move between the view tabs (Grid, By student, By day).
  function onKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (index + (e.key === "ArrowRight" ? 1 : VIEWS.length - 1)) % VIEWS.length;
    setView(VIEWS[next].id);
    refs.current[VIEWS[next].id]?.focus();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label="Schedule views" className="no-print flex gap-1 border-b border-line px-3 pt-3 sm:px-4">
        {VIEWS.map(({ id, label, icon: Icon, hint }, i) => (
          <button
            key={id}
            ref={(el) => {
              refs.current[id] = el;
            }}
            type="button"
            role="tab"
            id={`view-tab-${id}`}
            aria-selected={view === id}
            aria-controls="schedule-view"
            tabIndex={view === id ? 0 : -1}
            title={hint}
            onClick={() => setView(id)}
            onKeyDown={(e) => onKey(e, i)}
            className={clsx(
              "-mb-px flex items-center gap-1.5 rounded-t-lg border border-b-0 px-3 py-2 text-sm font-medium",
              view === id ? "border-line bg-panel text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden /> {label}
          </button>
        ))}
      </div>
      <div key={view} id="schedule-view" role="tabpanel" aria-labelledby={`view-tab-${view}`} className="anim-fade-quick min-h-0 flex-1">
        {view === "grid" ? (
          <ScheduleGrid
            settings={props.settings}
            students={props.students}
            assignments={props.assignments}
            issues={props.issues}
            selectedStudent={props.selectedStudent}
            onToggle={props.onToggle}
            onRange={props.onRange}
          />
        ) : (
          <ScheduleList mode={view} students={props.students} assignments={props.assignments} settings={props.settings} onNotify={props.onNotify} />
        )}
      </div>
    </div>
  );
}
