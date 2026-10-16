import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Search } from "lucide-react";
import { Modal } from "../ui/Modal";
import { clsx } from "../../lib/clsx";
import { FAQ, FAQ_TOPICS, GLOSSARY, SHORTCUTS } from "../../content/help";
import type { FaqItem } from "../../content/help";

/**
 * The full Help panel (opened from the header, or by pressing `?`). Four tabs:
 * a numbered quick-start, a searchable FAQ, a glossary, and keyboard
 * shortcuts. All the actual TEXT lives in `src/content/help.ts` as plain
 * data (see that file's own comment) — this file only renders it and runs
 * the search/tab-switching behavior, so adding a question never means
 * touching this component.
 */
type Tab = "start" | "faq" | "words" | "keys";

const TABS: { id: Tab; label: string }[] = [
  { id: "start", label: "Quick start" },
  { id: "faq", label: "Questions" },
  { id: "words", label: "Words we use" },
  { id: "keys", label: "Shortcuts" },
];

/** True if every word typed in the help search appears somewhere in this question, answer or keywords. */
function matches(item: FaqItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [item.question, ...item.answer, ...(item.keywords ?? [])].join(" ").toLowerCase();
  return q.split(/\s+/).every((word) => haystack.includes(word));
}

/** The Help side panel with four tabs: quick start, questions, words explained, keyboard keys. */
export function HelpDrawer({ onClose, initialTab = "start" }: { onClose: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ start: null, faq: null, words: null, keys: null });

  // Left/right arrow keys move between the tabs (the standard keyboard pattern for tabs).
  function onTabKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (index + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
    setTab(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  }

  return (
    <Modal variant="side" title="Help" description="Short answers in plain words." onClose={onClose}>
      <div role="tablist" aria-label="Help sections" className="mb-4 flex flex-wrap gap-1 border-b border-line pb-2">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            role="tab"
            id={`help-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`help-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKey(e, i)}
            className={clsx(
              "rounded-lg px-3 py-1.5 text-sm font-medium",
              tab === t.id ? "bg-accent text-accent-ink" : "text-ink hover:bg-line/40",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`help-panel-${tab}`} aria-labelledby={`help-tab-${tab}`}>
        {tab === "start" && <QuickStart onOpenFaq={() => setTab("faq")} />}
        {tab === "faq" && <Faq />}
        {tab === "words" && (
          <dl className="space-y-3">
            {GLOSSARY.map((g) => (
              <div key={g.term}>
                <dt className="font-semibold">{g.term}</dt>
                <dd className="text-sm text-muted">{g.meaning}</dd>
              </div>
            ))}
          </dl>
        )}
        {tab === "keys" && (
          <ul className="space-y-2 text-sm">
            {SHORTCUTS.map((s) => (
              <li key={s.keys} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2">
                <span>{s.action}</span>
                <kbd className="rounded border border-line bg-bg px-1.5 py-0.5 font-mono text-xs">{s.keys}</kbd>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/** The four numbered first steps for a new manager. */
function QuickStart({ onOpenFaq }: { onOpenFaq: () => void }) {
  const steps = [
    { n: 1, title: "Add your students", body: "Press Add student on the left. Type a name and paste when they have class. Cadence checks each line and tells you if it can't read one." },
    { n: 2, title: "Press “Fill schedule for me”", body: "Cadence places shifts around classes and breaks, and tries to keep each shift in one long block." },
    { n: 3, title: "Fix the pink boxes", body: "Pink means nobody is working then. Click a student, then click a pink box to add them. The panel on the right explains who is free." },
    { n: 4, title: "Save or share", body: "Press Save & share to keep a backup, download a spreadsheet, or make calendar files for your students." },
  ];
  return (
    <div className="space-y-4">
      <ol className="space-y-3">
        {steps.map((s) => (
          <li key={s.n} className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-ink" aria-hidden>
              {s.n}
            </span>
            <div>
              <p className="font-semibold">{s.title}</p>
              <p className="text-sm text-muted">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="rounded-lg border border-line bg-bg p-3 text-sm">
        <p className="font-semibold">Made a mistake?</p>
        <p className="text-muted">Press Undo at the top (or Ctrl+Z). Almost everything can be undone.</p>
      </div>
      <button type="button" onClick={onOpenFaq} className="text-sm font-medium text-accent underline underline-offset-2">
        Still stuck? Read the questions people ask →
      </button>
    </div>
  );
}

/** The searchable list of common questions. */
function Faq() {
  const [query, setQuery] = useState("");
  const results = useMemo(() => FAQ.filter((f) => matches(f, query)), [query]);

  return (
    <div className="space-y-4">
      <label className="relative block">
        <span className="sr-only">Search the questions</span>
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search, like “break” or “backup”"
          className="w-full rounded-lg border border-line bg-bg py-2 pl-8 pr-2 text-sm"
        />
      </label>
      <p role="status" className="sr-only">
        {results.length} {results.length === 1 ? "question" : "questions"} found
      </p>
      {FAQ_TOPICS.map((topic) => {
        const items = results.filter((f) => f.topic === topic);
        if (!items.length) return null;
        return (
          <section key={topic} aria-label={topic}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{topic}</h3>
            <div className="divide-y divide-line rounded-lg border border-line">
              {items.map((item) => (
                <details key={item.id} className="group p-3">
                  <summary className="cursor-pointer list-none font-medium marker:hidden">
                    <span className="mr-1.5 inline-block text-muted transition-transform group-open:rotate-90" aria-hidden>
                      ›
                    </span>
                    {item.question}
                  </summary>
                  <div className="mt-2 space-y-2 pl-4 text-sm text-muted">
                    {item.answer.map((p, i) => (
                      <p key={i}>{p}</p>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </section>
        );
      })}
      {!results.length && (
        <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">
          Nothing matches “{query}”. Try a shorter or simpler word, or ask your manager.
        </p>
      )}
    </div>
  );
}
