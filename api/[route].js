/**
 * VERCEL FUNCTION: the gateway's addresses.
 *
 * Vercel turns every file in this `api/` folder into a small server. The square brackets in the file
 * name mean "any single word", so this one file answers /api/session, /api/publish, /api/remove,
 * /api/interpret and /api/ocr (anything else gets "404 not found" from the gateway).
 *
 * All the real work is in `src/server/gateway.ts`. `npm run build` packs that code into
 * `server-dist/vercel.js`; see `src/server/vercel.ts` for why this file is plain JavaScript that
 * imports the packed copy instead of the TypeScript source.
 */
import { gateway } from "../server-dist/vercel.js";

// Vercel calls the function named after the request's method (GET, POST or OPTIONS).
export const GET = gateway;
export const POST = gateway;
export const OPTIONS = gateway;
