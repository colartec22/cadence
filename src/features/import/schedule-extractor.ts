import { parseClassText } from "../scheduling/parser";
import type { ParseResult } from "../scheduling/types";
import { createId } from "../../lib/id";
import { currentPasscode, problemFromStatus, serverBaseUrl, signOutManager } from "../../services/automation/managerSession";
import { validateExtractedSchedule } from "./schemas";
import type { ExtractedSchedule } from "./schemas";

/**
 * ============================================================================
 *  TURNING PASTED TEXT OR A SCREENSHOT INTO CLASS TIMES
 * ============================================================================
 * Text is always read right here in the browser (`parser.ts`). A screenshot is sent to the ShiftFit
 * server only when one is configured AND a manager has signed in; the server passes it to the
 * reading service (n8n + an AI provider). Whatever comes back is checked by `schemas.ts` and shown
 * for review before anything is saved.
 */

export type ExtractionSource = "local-text" | "remote-ai";

export type ExtractionOutcome = {
  source: ExtractionSource;
  parse: ParseResult;
  ai?: ExtractedSchedule;
  error?: string;
};

/** Largest screenshot sent to the server: 4 MB, because Vercel's free plan refuses any request over 4.5 MB. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const TIMEOUT_MS = 60_000;

/** A plain-language problem with a chosen screenshot (wrong type or over 4 MB), or null if it's fine. */
export function checkImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return "Please use a PNG, JPG or WebP screenshot.";
  if (file.size > MAX_IMAGE_BYTES) return "That image is bigger than 4 MB. Try a smaller screenshot.";
  return null;
}

/** True only when a screenshot-reading server address has been configured (VITE_AUTOMATION_API_URL). */
export function isRemoteExtractionAvailable(): boolean {
  return serverBaseUrl() !== null;
}

/**
 * Turns pasted text (and optionally a screenshot) into candidate schedule data.
 *
 * Text is ALWAYS parsed locally and deterministically first: no network, no AI, no
 * provider needed. A screenshot is only sent anywhere when the manager attaches one
 * AND a server-side endpoint is configured; this module never calls an AI API directly
 * and never holds a private key. Whatever comes back is validated against a strict
 * schema and shown for review — it is data, never instructions, and never auto-saved.
 */
export async function extractSchedule(input: { text: string; image?: File | null }): Promise<ExtractionOutcome> {
  const parse = parseClassText(input.text);
  if (!input.image) return { source: "local-text", parse };

  const imageProblem = checkImageFile(input.image);
  if (imageProblem) return { source: "local-text", parse, error: imageProblem };

  const endpoint = serverBaseUrl();
  if (endpoint === null) {
    return {
      source: "local-text",
      parse,
      error: "Reading screenshots isn't set up here yet. You can type or paste the class times instead — that always works.",
    };
  }
  // The server only reads screenshots for a signed-in manager (each read can cost money at the AI provider).
  const passcode = currentPasscode();
  if (!passcode) return { source: "local-text", parse, error: "Sign in with the manager passcode first, then read the screenshot." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const form = new FormData();
    form.append("requestId", createId("req"));
    form.append("image", input.image);
    form.append("text", input.text.slice(0, 4000));
    // Goes to the ShiftFit server (src/server/gateway.ts), which checks the passcode and passes it on to n8n.
    const res = await fetch(`${endpoint}/api/interpret`, {
      method: "POST",
      headers: { authorization: `Bearer ${passcode}` },
      body: form,
      credentials: "omit",
      signal: controller.signal,
    });
    if (res.status === 401) signOutManager();
    if (!res.ok) return { source: "remote-ai", parse, error: `${problemFromStatus(res.status)} You can type the times instead.` };
    const validated = validateExtractedSchedule(await res.json());
    if (!validated.ok) {
      return { source: "remote-ai", parse, error: "The reading service sent back something we couldn't trust, so we ignored it. Try typing the times instead." };
    }
    return { source: "remote-ai", parse, ai: validated.value };
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "AbortError";
    return {
      source: "remote-ai",
      parse,
      error: timedOut ? "The reading service took too long. Try again or type the times instead." : "Couldn't reach the reading service. Try typing the times instead.",
    };
  } finally {
    clearTimeout(timer);
  }
}
