import { parseClassText } from "../../scheduling/parser";
import { LOW_CONFIDENCE, MAX_SCREENSHOT_BYTES, SCREENSHOT_TYPES } from "./constants";
import { readWithEnhancedReader } from "./enhanced-reader";
import { ocrTextToClassText } from "./ocr-text";
import { prepareScreenshot, shrinkForUpload } from "./preprocess";
import { readWithTesseract } from "./tesseract-reader";
import type { ReadingProgress } from "./tesseract-reader";

/**
 * ============================================================================
 *  READING CLASS TIMES FROM A SCREENSHOT (THE WHOLE JOURNEY)
 * ============================================================================
 * This is the one file the screen (`ImportPanel.tsx`) talks to. Two ways to read a screenshot:
 *
 *  1. `readScreenshot`: always tried first. Cleans up the picture (`preprocess.ts`) and reads it with
 *     Tesseract right here in the browser (`tesseract-reader.ts`). Free, no key, and the picture never
 *     leaves this computer.
 *  2. `readScreenshotEnhanced`: only when the manager clicks "Try enhanced reading". Shrinks the
 *     cleaned-up picture under 1 MB and sends it to the Cadence server, which asks OCR.space
 *     (`enhanced-reader.ts`). Suggested when Tesseract wasn't sure of its reading.
 *
 * Either way the text found goes through `ocr-text.ts`, which picks out the "days + times" of each
 * class in the format the normal class-time parser understands. The result is put into the
 * class-times box for the person to check and fix. Nothing is saved until they press Save.
 */

export type ScreenshotReading = {
  /** One class per line, for the class-times box ("" if none were found). */
  classText: string;
  /** How many class times were found. */
  linesFound: number;
  /** True when the reading is probably poor: Tesseract wasn't confident, or no class times turned up. */
  lowConfidence: boolean;
};

export type ReadOutcome = { ok: true; reading: ScreenshotReading } | { ok: false; error: string };

/** A plain-language problem with a chosen file (not a picture, or too big), or null if it can be read. */
export function checkScreenshotFile(file: { type: string; size: number }): string | null {
  if (!SCREENSHOT_TYPES.includes(file.type)) return "Please use a PNG, JPG or WebP screenshot.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_SCREENSHOT_BYTES) return "That picture is bigger than 10 MB. Try a screenshot of just the class list.";
  return null;
}

/**
 * True when a reading probably went wrong: nothing was found, or the normal class-time parser can't
 * understand one of the lines (shown with a red ✕). Either way, enhanced reading is worth suggesting.
 */
function needsFixing(classText: string): boolean {
  return !classText || parseClassText(classText).errors.length > 0;
}

/** Turns any thrown problem into a message a person can act on. */
function messageFrom(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Something went wrong while reading the screenshot. Try typing the times instead.";
}

/** Reads a screenshot in this browser with Tesseract (way 1 in the file comment). Never throws. */
export async function readScreenshot(file: File, onProgress: (progress: ReadingProgress) => void): Promise<ReadOutcome> {
  const problem = checkScreenshotFile(file);
  if (problem) return { ok: false, error: problem };
  try {
    onProgress({ label: "Preparing the picture…", fraction: 0 });
    const picture = await prepareScreenshot(file, { enlarge: true });
    const { text, confidence } = await readWithTesseract(picture, onProgress);
    const found = ocrTextToClassText(text);
    return { ok: true, reading: { ...found, lowConfidence: confidence < LOW_CONFIDENCE || needsFixing(found.classText) } };
  } catch (err) {
    return { ok: false, error: messageFrom(err) };
  }
}

/** Reads a screenshot with OCR.space through the Cadence server (way 2 in the file comment). Never throws. */
export async function readScreenshotEnhanced(file: File): Promise<ReadOutcome> {
  const problem = checkScreenshotFile(file);
  if (problem) return { ok: false, error: problem };
  try {
    const picture = await prepareScreenshot(file, { enlarge: false });
    const upload = await shrinkForUpload(picture);
    const reply = await readWithEnhancedReader(upload);
    if ("error" in reply) return { ok: false, error: reply.error };
    const found = ocrTextToClassText(reply.text);
    return { ok: true, reading: { ...found, lowConfidence: needsFixing(found.classText) } };
  } catch (err) {
    return { ok: false, error: messageFrom(err) };
  }
}
