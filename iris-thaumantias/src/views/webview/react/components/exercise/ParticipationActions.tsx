import { ReactNode, useState, useRef, useEffect } from 'react';
import clsx from 'clsx';
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import Mail from 'lucide-react/dist/esm/icons/mail';
import { Button } from '../Button';
import styles from './ParticipationActions.module.css';

export type ExerciseType = 'programming' | 'quiz' | 'modeling' | 'text' | 'file-upload';
export type ParticipationStatusType = 'not-started' | 'in-progress' | 'submitted' | 'graded';
export type RepositoryStatus = 'connected' | 'disconnected' | 'checking' | 'unknown';
export type WorkspaceStatus = 'clean' | 'dirty' | 'checking' | 'disconnected' | 'wrong-repo';

export interface ParticipationActionsProps {
  exerciseType: ExerciseType;
  participationStatus: ParticipationStatusType;
  hasRepository?: boolean;
  canSubmit?: boolean;
  repositoryStatus?: RepositoryStatus;
  workspaceStatus?: WorkspaceStatus;
  workspaceMessage?: string;
  hasUnsavedChanges?: boolean;
  showCommitMessageInput?: boolean;
  commitMessage?: string;
  onStart?: () => void;
  onSubmit?: () => void;
  onSync?: () => void;
  onClone?: () => void;
  onOpenRepository?: () => void;
  onPullChanges?: () => void;
  onCopyCloneUrl?: () => void;
  onOpenInBrowser?: () => void;
  onToggleCommitMessage?: () => void;
  onCommitMessageChange?: (message: string) => void;
  onConfigureAutoSave?: () => void;
  onCheckWorkspace?: () => void;
  onStartPractice?: () => void;
  className?: string;
  isExamExercise?: boolean;
  isPracticeMode?: boolean;
  isPracticeAvailable?: boolean;
  showClonedNotice?: boolean;
  onOpenClonedRepository?: () => void;
}

