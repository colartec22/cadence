import { useEffect, useRef, useState } from "react";
import { ImageUp, Sparkles, Wand2 } from "lucide-react";
import { Button } from "../ui/Button";
import { LogoLoader } from "../ui/LogoLoader";
import { HelpTip } from "../help/HelpTip";
import { ManagerSignIn } from "../app-shell/ManagerSignIn";
import { useManagerSession } from "../../hooks/useManagerSession";
import { extractSchedule, isRemoteExtractionAvailable } from "../../features/import/schedule-extractor";
import type { ExtractionOutcome } from "../../features/import/schedule-extractor";
import { readScreenshot, readScreenshotEnhanced } from "../../features/import/ocr/screenshot-reader";
import type { ScreenshotReading } from "../../features/import/ocr/screenshot-reader";
import type { ReadingProgress } from "../../features/import/ocr/tesseract-reader";
import { enhancedReaderBaseUrl, isEnhancedReadingAvailable } from "../../features/import/ocr/enhanced-reader";

const EXAMPLE = "MWF 9:00-9:50\nTTh 1:00pm-2:15pm";

/**
 * Which server reader "Try enhanced reading" uses: OCR.space through the Cadence server when that is
 * switched on, otherwise the n8n AI reader when one is configured, otherwise none (button hidden).
 */
type EnhancedMode = "ocr" | "ai" | null;

/**
 * Where class times go. Typing or pasting is checked instantly by the parent (no button needed).
 *
 * A screenshot (chosen, or pasted with Ctrl+V into the box) is read right here in the browser, and the
 * class times found are added to the box, where the parent's "Here is what Cadence understood" list
 * checks every line. The person fixes anything wrong before saving, so reading mistakes never slip in.
 * If the reading was poor, "Try enhanced reading" sends the picture to a server reader instead, but
 * only when one is set up, only for a signed-in manager, and only when they click it.
 */
