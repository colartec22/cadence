# ShiftFit

Work schedules that fit around classes. Made for student-worker managers at BYU–Hawaii (CRDEV 301),
and designed so a first-year student can use it without instructions.

Add a student, paste when they have class, press **Fill schedule for me**, then click the pink
boxes that still need someone. ShiftFit never puts anyone in a spot where they have class, and it
tells you in plain words why something can't be done.

## The problem

Every semester, departments rebuild every student worker's schedule by hand: class times from the
registration portal, shifts from a spreadsheet or a text message. There is no single source of
truth, so gaps and conflicts slip through.

## What it does

**For someone using it**

- A welcome screen and a live "what to do next" banner walk a first-time user through the app.
- Class times are checked **as you type** (`MWF 9:00-9:50`, `Tuesday/Thursday 8:00 AM - 9:15 AM`,
  Workday rows). Anything unclear is flagged, never silently guessed.
- **Fill schedule for me** places shifts around classes, breaks, cutoffs and weekly hours, in long
  unbroken shifts. Every shift it adds comes with a plain-language reason. It is not AI: the same
  input always gives the same schedule.
- Works **Monday to Saturday** (or Monday to Friday: *Days open* under **Settings**), with four
  office-hour choices: 7am or 8am, until 5pm or midnight.
- Each student can have up to 3 **breaks** (lunch or rest), each with its own start time and length.
  Nobody is scheduled during a break.
- **Text size**: Small, Normal, Large or Extra large, under **Settings**. Remembered on this computer.
- Click a box to assign or clear a half hour. To do a stretch, drag down a column or Shift+click.
- **Add a whole roster at once**: paste one line per student, or rows copied from a spreadsheet.
  Every line is checked first, and the whole batch is one Undo step.
- **Quick fix** buttons in Schedule health: under each empty time, one click gives the stretch to a
  student who can really work it, with the rule checks already done.
- Online and "to be announced" courses in a pasted registration export are understood, not treated as
  mistakes: they block nothing, and a real time is never skipped by accident.
