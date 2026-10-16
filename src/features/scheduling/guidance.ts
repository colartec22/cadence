/**
 * ============================================================================
 *  THE "WHAT TO DO NEXT" BANNER
 * ============================================================================
 * This file decides the single sentence shown at the top of the app telling a
 * first-time manager what to do next ("Start here: add your first student",
 * "3 problems need fixing", "Looks great: every hour is covered"...). It's
 * plain if/else logic based on counts the rest of the app already computed —
 * no scheduling rules live here, only the wording and priority order of advice.
 */

export type GuidanceInput = {
  studentCount: number;
  shiftCount: number;
  /** Rule-breaking problems (class conflicts, etc.) that are not knowingly overridden. */
  blockingIssues: number;
  /** Half-hour boxes that still have too few people. */
  gapSlots: number;
  studentsBelowTarget: number;
};

export type GuidanceAction = "add-student" | "auto-fill" | "show-health" | "save-share";

export type Guidance = {
  tone: "start" | "todo" | "problem" | "good";
  title: string;
  body: string;
  action?: { label: string; kind: GuidanceAction };
};

/**
 * Picks the single most useful next thing to tell a first-time user, in order of
 * importance: get started, then fix broken rules, then fill gaps, then finish.
 * Kept as a pure function so the advice is easy to test and change.
 */
export function nextStep(input: GuidanceInput): Guidance {
  if (input.studentCount === 0) {
    return {
      tone: "start",
      title: "Start here: add your first student",
      body: "Type a name and paste the times they have class. Cadence will keep them out of those times.",
      action: { label: "Add a student", kind: "add-student" },
    };
  }
  if (input.shiftCount === 0) {
    return {
      tone: "todo",
      title: "Next: let Cadence fill the week",
      body: "Press the button and it will place shifts for everyone around classes and breaks. You can change anything after.",
      action: { label: "Fill schedule for me", kind: "auto-fill" },
    };
  }
  if (input.blockingIssues > 0) {
    return {
      tone: "problem",
      title: `${input.blockingIssues} ${input.blockingIssues === 1 ? "problem needs" : "problems need"} fixing`,
      body: "A shift is breaking a rule (for example, it overlaps a class). The list on the right says exactly what and where.",
      action: { label: "Show me", kind: "show-health" },
    };
  }
  if (input.gapSlots > 0) {
    const hours = input.gapSlots / 2;
    return {
      tone: "todo",
      title: `${hours} ${hours === 1 ? "hour" : "hours"} still ${hours === 1 ? "needs" : "need"} someone`,
      body: "Pink boxes have too few people. Pick a student on the left, then click a pink box to add them. The list on the right shows who is free.",
      action: { label: "See who is free", kind: "show-health" },
    };
  }
  if (input.studentsBelowTarget > 0) {
    return {
      tone: "good",
      title: "Every hour is covered",
      body: `${input.studentsBelowTarget} ${input.studentsBelowTarget === 1 ? "student is" : "students are"} under their weekly hours. That's fine if it's on purpose. Otherwise pick them and add more shifts.`,
      action: { label: "Save & share", kind: "save-share" },
    };
  }
  return {
    tone: "good",
    title: "Looks great: every hour is covered",
    body: "Everyone is at their hours and no rules are broken. Save a backup, or make calendar files for your students.",
    action: { label: "Save & share", kind: "save-share" },
  };
}
