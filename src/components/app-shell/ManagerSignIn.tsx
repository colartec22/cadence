import { useId, useState } from "react";
import { KeyRound, LogOut } from "lucide-react";
import { Button } from "../ui/Button";
import { useManagerSession } from "../../hooks/useManagerSession";
import { signInManager, signOutManager } from "../../services/automation/managerSession";

/**
 * ============================================================================
 *  MANAGER SIGN-IN BOX
 * ============================================================================
 * Shown wherever a server feature needs the manager passcode first (sending to Google Calendar,
 * reading a screenshot). Once the server accepts the passcode, every sign-in box on the page turns
 * into a short "Signed in as manager" line with a Sign out button. The passcode is kept only while
 * this tab is open (see `services/automation/managerSession.ts`).
 */
export function ManagerSignIn({ purpose, serverUrl }: { purpose: string; serverUrl?: string }) {
  const signedIn = useManagerSession();
  const [passcode, setPasscode] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputId = useId();

  // Asks the server to check the passcode; shows its answer in plain words if it is refused.
  async function handleSubmit() {
    if (!passcode || busy) return;
    setBusy(true);
    // `serverUrl` is only given by "Try enhanced reading"; otherwise the usual server address is used.
    const result = serverUrl === undefined ? await signInManager(passcode) : await signInManager(passcode, serverUrl);
    setBusy(false);
    setProblem(result);
    if (result === null) setPasscode("");
  }

  if (signedIn) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted">
        <KeyRound className="h-3.5 w-3.5" aria-hidden /> Signed in as manager.
        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={signOutManager}>
          <LogOut className="h-3.5 w-3.5" aria-hidden /> Sign out
        </Button>
      </p>
    );
  }

  return (
    // A plain group, not a <form>: this box can appear inside the student form, and a form inside a
    // form isn't allowed in HTML. Enter in the passcode box signs in, like a normal form would.
    <div role="group" aria-label="Manager sign-in" className="space-y-1">
      <label htmlFor={inputId} className="block text-sm font-medium">
        Manager passcode <span className="font-normal text-muted">({purpose})</span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={inputId}
          type="password"
          autoComplete="current-password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // Stop Enter from also submitting a form this box sits inside (e.g. saving the student).
              e.preventDefault();
              void handleSubmit();
            }
          }}
          className="rounded-lg border border-line bg-bg p-2 text-sm"
        />
        <Button variant="secondary" disabled={busy || !passcode} onClick={() => void handleSubmit()}>
          <KeyRound className="h-4 w-4" aria-hidden /> {busy ? "Checking…" : "Sign in"}
        </Button>
      </div>
      {problem && (
        <p role="alert" className="text-xs text-gap">
          {problem}
        </p>
      )}
    </div>
  );
}
