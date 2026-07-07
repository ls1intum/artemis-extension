# Repository-Ready Card Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Declutter the participated-programming "Repository Ready" card in the Exercise Detail view (a compact header + a state-aware action + a one-line build row), touching only presentation.

**Architecture:** Pure presentational restructure of two sibling React components — `SubmissionStatus.tsx` (build row) and `ParticipationActions.tsx` (participation card) — plus their CSS modules and their vitest React test files. No new props, messages, server fields, or wiring in `ExerciseDetailView.tsx`. All data already flows into both components. Full design + rationale: `docs/superpowers/specs/2026-07-07-repository-ready-card-redesign-design.md` (codex-approved).

**Tech Stack:** React + TypeScript (VS Code webview), CSS Modules, vitest + @testing-library/react (happy-dom), lucide-react icons.

## Global Constraints

- **Scope is the participated + programming card only.** Non-programming exercises, the not-started / practice-available branches, and the "More options" dropdown *contents* are unchanged. `ExerciseDetailView.tsx` is not modified.
- **Exact copy (verbatim):** title `Repository Ready`; menu trigger `More ▾`; workspace hints — clean `Up to date`, dirty `Uncommitted changes ready to submit`, disconnected/wrong-repo `Repository not in your workspace`, checking `Checking workspace…` (real ellipsis `…`); auto-save warning `Unsaved files.` (bold) + `Save before submitting.` + link `Configure auto-save`; building keeps today's `Building your submission...` / `Building your submission... (ETA: {n}s)` / `Build queued, waiting for resources...` (ASCII `...`, unchanged); no-submission line `No builds yet — submit to see results`; build-failed `Build failed` + primary button `Go to source` + link `Open log` + optional link `Results`; test badge `{passed}/{total} tests`; status badge `Build Success` / `Tests Failed`; score expression `{pts}/{max} p ({pct}%)` where `pts = parseFloat(score.toFixed(1))`, `pct = scorePercentage.toFixed(1)`, or just `{pct}%` when `maxScore === 0`.
- **Colour tiers** reuse existing theme vars and thresholds (`>= 80` green `--vscode-testing-iconPassed`, `>= 40` amber `--vscode-editorWarning-foreground`, else red `--vscode-errorForeground`). Badge tier keyed on test-pass %; score number keyed on `scorePercentage`.
- **CSS Modules are camelCase-only in the production esbuild build** — only use static camelCase `styles.foo` lookups, never dynamic kebab-case `styles['foo-bar']`.
- **Status is never colour-only** — every hint/badge keeps its text alongside the colour.
- **Verify before "done":** run the file's vitest suite, then `npm --prefix extension run check-types` (tsc `--noEmit`, catches unused vars/imports) and `npm --prefix extension run lint`. All must pass.
- **Commits:** no AI attribution, no `Co-Authored-By: Claude`, no robot emoji, no em dashes (`—`) in the commit message. Stage only the files listed in the task.
- **Run commands from anywhere via `npm --prefix extension …`** (the package lives in `extension/`). vitest path filters are relative to `extension/`.

---

### Task 1: SubmissionStatus — build row redesign

Rework the `exerciseType === 'programming'` rendering of `SubmissionStatus` into: a bar-only building state, a one-line finished-with-tests row (outlined badge + points + `Results`), a finished-without-test-info status-badge row, a build-failed text + `Go to source` / `Open log` (+ optional `Results`) row, and a single muted no-submission line. Non-programming rendering is untouched.

**Files:**
- Modify: `extension/src/webview/components/exercise/SubmissionStatus.tsx`
- Modify: `extension/src/webview/components/exercise/SubmissionStatus.module.css`
- Test: `extension/test/react/views/ExerciseDetail/components/SubmissionStatus.test.tsx`

**Interfaces:**
- Consumes (unchanged props, already passed by `ExerciseDetailView`): `status`, `score`, `maxScore`, `scorePercentage`, `totalTests`, `passedTests`, `hasTestInfo`, `buildFailed`, `exerciseType`, `estimatedCompletionDate`, `buildStartDate`, `onViewBuildLog`, `onGoToSource`, `onOpenTestResults`.
- Produces: no new exported symbols. `SubmissionStatus` keeps its signature.

- [ ] **Step 1: Update + extend the test file to the new copy/behaviour (make it fail first)**

