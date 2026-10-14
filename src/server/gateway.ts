import { isSemesterConfigured } from "../features/calendar/ics";
import { validateExtractedSchedule } from "../features/import/schemas";
import { evaluateSchedule } from "../features/scheduling/evaluate";
import { validatePersistedState } from "../features/scheduling/validation";
import { MAX_REMOVALS, buildPublishRequest, validatePublishResponse, validateRemoveResponse } from "../services/automation/contracts";
import { FailedAttemptLimiter, clientAddress, fail, isAuthorized, json, readBody, readBytes } from "./http";
import { isOcrConfigured, readWithOcrSpace } from "./ocr";

/**
 * ============================================================================
 *  THE GATEWAY: THE ONLY SERVER THE WEBSITE TALKS TO
 * ============================================================================
 * The website runs in the manager's browser, and anything in a browser can be read or changed by
 * whoever is using it. So the browser is never trusted with the n8n password or allowed to decide
 * what goes onto Google Calendar. Instead it asks this gateway, which:
 *
 *   browser --(manager passcode)--> gateway --(secret the browser never sees)--> n8n --> Google Calendar
 *
 *  1. checks the manager passcode (and slows down anyone guessing it),
 *  2. re-checks the WHOLE schedule with the app's own rule code (`src/features/scheduling`),
 *  3. rebuilds the calendar events itself, so a tampered browser can't send made-up events,
 *  4. refuses if the schedule changed after the manager approved it,
 *  5. only then calls n8n, and checks n8n's reply before passing it back.
 *
 * Addresses (all POST, all need `Authorization: Bearer <manager passcode>`):
 *  - `/api/session`   "is this passcode right?" (used by the sign-in box)
 *  - `/api/publish`   send an approved schedule to Google Calendar
 *  - `/api/remove`    delete old events the manager confirmed (moved or removed shifts)
 *  - `/api/interpret` read a class-schedule screenshot with n8n's AI reader
 *  - `/api/ocr`       read a class-schedule screenshot with OCR.space ("Try enhanced reading", see `ocr.ts`).
 *                     A plain GET (no passcode) only answers whether enhanced reading is switched on.
 *  - `/api/health`    (GET, no passcode) "is the server up and set up?" for whoever hosts it. It answers
 *                     only yes/no flags, never a setting or any student data.
 *
 * It is one plain function, `handleGateway(Request) -> Response`, so it runs on Vercel Functions
 * (see `api/gateway.ts`), Netlify Functions (`netlify/functions/gateway.ts`) or any similar host.
 * Each address answers 503 ("fail closed") until the settings it needs are set, so deploying it
 * early can't open anything up:
 *  - `/api/session` needs only the manager passcode,
 *  - `/api/ocr` needs the passcode and the OCR.space key,
 *  - the n8n addresses need the passcode and both n8n settings.
 */

export type GatewayOptions = {
  /** The passcode managers type to sign in. Under MIN_PASSCODE_LENGTH characters = gateway switched off. */
  managerPasscode: string | undefined;
  /** Base address of the n8n server, e.g. https://n8n.example.edu (https only, except localhost for testing). */
  automationUrl: string | undefined;
  /** The password n8n's webhooks require (sent as `Authorization: Bearer ...`). Never sent to the browser. */
  automationSecret: string | undefined;
  /** Counts wrong passcode guesses. The host keeps one for as long as the server stays running. */
  limiter: FailedAttemptLimiter;
  /**
   * Other websites allowed to call this gateway from a browser, e.g. ["https://p00rmans.github.io"] when
   * the app is on GitHub Pages and the gateway on Netlify. Empty = only this gateway's own site.
   */
  allowedOrigins?: string[];
  /** The OCR.space key for "Try enhanced reading" (`/api/ocr`). Missing = that address is switched off. */
  ocrApiKey?: string;
  /** Replaceable only so tests can stand in for n8n and OCR.space without a network. */
  fetchImpl?: typeof fetch;
};

