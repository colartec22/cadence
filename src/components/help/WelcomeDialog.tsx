import { CalendarCheck, Sparkles, UserPlus } from "lucide-react";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

/**
 * First-visit welcome. It explains the whole idea in three short steps and lets a new
 * person choose how to begin. It only ever appears once (and again from Help).
 */
export function WelcomeDialog({
  onExploreSample,
  onStartFresh,
  onOpenGuide,
}: {
  onExploreSample: () => void;
  onStartFresh: () => void;
  onOpenGuide: () => void;
}) {
  const steps = [
    { icon: UserPlus, title: "Add your students", body: "Type a name and paste the times they have class." },
    { icon: Sparkles, title: "Let Cadence fill the week", body: "It places shifts around classes and breaks for you." },
    { icon: CalendarCheck, title: "Fix the pink spots", body: "Pink means nobody is working then. Click to add someone." },
  ];
  return (
    <Modal
      title="Welcome to Cadence"
      description="Make a work schedule that fits around everyone's classes. It takes about two minutes to try."
      onClose={onExploreSample}
      footer={
        <>
          <Button variant="ghost" onClick={onOpenGuide}>
            Show me how it works
          </Button>
          <Button variant="secondary" onClick={onStartFresh}>
            Start with my own students
          </Button>
          <Button variant="primary" data-autofocus onClick={onExploreSample}>
            Try it with sample students
          </Button>
        </>
      }
    >
      <ol className="space-y-4">
        {steps.map(({ icon: Icon, title, body }, i) => (
          <li key={title} className="flex gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="font-semibold">
                <span className="text-muted">{i + 1}. </span>
                {title}
              </p>
              <p className="text-sm text-muted">{body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-5 rounded-lg bg-bg p-3 text-sm text-muted">
        Your schedule is saved only in this browser. Nothing is uploaded, and you don&apos;t need an account. The sample
        students are made up.
      </p>
    </Modal>
  );
}
