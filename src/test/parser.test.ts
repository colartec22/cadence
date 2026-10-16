import { describe, expect, it } from "vitest";
import { mentionsSunday, parseClassText, parseDays, parseMeetingLine, parseTime, parseTimeRange } from "../features/scheduling/parser";

/**
 * Tests for the class-time reader (`features/scheduling/parser.ts`): day lists like "MWF" or
 * "Tuesday/Thursday", clock times with or without am/pm, and whole pasted registration exports.
 */

describe("parseDays", () => {
  it.each([
    ["MWF", ["mon", "wed", "fri"]],
    ["MW", ["mon", "wed"]],
    ["TTh", ["tue", "thu"]],
    ["TR", ["tue", "thu"]],
    ["Th", ["thu"]],
    ["Tuesday/Thursday", ["tue", "thu"]],
    ["Mon, Wed, Fri", ["mon", "wed", "fri"]],
    ["M/W/F", ["mon", "wed", "fri"]],
    ["T Th", ["tue", "thu"]],
    ["Thurs", ["thu"]],
    ["Wednesday", ["wed"]],
  ])("reads %s", (input, expected) => {
    expect(parseDays(input)).toEqual(expected);
  });

  it("rejects things that are not days", () => {
    expect(parseDays("Online")).toBeNull();
    expect(parseDays("Monkey")).toBeNull();
    expect(parseDays("")).toBeNull();
  });

  it("rejects an ambiguous repeated code instead of guessing", () => {
    expect(parseDays("TT")).toBeNull();
  });

  it("reads Saturday as a full name, a short name, or S / Sa in a code", () => {
    expect(parseDays("Saturday")).toEqual(["sat"]);
    expect(parseDays("Sat")).toEqual(["sat"]);
    expect(parseDays("MWFS")).toEqual(["mon", "wed", "fri", "sat"]);
    expect(parseDays("TThSa")).toEqual(["tue", "thu", "sat"]);
    expect(parseDays("MWF Sat")).toEqual(["mon", "wed", "fri", "sat"]);
  });

  it("recognises Sunday, which the office is never open on", () => {
    expect(mentionsSunday("Sun")).toBe(true);
    expect(mentionsSunday("Saturday/Sunday")).toBe(true);
    expect(mentionsSunday("Sat")).toBe(false);
    expect(mentionsSunday("MWF")).toBe(false);
  });
});

describe("parseTime", () => {
  it("reads explicit am/pm", () => {
    expect(parseTime("9:00am")).toEqual({ minutes: 540, explicitMeridiem: true });
    expect(parseTime("1:00pm")).toEqual({ minutes: 780, explicitMeridiem: true });
    expect(parseTime("1:00 p.m.")).toEqual({ minutes: 780, explicitMeridiem: true });
  });
  it("handles noon and midnight", () => {
    expect(parseTime("noon")?.minutes).toBe(720);
    expect(parseTime("12:00")?.minutes).toBe(720);
    expect(parseTime("12:00pm")?.minutes).toBe(720);
    expect(parseTime("12:00am")?.minutes).toBe(0);
    expect(parseTime("12:30am")?.minutes).toBe(30);
  });
  it("accepts unambiguous 24-hour times", () => {
    expect(parseTime("13:30")).toEqual({ minutes: 810, explicitMeridiem: true });
    expect(parseTime("17:00")?.minutes).toBe(1020);
  });
  it("flags a bare hour as inferred", () => {
    expect(parseTime("9:00")).toEqual({ minutes: 540, explicitMeridiem: false });
    expect(parseTime("2:00")).toEqual({ minutes: 840, explicitMeridiem: false });
  });
  it("rejects invalid times", () => {
    for (const bad of ["25:00", "9:99", "not a time", "0:30", "13:00pm", "0am", ""]) expect(parseTime(bad)).toBeNull();
  });
});

describe("parseTimeRange", () => {
  it("lets a bare start borrow the end's am/pm without a warning", () => {
    expect(parseTimeRange("8:00", "9:15 PM")).toEqual({ start: 20 * 60, end: 21 * 60 + 15, inferred: false });
    expect(parseTimeRange("9:00", "9:50 AM")).toEqual({ start: 540, end: 590, inferred: false });
  });
  it("falls back to the school-hours guess and says so", () => {
    expect(parseTimeRange("9:00", "9:50")).toEqual({ start: 540, end: 590, inferred: true });
    // 1:00-2:15 could only sensibly be the afternoon, so there is nothing to double-check
    expect(parseTimeRange("1:00", "2:15")).toEqual({ start: 780, end: 855, inferred: false });
  });
  it("crosses noon correctly", () => {
    expect(parseTimeRange("11:00", "12:15 PM")).toEqual({ start: 660, end: 735, inferred: false });
    expect(parseTimeRange("11:00", "1:00")).toMatchObject({ start: 660, end: 780 });
  });
  it("rejects backwards or absurdly long ranges", () => {
    expect(parseTimeRange("10:00", "9:00")).toBeNull();
    expect(parseTimeRange("6:00am", "11:00pm")).toBeNull();
  });
});

