import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportPanel } from "../components/import/ImportPanel";
import { MeetingReview } from "../components/import/MeetingReview";
import { parseClassText } from "../features/scheduling/parser";
import { readScreenshot, readScreenshotEnhanced } from "../features/import/ocr/screenshot-reader";
import { isEnhancedReadingAvailable } from "../features/import/ocr/enhanced-reader";
import { signOutManager } from "../services/automation/managerSession";

/**
 * Screen tests for reading a screenshot in the student form (`ImportPanel.tsx`). The real readers need
 * a real browser (Tesseract) or the internet (OCR.space), so here they are replaced with stand-ins that
 * answer straight away. That lets these tests check what the PERSON sees: progress, the class times
 * landing in the box for review, and when "Try enhanced reading" appears.
 */

vi.mock("../features/import/ocr/screenshot-reader", () => ({
  readScreenshot: vi.fn(),
  readScreenshotEnhanced: vi.fn(),
}));
vi.mock("../features/import/ocr/enhanced-reader", () => ({
  isEnhancedReadingAvailable: vi.fn(),
  enhancedReaderBaseUrl: () => "",
}));

const reading = (classText: string, lowConfidence = false) => ({
  ok: true as const,
  reading: { classText, linesFound: classText ? classText.split("\n").length : 0, lowConfidence },
});

/** The class-times box plus the review list under it, like the real student form. */
function Form({ initial = "" }: { initial?: string }) {
  const [classText, setClassText] = useState(initial);
  return (
    <>
      <ImportPanel classText={classText} onClassTextChange={setClassText} onExtracted={() => {}} />
      <MeetingReview parse={parseClassText(classText)} />
    </>
  );
}

const screenshot = () => new File(["fake picture"], "schedule.png", { type: "image/png" });
const box = () => screen.getByLabelText(/when does this student have class/i) as HTMLTextAreaElement;

/** Picks a screenshot with the hidden file chooser behind "Use a screenshot instead". */
async function chooseScreenshot() {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  await act(async () => {
    fireEvent.change(input, { target: { files: [screenshot()] } });
  });
}

beforeEach(() => {
  vi.mocked(isEnhancedReadingAvailable).mockResolvedValue(false);
});
afterEach(() => {
  vi.mocked(readScreenshot).mockReset();
  vi.mocked(readScreenshotEnhanced).mockReset();
  signOutManager();
});

