import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTENT_SECURITY_POLICY, addCspToHtml } from "../lib/contentSecurityPolicy";

/**
 * Privacy and security guards. These tests read the project's own files (not the running app) and
 * fail if someone accidentally adds a tracker, a font or script loaded from another company, a
 * network call to an unexpected address, or removes the website's security headers. Student data
 * is personal (FERPA), so these mistakes must be caught before they ship.
 */

/** Every .ts, .tsx and .css file under `dir`, skipping the tests folder. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "test" ? [] : sourceFiles(path);
    return /\.(ts|tsx|css)$/.test(name) ? [path] : [];
  });
}

describe("privacy: the app makes no third-party requests on its own", () => {
  it("index.html loads nothing from another site", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).not.toMatch(/(src|href)\s*=\s*"https?:\/\//i);
  });

  it("fonts are bundled, not fetched from Google", () => {
    const main = readFileSync("src/main.tsx", "utf8");
    expect(main).toContain("@fontsource/");
    for (const file of sourceFiles("src")) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    }
  });

  it("the only network calls go to the optional, configured automation URL", () => {
    const calls = sourceFiles("src").flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/\bfetch\(([^)]*)/g)].map((m) => `${file}: ${m[1]}`),
    );
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call, call).toMatch(/endpoint|baseUrl/);
  });

  it("no analytics or tracking libraries are present", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join(" ");
    expect(deps).not.toMatch(/analytics|sentry|segment|mixpanel|hotjar|gtag|amplitude|posthog/i);
  });

  it("never stores screenshots: images are only ever held in memory", () => {
    for (const file of sourceFiles("src")) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/localStorage\.setItem\([^)]*(image|screenshot)/i);
    }
  });
});

describe("security: the website's protective headers stay switched on", () => {
  const toml = readFileSync("netlify.toml", "utf8");

  it("sends a Content Security Policy that only runs our own scripts and forbids framing", () => {
    const policy = /Content-Security-Policy\s*=\s*"([^"]+)"/.exec(toml)?.[1] ?? "";
    expect(policy).toContain("script-src 'self'");
    // No 'unsafe-inline' / 'unsafe-eval' for scripts. ('wasm-unsafe-eval' is allowed: it only lets the
    // screenshot reader start WebAssembly, and never allows eval() or injected scripts.)
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-/);
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
  });

  it("sends the other standard protective headers", () => {
    expect(toml).toMatch(/X-Frame-Options\s*=\s*"DENY"/);
    expect(toml).toMatch(/X-Content-Type-Options\s*=\s*"nosniff"/);
    expect(toml).toMatch(/Referrer-Policy\s*=/);
  });

  it("hosts that can't send headers (GitHub Pages) get the same policy inside the built page", () => {
    const built = addCspToHtml("<html><head><title>x</title></head></html>");
    expect(built.indexOf("Content-Security-Policy")).toBeLessThan(built.indexOf("<title>"));
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/script-src[^;]*'unsafe-/);
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    // Every rule in the meta version also appears, word for word, in the Netlify header version.
    const header = /Content-Security-Policy\s*=\s*"([^"]+)"/.exec(toml)?.[1] ?? "";
    for (const rule of CONTENT_SECURITY_POLICY.split("; ")) expect(header, rule).toContain(rule);
    const viteConfig = readFileSync("vite.config.ts", "utf8");
    expect(viteConfig).toMatch(/apply: "build"/);
    expect(viteConfig).toContain("addCspToHtml");
  });

  it("index.html has no inline script the policy would block (the app would show a blank page)", () => {
    const html = readFileSync("index.html", "utf8");
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    for (const [, attributes, body] of scripts) {
      expect(attributes).toMatch(/\bsrc=/);
      expect(body.trim()).toBe("");
    }
  });
});