export function ImportPanel({
  classText,
  onClassTextChange,
  onExtracted,
}: {
  classText: string;
  onClassTextChange: (text: string) => void;
  onExtracted: (outcome: ExtractionOutcome) => void;
}) {
  const [image, setImage] = useState<File | null>(null);
  const [progress, setProgress] = useState<ReadingProgress | null>(null);
  const [enhancedBusy, setEnhancedBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [lastReading, setLastReading] = useState<ScreenshotReading | null>(null);
  // The class lines the last reading added, so a second reading can replace them instead of doubling them.
  const insertedText = useRef<string | null>(null);
  // The box's text right now. A reading takes a few seconds and the person may keep typing meanwhile,
  // so the result is added to what is in the box when it FINISHES, not when it started.
  const latestClassText = useRef(classText);
  latestClassText.current = classText;
  const [ocrAvailable, setOcrAvailable] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const signedIn = useManagerSession();
  const enhancedMode: EnhancedMode = ocrAvailable ? "ocr" : isRemoteExtractionAvailable() ? "ai" : null;
  const busy = progress !== null || enhancedBusy;

  // Asks the server once whether enhanced reading (OCR.space) is switched on. Hidden until it says yes.
  useEffect(() => {
    let current = true;
    void isEnhancedReadingAvailable().then((available) => current && setOcrAvailable(available));
    return () => {
      current = false;
    };
  }, []);

  /**
   * Puts the class times from a reading into the box: replacing what the previous reading added if it
   * is still there unchanged, otherwise below whatever the person already typed.
   */
  function applyReading(reading: ScreenshotReading) {
    setLastReading(reading);
    if (!reading.classText) return;
    const current = latestClassText.current;
    const previous = insertedText.current;
    let next: string;
    if (previous && current.includes(previous)) next = current.replace(previous, reading.classText);
    else if (!current.trim()) next = reading.classText;
    else next = `${current.trimEnd()}\n${reading.classText}`;
    onClassTextChange(next);
    insertedText.current = reading.classText;
  }

  /** The sentence shown after a reading: how many class times were found, and what to do next. */
  function describeReading(reading: ScreenshotReading): string {
    if (reading.linesFound === 0) {
      return "No class times were found in that screenshot. Try a clearer screenshot of just the class list, or type the times.";
    }
    const count = reading.linesFound === 1 ? "1 class time" : `${reading.linesFound} class times`;
    const unsure = reading.lowConfidence ? " The picture was hard to read, so check them carefully." : "";
    return `Found ${count} and added them to the box above. Check each one in the list below and fix anything that's wrong before saving.${unsure}`;
  }

  /** Reads a newly chosen or pasted screenshot in this browser, showing progress as it goes. */
  async function readInBrowser(file: File) {
    setImage(file);
    setStatus(null);
    setProgress({ label: "Preparing the picture…", fraction: 0 });
    const outcome = await readScreenshot(file, setProgress);
    setProgress(null);
    if (!outcome.ok) {
      setLastReading(null);
      setStatus(outcome.error);
      return;
    }
    applyReading(outcome.reading);
    setStatus(describeReading(outcome.reading));
  }

  /** "Try enhanced reading": sends the screenshot to the server reader chosen by `enhancedMode`. */
  async function readEnhanced() {
    if (!image || !enhancedMode) return;
    setEnhancedBusy(true);
    setStatus("Sending the screenshot for enhanced reading… this can take a little while.");
    try {
      if (enhancedMode === "ai") {
        // The n8n AI reader (James's server workflow) also fills in breaks, cutoff and other settings.
        const outcome = await extractSchedule({ text: classText, image });
        onExtracted(outcome);
        setStatus(outcome.error ?? (outcome.ai ? "Done. Please check what it found below before saving." : null));
        return;
      }
      const outcome = await readScreenshotEnhanced(image);
      if (!outcome.ok) {
        setStatus(outcome.error);
        return;
      }
      applyReading(outcome.reading);
      setStatus(describeReading(outcome.reading));
    } finally {
      setEnhancedBusy(false);
    }
  }

  /** Lets a person paste a screenshot straight into the class-times box (Ctrl+V / Cmd+V). Text pastes as usual. */
  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const picture = Array.from(event.clipboardData.files).find((file) => file.type.startsWith("image/"));
    if (!picture) return;
    event.preventDefault();
    void readInBrowser(picture);
  }

  // Offered once a screenshot has been tried in the browser, including when that failed outright.
  const showEnhanced = enhancedMode !== null && image !== null && !progress;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <label htmlFor="class-text" className="text-sm font-medium">
          When does this student have class?
        </label>
        <HelpTip label="Class times">
          Type or paste one class per line. The days go first, then the start and end time, like <b>MWF 9:00-9:50</b>. M=Mon, T=Tue,
          W=Wed, Th=Thu, F=Fri. You can paste the Meeting Patterns column straight from Workday, or use a screenshot of the student&apos;s
          class schedule: choose it with the button, or paste it into the box. The screenshot is read on this computer and never saved.
        </HelpTip>
      </div>
      <p className="text-xs text-muted">
        One class per line. Examples: <code>MWF 9:00-9:50</code> or <code>Tuesday/Thursday 8:00 AM - 9:15 AM</code>.
      </p>
      <textarea
        id="class-text"
        value={classText}
        onChange={(e) => onClassTextChange(e.target.value)}
        onPaste={handlePaste}
        placeholder={"MWF 9:00-9:50\nTTh 1:00pm-2:15pm"}
        rows={4}
        maxLength={5000}
        className="w-full rounded-lg border border-line bg-bg p-2 font-mono text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        {!classText.trim() && (
          <Button variant="ghost" onClick={() => onClassTextChange(EXAMPLE)}>
            <Wand2 className="h-4 w-4" aria-hidden /> Fill in an example
          </Button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ""; // so picking the same file again still counts as a new choice
            if (file) void readInBrowser(file);
          }}
        />
        <Button variant="secondary" onClick={() => fileInput.current?.click()} disabled={busy}>
          <ImageUp className="h-4 w-4" aria-hidden /> {image ? "Use a different screenshot" : "Use a screenshot instead"}
        </Button>
        {showEnhanced && (
          <Button variant="secondary" onClick={() => void readEnhanced()} disabled={busy || !signedIn}>
            {enhancedBusy ? <LogoLoader className="h-4 w-4" /> : <Sparkles className="h-4 w-4" aria-hidden />} {enhancedBusy ? "Reading…" : "Try enhanced reading"}
          </Button>
        )}
      </div>
      {progress && (
        <div className="space-y-1">
          <progress className="h-2 w-full" max={1} value={progress.fraction} aria-label={progress.label} />
          <p role="status" className="text-xs text-muted">
            {progress.label} {Math.round(progress.fraction * 100)}%
          </p>
        </div>
      )}
      {status && (
        <p role="status" className="text-xs text-muted">
          {status}
        </p>
      )}
      {showEnhanced && (
        <p className="text-xs text-muted">
          {lastReading?.lowConfidence ? "Not right? " : ""}
          {enhancedMode === "ocr"
            ? "Enhanced reading sends this screenshot to OCR.space, an outside reading service, which deletes it after reading. Cadence doesn't keep it."
            : "Enhanced reading sends this screenshot to the Cadence server's reader. Cadence doesn't keep it."}
        </p>
      )}
      {showEnhanced && !signedIn && (
        <ManagerSignIn purpose="needed for enhanced reading" serverUrl={enhancedMode === "ocr" ? enhancedReaderBaseUrl() : undefined} />
      )}
    </div>
  );
}
