import { afterEach, describe, expect, it, vi } from "vitest";
import { parseClassText } from "../features/scheduling/parser";
import { fixReadingMistakes, ocrTextToClassText } from "../features/import/ocr/ocr-text";
import { enhancePixels, toGrayscale, upscaleFactor } from "../features/import/ocr/preprocess";
import { OCR_MAX_PIXELS, OCR_MAX_UPSCALE } from "../features/import/ocr/constants";
import { checkScreenshotFile } from "../features/import/ocr/screenshot-reader";
import { forgetEnhancedReadingAvailability, isEnhancedReadingAvailable, readWithEnhancedReader } from "../features/import/ocr/enhanced-reader";
import { signOutManager } from "../services/automation/managerSession";

/**
 * Tests for reading class times from screenshots in the browser (`src/features/import/ocr/`): tidying
 * the text a reader found, cleaning up the picture's pixels, and asking the server for enhanced reading.
 * Tesseract itself needs a real browser, so it is tested separately against the sample screenshots in
 * `test-assets/` (see `test-assets/README.md`).
 */

describe("fixReadingMistakes: the usual OCR slips in times", () => {
  it("turns letters read instead of digits back into digits, but only inside a time", () => {
    expect(fixReadingMistakes("MWF 9:O0 AM - 9:5O AM")).toBe("MWF 9:00 AM - 9:50 AM");
    expect(fixReadingMistakes("TTh l0:30 - ll:45")).toBe("TTh 10:30 - 11:45");
    expect(fixReadingMistakes("Online course")).toBe("Online course");
  });

  it("accepts dots, semicolons and commas read instead of a colon", () => {
    expect(fixReadingMistakes("MW 9.00-9;50")).toBe("MW 9:00-9:50");
    expect(fixReadingMistakes("F 1,15 PM - 2,05 PM")).toBe("F 1:15 PM - 2:05 PM");
  });

  it("evens out dashes and am/pm written apart", () => {
    expect(fixReadingMistakes("TTh 1:00 p.m — 2:15 P M")).toBe("TTh 1:00 PM - 2:15 PM");
    expect(fixReadingMistakes("MWF 8:00 a m ~ 8:50 a m")).toBe("MWF 8:00 AM - 8:50 AM");
  });

  it("leaves numbers that can't be a time alone", () => {
    expect(fixReadingMistakes("Room 4.75")).toBe("Room 4.75");
    expect(fixReadingMistakes("ENGL 101.01")).toBe("ENGL 101.01");
  });
});

describe("ocrTextToClassText: picking the class times out of a screenshot's text", () => {
  it("reads a Workday-style table, ignoring course names, teachers, rooms and headings", () => {
    const text = [
      "My Enrolled Courses",
      "Course  Meeting Patterns  Instructor",
      "ENGL 101 - Writing  MWF | 9:00 AM - 9:50 AM | GCB 112  Pat Example",
      "MATH 110 - Algebra  TTh | 1:00 PM - 2:15 PM | SCB 211  Sam Sample",
      "REL 200 - Online  Online",
    ].join("\n");
    const result = ocrTextToClassText(text);
    expect(result.classText).toBe("MWF 9:00 AM-9:50 AM\nTTh 1:00 PM-2:15 PM");
    expect(result.linesFound).toBe(2);
  });

  it("produces lines the app's own parser understands, so typed and read text follow the same rules", () => {
    const { classText } = ocrTextToClassText("Tuesday/Thursday | 8:00 AM - 9:15 AM | SCB 211\nMWF 9:O0 AM — 9:50 AM");
    const parsed = parseClassText(classText);
    expect(parsed.errors).toEqual([]);
    expect(parsed.lines.map((l) => [l.days, l.start, l.end])).toEqual([
      [["tue", "thu"], 480, 555],
      [["mon", "wed", "fri"], 540, 590],
    ]);
  });

  it("finds days written after the time, or on the line above it", () => {
    expect(ocrTextToClassText("9:00 AM - 9:50 AM MWF").classText).toBe("MWF 9:00 AM-9:50 AM");
    expect(ocrTextToClassText("T Th\n1:00 PM - 2:15 PM").classText).toBe("T Th 1:00 PM-2:15 PM");
  });

  it("keeps several meeting patterns on one row apart", () => {
    expect(ocrTextToClassText("BIOL 112 MW 9:00-9:50 F 10:00-10:50").classText).toBe("MW 9:00-9:50\nF 10:00-10:50");
  });

  it("keeps a time whose days it couldn't find, whole, so the person sees which class it is and adds the days", () => {
    const { classText } = ocrTextToClassText("Lab Section 2 3:00 PM - 4:50 PM");
    expect(classText).toBe("Lab Section 2 3:00 PM - 4:50 PM");
    expect(parseClassText(classText).errors).toHaveLength(1); // shown with a red ✕ in the review list
  });

  it("never drops or shortens a half-read time: it keeps the line from its days for the person to fix", () => {
    // A blurry "9" read as "%". The tail "00AM" must not be taken for a whole time.
    const { classText } = ocrTextToClassText("HIST 201 TTh %:00AM - 10:15AM Room 214");
    expect(classText).toBe("TTh %:00 AM - 10:15 AM Room 214");
    expect(parseClassText(classText).errors).toHaveLength(1);
    // Once the person fixes the one wrong character, the line reads normally.
    expect(parseClassText(classText.replace("%", "9")).errors).toEqual([]);
  });

  it("does not mistake course numbers or dates for times, and drops duplicates", () => {
    expect(ocrTextToClassText("ENGL 101-102 Sequence\nFall 2026 8/24-12/11").linesFound).toBe(0);
    expect(ocrTextToClassText("MWF 9:00-9:50\nMWF 9:00-9:50").linesFound).toBe(1);
  });

  it("copes with empty or junk text without crashing", () => {
    expect(ocrTextToClassText("")).toEqual({ classText: "", linesFound: 0 });
    expect(ocrTextToClassText("@@@ ### \u0000 ~~~").linesFound).toBe(0);
  });
});

