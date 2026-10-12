import { AlertTriangle, CheckCircle2, Lightbulb, ListChecks } from "lucide-react";
import { Button } from "../ui/Button";
import { HelpTip } from "../help/HelpTip";
import { clsx } from "../../lib/clsx";
import type { Guidance } from "../../features/scheduling/guidance";

const STYLE: Record<Guidance["tone"], string> = {
  start: "border-accent/40 bg-accent/10",
  todo: "border-line bg-panel",
  problem: "border-gap/50 bg-gap-bg",
  good: "border-ok/40 bg-ok-bg",
};

/**
 * One line of "what to do next", always visible, written for someone who has never used the
 * app. Only the short title shows by default — the longer explanation (`guidance.body`) sits
 * behind the same "?" affordance used everywhere else in the app (`HelpTip`), so the banner
 * reads as one line instead of a paragraph competing with the schedule for attention.
 */
export function NextStepBanner({ guidance, onAction }: { guidance: Guidance; onAction: () => void }) {
  const Icon = guidance.tone === "problem" ? AlertTriangle : guidance.tone === "good" ? CheckCircle2 : guidance.tone === "start" ? Lightbulb : ListChecks;
  return (
    <div key={guidance.tone} role="status" className={clsx("anim-fade flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 sm:px-6", STYLE[guidance.tone])}>
      <Icon className={clsx("h-5 w-5 shrink-0", guidance.tone === "good" && "anim-pop", guidance.tone === "problem" ? "text-gap" : guidance.tone === "good" ? "text-ok" : "text-accent")} aria-hidden />
      <p className="min-w-0 flex-1 text-sm font-semibold">
        {guidance.title}
        <HelpTip label="more about this" ariaLabel="Read more about this suggestion">
          {guidance.body}
        </HelpTip>
      </p>
      {guidance.action && (
        <Button variant={guidance.tone === "problem" ? "danger" : "primary"} onClick={onAction}>
          {guidance.action.label}
        </Button>
      )}
    </div>
  );
}
