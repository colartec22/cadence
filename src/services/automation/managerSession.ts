/**
 * ============================================================================
 *  MANAGER SIGN-IN (the passcode that unlocks the server features)
 * ============================================================================
 * Sending to Google Calendar and reading screenshots both go through the ShiftFit server
 * (`src/server/gateway.ts`), and the server only helps someone who knows the manager passcode.
 * This file remembers the passcode for as long as this browser tab stays open, and sends it with
 * each server request as an `Authorization: Bearer <passcode>` header.
 *
 * Why only in memory (a plain variable)? It is never written to localStorage, cookies or a file,
 * so it disappears when the tab is closed or reloaded and can't be picked up later by someone
 * else using the same computer. The cost is typing it again after a reload.
 *
 * Nothing here decides who is allowed in: the SERVER checks the passcode every single time. This
 * file only asks the server "is this passcode right?" once, so the screen can say so straight away.
 */

/** The passcode that the server last accepted, or null when nobody has signed in on this tab. */
let acceptedPasscode: string | null = null;

/** Screens that want to know when someone signs in or out (see `useManagerSession`). */
const listeners = new Set<() => void>();

/** Tells every listening screen that the signed-in state changed. */
function notify(): void {
  for (const listener of listeners) listener();
}

/** Lets a screen be told about sign-in changes. Returns a function that stops the updates. */
export function subscribeToManagerSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True once the server has accepted a passcode in this tab. */
export function isManagerSignedIn(): boolean {
  return acceptedPasscode !== null;
}

/** The accepted passcode, for adding to server requests (null when not signed in). */
export function currentPasscode(): string | null {
  return acceptedPasscode;
}

/** Forgets the passcode, for a "Sign out" button or after the server says it is no longer valid. */
export function signOutManager(): void {
  acceptedPasscode = null;
  notify();
}

/** The address of the ShiftFit server, from VITE_AUTOMATION_API_URL ("/" means "this same website"). */
export function serverBaseUrl(): string | null {
  const url = import.meta.env.VITE_AUTOMATION_API_URL;
  return url ? url.replace(/\/+$/, "") : null;
}

/**
 * Asks the server whether this passcode is right. Returns null on success, or a plain-language
 * problem to show the manager. The passcode is only remembered if the server accepted it.
 * `baseUrl` is the server to ask: normally VITE_AUTOMATION_API_URL, but "Try enhanced reading"
 * passes "" ("this same website") so it also works on Vercel before n8n is set up.
 */
export async function signInManager(passcode: string, baseUrl: string | null = serverBaseUrl()): Promise<string | null> {
  if (baseUrl === null) return "This copy of ShiftFit isn't connected to a server.";
  if (!passcode.trim()) return "Type the manager passcode first.";
  try {
    const res = await fetch(`${baseUrl}/api/session`, {
      method: "POST",
      headers: { authorization: `Bearer ${passcode}` },
      credentials: "omit",
    });
    if (res.ok) {
      acceptedPasscode = passcode;
      notify();
      return null;
    }
    return problemFromStatus(res.status);
  } catch {
    return "Couldn't reach the ShiftFit server. Check your internet connection and try again.";
  }
}

/** Turns the server's answer code into words a manager understands. */
export function problemFromStatus(status: number): string {
  if (status === 401) return "That passcode isn't right.";
  if (status === 429) return "Too many wrong tries. Wait 15 minutes, then try again.";
  if (status === 503) return "The server hasn't been set up yet. Ask the person who runs ShiftFit.";
  return `The server had a problem (${status}). Try again in a minute.`;
}
