/**
 * VERCEL FUNCTION: the scheduler service (/api/scheduler/health, /evaluate and /generate).
 *
 * n8n calls these to check or make a schedule with the same rules as the app (Workflow B in
 * `docs/N8N_ARCHITECTURE.md`). "[action]" in the file name means "any single word" after
 * /api/scheduler/. The real work is in `src/server/handler.ts`, packed by `npm run build` into
 * `server-dist/vercel.js` (see `src/server/vercel.ts` for why).
 */
import { scheduler } from "../../server-dist/vercel.js";

// Vercel calls the function named after the request's method.
export const GET = scheduler;
export const POST = scheduler;