/** Shortest manager passcode accepted: 12 characters is long enough that guessing (10 tries per 15 minutes) is hopeless. */
export const MIN_PASSCODE_LENGTH = 12;
/** Shortest n8n secret accepted, same rule as the scheduler service (`handler.ts`). */
export const MIN_AUTOMATION_SECRET_LENGTH = 16;
/** Largest schedule we accept: 2 MB is far more than 200 students' worth of shifts (photos are never sent). */
export const MAX_JSON_BYTES = 2 * 1024 * 1024;
/**
 * Largest screenshot upload: the 4 MB picture limit plus room for the typed text and form wrapping.
 * It must stay under 4.5 MB, the most Vercel's free plan lets any request carry.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 + 64 * 1024;
/** How long to wait for n8n (it may be creating many calendar events or reading a picture). */
const AUTOMATION_TIMEOUT_MS = 60_000;
/** Longest shift id accepted in a removal request (real ones are about 30 characters). */
const MAX_SHIFT_ID_LENGTH = 200;

const ROUTES = ["/api/session", "/api/publish", "/api/remove", "/api/interpret", "/api/ocr", "/api/health"] as const;
type Route = (typeof ROUTES)[number];

/** True when a long enough manager passcode is set. Every address needs this. */
function hasPasscode(options: GatewayOptions): boolean {
  return (options.managerPasscode ?? "").length >= MIN_PASSCODE_LENGTH;
}

/**
 * True when everything one address needs is set (see the file comment): the passcode always, plus the
 * OCR.space key for `/api/ocr`, plus a safe n8n address and a long enough n8n secret for the n8n addresses.
 */
function isConfigured(route: Route, options: GatewayOptions): boolean {
  if (!hasPasscode(options)) return false;
  if (route === "/api/session") return true;
  if (route === "/api/ocr") return isOcrConfigured(options.ocrApiKey);
  return (options.automationSecret ?? "").length >= MIN_AUTOMATION_SECRET_LENGTH && isSafeAutomationUrl(options.automationUrl);
}

/**
 * The n8n address must use https (so the secret is encrypted on the way), except a test server on
 * this same computer (localhost), which never leaves the machine.
 */
export function isSafeAutomationUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return true;
    return parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

/** Reads the settings from the host's environment variables (see `.env.example` for what each one is). */
export function gatewayOptionsFromEnv(env: Record<string, string | undefined>, limiter: FailedAttemptLimiter): GatewayOptions {
  return {
    managerPasscode: env.MANAGER_PASSCODE,
    automationUrl: env.AUTOMATION_URL,
    automationSecret: env.AUTOMATION_SECRET,
    ocrApiKey: env.OCR_SPACE_API_KEY,
    limiter,
    allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGINS),
  };
}

/**
 * Reads ALLOWED_ORIGINS ("https://a.github.io, https://b.example.edu") into a clean list. Only https
 * site addresses are kept (plus http://localhost for testing); a path, a "*" or anything else that isn't
 * a plain site address is ignored, so a typo can never open the gateway to every website.
 */
export function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => {
      try {
        const url = new URL(entry);
        const safeProtocol = url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost");
        // `url.origin` is just "scheme://host[:port]"; if the entry had anything more (a path), it isn't equal.
        return safeProtocol && url.origin === entry.replace(/\/$/, "").toLowerCase();
      } catch {
        return false;
      }
    })
    .map((entry) => entry.replace(/\/$/, "").toLowerCase());
}

/** How long (seconds) a browser may remember a "yes, you may call me" answer before asking again. */
const CORS_MAX_AGE_SECONDS = 600;

/**
 * The calling website's address if it may use this gateway from a browser, otherwise null. Browsers
 * send the page's site address in the `Origin` header; only sites on the allowed list get a yes.
 */
function allowedOrigin(request: Request, options: GatewayOptions): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  return (options.allowedOrigins ?? []).includes(origin.toLowerCase()) ? origin : null;
}

/**
 * Adds the "this website may read my answer" headers (CORS) to a response, for an allowed other site.
 * `Vary: Origin` tells caches the answer differs per calling site. A wildcard ("*") is never used.
 */
function withCors(response: Response, origin: string | null): Response {
  if (origin) {
    response.headers.set("access-control-allow-origin", origin);
    response.headers.set("vary", "Origin");
  }
  return response;
}