Apply these edits to `extension/test/react/views/ExerciseDetail/components/SubmissionStatus.test.tsx`:

Replace the no-submission assertions:
```tsx
	it('shows no-submission state for programming exercise', () => {
		render(<SubmissionStatus status="no-submission" exerciseType="programming" />);
		expect(screen.getByText('No builds yet — submit to see results')).toBeInTheDocument();
	});
```
Delete the test `shows "Latest Build Status" title for no-submission programming exercise` entirely (the title is removed).

Replace the building / pending tests (drop the removed `Build in Progress` title):
```tsx
	it('shows building state with an indeterminate bar (no fixed width) and message', () => {
		render(<SubmissionStatus status="building" />);
		expect(screen.getByText('Building your submission...')).toBeInTheDocument();
		// No timing info -> indeterminate bar carries no inline width.
		expect(screen.getByTestId('build-progress-bar').style.width).toBe('');
	});

	it('shows pending state with queued message', () => {
		render(<SubmissionStatus status="pending" />);
		expect(screen.getByText(/Build queued/)).toBeInTheDocument();
	});
```

Replace the build-failed test (badge -> text + actions):
```tsx
	it('shows Build failed text with Go to source and Open log when buildFailed is true', () => {
		render(<SubmissionStatus status="failed" buildFailed={true} score={0} maxScore={0} scorePercentage={0} />);
		expect(screen.getByText('Build failed')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Go to source' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Open log' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Results' })).not.toBeInTheDocument();
	});

	it('appends a Results link when buildFailed and hasTestInfo', () => {
		render(
			<SubmissionStatus
				status="failed"
				buildFailed={true}
				hasTestInfo={true}
				totalTests={5}
				passedTests={1}
				score={4}
				maxScore={100}
				scorePercentage={4}
			/>
		);
		expect(screen.getByText('Build failed')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Results' })).toBeInTheDocument();
	});
```

Replace the test-pass badge and results-link copy:
```tsx
	it('shows test pass count badge (X/Y tests) when hasTestInfo is true', () => {
		render(
			<SubmissionStatus
				status="success"
				hasTestInfo={true}
				totalTests={10}
				passedTests={8}
				score={80}
				maxScore={100}
				scorePercentage={80}
			/>
		);
		expect(screen.getByText('8/10 tests')).toBeInTheDocument();
	});

	it('shows Results link when hasTestInfo is true', () => {
		render(
			<SubmissionStatus
				status="success"
				hasTestInfo={true}
				totalTests={5}
				passedTests={5}
				score={100}
				maxScore={100}
				scorePercentage={100}
			/>
		);
		expect(screen.getByRole('button', { name: 'Results' })).toBeInTheDocument();
	});

	it('calls onOpenTestResults when Results link is clicked', async () => {
		const onOpen = vi.fn();
		render(
			<SubmissionStatus
				status="success"
				hasTestInfo={true}
				totalTests={5}
				passedTests={4}
				score={80}
				maxScore={100}
				scorePercentage={80}
				onOpenTestResults={onOpen}
			/>
		);
		await userEvent.click(screen.getByRole('button', { name: 'Results' }));
		expect(onOpen).toHaveBeenCalledOnce();
	});
```

Add points-format tests:
```tsx
	it('renders points expression "pts/max p (pct%)" when the exercise has points', () => {
		render(
			<SubmissionStatus
				status="failed"
				hasTestInfo={true}
				totalTests={35}
				passedTests={8}
				score={23.1}
				maxScore={101}
				scorePercentage={22.9}
			/>
		);
		expect(screen.getByText(/23\.1\/101 p/)).toBeInTheDocument();
		expect(screen.getByText(/\(22\.9%\)/)).toBeInTheDocument();
	});

	it('falls back to just the percent when the exercise has no points (maxScore 0)', () => {
		render(
			<SubmissionStatus
				status="failed"
				hasTestInfo={true}
				totalTests={35}
				passedTests={8}
				score={0}
				maxScore={0}
				scorePercentage={22.9}
			/>
		);
		expect(screen.getByText('22.9%')).toBeInTheDocument();
		expect(screen.queryByText(/ p /)).not.toBeInTheDocument();
	});
```

