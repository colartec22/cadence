// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildPublishRequest } from "../services/automation/contracts";
import { MIN_PASSCODE_LENGTH, handleGateway, isSafeAutomationUrl, parseAllowedOrigins } from "../server/gateway";
import type { GatewayOptions } from "../server/gateway";
import { FAILED_ATTEMPT_WINDOW_MS, FailedAttemptLimiter, MAX_FAILED_ATTEMPTS } from "../server/http";
import { scheduleVersion } from "../features/scheduling/blocks";
import { makeSettings, makeStudent, run } from "./testkit";

/**
 * Tests for the gateway (`src/server/gateway.ts`), the only server the website talks to. They run in a
 * plain Node environment (no browser), like a real server. n8n is replaced by a pretend `fetch` that
 * records what it was sent, so the tests can check exactly what would have reached Google Calendar.
 */

const PASSCODE = "correct-horse-battery";
const SECRET = "n8n-secret-0123456789";
const N8N = "https://n8n.example.edu";

const semester = { startDate: "2026-08-24", endDate: "2026-12-11", timeZone: "Pacific/Honolulu", skipDates: [] };
const students = [makeStudent({ id: "s1", name: "Noa K." })];
const assignments = run("s1", "mon", 9 * 60, 11 * 60);
const settings = makeSettings();
const goodSchedule = { students, assignments, settings, semester, approvedVersion: scheduleVersion(assignments) };

type Sent = { url: string; init: RequestInit };

/**
 * A stand-in for n8n. It remembers every call and answers with `reply` (by default a correct
 * "created" answer for every event it was sent).
 */
function fakeN8n(reply?: (body: unknown) => Response): { fetchImpl: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  // Records the call, then answers like n8n would.
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    if (reply) return reply(body);
    const events = (body?.events ?? []) as { shiftId: string }[];
    return Response.json({ scheduleVersion: body?.scheduleVersion, results: events.map((e) => ({ shiftId: e.shiftId, status: "created", googleEventId: "g1" })) });
  }) as unknown as typeof fetch;
  return { fetchImpl, sent };
}

/** Gateway settings with everything configured, plus any changes a test asks for. */
function options(overrides: Partial<GatewayOptions> = {}): GatewayOptions {
  return { managerPasscode: PASSCODE, automationUrl: N8N, automationSecret: SECRET, limiter: new FailedAttemptLimiter(), ...overrides };
}

