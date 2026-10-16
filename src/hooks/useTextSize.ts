import { useCallback, useEffect, useState } from "react";

/**
 * ============================================================================
 *  TEXT SIZE (SMALL TO EXTRA LARGE)
 * ============================================================================
 * Lets each person make all the text in Cadence smaller or bigger (Settings → Text size). It works by
 * changing the page's base font size: every size in the app's styles is measured from that base (in
 * "rem" units), so text, buttons and spacing all grow or shrink together and nothing overlaps.
 *
 * Like the color theme (`useTheme.ts`), the choice belongs to the person, not the schedule: it is saved
 * in this browser only, and is never part of backups or the shared schedule.
 */
export type TextSize = "small" | "normal" | "large" | "xlarge";

/** The base font size for each choice, as a percentage of the browser's own default (usually 16px). */
export const TEXT_SIZE_PERCENT: Record<TextSize, number> = {
  small: 87.5,
  normal: 100,
  large: 112.5,
  xlarge: 125,
};

const STORAGE_KEY = "shiftfit:text-size";

/** True for one of the four real choices (anything else read back from storage is ignored). */
function isTextSize(value: unknown): value is TextSize {
  return typeof value === "string" && value in TEXT_SIZE_PERCENT;
}

/** Sets the page's base font size, which every other size in the app follows. */
function applyTextSize(size: TextSize) {
  document.documentElement.style.fontSize = `${TEXT_SIZE_PERCENT[size]}%`;
}

/** The current text size and a way to change it; loads the saved choice and saves every change. */
export function useTextSize() {
  const [textSize, setTextSizeState] = useState<TextSize>(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      return isTextSize(saved) ? saved : "normal";
    } catch {
      return "normal";
    }
  });

  useEffect(() => {
    applyTextSize(textSize);
    try {
      window.localStorage.setItem(STORAGE_KEY, textSize);
    } catch {
      /* ignore: the size just won't be remembered next time in this browser */
    }
  }, [textSize]);

  const setTextSize = useCallback((size: TextSize) => setTextSizeState(size), []);

  return { textSize, setTextSize };
}
