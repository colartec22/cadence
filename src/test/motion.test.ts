import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tests for the motion classes in `src/styles/app.css` (the fades, rises and slide-ins used by dialogs,
 * messages and lists; see `.claude/skills/cadence-motion-design/SKILL.md`). They guard the two ways
 * motion can quietly break an app: a class used in a component that the stylesheet doesn't define,
 * and an animation that could leave something invisible when animations are switched off.
 */

const css = readFileSync("src/styles/app.css", "utf8");

/** Every .tsx file under src/components, as text. */
function componentSources(dir = "src/components"): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? componentSources(join(dir, entry.name)) : entry.name.endsWith(".tsx") ? [readFileSync(join(dir, entry.name), "utf8")] : [],
  );
}

describe("motion classes", () => {
  it("every anim-* class a component uses is defined in app.css", () => {
    const used = new Set(componentSources().flatMap((src) => src.match(/\banim-[a-z-]+/g) ?? []));
    expect(used.size).toBeGreaterThan(0);
    for (const name of used) expect(css, name).toContain(`.${name}`);
  });

  it("animations only start from a hidden look (`from`) and never force a hidden end state", () => {
    const keyframes = css.match(/@keyframes anim-[a-z-]+\s*\{[\s\S]*?\n\}/g) ?? [];
    expect(keyframes.length).toBeGreaterThanOrEqual(3);
    for (const block of keyframes) expect(block).not.toMatch(/\bto\s*\{|100%/);
  });

  it("only moves opacity and transform (the cheap, smooth properties)", () => {
    for (const block of css.match(/@keyframes anim-[a-z-]+\s*\{[\s\S]*?\n\}/g) ?? []) {
      const properties = (block.match(/^\s+([a-z-]+):/gm) ?? []).map((p) => p.replace(/[\s:]/g, ""));
      for (const p of properties) expect(["opacity", "transform"], p).toContain(p);
    }
  });

  it("is switched off for 'reduce motion' by the rule that already covers every animation", () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation-duration: 0\.01ms !important/);
  });
});