describe("parseMeetingLine", () => {
  it("reads a Workday pipe row and ignores room and course details", () => {
    const line = parseMeetingLine("Tuesday/Thursday | 8:00 AM - 9:15 AM | SCB 211");
    expect(line).toMatchObject({ ok: true, days: ["tue", "thu"], start: 480, end: 555 });
    expect(line.warning).toBeUndefined();
  });
  it("reads dashes of every kind and 'to'", () => {
    expect(parseMeetingLine("MWF 9:00am – 9:50am").ok).toBe(true);
    expect(parseMeetingLine("MWF 9:00am — 9:50am").ok).toBe(true);
    expect(parseMeetingLine("MWF 9:00am to 9:50am").ok).toBe(true);
  });
  it("does not mistake letters in a room name for am/pm", () => {
    const line = parseMeetingLine("MWF 9:00 - 9:50 Amphitheater");
    expect(line.ok).toBe(true);
    expect(line.start).toBe(540);
  });
  it("reads Saturday classes, and explains Sunday ones instead of guessing", () => {
    expect(parseMeetingLine("Sat 9:00am-11:00am")).toMatchObject({ ok: true, days: ["sat"], start: 540, end: 660 });
    expect(parseMeetingLine("Sun 9:00am-11:00am")).toMatchObject({ ok: false });
    expect(parseMeetingLine("Sun 9:00am-11:00am").warning).toMatch(/Sunday/);
  });
  it("rejects junk and over-long lines without hanging", () => {
    expect(parseMeetingLine("hello world").ok).toBe(false);
    expect(parseMeetingLine("x".repeat(5000)).ok).toBe(false);
  });
});

describe("parseClassText", () => {
  it("parses the required short-form patterns", () => {
    for (const p of ["MWF 9:00-9:50", "MW 1:00pm-2:15pm", "TTh 8:00-9:15", "TR 9:00-10:15", "Th 8:00-9:15"]) {
      const result = parseClassText(p);
      expect(result.errors, p).toEqual([]);
      expect(result.busy.length).toBeGreaterThan(0);
    }
  });
  it("expands days into one busy block per day", () => {
    expect(parseClassText("Tuesday/Thursday | 8:00 AM - 9:15 AM | SCB 211").busy).toEqual([
      { day: "tue", start: 480, end: 555, source: "class" },
      { day: "thu", start: 480, end: 555, source: "class" },
    ]);
  });
  it("keeps good lines and reports bad ones", () => {
    const result = parseClassText("MWF 9:00-9:50\ngarbage line\nTTh 1:00pm-2:15pm");
    expect(result.errors).toHaveLength(1);
    expect(result.busy).toHaveLength(5);
  });
  it("understands online/no-meeting classes: nothing is blocked, no time is invented, and it is not an error", () => {
    for (const text of ["Online - Asynchronous", "Online", "TBA", "Arranged", "ONLINE ASYNC", "No meeting pattern", "Online | Asynchronous"]) {
      const result = parseClassText(text);
      expect(result.errors, text).toEqual([]);
      expect(result.busy, text).toEqual([]);
      expect(result.warnings, text).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/nothing is blocked/);
    }
  });
  it("still blocks the real classes around an online one", () => {
    const result = parseClassText("MWF 9:00am-9:50am\nOnline - Asynchronous\nTTh 1:00pm-2:15pm");
    expect(result.errors).toEqual([]);
    expect(result.busy).toHaveLength(5);
  });
  it("never quietly skips a line that has a real time, even if it also says online or TBA — it is reported instead", () => {
    expect(parseClassText("Online MWF 9:00am-9:50am").errors).toHaveLength(1);
    expect(parseClassText("TBA 9:00-9:50").errors).toHaveLength(1);
    expect(parseClassText("Online MWF 9:00am-9:50am").warnings).toEqual([]);
  });
  it("warns only when am/pm had to be guessed", () => {
    expect(parseClassText("MWF 9:00-9:50").warnings).toHaveLength(1);
    expect(parseClassText("MWF 9:00am-9:50am").warnings).toHaveLength(0);
    expect(parseClassText("MWF 9:00-9:50 AM").warnings).toHaveLength(0);
  });
  it("does not duplicate a class pasted twice", () => {
    expect(parseClassText("MWF 9:00-9:50\nMWF 9:00-9:50").busy).toHaveLength(3);
  });
  it("caps absurdly large pastes", () => {
    const many = Array.from({ length: 500 }, () => "MWF 9:00-9:50").join("\n");
    expect(parseClassText(many).errors.some((e) => /too many/i.test(e))).toBe(true);
  });
  it("never throws on hostile input", () => {
    for (const s of ["", "\n\n", "|||", "<script>alert(1)</script>", "9:00-10:00", "MWF -", "MWF 9:00-", "\u0000\u0001"]) {
      expect(() => parseClassText(s)).not.toThrow();
    }
  });
});
