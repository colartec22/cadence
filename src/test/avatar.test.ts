import { beforeEach, describe, expect, it } from "vitest";
import { MAX_AVATAR_CHARS } from "../features/scheduling/constants";
import { validatePersistedState } from "../features/scheduling/validation";
import { initialState, reducer } from "../hooks/useShiftFitStore";
import type { Action, NewStudentInput } from "../hooks/useShiftFitStore";
import { centerSquare, checkAvatarFile, isValidAvatar } from "../lib/image";
import { makeSettings, makeStudent } from "./testkit";

/**
 * Tests for student profile photos (`lib/image.ts`): which files may be chosen, how a photo is
 * cropped to a square, and that a saved photo which isn't a small JPEG this app made is dropped.
 */

const GOOD = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD";

describe("choosing a photo", () => {
  it("accepts PNG, JPG and WebP up to 5 MB and explains anything else", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp"]) expect(checkAvatarFile({ type, size: 1000 })).toBeNull();
    expect(checkAvatarFile({ type: "image/png", size: 5 * 1024 * 1024 })).toBeNull();
    expect(checkAvatarFile({ type: "image/png", size: 5 * 1024 * 1024 + 1 })).toMatch(/5 MB/);
    expect(checkAvatarFile({ type: "image/gif", size: 1000 })).toMatch(/PNG, JPG or WebP/);
    expect(checkAvatarFile({ type: "image/svg+xml", size: 1000 })).toMatch(/PNG, JPG or WebP/);
    expect(checkAvatarFile({ type: "application/pdf", size: 1000 })).toMatch(/PNG, JPG or WebP/);
    expect(checkAvatarFile({ type: "image/png", size: 0 })).toMatch(/empty/);
  });

  it("crops the middle square of any shape of photo", () => {
    expect(centerSquare(400, 300)).toEqual({ x: 50, y: 0, side: 300 });
    expect(centerSquare(300, 400)).toEqual({ x: 0, y: 50, side: 300 });
    expect(centerSquare(200, 200)).toEqual({ x: 0, y: 0, side: 200 });
  });
});

describe("only thumbnails this app made are trusted", () => {
  it("accepts a small JPEG data URL and rejects everything else", () => {
    expect(isValidAvatar(GOOD)).toBe(true);
    for (const bad of [
      "",
      null,
      42,
      "https://example.com/me.jpg",
      "javascript:alert(1)",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "data:image/png;base64,AAAA",
      "data:image/jpeg;base64,AAAA\" onerror=\"alert(1)",
      "data:text/html;base64,PGh0bWw+",
      "data:image/jpeg;base64," + "A".repeat(MAX_AVATAR_CHARS),
    ]) {
      expect(isValidAvatar(bad)).toBe(false);
    }
  });
});

describe("photos in saved data and backups", () => {
  const base = { version: 1, settings: makeSettings(), assignments: [], selectedStudentId: null };

  it("keeps a valid photo, and quietly drops a hand-edited or oversized one (showing initials instead)", () => {
    const good = { ...makeStudent({ id: "a", name: "Ana" }), avatar: GOOD };
    const evil = { ...makeStudent({ id: "b", name: "Bo" }), avatar: "javascript:alert(1)" };
    const huge = { ...makeStudent({ id: "c", name: "Cy" }), avatar: "data:image/jpeg;base64," + "A".repeat(MAX_AVATAR_CHARS) };
    const r = validatePersistedState({ ...base, students: [good, evil, huge] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.students[0].avatar).toBe(GOOD);
    expect(r.value.students[1].avatar).toBeUndefined();
    expect(r.value.students[2].avatar).toBeUndefined();
  });

  it("still loads older backups that have no photos at all", () => {
    const r = validatePersistedState({ ...base, students: [makeStudent({ id: "a", name: "Ana" })] });
    expect(r.ok && r.value.students[0].avatar).toBeFalsy();
  });

  it("200 students with maximum-size photos stay inside the 5 MB backup limit", () => {
    const students = Array.from({ length: 200 }, (_, i) => ({ ...makeStudent({ id: `s${i}`, name: `S${i}` }), avatar: "data:image/jpeg;base64," + "A".repeat(MAX_AVATAR_CHARS - 30) }));
    expect(JSON.stringify({ ...base, students }).length).toBeLessThan(5 * 1024 * 1024);
  });
});

const input: NewStudentInput = {
  name: "Noa K.",
  avatar: GOOD,
  preference: "any",
  daysPerWeek: 5,
  classText: "",
  blockedText: "",
  latestEnd: 24 * 60,
  breaks: [],
  needsOpeningShift: false,
};

describe("photos on students", () => {
  beforeEach(() => window.localStorage.clear());

  it("adds a photo with a new student, and removing it on edit really removes it", () => {
    let s = [{ type: "CLEAR_ALL" } as Action, { type: "ADD_STUDENT", id: "n1", input } as Action].reduce(reducer, initialState());
    expect(s.doc.students[0].avatar).toBe(GOOD);
    s = reducer(s, { type: "UPDATE_STUDENT", id: "n1", input: { ...input, avatar: null } });
    expect("avatar" in s.doc.students[0]).toBe(false);
    s = reducer(s, { type: "UNDO" });
    expect(s.doc.students[0].avatar).toBe(GOOD);
  });
});