describe("cleaning up a screenshot's pixels before reading", () => {
  it("enlarges small screenshots, but never more than 3x and never past the memory limit", () => {
    expect(upscaleFactor(1000, 600)).toBe(2);
    expect(upscaleFactor(400, 300)).toBe(OCR_MAX_UPSCALE);
    expect(upscaleFactor(2500, 1400)).toBe(1); // already big enough: left alone, never shrunk
    const huge = upscaleFactor(1500, 6000);
    expect(1500 * huge * 6000 * huge).toBeLessThanOrEqual(OCR_MAX_PIXELS + 1);
  });

  it("turns colors into gray by how bright they look, with see-through counting as white", () => {
    const gray = toGrayscale(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0]));
    expect(gray[0]).toBe(76); // red looks fairly dark
    expect(gray[1]).toBe(150); // green looks much brighter
    expect(gray[2]).toBe(255); // a see-through pixel shows the white page behind it
  });

  /** A picture made of the given gray levels, as red-green-blue-alpha pixels. */
  const pixelsOf = (levels: number[]) => new Uint8ClampedArray(levels.flatMap((v) => [v, v, v, 255]));

  it("stretches pale text to full contrast: the darkest becomes black and the lightest white", () => {
    const levels = [...Array(90).fill(200), ...Array(10).fill(150)]; // light gray page, mid-gray text
    const pixels = pixelsOf(levels);
    enhancePixels(pixels);
    expect(pixels[0]).toBe(255); // page -> white
    expect(pixels[90 * 4]).toBe(0); // text -> black
  });

  it("flips a dark-mode screenshot so the text is dark on a light background", () => {
    const levels = [...Array(90).fill(30), ...Array(10).fill(220)]; // dark page, light text
    const pixels = pixelsOf(levels);
    enhancePixels(pixels);
    expect(pixels[0]).toBe(255); // dark page -> white
    expect(pixels[90 * 4]).toBe(0); // light text -> black
  });

  it("doesn't break on a picture of one flat color", () => {
    const pixels = pixelsOf(Array(10).fill(128));
    expect(() => enhancePixels(pixels)).not.toThrow();
  });
});

describe("choosing a screenshot", () => {
  it("accepts PNG, JPG and WebP up to 10 MB and explains anything else", () => {
    expect(checkScreenshotFile({ type: "image/png", size: 1000 })).toBeNull();
    expect(checkScreenshotFile({ type: "image/gif", size: 1000 })).toMatch(/PNG, JPG or WebP/);
    expect(checkScreenshotFile({ type: "image/png", size: 0 })).toMatch(/empty/);
    expect(checkScreenshotFile({ type: "image/png", size: 10 * 1024 * 1024 + 1 })).toMatch(/10 MB/);
  });
});

describe("enhanced reading: talking to the Cadence server", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    forgetEnhancedReadingAvailability();
    signOutManager();
  });

  it("shows the button only when the server says enhanced reading is on, and asks only once", async () => {
    const fetchMock = vi.fn(async () => Response.json({ enabled: true }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await isEnhancedReadingAvailable()).toBe(true);
    expect(await isEnhancedReadingAvailable()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("hides the button when there is no server (GitHub Pages answers 404) or it can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not found", { status: 404 })));
    expect(await isEnhancedReadingAvailable()).toBe(false);
    forgetEnhancedReadingAvailability();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    expect(await isEnhancedReadingAvailable()).toBe(false);
  });

  it("never sends a picture before a manager has signed in", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const reply = await readWithEnhancedReader(new Blob(["x"], { type: "image/png" }));
    expect(reply).toEqual({ error: expect.stringMatching(/Sign in/) });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
