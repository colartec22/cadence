import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateExtractedSchedule } from "../features/import/schemas";
import { checkImageFile, extractSchedule } from "../features/import/schedule-extractor";
import {
  buildPublishRequest,
  scheduleForServer,
  summarizePublish,
  validatePublishResponse,
  validateRemoveResponse,
} from "../services/automation/contracts";
import type { PublishRequest, PublishResponse } from "../services/automation/contracts";
import { createMockAutomationClient } from "../services/automation/mockAutomationClient";
import type { SemesterConfig } from "../features/scheduling/types";
import { makeSettings, makeStudent, run } from "./testkit";

const students = [makeStudent({ id: "s1", name: "Noa K." })];
const shifts = [...run("s1", "mon", 8 * 60, 10 * 60), ...run("s1", "wed", 8 * 60, 9 * 60)];
const request: PublishRequest = buildPublishRequest(students, shifts, makeSettings(), null);

describe("publish request", () => {
  it("sends one event per contiguous shift with stable ids, and no recurrence when no semester is configured", () => {
    expect(request.events).toEqual([
      { studentId: "s1", studentName: "Noa K.", day: "mon", start: 480, end: 600, shiftId: "s1-mon-480" },
      { studentId: "s1", studentName: "Noa K.", day: "wed", start: 480, end: 540, shiftId: "s1-wed-480" },
    ]);
    expect(request.scheduleVersion).toMatch(/^v6-[0-9a-f]{8}$/);
  });

  it("computes real recurring dates once a semester is configured, reusing the same math as the .ics export", () => {
    // 2026-09-14 is a Monday, so the first Monday occurrence is the start date itself.
    const semester: SemesterConfig = { startDate: "2026-09-14", endDate: "2026-10-02", timeZone: "Pacific/Honolulu", skipDates: ["2026-09-21"] };
    const withDates = buildPublishRequest(students, shifts, makeSettings(), semester);
    const mon = withDates.events.find((e) => e.day === "mon")!;
    expect(mon.recurrence).toEqual({
      startIso: "2026-09-14T08:00:00",
      endIso: "2026-09-14T10:00:00",
      timeZone: "Pacific/Honolulu",
      rrule: "FREQ=WEEKLY;COUNT=3",
      exdates: ["2026-09-21T08:00:00"],
    });
    const wed = withDates.events.find((e) => e.day === "wed")!;
    expect(wed.recurrence?.exdates).toEqual([]); // 2026-09-21 is a Monday, so it doesn't affect the Wednesday shift.
  });

  it("omits recurrence for a day whose first occurrence falls after the semester ends", () => {
    // Ends the Tuesday after the Monday start: the Monday shift still has one occurrence, but
    // the first Wednesday on/after the start date (the 16th) is past the end date.
    const semester: SemesterConfig = { startDate: "2026-09-14", endDate: "2026-09-15", timeZone: "Pacific/Honolulu" };
    const withDates = buildPublishRequest(students, shifts, makeSettings(), semester);
    expect(withDates.events.find((e) => e.day === "mon")!.recurrence?.rrule).toBe("FREQ=WEEKLY;COUNT=1");
    expect(withDates.events.find((e) => e.day === "wed")!.recurrence).toBeUndefined();
  });
});

describe("publish response validation", () => {
  const good: PublishResponse = {
    scheduleVersion: request.scheduleVersion,
    results: [
      { shiftId: "s1-mon-480", status: "created", googleEventId: "abc" },
      { shiftId: "s1-wed-480", status: "updated" },
    ],
  };

  it("accepts a well-formed response", () => {
    expect(validatePublishResponse(good, request).ok).toBe(true);
  });

  it("rejects garbage and results for shifts we never sent", () => {
    for (const bad of [null, "ok", 5, {}, { scheduleVersion: "x", results: "no" }]) expect(validatePublishResponse(bad, request).ok).toBe(false);
    expect(validatePublishResponse({ ...good, results: [{ shiftId: "someone-else", status: "created" }] }, request).ok).toBe(false);
    expect(validatePublishResponse({ ...good, results: [{ shiftId: "s1-mon-480", status: "great success" }] }, request).ok).toBe(false);
  });
});

