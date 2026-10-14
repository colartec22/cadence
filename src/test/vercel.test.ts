// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { gateway, restoreAddress, scheduler } from "../server/vercel";

/**
 * Tests for the Vercel setup: `src/server/vercel.ts` (what the `api/` functions call) and `vercel.json`.
 * Vercel itself isn't needed; requests are made up here, the way Vercel would pass them on.
 */

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

describe("restoreAddress: putting back the address the browser asked for", () => {
  it("turns Vercel's rewritten address back into the original one", () => {
    const restored = restoreAddress(new Request("https://cadence.test/api/[route]?route=ocr"), "route", "/api");
    expect(new URL(restored.url).pathname).toBe("/api/ocr");
    expect(new URL(restored.url).search).toBe("");
  });

  it("leaves a normal address alone, and ignores a name that isn't plain lowercase letters", () => {
    const normal = new Request("https://cadence.test/api/session");
    expect(restoreAddress(normal, "route", "/api")).toBe(normal);
    const odd = new Request("https://cadence.test/api/[route]?route=../secret");
    expect(restoreAddress(odd, "route", "/api")).toBe(odd);
  });

  it("keeps the method, headers and upload of the original request", async () => {
    const original = new Request("https://cadence.test/api/[route]?route=session", {
      method: "POST",
      headers: { authorization: "Bearer abc" },
      body: "hello",
    });
    const restored = restoreAddress(original, "route", "/api");
    expect(restored.method).toBe("POST");
    expect(restored.headers.get("authorization")).toBe("Bearer abc");
    expect(await restored.text()).toBe("hello");
  });
});

describe("the functions Vercel calls", () => {
  it("gateway: reads its settings from the environment and stays switched off until they are set", async () => {
    process.env.MANAGER_PASSCODE = "";
    process.env.OCR_SPACE_API_KEY = "";
    const off = await gateway(new Request("https://cadence.test/api/[route]?route=ocr"));
    expect(await off.json()).toEqual({ enabled: false });

    process.env.MANAGER_PASSCODE = "correct-horse-battery";
    process.env.OCR_SPACE_API_KEY = "pretend-key";
    const on = await gateway(new Request("https://cadence.test/api/ocr"));
    expect(await on.json()).toEqual({ enabled: true });
  });

  it("scheduler: answers /api/scheduler/health through the rewritten address too", async () => {
    const res = await scheduler(new Request("https://cadence.test/api/scheduler/[action]?action=health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("vercel.json", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8"));
  const headersFor = (source: string) =>
    Object.fromEntries((config.headers.find((h: { source: string }) => h.source === source)?.headers ?? []).map((h: { key: string; value: string }) => [h.key, h.value]));

  it("builds the site with `npm run build` into dist", () => {
    expect(config.buildCommand).toBe("npm run build");
    expect(config.outputDirectory).toBe("dist");
  });

  it("sends the same protective headers as netlify.toml on every page", () => {
    const headers = headersFor("/(.*)");
    const toml = readFileSync("netlify.toml", "utf8");
    const netlifyPolicy = /Content-Security-Policy\s*=\s*"([^"]+)"/.exec(toml)?.[1];
    expect(headers["Content-Security-Policy"]).toBe(netlifyPolicy);
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
  });

  it("keeps every function within the free plan's 60-second limit", () => {
    for (const settings of Object.values(config.functions) as { maxDuration: number }[]) {
      expect(settings.maxDuration).toBeLessThanOrEqual(60);
    }
  });
});
