import { describe, expect, it } from "vitest";
import { scheduleToText, shiftText, summarizeByDay, summarizeByStudent } from "../features/scheduling/summary";
import { makeSettings, makeStudent, run, slot } from "./testkit";

/**
 * Tests for the text views of the schedule (`features/scheduling/summary.ts`): shifts grouped by
 * student and by day, and the plain text that can be copied into a message.
 */

const settings = makeSettings();
const noa = makeStudent({ id: "a", name: "Noa K.", color: "#1F6FB2" });
const kai = makeStudent({ id: "b", name: "Kai P.", color: "#B3144F" });
const shifts = [
  ...run("a", "wed", 13 * 60, 15 * 60),
  ...run("a", "mon", 8 * 60, 12 * 60),
  ...run("b", "mon", 9 * 60, 10 * 60),
];

describe("summarizeByStudent", () => {
  const rows = summarizeByStudent([noa, kai], shifts, settings);

  it("keeps roster order and merges each person's slots into real shifts, in week order", () => {
    expect(rows.map((r) => r.student.name)).toEqual(["Noa K.", "Kai P."]);
    expect(rows[0].shifts.map((s) => [s.day, s.start, s.end, s.hours])).toEqual([
      ["mon", 480, 720, 4],
      ["wed", 780, 900, 2],
    ]);
    expect(rows[0].hours).toBe(6);
  });

  it("includes students who have no shifts yet", () => {
    const none = summarizeByStudent([noa, kai], run("a", "mon", 480, 540), settings);
    expect(none[1]).toMatchObject({ hours: 0, shifts: [] });
  });
});

describe("summarizeByDay", () => {
  const days = summarizeByDay([noa, kai], shifts, settings);

  it("always lists every open day (here Monday to Friday), earliest shift first", () => {
    expect(days.map((d) => d.day)).toEqual(["mon", "tue", "wed", "thu", "fri"]);
    expect(days[0].shifts.map((s) => s.name)).toEqual(["Noa K.", "Kai P."]); // 8:00 before 9:00
    expect(days[1].shifts).toEqual([]);
  });

  it("carries the color so a screen can show who is who", () => {
    expect(days[0].shifts[1].color).toBe("#B3144F");
  });

  it("ignores shifts for students who no longer exist", () => {
    expect(summarizeByDay([noa], [...shifts, slot("ghost", "tue", 540)], settings)[1].shifts).toEqual([]);
  });
});

describe("text you can paste into a message", () => {
  it("writes one block per student", () => {
    expect(scheduleToText([noa, kai], shifts, settings, "student")).toBe(
      [
        "Work schedule",
        "",
        "Noa K. (6 hours a week)",
        "  Mon  8:00am–12:00pm (4 hours)",
        "  Wed  1:00pm–3:00pm (2 hours)",
        "",
        "Kai P. (1 hour a week)",
        "  Mon  9:00am–10:00am (1 hour)",
        "",
      ].join("\n").trimEnd() + "\n",
    );
  });

  it("writes one block per day, and says when nobody is working", () => {
    const text = scheduleToText([noa, kai], shifts, settings, "day");
    expect(text).toContain("Monday\n  8:00am–12:00pm  Noa K.\n  9:00am–10:00am  Kai P.");
    expect(text).toContain("Tuesday\n  Nobody scheduled");
  });

  it("says so kindly when a student has nothing yet", () => {
    expect(scheduleToText([noa], [], settings, "student")).toContain("  No shifts yet");
  });

  it("uses correct singular and plural for hours", () => {
    expect(shiftText({ start: 540, end: 570, hours: 0.5 })).toBe("9:00am–9:30am (0.5 hours)");
    expect(shiftText({ start: 540, end: 600, hours: 1 })).toBe("9:00am–10:00am (1 hour)");
  });
});