describe("sync state is honest", () => {
  it("is synced only when everything succeeded", () => {
    const res: PublishResponse = { scheduleVersion: "v", results: request.events.map((e) => ({ shiftId: e.shiftId, status: "created" as const })) };
    expect(summarizePublish(request, res)).toMatchObject({ state: "synced", created: 2, failed: 0, missing: 0 });
  });

  it("is partial when some fail or are never reported", () => {
    const some: PublishResponse = {
      scheduleVersion: "v",
      results: [{ shiftId: "s1-mon-480", status: "created" }, { shiftId: "s1-wed-480", status: "failed", error: "quota" }],
    };
    expect(summarizePublish(request, some).state).toBe("partially_synced");
    const silent: PublishResponse = { scheduleVersion: "v", results: [{ shiftId: "s1-mon-480", status: "created" }] };
    expect(summarizePublish(request, silent)).toMatchObject({ state: "partially_synced", missing: 1 });
  });

  it("is failed when nothing worked", () => {
    const none: PublishResponse = { scheduleVersion: "v", results: request.events.map((e) => ({ shiftId: e.shiftId, status: "failed" as const })) };
    expect(summarizePublish(request, none).state).toBe("sync_failed");
  });

  it("never calls a mock practice run 'synced'", async () => {
    const response = await createMockAutomationClient().publishSchedule(scheduleForServer(students, shifts, makeSettings(), null), request);
    const summary = summarizePublish(request, response);
    expect(summary.dryRun).toBe(true);
    expect(summary.state).toBe("not_synced");
  });
});

describe("screenshot reading is optional and safe", () => {
  const valid = {
    requestId: "r1",
    status: "needs_review",
    confidence: 0.9,
    meetings: [{ day: "tue", start: 480, end: 555, source: "class" }],
    constraints: { latestEnd: 960, lunchStart: 720, needsOpeningShift: true, preference: "morning", daysPerWeek: 3 },
    warnings: [],
    unresolved: [],
  };

  it("accepts a well-formed extraction", () => {
    expect(validateExtractedSchedule(valid).ok).toBe(true);
  });

  it("rejects impossible or hostile data", () => {
    for (const bad of [
      null,
      { ...valid, confidence: 5 },
      { ...valid, meetings: [{ day: "sun", start: 1, end: 2 }] },
      { ...valid, meetings: [{ day: "mon", start: 600, end: 500 }] },
      { ...valid, meetings: [{ day: "mon", start: -5, end: 500 }] },
      { ...valid, status: "definitely fine" },
    ]) {
      expect(validateExtractedSchedule(bad).ok).toBe(false);
    }
  });

  it("clamps out-of-range constraints instead of trusting them", () => {
    const r = validateExtractedSchedule({ ...valid, constraints: { latestEnd: 99999, daysPerWeek: 42, preference: "<b>x</b>" } });
    expect(r.ok && r.value.constraints).toMatchObject({ latestEnd: null, daysPerWeek: null, preference: "any" });
  });

  it("bounds free-text warnings", () => {
    const r = validateExtractedSchedule({ ...valid, warnings: Array.from({ length: 100 }, () => "x".repeat(1000)) });
    expect(r.ok && r.value.warnings).toHaveLength(20);
    expect(r.ok && r.value.warnings[0]).toHaveLength(300);
  });

  it("checks image type and size before anything is sent", () => {
    expect(checkImageFile(new File(["x"], "a.png", { type: "image/png" }))).toBeNull();
    expect(checkImageFile(new File(["x"], "a.exe", { type: "application/x-msdownload" }))).toMatch(/PNG, JPG or WebP/);
    const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    expect(checkImageFile(big)).toMatch(/4 MB/);
  });

  it("still parses pasted text locally, and never fakes an AI read without a provider", async () => {
    const text = await extractSchedule({ text: "MWF 9:00-9:50" });
    expect(text.source).toBe("local-text");
    expect(text.parse.busy).toHaveLength(3);
    const image = await extractSchedule({ text: "MWF 9:00-9:50", image: new File(["x"], "a.png", { type: "image/png" }) });
    expect(image.ai).toBeUndefined();
    expect(image.error).toBeTruthy();
    expect(image.parse.busy).toHaveLength(3);
  });
});

