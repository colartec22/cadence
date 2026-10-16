import { beforeEach, describe, expect, it } from "vitest";
import { storage } from "../features/persistence/storage";
import { validatePersistedState } from "../features/scheduling/validation";
import { DEFAULT_SETTINGS } from "../features/scheduling/constants";
import type { PersistedStateV1 } from "../features/scheduling/types";

/**
 * Tests for saving to and loading from the browser (`features/persistence/storage.ts`): a good
 * schedule survives a reload, and broken or hand-edited saved data is ignored instead of crashing.
 */

const validState: PersistedStateV1 = {
  version: 1,
  settings: DEFAULT_SETTINGS,
  students: [
    {
      id: "s1",
      name: "Test",
      color: "#1F6FB2",
      preference: "any",
      daysPerWeek: 5,
      classText: "",
      blockedText: "",
      busy: [],
      latestEnd: 17 * 60,
      breaks: [],
      needsOpeningShift: false,
    },
  ],
  assignments: [{ id: "a1", studentId: "s1", day: "mon", start: 9 * 60, source: "manual" }],
  // The schedule that isn't showing (here, the break schedule) must survive a save and reload too.
  otherTermAssignments: [{ id: "b1", studentId: "s1", day: "tue", start: 11 * 60, source: "manual" }],
  selectedStudentId: "s1",
  semester: null,
};

beforeEach(() => {
  window.localStorage.clear();
});

describe("validatePersistedState", () => {
  it("accepts a well-formed state", () => {
    expect(validatePersistedState(validState).ok).toBe(true);
  });

  it("rejects a non-object", () => {
    expect(validatePersistedState("not json").ok).toBe(false);
  });

  it("rejects an unsupported version", () => {
    expect(validatePersistedState({ ...validState, version: 2 }).ok).toBe(false);
  });

  it("rejects malformed students without crashing", () => {
    const result = validatePersistedState({ ...validState, students: [{ id: 5 }] });
    expect(result.ok).toBe(false);
  });

  it("rejects an assignment with an invalid day", () => {
    const result = validatePersistedState({
      ...validState,
      assignments: [{ studentId: "s1", day: "someday", start: 100 }],
    });
    expect(result.ok).toBe(false);
  });
});

describe("storage adapter", () => {
  it("round-trips state through save/load", () => {
    storage.save(validState);
    const loaded = storage.load();
    expect(loaded).toEqual(validState);
  });

  it("returns null and does not throw when storage is empty", () => {
    expect(storage.load()).toBeNull();
  });

  it("ignores corrupted storage instead of throwing", () => {
    window.localStorage.setItem("shiftfit:state", "{not valid json");
    expect(() => storage.load()).not.toThrow();
    expect(storage.load()).toBeNull();
  });

  it("migrates a legacy blob missing a version field by rejecting it as version-mismatched or filling it in", () => {
    window.localStorage.setItem("shiftfit:state", JSON.stringify({ ...validState, version: undefined }));
    // migrate() fills in version: 1, so this should load successfully.
    const loaded = storage.load();
    expect(loaded?.version).toBe(1);
  });

  it("clear() removes saved state", () => {
    storage.save(validState);
    storage.clear();
    expect(storage.load()).toBeNull();
  });
});
