/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
// The ".ts" ending is required here: Vite loads this settings file with Node's own module rules, which need it.
import { addCspToHtml } from "./src/lib/contentSecurityPolicy.ts";

/**
 * Settings for Vite, the tool that runs the dev server (`npm run dev`) and builds the website
 * (`npm run build`), and for Vitest, the test runner (`npm test`), which reads the `test` part.
 */

/**
 * Adds the security policy <meta> tag to the BUILT page only (`apply: "build"`), for hosts like
 * GitHub Pages that can't send it as a header. See `src/lib/contentSecurityPolicy.ts` for why.
 */
function contentSecurityPolicyTag(): Plugin {
  return {
    name: "shiftfit-content-security-policy",
    apply: "build",
    transformIndexHtml: (html) => addCspToHtml(html, process.env.VITE_AUTOMATION_API_URL),
  };
}

/**
 * The screenshot reader's files (Tesseract), copied from node_modules into the site under /ocr/.
 * Left alone, Tesseract downloads them from a public CDN, which would tell a third party every time
 * someone reads a screenshot; Cadence makes no third-party requests (`src/test/privacy.test.ts`).
 * Keys are the address inside the site, values the file in node_modules. The browser downloads
 * them only when someone actually reads a screenshot (about 7 MB the first time, then cached).
 */
const OCR_FILES: Record<string, string> = {
  // The background worker that runs the reader without freezing the page.
  "ocr/worker.min.js": "node_modules/tesseract.js/dist/worker.min.js",
  // The reading engine, in three builds. The worker picks the fastest one this browser supports
  // (newest "relaxed SIMD" chips, then "SIMD", then the plain build that works everywhere).
  "ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js": "node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js",
  "ocr/core/tesseract-core-simd-lstm.wasm.js": "node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
  "ocr/core/tesseract-core-lstm.wasm.js": "node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js",
  // What English text looks like (the "best_int" version: accurate and small, about 3 MB).
  "ocr/lang/eng.traineddata.gz": "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
};

/**
 * Puts the OCR_FILES into the built site (`npm run build`) and serves them from the dev server
 * (`npm run dev`), so the reader works the same way in both.
 */
function screenshotReaderFiles(): Plugin {
  return {
    name: "cadence-screenshot-reader-files",
    // Adds each file to the website being built.
    generateBundle() {
      for (const [fileName, source] of Object.entries(OCR_FILES)) {
        this.emitFile({ type: "asset", fileName, source: readFileSync(source) });
      }
    },
    // Lets the dev server answer requests for those same addresses.
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? "").split("?")[0].replace(server.config.base, "");
        const source = OCR_FILES[path];
        if (!source) return next();
        response.setHeader("content-type", path.endsWith(".js") ? "text/javascript" : "application/octet-stream");
        response.end(readFileSync(source));
      });
    },
  };
}

export default defineConfig(({ isSsrBuild }) => ({
  // The address folder the site lives in. On GitHub Pages a project site lives at
  // https://<owner>.github.io/<repository>/, so the deploy workflow sets BASE_PATH=/<repository>/.
  // Everywhere else (Vercel, Netlify, the dev server) it is the site root, "/".
  base: process.env.BASE_PATH || "/",
  // `npm run build:server` packs the server code for Vercel (an "SSR" build, see src/server/vercel.ts).
  // That package must not contain the website's files, so those steps are skipped for it.
  publicDir: isSsrBuild ? false : "public",
  plugins: isSsrBuild ? [] : [react(), contentSecurityPolicyTag(), screenshotReaderFiles()],
  server: {
    // Respects an assigned PORT (e.g. from .claude/launch.json's autoPort) so this dev server
    // never fights another one for a fixed port; falls back to Vite's usual 5173 otherwise.
    port: Number(process.env.PORT) || 5173,
  },
  test: {
    // jsdom is a pretend browser, so screen tests can run in the terminal without opening one.
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
}));