/** Sends one pretend request to the gateway (with the right passcode unless told otherwise). */
function call(path: string, opts: GatewayOptions, init: { body?: unknown; auth?: string | null; method?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": "203.0.113.7", ...init.headers };
  if (init.auth !== null) headers.authorization = init.auth ?? `Bearer ${PASSCODE}`;
  // Text and raw bytes (a pretend upload) are sent as they are; anything else is turned into JSON.
  const body: BodyInit | undefined =
    init.body === undefined
      ? undefined
      : typeof init.body === "string"
        ? init.body
        : init.body instanceof Uint8Array
          ? new Blob([init.body as Uint8Array<ArrayBuffer>])
          : JSON.stringify(init.body);
  return handleGateway(new Request(`https://cadence.test${path}`, { method: init.method ?? "POST", headers, body }), opts);
}

describe("switched off until it is fully set up", () => {
  it("answers 503 to the n8n addresses while any of the three settings is missing, too short or unsafe", async () => {
    const broken: Partial<GatewayOptions>[] = [
      { managerPasscode: undefined },
      { managerPasscode: "x".repeat(MIN_PASSCODE_LENGTH - 1) },
      { automationSecret: undefined },
      { automationSecret: "short" },
      { automationUrl: undefined },
      { automationUrl: "http://n8n.example.edu" }, // not encrypted: the secret would travel in plain text
      { automationUrl: "not a url" },
    ];
    for (const change of broken) {
      const res = await call("/api/publish", options(change), { body: goodSchedule });
      expect(res.status, JSON.stringify(change)).toBe(503);
    }
  });

  it("lets a manager sign in with only the passcode set (n8n isn't needed to check a passcode)", async () => {
    const passcodeOnly = options({ automationUrl: undefined, automationSecret: undefined });
    expect((await call("/api/session", passcodeOnly)).status).toBe(200);
    expect((await call("/api/session", options({ managerPasscode: undefined }))).status).toBe(503);
    expect((await call("/api/session", options({ managerPasscode: "x".repeat(MIN_PASSCODE_LENGTH - 1) }))).status).toBe(503);
  });

  it("allows plain http only for a test server on this same computer", () => {
    expect(isSafeAutomationUrl("https://n8n.example.edu")).toBe(true);
    expect(isSafeAutomationUrl("http://localhost:5678")).toBe(true);
    expect(isSafeAutomationUrl("http://127.0.0.1:5678")).toBe(true);
    expect(isSafeAutomationUrl("http://example.com")).toBe(false);
    expect(isSafeAutomationUrl("ftp://example.com")).toBe(false);
  });

  it("rejects unknown addresses and methods", async () => {
    expect((await call("/api/nothing", options())).status).toBe(404);
    expect((await call("/api/publish", options(), { method: "GET" })).status).toBe(405);
  });
});

describe("GET /api/health", () => {
  it("answers without a passcode, says only whether it is set up, and never leaks a setting", async () => {
    const ready = await call("/api/health", options(), { method: "GET", auth: null });
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ ok: true, ready: true, n8n: true, ocr: false });
    const notReady = await call("/api/health", options({ managerPasscode: undefined }), { method: "GET", auth: null });
    expect(await notReady.json()).toEqual({ ok: true, ready: false, n8n: false, ocr: false });
    const text = JSON.stringify(await (await call("/api/health", options(), { method: "GET", auth: null })).json());
    for (const secret of [PASSCODE, SECRET, N8N]) expect(text).not.toContain(secret);
  });

  it("is read-only: a POST to it is refused (a wrong passcode still gets 401 like anywhere else)", async () => {
    const opts = options();
    expect((await call("/api/health", opts, { auth: "Bearer wrong" })).status).toBe(401);
    expect((await call("/api/health", opts, { method: "POST" })).status).toBe(405);
  });
});

describe("every answer is locked down", () => {
  it("carries no-store, nosniff, a deny-everything content policy and no referrer, even on errors", async () => {
    for (const res of [await call("/api/session", options()), await call("/api/session", options(), { auth: "Bearer no" }), await call("/api/nothing", options())]) {
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    }
  });
});

describe("manager passcode", () => {
  it("accepts the right passcode and refuses a wrong or missing one", async () => {
    expect((await call("/api/session", options())).status).toBe(200);
    for (const auth of [null, "", "Bearer wrong-passcode-123", `Bearer ${PASSCODE}x`, PASSCODE]) {
      expect((await call("/api/session", options(), { auth })).status, String(auth)).toBe(401);
    }
  });

  it("locks an address out after too many wrong tries, even for the right passcode, then lets it back in", async () => {
    let now = 1_000_000;
    const opts = options({ limiter: new FailedAttemptLimiter(() => now) });
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) await call("/api/session", opts, { auth: "Bearer guess-number-" + i });
    expect((await call("/api/session", opts)).status).toBe(429);
    // A different address is not affected.
    expect((await call("/api/session", opts, { headers: { "x-forwarded-for": "198.51.100.1" } })).status).toBe(200);
    now += FAILED_ATTEMPT_WINDOW_MS + 1;
    expect((await call("/api/session", opts)).status).toBe(200);
  });

  it("never calls n8n for a caller without the passcode", async () => {
    const n8n = fakeN8n();
    await call("/api/publish", options({ fetchImpl: n8n.fetchImpl }), { body: goodSchedule, auth: "Bearer nope-nope-nope" });
    expect(n8n.sent).toHaveLength(0);
  });
});

