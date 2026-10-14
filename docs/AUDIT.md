# Audit

Eight audits are recorded here. Everything listed was confirmed by reading code, running it, or
writing a test that failed first. Nothing here is generic advice.

- **Part 1**: bugs in the original single-file prototype
  ([`archive/shift-coverage-planner-v1.html`](../archive/shift-coverage-planner-v1.html)).
- **Part 2**: bugs found in *the first rebuild itself*, plus corrections to claims the first
  version of this document made that turned out to be untrue.
- **Part 3**: a further pass after the plain-language redesign (below the verification table).
- **Part 4**: scale, quick fixes and bulk add (after Part 3).
- **Part 5**: a check of the whole app against the updated Cadence Track C project document
  (2026-09-22) — what's actually built vs. what the course deliverables (D1–D6) still need.
- **Part 6**: hardening the n8n publish/interpret workflow templates (2026-09-23) — a real bug
  in the publish contract (no calendar dates were ever sent) found and fixed along the way.
- **Part 7**: a check of the finished app against every acceptance criterion in the original build
  brief, plus every markdown file against the code (2026-09-24). Two real bugs fixed.
- **Part 8**: the server side (Workflow B: check and generate a schedule), two missing headline numbers, and a `lint` script that checked nothing (2026-09-26).

Run `npm test` to re-check all of it (410 tests in 22 suites as of 2026-09-24; earlier parts quote the
counts from when they were written).

---

## Part 1: the original prototype

| # | Bug | Fix |
| --- | --- | --- |
| 1 | Switching 7am/8am **office hours** changed real hour totals and let the weekly cap be bypassed, because hours were counted only over the visible slots. | Hours always count *every* shift, whatever is visible. View state and schedule data are separate. |
| 2 | **Gap ranges almost never merged.** Gaps were built time-major but merged assuming day-major, so consecutive same-day gaps were never adjacent in the array. | Coverage is built day-major, then merged. |
| 3 | A **required 7am shift** was satisfied by one 30-minute slot. | It must be a real contiguous block (at least 1 hour) starting at 7:00am. |
| 4 | **Auto-fill fragmented shifts** (lone half-hours scattered across the week). | Block-based planner, see Part 2 for measured results. |
| 5 | **One ambiguous coverage %.** | Two labeled numbers: hours with enough people, and staffing filled. |
| 6 | "**Minimum students needed**" ignored availability but looked like a real gap. | Renamed "students needed (best case)" with an inline explanation. |
| 7 | A `role="button"` **nested inside a `<button>`**. | Sibling buttons, never nested. |
| 8 | Screenshot reading worked **only** through one AI integration. | Text is always parsed locally; images need a configured server-side reader. |
| 9 | No persistence. | Versioned, validated `localStorage`, plus backup/restore. |
| 10 | Ambiguous am/pm silently guessed. | Reported for review. |

---

## Part 2: bugs in the first rebuild (found on a second pass)

### Corrections to earlier claims

The first version of this document said things that were not true. Corrected:

- **"Grid cells are keyboard reachable"** was false. Blocked cells used the `disabled`
  attribute, which removes them from keyboard focus, and the grid had about 100 Tab stops.
  Now there is **one** Tab stop; arrow keys, Home/End and PageUp/PageDown move around;
  blocked cells use `aria-disabled` so their reason can still be read.
- **"Verified manually: keyboard-only pass"** had not been done. It is now covered by
  real keyboard tests (`src/test/app.test.tsx`, "the schedule grid with a keyboard").
- **"WCAG AA contrast"** was never measured. Measuring found 4 real failures (below).

### Real bugs, all fixed

| Area | Bug | Consequence | Fix |
| --- | --- | --- | --- |
| Calendar (.ics) | Local times were written with a `Z` (UTC) suffix, and repetition used a `UNTIL` in the wrong timezone. | Every shift would appear at the wrong hour in students' calendars. | Local times with `TZID`, repetition by `COUNT`, first weekday on/after the start date. Tested. |
| Publishing | Mock mode reported **"Synced"**; version was `Date.now()`; no approval step; no rule check. | A fake success state; retries not idempotent. | Mock is an honest "practice run" (`dry_run` → "not synced"); version is a content fingerprint; explicit approval; blocked while rules are broken; responses validated. |
| Accessibility | Contrast failures: light-mode muted text (4.39:1), light-mode green text (4.17:1), two student colors (4.17, 4.44). | Text below WCAG AA. | Tokens and colors adjusted; a test measures every pair in both themes, plus translucent banners. |
| Overrides | Confirming "Assign anyway" for the weekly-hours limit **silently also broke the days-per-week limit**. (Found by a UI test.) | Manager consents to one problem and gets two. | The dialog lists every limit it will break; both show as warnings afterward. |
| Auto-fill | A soft per-day cap left students short of their hours, and the explanation blamed the wrong cause. | Wrong advice ("classes and lunch"). | A relaxed second attempt before giving up, so the explanation is true. |
| Conflicts | Nothing checked the schedule after class times were edited. | A shift could sit on top of a class unnoticed. | `findIssues` re-checks the whole schedule; issues appear in Schedule health, on the grid, and block publishing. |
| Import | Backup files were barely validated. | Malformed data could crash the app or inject content. | Strict validation returns a **sanitized copy**: unknown fields stripped, orphan and duplicate shifts dropped (with a note), colors repaired, sizes capped. |
| Parser | Screenshot-derived `13:00` times could not be read by the app's own parser; a bare `8:00-9:15 PM` was read as 8am to 9:15pm. | Wrong or missing classes. | 24-hour times, `noon`, `a.m.`/`p.m.`; a range is resolved *together* and warns only when more than one sensible reading exists. |
| Parser | Weekend classes, `Mon, Wed`, `M/W/F`, duplicates, room names containing "Am". | Rejected or mis-read lines. | Handled; weekend lines get a clear message. |
| State | Reducers generated IDs with `Date.now()`/random. | Impure reducers; unstable IDs across undo. | Deterministic, content-based IDs. |
| Cutoff | "No limit" was stored as 5pm. | If the office later closes at 6pm it would silently become a real cutoff. | Explicit `NO_CUTOFF`. |
| Opening shift | Tied to the visible open time. | At 8am, the 7am requirement was meaningless. | Fixed `OPENING_SHIFT_START`, independent of the view. |
| Persistence | A failed save (full or blocked storage) was swallowed. | Silent data loss. | A visible banner with a "save a backup" button. |
| Multi-tab | Two tabs overwrite each other; last save wins. | Silent data loss. | Changes from another tab trigger a warning. |
| Privacy | Fonts loaded from Google's servers. | A third-party request (visitors' IP addresses shared with Google) on every page load. | Self-hosted; a test forbids third-party requests. |
| n8n template | The AI placeholder returned a hard-coded `confidence: 0.9`. | Looks like a real read. | Returns an honest "nothing was read" error until a provider is connected. |
| Copy | "1 hours", "Noa K.." (double period), "19 hours of 19 hours". | Sloppy, confusing text. | Fixed at the source; a helper enforces it. |
| Tooling | 5 known vulnerabilities in the dev toolchain. | Dev-server exposure. | Upgraded; `npm audit` reports 0. |

