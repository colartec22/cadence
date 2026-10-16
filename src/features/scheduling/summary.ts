import { mergeContiguousBlocks } from "./blocks";
import { assignedHours } from "./availability";
import { hoursLabel, formatRange } from "./time";
import { DAYS, DAY_LABEL, DAY_LONG } from "./types";
import { openDays } from "./days";
import type { Day, Minutes, ScheduleSettings, ShiftBlock, Student } from "./types";

/**
 * ============================================================================
 *  "BY STUDENT" / "BY DAY" READABLE VIEWS
 * ============================================================================
 * The grid is great for BUILDING a schedule but hard to read at a glance.
 * This file reshapes the same `assignments` into two friendlier layouts —
 * grouped by student, and grouped by day — plus a plain-text version for
 * copying into a message or email.
 */

/** One contiguous shift, ready to show or send: "Mon 8:00am–12:00pm (4 hours)". */
export type ShiftLine = {
  studentId: string;
  day: Day;
  start: Minutes;
  end: Minutes;
  hours: number;
};

export type StudentShifts = { student: Student; hours: number; shifts: ShiftLine[] };
export type DayShifts = { day: Day; shifts: (ShiftLine & { name: string; color: string; avatar?: string })[] };

/** Joins back-to-back half hours into whole shifts and adds each shift's length in hours. */
function lines(assignments: ShiftBlock[], slotMinutes: number): ShiftLine[] {
  return mergeContiguousBlocks(assignments, slotMinutes).map((b) => ({ ...b, hours: (b.end - b.start) / 60 }));
}

/** Every student in roster order, each with their shifts in week order. Students with no shifts are included. */
export function summarizeByStudent(students: Student[], assignments: ShiftBlock[], settings: ScheduleSettings): StudentShifts[] {
  const all = lines(assignments, settings.slotMinutes);
  return students.map((student) => ({
    student,
    hours: assignedHours(student.id, assignments, settings),
    shifts: all
      .filter((l) => l.studentId === student.id)
      .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.start - b.start),
  }));
}

/**
 * Every day the office is open (Monday to Friday, or to Saturday), each with the shifts that day,
 * earliest first. A closed day is listed too if shifts are still saved on it, so none go unseen.
 */
export function summarizeByDay(students: Student[], assignments: ShiftBlock[], settings: ScheduleSettings): DayShifts[] {
  const byId = new Map(students.map((s) => [s.id, s]));
  const all = lines(assignments, settings.slotMinutes);
  const open = openDays(settings);
  const days = DAYS.filter((day) => open.includes(day) || all.some((l) => l.day === day && byId.has(l.studentId)));
  return days.map((day) => ({
    day,
    shifts: all
      .filter((l) => l.day === day && byId.has(l.studentId))
      .map((l) => ({ ...l, name: byId.get(l.studentId)!.name, color: byId.get(l.studentId)!.color, avatar: byId.get(l.studentId)!.avatar }))
      .sort((a, b) => a.start - b.start || a.name.localeCompare(b.name)),
  }));
}

/** One shift as readable text, e.g. "9:00am–11:00am (2 hours)". */
export function shiftText(line: Pick<ShiftLine, "start" | "end" | "hours">): string {
  return `${formatRange(line.start, line.end)} (${hoursLabel(line.hours)})`;
}

/**
 * Plain text a manager can paste into a message or email. Student view is written so each
 * person can be sent their own block; day view reads like a posted rota.
 */
export function scheduleToText(
  students: Student[],
  assignments: ShiftBlock[],
  settings: ScheduleSettings,
  mode: "student" | "day",
): string {
  const out: string[] = ["Work schedule", ""];
  if (mode === "student") {
    for (const { student, hours, shifts } of summarizeByStudent(students, assignments, settings)) {
      out.push(`${student.name} (${hoursLabel(hours)} a week)`);
      if (!shifts.length) out.push("  No shifts yet");
      for (const s of shifts) out.push(`  ${DAY_LABEL[s.day]}  ${shiftText(s)}`);
      out.push("");
    }
  } else {
    for (const { day, shifts } of summarizeByDay(students, assignments, settings)) {
      out.push(DAY_LONG[day]);
      if (!shifts.length) out.push("  Nobody scheduled");
      for (const s of shifts) out.push(`  ${formatRange(s.start, s.end)}  ${s.name}`);
      out.push("");
    }
  }
  return out.join("\n").trimEnd() + "\n";
}