/**
 * Answers a browser's "may I call you?" question (an OPTIONS "preflight" request, sent automatically
 * before a cross-site request that carries a password header). Yes only for allowed sites.
 */
function answerPreflight(origin: string | null): Response {
  if (!origin) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-max-age": String(CORS_MAX_AGE_SECONDS),
      vary: "Origin",
    },
  });
}

/** Answers one request to the gateway. Every step is explained in the file comment above. */
export async function handleGateway(request: Request, options: GatewayOptions): Promise<Response> {
  const origin = allowedOrigin(request, options);
  return withCors(await answer(request, options, origin), origin);
}

/** The gateway's answer before CORS headers are added (see `handleGateway`). */
async function answer(request: Request, options: GatewayOptions, origin: string | null): Promise<Response> {
  try {
    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    const route = ROUTES.find((r) => path === r || path.endsWith(r));
    if (!route) return fail(404, "not_found", "There is nothing at that address.");
    if (request.method === "OPTIONS") return answerPreflight(origin);
    // The only questions anyone may ask without the passcode. Both reveal nothing but yes/no flags.
    // "Is enhanced reading switched on?" tells the app whether to show the "Try enhanced reading" button.
    if (route === "/api/ocr" && request.method === "GET") return json(200, { enabled: isConfigured(route, options) });
    // "Is the server up, and which parts are set up?" is for whoever hosts it.
    if (route === "/api/health" && request.method === "GET") {
      return json(200, {
        ok: true,
        ready: isConfigured("/api/session", options),
        n8n: isConfigured("/api/publish", options),
        ocr: isConfigured("/api/ocr", options),
      });
    }
    if (request.method !== "POST") return fail(405, "method_not_allowed", "Use POST.");
    if (!isConfigured(route, options)) return fail(503, "not_configured", "The server hasn't been set up yet.");

    // Too many wrong passcodes from this address: refuse before even looking at this one.
    const address = clientAddress(request);
    if (options.limiter.isBlocked(address)) {
      return fail(429, "too_many_attempts", "Too many wrong tries. Wait 15 minutes, then try again.");
    }
    if (!isAuthorized(request, options.managerPasscode as string)) {
      options.limiter.recordFailure(address);
      return fail(401, "unauthorized", "That passcode isn't right.");
    }

    return await runRoute(route, request, options);
  } catch {
    // Deliberately says nothing about what went wrong: the cause could contain student data.
    return fail(500, "internal_error", "Something went wrong on the server.");
  }
}

/** Sends a signed-in request to the job for its address. */
function runRoute(route: Route, request: Request, options: GatewayOptions): Promise<Response> | Response {
  if (route === "/api/session") return json(200, { ok: true });
  if (route === "/api/health") return fail(405, "method_not_allowed", "Use GET."); // POST to health is a mistake, not a sign-in
  if (route === "/api/publish") return publish(request, options);
  if (route === "/api/remove") return removeOldEvents(request, options);
  if (route === "/api/ocr") return readWithOcrSpace(request, { apiKey: options.ocrApiKey, fetchImpl: options.fetchImpl });
  return interpret(request, options);
}

/** Reads the request body as a JSON object, or returns the error answer to send instead. */
async function readJsonObject(request: Request): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; response: Response }> {
  const body = await readBody(request, MAX_JSON_BYTES);
  if (!body.ok) return body;
  try {
    const parsed: unknown = JSON.parse(body.text);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    /* falls through to the error below */
  }
  return { ok: false, response: fail(400, "bad_request", "The request was not a valid JSON object.") };
}

/**
 * POST /api/publish: re-checks the schedule and, only if it passes every check, asks n8n to put it
 * on Google Calendar. The browser's own list of events is never used; they are rebuilt here.
 */