### Auto-fill, measured

On the sample roster (6 students, 19 hours each):

| Measure | Result |
| --- | --- |
| Rules broken | 0 |
| Students at their hours | 6 of 6 |
| Single-slot (30-minute) shifts | **0** |
| Shifts of 2+ hours | over 70% (asserted in tests) |
| Coverage at 1 person | 100% |
| Run time | about 25 ms |
| Deterministic | yes, IDs included; running it twice changes nothing |

With **2 people needed** at once, hours become scarce late in the week and a few short shifts
appear (3 single slots on the sample roster). That is inherent scarcity, not a bug, but it is a
known limit of a greedy planner.

### How this is verified

| Check | Where |
| --- | --- |
| Rules, parsing, scheduling, calendar, publish, validation, undo, summaries, help content | 18 unit suites (about 300 tests) |
| Real user flows with genuine keyboard and mouse events (Testing Library `user-event`) | `src/test/app.test.tsx` |
| WCAG 2 A/AA rules via `axe-core` on every screen and dialog (with a self-test proving the checker catches violations) | `app.test.tsx` |
| Contrast of every text/background pair in both themes, and of chip colors | `contrast.test.ts` |
| No third-party requests, no analytics, no stored screenshots | `privacy.test.ts` |

---

## Part 3: a further pass

| Area | Finding | Fix |
| --- | --- | --- |
| Missing feature | The data type had a `manual` busy source but no way to enter it, so a second job or an appointment could not be represented. | "Any other times they can't work?" field, checked live like class times. Messages say "unavailable", not "has class". Older backups without the field still load. |
| Calendar | Files repeated on holidays and breaks. | "Days off" list; each skipped date becomes an `EXDATE` on only the shifts that fall on that weekday. |
| Layout | At a common laptop size (1100 x 640) the schedule grid got only about **200 px** of height; the header, options row and banner took the rest. | Main action moved into the header, rarely used options folded away except on wide screens, the banner sentence is visually hidden on short windows (still read by screen readers), narrower side columns. Measured: 200 px to 281 px. |
| Layout | The selected student's name was cut to "Tr…"; "Add student" wrapped onto two lines and spilled out of its column; a summary tile broke mid-phrase. | Shorter labels and non-wrapping controls. |
| Reliability | Loading a backup read the **whole file into memory before checking its size**, so a huge file would freeze the page. | Size is checked first. |
| Correctness | Backup and spreadsheet file names used the **UTC** date, so an evening in Hawaii was dated "tomorrow". | Local date. |
| Data loss | If the browser refused to save, closing the tab silently lost the work. | The tab now asks before closing while saving is broken. |
| Feedback | "See who is free" scrolled to a panel that was already on screen, so it looked like nothing happened. | The panel is briefly outlined. |
| Accessibility | The "?" help button sat *inside* a `<label>`, so a screen reader would read its text as part of the field's name. | Moved beside the label. |
| Accessibility | Hiding text with `display: none` on short windows would also hide it from screen readers. | Visually hidden instead. |
| Interaction | Only Shift+click could fill a stretch of boxes. | Mouse drag-to-fill (mouse and pen only; touch still scrolls; Escape cancels; one undo step). |
| Sharing | The grid is poor for telling a student when they work. | "By student" and "By day" views, Copy as text, and Print (forced to black on white, buttons hidden). |

Tests added for all of the above, including genuine mouse-drag events. Drag-to-fill was also
checked with a real mouse drag in a live browser.

---

## Part 4: scale, quick fixes and bulk add

