import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { viewport } from "./setup";
import { buildPublishRequest } from "../services/automation/contracts";
import { signOutManager } from "../services/automation/managerSession";

/**
 * Whole-app tests: they draw the real app in a pretend browser (jsdom) and use it the way a person
 * would, clicking buttons, typing and pressing keys, then check what appears on screen. Buttons
 * are found by their visible or screen-reader names, so renaming a button means updating it here.
 */

/** Starts the app fresh (empty saved data). By default the welcome screen counts as already seen. */
function boot({ welcomed = true }: { welcomed?: boolean } = {}) {
  window.localStorage.clear();
  if (welcomed) window.localStorage.setItem("shiftfit:welcomed", "1");
  const user = userEvent.setup();
  return { user, ...render(<App />) };
}

// A schedule box, found by its spoken name (e.g. "Monday 9:00am ...").
const cell = (label: RegExp) => screen.getByRole("button", { name: label });
// The "next step" guidance banner at the top.
const banner = () => screen.getAllByRole("status")[0];
// The short pop-up message that appears after an action.
const toast = () => document.querySelector<HTMLElement>('div[role="status"].pointer-events-none')!;

/** The header has the real button; after a fill the guidance banner offers a second one. */
async function openShare(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(screen.getByRole("banner")).getByRole("button", { name: /save & share/i }));
  return screen.getByRole("dialog", { name: /save & share/i });
}

