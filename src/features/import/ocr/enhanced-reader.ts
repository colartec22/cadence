import { currentPasscode, problemFromStatus, serverBaseUrl, signOutManager } from "../../../services/automation/managerSession";
import { ENHANCED_TIMEOUT_MS } from "./constants";

/**
 * ============================================================================
 *  "TRY ENHANCED READING": ASKING THE CADENCE SERVER TO USE OCR.SPACE
 * ============================================================================
 * When the reader in the browser (Tesseract) struggles, the manager can choose to send the screenshot
 * to the Cadence server's `/api/ocr` address (`src/server/ocr.ts`), which asks OCR.space, a free
 * online reader. The OCR.space key lives only on the server; this file never sees it.
 *
 * Because the picture leaves this computer, this only ever happens when the manager clicks the button,
 * only for a signed-in manager (which also stops strangers using up the free 500 reads a day), and only
 * when the server says enhanced reading is switched on. Nothing is stored on the server.
 */

/**
 * The address of the Cadence server for enhanced reading. Normally the same website the app is on
 * (Vercel serves both); VITE_AUTOMATION_API_URL is used instead when it points somewhere else.
 */
export function enhancedReaderBaseUrl(): string {
  return serverBaseUrl() ?? "";
}

/** Remembers the server's answer, so the app only asks once per page load. */
let availability: Promise<boolean> | null = null;

/**
 * Asks the server whether enhanced reading is switched on (a free question that needs no passcode).
 * Answers false on any problem, e.g. on GitHub Pages, which has no server, so the button stays hidden.
 */
export function isEnhancedReadingAvailable(): Promise<boolean> {
  if (!availability) {
    const endpoint = `${enhancedReaderBaseUrl()}/api/ocr`;
    availability = fetch(endpoint, { method: "GET", credentials: "omit" })
      .then(async (res) => res.ok && (await res.json())?.enabled === true)
      .catch(() => false);
  }
  return availability;
}

/** Forgets the remembered answer. Only for tests, which pretend to be different servers. */
export function forgetEnhancedReadingAvailability(): void {
  availability = null;
}

/**
 * Sends a prepared screenshot (already under 1 MB, see `shrinkForUpload`) for enhanced reading.
 * Returns the text found, or a plain-language problem to show instead.
 */
export async function readWithEnhancedReader(picture: Blob): Promise<{ text: string } | { error: string }> {
  const passcode = currentPasscode();
  if (!passcode) return { error: "Sign in with the manager passcode first, then try enhanced reading." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENHANCED_TIMEOUT_MS);
  try {
    const form = new FormData();
    form.append("image", picture, picture.type === "image/png" ? "screenshot.png" : "screenshot.jpg");
    const endpoint = `${enhancedReaderBaseUrl()}/api/ocr`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${passcode}` },
      body: form,
      credentials: "omit",
      signal: controller.signal,
    });
    if (res.status === 401) signOutManager();
    if (!res.ok) return { error: await problemFromReply(res) };
    const body: unknown = await res.json();
    const text = typeof body === "object" && body !== null ? (body as { text?: unknown }).text : undefined;
    if (typeof text !== "string") return { error: "The enhanced reader sent back something we couldn't use. Try typing the times instead." };
    return { text };
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "AbortError";
    return {
      error: timedOut ? "The enhanced reader took too long. Try again, or type the times instead." : "Couldn't reach the enhanced reader. Check your internet connection and try again.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The server's own plain-language message (it explains limits like "daily limit reached"), or a
 * general one based on the answer code when there is no usable message.
 */
async function problemFromReply(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    const message = typeof body === "object" && body !== null ? (body as { message?: unknown }).message : undefined;
    if (typeof message === "string" && message.length > 0 && message.length < 300) return message;
  } catch {
    /* not JSON: fall through to the general message */
  }
  return problemFromStatus(res.status);
}
