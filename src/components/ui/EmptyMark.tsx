import { clsx } from "../../lib/clsx";

/**
 * A small, calm picture for "nothing here yet" spaces: the Cadence logo's three shift bars drawn as
 * dashed outlines (empty slots waiting to be filled), gently floating one after another. Decoration
 * only (hidden from screen readers); the words beside it carry the meaning. The floating stops
 * for people who asked their device for less motion (see `app.css`).
 */
export function EmptyMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={clsx("text-accent", className)} aria-hidden focusable="false">
      <circle cx="32" cy="32" r="30" fill="currentColor" opacity="0.1" />
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3" strokeLinecap="round">
        <rect className="empty-float" x="22" y="16" width="27" height="9" rx="4.5" />
        <rect className="empty-float empty-float-2" x="15" y="28" width="18" height="9" rx="4.5" />
        <rect className="empty-float empty-float-3" x="22" y="40" width="27" height="9" rx="4.5" />
      </g>
      <circle className="logo-loader-beat" cx="42.5" cy="32.5" r="4.5" fill="currentColor" opacity="0.6" />
    </svg>
  );
}
