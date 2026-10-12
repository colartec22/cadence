import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "../ui/Button";
import { EmptyMark } from "../ui/EmptyMark";
import { StudentCard } from "./StudentCard";
import { summarizeStudent } from "../../features/scheduling/selectors";
import { weeklyLimit } from "../../features/scheduling/term";
import type { ScheduleIssue, ScheduleSettings, ShiftBlock, Student } from "../../features/scheduling/types";

/** The left-hand column: search box, "Add student"/"Add several at once" entry points, and the scrolling list of `StudentCard`s. Filtering by the search box happens entirely here (`filtered`) — it doesn't change what's actually stored. */
export function StudentRail({
  students,
  assignments,
  settings,
  issues,
  selectedStudentId,
  onSelect,
  onEdit,
  onRemove,
  onAddNew,
  onAddMany,
}: {
  students: Student[];
  assignments: ShiftBlock[];
  settings: ScheduleSettings;
  issues: ScheduleIssue[];
  selectedStudentId: string | null;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onAddNew: () => void;
  onAddMany: () => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? students.filter((s) => s.name.toLowerCase().includes(q)) : students;
  }, [students, query]);

  return (
    <section aria-labelledby="students-heading" className="flex h-full min-h-0 flex-col gap-3 bg-panel p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="students-heading" className="whitespace-nowrap font-display text-lg font-semibold">
          Students
        </h2>
        <Button variant="primary" className="shrink-0 whitespace-nowrap px-2.5" onClick={onAddNew}>
          <Plus className="h-4 w-4" aria-hidden /> Add student
        </Button>
      </div>
      <p className="text-sm text-muted">
        Click a name, then click the schedule.{" "}
        <button type="button" onClick={onAddMany} className="font-medium text-accent underline underline-offset-2">
          Add several at once
        </button>
      </p>

      {students.length > 5 && (
        <label className="relative block">
          <span className="sr-only">Search students by name</span>
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name…"
            className="w-full rounded-lg border border-line bg-bg py-2 pl-8 pr-2 text-sm"
          />
        </label>
      )}

      <ul className="stagger min-h-0 flex-1 overflow-y-auto pr-0.5" aria-label="Student list">
        {filtered.map((student) => (
          <StudentCard
            key={student.id}
            summary={summarizeStudent(student, assignments, settings)}
            targetHours={weeklyLimit(settings)}
            limitHours={weeklyLimit(settings)}
            selected={student.id === selectedStudentId}
            issueCount={issues.filter((i) => i.studentId === student.id && !i.overridden).length}
            onSelect={() => onSelect(student.id)}
            onEdit={() => onEdit(student.id)}
            onRemove={() => onRemove(student.id)}
          />
        ))}
        {!students.length && (
          <li className="rounded-xl border border-dashed border-line p-5 text-center">
            <EmptyMark className="mx-auto h-16 w-16" />
            <p className="mt-2 font-semibold">No students yet</p>
            <p className="mt-1 text-sm text-muted">Add a student and paste the times they have class. Cadence keeps them out of those times.</p>
            <Button variant="primary" className="mt-3" onClick={onAddNew}>
              <Plus className="h-4 w-4" aria-hidden /> Add your first student
            </Button>
          </li>
        )}
        {students.length > 0 && !filtered.length && <li className="text-sm text-muted">No student has “{query}” in their name.</li>}
      </ul>
    </section>
  );
}
