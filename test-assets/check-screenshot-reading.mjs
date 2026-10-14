/**
 * ============================================================================
 *  END-TO-END CHECK: READING THE SAMPLE SCREENSHOTS IN A REAL BROWSER
 * ============================================================================
 * Run with `npm run test:browser`. It builds the site, then:
 *
 *  1. Serves the built site (`dist/`) the way Vercel would: with the security headers from
 *     `vercel.json`, and with `/api/...` answered by the real packed server code (`server-dist/`).
 *  2. Opens Cadence in Chromium, adds a student, and uses "Use a screenshot instead" on each sample
 *     in this folder. Tesseract really runs here, in the browser, from the site's own /ocr/ files.
 *  3. Checks the class times that land in the box against `expected.json`, and that the review list
 *     understood every line. A sample marked "hard" (a small, blurry screenshot) may be misread, but
 *     never silently: the bad line must be marked for fixing and "Try enhanced reading" offered.
 *  4. Tries "Try enhanced reading" on the hard sample. OCR.space is on the internet, so a stand-in
 *     answers instead (set up below); the check makes sure the picture sent is under 1 MB and asks for
 *     engine 2 in English.
 *  5. Fails if the page logged any error, e.g. the security policy blocking the reader.
 *
 * Needs Chrome or Chromium. Set CHROMIUM_PATH to its program file if Chrome isn't installed normally.
 * Uses made-up schedules only; never put a real student's screenshot in this folder (FERPA).
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

// fileURLToPath (not .pathname) so the folder is a valid path on Windows too ("C:\Users\...", not "/C:/Users/...").
const ASSETS = fileURLToPath(new URL(".", import.meta.url));
const DIST = join(ASSETS, "..", "dist");
const expected = JSON.parse(readFileSync(join(ASSETS, "expected.json"), "utf8"));
const PASSCODE = "local-test-passcode";

// ---- A stand-in for OCR.space: records what it was sent, answers with a typical reply ----
const ocrSpaceCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith("https://api.ocr.space/")) return realFetch(url, init);
  const file = init.body.get("file");
  ocrSpaceCalls.push({ apikey: init.headers.apikey, engine: init.body.get("OCREngine"), language: init.body.get("language"), size: file.size, type: file.type });
  const text = "Class schedule\r\nPSYC 111\tMWF\t11:00 AM - 11:50 AM\tRoom 120\r\nHIST 201\tTTh\t9:00 AM - 10:15 AM\tRoom 214\r\n";
  return Response.json({ ParsedResults: [{ ParsedText: text, FileParseExitCode: 1 }], OCRExitCode: 1, IsErroredOnProcessing: false });
};

// ---- The server code, set up like on Vercel ----
process.env.MANAGER_PASSCODE = PASSCODE;
process.env.OCR_SPACE_API_KEY = "stand-in-key";
const { gateway } = await import("../server-dist/vercel.js");

/** The headers `vercel.json` sends with every page. */
const vercel = JSON.parse(readFileSync(join(ASSETS, "..", "vercel.json"), "utf8"));
const pageHeaders = Object.fromEntries(vercel.headers.find((h) => h.source === "/(.*)").headers.map((h) => [h.key, h.value]));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff" };

/** Answers one request: /api/... goes to the gateway, anything else is a file from dist/. */
async function answer(request, response) {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const hasBody = !["GET", "HEAD"].includes(request.method);
    const webRequest = new Request(url, { method: request.method, headers: request.headers, body: hasBody ? Buffer.concat(chunks) : undefined });
    const reply = await gateway(webRequest);
    response.writeHead(reply.status, Object.fromEntries(reply.headers));
    response.end(Buffer.from(await reply.arrayBuffer()));
    return;
  }
  const path = normalize(join(DIST, url.pathname === "/" ? "index.html" : url.pathname));
  if (!path.startsWith(DIST) || !existsSync(path) || statSync(path).isDirectory()) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, { ...pageHeaders, "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
  response.end(readFileSync(path));
}

/** Compares lines loosely: OCR may write "9:00AM" or "9:00 AM", which the parser reads the same way. */
const loose = (line) => line.replace(/\s+/g, "").toUpperCase();

const server = createServer((req, res) => void answer(req, res));
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://localhost:${server.address().port}`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: "chrome" });
const problems = [];

