import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Wand2, XCircle } from "lucide-react";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { HelpTip } from "../help/HelpTip";
import { parseRoster } from "../../features/scheduling/roster";

const EXAMPLE = "Noa K.: MWF 9:00am-9:50am; TTh 1:00pm-2:15pm\nKai P.: Tuesday/Thursday 8:00 AM - 9:15 AM\nMele T.: MW 1:00pm-2:15pm";

/**
 * Adds a whole roster at once. Paste lines like "Noa K.: MWF 9:00am-9:50am; TTh 1:00pm-2:15pm"
 * or copy rows straight out of a spreadsheet (name in the first column, classes after it).
 * Every line is checked before anything is added, and the whole batch is one Undo step.
 */
export function BulkAddDialog({
  existingCount,
  onAdd,
  onClose,
}: {
  existingCount: number;
  onAdd: (rows: { name: string; classText: string }[]) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const parsed = useMemo(() => parseRoster(text, existingCount), [text, existingCount]);
  const bad = parsed.rows.length - parsed.valid.length;
  const canAdd = parsed.valid.length > 0 && parsed.overall.length === 0;

  return (
    <Modal
      title="Add several students at once"
      description="Paste your whole list. Cadence checks every line before adding anyone."
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!canAdd}
            onClick={() => onAdd(parsed.valid.map((r) => ({ name: r.name, classText: r.classText })))}
          >
            {parsed.valid.length
              ? `Add ${parsed.valid.length} ${parsed.valid.length === 1 ? "student" : "students"}`
              : "Add students"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="flex items-center gap-1">
            <label htmlFor="roster-text" className="text-sm font-medium">
              One student per line
            </label>
            <HelpTip label="How to write the list">
              Type the name, a colon, then their class times. Put several classes on one line by separating them with a semicolon. Or copy
              rows out of a spreadsheet: the name goes in the first column and each class in the next columns.
            </HelpTip>
          </div>
          <p className="text-xs text-muted">
            Example: <code>Noa K.: MWF 9:00am-9:50am; TTh 1:00pm-2:15pm</code>
          </p>
          <textarea
            id="roster-text"
            data-autofocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            maxLength={100_000}
            placeholder={EXAMPLE}
            className="mt-1 w-full rounded-lg border border-line bg-bg p-2 font-mono text-sm"
          />
          {!text.trim() && (
            <Button variant="ghost" className="mt-1" onClick={() => setText(EXAMPLE)}>
              <Wand2 className="h-4 w-4" aria-hidden /> Fill in an example
            </Button>
          )}
        </div>

        {parsed.rows.length > 0 && (
          <div className="space-y-2 rounded-xl border border-line p-3" aria-live="polite">
            <h3 className="text-sm font-semibold">
              Here is what Cadence understood{" "}
              <span className="font-normal text-muted">
                ({parsed.valid.length} of {parsed.rows.length} lines{bad ? `, ${bad} will be skipped` : ""})
              </span>
            </h3>
            <ul className="max-h-64 space-y-2 overflow-y-auto pr-1 text-sm">
              {parsed.rows.map((row) => (
                <li key={row.line} className="flex items-start gap-2">
                  {row.ok && row.warnings.length === 0 && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" role="img" aria-label="Understood" />}
                  {row.ok && row.warnings.length > 0 && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" role="img" aria-label="Please check" />}
                  {!row.ok && <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-gap" role="img" aria-label="Could not read" />}
                  <span className="min-w-0">
                    <span className="block break-words">
                      <span className="font-semibold">{row.name || "(no name)"}</span>
                      <span className="text-muted">
                        {" "}
                        · line {row.line}
                        {row.ok ? ` · ${row.meetings} ${row.meetings === 1 ? "class time" : "class times"}` : ""}
                      </span>
                    </span>
                    {[...row.errors, ...row.warnings].map((m, i) => (
                      <span key={i} className="block break-words text-xs text-muted">
                        {m}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {parsed.overall.map((m) => (
          <p key={m} role="alert" className="text-sm text-gap">
            {m}
          </p>
        ))}

        <p className="rounded-lg bg-bg p-3 text-xs text-muted">
          Everyone starts with no time-of-day preference, up to 5 days a week, and a 30-minute break at 12:00pm. You can change any of that for each
          person afterwards with their Edit button.
        </p>
      </div>
    </Modal>
  );
}