Add a determinate-bar test inside the existing `building ETA countdown` `describe` block (it already has fake timers with `const start`/`const eta` and system time at `start`), right after the ETA-countdown test:
```tsx
		it('renders a determinate bar (fixed width, not indeterminate) with timing info', () => {
			render(
				<SubmissionStatus
					status="building"
					buildStartDate={start}
					estimatedCompletionDate={eta}
				/>,
			);
			// Determinate builds carry an inline width (>= 5%); indeterminate ones do not.
			expect(screen.getByTestId('build-progress-bar').style.width).not.toBe('');
		});
```

Keep unchanged: `shows success build status badge for success state` (`Build Success`), `shows failed build status badge for failed state` (`Tests Failed`), `displays score fraction in programming exercise` (`/75\/100/` still matches `75/100 p`), the four non-programming tests, and the existing `building ETA countdown` test (`Building your submission... (ETA: 60s)`).

- [ ] **Step 2: Run the suite to confirm it fails**

Run: `npm --prefix extension run test:react -- test/react/views/ExerciseDetail/components/SubmissionStatus.test.tsx`
Expected: FAIL (new copy/roles not yet rendered, e.g. `Unable to find text: No builds yet…`, missing `Go to source` button).

- [ ] **Step 3: Rewrite the programming rendering in `SubmissionStatus.tsx`**

3a. Remove the now-unused `Badge` import (the programming branch no longer uses it; non-programming uses `styles.statusBadge` spans, not `Badge`):
```tsx
// DELETE this line near the top:
import { Badge } from '@webview/components/Badge';
```
(Keep `import { Button } …`, `import { ReactNode } …`, `useBuildProgress`, `clsx`.)

3b. Replace the no-submission programming block (currently the `if (status === 'no-submission' && exerciseType === 'programming')` return) with:
```tsx
  if (status === 'no-submission' && exerciseType === 'programming') {
    return (
      <div className={clsx(styles.buildStatus, styles.buildStatusEmpty, className)}>
        <div className={styles.buildStatusPlaceholder}>No builds yet — submit to see results</div>
      </div>
    );
  }
```

3c. Replace the building/pending block with (drop the `Build in Progress` title; bar first, then message):
```tsx
  if (status === 'building' || status === 'pending') {
    const hasDeterminateProgress = status === 'building' && progressPercent !== null;

    let message: string;
    if (status === 'pending') {
      message = 'Build queued, waiting for resources...';
    } else if (etaSeconds !== null) {
      message = `Building your submission... (ETA: ${etaSeconds}s)`;
    } else {
      message = 'Building your submission...';
    }

    return (
      <div className={clsx(styles.buildStatus, styles.buildStatusBuilding, className)}>
        <div className={styles.buildProgressTrack}>
          <div
            data-testid="build-progress-bar"
            className={clsx(styles.buildProgressBar, {
              [styles.buildProgressBarIndeterminate]: !hasDeterminateProgress,
            })}
            style={hasDeterminateProgress ? { width: `${progressPercent}%` } : undefined}
          />
        </div>
        <div className={styles.buildStatusMessage}>{message}</div>
      </div>
    );
  }
```

