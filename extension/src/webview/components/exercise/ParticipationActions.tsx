import clsx from 'clsx';
import Activity from 'lucide-react/dist/esm/icons/activity';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import ArrowDownToLine from 'lucide-react/dist/esm/icons/arrow-down-to-line';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link';
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical';
import FolderOpen from 'lucide-react/dist/esm/icons/folder-open';
import GitBranch from 'lucide-react/dist/esm/icons/git-branch';
import KeyRound from 'lucide-react/dist/esm/icons/key-round';
import Link from 'lucide-react/dist/esm/icons/link';
import Mail from 'lucide-react/dist/esm/icons/mail';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@webview/components/Button';
import { useClickOutside } from '@webview/hooks/useClickOutside';

import styles from './ParticipationActions.module.css';

export const EXERCISE_TYPES = ['programming', 'quiz', 'modeling', 'text', 'file-upload'] as const;
export type ExerciseType = (typeof EXERCISE_TYPES)[number];

/** Narrow an arbitrary string (e.g. from API or persisted state) to a known ExerciseType. */
export function isExerciseType(value: string | undefined): value is ExerciseType {
    return value !== undefined && (EXERCISE_TYPES as readonly string[]).includes(value);
}

export type ParticipationStatusType = 'not-started' | 'in-progress' | 'submitted' | 'graded';
type WorkspaceStatus = 'clean' | 'dirty' | 'checking' | 'disconnected' | 'wrong-repo';

interface ParticipationActionsProps {
  exerciseType: ExerciseType;
  participationStatus: ParticipationStatusType;
  canSubmit?: boolean;
  workspaceStatus?: WorkspaceStatus;
  hasUnsavedChanges?: boolean;
  showCommitMessageInput?: boolean;
  commitMessage?: string;
  onStart?: () => void;
  onSubmit?: () => void;
  onClone?: () => void;
  onOpenRepository?: () => void;
  onPullChanges?: () => void;
  onCopyCloneUrl?: () => void;
  onCopyAuthenticatedCloneUrl?: () => void;
  onOpenInBrowser?: () => void;
  onToggleCommitMessage?: () => void;
  onCommitMessageChange?: (message: string) => void;
  onConfigureAutoSave?: () => void;
  onCheckWorkspace?: () => void;
  onStartPractice?: () => void;
  className?: string;
  isPracticeMode?: boolean;
  isPracticeAvailable?: boolean;
  showClonedNotice?: boolean;
  onOpenClonedRepository?: () => void;
  /**
   * EduIDE (managed Theia) mode. The exercise repo is already the workspace,
   * so clone affordances are meaningless: the primary Clone button becomes
   * "Open in Artemis", and the dropdown Clone / Open Repository entries hide.
   */
  isManagedEnvironment?: boolean;
}

