/**
 * ============================================================================
 *  TUNABLE NUMBERS FOR READING SCREENSHOTS
 * ============================================================================
 * Every number the screenshot reader depends on lives here, with the reason for it, instead of
 * being typed into the code. The reader itself is described in `screenshot-reader.ts`.
 */

/**
 * Largest screenshot a person may pick: 10 MB. The browser reads it on this computer, so this only
 * stops a huge photo from freezing the page. (A full-screen screenshot is usually well under 2 MB.)
 */
export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

/** Picture types the reader accepts: the usual screenshot formats. */
export const SCREENSHOT_TYPES = ["image/png", "image/jpeg", "image/webp"];

/**
 * Small screenshots are enlarged to about this many pixels wide before reading. Tesseract reads best
 * when letters are roughly 20-30 pixels tall; on an ordinary screenshot that is about twice the size.
 */
export const OCR_TARGET_WIDTH = 2000;

/** Never enlarge more than 3 times: beyond that, letters only get blurrier, not clearer. */
export const OCR_MAX_UPSCALE = 3;

/**
 * Never make a picture bigger than 16 million pixels (e.g. 4000 x 4000). The reader holds the whole
 * picture in memory, and a phone can run out of memory on anything much larger.
 */
export const OCR_MAX_PIXELS = 16_000_000;

/**
 * When boosting contrast, the darkest and lightest 1% of pixels are ignored, so one stray black or
 * white speck can't stop the rest of the picture from being stretched to full contrast.
 */
export const CONTRAST_CLIP_PERCENT = 1;

/**
 * Tesseract rates its own reading from 0 to 100. Clear screenshots score above 80; below 70 the text
 * usually has mistakes, so Cadence suggests "Try enhanced reading".
 */
export const LOW_CONFIDENCE = 70;

/**
 * OCR.space's free plan refuses pictures over 1 MB (1,048,576 bytes). We aim a little lower (1,000 KB),
 * so the form wrapping around the picture never pushes it over.
 */
export const MAX_ENHANCED_UPLOAD_BYTES = 1000 * 1024;

/**
 * When a screenshot is too big to send even as a JPEG, it is shrunk by this much (to 80% of its width
 * and height) and tried again, but never below MIN_UPLOAD_WIDTH pixels wide, where text gets unreadable.
 */
export const UPLOAD_SHRINK_STEP = 0.8;
export const MIN_UPLOAD_WIDTH = 800;

/** How long to wait for the enhanced reader before giving up (the server itself gives up after 45 s). */
export const ENHANCED_TIMEOUT_MS = 50_000;