describe("n8n workflow templates", () => {
  const dir = "n8n";
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

  it("ships the three documented workflows", () => {
    expect(files.sort()).toEqual(["shiftfit-generate.json", "shiftfit-interpret.json", "shiftfit-publish.json"]);
  });

  it.each(files)("%s is valid JSON with connected nodes and no real secrets", (file) => {
    const text = readFileSync(`${dir}/${file}`, "utf8");
    const json = JSON.parse(text);
    expect(Array.isArray(json.nodes)).toBe(true);
    expect(json.nodes.length).toBeGreaterThan(1);
    const names = new Set<string>(json.nodes.map((n: { name: string }) => n.name));
    for (const [from, links] of Object.entries<{ main: { node: string }[][] }>(json.connections)) {
      expect(names.has(from), `${file}: connection from unknown node ${from}`).toBe(true);
      for (const branch of links.main) for (const l of branch) expect(names.has(l.node), `${file}: connection to unknown node ${l.node}`).toBe(true);
    }
    expect(text).not.toMatch(/sk-[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{20,}|ya29\.|-----BEGIN|api[_-]?key"\s*:\s*"[^"R]/i);
  });

  it("does not return fake successful data from the AI placeholder", () => {
    const text = readFileSync(`${dir}/shiftfit-interpret.json`, "utf8");
    expect(text).not.toMatch(/confidence: 0\.9/);
  });
});

/**
 * The tests below RUN the JavaScript inside the n8n templates instead of only reading it. Earlier
 * audits tested each step on its own, which is how a real bug slipped through: the publish
 * workflow's first step threw away the dates the app sent, so the calendar step never got any.
 * Feeding the app's real output through the real workflow code catches that kind of break.
 */
type N8nNode = { name: string; type: string; parameters: Record<string, unknown> };

/** Reads one node out of an n8n workflow file in the `n8n/` folder. */
function n8nNode(file: string, find: (node: N8nNode) => boolean): N8nNode {
  const workflow = JSON.parse(readFileSync(`n8n/${file}`, "utf8")) as { nodes: N8nNode[] };
  const node = workflow.nodes.find(find);
  if (!node) throw new Error(`Node not found in ${file}`);
  return node;
}

/** Runs the publish workflow's "Validate request shape" step on a request body, the way n8n would. */
function runPublishValidator(body: unknown): { json: Record<string, unknown> }[] {
  const code = n8nNode("shiftfit-publish.json", (n) => n.name === "Validate request shape").parameters.jsCode as string;
  const $input = { first: () => ({ json: { body } }) };
  return new Function("$input", code)($input);
}

describe("n8n publish workflow, run for real", () => {
  const semester: SemesterConfig = { startDate: "2026-09-14", endDate: "2026-10-02", timeZone: "Pacific/Honolulu", skipDates: ["2026-09-21"] };
  const realRequest = buildPublishRequest(students, shifts, makeSettings(), semester);

  it("passes the app's real dates (recurrence) through to the calendar step instead of dropping them", () => {
    const items = runPublishValidator(realRequest);
    expect(items).toHaveLength(realRequest.events.length);
    for (const [i, item] of items.entries()) {
      expect(item.json.recurrence).toEqual(realRequest.events[i].recurrence);
      expect(item.json.scheduleVersion).toBe(realRequest.scheduleVersion);
    }
  });

  it("skips events with no dates or tampered dates, rather than sending them dateless or with extra rules", () => {
    const [first] = realRequest.events;
    const tampered = [
      { ...first, recurrence: undefined },
      { ...first, recurrence: { ...first.recurrence!, timeZone: "Pacific/Honolulu\nRRULE:FREQ=DAILY" } },
      { ...first, recurrence: { ...first.recurrence!, rrule: "FREQ=DAILY;COUNT=9999" } },
      { ...first, recurrence: { ...first.recurrence!, exdates: ["tomorrow"] } },
    ];
    for (const event of tampered) {
      expect(() => runPublishValidator({ scheduleVersion: "v1", events: [event] })).toThrow(/No valid events/);
    }
  });

  it("drops hidden characters in names, made-up shift ids and repeated shifts", () => {
    const [first] = realRequest.events;
    const items = runPublishValidator({
      scheduleVersion: "v1",
      events: [first, first, { ...first, shiftId: "someone-elses-event" }, { ...first, studentName: "Noa\r\nX" }],
    });
    expect(items).toHaveLength(1);
  });

  it("refuses a request far bigger than any real schedule", () => {
    const [first] = realRequest.events;
    const flood = Array.from({ length: 5001 }, () => first);
    expect(() => runPublishValidator({ scheduleVersion: "v1", events: flood })).toThrow(/Too many/);
  });

  it("writes skipped days in the only date format the calendar standard accepts (20260921T080000)", () => {
    const calendarNode = n8nNode("shiftfit-publish.json", (n) => n.type === "n8n-nodes-base.googleCalendar");
    const expression = (calendarNode.parameters.additionalFields as { recurrence: string }).recurrence;
    // n8n expressions look like "={{ ... }}"; take out the JavaScript between the braces and run it.
    const javascript = /^=\{\{([\s\S]*)\}\}$/.exec(expression)![1];
    const monday = realRequest.events.find((e) => e.day === "mon")!;
    const lines = new Function("$json", `return (${javascript});`)({ recurrence: monday.recurrence });
    expect(lines).toEqual(["RRULE:FREQ=WEEKLY;COUNT=3", "EXDATE;TZID=Pacific/Honolulu:20260921T080000"]);
  });
});

/**
 * A stand-in for the parts of n8n a Code node can use: `$input` (the items coming in),
 * `$getWorkflowStaticData` (the workflow's saved records) and `$('Node name')` (items of an earlier step).
 */
function runCodeNode(nodeName: string, input: { json: Record<string, unknown>; pairedItem?: { item: number } }[], records: Record<string, unknown>, earlier: Record<string, { json: Record<string, unknown> }[]>) {
  const code = n8nNode("shiftfit-publish.json", (n) => n.name === nodeName).parameters.jsCode as string;
  const $input = { first: () => input[0], all: () => input };
  const $getWorkflowStaticData = () => records;
  const $ = (name: string) => ({ all: () => earlier[name] ?? [], itemMatching: (i: number) => earlier[name]?.[i] });
  return new Function("$input", "$getWorkflowStaticData", "$", code)($input, $getWorkflowStaticData, $) as { json: Record<string, unknown> }[];
}

describe("n8n: finding and removing old events, run for real", () => {
  const diff = "Diff vs. previously synced events";

  it("reports events from an earlier publish that are no longer in the schedule, and deletes nothing", () => {
    const records = { shiftfitSyncMap: { "s1-mon-480": "g-mon", "s1-tue-480": "g-tue-old" } };
    const current = [{ json: { shiftId: "s1-mon-480", scheduleVersion: "v1", existingEventId: "g-mon" } }];
    const [out] = runCodeNode("Persist sync state", [{ json: { id: "g-mon" }, pairedItem: { item: 0 } }], records, { [diff]: current });
    expect(out.json.staleShiftIds).toEqual(["s1-tue-480"]);
    expect(out.json.results).toEqual([{ shiftId: "s1-mon-480", status: "updated", googleEventId: "g-mon" }]);
    expect(records.shiftfitSyncMap["s1-tue-480"]).toBe("g-tue-old"); // still there: only the manager can remove it
  });

  it("reports a rejected event as failed instead of stopping the rest", () => {
    const records = { shiftfitSyncMap: {} as Record<string, string> };
    const current = [
      { json: { shiftId: "s1-mon-480", scheduleVersion: "v1", existingEventId: null } },
      { json: { shiftId: "s1-wed-480", scheduleVersion: "v1", existingEventId: null } },
    ];
    const [out] = runCodeNode(
      "Persist sync state",
      [{ json: { id: "g1" }, pairedItem: { item: 0 } }, { json: { error: { message: "quota" } }, pairedItem: { item: 1 } }],
      records,
      { [diff]: current },
    );
    expect(out.json.results).toEqual([
      { shiftId: "s1-mon-480", status: "created", googleEventId: "g1" },
      { shiftId: "s1-wed-480", status: "failed", error: "Google Calendar did not accept this event." },
    ]);
    expect(records.shiftfitSyncMap).toEqual({ "s1-mon-480": "g1" });
  });

  it("only removes events it made itself: unknown ids are reported, never deleted", () => {
    const records = { shiftfitSyncMap: { "s1-tue-480": "g-tue" } };
    const toDelete = runCodeNode("Validate removal request", [{ json: { body: { shiftIds: ["s1-tue-480", "made-up", "s1-tue-480"] } } }], records, {});
    expect(toDelete).toEqual([{ json: { shiftId: "s1-tue-480", googleEventId: "g-tue", notFound: ["made-up"] } }]);

    const nothing = runCodeNode("Validate removal request", [{ json: { body: { shiftIds: ["made-up"] } } }], records, {});
    expect(nothing).toEqual([{ json: { placeholder: true, notFound: ["made-up"] } }]); // still answers the request
    expect(() => runCodeNode("Validate removal request", [{ json: { body: { shiftIds: [] } } }], records, {})).toThrow();
  });

  it("forgets deleted events (an already-gone event counts as removed) and keeps ones that failed", () => {
    const records = { shiftfitSyncMap: { a: "g-a", b: "g-b", c: "g-c" } };
    const validated = [
      { json: { shiftId: "a", googleEventId: "g-a", notFound: ["zzz"] } },
      { json: { shiftId: "b", googleEventId: "g-b", notFound: ["zzz"] } },
      { json: { shiftId: "c", googleEventId: "g-c", notFound: ["zzz"] } },
    ];
    const deleteOutput = [
      { json: { success: true }, pairedItem: { item: 0 } },
      { json: { error: { message: "The resource you requested has been deleted (410)" } }, pairedItem: { item: 1 } },
      { json: { error: { message: "Rate limit exceeded" } }, pairedItem: { item: 2 } },
    ];
    const [out] = runCodeNode("Forget removed events", deleteOutput, records, { "Validate removal request": validated });
    expect(out.json.results).toEqual([
      { shiftId: "a", status: "removed" },
      { shiftId: "b", status: "removed" },
      { shiftId: "c", status: "failed", error: "Google Calendar did not delete this event." },
      { shiftId: "zzz", status: "not_found" },
    ]);
    expect(records.shiftfitSyncMap).toEqual({ c: "g-c" });
  });

  it("requires a password on every webhook, so only the ShiftFit gateway can call them", () => {
    for (const file of ["shiftfit-publish.json", "shiftfit-interpret.json", "shiftfit-generate.json"]) {
      const workflow = JSON.parse(readFileSync(`n8n/${file}`, "utf8")) as { nodes: N8nNode[] };
      const webhooks = workflow.nodes.filter((n) => n.type === "n8n-nodes-base.webhook");
      expect(webhooks.length, file).toBeGreaterThan(0);
      for (const hook of webhooks) expect(hook.parameters.authentication, `${file}: ${hook.name}`).toBe("headerAuth");
    }
  });
});

describe("what the browser sends to the server, and what it accepts back", () => {
  it("leaves out photos and pasted class text: the server doesn't need them", () => {
    const withPhoto = makeStudent({ id: "s1", name: "Noa K.", avatar: "data:image/jpeg;base64,AAAA", classText: "MWF 9-10", blockedText: "Dentist" });
    const [sent] = scheduleForServer([withPhoto], shifts, makeSettings(), null).students;
    expect(sent).not.toHaveProperty("avatar");
    expect(sent).not.toHaveProperty("classText");
    expect(sent).not.toHaveProperty("blockedText");
    expect(sent.busy).toEqual(withPhoto.busy);
  });

  it("keeps a clean list of old events, never one we just sent, and rejects a malformed list", () => {
    const base = { scheduleVersion: "v", results: [{ shiftId: "s1-mon-480", status: "created" }] };
    const ok = validatePublishResponse({ ...base, staleShiftIds: ["old-1", "s1-mon-480", "old-1"] }, request);
    expect(ok.ok && ok.value.staleShiftIds).toEqual(["old-1"]);
    for (const bad of ["old-1", [5], ["x".repeat(201)]]) expect(validatePublishResponse({ ...base, staleShiftIds: bad }, request).ok).toBe(false);
  });

  it("checks a removal reply is only about the events we asked to remove", () => {
    expect(validateRemoveResponse({ results: [{ shiftId: "a", status: "removed" }] }, ["a"]).ok).toBe(true);
    expect(validateRemoveResponse({ results: [{ shiftId: "b", status: "removed" }] }, ["a"]).ok).toBe(false);
    expect(validateRemoveResponse({ results: [{ shiftId: "a", status: "vanished" }] }, ["a"]).ok).toBe(false);
    expect(validateRemoveResponse("nope", ["a"]).ok).toBe(false);
  });

  it("a practice run never deletes anything", async () => {
    const { results } = await createMockAutomationClient().removeEvents(["a", "b"]);
    expect(results.every((r) => r.status === "dry_run")).toBe(true);
  });
});

describe("n8n photo-reading workflow, run for real", () => {
  /** A stand-in for n8n's async Code node: `this.helpers` hands back each item's real file bytes. */
  async function runImageCheck(items: unknown[], fileBytes: number[]): Promise<{ json: Record<string, unknown>; binary?: unknown }[]> {
    const code = n8nNode("shiftfit-interpret.json", (n) => n.name === "Validate input").parameters.jsCode as string;
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    const helpers = { getBinaryDataBuffer: async (index: number) => new Uint8Array(fileBytes[index]) };
    return new AsyncFunction("$input", "$execution", code).call({ helpers }, { all: () => items }, { id: "exec-1" });
  }

  it("measures the real file size, so a too-big image is refused even though n8n labels it '6.1 MB'", async () => {
    const photo = (label: string) => ({ json: { body: { requestId: "req-1" } }, binary: { image: { mimeType: "image/png", fileSize: label } } });
    const [big, small] = await runImageCheck([photo("6.1 MB"), photo("200 kB")], [6 * 1024 * 1024, 200 * 1024]);
    expect(big.json.badImage).toBe(true);
    expect(big.binary).toBeUndefined(); // a refused image can't reach the AI step
    expect(small.json.badImage).toBe(false);
    expect(small.binary).toBeDefined();
  });

  it("strips anything odd out of the request id", async () => {
    const [item] = await runImageCheck([{ json: { body: { requestId: "req<script>1" } } }], [0]);
    expect(item.json.requestId).toBe("reqscript1");
  });
});