export function ParticipationActions({
  exerciseType,
  participationStatus,
  canSubmit = false,
  workspaceStatus = 'checking',
  hasUnsavedChanges = false,
  showCommitMessageInput = false,
  commitMessage = '',
  onStart,
  onSubmit,
  onClone,
  onOpenRepository,
  onPullChanges,
  onCopyCloneUrl,
  onCopyAuthenticatedCloneUrl,
  onOpenInBrowser,
  onToggleCommitMessage,
  onCommitMessageChange,
  onConfigureAutoSave,
  onCheckWorkspace,
  onStartPractice,
  className,
  isPracticeMode = false,
  isPracticeAvailable = false,
  showClonedNotice = false,
  onOpenClonedRepository,
  isManagedEnvironment = false,
}: ParticipationActionsProps) {
  const isProgramming = exerciseType === 'programming';
  const hasParticipation = participationStatus !== 'not-started';

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useClickOutside(moreMenuRef, isDropdownOpen, () => setIsDropdownOpen(false));

  useEffect(() => {
    if (!isDropdownOpen) { return; }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isDropdownOpen]);

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

  // Practice mode indicator
  const renderPracticeModeIndicator = () => {
    if (!isPracticeMode) {return null;}
    return (
      <div className={styles.practiceModeIndicator}>
        <FlaskConical size={14} /> Practice Mode
      </div>
    );
  };

  // Cloned repository notice
  const renderClonedNotice = () => {
    if (!showClonedNotice) {return null;}
    return (
      <div className={styles.clonedRepoNotice}>
        <span>Repository recently cloned.</span>{' '}
        <Button variant="link" onClick={onOpenClonedRepository}>
          Open now
        </Button>
      </div>
    );
  };

  // Submit button group
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

  const renderCommitMessageInput = () => {
    if (!showCommitMessageInput) {return null;}
    return (
      <div className={styles.commitMessageInputContainer}>
        <input
          type="text"
          className={styles.commitMessageInput}
          placeholder="Enter commit message..."
          value={commitMessage}
          onChange={(e) => onCommitMessageChange?.(e.target.value)}
        />
      </div>
    );
  };

  const renderProgrammingActions = () => {
    if (!isProgramming) {return null;}

    if (isPracticeAvailable) {
      return (
        <div className={clsx(styles.participationActions, styles.notParticipated, className)}>
          <div className={styles.actionButtonRow}>
            <Button variant="primary" onClick={onStartPractice} fullWidth>
              Practice
            </Button>
            <Button variant="secondary" onClick={onOpenInBrowser} fullWidth>
              Open in browser
            </Button>
          </div>
        </div>
      );
    }

    if (!hasParticipation) {
      return (
        <div className={clsx(styles.participationActions, styles.notParticipated, className)}>
          <div className={styles.actionButtonRow}>
            <Button variant="primary" onClick={onStart} fullWidth>
              Start Exercise
            </Button>
            <Button variant="secondary" onClick={onOpenInBrowser} fullWidth>
              Open in browser
            </Button>
          </div>
        </div>
      );
    }

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
                <div className={styles.dropdownSection}>
                  {!isManagedEnvironment && isWorkspaceConnected && (
                    <button className={styles.dropdownItem} onClick={() => { setIsDropdownOpen(false); onClone?.(); }}>
                      <GitBranch size={14} aria-hidden="true" />
                      <span>Clone Repository</span>
                    </button>
                  )}
                  <button className={styles.dropdownItem} onClick={() => { setIsDropdownOpen(false); onCheckWorkspace?.(); }}>
                    <Activity size={14} aria-hidden="true" />
                    <span>Check workspace status</span>
                  </button>
                  {!isManagedEnvironment && onOpenRepository && (
                    <button className={styles.dropdownItem} onClick={() => { setIsDropdownOpen(false); onOpenRepository(); }}>
                      <FolderOpen size={14} aria-hidden="true" />
                      <span>Open Repository</span>
                    </button>
                  )}
                  <button className={styles.dropdownItem} onClick={() => { setIsDropdownOpen(false); onPullChanges?.(); }}>
                    <ArrowDownToLine size={14} aria-hidden="true" />
                    <span>Pull Changes</span>
                  </button>
                </div>

                {/* Split-button when BOTH copy callbacks are provided, one
                    full-width item when only one is (keeps a visible label
                    and a focus target either way). */}
                {(onCopyCloneUrl || onCopyAuthenticatedCloneUrl) && (
                  <>
                    <div className={styles.dropdownDivider} />
                    <div className={styles.dropdownSection}>
                      {onCopyCloneUrl && onCopyAuthenticatedCloneUrl ? (
                        <div className={styles.cloneUrlItem}>
                          <button
                            className={styles.cloneUrlPrimary}
                            onClick={() => { setIsDropdownOpen(false); onCopyCloneUrl(); }}
                          >
                            <Link size={14} aria-hidden="true" />
                            <span>Copy Clone URL</span>
                          </button>
                          <button
                            className={styles.cloneUrlSecondary}
                            onClick={() => { setIsDropdownOpen(false); onCopyAuthenticatedCloneUrl(); }}
                            title="Copy Clone URL with authentication token"
                            aria-label="Copy Clone URL with authentication token"
                          >
                            <KeyRound size={14} aria-hidden="true" />
                            <span>with token</span>
                          </button>
                        </div>
                      ) : onCopyCloneUrl ? (
                        <button
                          className={styles.dropdownItem}
                          onClick={() => { setIsDropdownOpen(false); onCopyCloneUrl(); }}
                        >
                          <Link size={14} aria-hidden="true" />
                          <span>Copy Clone URL</span>
                        </button>
                      ) : (
                        <button
                          className={styles.dropdownItem}
                          onClick={() => { setIsDropdownOpen(false); onCopyAuthenticatedCloneUrl?.(); }}
                        >
                          <KeyRound size={14} aria-hidden="true" />
                          <span>Copy Clone URL with Token</span>
                        </button>
                      )}
                    </div>
                  </>
                )}

                <div className={styles.dropdownDivider} />
                <div className={styles.dropdownSection}>
                  <button className={styles.dropdownItem} onClick={() => { setIsDropdownOpen(false); onOpenInBrowser?.(); }}>
                    <ExternalLink size={14} aria-hidden="true" />
                    <span>Open in browser</span>
                  </button>
                </div>
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
  };

  const renderNonProgrammingActions = () => {
    if (isProgramming) {return null;}

    return (
      <div className={clsx(styles.participationActions, className)}>
        <div className={styles.actionButtonRow}>
          <Button variant="primary" onClick={onOpenInBrowser} fullWidth>
            Open in browser
          </Button>
        </div>
      </div>
    );
  };

  return (
    <>
      {renderParticipationInfo()}
      {renderProgrammingActions()}
      {renderNonProgrammingActions()}
    </>
  );
}
