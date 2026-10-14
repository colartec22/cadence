// @vitest-environment node
import { describe, expect, it } from "vitest";
import { handleGateway } from "../server/gateway";
import type { GatewayOptions } from "../server/gateway";
import { FailedAttemptLimiter } from "../server/http";
import { MAX_OCR_IMAGE_BYTES, OCR_SPACE_URL, answerFromReply } from "../server/ocr";

/**
 * Tests for "Try enhanced reading": the gateway's `/api/ocr` address and `src/server/ocr.ts`, which
 * pass a screenshot to OCR.space. They run in plain Node, like a real server. OCR.space is replaced by
 * a pretend `fetch` that records what it was sent, so no network and no real key are needed.
 */

const PASSCODE = "correct-horse-battery";
const OCR_KEY = "pretend-ocr-space-key";

type Sent = { url: string; init: RequestInit };

/** A stand-in for OCR.space: remembers every call and answers with `reply` (by default, one line of text). */
function fakeOcrSpace(reply?: () => Response): { fetchImpl: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  // Records the call, then answers like OCR.space would.
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    if (reply) return reply();
    return Response.json({ ParsedResults: [{ ParsedText: "MWF 9:00 AM - 9:50 AM\r\n", FileParseExitCode: 1 }], OCRExitCode: 1, IsErroredOnProcessing: false });
  }) as unknown as typeof fetch;
  return { fetchImpl, sent };
}

/** Gateway settings with only what enhanced reading needs (no n8n), plus any changes a test asks for. */
function options(overrides: Partial<GatewayOptions> = {}): GatewayOptions {
  return { managerPasscode: PASSCODE, automationUrl: undefined, automationSecret: undefined, ocrApiKey: OCR_KEY, limiter: new FailedAttemptLimiter(), ...overrides };
}

/** A pretend screenshot of `bytes` size and the given type. */
function picture(bytes = 1000, type = "image/jpeg"): File {
  return new File([new Uint8Array(bytes)], "shot.jpg", { type });
}

/** Sends one screenshot upload to `/api/ocr` (with the right passcode unless told otherwise). */
function upload(opts: GatewayOptions, file: File | null = picture(), auth: string | null = `Bearer ${PASSCODE}`) {
  const form = new FormData();
  if (file) form.append("image", file);
  const headers: Record<string, string> = { "x-forwarded-for": "203.0.113.7" };
  if (auth) headers.authorization = auth;
  return handleGateway(new Request("https://cadence.test/api/ocr", { method: "POST", headers, body: form }), opts);
}

describe("GET /api/ocr: is enhanced reading switched on?", () => {
  it("says yes only when both the passcode and the OCR.space key are set, without needing the passcode", async () => {
    const ask = (opts: GatewayOptions) => handleGateway(new Request("https://cadence.test/api/ocr", { method: "GET" }), opts).then((r) => r.json());
    expect(await ask(options())).toEqual({ enabled: true });
    expect(await ask(options({ ocrApiKey: undefined }))).toEqual({ enabled: false });
    expect(await ask(options({ ocrApiKey: "   " }))).toEqual({ enabled: false });
    expect(await ask(options({ managerPasscode: undefined }))).toEqual({ enabled: false });
  });
});

describe("POST /api/ocr: reading a screenshot with OCR.space", () => {
  it("sends the picture to OCR.space with engine 2, English and the key only the server knows, then returns the text", async () => {
    const ocr = fakeOcrSpace();
    const res = await upload(options({ fetchImpl: ocr.fetchImpl }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "MWF 9:00 AM - 9:50 AM\r\n" });

    expect(ocr.sent).toHaveLength(1);
    expect(ocr.sent[0].url).toBe(OCR_SPACE_URL);
    expect((ocr.sent[0].init.headers as Record<string, string>).apikey).toBe(OCR_KEY);
    const form = ocr.sent[0].init.body as FormData;
    expect(form.get("OCREngine")).toBe("2");
    expect(form.get("language")).toBe("eng");
    expect(form.get("file")).toBeInstanceOf(File);
  });

  it("never calls OCR.space without the passcode, or when no key is set", async () => {
    const ocr = fakeOcrSpace();
    expect((await upload(options({ fetchImpl: ocr.fetchImpl }), picture(), null)).status).toBe(401);
    expect((await upload(options({ fetchImpl: ocr.fetchImpl }), picture(), "Bearer wrong-passcode-here")).status).toBe(401);
    expect((await upload(options({ fetchImpl: ocr.fetchImpl, ocrApiKey: undefined }))).status).toBe(503);
    expect(ocr.sent).toHaveLength(0);
  });

  it("refuses pictures over OCR.space's 1 MB limit, odd file types and missing files before calling OCR.space", async () => {
    const ocr = fakeOcrSpace();
    const opts = options({ fetchImpl: ocr.fetchImpl });
    expect((await upload(opts, picture(MAX_OCR_IMAGE_BYTES + 1))).status).toBe(413);
    expect((await upload(opts, picture(1000, "image/gif"))).status).toBe(415);
    expect((await upload(opts, null)).status).toBe(400);
    expect((await upload(opts, picture(0))).status).toBe(400);
    expect(ocr.sent).toHaveLength(0);
  });

  it("explains a used-up daily limit, whether OCR.space says so with 403 or inside its reply", async () => {
    const byStatus = fakeOcrSpace(() => new Response("You may only perform this action upto maximum 500 number of times within 86400 seconds", { status: 403 }));
    const res = await upload(options({ fetchImpl: byStatus.fetchImpl }));
    expect(res.status).toBe(429);
    expect((await res.json()).message).toMatch(/daily limit/);

    const inReply = answerFromReply({ IsErroredOnProcessing: true, ErrorMessage: ["You may only perform this action upto maximum 500 number of times"] });
    expect(inReply.status).toBe(429);
  });

  it("turns IsErroredOnProcessing into a plain message, without repeating OCR.space's own words", async () => {
    const res = answerFromReply({ IsErroredOnProcessing: true, ErrorMessage: ["Unable to recognize the file type: secret details"] });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.message).toMatch(/couldn't read this picture/);
    expect(JSON.stringify(body)).not.toMatch(/secret details/);
    expect(answerFromReply({ IsErroredOnProcessing: true, ErrorMessage: "File failed validation. File size exceeds the maximum permissible file size limit of 1024 KB" }).status).toBe(413);
  });

  it("never trusts a strange reply, and copes with OCR.space being down or slow", async () => {
    expect(answerFromReply(null).status).toBe(502);
    expect(answerFromReply({ ParsedResults: "nope" }).status).toBe(502);
    expect((await answerFromReply({ ParsedResults: [{ ParsedText: 42 }, { ParsedText: "TTh 1:00pm-2:15pm" }] }).json()).text).toBe("TTh 1:00pm-2:15pm");

    const down = fakeOcrSpace(() => new Response("oops", { status: 500 }));
    expect((await upload(options({ fetchImpl: down.fetchImpl }))).status).toBe(502);
    const unreachable = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    expect((await upload(options({ fetchImpl: unreachable }))).status).toBe(502);
    const slow = (async () => {
      throw new DOMException("aborted", "AbortError");
    }) as unknown as typeof fetch;
    expect((await upload(options({ fetchImpl: slow }))).status).toBe(504);
  });
});