describe("POST /api/publish", () => {
  it("rebuilds the events itself and sends them to n8n with the secret the browser never sees", async () => {
    const n8n = fakeN8n();
    const res = await call("/api/publish", options({ fetchImpl: n8n.fetchImpl }), { body: goodSchedule });
    expect(res.status).toBe(200);
    expect(n8n.sent).toHaveLength(1);
    expect(n8n.sent[0].url).toBe(`${N8N}/webhook/shiftfit/publish`);
    expect((n8n.sent[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`);
    const sentBody = JSON.parse(n8n.sent[0].init.body as string);
    expect(sentBody).toEqual(buildPublishRequest(students, assignments, settings, semester));
    const reply = await res.json();
    expect(reply.results[0]).toMatchObject({ shiftId: "s1-mon-540", status: "created" });
  });

  it("ignores any events the browser tries to slip in: only the checked schedule is used", async () => {
    const n8n = fakeN8n();
    const tampered = { ...goodSchedule, events: [{ shiftId: "evil", studentName: "Mallory", day: "sat" }] };
    await call("/api/publish", options({ fetchImpl: n8n.fetchImpl }), { body: tampered });
    const sentBody = JSON.parse(n8n.sent[0].init.body as string);
    expect(sentBody.events.map((e: { shiftId: string }) => e.shiftId)).toEqual(["s1-mon-540"]);
  });

  it("refuses a schedule that breaks a rule (a shift on top of a class)", async () => {
    const withClass = [makeStudent({ id: "s1", name: "Noa K.", busy: [{ day: "mon", start: 540, end: 600, source: "class" }] })];
    const n8n = fakeN8n();
    const res = await call("/api/publish", options({ fetchImpl: n8n.fetchImpl }), { body: { ...goodSchedule, students: withClass } });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("breaks_rules");
    expect(n8n.sent).toHaveLength(0);
  });

  it("refuses when the schedule changed after the manager approved it", async () => {
    const res = await call("/api/publish", options({ fetchImpl: fakeN8n().fetchImpl }), { body: { ...goodSchedule, approvedVersion: "v1-00000000" } });
    expect(res.status).toBe(409);
    expect((await res.json()).message).toMatch(/changed after you approved/);
  });

  it("refuses without semester dates, and refuses a schedule it can't read", async () => {
    expect((await call("/api/publish", options(), { body: { ...goodSchedule, semester: null } })).status).toBe(422);
    expect((await call("/api/publish", options(), { body: { ...goodSchedule, students: "nope" } })).status).toBe(422);
    expect((await call("/api/publish", options(), { body: "{not json" })).status).toBe(400);
  });

  it("never repeats a student's name in an error", async () => {
    const bad = { ...goodSchedule, students: [{ ...makeStudent({ name: "PRIVATE-NAME-4242" }), daysPerWeek: 99 }] };
    const text = await (await call("/api/publish", options(), { body: bad })).text();
    expect(text).not.toContain("PRIVATE-NAME-4242");
  });

  it("turns n8n trouble into a clear error, and never trusts a strange reply", async () => {
    const down = fakeN8n(() => new Response("boom", { status: 500 }));
    expect((await call("/api/publish", options({ fetchImpl: down.fetchImpl }), { body: goodSchedule })).status).toBe(502);
    const strange = fakeN8n(() => Response.json({ results: [{ shiftId: "someone-else", status: "created" }], scheduleVersion: "v" }));
    expect((await call("/api/publish", options({ fetchImpl: strange.fetchImpl }), { body: goodSchedule })).status).toBe(502);
    const unreachable = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect((await call("/api/publish", options({ fetchImpl: unreachable }), { body: goodSchedule })).status).toBe(504);
  });

  it("passes on n8n's list of old events, but never one that is in the schedule now", async () => {
    const n8n = fakeN8n((body) => {
      const events = (body as { events: { shiftId: string }[] }).events;
      return Response.json({
        scheduleVersion: "v",
        results: events.map((e) => ({ shiftId: e.shiftId, status: "updated" })),
        staleShiftIds: ["s1-tue-540", "s1-mon-540"],
      });
    });
    const reply = await (await call("/api/publish", options({ fetchImpl: n8n.fetchImpl }), { body: goodSchedule })).json();
    expect(reply.staleShiftIds).toEqual(["s1-tue-540"]);
  });
});

describe("being called from the app on another website (GitHub Pages)", () => {
  const PAGES = "https://p00rmans.github.io";
  // Gateway settings that allow the github.io site.
  const withPages = () => options({ allowedOrigins: [PAGES] });

  it("says yes to a browser's 'may I call you?' question only for an allowed site", async () => {
    const yes = await call("/api/publish", withPages(), { method: "OPTIONS", auth: null, headers: { origin: PAGES } });
    expect(yes.status).toBe(204);
    expect(yes.headers.get("access-control-allow-origin")).toBe(PAGES);
    expect(yes.headers.get("access-control-allow-headers")).toMatch(/authorization/);
    const no = await call("/api/publish", withPages(), { method: "OPTIONS", auth: null, headers: { origin: "https://evil.example" } });
    expect(no.status).toBe(403);
    expect(no.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("lets an allowed site read every answer, even errors, and never answers with a wildcard", async () => {
    const ok = await call("/api/session", withPages(), { headers: { origin: PAGES } });
    expect(ok.headers.get("access-control-allow-origin")).toBe(PAGES);
    const wrong = await call("/api/session", withPages(), { auth: "Bearer wrong-passcode-1", headers: { origin: PAGES } });
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("access-control-allow-origin")).toBe(PAGES);
    const stranger = await call("/api/session", withPages(), { headers: { origin: "https://evil.example" } });
    expect(stranger.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("reads ALLOWED_ORIGINS safely: plain https site addresses only, never '*' or a path", () => {
    expect(parseAllowedOrigins("https://P00rmanS.github.io/, https://cadence.example.edu")).toEqual(["https://p00rmans.github.io", "https://cadence.example.edu"]);
    expect(parseAllowedOrigins("*, http://example.com, https://x.github.io/cadence, nonsense, http://localhost:5173")).toEqual(["http://localhost:5173"]);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });
});

describe("POST /api/remove", () => {
  it("forwards a clean list of shift ids and checks the reply", async () => {
    const n8n = fakeN8n((body) => Response.json({ results: (body as { shiftIds: string[] }).shiftIds.map((shiftId) => ({ shiftId, status: "removed" })) }));
    const res = await call("/api/remove", options({ fetchImpl: n8n.fetchImpl }), { body: { shiftIds: ["s1-tue-540", "s1-tue-540"] } });
    expect(res.status).toBe(200);
    expect(n8n.sent[0].url).toBe(`${N8N}/webhook/shiftfit/remove`);
    expect(JSON.parse(n8n.sent[0].init.body as string)).toEqual({ shiftIds: ["s1-tue-540"] });
  });

  it("refuses empty, huge or odd lists before n8n is ever called", async () => {
    const n8n = fakeN8n();
    for (const shiftIds of [[], "s1", [5], ["a\nb"], ["x".repeat(201)], Array.from({ length: 5001 }, (_, i) => `id-${i}`)]) {
      expect((await call("/api/remove", options({ fetchImpl: n8n.fetchImpl }), { body: { shiftIds } })).status).toBe(400);
    }
    expect(n8n.sent).toHaveLength(0);
  });
});

describe("POST /api/interpret", () => {
  const reading = {
    requestId: "r1",
    status: "needs_review",
    confidence: 0.8,
    meetings: [{ day: "tue", start: 480, end: 555, source: "class" }],
    constraints: { latestEnd: null, lunchStart: null, needsOpeningShift: false, preference: "any", daysPerWeek: null },
    warnings: [],
    unresolved: [],
  };

  it("passes the upload on unchanged and returns only a checked reading", async () => {
    const n8n = fakeN8n(() => Response.json(reading));
    const upload = new Uint8Array([1, 2, 3, 4]);
    const res = await call("/api/interpret", options({ fetchImpl: n8n.fetchImpl }), {
      body: upload,
      headers: { "content-type": "multipart/form-data; boundary=x" },
    });
    expect(res.status).toBe(200);
    expect(n8n.sent[0].url).toBe(`${N8N}/webhook/shiftfit/interpret`);
    expect(new Uint8Array(n8n.sent[0].init.body as ArrayBuffer)).toEqual(upload);
    expect((await res.json()).meetings).toHaveLength(1);
  });

  it("refuses something that isn't an upload, and a reading it can't trust", async () => {
    expect((await call("/api/interpret", options(), { body: { hi: 1 } })).status).toBe(415);
    const n8n = fakeN8n(() => Response.json({ ...reading, confidence: 7 }));
    const res = await call("/api/interpret", options({ fetchImpl: n8n.fetchImpl }), {
      body: new Uint8Array([1]),
      headers: { "content-type": "multipart/form-data; boundary=x" },
    });
    expect(res.status).toBe(502);
  });
});
