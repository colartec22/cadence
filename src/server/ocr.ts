import { fail, json } from "./http";

/**
 * ============================================================================
 *  "ENHANCED READING": SENDING A SCREENSHOT TO OCR.SPACE
 * ============================================================================
 * Cadence first reads a class-schedule screenshot inside the browser (Tesseract, see
 * `src/features/import/ocr/`). When that reading is poor, the manager can click "Try enhanced
 * reading", and the gateway (`gateway.ts`, address `/api/ocr`) calls this file. It passes the picture
 * to OCR.space, a free online text-reading service, and hands back only the text it found.
 *
 * Why on the server? The OCR.space key (`OCR_SPACE_API_KEY`) is a secret. Anything in the browser can
 * be read by whoever uses it, so the key must only ever exist here.
 *
 * Privacy: the picture is held in memory for this one request and then forgotten. It is never written
 * to disk, never logged, and never stored. (OCR.space itself says it deletes images after reading them.)
 *
 * OCR.space's free plan allows pictures up to 1 MB and 500 reads a day for each internet address. The
 * browser shrinks screenshots below 1 MB before sending; this file still checks, and turns OCR.space's
 * "limit reached" and "couldn't read it" answers into plain words.
 */

/** OCR.space's reading address (their free plan). */
export const OCR_SPACE_URL = "https://api.ocr.space/parse/image";
/** Largest picture OCR.space's free plan accepts: 1 MB. */
export const MAX_OCR_IMAGE_BYTES = 1024 * 1024;
/** Largest upload we read: the 1 MB picture plus a little room for the form wrapping around it. */
export const MAX_OCR_UPLOAD_BYTES = MAX_OCR_IMAGE_BYTES + 16 * 1024;
/** Picture types OCR.space reads and the browser sends (it re-encodes screenshots as JPEG or PNG). */
export const OCR_IMAGE_TYPES = ["image/png", "image/jpeg"];
/** How long to wait for OCR.space. Kept under the 60-second limit Vercel's free plan sets for one request. */
const OCR_TIMEOUT_MS = 45_000;
/** Longest text we pass back. A class schedule is a few hundred characters; anything far longer is not one. */
const MAX_TEXT_LENGTH = 20_000;

export type OcrSpaceOptions = {
  /** The OCR.space key. Missing or empty = enhanced reading is switched off. */
  apiKey: string | undefined;
  /** Replaceable only so tests can stand in for OCR.space without a network. */
  fetchImpl?: typeof fetch;
};

/** True when an OCR.space key has been set, so "Try enhanced reading" can work. */
export function isOcrConfigured(apiKey: string | undefined): boolean {
  return typeof apiKey === "string" && apiKey.trim().length > 0;
}

/**
 * Reads the picture out of a signed-in upload, sends it to OCR.space, and answers `{ text }`.
 * The gateway has already checked the manager passcode before calling this.
 */
export async function readWithOcrSpace(request: Request, options: OcrSpaceOptions): Promise<Response> {
  if (!isOcrConfigured(options.apiKey)) return fail(503, "not_configured", "Enhanced reading hasn't been set up on this copy of Cadence.");

  const picture = await readPicture(request);
  if (!picture.ok) return picture.response;

  const form = new FormData();
  form.append("file", picture.file, picture.file.type === "image/png" ? "screenshot.png" : "screenshot.jpg");
  form.append("language", "eng");
  // Engine 2 is OCR.space's better engine for screenshots with unusual fonts and colored backgrounds.
  form.append("OCREngine", "2");
  // Keeps each table row on its own line, so a class's days and times stay together.
  form.append("isTable", "true");
  // Lets OCR.space enlarge small screenshots before reading them.
  form.append("scale", "true");

  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);
  try {
    const res = await fetchImpl(OCR_SPACE_URL, {
      method: "POST",
      headers: { apikey: (options.apiKey as string).trim() },
      body: form,
      signal: controller.signal,
    });
    // OCR.space answers 403 (and sometimes 429) once the free plan's daily limit is used up.
    if (res.status === 403 || res.status === 429) return limitReached();
    if (!res.ok) return fail(502, "ocr_error", "The enhanced reader had a problem. Try again in a minute, or type the times instead.");
    return answerFromReply(await res.json());
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "AbortError";
    return timedOut
      ? fail(504, "ocr_timeout", "The enhanced reader took too long. Try again, or type the times instead.")
      : fail(502, "ocr_unreachable", "Couldn't reach the enhanced reader. Try again in a minute, or type the times instead.");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Checks the upload and takes the picture out of it: it must be a form upload, under the size limit,
 * with one PNG or JPEG file named "image". Returns the file, or the error answer to send instead.
 */
async function readPicture(request: Request): Promise<{ ok: true; file: File } | { ok: false; response: Response }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    return { ok: false, response: fail(415, "unsupported", "Send the screenshot as a file upload.") };
  }
  // Refuse an oversized upload from its stated size, before reading any of it.
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_OCR_UPLOAD_BYTES) return { ok: false, response: tooLarge() };

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, response: fail(400, "bad_request", "The upload could not be read.") };
  }
  const file = form.get("image");
  if (!(file instanceof File)) return { ok: false, response: fail(400, "bad_request", "No screenshot was attached.") };
  if (!OCR_IMAGE_TYPES.includes(file.type)) return { ok: false, response: fail(415, "unsupported", "Send the screenshot as a PNG or JPG.") };
  if (file.size === 0) return { ok: false, response: fail(400, "bad_request", "The screenshot was empty.") };
  if (file.size > MAX_OCR_IMAGE_BYTES) return { ok: false, response: tooLarge() };
  return { ok: true, file };
}

/** The answer for a picture over OCR.space's 1 MB limit. */
function tooLarge(): Response {
  return fail(413, "too_large", "That screenshot is bigger than 1 MB, the enhanced reader's limit. Try a smaller screenshot.");
}

/** The answer once OCR.space's free daily limit (500 reads per address) is used up. */
function limitReached(): Response {
  return fail(429, "ocr_limit", "The enhanced reader has reached its free daily limit. Try again tomorrow, or type the times instead.");
}

/**
 * Turns OCR.space's reply into `{ text }`. OCR.space can answer "200 OK" and still report a failure
 * inside the reply (`IsErroredOnProcessing`), so that is checked here. Its own error wording is never
 * passed on, because it could repeat parts of the picture.
 */
export function answerFromReply(reply: unknown): Response {
  if (typeof reply !== "object" || reply === null) return badReply();
  const data = reply as Record<string, unknown>;

  if (data.IsErroredOnProcessing === true) {
    // OCR.space reports its daily limit as a processing error too; its message then mentions the limit.
    const message = JSON.stringify(data.ErrorMessage ?? "").toLowerCase();
    if (/maximum|limit|exceed/.test(message) && !/file size/.test(message)) return limitReached();
    if (/file size/.test(message)) return tooLarge();
    return fail(422, "ocr_failed", "The enhanced reader couldn't read this picture. Try a clearer screenshot, or type the times instead.");
  }

  const results = data.ParsedResults;
  if (!Array.isArray(results)) return badReply();
  const text = results
    .map((result) => (typeof result === "object" && result !== null ? (result as Record<string, unknown>).ParsedText : null))
    .filter((part): part is string => typeof part === "string")
    .join("\n")
    .slice(0, MAX_TEXT_LENGTH);
  return json(200, { text });
}

/** The answer when OCR.space replies with something that isn't the shape we expect. */
function badReply(): Response {
  return fail(502, "bad_reply", "The enhanced reader sent back something we couldn't use. Try again, or type the times instead.");
}