/** Opens Cadence fresh (welcome screen skipped), collecting any page errors, and opens "Add a student". */
async function openStudentForm() {
  const page = await browser.newPage();
  await page.addInitScript(() => window.localStorage.setItem("shiftfit:welcomed", "1"));
  page.on("console", (message) => message.type() === "error" && problems.push(`console error: ${message.text()}`));
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  await page.goto(base);
  await page.getByRole("button", { name: "Add student", exact: true }).first().click();
  return { page, dialog: page.getByRole("dialog", { name: /add a student/i }) };
}

/** Waits for a reading to finish, then returns the class-times box and the review list's summary. */
async function resultOf(dialog) {
  await dialog.getByText(/Found \d+ class time|No class times were found|couldn't|Couldn't/).first().waitFor({ timeout: 180_000 });
  const text = await dialog.locator("#class-text").inputValue();
  const summary = (await dialog.getByText(/\(\d+ of \d+ lines/).first().textContent().catch(() => "")) ?? "";
  return { lines: text.split("\n").filter(Boolean), summary };
}

try {
  for (const [file, { lines: wanted, hard }] of Object.entries(expected)) {
    const started = Date.now();
    const { page, dialog } = await openStudentForm();
    const chooser = page.waitForEvent("filechooser");
    await dialog.getByRole("button", { name: /use a screenshot instead/i }).click();
    await (await chooser).setFiles(join(ASSETS, file));
    const { lines, summary } = await resultOf(dialog);
    const missing = wanted.filter((line) => !lines.map(loose).includes(loose(line)));
    const allUnderstood = /\((\d+) of \1 lines\)/.test(summary);
    const correct = missing.length === 0 && allUnderstood;
    // A misread hard sample is fine only if the person is clearly told: a line marked for fixing,
    // and the hint that comes with "Try enhanced reading".
    const flagged = !allUnderstood && (await dialog.getByText(/check them carefully/).count()) > 0;
    const ok = correct || (hard && flagged);
    const how = correct ? "read correctly" : flagged ? "misread, but marked for fixing" : "WRONG";
    console.log(`${ok ? "PASS" : "FAIL"}  Tesseract  ${file}: ${how}  (${((Date.now() - started) / 1000).toFixed(1)} s)\n      read: ${JSON.stringify(lines)}  review: ${summary.trim()}`);
    if (!ok) problems.push(`${file}: missing ${JSON.stringify(missing)}, review said "${summary.trim()}"`);
    await page.close();
  }

  // Enhanced reading: sign in, click the button, and check what reached the OCR.space stand-in.
  const { page, dialog } = await openStudentForm();
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: /use a screenshot instead/i }).click();
  await (await chooser).setFiles(join(ASSETS, "small-blurry.jpg"));
  await resultOf(dialog);
  await dialog.getByLabel(/manager passcode/i).fill(PASSCODE);
  await dialog.getByRole("button", { name: /sign in/i }).click();
  await dialog.getByRole("button", { name: /try enhanced reading/i }).click();
  await dialog.getByText(/Sending the screenshot/).waitFor({ state: "detached", timeout: 60_000 });
  const { lines, summary } = await resultOf(dialog);
  const call = ocrSpaceCalls.at(-1);
  const enhancedOk =
    call && call.size <= 1000 * 1024 && call.engine === "2" && call.language === "eng" && call.apikey === "stand-in-key" && lines.length === 2 && /\(2 of 2 lines\)/.test(summary);
  console.log(`${enhancedOk ? "PASS" : "FAIL"}  Enhanced (OCR.space stand-in)  sent ${call?.type} ${call ? Math.round(call.size / 1024) : "?"} KB, engine ${call?.engine}\n      read: ${JSON.stringify(lines)}  review: ${summary.trim()}`);
  if (!enhancedOk) problems.push(`enhanced reading: ${JSON.stringify(call)} ${JSON.stringify(lines)}`);
  await page.close();

  // The main page still works after all the changes: add a student and fill the schedule.
  const main = await openStudentForm();
  await main.dialog.getByLabel(/student's name/i).fill("Test Student");
  await main.dialog.locator("#class-text").fill("MWF 9:00-9:50");
  await main.dialog.getByRole("button", { name: "Add student", exact: true }).click();
  await main.page.getByRole("button", { name: /fill schedule for me/i }).click();
  await main.page.getByRole("dialog", { name: /add a student/i }).waitFor({ state: "detached" });
  console.log("PASS  Main page: added a student and filled the schedule");
  await main.page.close();
} catch (error) {
  problems.push(`check crashed: ${error.message}`);
} finally {
  await browser.close();
  server.close();
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("\nAll screenshot checks passed.");