3d. Replace the completed-build section — the `statusBadge` ReactNode computation, the `scoreColorClass` block, and the entire `if (exerciseType === 'programming') { … }` return — with the following (the non-programming code after it stays untouched):
```tsx
  // Score colour tier (shared by the programming build rows).
  let scoreColorClass = styles.scoreError;
  if (scorePercentage >= 80) {
    scoreColorClass = styles.scoreSuccess;
  } else if (scorePercentage >= 40) {
    scoreColorClass = styles.scoreWarning;
  }

  // "23.1/101 p (22.9%)" when the exercise has points, else just "22.9%".
  const scoreExpr = maxScore > 0 ? (
    <>
      {parseFloat(score.toFixed(1))}/{maxScore} p{' '}
      <span className={styles.scorePercentDim}>({scorePercentage.toFixed(1)}%)</span>
    </>
  ) : (
    <>{scorePercentage.toFixed(1)}%</>
  );

  if (exerciseType === 'programming') {
    // Build failed takes precedence (a compile failure usually ran no tests).
    if (buildFailed) {
      return (
        <div className={clsx(styles.buildStatus, className)}>
          <div className={styles.buildFailedRow}>
            <span className={styles.buildFailedIcon} aria-hidden="true">✕</span>
            <span className={styles.buildFailedText}>Build failed</span>
          </div>
          <div className={styles.buildFailedActions}>
            <Button variant="primary" onClick={onGoToSource}>Go to source</Button>
            <Button variant="link" onClick={onViewBuildLog}>Open log</Button>
            {hasTestInfo && (
              <Button variant="link" onClick={onOpenTestResults}>Results</Button>
            )}
          </div>
        </div>
      );
    }

    // Finished with test-case info: outlined test badge + points + Results link.
    if (hasTestInfo && totalTests > 0) {
      const passPercentage = (passedTests / totalTests) * 100;
      const badgeColorClass = passPercentage >= 80 ? styles.testBadgeSuccess
        : passPercentage >= 40 ? styles.testBadgeWarning
        : styles.testBadgeError;
      return (
        <div className={clsx(styles.buildStatus, className)}>
          <div className={styles.buildRow}>
            <span className={clsx(styles.testBadge, badgeColorClass)}>
              {passedTests}/{totalTests} tests
            </span>
            <span className={clsx(styles.scoreExpr, scoreColorClass)}>{scoreExpr}</span>
            <Button variant="link" onClick={onOpenTestResults}>Results</Button>
          </div>
        </div>
      );
    }

    // Finished, no test-case info: status badge (Build Success / Tests Failed) + points, no Results.
    const statusLabel = status === 'success' ? 'Build Success' : 'Tests Failed';
    const statusBadgeClass = status === 'success' ? styles.testBadgeSuccess : styles.testBadgeError;
    return (
      <div className={clsx(styles.buildStatus, className)}>
        <div className={styles.buildRow}>
          <span className={clsx(styles.testBadge, statusBadgeClass)}>{statusLabel}</span>
          <span className={clsx(styles.scoreExpr, scoreColorClass)}>{scoreExpr}</span>
        </div>
      </div>
    );
  }
```

- [ ] **Step 4: Add the CSS for the new build rows**

Append to `extension/src/webview/components/exercise/SubmissionStatus.module.css`:
```css
/* Redesigned build row */
.buildRow {
  display: flex;
  align-items: center;
  gap: 8px 10px;
  flex-wrap: wrap;
  width: 100%;
}

/* Outlined status/test badge (border + coloured text, transparent fill) */
.testBadge {
  display: inline-block;
  border: 1px solid var(--vscode-panel-border, #e0e0e0);
  border-radius: 4px;
  padding: 3px 9px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.testBadgeSuccess { border-color: var(--vscode-testing-iconPassed, #73c991); color: var(--vscode-testing-iconPassed, #73c991); }
.testBadgeWarning { border-color: var(--vscode-editorWarning-foreground, #cca700); color: var(--vscode-editorWarning-foreground, #cca700); }
.testBadgeError { border-color: var(--vscode-errorForeground, #f48771); color: var(--vscode-errorForeground, #f48771); }

.scoreExpr {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-size: 13px;
  font-weight: 600;
}
.scorePercentDim {
  color: var(--vscode-descriptionForeground, var(--vscode-foreground));
  font-weight: 400;
}

/* Build failed */
.buildFailedRow { display: flex; align-items: center; gap: 8px; }
.buildFailedIcon { color: var(--vscode-errorForeground, #f48771); font-weight: 700; }
.buildFailedText { color: var(--vscode-errorForeground, #f48771); font-weight: 600; }
.buildFailedActions { display: flex; align-items: center; gap: 14px; margin-top: 10px; }
```
(The existing `.scoreSuccess/.scoreWarning/.scoreError` classes are reused by `scoreColorClass`; `.buildStatusEmpty`, `.buildStatusTitle`, `.buildProgressTrack/Bar` remain — `.buildStatusTitle` is still used by the non-programming branch.)

- [ ] **Step 5: Run the suite and type/lint checks**

Run: `npm --prefix extension run test:react -- test/react/views/ExerciseDetail/components/SubmissionStatus.test.tsx`
Expected: PASS (all cases green).

Run: `npm --prefix extension run check-types`
Expected: PASS (no unused `Badge` import, no type errors).

Run: `npm --prefix extension run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add extension/src/webview/components/exercise/SubmissionStatus.tsx \
        extension/src/webview/components/exercise/SubmissionStatus.module.css \
        extension/test/react/views/ExerciseDetail/components/SubmissionStatus.test.tsx
git commit -m "refactor(exercise): compact build row (bar while building, badge+points, failed actions)"
```

