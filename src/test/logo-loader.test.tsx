import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LogoLoader } from "../components/ui/LogoLoader";

/**
 * Tests for the small animated logo shown while Cadence waits (`components/ui/LogoLoader.tsx`).
 * It is decoration only, so it must be hidden from screen readers (the words next to it say what is
 * happening), and its animation must be switched off for people who asked for less motion.
 */

describe("LogoLoader", () => {
  it("is hidden from screen readers and takes the size it is given", () => {
    const { container } = render(<LogoLoader className="h-4 w-4" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("class")).toContain("h-4");
    expect(container.querySelectorAll(".logo-loader-bar")).toHaveLength(3);
    expect(container.querySelectorAll(".logo-loader-beat")).toHaveLength(1);
  });

  it("is animated by app.css, which already stops every animation for 'reduce motion'", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    expect(css).toContain("@keyframes logo-loader-bar");
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation-duration: 0\.01ms !important/);
  });
});

describe("EmptyMark", () => {
  it("is decoration only and has its float animation defined", async () => {
    const { EmptyMark } = await import("../components/ui/EmptyMark");
    const { container } = render(<EmptyMark className="h-16 w-16" />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(readFileSync("src/styles/app.css", "utf8")).toContain("@keyframes empty-float");
  });
});
