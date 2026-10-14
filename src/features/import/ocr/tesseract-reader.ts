/**
 * ============================================================================
 *  READING A SCREENSHOT IN THE BROWSER (TESSERACT)
 * ============================================================================
 * Tesseract is a free text reader (OCR) that runs entirely inside the browser, so the picture never
 * leaves this computer and no key or account is needed.
 *
 * It is big (about 7 MB with its English data), so it is only downloaded the first time someone reads
 * a screenshot: `import("tesseract.js")` below asks the build tool to keep it out of the app's main
 * file. Its files are served from this same website under /ocr/ (see `vite.config.ts`), never from an
 * outside CDN. The browser keeps a copy of the English data for next time; screenshots are never kept.
 */

/** What the reader is busy with, for the progress bar: a short label and how far along (0 to 1). */
export type ReadingProgress = { label: string; fraction: number };

/** The text Tesseract found, and how sure it was (0 = guessing, 100 = certain). */
export type TesseractReading = { text: string; confidence: number };

/**
 * Turns Tesseract's own status words into plain labels. Everything before the actual reading is
 * one-off setup, shown as "Getting the reader ready…".
 */
function progressLabel(status: string): string {
  return status === "recognizing text" ? "Reading the screenshot…" : "Getting the reader ready (only slow the first time)…";
}

/**
 * The full web address of one of the reader's files under /ocr/. Full addresses are needed because
 * the background worker resolves short ones against its own location, not the page's.
 */
function ocrFileUrl(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}ocr/${path}`, window.location.href).href;
}

/**
 * Reads the text in a prepared picture (see `preprocess.ts`). Calls `onProgress` as it goes. Starts a
 * fresh background worker and always shuts it down afterwards, so no memory is held between reads.
 */
export async function readWithTesseract(picture: HTMLCanvasElement, onProgress: (progress: ReadingProgress) => void): Promise<TesseractReading> {
  try {
    return await runTesseract(picture, onProgress);
  } catch {
    // Tesseract's own errors are technical (or not even Error objects), so the person gets a plain one.
    throw new Error("The screenshot reader couldn't run. It downloads about 7 MB the first time, so check the internet connection and try again, or type the times.");
  }
}

/** Does the actual reading for `readWithTesseract` (which turns any failure into a plain message). */
async function runTesseract(picture: HTMLCanvasElement, onProgress: (progress: ReadingProgress) => void): Promise<TesseractReading> {
  const { createWorker, OEM, PSM } = await import("tesseract.js");
  const worker = await createWorker("eng", OEM.LSTM_ONLY, {
    workerPath: ocrFileUrl("worker.min.js"),
    corePath: ocrFileUrl("core"),
    langPath: ocrFileUrl("lang"),
    // Load the worker from its own file on this site. (The default copies it into a "blob:" address,
    // which the site's security policy rightly blocks.)
    workerBlobURL: false,
    gzip: true,
    logger: (message) => onProgress({ label: progressLabel(message.status), fraction: message.progress }),
  });
  try {
    // "Automatic page layout" handles tables and lists, and keeping runs of spaces helps tell table
    // columns apart. Screenshots carry no print resolution, so we state one (300 dots per inch, typical
    // for enlarged screen text); otherwise Tesseract guesses and logs a warning each time.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: "1", user_defined_dpi: "300" });
    const { data } = await worker.recognize(picture);
    return { text: data.text, confidence: data.confidence };
  } finally {
    await worker.terminate();
  }
}
