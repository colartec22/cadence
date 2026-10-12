---
name: cadence-motion-design
description: Use when asked to improve how Cadence looks, feels or moves (animation, transitions, micro-interactions, polish, "make it award-winning"). Gives Cadence's motion principles, ready-made patterns for this codebase, and a checklist that keeps it accessible and testable.
---

# Cadence motion and polish

Goal: make Cadence feel crafted and alive, like a well-made product, **without** making it harder to use.
Cadence is a tool for busy managers scheduling student workers, so motion must *explain* (what changed,
where it went, what to click next) and never just decorate. "Award-winning" here means calm, confident,
precise, and delightful in small moments, not busy.

## Before you start (team rules from CLAUDE.md)

1. Check the branch name. `christroi-` = Christroi, `james-` = James, `jared-` = Jared.
2. Design files are Christroi's area: `src/components/**`, `src/styles/app.css`, `tailwind.config.ts`,
   `index.html`, `public/**`. Tell him which files you will edit. Never touch scheduling logic,
   saved-data shapes or the store: **motion must change how it looks, never what it does.**
3. `package.json` is a shared file. **Do not add an animation library** (Framer Motion, GSAP, etc.)
   without asking the team first. Everything below works with CSS plus a few lines of React.
4. Keep the existing design rules: one solid main action per screen, icon-only secondary buttons keep
   `aria-label` and `title`, never rely on color alone, plain words, keyboard everywhere.
5. Comment every new file and function in plain language (a beginner must be able to read it), and add a
   test for new behavior in `src/test/`. See `src/test/splash.test.ts` and `logo-loader.test.tsx` as models.

## Motion principles

- **Purpose first.** Every animation answers a question: "what just happened?" (a shift appeared),
  "where did it go?" (a dialog closed), "is it working?" (loader), "what can I do?" (hover or focus lift).
  If you cannot say which, delete it.
- **Fast and quiet.** Micro-feedback (hover, press, toggle): 100-180ms. Elements entering or leaving
  (dialogs, toasts, panels): 200-320ms. Big one-off moments (splash, first run): up to 700ms. Nothing in
  the schedule grid should ever feel slow; managers click it hundreds of times.
- **Easing.** Entering or settling: `cubic-bezier(0.2, 0.8, 0.2, 1)` (fast start, soft landing). Leaving:
  `cubic-bezier(0.4, 0, 1, 1)`. Playful pop (rare, small things only): `cubic-bezier(0.3, 1.6, 0.5, 1)`.
  Never `linear` for movement.
- **Only animate `transform` and `opacity`** (cheap and smooth). Avoid animating width, height, top, left
  or box-shadow on big areas. For expand/collapse use `grid-template-rows: 0fr` to `1fr` on small panels.
- **Stagger, don't flood.** Lists enter with 30-50ms between items, capped at about 10 items (the rest
  appear together). Never delay something the user is waiting to click.
- **Consistency.** Reuse the same durations and easings everywhere; define them once as CSS variables.
- **Accessibility is non-negotiable.** `app.css` already switches every animation and transition off
  under `prefers-reduced-motion: reduce`. New motion must either live in CSS (covered automatically) or
  check `window.matchMedia("(prefers-reduced-motion: reduce)")` in code. Nothing may flash more than
  3 times a second. Content must be fully usable with motion off. Never hide information inside an animation.

## Ready-made patterns for this codebase

Put shared values in `src/styles/app.css` (design tokens), then use them from Tailwind classes or CSS:

```css
:root {
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --dur-fast: 140ms;
  --dur-base: 240ms;
}
```

1. **Dialogs, sheets, toasts** (`Modal.tsx`, `Toast.tsx`, `StudentFormSheet.tsx`): fade plus an 8px rise on
   enter, fade on leave, backdrop fades separately. Keep focus handling exactly as it is.
2. **Hover and press lift** on buttons and cards: `hover:-translate-y-px`, `active:translate-y-0`, and the
   existing `.soft-shadow`. (The primary button already does this.)
3. **Schedule grid cells**: a quick 120ms background transition on hover; when a shift is placed, the
   avatar chip pops in (scale 0.6 to 1, 160ms, pop easing). Do not animate every cell on load.
4. **Tab and view switches** (Grid / By student / By day, Semester / Break): cross-fade the panel (150ms).
   Optionally use `document.startViewTransition?.()` where supported, guarded so older browsers just switch.
5. **Numbers and progress**: hour bars grow with `transition: width 400ms var(--ease-out)`; counts such as
   "65 hours still need someone" can count to the new value over 400ms (skip when reduced motion).
6. **Status moments**: when the schedule becomes "every hour covered", give the banner a one-time gentle
   check-mark draw (SVG `stroke-dashoffset`) rather than confetti.
7. **Loading and waiting**: use `LogoLoader` (`components/ui/LogoLoader.tsx`) next to words; use a skeleton
   shimmer only for content areas that really load. The first-load splash lives in `index.html`.
8. **Scroll polish**: the sticky header gets a shadow only after scrolling; list items fade in as they enter.
9. **Empty states**: a small, calm illustration or logo motif with one clear next action, not a wall of text.
10. **Brand moments** (use sparingly): the logo bars animation (splash), a subtle logo "beat" on the first
    successful publish. The brand idea is *cadence = steady rhythm*, so prefer even, rhythmic timing.

## Visual polish checklist

- Spacing on a consistent scale (4, 8, 12, 16, 24, 32); align edges; do not use three different paddings
  for one kind of card.
- Fewer borders, more whitespace and soft shadows (`.soft-shadow`); one elevation level per layer.
- Type: Bricolage Grotesque for headings, Atkinson Hyperlegible for body; tabular numbers for times (already on).
- Color: use the tokens (`bg`, `panel`, `ink`, `muted`, `line`, `accent`, `ok`, `gap`, `warn`). Do not add
  raw hex colors. If you change a token, `src/test/contrast.test.ts` must still pass in light AND dark, and
  the dark values exist in two places in `app.css` (the `[data-theme="dark"]` block and the media-query copy).
- Icons: `lucide-react` only, 16px in buttons, with `aria-hidden`.

## How to work and verify (do not skip)

1. Announce the files you will edit; change one screen or component at a time.
2. Start the app with the `shiftfit-dev` preview, load the sample students, and **look at it**: light, dark,
   desktop width and phone width (375px). Take screenshots as proof.
3. Check motion honestly: reload and watch it; then emulate reduced motion and confirm everything still works
   and nothing is stuck invisible. An element that animates in must end visible when animations are disabled,
   so write the final state as the default and animate *from* the start state.
4. Check the keyboard: Tab through the screen; focus outlines must stay visible during and after animation.
5. Run `npm run lint`, `npm test` (contrast, readability, app and splash tests) and `npm run build`. Report
   real results, and say what you did **not** verify (real devices, screen readers, slow machines).
6. Never commit or push unless the user asked. Open a pull request only on request, and say in it which
   design files changed so Christroi can review.

## Things to avoid

- Parallax, auto-playing carousels, cursor trails, long page-load animations, bouncing everything.
- Animation that delays a click or makes the grid feel heavy on a low-end laptop.
- Motion that is the only way to learn something (always also show text or an icon).
- Heavy libraries or video/Lottie files for small effects.
