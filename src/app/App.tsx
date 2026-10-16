import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, Users, HeartPulse } from "lucide-react";
import { TopBar } from "../components/app-shell/TopBar";
import { NextStepBanner } from "../components/app-shell/NextStepBanner";
import { RulesDialog } from "../components/app-shell/RulesDialog";
import { SaveShareDialog } from "../components/app-shell/SaveShareDialog";
import { HelpDrawer } from "../components/help/HelpDrawer";
import { WelcomeDialog } from "../components/help/WelcomeDialog";
import { StudentRail } from "../components/students/StudentRail";
import { StudentFormSheet } from "../components/students/StudentFormSheet";
import { BulkAddDialog } from "../components/students/BulkAddDialog";
import { ShiftImportDialog } from "../components/schedule/ShiftImportDialog";
import { SchedulePanel } from "../components/schedule/SchedulePanel";
import { InsightsPanel } from "../components/summary/InsightsPanel";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Toast } from "../components/ui/Toast";
import { buildCoverageSlots } from "../features/scheduling/coverage";
import { assignedHours } from "../features/scheduling/availability";
import { nextStep } from "../features/scheduling/guidance";
import type { GuidanceAction } from "../features/scheduling/guidance";
import { findIssues, isBlockingIssue } from "../features/scheduling/issues";
import { weeklyLimit } from "../features/scheduling/term";
import { useFirstRun } from "../hooks/useFirstRun";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useShiftFitStore } from "../hooks/useShiftFitStore";
import { useTheme } from "../hooks/useTheme";
import { useTextSize } from "../hooks/useTextSize";
import { clsx } from "../lib/clsx";

/**
 * ============================================================================
 *  THE APP'S ROOT COMPONENT — LAYS OUT EVERY SCREEN
 * ============================================================================
 * In React, a "component" is a function that returns the HTML-like markup
 * (called JSX) for one piece of the page. `App` is the top-level one: it
 * decides the overall page layout (top bar, three-column desktop layout /
 * tabbed mobile layout, dialogs) and which smaller components go where. It
 * does not contain scheduling logic itself — it reads data and action
 * functions from `useShiftFitStore()` (see `src/hooks/useShiftFitStore.ts`)
 * and passes them down as "props" (React's term for arguments passed into a
 * component) to the components in `src/components/`.
 *
 * `dialog` below tracks which single popup/sheet is currently open (only one
 * at a time) so the rest of the file can just check `dialog?.kind`.
 */
type Dialog =
  | { kind: "student"; id: string | "new" }
  | { kind: "bulk" }
  | { kind: "import-shifts" }
  | { kind: "help"; tab?: "start" | "faq" }
  | { kind: "rules" }
  | { kind: "share" }
  | { kind: "remove"; id: string }
  | { kind: "clear-shifts" }
  | null;

type MobileTab = "students" | "schedule" | "health";

/** True while the person is typing in a text box, so keyboard shortcuts (like undo) don't fire by accident. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

/**
 * The whole app on one screen: students on the left, the schedule in the middle, schedule health
 * on the right (tabs on a phone). It holds which dialog is open and hands the store's data and
 * actions down to each panel.
 */
