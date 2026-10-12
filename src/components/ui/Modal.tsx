import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { X } from "lucide-react";
import { clsx } from "../../lib/clsx";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Hidden inputs (like a file picker behind a button) must not become Tab stops. */
function isVisible(node: HTMLElement): boolean {
  if (node.closest("[hidden]")) return false;
  const style = getComputedStyle(node);
  return style.display !== "none" && style.visibility !== "hidden";
}

type ModalProps = {
  title: string;
  /** A short plain-language line under the title. */
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** "side" slides in from the right on wide screens (used for Help). */
  variant?: "center" | "side";
  size?: "sm" | "md" | "lg";
  initialFocus?: RefObject<HTMLElement | null>;
};

/**
 * Accessible dialog: focus moves into it, Tab stays inside, Escape closes, the page behind
 * can't scroll, and focus returns to whatever opened it. Clicking the dim backdrop does NOT
 * close it, so a stray click never throws away half-typed work.
 */
export function Modal({ title, description, onClose, children, footer, variant = "center", size = "md", initialFocus }: ModalProps) {
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const scrollLock = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const target = initialFocus?.current ?? dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]") ?? dialogRef.current;
    target?.focus();
    return () => {
      document.body.style.overflow = scrollLock;
      previous?.focus?.();
    };
    // Only on open/close: re-running when props change would steal focus while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape closes the dialog. Tab and Shift+Tab loop inside it, so keyboard users can't wander behind it.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(isVisible);
    if (!nodes.length) {
      e.preventDefault();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialogRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const width = size === "sm" ? "sm:max-w-sm" : size === "lg" ? "sm:max-w-3xl" : "sm:max-w-lg";

  return (
    <div
      className={clsx(
        "anim-fade fixed inset-0 z-40 flex bg-ink/45",
        variant === "side" ? "items-stretch justify-end" : "items-end justify-center sm:items-center",
      )}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={clsx(
          "flex w-full flex-col bg-panel shadow-xl outline-none",
          variant === "side"
            ? "anim-slide-in h-full sm:max-w-md sm:border-l sm:border-line"
            : clsx("anim-rise max-h-[92dvh] rounded-t-2xl border border-line sm:rounded-2xl", width),
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line p-4">
          <div>
            <h2 id={titleId} className="font-display text-lg font-semibold leading-tight">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-sm text-muted">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted hover:bg-line/40 hover:text-ink"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line p-4">{footer}</div>}
      </div>
    </div>
  );
}