| Area | Finding | Result |
| --- | --- | --- |
| Scale | Auto-fill had only ever run on 6 students, and its search space grows with the roster. | Measured on generated rosters with random classes, lunches, cutoffs and opening shifts, at 2 people needed: **12 students 78 ms, 40 students 193 ms, 80 students 339 ms**. No rule is ever broken and results are identical on a second run. A test fails if it takes more than 4 seconds. |
| Actionability | Schedule health explained *why* a time was empty but left the manager to pick a student and click each box. | "Quick fix" buttons. Each candidate is checked by playing the stretch forward under every rule, so "1 of 2 hours" is true rather than a guess. Computed for the first 10 gaps only, so a huge roster can't slow the panel. |
| Onboarding | Adding 30 students meant opening the form 30 times. | "Add several at once": name and classes per line, or tab-separated spreadsheet rows. Previewed line by line; one Undo step; capped at the 200-student limit with a clear message. |
| Bug caught before shipping | My first roster parser treated any name containing a digit as an error ("Student 2: ..."), and would have accepted a lone class time with no colon as a *name*. | The separator is now the first colon that does not sit between two digits (a time's colon always does). A line that looks like class times but has no name is refused. Both cases have tests. |
| Bug caught before shipping | A regular expression's backslash was silently dropped by a patch script (`/\d/` became `/d/`), which would have searched for the letter "d". | Caught by reading the change diff and by the test suite; fixed. Lesson kept: edit regexes with the file editor, not a shell one-liner. |

Also confirmed with a real mouse click in a live browser: quick-fix buttons work end to end,
and a stray click on a grid box for a student at their weekly limit correctly opens
"Assign anyway?" rather than changing anything.

---

## What is *not* verified (be honest about it)

- **No real screen reader was used.** `axe-core` finds roughly a third to a half of
  accessibility problems; it cannot judge whether the experience *makes sense* when read aloud.
- **Contrast is computed from design tokens**, not measured on rendered pixels.
- **Keyboard activation** (Enter/Space/Shift+Enter) is tested in jsdom with `user-event`. The
  browser-automation tool available here could not produce native button activation, so it
  was not re-checked in a live browser (arrow-key movement was).
- **Phone and tablet layouts** were checked in an emulated viewport, not on physical devices. The laptop layout was measured at 1100 x 640 only.
- **Printing** is set up with print styles and tested only for the button, not on real paper or in a print preview.
- **Days off in calendar files** are covered by tests of the file contents, but the files were not opened in Google, Apple or Outlook Calendar.
- **n8n workflows have never been run** against a live n8n instance. The three files are
  starting-point templates.
- **No usability testing with real first-time users.** The plain-language design follows
  established guidelines and is tested for things like sentence length, but has not been
  tried on actual freshmen. Please do that before relying on it.
- **Single user, single browser.** There are no accounts or shared data.
- **Auto-fill is a heuristic**, not an optimizer. It is explainable and deterministic, but not
  guaranteed to find the best possible schedule.

---

## Part 5: checked against the updated Cadence Track C project document (2026-09-22)

The team's engagement letter and project document (Fall 2026, BYU–Hawaii CRDEV 301R) were read
in full and compared line-by-line against this codebase. This section maps the six key
deliverables (D1–D6) to what is actually built and tested today, and separates "the code exists
and is tested" from "the course requirement is fully met" — those are not the same claim.

| Deliverable | What the project document asks for | Status in this codebase |
| --- | --- | --- |
| D1 — Problem validation and requirements | 8+ interviews, current-process map, 12 test scenarios, requirements list, manual-time baseline. | **Not code.** This is research/interview work for the team (Austin/Jared per the Action Register), not something this repository can produce. Nothing to audit here. |
| D2 — Improved ShiftFit prototype | "One working web demo with five verified functions: availability entry, class-conflict display, staffing-demand setup, shift assignment, and coverage-gap reporting." | **All five exist and are tested.** Availability entry: `StudentFormSheet` + `ImportPanel`, parsed by `src/features/scheduling/parser.ts`. Class-conflict display: striped grid cells in `ScheduleGrid`, driven by `availability.ts`/`issues.ts`. Staffing-demand setup: office hours / people-needed controls in `TopBar`, backed by `ScheduleSettings`. Shift assignment: click/drag/keyboard on `ScheduleGrid`, plus deterministic auto-fill (`scheduler.ts`). Coverage-gap reporting: `InsightsPanel`, backed by `coverage.ts`. 387 automated tests pass, the production build is clean, and `tsc --noEmit` reports no type errors as of this audit. |
| D3 — AI-assisted schedule intake proof of concept | Structured extraction from **pasted text and selected schedule images**, human review, ≥90% required-field accuracy, tested on 12 controlled scenarios. | **Text half: done and always on.** `parseClassText` (`parser.ts`) deterministically parses pasted/typed text with no network call; it is exercised by `src/test/parser.test.ts` and shown for review in `MeetingReview` before anything saves. **Image half: wired but not functional yet.** `ImportPanel`, `schedule-extractor.ts` and `schemas.ts` implement the full upload → validate → review flow, but they only *work* once `VITE_AUTOMATION_API_URL` points at a real server with a real AI/vision provider behind it (see D4 below) — that server does not exist yet, so today the screenshot button either shows "Reading screenshots isn't set up here" or is not offered at all. The "12 controlled scenarios / 90% accuracy" measurement itself is a testing-phase task (Week 9 in the Action Register), not something the app can self-report yet. |
| D4 — Calendar publishing automation | One n8n workflow tested on 20+ approved events, ≥95% correct date/time/recurrence/timezone fields, no duplicates. | **Client side done and tested; server side not yet run.** `src/services/automation/{contracts,n8nClient,mockAutomationClient}.ts` implement the request/response contract, idempotent shift ids (so re-publishing updates instead of duplicating), and full validation of whatever comes back. Three n8n workflow templates exist in `n8n/` and are described in `docs/N8N_ARCHITECTURE.md`. None of this has been run against a live n8n instance or a real Google Calendar (also listed under "What is not verified" above) — that is genuinely open work, tracked in `docs/ROADMAP.md` under v3. |
| D5 — Testing and evaluation report | 12 scenario tests, 8+ user sessions, accuracy/time/usability/defect data. | **Not code.** This is the team's testing-phase deliverable. The app's own 387 automated tests are a different, narrower thing (they check the code does what it claims, not that real users succeed with it) — see "What is not verified" above, which already says so plainly. |
| D6 — Final project package | Final demo, user guide, technical setup notes, recommendation, report, presentation. | Partially supported: the README doubles as technical setup notes, and Help/FAQ (`src/content/help.ts`) is a start on a user guide, but neither has been written *as* the formal Track C deliverable yet. |

**Net finding:** the two things standing between this codebase and the D3/D4 targets are the
same thing — a live n8n instance wired to a real AI/vision provider and a Google Calendar API
registration. Nothing in the frontend is blocking that; the contract, validation, and UI are
already built and tested against a mocked version of that server. This matches the open
questions already listed at the bottom of `docs/ROADMAP.md` ("who owns hosting and the n8n
instance," "does OIT allow a Google Calendar app registration").

No regressions were introduced by this pass: `npm run lint` (`tsc --noEmit`), `npm test`
(387/387), and `npm run build` were all re-run clean after this audit and after the readability
pass below.

---

## Part 6: n8n publish workflow hardening (2026-09-23)

Found while building out the n8n automation further (James is now owning n8n hosting/credentials
directly; this pass focused on making the client-side contract and templates as complete as
possible ahead of that).

| Area | Bug | Consequence | Fix |
| --- | --- | --- | --- |
| Calendar publishing | The publish request (`buildPublishRequest` in `contracts.ts`) only ever sent a weekday + minutes-of-day (`day: "mon", start: 480`), never a real date or timezone. The n8n publish template's Google Calendar node referenced `$json.startIso`/`$json.endIso`, fields nothing ever set. | The "Send to Google Calendar" flow could never have worked, even with real n8n/Google credentials wired up — there was no calendar date to send. | `buildPublishRequest` now takes the manager's saved `SemesterConfig` and computes a real `recurrence` block per event (first occurrence date, timezone, `RRULE`, `EXDATE`s), reusing the same, already-tested date math as the `.ics` export (`countWeeklyOccurrences`/`excludedOccurrences` in `features/calendar/ics.ts`) so the two outputs can't disagree. Covered by three new tests in `src/test/automation.test.ts`. |
| Calendar publishing | The "Send to Google Calendar" section had no gate on semester dates being configured — unlike the per-student `.ics` downloads right above it in the same dialog, which were already locked until dates were saved. | A manager could press "Approve and send" (or "Do a practice run") with no dates saved, and — once real credentials existed — send/attempt to send dateless events. | The button is now locked behind the same `calendarReady` check the calendar-file section already used, with the same wording pattern ("Save the semester dates and timezone above first"). Verified in a live browser and covered by an updated test in `src/test/app.test.tsx`. |
| n8n template (publish) | "Revalidate schedule version", "Diff vs. previously synced events" and "Persist sync state" were empty `return items;` stubs — the idempotency strategy the architecture doc promises (`docs/N8N_ARCHITECTURE.md`) was undocumented-as-not-built. | Retrying a publish, or publishing twice, would very likely have created duplicate Google Calendar events once someone filled in a Calendar node. | Implemented real logic: request-shape validation, a shiftId→googleEventId diff and persistence using n8n's own workflow static data (no external database needed for a pilot), and a Google Calendar node wired to the new `recurrence` fields and the diff's `existingEventId`. Still **not run against a live n8n** — see the `notes` on each node for what to verify once real credentials exist. |
| n8n template (interpret) | "Validate and build response" had a `// TODO: validate ai against the schema` comment but no actual validation — any shape an AI provider returned would be passed straight to the frontend. | A misbehaving or compromised AI provider response could reach the UI unvalidated (the frontend's own `schemas.ts` check is the only remaining backstop). | Implemented the same field-by-field validation as `validateExtractedSchedule` in `src/features/import/schemas.ts` directly in the n8n Code node (day enum, minute bounds, confidence range, clamped warning/unresolved lists, malformed individual meetings dropped rather than failing the whole response). Verified by running the extracted JS against four cases (no provider, valid response, non-object response, out-of-range confidence). |

All three `n8n/*.json` files remain starting-point templates — the new logic was verified by
extracting each Code node's JavaScript and running it directly under Node with representative
inputs (see the commands used, not kept in the repo), not by executing the workflow in a real
n8n instance. `npm test` (389/389), `npm run lint` and `npm run build` were re-run clean after
this pass, and the "Send to Google Calendar" flow (including the new date gate) was re-verified
in a live browser.

---

## Part 7: the finished app against the original brief, and the docs against the code (2026-09-24)

Every acceptance criterion in [`CLAUDE_CODE_SHIFTfit_N8N_MASTER_PROMPT_v2.md`](../CLAUDE_CODE_SHIFTfit_N8N_MASTER_PROMPT_v2.md)
was checked, and every markdown file was compared with the code it describes.

### Bugs found and fixed

| Area | Bug | Consequence | Fix |
| --- | --- | --- | --- |
| Parser | A course with no meeting time (`Online - Asynchronous`, `TBA`, `Arranged`) was reported as an **error**, and the student form refuses to save while any line has an error. A test even locked this in. | Pasting a normal registration export that contains an online course made the manager delete that line by hand before they could save the student. The same happened in "Add several at once". | Recognized as understood: it blocks nothing, invents no time, and shows a gentle note instead of an error. Only lines with **no clock time** qualify, so `Online MWF 9:00am-9:50am` or `TBA 9:00-9:50` are still reported, never silently skipped. 3 tests replace the old one. |
| Profile photos | If two photos were chosen quickly, a slow first one could finish **after** the second and silently replace it. | The saved photo could be a different one from the last one picked. | Only the most recent choice may update the form. A test reproduces the slow-first case and was confirmed to **fail without the fix**. |
| Docs | README, AUDIT and TEAM-WORKFLOW quoted test counts that were out of date (387/389 vs. 410); the README did not mention paste-shifts, photos, online courses, `lib/`, or `shift-import.ts`; the README **Team table was empty**; nothing pointed teammates to `TEAM-WORKFLOW.md` or `CLAUDE.md`. | A teammate reading the README would be told the wrong things. | Updated; hard-coded counts removed where they would go stale again (`npm test` prints the real number). Team table filled from the team's project document. |

### The 17 acceptance criteria

| # | Criterion | Status |
| --- | --- | --- |
| 1 | `npm install` succeeds | Yes. `npm ci --dry-run` is clean and the lockfile is in sync. |
| 2 | `npm run dev` starts the app | Yes, run in a real browser this round. |
| 3 | `npm run build` succeeds | Yes. |
| 4 | Unit tests pass | Yes, 410/410. |
| 5 | Schedule survives refresh | Yes, tested, and re-checked live for photos too. |
| 6 | Add, edit, remove a student | Yes, tested. |
| 7 | Paste common formats and review the result | Yes. 31 real-world lines were tried by hand this round (24-hour times, `a.m.`, en-dashes, room names, weekend and overnight rejection); the online-course case above was the only miss. |
| 8 | Manually assign and unassign | Yes. |
| 9 | Auto-fill respects hard rules, favors long shifts | Yes, measured in Part 2 and Part 4. |
| 10 | Switching open hours cannot alter hour totals | Yes, tested. |
| 11 | Gap ranges group correctly | Yes, tested. |
| 12 | Coverage metrics correct and labeled | Yes, two labeled numbers. |
| 13 | Works with keyboard only | Tested with real keyboard events in jsdom; **not** re-done with a real screen reader (see "not verified"). |
| 14 | Light and dark polished | Contrast is measured for both themes. "Polished" is a judgment; the visual redesign is ongoing (ROADMAP). |
| 15 | Mobile does not need a 5-column grid | Yes, one day at a time; checked in an emulated viewport only. |
| 16 | No API secret in source or built assets | Yes. A scan of `src/` and `dist/` found none (the one hit is the test that contains the scanning pattern itself). |
| 17 | Works with no AI provider and no Supabase | Yes; both are absent. |

### Things the brief asked for that are **not** built (deliberately or not yet)

- **The five-step import flow** (`Upload / Paste → AI Review → Draft → Manager Review → Sync`) as a visible stepper.
  The pieces exist (paste, review before saving, auto-fill draft, approval dialog, honest sync state) but
  they are separate screens, not one guided flow.
- **Shifts drawn as one continuous block** in the grid (still one chip per half hour; ROADMAP).
- **"Uncovered staff-hours" and "required early shifts still missing"** as summary tiles. The information is
  shown per gap and per student card, not as two headline numbers.
- **Supabase and `supabase/migrations/`.** Not added, on purpose: the brief says not to add a database "just to
  say the project has one". The future tables and the photo-storage question are on the ROADMAP.
- **A collapsible right panel on medium screens.** Below 1024 px the three panels become tabs; there is no
  in-between collapse.
- **Tailwind 4 and React 19.** The app uses Tailwind 3 and React 18 (both work and have 0 known
  vulnerabilities). Upgrading is a project of its own, not a bug.

### What this audit did not verify

Nothing new was verified with a real screen reader, a physical phone, real paper for printing, a live n8n, or real
first-year students. Those limits from earlier parts still stand.

---

## Part 8: the server side (Workflow B) and two missing numbers (2026-09-26)

Built the scheduler service the architecture doc called for and the original brief listed as Workflow B, plus the
two headline numbers Part 7 said were missing. Also found that `npm run lint` had never checked any code.

| Item | What was built | How it was checked |
| --- | --- | --- |
| `evaluateSchedule` (`src/features/scheduling/evaluate.ts`) | One report answering "is this schedule allowed and how good is it": `ok`, blocking issues, overridden warnings, coverage, gaps, **`uncoveredStaffHours`**, **`openingShiftMissing`**, per-student hours, and the publish fingerprint. It calls the existing rule code and repeats none of it. | 8 tests, including 2 people needed with 1 working (99 missing hours, not 100) and a lone 7:00 half hour not counting as an opening shift. |
| Scheduler service (`src/server/handler.ts`) | `GET /health`, `POST /evaluate`, `POST /generate`, as one host-neutral `Request -> Response` function. Login by shared secret (constant-time compare, refuses to run if none is set or it is under 16 characters), size limit, the strict backup validator on all input, generic errors that never echo the caller's data, `no-store` caching. | 18 tests run in a plain Node environment (no browser). The three most important behaviors were **deliberately broken one at a time and each break was caught**: a password check that always says yes, a service that runs with no secret, and an error that echoes the caller's data. |
| n8n template `shiftfit-generate.json` | Now calls `/generate` with Header Auth (placeholder credential only). | The existing template checks (valid JSON, connected nodes, no secrets) pass. |
| **`npm run lint` checked nothing** | The script was `tsc --noEmit`, but the root `tsconfig.json` lists no files (it only points to other configs), so it type-checked **zero files** and always passed. Earlier "type check clean" statements that relied on `lint` alone (including in Parts 5 and 6) were empty assurance; `npm run build` (`tsc -b`) did check types and was run in those rounds, so no broken code shipped. | Teammates were told to "run npm test and npm run lint" and would have got false comfort. | `lint` now runs `tsc -p tsconfig.app.json --noEmit` and the node config too. Verified by adding a deliberate type error (it is caught) and removing it (clean). It also caught a real type error in this round's new test that the old script missed. |
| Shared test setup | `src/test/setup.ts` skips its browser-only steps when there is no browser, so server tests run as a real server would. | Full suite passes. |

**Not done, and why**
- **Nothing is deployed.** No `netlify/functions` folder exists, on purpose, so merging this cannot publish a live endpoint. The doc's
  "Switching it on" steps are untested against a real host.
- **No rate limiting** in the handler.
- **`/evaluate` is not yet used inside the publish workflow.** The publish request carries only events, not the students and classes
  the check needs. Sending them means more student data leaving the browser, which is a team decision.
- The screens do not show `uncoveredStaffHours` or `openingShiftMissing` yet; that is front-end work.

---

## Part 9: security and backend tightening (2026-09-28)

Found by reading the n8n templates, the server, the calendar export and the Netlify setup, then
confirmed by **running the n8n Code nodes' real JavaScript** in new tests (`automation.test.ts`, "run for
real"). All 7 new workflow tests were checked to **fail against the old templates** and pass after the fix.

| Area | Bug | Consequence | Fix |
| --- | --- | --- | --- |
| n8n publish | "Validate request shape" copied only some fields of each event and **dropped `recurrence`** (the real dates). Part 6 said this was wired up, but each node was tested alone, so nobody saw the first node discard what the later ones needed. | Every event would reach Google Calendar with no start/end date. Publishing (D4) could not have worked. | `recurrence` is kept and checked field by field (date-time shape, timezone name, only `FREQ=WEEKLY;COUNT=1..999`, at most 100 skipped days). Events without valid dates are skipped, never sent dateless. |
| n8n publish | No size or content limits on incoming events. Names and timezones could contain line breaks. | One request could trigger thousands of Google API calls; a line break in a timezone could add repeat rules nobody asked for. | Max 5000 events, name max 80 chars, no control characters, `shiftId` must equal `student-day-start`, duplicates dropped. |
| n8n publish | Skipped days were sent as `2026-09-21T08:00:00`; the calendar standard (RFC 5545) only accepts `20260921T080000` in an `EXDATE`. | Holidays and breaks would not be skipped. | Converted in the calendar node's expression; covered by a test that runs the expression. |
| n8n interpret | The 5 MB image check used `Number(image.fileSize)`, but n8n's `fileSize` is display text such as `"1.2 MB"` (`NaN`). | The size limit never blocked anything. | Measures the real bytes with `getBinaryDataBuffer`; a refused image is removed before the AI step; `requestId` is cleaned. |
| n8n webhooks (all three) | No login on any webhook. The address goes into the public site (`VITE_AUTOMATION_API_URL`). `generate` forwards to the secret-protected scheduler service, adding the secret for any caller. | Anyone who reads the site could write to the library's Google Calendar, or use n8n to reach the protected service. | **Not fully fixable in code: needs a team decision** (manager sign-in, or a server function that checks sign-in and holds the n8n secret). Added `allowedOrigins` placeholders (stops other websites, not scripts) and a SECURITY note on each webhook saying not to activate it until callers must log in. |
| Calendar file (.ics) | `escapeText` handled `\n` and `\r\n` but not a lone `\r`, and kept other control characters. | A name with a hidden `\r` (only possible via a hand-edited backup) could add lines to a student's calendar file. | Every line-break form is escaped and other control characters removed. Test added. |
| Backup / saved data | Names and ids could contain control characters. | Same injection route as above, and into publish requests. | Names: hidden characters become spaces (not rejected, so one odd name can't wipe a saved schedule). Ids: rejected (they link shifts to people, so can't be repaired). Tests added. |
| Website | Netlify sent no security headers (checked on the live test site too). | No protection against clickjacking or injected scripts. | `netlify.toml` now sends a Content Security Policy (own scripts only, no framing), `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`. `privacy.test.ts` checks they stay, and that `index.html` has no inline script the policy would block. |

**Also this round:** every function and component now has a plain-language comment, and
`readability.test.ts` now also checks test files and the three config files for a top comment.
`.env` safety was checked: `.gitignore` blocks every `.env*` except `.env.example`; git history on all
branches contains only `.env.example` files (blank), and a scan of all history found no API keys.

**Not done, and why**
- **Webhook login** (above): needs the team to choose how managers sign in.
- **Moved or removed shifts are never deleted from Google Calendar.** The `shiftId` includes the start time, so
  moving a shift leaves the old event behind. The architecture doc says deletes need explicit permission, so this
  needs a "these N old events will be removed, OK?" step. Design decision first.
- **Security headers were not seen live.** They take effect on the next Netlify deploy from this branch; the test
  site (Christroi's branch) does not have `netlify.toml` yet.
- The n8n changes are still **not run in a real n8n**; the Code nodes' JavaScript was run under Vitest with
  stand-ins for `$input`, `$execution` and `this.helpers`.

`npm test` (451 passed), `npm run lint` and `npm run build` are clean after this round.

---

## Part 10: finishing the backend (2026-09-28)

Closes the two decisions Part 9 left open (webhook login, deleting old events) and makes both servers deployable.

| Item | What was built | How it was checked |
| --- | --- | --- |
| Gateway (`src/server/gateway.ts`, `netlify/functions/gateway.ts`) | The only server the browser talks to: `/api/session`, `/api/publish`, `/api/remove`, `/api/interpret`. Manager passcode (constant-time compare, 10 wrong tries per 15 minutes per address, then `429`); strict validation and **every scheduling rule re-checked**; events **rebuilt on the server** (the browser's own event list is never used); `409` if the schedule changed after approval; n8n called with a secret the browser never sees; n8n's reply checked. Off (`503`) until all three settings are set. | `gateway.test.ts` (18 tests, plain Node). Four protections were each **deliberately removed and every break was caught**: passcode check, rule re-check, approval-version check, lock-out. |
| Shared server helpers (`src/server/http.ts`) | JSON answers, safe errors, constant-time compare, size limits and the lock-out counter, now shared by `handler.ts` and the gateway. | Existing `server.test.ts` passes unchanged. |
| Scheduler service on Netlify (`netlify/functions/scheduler.ts`) | `/api/scheduler/*`, off until `SCHEDULER_SECRET` is set. | Type-checked (`tsconfig.app.json` now includes `netlify/`). Not run on Netlify. |
| Sign-in in the app (`managerSession.ts`, `useManagerSession.ts`, `ManagerSignIn.tsx`) | Passcode box in "Send to Google Calendar" and next to screenshot reading; kept only in the tab's memory; forgotten on any `401`. The browser now sends only what the server needs: **no photos and no pasted class text**. | `manager-session.test.ts` (7 tests), plus a whole-app test: wrong passcode, right passcode with Enter, approve and send, "1 older event", remove, confirm. That test found a real bug: after signing in, the box vanished instead of showing "Signed in as manager / Sign out"; fixed. The box is not a nested `<form>` (it sits inside the student form). |
| Removing old events | Publish replies now include `staleShiftIds` (events from earlier publishes no longer in the schedule). The UI offers "Remove old events" behind a confirmation. n8n's new `/shiftfit/remove` path (same workflow, same records) deletes only events it created; already-gone (404/410) counts as removed. | Code nodes run in `automation.test.ts` with stand-ins for `$input`, `$getWorkflowStaticData` and `$()`; contract validators tested. |
| n8n webhooks | All four webhooks (`publish`, `remove`, `interpret`, `generate`) require Header Auth. Calendar nodes carry on after an error, so one bad event is reported as failed instead of stopping the rest. | A test checks every webhook node has `authentication: headerAuth`. |

**Not done, and why**
- **Database:** needs OIT's answer on where FERPA-covered records may live (`docs/DECISIONS.md`).
- **Personal accounts:** the passcode is shared. Replacing it with Google sign-in changes only the passcode check.
- **Not run live:** no Netlify secrets are set, and n8n still isn't running, so nothing here has talked to real
  n8n or Google. Netlify's `config.path` handling for the functions is untested on a real deploy.
- The lock-out counter lives in server memory, so separate copies of the function count separately.

`npm test` (486 passed), `npm run lint` and `npm run build` are clean after this round.

---

## Part 11: moving the website to GitHub Pages (2026-09-30)

| Item | What was built | How it was checked |
| --- | --- | --- |
| Deploy workflow (`.github/workflows/deploy-pages.yml`) | On every change to `master` (or by hand): type check, all tests, build with `BASE_PATH=/<repository>/`, publish to `https://p00rmans.github.io/cadence/`. The optional gateway address comes from the repository *variable* `VITE_AUTOMATION_API_URL`. | All four action versions (`checkout@v7`, `setup-node@v7`, `upload-pages-artifact@v5`, `deploy-pages@v5`) confirmed to exist. **Not run on GitHub yet**: Pages is not switched on and nothing is merged. |
| Checks workflow (`.github/workflows/ci.yml`) | Type check, tests and build on every pull request: the "next step" `GITHUB-SETTINGS.md` listed. | Same commands pass locally (on Node 25; CI uses Node 22 like Netlify). Not run on GitHub yet. |
| Sub-folder support (`vite.config.ts` `base`) | GitHub Pages serves this project from `/cadence/`, so every built link must start with it. | Built with `BASE_PATH=/cadence/` and served at `http://localhost:4173/cadence/` in a real browser: the app drew, 3 fonts loaded, no failed requests, no console errors. |
| Security policy without headers (`src/lib/contentSecurityPolicy.ts`) | GitHub Pages can't send headers, so the same Content Security Policy is put into the **built** page as a `<meta>` tag (not in dev, where Vite's inline reload scripts would be blocked). `frame-ancestors` can't work in a `<meta>`, so framing protection exists only on Netlify. | `privacy.test.ts` checks the tag comes before anything else and that every rule matches the Netlify header word for word; the browser check above showed no policy violations. |
| Gateway accepts the github.io site (CORS) | When the website (github.io) and the gateway (Netlify) are different sites, browsers ask first. The gateway answers yes, and adds the `access-control-allow-origin` header to every answer, only for sites in `ALLOWED_ORIGINS`; never `*`. `ALLOWED_ORIGINS` keeps only plain https site addresses (or localhost). | 3 new tests in `gateway.test.ts`: allowed vs. stranger preflight, headers on success and on a 401, and the address parser rejecting `*`, http, and paths. |

**Not done, and why**
- **Switching Pages on** is a repository setting (one click, or one `gh api` command in `GITHUB-SETTINGS.md`), and
  the first deploy needs these changes merged into `master` through a pull request. Neither was done without asking.
- The site at `cadence-test.netlify.app` (Christroi's deploy) is separate and unchanged.

`npm test` (490 passed), `npm run lint` and `npm run build` are clean after this round.

---

## Part 12: GitHub Pages only, and a check of the live setup (2026-09-30)

The team decided: **GitHub Pages is the only deployment, no Netlify for now.** The server code stays in the repo,
tested and switched off. Docs (README, GITHUB-SETTINGS, N8N_ARCHITECTURE, ROADMAP, DECISIONS, `.env.example`,
`netlify.toml`, the deploy workflow's comments) now say so.

| Check | Result |
| --- | --- |
| Checks workflow on GitHub (pull request #3) | **Passed twice** on GitHub's own computers (Node 22). |
| Deploy workflow on GitHub | Not run yet: GitHub only registers it once it is on `master`. No YAML checker was available locally, so its first real test is the merge. |
| Library security (`npm audit`) | 0 known vulnerabilities. |
| The github.io build used as a visitor, no server | Built with `BASE_PATH=/cadence/`, served at `/cadence/`: sample students, "Fill schedule for me" (31 missing hours -> "every hour is covered"), semester dates saved, practice run reported "Nothing was sent... not synced", no sign-in box (correct: no server). After a reload: 6 students, 228 half-hour shifts and the semester dates were all still there. No console errors. |
| **Finding: shared web address** | Every Pages site of one GitHub account is the same website to a browser (`p00rmans.github.io`). The account has another Pages site, `/netmon/`, which could read Cadence's saved student data. Today it loads no outside scripts, so there's no known exposure. Can't be fixed in code; options (a team GitHub organization or a custom domain) are in `docs/GITHUB-SETTINGS.md`, "Shared address", and on the ROADMAP. |

`npm test` (490 passed), `npm run lint` and `npm run build` are clean after this round.

## Part 13: Vercel hosting and screenshot reading (2026-10-14)

Asked for by Christroi: host Cadence on Vercel's free Hobby plan, and read class times from screenshots, in the
browser first (Tesseract) with OCR.space as a fallback. Built as a pull request for James to review, since it changes
his "GitHub Pages only" decision (`docs/DECISIONS.md`, 2026-10-14). GitHub Pages keeps working unchanged.

| What | How it works | How it was checked |
| --- | --- | --- |
| Vercel functions (`api/[route].js`, `api/scheduler/[action].js`) | Thin wrappers that call `src/server/vercel.ts`, packed by `npm run build` into `server-dist/vercel.js`. | **Real bug found and avoided:** the obvious version (TypeScript files importing `src/server/`) built fine with `vercel build` but crashed when called, with `ERR_MODULE_NOT_FOUND`, because this is an ES-module project whose imports have no `.js` ending. With the packed file, a local `vercel build` (Vercel CLI 64.0.2) was run and the built functions were called directly in Node: `/api/ocr` reported on/off correctly, sign-in accepted the right passcode and refused a wrong one, `/api/publish` stayed switched off without n8n, `/api/scheduler/health` answered. `vercel.test.ts` (8 tests). |
| Vercel's rewritten addresses | Vercel sends `/api/ocr` to `/api/[route]?route=ocr`. `restoreAddress` puts the original address back whichever form arrives (only plain lowercase names). | `vercel.test.ts`: rewritten and normal addresses, odd names ignored, method, headers and body kept. |
| `vercel.json` | Build command, `dist`, 60-second function limit, the same security headers as `netlify.toml`, a week's caching for `/ocr/` files. | `vercel.test.ts` compares the headers to `netlify.toml` word for word; the local `vercel build` output carried them. |
| Sign-in without n8n | `/api/session` now needs only `MANAGER_PASSCODE`, so a manager can sign in for enhanced reading before n8n exists. The n8n addresses still need all their settings. | `gateway.test.ts`: the "switched off" test now checks `/api/publish` with each missing setting, plus a new test for passcode-only sign-in. |
| `/api/ocr` (`src/server/ocr.ts`) | GET answers `{ enabled }` with no passcode; POST needs the passcode, checks the upload (PNG/JPEG, 1 MB max), sends it to OCR.space with engine 2, English, table mode, and returns only `{ text }`. Daily-limit (403/429 or a "maximum" message), `IsErroredOnProcessing`, timeouts and odd replies become plain messages; OCR.space's own wording is never passed on. Nothing is stored or logged. | `ocr-server.test.ts` (7 tests) with a stand-in for OCR.space. **Not tested against the real OCR.space**: this sandbox can't reach it, and there is no key. |
| Reading in the browser (`src/features/import/ocr/`) | Picture enlarged (to ~2000 px wide, max 3x), grayed, dark mode flipped, contrast stretched; Tesseract (LSTM engine, English "best_int" data) runs in a worker; files served from `/ocr/` on the same site; tesseract.js loaded only on first use. | `ocr.test.ts` (21 tests) for the pixel maths, text clean-up and server client. **Real Tesseract in Chromium** (`npm run test:browser`) on the 3 samples in `test-assets/`: the Workday-style table and the dark-mode phone screenshot were read exactly (about 1.5 s each); the blurry one misread a "9" as "%" and was correctly marked for fixing. No console errors under the real security headers. The main bundle grew 11 KB (316 to 327 KB); Tesseract's own code is a separate 17 KB file, and its ~7 MB engine and data download only when a screenshot is read. |
| **Bug found by the real-browser check** | The blurry sample's "TTh %:00AM - 10:15AM" was first turned into "00 AM-10:15 AM": a class quietly losing its days and real start time. Now a range can't start inside another time, and a line that looks like a time but can't be fully read is kept from its first day word, marked with a red ✕. Any such line also brings up "Try enhanced reading". | A unit test that failed first (`ocr.test.ts`, "never drops or shortens a half-read time"), then the real-browser check. |
| Turning text into class times (`ocr-text.ts`) | Fixes digit look-alikes (O/0, l/1) and odd colons only inside times, evens out dashes and "a m", then picks "days + start-end" from each row (days before, after, or on the line above; several patterns per row). Output goes into the class-times box and through the **existing** parser, so typed and read text follow the same rules; the existing review list is the editable preview. | `ocr.test.ts`, including that every line it produces from the samples parses with no errors. |
| The screen (`ImportPanel.tsx`) | "Use a screenshot instead" always shows (no server needed), or paste a screenshot into the box. Progress bar while reading. "Try enhanced reading" appears only when the server has it on, after a reading, with a line saying the picture goes to OCR.space, and needs the manager passcode; it never runs by itself. When OCR.space is off but the n8n AI reader is configured, the same button uses that instead, so James's reader stays reachable. | `import-panel.test.tsx` (9 tests): progress, results land in the box and the review list, paste, typed text kept (also when typed during a reading), a second reading replaces the first, errors, button hidden/shown, never sent without a click, full sign-in then enhanced flow. |
| Security policy | Adds `'wasm-unsafe-eval'` (WebAssembly only) and `worker-src 'self'`, in `contentSecurityPolicy.ts`, `netlify.toml` and `vercel.json`. | `privacy.test.ts` still forbids `'unsafe-inline'` and `'unsafe-eval'`; the real-browser check ran under the exact `vercel.json` headers with no violations. |
| Size limits | Screenshots for the n8n reader: 5 MB down to 4 MB (Vercel refuses requests over 4.5 MB). For OCR.space: shrunk in the browser to under 1,000 KB (PNG first, then JPEG, then smaller). | `automation.test.ts` updated; the enhanced check in Chromium sent a 13 KB PNG. |

**Not done, and why**
- **No Vercel deploy, preview or `vercel dev`**: this sandbox can't reach vercel.com or OCR.space, and connecting
  the repository needs a team member's Vercel account. The local `vercel build` and direct function calls above are
  the closest check possible here. Steps are in the README, "Deploy".
- **Real OCR.space not tried**, only a stand-in that answers like it. Try it once the key is set (`test-assets/README.md`).
- **Real Workday screenshots not tried**; the samples are made up. Expect to tune `ocr-text.ts` on real ones.
- The wrong-passcode lock-out lives in memory, so on Vercel it resets when a function restarts and isn't shared
  between copies. It slows guessing; the 12-character passcode minimum is the real protection.
- `npm audit` now reports advisories in Tailwind 3's own build tools (`braces`, `postcss-selector-parser`). They
  were published after Part 12, aren't caused by this change, and only affect the build machine; the fix is
  Tailwind 4 (already an optional item on the ROADMAP).

`npm test` (548 passed in 31 files), `npm run lint`, `npm run build` and `npm run test:browser` are clean after this round.

## Part 14: audit of master after Christroi's merge, and the fixes (2026-10-07 to 2026-10-09)

Master after PR #5 (Semester/Break) and PR #8 (build fix) was checked by running it (type check, build, all
tests, auto-fill in both terms, the app in a browser) and by reading the server and calendar code.

| Finding | Fix |
| --- | --- |
| **Real bug:** the day now ends at midnight (1440 minutes), and a shift ending then was written as hour 24: `DTEND...T240000` in `.ics` files and `T24:00:00` in the Google Calendar request. Hour 24 is not a valid calendar time. No test covered it. | `rollOverMidnight` in `ics.ts`, used by both; 3 tests, plus whole-week Semester and Break checks (`term-calendar.test.ts`). |
| `local-reader/` (screenshot reader) could not work with the app: no `/api/session`, blocked the `Authorization` header; its CORS setting only hid answers, so any localhost page could still spend API credit; upload size trusted a header; model id and beta flag were unverified. | Speaks the gateway protocol, needs `READER_PASSCODE`, refuses non-local origins with 403, counts bytes while streaming, valid model id, no beta flag. Auth/CORS smoke-tested with curl. |
| Built site's security policy allowed connections to any `https:` address. | Now only the app's own server, or nobody when there is none (`contentSecurityPolicyFor`). |
| PR #4 (backup reminders) conflicted with master, and once merged the "backup due" reminder would have ignored the schedule that isn't showing. | Merged; the other-term schedule is now part of the backup fingerprint. |
| `npm audit`: 8 issues (6 high), all dev tooling. | `source-map-js` fixed. `braces` and `postcss-selector-parser` need Tailwind 4 (breaking), left alone. |
| The "Protect master" rule requires a pull request but not a passing check, which is how merge markers reached master. | **Not fixed from here** (changing repo rules was blocked). Add the `checks` job as a required status check. |

Added in the same round: a splash screen and animated logo loader, a warmer color palette, `GET /api/health`
on the gateway, locked-down headers on every gateway answer, and `.github/dependabot.yml`.

Christroi's other repositories were read too: `cadence-test-ui` is an empty README; his `cadence` fork has no
secrets or key files in its history, but its default branch is a stale feature branch.

**Update (2026-10-13): Christroi's screenshot reader joined this stack.** His fork's `feature/vercel-ocr` branch (Tesseract in the browser, optional OCR.space, Vercel hosting; Part 13 above) was merged with these fixes: 5 file conflicts resolved (gateway routes, Netlify wrapper, import panel, two docs/test files), `/api/health` now also reports which parts are set up (`ready`, `n8n`, `ocr`), and his `test:browser` script was fixed for Windows (`.pathname` gave `C:\C:\...`). Result: lint, build and 581 tests pass. Read in real Chrome by hand: both `phone-dark.png` and `workday-light.png` gave exactly the expected class times. **Not verified:** the `test:browser` script itself still fails on this Windows machine (Tesseract's language file arrives as an empty 204 answer under Playwright's Chrome, but loads fine in a normal Chrome); the real OCR.space service; `small-blurry.jpg`; any real Vercel deploy. n8n automation is postponed by team decision (2026-10-13).

**Not verified:** anything against a real Google Calendar, n8n or the Claude API (`local-reader` has never called
Claude); real phones, slow networks or screen readers; the Pages deploy of these changes (it runs on merge).

---

---

## Readability pass (2026-09-22)

Every file under `src/` now has a plain-language comment explaining what it's for and, in the
more complex files (`scheduler.ts`, `useShiftFitStore.ts`, `ScheduleGrid.tsx`, and the rest of
`src/features/scheduling/`), how it works — aimed at a reader with no prior backend/frontend
experience. This was a comments-only pass: no logic changed, and the full test suite, typecheck
and production build were re-verified clean before and after.
