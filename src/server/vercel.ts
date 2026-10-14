import { gatewayOptionsFromEnv, handleGateway } from "./gateway";
import { handleRequest } from "./handler";
import { FailedAttemptLimiter } from "./http";

/**
 * ============================================================================
 *  THE SERVER CODE, PACKED FOR VERCEL
 * ============================================================================
 * Vercel runs each file in the top-level `api/` folder as a small server ("function"):
 *   - `api/[route].js`             answers /api/session, /api/publish, /api/remove, /api/interpret, /api/ocr
 *   - `api/scheduler/[action].js`  answers /api/scheduler/health, /evaluate, /generate
 * Those two files only point at the functions below, which hand each request to the gateway
 * (`gateway.ts`) or the scheduler service (`handler.ts`).
 *
 * Why the extra step? `npm run build` packs this file and everything it uses into ONE file,
 * `server-dist/vercel.js` (the `build:server` script). Vercel cannot run our TypeScript files
 * directly: this project is an ES module project, and Node then needs every import to end in
 * ".js", which ours don't. A packed file has no imports left, so it always loads.
 *
 * Settings come from Vercel's environment variables (Project → Settings → Environment Variables):
 * MANAGER_PASSCODE, OCR_SPACE_API_KEY, and for Google Calendar AUTOMATION_URL, AUTOMATION_SECRET,
 * SCHEDULER_SECRET (see `.env.example`). Each feature stays switched off until its settings are set.
 */

/**
 * Wrong-passcode counter, shared by every gateway address. Vercel keeps it only while this copy of the
 * function stays running, and may run several copies at once, so it slows down guessing but is not a
 * perfect lock (the 12-character passcode minimum is what really keeps guessers out).
 */
const limiter = new FailedAttemptLimiter();

/** A route or action name as it appears in an address: lowercase letters only (e.g. "ocr", "health"). */
const NAME = /^[a-z]+$/;

/**
 * Vercel may hand the function the address it rewrote to (e.g. `/api/[route]?route=ocr`) instead of the
 * one the browser asked for (`/api/ocr`). This puts the original address back, so the gateway and the
 * scheduler can read it as usual. A request that already has its normal address is returned unchanged.
 */
export function restoreAddress(request: Request, param: string, prefix: string): Request {
  const url = new URL(request.url);
  const name = url.searchParams.get(param);
  if (!name || !NAME.test(name)) return request;
  url.searchParams.delete(param);
  url.pathname = `${prefix}/${name}`;
  return new Request(url, request);
}

/** Answers one request to a gateway address (`api/[route].js`). */
export function gateway(request: Request): Promise<Response> {
  return handleGateway(restoreAddress(request, "route", "/api"), gatewayOptionsFromEnv(process.env, limiter));
}

/** Answers one request to the scheduler service (`api/scheduler/[action].js`). */
export function scheduler(request: Request): Promise<Response> {
  return handleRequest(restoreAddress(request, "action", "/api/scheduler"), { secret: process.env.SCHEDULER_SECRET });
}