export function App() {
  const store = useShiftFitStore();
  const { theme, setTheme } = useTheme();
  const { textSize, setTextSize } = useTextSize();
  const { showWelcome, markWelcomed } = useFirstRun();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>("schedule");
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const healthRef = useRef<HTMLDivElement>(null);
  const [healthFlash, setHealthFlash] = useState(false);

  const { settings, students, assignments } = store;

  const issues = useMemo(() => findIssues(students, assignments, settings), [students, assignments, settings]);
  const blockingIssues = useMemo(() => issues.filter(isBlockingIssue), [issues]);
  const gapSlots = useMemo(() => buildCoverageSlots(assignments, settings).filter((s) => !s.fullyStaffed).length, [assignments, settings]);
  const belowTarget = useMemo(
    () => students.filter((s) => assignedHours(s.id, assignments, settings) < weeklyLimit(settings)).length,
    [students, assignments, settings],
  );
  const guidance = useMemo(
    () => nextStep({ studentCount: students.length, shiftCount: assignments.length, blockingIssues: blockingIssues.length, gapSlots, studentsBelowTarget: belowTarget }),
    [students.length, assignments.length, blockingIssues.length, gapSlots, belowTarget],
  );

  const showHealth = useCallback(() => {
    setMobileTab("health");
    // Wait a tick so the panel exists on small screens before moving focus into it.
    setTimeout(() => {
      healthRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      healthRef.current?.focus();
      // A brief outline so it is obvious where the user was sent, even when the panel was already on screen.
      setHealthFlash(true);
      setTimeout(() => setHealthFlash(false), 1600);
    }, 0);
  }, []);

  // If the browser is refusing to save, closing the tab would lose the work, so ask first.
  useEffect(() => {
    if (!store.saveFailed) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [store.saveFailed]);

  // Runs whatever the "next step" banner's button suggests (add a student, auto-fill, and so on).
  function onGuidanceAction(kind: GuidanceAction) {
    if (kind === "add-student") setDialog({ kind: "student", id: "new" });
    else if (kind === "auto-fill") store.runAutoFill(false);
    else if (kind === "show-health") showHealth();
    else setDialog({ kind: "share" });
  }

  // Global shortcuts. They are ignored while typing or while a window is open, so they never surprise anyone.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (dialog || showWelcome || isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z" && !e.shiftKey) {
        e.preventDefault();
        store.undo();
      } else if (mod && ((key === "z" && e.shiftKey) || key === "y")) {
        e.preventDefault();
        store.redo();
      } else if (!mod && e.key === "?") {
        e.preventDefault();
        setDialog({ kind: "help" });
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dialog, showWelcome, store.undo, store.redo]);

  const editing = dialog?.kind === "student" && dialog.id !== "new" ? (students.find((s) => s.id === dialog.id) ?? null) : null;
  const removing = dialog?.kind === "remove" ? students.find((s) => s.id === dialog.id) : undefined;
  const hasAutoShifts = assignments.some((a) => a.source === "autofill");
  const overrideStudent = store.pendingOverride ? students.find((s) => s.id === store.pendingOverride?.studentId) : undefined;

  const tabs: { id: MobileTab; label: string; icon: typeof Users; badge?: number }[] = [
    { id: "students", label: "Students", icon: Users },
    { id: "schedule", label: "Schedule", icon: CalendarDays },
    { id: "health", label: "Health", icon: HeartPulse, badge: blockingIssues.length + (gapSlots > 0 ? 1 : 0) },
  ];

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <a
        href="#schedule-panel"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-ink"
      >
        Skip to the schedule
      </a>
      <TopBar
        settings={settings}
        onSettingsChange={store.setSettings}
        onAutoFill={() => store.runAutoFill(false)}
        onRebuild={() => store.runAutoFill(true)}
        onClearShifts={() => setDialog({ kind: "clear-shifts" })}
        onImportShifts={() => setDialog({ kind: "import-shifts" })}
        hasAutoShifts={hasAutoShifts}
        hasShifts={assignments.length > 0}
        hasStudents={students.length > 0}
        canUndo={store.canUndo}
        canRedo={store.canRedo}
        undoLabel={store.undoLabel}
        redoLabel={store.redoLabel}
        onUndo={store.undo}
        onRedo={store.redo}
        onOpenHelp={() => setDialog({ kind: "help" })}
        onOpenRules={() => setDialog({ kind: "rules" })}
        onOpenShare={() => setDialog({ kind: "share" })}
        theme={theme}
        onThemeChange={setTheme}
        textSize={textSize}
        onTextSizeChange={setTextSize}
      />
      <NextStepBanner guidance={guidance} onAction={() => guidance.action && onGuidanceAction(guidance.action.kind)} />
      {store.saveFailed && (
        <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-warn/40 bg-warn-bg px-4 py-2 text-sm sm:px-6">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warn" aria-hidden />
          <p className="min-w-0 flex-1">
            Your browser won&apos;t let Cadence save automatically right now (private mode or full storage). Your work is safe on screen, but it would be lost if you close this tab. Save a
            backup file now.
          </p>
          <Button variant="secondary" onClick={() => setDialog({ kind: "share" })}>
            Save a backup
          </Button>
        </div>
      )}

      {store.otherTabChanged && (
        <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-warn/40 bg-warn-bg px-4 py-2 text-sm sm:px-6">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warn" aria-hidden />
          <p className="min-w-0 flex-1">
            Cadence was changed in another tab or window. Reload to see the latest. If you keep working here, your next change will replace what the other tab saved.
          </p>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reload to get the latest
          </Button>
        </div>
      )}

      <main className="grid flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[minmax(220px,250px)_minmax(0,1fr)_minmax(250px,285px)] xl:grid-cols-[minmax(250px,300px)_minmax(0,1fr)_minmax(270px,330px)]">
        <div className={clsx(mobileTab === "students" ? "block" : "hidden", "min-h-0 border-line lg:block lg:border-r")}>
          <StudentRail
            students={students}
            assignments={assignments}
            settings={settings}
            issues={issues}
            selectedStudentId={store.selectedStudent?.id ?? null}
            onSelect={(id) => {
              store.selectStudent(id);
              if (!isDesktop) setMobileTab("schedule");
            }}
            onEdit={(id) => setDialog({ kind: "student", id })}
            onRemove={(id) => setDialog({ kind: "remove", id })}
            onAddNew={() => setDialog({ kind: "student", id: "new" })}
            onAddMany={() => setDialog({ kind: "bulk" })}
          />
        </div>
        <div id="schedule-panel" tabIndex={-1} className={clsx(mobileTab === "schedule" ? "block" : "hidden", "min-h-0 outline-none lg:block")}>
          <SchedulePanel
            settings={settings}
            students={students}
            assignments={assignments}
            issues={issues}
            selectedStudent={store.selectedStudent}
            onToggle={store.toggleSlot}
            onRange={store.setRange}
            onNotify={store.notify}
          />
        </div>
        <div ref={healthRef} tabIndex={-1} className={clsx(mobileTab === "health" ? "block" : "hidden", "min-h-0 border-line outline-none lg:block lg:border-l", healthFlash && "ring-2 ring-inset ring-accent")}>
          <InsightsPanel
            students={students}
            assignments={assignments}
            settings={settings}
            issues={issues}
            lastAutofill={store.lastAutofill}
            onSelectStudent={(id) => {
              store.selectStudent(id);
              if (!isDesktop) setMobileTab("schedule");
            }}
            onFillGap={store.fillGap}
          />
        </div>
      </main>

      <nav aria-label="Sections" className="sticky bottom-0 z-30 grid grid-cols-3 border-t border-line bg-panel lg:hidden">
        {tabs.map(({ id, label, icon: Icon, badge }) => (
          <button
            key={id}
            type="button"
            aria-current={mobileTab === id ? "page" : undefined}
            onClick={() => setMobileTab(id)}
            className={clsx("relative flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium", mobileTab === id ? "text-accent" : "text-muted")}
          >
            <Icon className="h-5 w-5" aria-hidden />
            {label}
            {badge ? (
              <span className="absolute right-[22%] top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gap px-1 text-[10px] font-bold text-accent-ink">
                {badge}
                <span className="sr-only"> things need attention</span>
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      {showWelcome && (
        <WelcomeDialog
          onExploreSample={markWelcomed}
          onStartFresh={() => {
            store.clearAll();
            markWelcomed();
            setDialog({ kind: "student", id: "new" });
          }}
          onOpenGuide={() => {
            markWelcomed();
            setDialog({ kind: "help", tab: "start" });
          }}
        />
      )}

      {dialog?.kind === "student" && (
        <StudentFormSheet
          key={dialog.id}
          student={editing}
          existingNames={students.map((s) => s.name)}
          onClose={() => setDialog(null)}
          onSave={(input) => {
            if (editing) store.updateStudent(editing.id, input);
            else store.addStudent(input);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "bulk" && (
        <BulkAddDialog
          existingCount={students.length}
          onClose={() => setDialog(null)}
          onAdd={(rows) => {
            store.addStudents(rows);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "import-shifts" && (
        <ShiftImportDialog
          students={students}
          slotMinutes={settings.slotMinutes}
          onClose={() => setDialog(null)}
          onAdd={(entries) => {
            store.importShifts(entries);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "help" && <HelpDrawer initialTab={dialog.tab} onClose={() => setDialog(null)} />}
      {dialog?.kind === "rules" && <RulesDialog settings={settings} onSave={store.setSettings} onClose={() => setDialog(null)} />}
      {dialog?.kind === "share" && (
        <SaveShareDialog
          settings={settings}
          students={students}
          assignments={assignments}
          otherTermAssignments={store.otherTermAssignments}
          semester={store.semester}
          selectedStudentId={store.selectedStudent?.id ?? null}
          blockingIssues={blockingIssues.length}
          onImport={store.loadState}
          onSetSemester={store.setSemester}
          onResetDemo={store.resetDemo}
          onClearAll={store.clearAll}
          onClose={() => setDialog(null)}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.name}?`}
          danger
          confirmLabel="Yes, remove"
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            store.removeStudent(removing.id);
            setDialog(null);
          }}
        >
          <p>
            Their {(assignments.filter((a) => a.studentId === removing.id).length * settings.slotMinutes) / 60} hours of shifts will be removed too.
          </p>
          <p className="text-muted">You can press Undo afterwards to bring them back.</p>
        </ConfirmDialog>
      )}
      {dialog?.kind === "clear-shifts" && (
        <ConfirmDialog
          title="Clear all shifts?"
          danger
          confirmLabel="Yes, clear them"
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            store.clearShifts();
            setDialog(null);
          }}
        >
          <p>Every student stays, but all {(assignments.length * settings.slotMinutes) / 60} hours of shifts are removed.</p>
          <p className="text-muted">You can press Undo afterwards.</p>
        </ConfirmDialog>
      )}
      {store.pendingOverride && (
        <ConfirmDialog title="Assign anyway?" confirmLabel="Yes, assign anyway" onCancel={store.cancelOverride} onConfirm={store.confirmOverride}>
          <p>{store.pendingOverride.message}</p>
          <p>
            You can still do it. Cadence will keep a warning about {overrideStudent?.name ?? "this student"} visible in Schedule health so it isn&apos;t forgotten.
          </p>
        </ConfirmDialog>
      )}

      <Toast toast={store.toast} onDismiss={store.dismissToast} />
    </div>
  );
}