export function ParticipationActions({
  exerciseType,
  participationStatus,
  hasRepository = false,
  canSubmit = false,
  repositoryStatus = 'unknown',
  workspaceStatus = 'checking',
  workspaceMessage,
  hasUnsavedChanges = false,
  showCommitMessageInput = false,
  commitMessage = '',
  onStart,
  onSubmit,
  onSync,
  onClone,
  onOpenRepository,
  onPullChanges,
  onCopyCloneUrl,
  onOpenInBrowser,
  onToggleCommitMessage,
  onCommitMessageChange,
  onConfigureAutoSave,
  onCheckWorkspace,
  onStartPractice,
  className,
  isExamExercise = false,
  isPracticeMode = false,
  isPracticeAvailable = false,
  showClonedNotice = false,
  onOpenClonedRepository,
}: ParticipationActionsProps) {
  const isProgramming = exerciseType === 'programming';
  const hasParticipation = participationStatus !== 'not-started';

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isDropdownOpen) {return;}

    const handleClickOutside = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isDropdownOpen]);

  // Participation info section
  const renderParticipationInfo = () => {
    if (isProgramming) {
      return (
        <div className={styles.participationInfo}>
          <div className={styles.participationStatus}>
            {hasParticipation ? 'Repository Ready' : 'Not Participating Yet'}
          </div>
          <div className={styles.participationMessage}>
            {hasParticipation
              ? 'You have already started this exercise.'
              : 'You have not started this exercise yet.'}
          </div>
        </div>
      );
    } else {
      // Non-programming exercise info
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

  // Practice mode indicator
  const renderPracticeModeIndicator = () => {
    if (!isPracticeMode) {return null;}
    return (
      <div className={styles.practiceModeIndicator}>
        <FlaskConical size={14} /> Practice Mode
      </div>
    );
  };

  // Workspace status indicator
  const renderWorkspaceStatus = () => {
    if (!isProgramming || !hasParticipation) {return null;}

    const statusMessage = workspaceMessage || getDefaultWorkspaceMessage(workspaceStatus);

    return (
      <div className={clsx(styles.changesStatus)} data-state={workspaceStatus}>
        <span className={styles.changesStatusIndicator} />
        <span>{statusMessage}</span>
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

  // Unsaved changes banner
  const renderUnsavedChangesBanner = () => {
    if (!hasUnsavedChanges) {return null;}
    return (
      <div className={styles.unsavedChangesBanner}>
        <AlertTriangle size={14} />
        <span className={styles.unsavedChangesText}>
          <strong>Unsaved changes detected.</strong> Please save your files before submitting.{' '}
          <Button variant="link" onClick={onConfigureAutoSave}>
            Configure auto-save
          </Button>
        </span>
      </div>
    );
  };

  // Submit button group
  const renderSubmitButtonGroup = () => {
    if (!isProgramming || !hasParticipation || !canSubmit) {return null;}
    return (
      <div className={styles.submitButtonGroup}>
        <Button variant="primary" onClick={onSubmit} fullWidth>
          Submit
        </Button>
        <button className={styles.uploadMessageBtn} onClick={onToggleCommitMessage}>
          <Mail size={14} />
        </button>
      </div>
    );
  };

  // Commit message input
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

  // Action buttons for programming exercises
  const renderProgrammingActions = () => {
    if (!isProgramming) {return null;}

    // Practice available - show practice and browser buttons
    if (isPracticeAvailable) {
      return (
        <div className={clsx(styles.participationActions, styles.notParticipated, className)}>
          <div className={styles.actionButtonRow}>
            <Button variant="primary" onClick={onStartPractice} fullWidth>
              Practice
            </Button>
            {!isExamExercise && (
              <Button variant="secondary" onClick={onOpenInBrowser} fullWidth>
                Open in browser
              </Button>
            )}
          </div>
        </div>
      );
    }

    // Not participated - show start button
    if (!hasParticipation) {
      return (
        <div className={clsx(styles.participationActions, styles.notParticipated, className)}>
          <div className={styles.actionButtonRow}>
            <Button variant="primary" onClick={onStart} fullWidth>
              Start Exercise
            </Button>
            {!isExamExercise && (
              <Button variant="secondary" onClick={onOpenInBrowser} fullWidth>
                Open in browser
              </Button>
            )}
          </div>
        </div>
      );
    }

    // Participated - show full actions
    const isWorkspaceConnected = workspaceStatus === 'clean' || workspaceStatus === 'dirty';

    return (
      <div className={clsx(styles.participationActions, className)}>
        {renderPracticeModeIndicator()}
        {renderWorkspaceStatus()}
        {renderClonedNotice()}
        {renderUnsavedChangesBanner()}
        {renderSubmitButtonGroup()}
        {renderCommitMessageInput()}
        <div className={styles.actionButtonRow}>
          {!isWorkspaceConnected && (
            <Button variant="primary" onClick={onClone} fullWidth>
              Clone Repository
            </Button>
          )}
          <div className={styles.moreMenu} ref={moreMenuRef}>
            <Button variant="link" onClick={() => setIsDropdownOpen(prev => !prev)}>
              More options ▾
            </Button>
            {isDropdownOpen && (
              <div className={styles.moreDropdown}>
                {isWorkspaceConnected && (
                  <button className={styles.dropdownItem} onClick={() => { setIsDropdownOpen(false); onClone?.(); }}>
                    Clone Repository
                  </button>
                )}
                <button className={styles.dropdownItem} onClick={() => { setIsDropdownOpen(false); onCheckWorkspace?.(); }}>
                  Check workspace status
                </button>
                <button className={styles.dropdownItem} onClick={() => { setIsDropdownOpen(false); onPullChanges?.(); }}>
                  Pull Changes
                </button>
                <button className={styles.dropdownItem} onClick={() => { setIsDropdownOpen(false); onCopyCloneUrl?.(); }}>
                  Copy Clone URL
                </button>
                {!isExamExercise && (
                  <button className={styles.dropdownItem} onClick={() => { setIsDropdownOpen(false); onOpenInBrowser?.(); }}>
                    Open in browser
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Action buttons for non-programming exercises
  const renderNonProgrammingActions = () => {
    if (isProgramming || isExamExercise) {return null;}

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

// Helper function for default workspace status messages
function getDefaultWorkspaceMessage(status: WorkspaceStatus): string {
  switch (status) {
    case 'clean':
      return 'Workspace is up to date';
    case 'dirty':
      return 'Uncommitted changes detected';
    case 'disconnected':
      return 'Repository not found in workspace';
    case 'wrong-repo':
      return 'Wrong repository open';
    case 'checking':
    default:
      return 'Checking workspace status...';
  }
}