---

### Task 2: ParticipationActions — participation card redesign

Restructure the participated + programming branch into: header (`Repository Ready` title + `More ▾` trigger), a colour-coded workspace hint (or the auto-save warning when connected + unsaved), and a state-aware action (`Submit` + `✉`, or `Clone Repository` / `Open in Artemis`). Retain the practice-mode chip and cloned-repo notice. Non-programming and not-started branches unchanged.

**Files:**
- Modify: `extension/src/webview/components/exercise/ParticipationActions.tsx`
- Modify: `extension/src/webview/components/exercise/ParticipationActions.module.css`
- Test: `extension/test/react/components/exercise/ParticipationActions.test.tsx`

**Interfaces:**
- Consumes (unchanged props): `exerciseType`, `participationStatus`, `canSubmit`, `workspaceStatus`, `hasUnsavedChanges`, `showCommitMessageInput`, `commitMessage`, `isPracticeMode`, `isPracticeAvailable`, `showClonedNotice`, `isManagedEnvironment`, and all `on*` callbacks. `workspaceMessage` is dropped from the destructuring (no caller passes it; the hint text is derived from `workspaceStatus`).
- Produces: no new exported symbols.

- [ ] **Step 1: Update + extend the test file (make it fail first)**

Apply these edits to `extension/test/react/components/exercise/ParticipationActions.test.tsx`:

Retarget the Clone-when-participating test (default `checking` now shows a disabled Submit, not Clone):
```tsx
		it('renders "Clone Repository" button when the repo is not in the workspace', () => {
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
					workspaceStatus="disconnected"
				/>
			);
			expect(screen.getByRole('button', { name: 'Clone Repository' })).toBeInTheDocument();
		});
```

Global find/replace in this file: change every `name: /More options/i` and `name: /More options/` matcher to the exact `name: 'More ▾'` (the trigger is now `More ▾`). Use the exact string, NOT a loose `/More/` regex: in the integrated view (Task 3) a separate `AskIris` proactive-control button can be labeled `More`, so a loose matcher is ambiguous. Applies to the dropdown/copy/managed-env tests.

Replace the unsaved-changes test (warning is connected-only, with new copy):
```tsx
		it('shows the unsaved-files warning when connected and hasUnsavedChanges', () => {
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
					workspaceStatus="clean"
					hasUnsavedChanges={true}
				/>
			);
			expect(screen.getByText(/Save before submitting/)).toBeInTheDocument();
		});
```