- **Read class times from a screenshot** (for example Workday's "My Enrolled Courses"): choose it with
  *Use a screenshot instead*, or paste it into the class-times box. It is read **in the browser** (Tesseract),
  so it never leaves the computer. The class times found go into the box and are checked line by line before
  anything is saved; a line it couldn't fully read is marked for fixing, never guessed. On Vercel, a signed-in
  manager can also click **Try enhanced reading** (OCR.space) when a screenshot was hard to read.
- **Paste existing shifts**: if a supervisor already wrote the schedule as text
  (`Noa K.: MWF 9:00am-1:00pm`), paste it under **Settings**. Every line is previewed, any half hour that
  breaks a rule is skipped and explained, and the whole paste is one Undo step.
- Optional **profile photos** for students (upload up to 5 MB; shown on cards and in the By student / By day lists).
- Add **other times a student can't work** (a second job, appointments), not just classes.
- **Three views** of the schedule: the grid for building it, and "By student" / "By day" for reading it.
  Both word views can be **copied as text** (for a message or email) or **printed** on a clean page.
- **Schedule health** says what is wrong and *why* ("Nobody is free: Troy (in class), Ana (already
  at 19 hours)"), and warns when a later edit makes an existing shift break a rule.
- **Undo / Redo** for everything, including removing a student or loading a backup.
- **Help** with a quick start, a searchable FAQ, a glossary and shortcuts. `?` opens it anywhere.
- Light, dark, or automatic theme. Works on a phone (one day at a time, section tabs).

**Saving and sharing** (button: *Save & share*)

- Automatic saving in the browser, a backup file you can load on another computer, a spreadsheet,
  and a calendar file per student for phone/Google/Apple/Outlook calendars. Add **days off** (holidays,
  breaks) and shifts on those days are left out of the calendar files.
- Publishing to Google Calendar through n8n is **optional** and honest: without it, the button is
  a "practice run" that says nothing was sent.

## What it deliberately does not do

- No accounts, no analytics, and no server needed. Nothing leaves the browser unless a server is set up
  *and* a manager chooses to send something (Google Calendar, enhanced reading). Fonts and the screenshot
  reader are bundled, so it makes no third-party requests.
- No AI in the browser and no API key anywhere in the frontend. Screenshots are read by Tesseract, a plain
  text reader that runs in the browser from this site's own files. Enhanced reading (OCR.space) runs only on
  the server, with the key kept there.
- No invented policy. The 19-hour default is configurable under **Rules**.

## Adding to the FAQ

Help text lives in one file, [`src/content/help.ts`](src/content/help.ts). To add a question, copy
an entry in `FAQ`, give it a new `id`, choose a `topic`, and write short, friendly sentences (each
string in `answer` is one paragraph). Nothing else needs to change. Tests check that ids are
unique, every topic has questions, sentences stay short, and the button names you mention match
what is on screen.

## Run it

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production build to dist/
npm test          # the whole suite: rules, parsing, calendar, undo, keyboard, mouse, accessibility, scale
npm run lint      # type-check only
npm run test:browser  # builds, then reads the sample screenshots in test-assets/ in a real Chrome (see test-assets/README.md)
```

`npm test` prints the current number of tests. Run it and `npm run lint` before sharing any change.

No environment variables are needed. Copy `.env.example` to `.env` only to connect n8n or OCR.space.

## Architecture

Scheduling rules live in plain TypeScript, separate from React, so they are testable on their own:

```text
src/
  content/help.ts          FAQ, glossary, shortcuts (plain data)
  features/
    scheduling/            types, constants, parser, availability, issues, coverage,
                           scheduler, validation, guidance, blocks, roster, shift-import,
                           summary, time
    persistence/           versioned, validated localStorage
    calendar/              .ics export
    import/                optional screenshot-reader contract + schema checks
      ocr/                 screenshot reading: picture clean-up, Tesseract in the browser,
                           enhanced reading (OCR.space via /api/ocr), picking class times out of the text
  server/                  gateway (/api/...), scheduler service, OCR.space reader, Vercel entry (vercel.ts)
  services/automation/     n8n client, mock (practice run), request/response contracts
  hooks/                   useShiftFitStore (state + undo/redo), useTheme, ...
  lib/                     small helpers: ids, downloads, class names, profile-photo shrinking (image.ts)
  components/              app-shell, students, schedule, summary, import, help, ui
  test/                    unit, UI, accessibility, contrast and privacy suites
api/                       Vercel functions (thin wrappers around src/server/)
test-assets/               sample screenshots (made-up schedules) and the real-browser check
```

The original single-file prototype is kept at
[`archive/shift-coverage-planner-v1.html`](archive/shift-coverage-planner-v1.html).
[`docs/AUDIT.md`](docs/AUDIT.md) lists every bug found and fixed, **and what is not verified**.
[`CLAUDE_CODE_SHIFTfit_N8N_MASTER_PROMPT_v2.md`](CLAUDE_CODE_SHIFTfit_N8N_MASTER_PROMPT_v2.md) is the
original build brief; AUDIT Part 7 checks the finished app against its acceptance criteria.

## n8n (optional)

n8n can orchestrate screenshot reading and Google Calendar publishing. It never replaces the
frontend or the scheduler. See [`docs/N8N_ARCHITECTURE.md`](docs/N8N_ARCHITECTURE.md) and the
templates in [`n8n/`](n8n/). The templates are starting points, have never been run against a live
n8n, and contain no credentials. The browser never calls n8n directly: it goes through the ShiftFit
gateway (`src/server/gateway.ts`), which checks a manager passcode. Set `VITE_AUTOMATION_API_URL` to the
gateway's address to enable it.

## Deploy

There are two ways to put Cadence online. Both build with `npm run build` (Node 20.19 or newer).

### Vercel (website + server, free Hobby plan)

Vercel runs the website **and** the small server in `api/`, so screenshot "enhanced reading" and, later,
Google Calendar sending can work. The Hobby plan is free for non-commercial projects like this one.

1. **Connect the repository.** Sign in at [vercel.com](https://vercel.com) with GitHub, choose
   **Add New → Project**, and import this repository. Vercel reads `vercel.json`, so leave the build settings as
   they are (framework Vite, build command `npm run build`, output folder `dist`). Click **Deploy**.
   Every push then gets its own preview address, and pushes to `master` update the main one.
2. **Get a free OCR.space key** (only needed for *Try enhanced reading*): go to
   [ocr.space/ocrapi](https://ocr.space/ocrapi), choose the **Free** plan, and register with an email address.
   The key arrives by email. The free plan allows 500 reads a day and pictures up to 1 MB (Cadence shrinks
   screenshots to fit).
3. **Add the environment variables** in Vercel: **Project → Settings → Environment Variables**, for
   Production and Preview, then **redeploy** (Deployments → ⋯ → Redeploy) so they take effect:

   | Name | Value | Needed for |
   | --- | --- | --- |
   | `MANAGER_PASSCODE` | A passcode of 12+ characters that managers type to sign in | Enhanced reading, Google Calendar |
   | `OCR_SPACE_API_KEY` | Your OCR.space key from step 2 | Enhanced reading |
   | `AUTOMATION_URL`, `AUTOMATION_SECRET`, `SCHEDULER_SECRET` | See `.env.example` | Google Calendar (only once n8n is hosted) |
   | `VITE_AUTOMATION_API_URL` | `/` | Google Calendar (only once n8n is hosted; until then leave it unset so sending stays a practice run) |

   Nothing is required: with no variables, the site works fully and reads screenshots in the browser; the
   *Try enhanced reading* button simply doesn't appear. Never put a key in a variable starting with `VITE_`:
   those are published inside the website.
4. **Try it locally first (optional):** `npm i -g vercel`, then `vercel link` once and `vercel dev`. It runs the
   site and the `api/` functions together at http://localhost:3000. Put the variables in `.env.local` (Git
   ignores it), or fetch them with `vercel env pull`.

How the server fits Vercel: `api/[route].js` answers `/api/session`, `/api/publish`, `/api/remove`,
`/api/interpret` and `/api/ocr`; `api/scheduler/[action].js` answers `/api/scheduler/*`. Both call the tested code
in `src/server/`, which `npm run build` packs into one file (`server-dist/vercel.js`; see `src/server/vercel.ts`
for why). Hobby-plan limits this respects: a request may run at most 60 seconds (`vercel.json` sets this),
carry at most 4.5 MB (screenshots for the server are kept under 4 MB, and under 1 MB for OCR.space), and
nothing is written to disk (screenshots are only held in memory for the one request). n8n itself can't run on
Vercel; it needs its own host before Google Calendar sending works.

### GitHub Pages (website only)

**The team's current site is on GitHub Pages:** `https://p00rmans.github.io/cadence/`.
`.github/workflows/deploy-pages.yml` runs the type check and every test, builds, and publishes each time `master`
changes (one-time setup: [`docs/GITHUB-SETTINGS.md`](docs/GITHUB-SETTINGS.md), "GitHub Pages"). Every pull request is
also checked automatically by `.github/workflows/ci.yml`.

GitHub Pages only serves files; it can't run servers. So on github.io the whole app runs in the browser: scheduling,
saving, backups, spreadsheets, calendar files and screenshot reading all work, while "Send to Google Calendar" does an
honest practice run and *Try enhanced reading* is hidden. The server code (`src/server/`, wrapped for Netlify in `netlify/functions/`) is
kept, tested and switched off, ready for when the team picks a host for it. Connecting it then is two settings:
`ALLOWED_ORIGINS=https://p00rmans.github.io` on the server, and the GitHub repository **variable**
`VITE_AUTOMATION_API_URL` set to the server's address.

Any other static host works too: build command `npm run build`, output directory `dist`, Node 20.19 or newer.
For a host that serves the site from a sub-folder, set `BASE_PATH=/folder/` when building.

## Privacy

- Only meeting times are kept. Course names, instructors and rooms are ignored.
- Everything is saved in this browser's `localStorage`. Backup files contain student names and
  class times, so keep them private.
- On GitHub Pages, every Pages site of the same GitHub account shares one web address
  (`p00rmans.github.io`), and browsers let all of them read each other's saved data. Never add outside scripts
  to any other Pages site on that account. See `docs/GITHUB-SETTINGS.md`, "Shared address".
- Profile photos are optional. A chosen photo (up to 5 MB) is shrunk to a small square in the browser and
  saved with the student; the original is never stored or uploaded. A photo of a student is personal
  data, so treat backup files as private and check with your instructor before using real photos.
- Screenshots are read in the browser and never stored. One is only sent anywhere when a signed-in
  manager clicks *Try enhanced reading*: it then goes through the Cadence server to OCR.space (an outside
  service, which says it deletes images after reading), and is shown as such on screen. The server keeps
  nothing. Only use enhanced reading with real students' schedules once your instructor agrees (FERPA).
- Class schedules are education records under FERPA. Talk to your instructor before a real pilot,
  and to OIT before connecting BYUH accounts or Google Calendar. Use fake data for demos.

## Team

Cadence, BYU–Hawaii CRDEV 301R (Track C, Fall 2026). Roles are from the team's project document.

| Role | Owner |
| --- | --- |
| Project Manager | Christroi Colarte |
| Team Leader | Jared Rodrigo |
| Reports Manager | Austin Jefferies |
| Deliverables Manager | James Baldwin Dean |

Working together in Git and GitHub: read [`TEAM-WORKFLOW.md`](TEAM-WORKFLOW.md) (one branch per person,
changes reviewed through pull requests). [`CLAUDE.md`](CLAUDE.md) holds the ground rules for anyone
using Claude Code on this repository.