describe("reading a screenshot in the student form", () => {
  it("offers a screenshot button even with no server, since reading happens in this browser", () => {
    render(<Form />);
    expect(screen.getByRole("button", { name: /use a screenshot instead/i })).toBeTruthy();
    expect(screen.queryByText(/isn't set up here/i)).toBeNull();
  });

  it("shows progress while reading, then puts the class times in the box for review", async () => {
    let finish: (value: ReturnType<typeof reading>) => void = () => {};
    vi.mocked(readScreenshot).mockImplementation((_file, onProgress) => {
      onProgress({ label: "Reading the screenshot…", fraction: 0.5 });
      return new Promise((resolve) => (finish = resolve));
    });
    render(<Form />);
    await chooseScreenshot();
    expect(screen.getByText(/reading the screenshot… 50%/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /use a different screenshot/i })).toHaveProperty("disabled", true);

    await act(async () => finish(reading("MWF 9:00 AM-9:50 AM\nTTh 1:00 PM-2:15 PM")));
    expect(box().value).toBe("MWF 9:00 AM-9:50 AM\nTTh 1:00 PM-2:15 PM");
    expect(screen.getByText(/found 2 class times/i)).toBeTruthy();
    expect(screen.getByText(/2 of 2 lines/)).toBeTruthy(); // the review list checked both lines
  });

  it("reads a screenshot pasted straight into the box, and still lets text be pasted normally", async () => {
    vi.mocked(readScreenshot).mockResolvedValue(reading("MWF 9:00-9:50"));
    render(<Form />);
    await act(async () => {
      fireEvent.paste(box(), { clipboardData: { files: [screenshot()] } });
    });
    expect(readScreenshot).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(box().value).toBe("MWF 9:00-9:50"));

    fireEvent.paste(box(), { clipboardData: { files: [] } });
    expect(readScreenshot).toHaveBeenCalledTimes(1);
  });

  it("keeps what the person typed, and a second reading replaces the first instead of doubling it", async () => {
    vi.mocked(readScreenshot).mockResolvedValueOnce(reading("MWF 9:O0-9:50")).mockResolvedValueOnce(reading("MWF 9:00-9:50"));
    render(<Form initial="TTh 1:00pm-2:15pm" />);
    await chooseScreenshot();
    expect(box().value).toBe("TTh 1:00pm-2:15pm\nMWF 9:O0-9:50");
    await chooseScreenshot();
    expect(box().value).toBe("TTh 1:00pm-2:15pm\nMWF 9:00-9:50");
  });

  it("adds the result to what is in the box when reading FINISHES, so typing meanwhile isn't lost", async () => {
    let finish: (value: ReturnType<typeof reading>) => void = () => {};
    vi.mocked(readScreenshot).mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    render(<Form />);
    await chooseScreenshot();
    fireEvent.change(box(), { target: { value: "TTh 1:00pm-2:15pm" } }); // typed while the reader works
    await act(async () => finish(reading("MWF 9:00-9:50")));
    expect(box().value).toBe("TTh 1:00pm-2:15pm\nMWF 9:00-9:50");
  });

  it("says plainly when nothing was found or the picture couldn't be read", async () => {
    vi.mocked(readScreenshot).mockResolvedValueOnce(reading("", true)).mockResolvedValueOnce({ ok: false, error: "That file couldn't be opened as a picture." });
    render(<Form />);
    await chooseScreenshot();
    expect(screen.getByText(/no class times were found/i)).toBeTruthy();
    await chooseScreenshot();
    expect(screen.getByText(/couldn't be opened as a picture/i)).toBeTruthy();
    expect(box().value).toBe("");
  });
});

describe("Try enhanced reading", () => {
  it("stays hidden when the server hasn't switched it on (for example on GitHub Pages)", async () => {
    vi.mocked(readScreenshot).mockResolvedValue(reading("MWF 9:00-9:50", true));
    render(<Form />);
    await chooseScreenshot();
    expect(screen.queryByRole("button", { name: /try enhanced reading/i })).toBeNull();
  });

  it("appears after a reading when it is on, says where the picture goes, and needs the manager passcode", async () => {
    vi.mocked(isEnhancedReadingAvailable).mockResolvedValue(true);
    vi.mocked(readScreenshot).mockResolvedValue(reading("MWF 9:O0-9:50", true));
    render(<Form />);
    await waitFor(() => expect(isEnhancedReadingAvailable).toHaveBeenCalled());
    await chooseScreenshot();
    const button = await screen.findByRole("button", { name: /try enhanced reading/i });
    expect(button).toHaveProperty("disabled", true); // not signed in yet
    expect(screen.getByText(/sends this screenshot to OCR.space/i)).toBeTruthy();
    expect(screen.getByText(/check them carefully/i)).toBeTruthy(); // the low-confidence hint
    expect(screen.getByLabelText(/manager passcode/i)).toBeTruthy();
    expect(readScreenshotEnhanced).not.toHaveBeenCalled(); // never sent without a click
  });

  it("after signing in, replaces the first reading with the enhanced one", async () => {
    vi.mocked(isEnhancedReadingAvailable).mockResolvedValue(true);
    vi.mocked(readScreenshot).mockResolvedValue(reading("MWF 9:O0-9:50", true));
    vi.mocked(readScreenshotEnhanced).mockResolvedValue(reading("MWF 9:00-9:50"));
    // The sign-in box asks the server whether the passcode is right; this stands in for a "yes".
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true })));
    try {
      render(<Form />);
      await waitFor(() => expect(isEnhancedReadingAvailable).toHaveBeenCalled());
      await chooseScreenshot();
      fireEvent.change(screen.getByLabelText(/manager passcode/i), { target: { value: "correct-horse-battery" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
      });
      const button = await screen.findByRole("button", { name: /try enhanced reading/i });
      await waitFor(() => expect(button).toHaveProperty("disabled", false));
      await act(async () => {
        fireEvent.click(button);
      });
      expect(readScreenshotEnhanced).toHaveBeenCalledTimes(1);
      expect(box().value).toBe("MWF 9:00-9:50");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
