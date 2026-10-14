import {
  CONTRAST_CLIP_PERCENT,
  MAX_ENHANCED_UPLOAD_BYTES,
  MIN_UPLOAD_WIDTH,
  OCR_MAX_PIXELS,
  OCR_MAX_UPSCALE,
  OCR_TARGET_WIDTH,
  UPLOAD_SHRINK_STEP,
} from "./constants";

/**
 * ============================================================================
 *  CLEANING UP A SCREENSHOT BEFORE IT IS READ
 * ============================================================================
 * Text readers (OCR) make far fewer mistakes on large, black-on-white text. Screenshots are often small,
 * colorful, or in dark mode. So before reading, the picture is:
 *   1. enlarged if it is small (`upscaleFactor`),
 *   2. turned into shades of gray (`toGrayscale`),
 *   3. flipped to dark text on a light background if it was in dark mode,
 *   4. stretched to full contrast, so pale gray text becomes black (`enhancePixels`).
 *
 * Everything happens on this computer, in a <canvas> (a drawing area the browser keeps in memory).
 * The picture is never saved and never sent anywhere by this file. `shrinkForUpload` is only used for
 * "Try enhanced reading", to get the picture under OCR.space's 1 MB limit before it is sent.
 *
 * The pixel maths (`toGrayscale`, `enhancePixels`) works on plain lists of numbers, so it can be
 * tested without a browser.
 */

/**
 * How much to enlarge a picture before reading it: enough to make it about OCR_TARGET_WIDTH pixels
 * wide, but at most OCR_MAX_UPSCALE times and never past OCR_MAX_PIXELS in total. 1 means "keep the size".
 * A picture already wider than the target is never shrunk here (shrinking would blur the letters).
 */
export function upscaleFactor(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 1;
  const wanted = Math.min(OCR_TARGET_WIDTH / width, OCR_MAX_UPSCALE);
  const memoryLimit = Math.sqrt(OCR_MAX_PIXELS / (width * height));
  return Math.max(1, Math.min(wanted, memoryLimit));
}

/**
 * Turns red-green-blue-alpha pixels into gray levels from 0 (black) to 255 (white), one per pixel.
 * Uses the standard "luma" weights (green counts most, blue least), which match how bright each color
 * looks to people. See-through pixels count as white, since screenshots show white behind them.
 */
export function toGrayscale(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(rgba.length / 4);
  for (let i = 0; i < gray.length; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const alpha = rgba[i * 4 + 3] / 255;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[i] = luma * alpha + 255 * (1 - alpha);
  }
  return gray;
}

/** The gray level below which `percent`% of the pixels fall (e.g. the darkest 1%), from a count of each level. */
function levelAtPercent(counts: number[], total: number, percent: number): number {
  const target = (total * percent) / 100;
  let seen = 0;
  for (let level = 0; level < 256; level++) {
    seen += counts[level];
    if (seen > target) return level;
  }
  return 255;
}

/**
 * Makes gray pixels easier to read, changing `rgba` in place:
 *  - if most of the picture is dark (a dark-mode screenshot), it is flipped so the text is dark on light,
 *  - then the darkest pixels become black and the lightest white, with everything between stretched
 *    evenly (ignoring the outer CONTRAST_CLIP_PERCENT at each end, so a few specks don't spoil it).
 * Each pixel's red, green and blue are set to the same gray, and alpha to fully solid.
 */
export function enhancePixels(rgba: Uint8ClampedArray): void {
  const gray = toGrayscale(rgba);
  const counts = new Array<number>(256).fill(0);
  let sum = 0;
  for (const level of gray) {
    counts[level]++;
    sum += level;
  }
  // Dark mode: the background (most of the picture) is dark, so the average pixel is dark.
  const darkMode = gray.length > 0 && sum / gray.length < 128;
  if (darkMode) {
    for (let i = 0; i < gray.length; i++) gray[i] = 255 - gray[i];
    counts.reverse();
  }

  const low = levelAtPercent(counts, gray.length, CONTRAST_CLIP_PERCENT);
  const high = levelAtPercent(counts, gray.length, 100 - CONTRAST_CLIP_PERCENT);
  const range = Math.max(1, high - low); // a picture of one flat color would otherwise divide by zero

  for (let i = 0; i < gray.length; i++) {
    const stretched = ((gray[i] - low) * 255) / range;
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = stretched; // Uint8ClampedArray keeps it within 0-255
    rgba[i * 4 + 3] = 255;
  }
}

/** Opens a picture file so it can be drawn, with a plain-language error if it can't be opened. */
async function openPicture(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new Error("That file couldn't be opened as a picture. Try taking the screenshot again.");
  }
}

/**
 * Draws `picture` onto a new canvas `scale` times its size, then runs `enhancePixels` on it.
 * Returns the canvas, ready to be read.
 */
function drawEnhanced(picture: ImageBitmap, scale: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(picture.width * scale);
  canvas.height = Math.round(picture.height * scale);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser can't prepare pictures for reading. Try typing the times instead.");
  context.fillStyle = "#ffffff"; // see-through screenshots get a white background
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingQuality = "high"; // smooth enlargement, so letters don't turn blocky
  context.drawImage(picture, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  enhancePixels(pixels.data);
  context.putImageData(pixels, 0, 0);
  return canvas;
}

/**
 * Prepares a screenshot for reading: enlarged when `enlarge` is true (for the reader in this browser),
 * left at its own size otherwise (for OCR.space, which enlarges by itself), and always cleaned up.
 */
export async function prepareScreenshot(file: Blob, { enlarge }: { enlarge: boolean }): Promise<HTMLCanvasElement> {
  const picture = await openPicture(file);
  try {
    return drawEnhanced(picture, enlarge ? upscaleFactor(picture.width, picture.height) : 1);
  } finally {
    picture.close();
  }
}

/** Saves a canvas as a picture file of the given type and quality (0-1, JPEG only). */
function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** A copy of `canvas` shrunk to `factor` times its width and height. */
function shrunk(canvas: HTMLCanvasElement, factor: number): HTMLCanvasElement {
  const smaller = document.createElement("canvas");
  smaller.width = Math.round(canvas.width * factor);
  smaller.height = Math.round(canvas.height * factor);
  smaller.getContext("2d")?.drawImage(canvas, 0, 0, smaller.width, smaller.height);
  return smaller;
}

/**
 * Makes a picture file small enough for "Try enhanced reading" (under MAX_ENHANCED_UPLOAD_BYTES).
 * Tries, in order: a PNG (sharpest text), then JPEGs of falling quality, then the same at 80% of the
 * size, and so on, until one fits. Gives up with a plain message if even MIN_UPLOAD_WIDTH doesn't fit.
 */
export async function shrinkForUpload(canvas: HTMLCanvasElement): Promise<Blob> {
  let current = canvas;
  while (current.width >= MIN_UPLOAD_WIDTH || current === canvas) {
    const attempts: [string, number | undefined][] = [
      ["image/png", undefined],
      ["image/jpeg", 0.92],
      ["image/jpeg", 0.8],
      ["image/jpeg", 0.65],
    ];
    for (const [type, quality] of attempts) {
      const blob = await canvasToBlob(current, type, quality);
      if (blob && blob.size <= MAX_ENHANCED_UPLOAD_BYTES) return blob;
    }
    if (current.width * UPLOAD_SHRINK_STEP < MIN_UPLOAD_WIDTH) break;
    current = shrunk(current, UPLOAD_SHRINK_STEP);
  }
  throw new Error("This screenshot is too detailed to send for enhanced reading. Try a screenshot of just the class list.");
}