Replace the four workspace-status-indicator text assertions with the new copy (keep the `data-state` queries):
```tsx
			expect(screen.getByText('Up to date')).toBeInTheDocument();                       // clean
			expect(screen.getByText('Uncommitted changes ready to submit')).toBeInTheDocument(); // dirty
			expect(screen.getByText('Repository not in your workspace')).toBeInTheDocument();  // disconnected
			expect(screen.getByText('Checking workspace…')).toBeInTheDocument();               // checking (default)
```
(Leave each test's `container.querySelector('[data-state="…"]')` assertion as-is.)

Add new behaviour tests inside the `programming exercise - in progress` describe block:
```tsx
		it('shows a disabled Submit (not Clone) while checking', () => {
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
					canSubmit={true}
					workspaceStatus="checking"
				/>
			);
			expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
			expect(screen.queryByRole('button', { name: 'Clone Repository' })).not.toBeInTheDocument();
		});

		it('suppresses the auto-save warning when disconnected (workspace hint wins)', () => {
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
					workspaceStatus="disconnected"
					hasUnsavedChanges={true}
				/>
			);
			expect(screen.queryByText(/Save before submitting/)).not.toBeInTheDocument();
			expect(screen.getByText('Repository not in your workspace')).toBeInTheDocument();
		});

		it('gives the commit-message toggle an accessible name', () => {
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
					canSubmit={true}
					workspaceStatus="dirty"
				/>
			);
			expect(screen.getByRole('button', { name: 'Add a commit message' })).toBeInTheDocument();
		});
```

Keep unchanged: the `not-started` tests, `shows "Repository Ready" participation info` (title now lives in the header), Submit render/click tests (they use `workspaceStatus="dirty"`), `does not render Submit button when canSubmit is false` (default checking + `canSubmit` false), commit-message input show/hide, practice-mode indicator, the dropdown/copy/managed-env tests (after the `/More/` rename), and all non-programming tests.

- [ ] **Step 2: Run the suite to confirm it fails**

Run: `npm --prefix extension run test:react -- test/react/components/exercise/ParticipationActions.test.tsx`
Expected: FAIL (new copy/roles/behaviour not yet rendered).

- [ ] **Step 3: Rewrite the participated-programming rendering in `ParticipationActions.tsx`**

3a. Remove `workspaceMessage` from the destructured props (top of the component) so it is not an unused binding. Leave it in the `ParticipationActionsProps` interface (optional, no caller passes it) or delete it there too — either passes `check-types`; deleting from the interface is cleaner.

3b. Add a hint-text map + two render helpers (place them near the other `render*` helpers, after `renderParticipationInfo`):
```tsx
  const WORKSPACE_HINT_TEXT: Record<WorkspaceStatus, string> = {
    clean: 'Up to date',
    dirty: 'Uncommitted changes ready to submit',
    disconnected: 'Repository not in your workspace',
    'wrong-repo': 'Repository not in your workspace',
    checking: 'Checking workspace…',
  };

  const renderWorkspaceHint = () => (
    <div className={styles.workspaceHint} data-state={workspaceStatus}>
      <span className={styles.workspaceHintDot} />
      <span>{WORKSPACE_HINT_TEXT[workspaceStatus]}</span>
    </div>
  );

  const renderAutoSaveWarning = () => (
    <div className={styles.autoSaveWarning}>
      <AlertTriangle size={14} />
      <span className={styles.autoSaveWarningText}>
        <strong>Unsaved files.</strong> Save before submitting.{' '}
        <Button variant="link" onClick={onConfigureAutoSave}>Configure auto-save</Button>
      </span>
    </div>
  );
```

3c. Change `renderParticipationInfo` so the participated-programming case renders nothing (the header replaces it):
```tsx
  const renderParticipationInfo = () => {
    if (isProgramming) {
      if (hasParticipation) { return null; }
      return (
        <div className={styles.participationInfo}>
          <div className={styles.participationStatus}>Not Participating Yet</div>
          <div className={styles.participationMessage}>You have not started this exercise yet.</div>
        </div>
      );
    } else {
      const exerciseTypeDisplay = exerciseType.charAt(0).toUpperCase() + exerciseType.slice(1).replace('-', ' ');
      return (
        <div className={styles.participationInfo}>
          <div className={styles.participationStatus}>{exerciseTypeDisplay} Exercise</div>
          <div className={styles.participationMessage}>
            This is a {exerciseType.replace('-', ' ')} exercise. Complete it in the browser.
          </div>
        </div>
      );
    }
  };
```

3d. Replace `renderSubmitButtonGroup` so it always renders (Submit + ✉), disabled unless dirty, with an accessible name on the ✉ button (the caller gates visibility):
```tsx
  const renderSubmitButtonGroup = () => {
    const disabled = workspaceStatus !== 'dirty';
    return (
      <div className={styles.submitButtonGroup}>
        <Button variant="primary" onClick={onSubmit} fullWidth disabled={disabled}>
          Submit
        </Button>
        <button
          className={styles.uploadMessageBtn}
          onClick={onToggleCommitMessage}
          disabled={disabled}
          aria-label="Add a commit message"
        >
          <Mail size={14} />
        </button>
      </div>
    );
  };
```

3e. Delete the now-unused helpers `renderWorkspaceStatus` and `renderUnsavedChangesBanner`, and the module-scope helper function `getDefaultWorkspaceMessage` at the bottom of the file (all replaced by `renderWorkspaceHint` / `renderAutoSaveWarning` / `WORKSPACE_HINT_TEXT`). Leaving them causes an unused-symbol failure under `check-types`.

3f. Replace the participated case of `renderProgrammingActions` (the final `return (<div className={clsx(styles.participationActions, className)}> … </div>)` that today contains `renderWorkspaceStatus()`, `renderClonedNotice()`, `renderUnsavedChangesBanner()`, `renderSubmitButtonGroup()`, `renderCommitMessageInput()` and the action row with the More menu) with:
```tsx
    // Participated - the redesigned card.
    const isWorkspaceConnected = workspaceStatus === 'clean' || workspaceStatus === 'dirty';
    const showClone = workspaceStatus === 'disconnected' || workspaceStatus === 'wrong-repo';
    const showSubmit = !showClone && canSubmit;
    const showAutoSaveWarning = hasUnsavedChanges && isWorkspaceConnected;

    return (
      <div className={clsx(styles.participationActions, className)}>
        {renderPracticeModeIndicator()}

        <div className={styles.cardHeader}>
          <span className={styles.cardTitle}>Repository Ready</span>
          <div className={styles.headerMore} ref={moreMenuRef}>
            <Button variant="link" onClick={() => setIsDropdownOpen(prev => !prev)}>
              More ▾
            </Button>
            {isDropdownOpen && (
              <div className={styles.moreDropdown}>
                {/* KEEP the existing dropdown inner JSX exactly as today: the three
                    sections (Workspace / Share / External) with all their callbacks.
                    Only this wrapper moved from the action row into the header and the
                    wrapper class changed from styles.moreMenu to styles.headerMore. */}
              </div>
            )}
          </div>
        </div>

        {showAutoSaveWarning ? renderAutoSaveWarning() : renderWorkspaceHint()}
        {renderClonedNotice()}

        {showClone && (
          isManagedEnvironment ? (
            <Button variant="primary" onClick={onOpenInBrowser} fullWidth>
              Open in Artemis
            </Button>
          ) : (
            <Button variant="primary" onClick={onClone} fullWidth>
              Clone Repository
            </Button>
          )
        )}

        {showSubmit && (
          <>
            {renderSubmitButtonGroup()}
            {renderCommitMessageInput()}
          </>
        )}
      </div>
    );
```
IMPORTANT: paste the real dropdown inner JSX (the `{/* Section: Workspace */}` … `{/* Section: External */}` blocks that currently sit inside `{isDropdownOpen && (<div className={styles.moreDropdown}> … </div>)}`) verbatim in place of the comment above. It is unchanged. The `isWorkspaceConnected` local that used to guard the dropdown's inline Clone entry stays valid there (it is `workspaceStatus === 'clean' || workspaceStatus === 'dirty'`) — keep that expression where the dropdown uses it.

- [ ] **Step 4: Add the CSS for the header, hint, and warning**

Append to `extension/src/webview/components/exercise/ParticipationActions.module.css`:
```css
/* Redesigned participated card */
.cardHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.cardTitle {
  font-size: 14px;
  font-weight: 600;
  color: var(--vscode-foreground);
}
/* More trigger anchored in the header, dropdown drops down-right */
.headerMore {
  position: relative;
  margin-left: auto;
}
.headerMore .moreDropdown {
  left: auto;
  right: 0;
  min-width: 240px;
}

/* Colour-coded workspace hint (reuses the changesPulse keyframes below) */
.workspaceHint {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--vscode-foreground);
}
.workspaceHintDot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--vscode-panel-border, #e0e0e0);
  flex-shrink: 0;
}
.workspaceHint[data-state='clean'] { color: var(--vscode-testing-iconPassed, #73c991); opacity: 0.9; font-size: 11.5px; }
.workspaceHint[data-state='clean'] .workspaceHintDot { background: var(--vscode-testing-iconPassed, #73c991); }
.workspaceHint[data-state='dirty'] { color: var(--vscode-editorWarning-foreground, #cca700); }
.workspaceHint[data-state='dirty'] .workspaceHintDot { background: var(--vscode-editorWarning-foreground, #cca700); }
.workspaceHint[data-state='disconnected'],
.workspaceHint[data-state='wrong-repo'] { color: var(--vscode-errorForeground, #f48771); }
.workspaceHint[data-state='disconnected'] .workspaceHintDot,
.workspaceHint[data-state='wrong-repo'] .workspaceHintDot { background: var(--vscode-errorForeground, #f48771); }
.workspaceHint[data-state='checking'] { color: var(--vscode-foreground); opacity: 0.7; }
.workspaceHint[data-state='checking'] .workspaceHintDot { background: var(--vscode-panel-border, #e0e0e0); animation: changesPulse 1.2s ease-in-out infinite; }

/* Auto-save / unsaved-files warning (takes the hint slot when connected) */
.autoSaveWarning {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 5px;
  background: var(--vscode-inputValidation-warningBackground, rgba(204, 167, 0, 0.12));
  border: 1px solid var(--vscode-editorWarning-foreground, #cca700);
  font-size: 12px;
}
.autoSaveWarningText {
  flex: 1;
  color: var(--vscode-foreground);
  line-height: 1.4;
}
```
(The existing `@keyframes changesPulse` stays and is now referenced by `.workspaceHint[data-state='checking']`. The old `.changesStatus*` and `.unsavedChangesBanner*` rules become unused but are harmless CSS; leave them to keep the diff focused, or remove them — CSS-module unused classes do not fail lint/build.)

- [ ] **Step 5: Run the suite and type/lint checks**

Run: `npm --prefix extension run test:react -- test/react/components/exercise/ParticipationActions.test.tsx`
Expected: PASS.

Run: `npm --prefix extension run check-types`
Expected: PASS (no unused `workspaceMessage`, `renderWorkspaceStatus`, `renderUnsavedChangesBanner`, `getDefaultWorkspaceMessage`).

Run: `npm --prefix extension run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add extension/src/webview/components/exercise/ParticipationActions.tsx \
        extension/src/webview/components/exercise/ParticipationActions.module.css \
        extension/test/react/components/exercise/ParticipationActions.test.tsx
git commit -m "refactor(exercise): compact Repository Ready card (header + workspace hint + state-aware action)"
```

---

### Task 3: Integration-test fixups + full-suite verification

`ExerciseDetailView.test.tsx` renders the full card (both redesigned components) and matches two renamed labels. It only goes green once BOTH Task 1 (`See test results` → `Results`) and Task 2 (`More options` → `More ▾`) have landed, so its fixups live here. (Verified during planning: these four matchers are the *only* other references to the changed copy in the whole `extension/src` + `extension/test` tree.)

**Files:**
- Test: `extension/test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx`

- [ ] **Step 1: Update the four stale matchers**

In `extension/test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx`:
- Line ~274 and ~323: change `screen.getByRole('button', { name: /More options/i })` to `screen.getByRole('button', { name: 'More ▾' })`. Use the exact string, not `/More/`: `ExerciseDetailView` always renders `AskIris`, which can surface its own button named `More`, so a loose matcher is ambiguous here.
- Line ~440 and ~492: change `screen.getByRole('button', { name: /see test results/i })` to `screen.getByRole('button', { name: /Results/i })` (the link that opens the results overlay is now `Results`).

No other assertion in this file changes: the two Submit tests use `hasChanges: true` (dirty → Submit enabled), and the managed+connected test only asserts Submit is *present* (a disabled button still resolves via `getByRole`).

- [ ] **Step 2: Run the whole vitest React suite**

Run: `npm --prefix extension run test:react`
Expected: PASS (all suites, including `ExerciseDetailView.test.tsx`, `SubmissionStatus.test.tsx`, `ParticipationActions.test.tsx`).

- [ ] **Step 3: Type-check and lint the whole package**

Run: `npm --prefix extension run check-types`
Run: `npm --prefix extension run lint`
Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add extension/test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx
git commit -m "test(exercise): retarget ExerciseDetailView matchers to the redesigned card labels"
```

## Self-Review

- **Spec coverage:** header title + `More ▾` (T2 3f), workspace state matrix incl. wrong-repo→disconnected and checking→disabled-Submit (T2 3b/3f), managed `Open in Artemis` (T2 3f), auto-save priority connected-only + never gates Submit (T2 3f), building determinate/indeterminate/pending (T1 3c), finished-with-tests badge+points+Results (T1 3d), finished-without-test-info (T1 3d), build-failed text + Go to source/Open log + optional Results (T1 3d), no-submission line (T1 3b), points `x/y p (z%)` + no-points fallback (T1 3d), retained practice chip + cloned notice (T2 3f), ✉ aria-label (T2 3d), test updates (T1 S1, T2 S1). All covered.
- **Placeholder scan:** the only "keep existing JSX" reference (T2 3f dropdown) points at a concrete, unchanged block with explicit paste instructions, not a vague TODO. No `TBD`/`handle edge cases`/etc.
- **Type consistency:** `WorkspaceStatus` is the existing local union (`clean | dirty | checking | disconnected | wrong-repo`); `WORKSPACE_HINT_TEXT` is a total `Record<WorkspaceStatus,string>`. `styles.*` names in the code match the CSS added in the same task. Copy strings match the Global Constraints and the test assertions verbatim.
