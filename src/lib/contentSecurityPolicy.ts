/**
 * ============================================================================
 *  THE WEBSITE'S SECURITY POLICY, FOR HOSTS THAT CAN'T SEND HEADERS
 * ============================================================================
 * A "Content Security Policy" (CSP) tells the browser what this page may load and run. It stops an
 * injected <script> from running even if a bug ever let one into the page.
 *
 * Vercel and Netlify send the policy as a header (see `vercel.json` and `netlify.toml`). GitHub Pages can't send custom headers,
 * so for the github.io site the same policy is written into the page itself as a
 * `<meta http-equiv="Content-Security-Policy">` tag, added by `vite.config.ts` when building.
 *
 * Two rules from the Netlify version can't work inside a <meta> tag (browsers ignore them there), so
 * they are left out here: `frame-ancestors` (stop other sites showing ShiftFit in a frame) and the
 * separate `X-Frame-Options` header. That protection exists only on hosts that send headers.
 *
 * The tag is added to the BUILT site only. The dev server (`npm run dev`) runs small inline scripts
 * for instant reloading, which this policy would block.
 */

/**
 * The policy, one rule per entry (see `netlify.toml` for what each rule means). `connect-src` allows
 * any https address because the ShiftFit server (the gateway) lives on a different site than github.io.
 *
 * `'wasm-unsafe-eval'` lets the browser start WebAssembly, the fast machine code the screenshot reader
 * (Tesseract) is written in. Despite its name it does NOT allow `eval()` or injected scripts: it only
 * allows compiling WebAssembly, and our only WebAssembly file is Tesseract's, served from this site.
 * `worker-src 'self'` lets the reader run in a background "worker" so the page doesn't freeze, but
 * only from a script file on this site.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/**
 * The policy for the BUILT website, with `connect-src` narrowed to the one server the site really
 * talks to (the address in VITE_AUTOMATION_API_URL). With no server (the GitHub Pages practice-run
 * setup) the site may talk to nobody but itself, so even an injected script couldn't send data out.
 */
export function contentSecurityPolicyFor(serverUrl: string | undefined): string {
  let origin = "";
  try {
    if (serverUrl) origin = new URL(serverUrl).origin;
  } catch {
    /* not an absolute address ("/" or a typo): stay on 'self' only */
  }
  const connect = origin && origin !== "null" ? `connect-src 'self' ${origin}` : "connect-src 'self'";
  return CONTENT_SECURITY_POLICY.replace("connect-src 'self' https:", connect);
}

/** The <meta> tag to put at the very top of <head>, before any script, so it applies to everything. */
export function cspMetaTag(serverUrl?: string): string {
  return `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicyFor(serverUrl)}" />`;
}

/** Puts the security policy tag right after `<head>` in a built page. Returns the page unchanged if it has no <head>. */
export function addCspToHtml(html: string, serverUrl?: string): string {
  return html.replace(/<head>/i, (head) => `${head}
    ${cspMetaTag(serverUrl)}`);
}
