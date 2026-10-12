import { useEffect } from "react";
import { X } from "lucide-react";

/**
 * A short message that fades away after a few seconds. The live region is always present so
 * screen readers announce each new message; there is also a close button for everyone else.
 */
export function Toast({ toast, onDismiss }: { toast: { id: number; message: string } | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDismiss, 7000);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-3 lg:bottom-5">
      {toast && (
        <div key={toast.id} className="anim-rise pointer-events-auto flex max-w-lg items-start gap-3 rounded-xl bg-ink px-4 py-3 text-sm text-bg shadow-lg">
          <p>{toast.message}</p>
          <button type="button" onClick={onDismiss} aria-label="Dismiss message" className="rounded p-0.5 opacity-80 hover:opacity-100">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
