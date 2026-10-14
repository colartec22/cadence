import { FailedAttemptLimiter } from "../../src/server/http";
import { gatewayOptionsFromEnv, handleGateway } from "../../src/server/gateway";

/**
 * ============================================================================
 *  NETLIFY WRAPPER FOR THE GATEWAY (src/server/gateway.ts)
 * ============================================================================
 * Netlify runs every file in `netlify/functions/` as a small server when the site is deployed.
 * This one only connects the web addresses below to `handleGateway`, which does all the work.
 *
 * It stays switched off (every request gets "503 not set up") until these three environment
 * variables are set in Netlify (Site configuration -> Environment variables). NEVER put them in the
 * code or in anything starting with VITE_:
 *   MANAGER_PASSCODE   the passcode managers type (12+ characters)
 *   AUTOMATION_URL     the n8n server's address, e.g. https://n8n.example.edu
 *   AUTOMATION_SECRET  the password n8n's webhooks require (16+ random characters)
 * For "Try enhanced reading" (/api/ocr), only MANAGER_PASSCODE and OCR_SPACE_API_KEY are needed.
 * And, when the app itself is hosted somewhere else (GitHub Pages):
 *   ALLOWED_ORIGINS    that site's address, e.g. https://p00rmans.github.io (comma-separated for several)
 */

/** Wrong-passcode counter. Made once, so it keeps counting for as long as Netlify keeps this server warm. */
const limiter = new FailedAttemptLimiter();

/** Called by Netlify for each request (POST, or a browser's OPTIONS "may I call you?") to one of the addresses in `config.path`. */
export default async function gateway(request: Request): Promise<Response> {
  return handleGateway(request, gatewayOptionsFromEnv(process.env, limiter));
}

/** The web addresses this function answers (Netlify reads this). */
export const config = {
  path: ["/api/session", "/api/publish", "/api/remove", "/api/interpret", "/api/health", "/api/ocr"],
};