async function publish(request: Request, options: GatewayOptions): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body.ok) return body.response;
  const input = body.value;

  // Same strict checker used for backup files: unknown fields dropped, every field checked.
  const checked = validatePersistedState({
    version: 1,
    students: input.students,
    assignments: input.assignments ?? [],
    settings: input.settings,
    semester: input.semester ?? null,
    selectedStudentId: null,
  });
  if (!checked.ok) return fail(422, "invalid_schedule", "The schedule could not be read.", { problems: checked.errors });
  const { students, assignments, settings, semester } = checked.value;

  if (!isSemesterConfigured(semester)) {
    return fail(422, "no_dates", "Save the semester dates and timezone first. A calendar event needs a real date.");
  }
  const evaluation = evaluateSchedule(students, assignments, settings);
  if (!evaluation.ok) {
    const count = evaluation.blockingIssues.length;
    return fail(422, "breaks_rules", `This schedule breaks ${count} ${count === 1 ? "rule" : "rules"}. Fix them in Schedule health, then send it again.`);
  }
  // The manager approved one exact version. If the schedule is different now, they must look again.
  if (typeof input.approvedVersion !== "string" || input.approvedVersion !== evaluation.scheduleVersion) {
    return fail(409, "changed_since_approval", "The schedule changed after you approved it. Check it, then approve and send again.");
  }

  const publishRequest = buildPublishRequest(students, assignments, settings, semester);
  if (!publishRequest.events.length) return fail(422, "nothing_to_send", "There are no shifts to send yet.");

  const reply = await callAutomation(options, "/webhook/shiftfit/publish", JSON.stringify(publishRequest), "application/json");
  if (!reply.ok) return reply.response;
  const validated = validatePublishResponse(reply.json, publishRequest);
  if (!validated.ok) return fail(502, "bad_reply", "The calendar service sent back something we couldn't trust, so we ignored it.");
  return json(200, validated.value);
}

/** True for a shift id we would ever have made: 1-200 characters with no hidden control characters. */
function isShiftId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_SHIFT_ID_LENGTH && !/[\u0000-\u001f\u007f]/.test(value);
}

/**
 * POST /api/remove: deletes old calendar events the manager has confirmed. n8n only deletes events
 * it created itself (it looks each shift id up in its own records), so a made-up id deletes nothing.
 */
async function removeOldEvents(request: Request, options: GatewayOptions): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body.ok) return body.response;
  const ids = body.value.shiftIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_REMOVALS || !ids.every(isShiftId)) {
    return fail(400, "bad_request", "The list of events to remove was not valid.");
  }
  const shiftIds = Array.from(new Set(ids));

  const reply = await callAutomation(options, "/webhook/shiftfit/remove", JSON.stringify({ shiftIds }), "application/json");
  if (!reply.ok) return reply.response;
  const validated = validateRemoveResponse(reply.json, shiftIds);
  if (!validated.ok) return fail(502, "bad_reply", "The calendar service sent back something we couldn't trust, so we ignored it.");
  return json(200, validated.value);
}

/** POST /api/interpret: passes a screenshot upload on to n8n's reader and checks what comes back. */
async function interpret(request: Request, options: GatewayOptions): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data")) return fail(415, "unsupported", "Send the screenshot as a file upload.");
  const upload = await readBytes(request, MAX_UPLOAD_BYTES);
  if (!upload.ok) return upload.response;

  const reply = await callAutomation(options, "/webhook/shiftfit/interpret", upload.bytes, contentType);
  if (!reply.ok) return reply.response;
  const validated = validateExtractedSchedule(reply.json);
  if (!validated.ok) return fail(502, "bad_reply", "The reading service sent back something we couldn't trust, so we ignored it.");
  return json(200, validated.value);
}

/**
 * Calls one n8n webhook with the secret password, waiting at most AUTOMATION_TIMEOUT_MS. Returns
 * n8n's JSON reply, or a ready-made error answer (which never repeats n8n's own error details).
 */
async function callAutomation(
  options: GatewayOptions,
  path: string,
  body: string | ArrayBuffer,
  contentType: string,
): Promise<{ ok: true; json: unknown } | { ok: false; response: Response }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.automationUrl as string).replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTOMATION_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": contentType, authorization: `Bearer ${options.automationSecret}` },
      body,
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, response: fail(502, "automation_error", "The calendar service had a problem. Nothing was confirmed, so try again.") };
    return { ok: true, json: await res.json() };
  } catch {
    return { ok: false, response: fail(504, "automation_unreachable", "Couldn't reach the calendar service. Try again in a minute.") };
  } finally {
    clearTimeout(timer);
  }
}