/** Presses the main "Fill schedule for me" button. */
async function fillSchedule(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /fill schedule for me/i }));
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("first visit", () => {
  it("welcomes a new person once, in plain words, and remembers", async () => {
    const { user, unmount } = boot({ welcomed: false });
    const dialog = screen.getByRole("dialog", { name: /welcome to cadence/i });
    expect(within(dialog).getByText(/Add your students/)).toBeTruthy();
    expect(within(dialog).getByText(/Fix the pink spots/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: /try it with sample students/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.localStorage.getItem("shiftfit:welcomed")).toBe("1");
    unmount();
    render(<App />);
    expect(screen.queryByRole("dialog", { name: /welcome/i })).toBeNull();
  });

  it("puts keyboard focus on the main choice", () => {
    boot({ welcomed: false });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /try it with sample students/i }));
  });

  it("'Start with my own students' clears the samples and opens the add form", async () => {
    const { user } = boot({ welcomed: false });
    await user.click(screen.getByRole("button", { name: /start with my own students/i }));
    expect(screen.getByRole("dialog", { name: /add a student/i })).toBeTruthy();
    expect(screen.queryByText("Troy C.")).toBeNull();
  });

  it("'Show me how it works' opens the quick start", async () => {
    const { user } = boot({ welcomed: false });
    await user.click(screen.getByRole("button", { name: /show me how it works/i }));
    expect(screen.getByRole("dialog", { name: "Help" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Quick start", selected: true })).toBeTruthy();
  });
});

describe("guidance banner", () => {
  it("tells you what to do next as the schedule changes", async () => {
    const { user } = boot();
    expect(banner().textContent).toMatch(/82 hours still need someone/);
    await fillSchedule(user);
    expect(banner().textContent).toMatch(/Looks great: every hour is covered/);
    await user.click(screen.getByRole("button", { name: /clear all shifts/i }));
    await user.click(screen.getByRole("button", { name: /yes, clear them/i }));
    expect(banner().textContent).toMatch(/let Cadence fill the week/i);
  });

  it("asks a brand-new user to add their first student", async () => {
    const { user } = boot();
    await openShare(user);
    await user.click(screen.getByRole("button", { name: /clear everything/i }));
    await user.click(screen.getByRole("button", { name: /yes, clear everything/i }));
    expect(banner().textContent).toMatch(/Start here: add your first student/);
    expect(screen.getByRole("button", { name: /add your first student/i })).toBeTruthy();
    expect((screen.getByRole("button", { name: /fill schedule for me/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("filling and undoing", () => {
  it("fills the schedule, explains why, and undoes in one step", async () => {
    const { user } = boot();
    await fillSchedule(user);
    expect(toast().textContent).toMatch(/Added 114 hours of shifts\. Everyone is at their target\./);
    expect(screen.getByText("What did “Fill schedule for me” do?")).toBeTruthy();
    expect(screen.getAllByText(/At their hours/).length).toBe(7);

    await user.click(screen.getByRole("button", { name: /^undo/i }));
    expect(toast().textContent).toMatch(/Undid: Auto-filled shifts/);
    expect(banner().textContent).toMatch(/82 hours still need someone/);
    await user.click(screen.getByRole("button", { name: /^redo/i }));
    expect(banner().textContent).toMatch(/Looks great/);
  });

  it("Ctrl+Z and Ctrl+Shift+Z work, but never while typing", async () => {
    const { user } = boot();
    await fillSchedule(user);
    await user.keyboard("{Control>}z{/Control}");
    expect(banner().textContent).toMatch(/still need someone/);
    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    expect(banner().textContent).toMatch(/Looks great/);

    await user.click(screen.getByRole("searchbox", { name: /search students/i }));
    await user.keyboard("{Control>}z{/Control}");
    expect(banner().textContent).toMatch(/Looks great/); // typing field keeps its own undo
  });
});

describe("adding a student", () => {
  it("checks class times live, blocks bad lines, and saves when fixed", async () => {
    const { user } = boot();
    await user.click(screen.getByRole("button", { name: "Add student" }));
    const dialog = screen.getByRole("dialog", { name: /add a student/i });
    expect(document.activeElement).toBe(within(dialog).getByLabelText(/student's name/i));

    await user.type(within(dialog).getByLabelText(/student's name/i), "Noa K.");
    const times = within(dialog).getByLabelText(/when does this student have class/i);
    await user.click(times);
    await user.paste("MWF 9:00-9:50\ngarbled nonsense\nSun 9:00am-11:00am");
    expect(within(dialog).getByText(/1 of 3 lines, 2 need fixing/)).toBeTruthy();
    expect(within(dialog).getByText(/Sunday isn't part of the Monday to Saturday schedule/)).toBeTruthy();
    expect(within(dialog).getByText(/read as 9:00am–9:50am/)).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "Add student" }));
    expect(within(dialog).getAllByRole("alert").some((a) => /Fix or delete the lines/.test(a.textContent ?? ""))).toBe(true);
    expect(screen.queryByText("Noa K.")).toBeNull();

    await user.clear(times);
    await user.click(times);
    await user.paste("MWF 9:00am-9:50am");
    await user.click(within(dialog).getByRole("button", { name: "Add student" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /^Noa K\./ })).toBeTruthy();
    expect(toast().textContent).toMatch(/Added Noa K\./);
  });

  it("requires a name and says so kindly", async () => {
    const { user } = boot();
    await user.click(screen.getByRole("button", { name: "Add student" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Add student" }));
    expect(within(dialog).getByRole("alert").textContent).toMatch(/Type the student's name/);
  });

  it("submits with the Enter key from the name field", async () => {
    const { user } = boot();
    await user.click(screen.getByRole("button", { name: "Add student" }));
    await user.type(screen.getByLabelText(/student's name/i), "Kai{Enter}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /^Kai/ })).toBeTruthy();
  });

  it("offers an example and warns about a duplicate name", async () => {
    const { user } = boot();
    await user.click(screen.getByRole("button", { name: "Add student" }));
    await user.click(screen.getByRole("button", { name: /fill in an example/i }));
    expect((screen.getByLabelText(/when does this student have class/i) as HTMLTextAreaElement).value).toMatch(/MWF 9:00-9:50/);
    await user.type(screen.getByLabelText(/student's name/i), "troy c.");
    expect(screen.getByText(/Someone else already has this name/)).toBeTruthy();
  });

  it("editing keeps what was there and Escape cancels without saving", async () => {
    const { user } = boot();
    await user.click(screen.getByRole("button", { name: "Edit Troy C." }));
    const dialog = screen.getByRole("dialog", { name: /edit troy c\./i });
    expect((within(dialog).getByLabelText(/student's name/i) as HTMLInputElement).value).toBe("Troy C.");
    expect((within(dialog).getByLabelText(/when does this student have class/i) as HTMLTextAreaElement).value).toMatch(/Tuesday\/Thursday/);
    await user.type(within(dialog).getByLabelText(/student's name/i), " EXTRA");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/EXTRA/)).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit Troy C." }));
  });
});

describe("removing a student", () => {
  it("asks first, can be cancelled, and can be undone", async () => {
    const { user } = boot();
    await user.click(screen.getByRole("button", { name: "Remove Troy C." }));
    let dialog = screen.getByRole("dialog", { name: /remove troy c\.\?/i });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: /^Troy C\./ })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Remove Troy C." }));
    dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /yes, remove/i }));
    expect(screen.queryByRole("button", { name: /^Troy C\./ })).toBeNull();
    await user.click(screen.getByRole("button", { name: /^undo/i }));
    expect(screen.getByRole("button", { name: /^Troy C\./ })).toBeTruthy();
  });
});

describe("the schedule grid with a keyboard", () => {
  it("has a single tab stop and moves with arrow keys", async () => {
    const { user } = boot();
    const grid = screen.getByRole("grid");
    const cells = within(grid).getAllByRole("button");
    expect(cells).toHaveLength(204); // 6 days (Mon–Sat) x 34 half hours (7:00am to midnight)
    expect(cells.filter((c) => c.tabIndex === 0)).toHaveLength(1);

    const start = cell(/^Monday 7:00am to 7:30am/);
    start.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowRight}");
    expect(document.activeElement).toBe(cell(/^Tuesday 8:00am to 8:30am/));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(cell(/^Monday 8:00am to 8:30am/));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(cell(/^Saturday 8:00am to 8:30am/)); // the last open day
    await user.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}");
    expect(document.activeElement).toBe(cell(/^Saturday 7:00am to 7:30am/)); // stops at the edge
    expect(within(grid).getAllByRole("button").filter((c) => c.tabIndex === 0)).toHaveLength(1);
  });

  it("adds and removes a shift with Enter and Space", async () => {
    const { user } = boot();
    await user.click(screen.getByRole("button", { name: /^Leilani P\./ }));
    const box = cell(/^Wednesday 8:00am to 8:30am/);
    expect(box.getAttribute("aria-pressed")).toBe("false");
    box.focus();
    await user.keyboard("{Enter}");
    expect(cell(/^Wednesday 8:00am to 8:30am/).getAttribute("aria-pressed")).toBe("true");
    await user.keyboard(" ");
    expect(cell(/^Wednesday 8:00am to 8:30am/).getAttribute("aria-pressed")).toBe("false");
  });

  it("fills a whole stretch with Shift+Enter, and Shift+click", async () => {
    const { user } = boot();
    await user.click(screen.getByRole("button", { name: /^Leilani P\./ }));
    cell(/^Wednesday 8:00am to 8:30am/).focus();
    await user.keyboard("{Enter}{ArrowDown}{ArrowDown}{ArrowDown}{Shift>}{Enter}{/Shift}");
    for (const t of ["8:00am to 8:30am", "8:30am to 9:00am", "9:00am to 9:30am", "9:30am to 10:00am"]) {
      expect(cell(new RegExp(`^Wednesday ${t}`)).getAttribute("aria-pressed"), t).toBe("true");
    }
    expect(toast().textContent).toMatch(/Added 3 slots on Wed 8:00am–10:00am/);

    // Shift+click extends from the last box, the same way
    await user.click(cell(/^Thursday 11:00am to 11:30am/));
    await user.keyboard("{Shift>}");
    await user.click(cell(/^Thursday 12:30pm to 1:00pm/));
    await user.keyboard("{/Shift}");
    expect(cell(/^Thursday 12:00pm to 12:30pm/).getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps a blocked box focusable and explains why in plain words", async () => {
    const { user } = boot();
    const blocked = cell(/^Tuesday 8:00am to 8:30am/);
    expect(blocked.getAttribute("aria-disabled")).toBe("true");
    expect((blocked as HTMLButtonElement).disabled).toBe(false);
    expect(blocked.getAttribute("aria-label")).toMatch(/Troy C\. has class on Tue at this time/);
    blocked.focus();
    await user.keyboard("{Enter}");
    expect(toast().textContent).toMatch(/Troy C\. has class on Tue at this time\. Pick a different time\./);
    expect(blocked.getAttribute("aria-pressed")).toBe("false");
  });

  it("explains an empty pink box and who could cover it", () => {
    boot();
    const pink = cell(/^Monday 7:00am to 7:30am/);
    expect(pink.getAttribute("aria-label")).toMatch(/Nobody is working\. Needs 1 more\..*could work this/);
    expect(within(pink).getByText("Need 1")).toBeTruthy();
  });

  it("asks before going over someone's weekly hours, then keeps a visible warning", async () => {
    const { user } = boot();
    await user.click(cell(/^Tuesday 2:00pm to 2:30pm/)); // Troy is already at 19 hours
    const dialog = screen.getByRole("dialog", { name: /assign anyway/i });
    // it must own up to EVERY limit it is about to break, not just the first
    expect(dialog.textContent).toMatch(/Troy C\. is already at 19 hours and only works 3 days a week/);
    await user.click(within(dialog).getByRole("button", { name: /yes, assign anyway/i }));
    expect(cell(/^Tuesday 2:00pm to 2:30pm/).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/scheduled 19.5 hours, over the weekly limit of 19 hours/)).toBeTruthy();
    expect(screen.getByText(/scheduled on 4 days but only works 3 days a week/)).toBeTruthy();
    expect(screen.getAllByText(/\(You chose to allow this\.\)/)).toHaveLength(2);
    // The allowed limits are warnings, not blockers. The only problem left is the 30-minute shift itself.
    expect(screen.getByText(/shift on Tue 2:00pm–2:30pm is too short/)).toBeTruthy();
    expect(banner().textContent).toMatch(/^1 problem/);
  });

  it("declining the override changes nothing", async () => {
    const { user } = boot();
    await user.click(cell(/^Tuesday 2:00pm to 2:30pm/));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cell(/^Tuesday 2:00pm to 2:30pm/).getAttribute("aria-pressed")).toBe("false");
  });
});

describe("dragging to fill", () => {
  // A box whose name starts with this text, e.g. "Monday 9:00am".
  const box = (label: string) => cell(new RegExp(`^${label}`));
  // "true" if the selected student works that box, "false" if not.
  const pressed = (label: string) => box(label).getAttribute("aria-pressed");

  // Selects Leilani P. as the student the grid clicks will assign.
  async function pick(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /^Leilani P\./ }));
  }

  it("fills several boxes in a column when you press, drag and release", async () => {
    const { user } = boot();
    await pick(user);
    await user.pointer([
      { keys: "[MouseLeft>]", target: box("Thursday 7:00am to 7:30am") },
      { target: box("Thursday 7:30am to 8:00am") },
      { target: box("Thursday 8:00am to 8:30am") },
      { target: box("Thursday 8:30am to 9:00am") },
      { keys: "[/MouseLeft]" },
    ]);
    for (const t of ["7:00am to 7:30am", "7:30am to 8:00am", "8:00am to 8:30am", "8:30am to 9:00am"]) {
      expect(pressed(`Thursday ${t}`), t).toBe("true");
    }
    expect(pressed("Thursday 9:00am to 9:30am")).toBe("false");
    expect(toast().textContent).toMatch(/Added 4 slots on Thu 7:00am–9:00am/);
  });

  it("is one undo step", async () => {
    const { user } = boot();
    await pick(user);
    await user.pointer([
      { keys: "[MouseLeft>]", target: box("Thursday 7:00am to 7:30am") },
      { target: box("Thursday 8:00am to 8:30am") },
      { keys: "[/MouseLeft]" },
    ]);
    expect(pressed("Thursday 8:00am to 8:30am")).toBe("true");
    await user.click(screen.getByRole("button", { name: /^undo/i }));
    expect(pressed("Thursday 7:00am to 7:30am")).toBe("false");
    expect(pressed("Thursday 8:00am to 8:30am")).toBe("false");
  });

  it("clears a stretch when it starts on a box that is already filled", async () => {
    const { user } = boot();
    await pick(user);
    await user.pointer([
      { keys: "[MouseLeft>]", target: box("Thursday 7:00am to 7:30am") },
      { target: box("Thursday 8:00am to 8:30am") },
      { keys: "[/MouseLeft]" },
    ]);
    await user.pointer([
      { keys: "[MouseLeft>]", target: box("Thursday 7:30am to 8:00am") },
      { target: box("Thursday 8:00am to 8:30am") },
      { keys: "[/MouseLeft]" },
    ]);
    expect(pressed("Thursday 7:00am to 7:30am")).toBe("true"); // outside the dragged stretch
    expect(pressed("Thursday 7:30am to 8:00am")).toBe("false");
    expect(pressed("Thursday 8:00am to 8:30am")).toBe("false");
  });

  it("skips boxes the student can't work and says so", async () => {
    const { user } = boot();
    await pick(user);
    // Leilani has class Tue/Thu 1:00-2:15, so 12:30 is free but 1:00 and 1:30 are blocked
    await user.pointer([
      { keys: "[MouseLeft>]", target: box("Tuesday 12:30pm to 1:00pm") },
      { target: box("Tuesday 1:00pm to 1:30pm") },
      { target: box("Tuesday 1:30pm to 2:00pm") },
      { keys: "[/MouseLeft]" },
    ]);
    expect(pressed("Tuesday 12:30pm to 1:00pm")).toBe("true");
    expect(pressed("Tuesday 1:00pm to 1:30pm")).toBe("false");
    expect(toast().textContent).toMatch(/Skipped 2 slots/);
  });

  it("does nothing if you press Escape before letting go", async () => {
    const { user } = boot();
    await pick(user);
    await user.pointer([
      { keys: "[MouseLeft>]", target: box("Thursday 7:00am to 7:30am") },
      { target: box("Thursday 8:00am to 8:30am") },
    ]);
    await user.keyboard("{Escape}");
    await user.pointer({ keys: "[/MouseLeft]" });
    expect(pressed("Thursday 7:00am to 7:30am")).toBe("false");
    expect(pressed("Thursday 8:00am to 8:30am")).toBe("false");
  });

  it("does not turn a drag across two different days into a fill", async () => {
    const { user } = boot();
    await pick(user);
    await user.pointer([
      { keys: "[MouseLeft>]", target: box("Thursday 7:00am to 7:30am") },
      { target: box("Friday 7:30am to 8:00am") },
      { keys: "[/MouseLeft]" },
    ]);
    expect(pressed("Friday 7:30am to 8:00am")).toBe("false");
  });

  it("leaves a plain click working afterwards (the drag never swallows the next click)", async () => {
    const { user } = boot();
    await pick(user);
    await user.pointer([
      { keys: "[MouseLeft>]", target: box("Thursday 7:00am to 7:30am") },
      { target: box("Thursday 7:30am to 8:00am") },
      { keys: "[/MouseLeft]" },
    ]);
    await new Promise((r) => setTimeout(r, 20));
    await user.click(box("Wednesday 8:00am to 8:30am"));
    expect(pressed("Wednesday 8:00am to 8:30am")).toBe("true");
  });

});

describe("conflicts show up when class times change after shifts exist", () => {
  it("flags the shift with a plain message and a warning icon", async () => {
    const { user } = boot();
    await fillSchedule(user);
    await user.click(screen.getByRole("button", { name: "Edit Leilani P." }));
    const dialog = screen.getByRole("dialog");
    const times = within(dialog).getByLabelText(/when does this student have class/i);
    await user.clear(times);
    await user.click(times);
    await user.paste("MTWRF 7:00am-11:00am");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(banner().textContent).toMatch(/problems? need/);
    expect(screen.getAllByText(/Leilani P\. has a class then:/).length).toBeGreaterThan(0);
  });
});

describe("help", () => {
  it("opens with ? and closes with Escape, returning focus", async () => {
    const { user } = boot();
    screen.getByRole("button", { name: /fill schedule for me/i }).focus();
    await user.keyboard("?");
    const dialog = screen.getByRole("dialog", { name: "Help" });
    expect(dialog).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /fill schedule for me/i }));
  });

  it("does not steal '?' while you are typing", async () => {
    const { user } = boot();
    await user.click(screen.getByRole("searchbox", { name: /search students/i }));
    await user.keyboard("?");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("searches the questions and reads them out in plain words", async () => {
    const { user } = boot();
    await user.click(screen.getByRole("button", { name: "Help" }));
    await user.click(screen.getByRole("tab", { name: "Questions" }));
    const search = screen.getByRole("searchbox", { name: /search the questions/i });
    await user.type(search, "lunch");
    const found = screen.getAllByText(/./, { selector: "summary" }).map((s) => s.textContent);
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThan(6);
    await user.clear(search);
    await user.type(search, "zzzzqqq");
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
  });

  it("switches tabs with the arrow keys", async () => {
    const { user } = boot();
    await user.click(screen.getByRole("button", { name: "Help" }));
    screen.getByRole("tab", { name: "Quick start" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Questions", selected: true })).toBeTruthy();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Shortcuts", selected: true })).toBeTruthy();
  });

  it("explains a term inline with a tip that closes on Escape", async () => {
    const { user } = boot();
    await user.click(screen.getByRole("button", { name: /what does “people needed at once” mean/i }));
    expect(screen.getByRole("note").textContent).toMatch(/must be on duty at the same time/);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("Save & share", () => {
  it("does an honest practice run and never says 'synced'", async () => {
    const { user } = boot();
    await fillSchedule(user);
    const dialog = await openShare(user);
    expect(dialog.textContent).toMatch(/isn't connected to Google Calendar/);
    // A real calendar event needs a real date, not just a weekday, so the button stays
    // locked until semester dates are saved — same rule as the per-student calendar files.
    expect(dialog.textContent).toMatch(/Save the semester dates and timezone above first/);
    expect(within(dialog).queryByRole("button", { name: /do a practice run/i })).toBeNull();

    fireEvent.change(within(dialog).getByLabelText("First day"), { target: { value: "2026-08-24" } });
    fireEvent.change(within(dialog).getByLabelText("Last day"), { target: { value: "2026-12-11" } });
    await user.type(within(dialog).getByLabelText("Timezone"), "Pacific/Honolulu");
    await user.click(within(dialog).getByRole("button", { name: "Save dates" }));

    expect(dialog.textContent).toMatch(/Status: not sent/);
    await user.click(within(dialog).getByRole("button", { name: /do a practice run/i }));
    await waitFor(() => expect(within(dialog).getByText(/Practice run finished/)).toBeTruthy());
    expect(dialog.textContent).toMatch(/Nothing was sent/);
    expect(dialog.textContent).not.toMatch(/Status: sent/);
  });

  it("with a real server: asks for the manager passcode, sends, then offers to remove old events", async () => {
    vi.stubEnv("VITE_AUTOMATION_API_URL", "/");
    const requests: string[] = [];
    // A pretend ShiftFit server: accepts one passcode, "creates" every event, and reports one old event.
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      requests.push(url);
      if ((init.headers as Record<string, string>).authorization !== "Bearer manager-pass-123") return new Response(null, { status: 401 });
      if (url === "/api/session") return new Response(null, { status: 200 });
      const body = JSON.parse(init.body as string);
      if (url === "/api/remove") return Response.json({ results: body.shiftIds.map((shiftId: string) => ({ shiftId, status: "removed" })) });
      const sent = buildPublishRequest(body.students, body.assignments, body.settings, body.semester);
      return Response.json({
        scheduleVersion: sent.scheduleVersion,
        results: sent.events.map((e) => ({ shiftId: e.shiftId, status: "created", googleEventId: "g" })),
        staleShiftIds: ["old-shift-1"],
      });
    });
    try {
      const { user } = boot();
      await fillSchedule(user);
      const dialog = await openShare(user);
      fireEvent.change(within(dialog).getByLabelText("First day"), { target: { value: "2026-08-24" } });
      fireEvent.change(within(dialog).getByLabelText("Last day"), { target: { value: "2026-12-11" } });
      await user.type(within(dialog).getByLabelText("Timezone"), "Pacific/Honolulu");
      await user.click(within(dialog).getByRole("button", { name: "Save dates" }));

      // Locked until a manager signs in.
      const send = within(dialog).getByRole("button", { name: /approve and send/i }) as HTMLButtonElement;
      expect(send.disabled).toBe(true);
      await user.type(within(dialog).getByLabelText(/manager passcode/i), "wrong-pass-123");
      await user.click(within(dialog).getByRole("button", { name: "Sign in" }));
      await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toMatch(/isn't right/));
      await user.clear(within(dialog).getByLabelText(/manager passcode/i));
      await user.type(within(dialog).getByLabelText(/manager passcode/i), "manager-pass-123{Enter}");
      await waitFor(() => expect(dialog.textContent).toMatch(/Signed in as manager/));

      await user.click(within(dialog).getByRole("button", { name: /approve and send/i }));
      await user.click(screen.getByRole("button", { name: "Yes, send it" }));
      await waitFor(() => expect(dialog.textContent).toMatch(/Status: sent/));
      expect(dialog.textContent).toMatch(/1 older event is still on the calendar/);

      await user.click(within(dialog).getByRole("button", { name: /remove old events/i }));
      await user.click(screen.getByRole("button", { name: "Yes, remove them" }));
      await waitFor(() => expect(dialog.textContent).toMatch(/Removed 1 old event\./));
      expect(within(dialog).queryByRole("button", { name: /remove old events/i })).toBeNull();
      expect(requests).toEqual(["/api/session", "/api/session", "/api/publish", "/api/remove"]);
    } finally {
      signOutManager();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it("keeps calendar files locked until the semester dates and timezone are saved", async () => {
    const created: Blob[] = [];
    URL.createObjectURL = (b: Blob | MediaSource) => {
      created.push(b as Blob);
      return "blob:test";
    };
    const { user } = boot();
    await fillSchedule(user);
    const dialog = await openShare(user);
    const download = within(dialog).getByRole("button", { name: /download calendar file for troy c\./i }) as HTMLButtonElement;
    expect(download.disabled).toBe(true);
    expect(dialog.textContent).toMatch(/Save the dates above first/);

    fireEvent.change(within(dialog).getByLabelText("First day"), { target: { value: "2026-08-24" } });
    fireEvent.change(within(dialog).getByLabelText("Last day"), { target: { value: "2026-12-11" } });
    await user.type(within(dialog).getByLabelText("Timezone"), "Mars/Olympus");
    expect(within(dialog).getByRole("alert").textContent).toMatch(/timezone isn't recognized/);
    expect((within(dialog).getByRole("button", { name: "Save dates" }) as HTMLButtonElement).disabled).toBe(true);

    await user.clear(within(dialog).getByLabelText("Timezone"));
    await user.type(within(dialog).getByLabelText("Timezone"), "Pacific/Honolulu");
    await user.click(within(dialog).getByRole("button", { name: "Save dates" }));
    expect(download.disabled).toBe(false);
    await user.click(download);
    expect(created.at(-1)?.type).toMatch(/text\/calendar/);
    const text = await created.at(-1)!.text();
    expect(text).toContain("DTSTART;TZID=Pacific/Honolulu:");
    expect(text).toContain("SUMMARY:Work shift — Troy C.");
  });

  it("downloads a backup and a spreadsheet", async () => {
    const created: Blob[] = [];
    URL.createObjectURL = (b: Blob | MediaSource) => {
      created.push(b as Blob);
      return "blob:test";
    };
    const { user } = boot();
    await openShare(user);
    await user.click(screen.getByRole("button", { name: /save a backup file/i }));
    await user.click(screen.getByRole("button", { name: /download spreadsheet/i }));
    expect(created.map((b) => b.type)).toEqual(["application/json;charset=utf-8", "text/csv;charset=utf-8"]);
    const backup = JSON.parse(await created[0].text());
    expect(backup.students).toHaveLength(7);
    expect((await created[1].text()).split("\r\n")[0]).toBe("Student,Day,Start,End,Hours");
  });

  it("loads a backup only after asking, rejects junk kindly, and can be undone", async () => {
    const { user } = boot();
    const dialog = await openShare(user);
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;

    await user.upload(input, new File(["this is not json"], "junk.json", { type: "application/json" }));
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toMatch(/couldn't be loaded/));

    const good = { version: 1, settings: { openTime: 420, closeTime: 1020, minStaffPerSlot: 1, slotMinutes: 30, weeklyTargetHours: 19 }, students: [{ id: "z", name: "Zed", color: "#1F6FB2", preference: "any", daysPerWeek: 5, classText: "", busy: [], latestEnd: 1440, lunchStart: null, needsOpeningShift: false }], assignments: [], selectedStudentId: "z" };
    await user.upload(input, new File([JSON.stringify(good)], "backup.json", { type: "application/json" }));
    const confirm = await screen.findByRole("dialog", { name: /replace your schedule with this backup/i });
    expect(confirm.textContent).toMatch(/1 students/);
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Zed")).toBeNull();

    await user.upload(input, new File([JSON.stringify(good)], "backup.json", { type: "application/json" }));
    await user.click(within(await screen.findByRole("dialog", { name: /replace your schedule/i })).getByRole("button", { name: /yes, load it/i }));
    expect(screen.getByRole("button", { name: /^Zed/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /^undo/i }));
    expect(screen.getByRole("button", { name: /^Troy C\./ })).toBeTruthy();
  });
});

describe("other times a student can't work", () => {
  // Adds a student "Noa K." through the real form, with the given "other times they can't work".
  async function addNoa(user: ReturnType<typeof userEvent.setup>, blocked: string) {
    await user.click(screen.getByRole("button", { name: "Add student" }));
    const dialog = screen.getByRole("dialog", { name: /add a student/i });
    await user.type(within(dialog).getByLabelText(/student's name/i), "Noa K.");
    const box = within(dialog).getByLabelText(/any other times they can't work/i);
    await user.click(box);
    await user.paste(blocked);
    return dialog;
  }

  it("is checked live and blocks saving on a bad line", async () => {
    const { user } = boot();
    const dialog = await addNoa(user, "W 2:00pm-4:00pm\nsome nonsense");
    expect(within(dialog).getByText("Times they can't work")).toBeTruthy();
    expect(within(dialog).getByText(/1 of 2 lines, 1 need fixing/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Add student" }));
    expect(screen.getByRole("dialog", { name: /add a student/i })).toBeTruthy();
    expect(within(dialog).getAllByRole("alert").some((a) => /Fix or delete the lines/.test(a.textContent ?? ""))).toBe(true);
  });

  it("keeps the student out of those times and says 'unavailable', not 'has class'", async () => {
    const { user } = boot();
    await addNoa(user, "W 2:00pm-4:00pm");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add student" }));
    const box = cell(/^Wednesday 2:00pm to 2:30pm/);
    expect(box.getAttribute("aria-label")).toMatch(/Noa K\. is unavailable on Wed at this time/);
    expect(box.getAttribute("aria-disabled")).toBe("true");
    expect(cell(/^Wednesday 4:00pm to 4:30pm/).getAttribute("aria-disabled")).toBeNull();
  });

  it("comes back when the student is edited", async () => {
    const { user } = boot();
    await user.click(screen.getByRole("button", { name: "Edit Leilani P." }));
    expect((screen.getByLabelText(/any other times they can't work/i) as HTMLTextAreaElement).value).toBe("W 2:00pm-4:00pm");
  });

  it("is used by the sample roster so the feature is easy to find", async () => {
    const { user } = boot();
    await user.click(screen.getByRole("button", { name: /^Leilani P\./ }));
    expect(cell(/^Wednesday 3:00pm to 3:30pm/).getAttribute("aria-label")).toMatch(/Leilani P\. is unavailable on Wed/);
  });
});

describe("days off in calendar files", () => {
  // Opens Save & share and fills in a Fall 2026 semester so calendar files can be made.
  async function openCalendar(user: ReturnType<typeof userEvent.setup>) {
    const dialog = await openShare(user);
    fireEvent.change(within(dialog).getByLabelText("First day"), { target: { value: "2026-08-24" } });
    fireEvent.change(within(dialog).getByLabelText("Last day"), { target: { value: "2026-12-11" } });
    await user.type(within(dialog).getByLabelText("Timezone"), "Pacific/Honolulu");
    return dialog;
  }

  it("adds, lists and removes days off, and rejects days outside the semester", async () => {
    const { user } = boot();
    const dialog = await openCalendar(user);
    const input = within(dialog).getByLabelText(/^Days off/);
    fireEvent.change(input, { target: { value: "2027-03-01" } });
    await user.click(within(dialog).getByRole("button", { name: "Add day off" }));
    expect(within(dialog).getByText(/outside the first and last day/)).toBeTruthy();

    fireEvent.change(input, { target: { value: "2026-11-26" } });
    await user.click(within(dialog).getByRole("button", { name: "Add day off" }));
    const list = within(dialog).getByRole("list", { name: "Days off" });
    expect(within(list).getByText("Thu, Nov 26, 2026")).toBeTruthy();

    await user.click(within(list).getByRole("button", { name: "Remove day off Thu, Nov 26, 2026" }));
    expect(within(dialog).queryByRole("list", { name: "Days off" })).toBeNull();
  });

  it("leaves the holiday out of the downloaded calendar file", async () => {
    const created: Blob[] = [];
    URL.createObjectURL = (b: Blob | MediaSource) => {
      created.push(b as Blob);
      return "blob:test";
    };
    const { user } = boot();
    await fillSchedule(user);
    const dialog = await openCalendar(user);
    fireEvent.change(within(dialog).getByLabelText(/^Days off/), { target: { value: "2026-11-26" } });
    await user.click(within(dialog).getByRole("button", { name: "Add day off" }));
    await user.click(within(dialog).getByRole("button", { name: "Save dates" }));
    await user.click(within(dialog).getByRole("button", { name: /download calendar file for kekoa m\./i }));
    const text = (await created.at(-1)!.text()).replace(/\r\n /g, "");
    // Kekoa works Thursdays, so those shifts skip Thanksgiving
    expect(text).toMatch(/EXDATE;TZID=Pacific\/Honolulu:20261126T\d{6}/);
  });
});

describe("schedule views", () => {
  it("switch between grid, by student and by day with the arrow keys", async () => {
    const { user } = boot();
    const tabs = screen.getByRole("tablist", { name: "Schedule views" });
    expect(within(tabs).getByRole("tab", { name: "Grid", selected: true })).toBeTruthy();
    within(tabs).getByRole("tab", { name: "Grid" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(within(tabs).getByRole("tab", { name: "By student", selected: true })).toBeTruthy();
    expect(screen.queryByRole("grid")).toBeNull();
    await user.keyboard("{ArrowRight}");
    expect(within(tabs).getByRole("tab", { name: "By day", selected: true })).toBeTruthy();
    await user.keyboard("{ArrowRight}");
    expect(within(tabs).getByRole("tab", { name: "Grid", selected: true })).toBeTruthy();
    expect(screen.getByRole("grid")).toBeTruthy();
  });

  it("'By student' shows each person's shifts in words", async () => {
    const { user } = boot();
    await user.click(screen.getByRole("tab", { name: "By student" }));
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("Troy C.")).toBeTruthy();
    expect(within(panel).getAllByText("8:00am–12:00pm (4 hours)").length).toBe(2); // Mon and Wed
    expect(within(panel).getAllByText("No shifts yet.").length).toBe(6);
  });

  it("'By day' lists every open day (Monday to Saturday) and says when nobody works", async () => {
    const { user } = boot();
    await user.click(screen.getByRole("tab", { name: "By day" }));
    const panel = screen.getByRole("tabpanel");
    for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]) expect(within(panel).getByRole("heading", { name: day })).toBeTruthy();
    expect(within(panel).getAllByText("Nobody scheduled.").length).toBe(3); // Tuesday, Thursday and Saturday
  });

  it("copies the schedule as text, and explains kindly if the browser refuses", async () => {
    const { user } = boot();
    await user.click(screen.getByRole("tab", { name: "By student" }));
    const spy = vi.spyOn(navigator.clipboard, "writeText");
    await user.click(screen.getByRole("button", { name: /copy as text/i }));
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain("Troy C. (19 hours a week)");
    expect(spy.mock.calls[0][0]).toContain("  Mon  8:00am–12:00pm (4 hours)");
    await waitFor(() => expect(toast().textContent).toMatch(/Copied\./));

    spy.mockRejectedValueOnce(new Error("blocked"));
    await user.click(screen.getByRole("button", { name: /copy as text/i }));
    await waitFor(() => expect(toast().textContent).toMatch(/wouldn't allow copying/));
  });

  it("prints from a word view", async () => {
    const { user } = boot();
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    await user.click(screen.getByRole("tab", { name: "By day" }));
    await user.click(screen.getByRole("button", { name: "Print" }));
    expect(print).toHaveBeenCalledOnce();
    expect(document.querySelector(".print-area")).toBeTruthy();
    print.mockRestore();
  });

  it("shows a friendly empty state and disables copy and print", async () => {
    const { user } = boot();
    await openShare(user);
    await user.click(screen.getByRole("button", { name: /clear everything/i }));
    await user.click(screen.getByRole("button", { name: /yes, clear everything/i }));
    await user.click(screen.getByRole("tab", { name: "By student" }));
    expect(screen.getByText("Add a student first.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /copy as text/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Print" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("have no accessibility violations", async () => {
    const { user } = boot();
    await user.click(screen.getByRole("tab", { name: "By student" }));
    expect(await violations()).toEqual([]);
    await user.click(screen.getByRole("tab", { name: "By day" }));
    expect(await violations()).toEqual([]);
  });
});

describe("adding several students at once", () => {
  // Opens the "Add several at once" dialog and returns it.
  async function openBulk(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Add several at once" }));
    return screen.getByRole("dialog", { name: /add several students at once/i });
  }

  it("previews every line, adds the good ones in one go, and is one undo step", async () => {
    const { user } = boot();
    const dialog = await openBulk(user);
    expect(document.activeElement).toBe(within(dialog).getByLabelText(/one student per line/i));
    const add = within(dialog).getByRole("button", { name: "Add students" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);

    await user.click(within(dialog).getByLabelText(/one student per line/i));
    await user.paste("Noa K.: MWF 9:00am-9:50am; TTh 1:00pm-2:15pm\nKai P.: MW 1:00pm-2:15pm\nMWF 10:00-10:50");
    expect(within(dialog).getByText(/2 of 3 lines, 1 will be skipped/)).toBeTruthy();
    expect(within(dialog).getByText(/Put the name first, then a colon/)).toBeTruthy();
    expect(within(dialog).getByText(/5 class times/)).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "Add 2 students" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /^Noa K\./ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Kai P\./ })).toBeTruthy();
    expect(toast().textContent).toMatch(/Added 2 students\. Press Fill schedule for me/);

    await user.click(screen.getByRole("button", { name: /^undo/i }));
    expect(screen.queryByRole("button", { name: /^Noa K\./ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Kai P\./ })).toBeNull();
  });

  it("gives the new students working class times, so they are kept out of those hours", async () => {
    const { user } = boot();
    const dialog = await openBulk(user);
    await user.click(within(dialog).getByLabelText(/one student per line/i));
    await user.paste("Noa K.: MWF 9:00am-9:50am");
    await user.click(within(dialog).getByRole("button", { name: "Add 1 student" }));
    await user.click(screen.getByRole("button", { name: /^Noa K\./ }));
    expect(cell(/^Monday 9:00am to 9:30am/).getAttribute("aria-label")).toMatch(/Noa K\. has class on Mon/);
  });

  it("offers an example and can add nobody when every line is bad", async () => {
    const { user } = boot();
    const dialog = await openBulk(user);
    await user.click(within(dialog).getByRole("button", { name: /fill in an example/i }));
    expect(within(dialog).getByText(/3 of 3 lines/)).toBeTruthy();
    await user.clear(within(dialog).getByLabelText(/one student per line/i));
    await user.click(within(dialog).getByLabelText(/one student per line/i));
    await user.paste("MWF 9:00-9:50");
    expect((within(dialog).getByRole("button", { name: "Add students" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("closes with Escape and returns focus to where it was", async () => {
    const { user } = boot();
    await openBulk(user);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add several at once" }));
  });

  it("has no accessibility violations", async () => {
    const { user } = boot();
    const dialog = await openBulk(user);
    await user.click(within(dialog).getByRole("button", { name: /fill in an example/i }));
    expect(await violations()).toEqual([]);
  });
});

describe("quick fixes for empty times", () => {
  // The "Schedule health" panel on the right.
  const panel = () => document.querySelector("#insights-heading")!.closest("section") as HTMLElement;

  it("offers one-click buttons for students who can really cover a gap", () => {
    boot();
    const buttons = within(panel()).getAllByRole("button", { name: /^Add .* to Tue 7:00am–11:00am/ });
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    expect(buttons.length).toBeLessThanOrEqual(3);
    // Leilani is free the whole stretch and has no hours yet, so she is offered first
    expect(buttons[0].textContent).toContain("Leilani P.");
    // Monday 7–8am is only 1 hour and Troy is at his limit, so nobody can take it as a full shift
    expect(within(panel()).queryByRole("button", { name: /^Add .* to Mon 7:00am–8:00am/ })).toBeNull();
  });

  it("fills the gap in one click, explains what happened, and can be undone", async () => {
    const { user } = boot();
    await user.click(within(panel()).getByRole("button", { name: /^Add Leilani P\. to Tue 7:00am–11:00am/ }));
    expect(toast().textContent).toBe("Added 8 slots on Tue 7:00am–11:00am.");
    expect(cell(/^Tuesday 7:00am to 7:30am/).getAttribute("aria-label")).toMatch(/Working: Leilani P\./);
    expect(within(panel()).queryByRole("button", { name: /^Add .* to Tue 7:00am–11:00am/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: /^undo/i }));
    expect(cell(/^Tuesday 7:00am to 7:30am/).getAttribute("aria-label")).toMatch(/Nobody is working/);
  });

  it("says when someone can only take part of a gap", async () => {
    const { user } = boot();
    // Two people are needed at once, so most gaps are 1 person short and several students are partly free
    await user.click(screen.getByRole("button", { name: "2" }));
    const partial = within(panel()).getAllByRole("button", { name: /hours? of \d+(\.\d+)? hours?/ });
    expect(partial.length).toBeGreaterThan(0);
  });

  it("falls back to a plain reason when nobody is free", async () => {
    const { user } = boot();
    await openShare(user);
    await user.click(screen.getByRole("button", { name: /clear everything/i }));
    await user.click(screen.getByRole("button", { name: /yes, clear everything/i }));
    expect(within(panel()).queryByRole("button", { name: /^Add / })).toBeNull();
  });
});

describe("rules dialog", () => {
  it("changes the weekly hours, and rejects nonsense", async () => {
    const { user } = boot();
    await user.click(screen.getByRole("button", { name: "Rules" }));
    const dialog = screen.getByRole("dialog", { name: "Rules" });
    const hours = within(dialog).getByLabelText(/most hours a student can work/i);
    await user.clear(hours);
    await user.type(hours, "abc");
    expect(within(dialog).getByRole("alert").textContent).toMatch(/Type a number of hours/);
    expect((within(dialog).getByRole("button", { name: "Save rules" }) as HTMLButtonElement).disabled).toBe(true);
    await user.clear(hours);
    await user.type(hours, "20");
    await user.click(within(dialog).getByRole("button", { name: "Save rules" }));
    expect(screen.getAllByText(/of 20 hours/).length).toBeGreaterThan(0);
  });
});

describe("Settings: office hours, days open and text size", () => {
  /** Opens the collapsed Settings row under the header. */
  async function openSettings(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /^Settings/ }));
    return within(document.getElementById("plan-options")!);
  }

  it("offers the four office-hours choices and changes the grid's rows", async () => {
    const { user } = boot();
    const settings = await openSettings(user);
    const hours = settings.getByRole("group", { name: "Office hours" });
    expect(within(hours).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "7:00am–12:00am",
      "7:00am–5:00pm",
      "8:00am–12:00am",
      "8:00am–5:00pm",
    ]);
    expect(within(hours).getByRole("button", { name: "7:00am–12:00am" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(hours).getByRole("button", { name: "8:00am–5:00pm" }));
    expect(within(screen.getByRole("grid")).queryByRole("button", { name: /^Monday 7:00am to 7:30am/ })).toBeNull();
    expect(within(screen.getByRole("grid")).queryByRole("button", { name: /^Monday 5:00pm to 5:30pm/ })).toBeNull();
    expect(within(screen.getByRole("grid")).getByRole("button", { name: /^Monday 4:30pm to 5:00pm/ })).toBeTruthy();
  });

  it("shows Saturday only when the office is open on Saturdays", async () => {
    const { user } = boot();
    const grid = () => within(screen.getByRole("grid"));
    expect(grid().getByRole("button", { name: /^Saturday 7:00am to 7:30am/ })).toBeTruthy();
    const settings = await openSettings(user);
    await user.click(within(settings.getByRole("group", { name: "Days open" })).getByRole("button", { name: "Mon–Fri" }));
    expect(grid().queryByRole("button", { name: /^Saturday/ })).toBeNull();
    expect(grid().getAllByRole("button")).toHaveLength(170); // 5 days x 34 half hours
  });

  it("makes the text bigger or smaller, and remembers it in this browser", async () => {
    const { user } = boot();
    const settings = await openSettings(user);
    await user.click(within(settings.getByRole("group", { name: "Text size" })).getByRole("button", { name: "Extra large" }));
    expect(document.documentElement.style.fontSize).toBe("125%");
    expect(window.localStorage.getItem("shiftfit:text-size")).toBe("xlarge");
    await user.click(within(settings.getByRole("group", { name: "Text size" })).getByRole("button", { name: "Small" }));
    expect(document.documentElement.style.fontSize).toBe("87.5%");
  });
});

describe("rules dialog: break limit and shortest shift", () => {
  it("saves a new break hour limit and shows it when switching to Break", async () => {
    const { user } = boot();
    await user.click(screen.getByRole("button", { name: "Rules" }));
    const dialog = screen.getByRole("dialog", { name: "Rules" });
    const breakHours = within(dialog).getByLabelText(/weekly hour limit during a break/i);
    await user.clear(breakHours);
    await user.type(breakHours, "100");
    expect(within(dialog).getByRole("alert").textContent).toMatch(/between 1 and 40/);
    expect((within(dialog).getByRole("button", { name: "Save rules" }) as HTMLButtonElement).disabled).toBe(true);
    await user.clear(breakHours);
    await user.type(breakHours, "30");
    await user.selectOptions(within(dialog).getByLabelText(/shortest shift allowed/i), "1");
    await user.click(within(dialog).getByRole("button", { name: "Save rules" }));
    await user.click(screen.getByRole("button", { name: "Break" }));
    expect(screen.getAllByText(/up to 30 hours a week/).length).toBeGreaterThan(0);
  });
});

describe("office hours and people needed", () => {
  it("switching to 8am hides the 7am row but never changes anyone's hours", async () => {
    const { user } = boot();
    expect(screen.getByRole("row", { name: /7:00am/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "8:00am–12:00am" }));
    expect(screen.queryByRole("row", { name: /^7:00am/ })).toBeNull();
    expect(screen.getByText("Has their 7:00am opening shift", { exact: false })).toBeTruthy();
    expect(screen.getAllByText(/At their hours/)).toHaveLength(1);
  });

  it("needing 2 people turns half-staffed boxes pink and says how many", async () => {
    const { user } = boot();
    await fillSchedule(user);
    await user.click(screen.getByRole("button", { name: "2" }));
    expect(banner().textContent).toMatch(/still need someone/);
    expect(screen.getAllByText(/Need 1/).length).toBeGreaterThan(0);
  });
});

describe("safety nets", () => {
  it("warns loudly when the browser refuses to save", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    boot({ welcomed: false });
    spy.mockRestore();
    expect(screen.getByRole("alert").textContent).toMatch(/won't let Cadence save automatically/);
  });

  it("warns when another tab saved, instead of silently overwriting it later", async () => {
    boot();
    expect(screen.queryByText(/changed in another tab/)).toBeNull();
    fireEvent(window, new StorageEvent("storage", { key: "shiftfit:state" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/changed in another tab or window/);
    expect(screen.getByRole("button", { name: /reload to get the latest/i })).toBeTruthy();
  });

  it("ignores storage changes that aren't ours", () => {
    boot();
    fireEvent(window, new StorageEvent("storage", { key: "some-other-site-key" }));
    expect(screen.queryByText(/changed in another tab/)).toBeNull();
  });

  it("survives corrupted saved data by starting fresh", () => {
    window.localStorage.setItem("shiftfit:state", '{"version":1,"students":"lol"}');
    window.localStorage.setItem("shiftfit:welcomed", "1");
    render(<App />);
    expect(screen.getByRole("button", { name: /^Troy C\./ })).toBeTruthy();
  });

  it("restores exactly what was saved after a reload", async () => {
    const { user, unmount } = boot();
    await fillSchedule(user);
    unmount();
    render(<App />);
    expect(banner().textContent).toMatch(/Looks great/);
  });
});

describe("phone layout", () => {
  it("shows one day at a time with day buttons, and section tabs", async () => {
    viewport.width = 400;
    const { user } = boot();
    expect(screen.getByRole("navigation", { name: "Sections" })).toBeTruthy();
    const days = screen.getByRole("group", { name: "Choose a day" });
    expect(within(screen.getByRole("grid")).getAllByRole("columnheader")).toHaveLength(2); // time + one day
    await user.click(within(days).getByRole("button", { name: "Wed" }));
    expect(within(screen.getByRole("grid")).getAllByRole("button")[0].getAttribute("aria-label")).toMatch(/^Wednesday/);
    expect(screen.getByRole("button", { name: /Health/ })).toBeTruthy();
  });

  it("picking a student jumps to the schedule", async () => {
    viewport.width = 400;
    const { user } = boot();
    await user.click(screen.getByRole("button", { name: /^Students/ }));
    await user.click(screen.getByRole("button", { name: /^Leilani P\./ }));
    expect(screen.getByRole("button", { name: /^Schedule/ }).getAttribute("aria-current")).toBe("page");
  });
});

describe("theme", () => {
  it("switches between auto, light and dark", async () => {
    const { user } = boot();
    await user.click(screen.getByRole("button", { name: "Dark" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    await user.click(screen.getByRole("button", { name: "Light" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    await user.click(screen.getByRole("button", { name: "Auto" }));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});

describe("audit round 3 fixes", () => {
  it("refuses an oversized backup without reading it into memory", async () => {
    const { user } = boot();
    const dialog = await openShare(user);
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    const huge = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "huge.json", { type: "application/json" });
    const read = vi.spyOn(huge, "text");
    await user.upload(input, huge);
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toMatch(/too big to be a Cadence backup/));
    expect(read).not.toHaveBeenCalled();
  });

  it("asks before the tab is closed while saving is broken, and not otherwise", () => {
    boot();
    const normal = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(normal);
    expect(normal.defaultPrevented).toBe(false);

    cleanup();
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    try {
      boot({ welcomed: false }); // (boot itself would write "welcomed" to storage, which is what we are breaking)
    } finally {
      spy.mockRestore();
    }
    const risky = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(risky);
    expect(risky.defaultPrevented).toBe(true);
  });

  it("outlines the health panel when the banner sends you there, then stops", async () => {
    const { user } = boot();
    // The "Schedule health" panel on the right.
  const panel = () => document.querySelector("#insights-heading")!.closest<HTMLElement>('[tabindex="-1"]')!;
    expect(panel().className).not.toMatch(/ring-accent/);
    await user.click(within(banner()).getByRole("button", { name: /see who is free/i }));
    await waitFor(() => expect(panel().className).toMatch(/ring-accent/));
    await waitFor(() => expect(panel().className).not.toMatch(/ring-accent/), { timeout: 3000 });
  });
});

/* Automated accessibility rules (WCAG 2 A/AA). Colour contrast needs real rendering, so it
   is checked separately from the design tokens in contrast.test.ts. */
async function violations(): Promise<string[]> {
  const result = await axe.run(document.body, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    rules: { "color-contrast": { enabled: false } },
  });
  return result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.html.slice(0, 120)}`);
}

describe("accessibility rules", () => {
  it("the checker itself really catches problems (so 'no violations' means something)", async () => {
    boot();
    const bad = document.createElement("div");
    bad.innerHTML = '<button></button><img src="x.png"><input type="text">';
    document.body.appendChild(bad);
    const found = await violations();
    bad.remove();
    expect(found.map((f) => f.split(":")[0]).sort()).toEqual(expect.arrayContaining(["button-name", "image-alt", "label"]));
  });

  it("main screen has no violations", async () => {
    boot();
    expect(await violations()).toEqual([]);
  });

  it("main screen after filling has no violations", async () => {
    const { user } = boot();
    await fillSchedule(user);
    expect(await violations()).toEqual([]);
  });

  it("welcome dialog has no violations", async () => {
    boot({ welcomed: false });
    expect(await violations()).toEqual([]);
  });

  it("add-student dialog (with errors showing) has no violations", async () => {
    const { user } = boot();
    await user.click(screen.getByRole("button", { name: "Add student" }));
    await user.click(screen.getByLabelText(/when does this student have class/i));
    await user.paste("MWF 9:00-9:50\nnonsense");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add student" }));
    expect(await violations()).toEqual([]);
  });

  it.each(["Help", "Save & share", "Rules"])("%s dialog has no violations", async (name) => {
    const { user } = boot();
    if (name === "Save & share") await openShare(user);
    else await user.click(screen.getByRole("button", { name }));
    expect(await violations()).toEqual([]);
  });

  it("phone layout has no violations", async () => {
    viewport.width = 400;
    boot();
    expect(await violations()).toEqual([]);
  });

  it("every button and field has a name a screen reader can read", () => {
    boot();
    // a role query with a name pattern only matches elements whose computed accessible name is non-empty
    for (const role of ["button", "textbox", "searchbox", "combobox", "checkbox", "tab"] as const) {
      expect(screen.queryAllByRole(role, { name: /./ }).length, role).toBe(screen.queryAllByRole(role).length);
    }
  });
});

describe("paste existing shifts", () => {
  it("previews the pasted lines, then places them as one undoable step", async () => {
    const { user } = boot();
    await user.click(screen.getByRole("button", { name: /paste existing shifts/i }));
    const dialog = screen.getByRole("dialog", { name: /paste shifts you already have/i });
    expect((within(dialog).getByRole("button", { name: "Add shifts" }) as HTMLButtonElement).disabled).toBe(true);

    await user.type(within(dialog).getByLabelText("One student per line"), "Leilani P.: M 8:00am-9:00am{Enter}Nobody: M 8:00am-9:00am");
    expect(dialog.textContent).toMatch(/1 of 2 lines, 1 will be skipped/);
    expect(dialog.textContent).toMatch(/No student named "Nobody"/);

    await user.click(within(dialog).getByRole("button", { name: "Add 1 shift" }));
    expect(screen.queryByRole("dialog", { name: /paste shifts/i })).toBeNull();
    expect(toast().textContent).toMatch(/Added 1 hour of pasted shifts/);
    expect(cell(/^Monday 8:00am to 8:30am/).getAttribute("aria-label")).toMatch(/Leilani P\./);
  });
});

describe("student photos", () => {
  const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD";

  // jsdom can't really decode or draw pictures, so this swaps in stand-ins that "shrink" any photo to a fixed tiny JPEG.
  function fakeImagePipeline() {
    (globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = async () => ({ width: 400, height: 300, close() {} });
    HTMLCanvasElement.prototype.getContext = (() => ({ fillRect() {}, drawImage() {}, fillStyle: "" })) as never;
    HTMLCanvasElement.prototype.toDataURL = (() => JPEG) as never;
  }

  // Opens the edit form for the demo student Troy C. and returns it.
  async function openEditor(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Edit Troy C." }));
    return screen.getByRole("dialog", { name: /edit troy c\./i });
  }

  it("refuses a file that is not a photo or is over 5 MB, and says why", async () => {
    const { user } = boot();
    const dialog = await openEditor(user);
    const input = within(dialog).getByLabelText("Choose a photo file", { selector: "input" }) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "notes.pdf", { type: "application/pdf" })] } });
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toMatch(/PNG, JPG or WebP/));
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" })] } });
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toMatch(/bigger than 5 MB/));
    expect(within(dialog).queryByRole("button", { name: "Remove photo" })).toBeNull();
  });

  it("keeps the LAST photo chosen even when an earlier, slower one finishes after it", async () => {
    const A = "data:image/jpeg;base64,/9j/AAAA";
    const B = "data:image/jpeg;base64,/9j/BBBB";
    const finish: Record<string, () => void> = {};
    let lastDrawn = "";
    (globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = (file: File) =>
      new Promise((resolve) => {
        finish[file.name] = () => resolve({ width: 100, height: 100, close() {}, tag: file.name });
      });
    HTMLCanvasElement.prototype.getContext = (() => ({ fillRect() {}, drawImage(b: { tag: string }) { lastDrawn = b.tag; }, fillStyle: "" })) as never;
    HTMLCanvasElement.prototype.toDataURL = (() => (lastDrawn === "slow.png" ? A : B)) as never;

    const { user } = boot();
    const dialog = await openEditor(user);
    const input = within(dialog).getByLabelText("Choose a photo file", { selector: "input" }) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "slow.png", { type: "image/png" })] } });
    fireEvent.change(input, { target: { files: [new File(["x"], "fast.png", { type: "image/png" })] } });
    finish["fast.png"]();
    await waitFor(() => expect(dialog.querySelector(`img[src="${B}"]`)).toBeTruthy());
    finish["slow.png"]();
    await new Promise((r) => setTimeout(r, 30));
    expect(dialog.querySelector(`img[src="${B}"]`)).toBeTruthy();
    expect(dialog.querySelector(`img[src="${A}"]`)).toBeNull();
  });

  it("saves a chosen photo onto the student's card, and Remove photo takes it off again", async () => {
    fakeImagePipeline();
    const { user } = boot();
    let dialog = await openEditor(user);
    const input = within(dialog).getByLabelText("Choose a photo file", { selector: "input" }) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "me.png", { type: "image/png" })] } });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Change photo" })).toBeTruthy());
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(document.querySelector(`img[src="${JPEG}"]`)).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem("shiftfit:state")!).students[0].avatar).toBe(JPEG);

    dialog = await openEditor(user);
    await user.click(within(dialog).getByRole("button", { name: "Remove photo" }));
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(document.querySelector(`img[src="${JPEG}"]`)).toBeNull();
  });
});

describe("a student's breaks", () => {
  it("starts with a noon break, lets the manager pick times and lengths, and saves them", async () => {
    const { user } = boot();
    await user.click(screen.getByRole("button", { name: "Add student" }));
    const dialog = screen.getByRole("dialog", { name: /add a student/i });
    await user.type(within(dialog).getByLabelText(/student's name/i), "Ana B.");

    // The usual lunch is already there: 12:00pm for 30 minutes.
    expect((within(dialog).getByLabelText("Break 1 starts at") as HTMLSelectElement).value).toBe("720");
    expect((within(dialog).getByLabelText("and lasts") as HTMLSelectElement).value).toBe("30");
    expect(within(dialog).queryByText(/lunch/i)).toBeNull();

    // A second, shorter break in the afternoon.
    await user.click(within(dialog).getByRole("button", { name: /add a break/i }));
    await user.selectOptions(within(dialog).getByLabelText("Break 2 starts at"), String(15 * 60));
    await user.selectOptions(within(dialog).getAllByLabelText("and lasts")[1], "15");
    expect(within(dialog).getByText("3:00pm–3:15pm")).toBeTruthy();

    // Remove the first one, then save.
    await user.click(within(dialog).getByRole("button", { name: "Remove break 1" }));
    expect(within(dialog).queryByLabelText("Break 2 starts at")).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Add student" }));

    // Reopen the student: the one 3:00pm break was kept.
    await user.click(screen.getByRole("button", { name: /edit ana b\./i }));
    const edit = screen.getByRole("dialog");
    expect((within(edit).getByLabelText("Break 1 starts at") as HTMLSelectElement).value).toBe(String(15 * 60));
    expect((within(edit).getByLabelText("and lasts") as HTMLSelectElement).value).toBe("15");
  });

  it("allows at most three breaks", async () => {
    const { user } = boot();
    await user.click(screen.getByRole("button", { name: "Add student" }));
    const dialog = screen.getByRole("dialog", { name: /add a student/i });
    await user.click(within(dialog).getByRole("button", { name: /add a break/i }));
    await user.click(within(dialog).getByRole("button", { name: /add a break/i }));
    expect(within(dialog).getByLabelText("Break 3 starts at")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /add a break/i })).toBeNull();
  });
});
