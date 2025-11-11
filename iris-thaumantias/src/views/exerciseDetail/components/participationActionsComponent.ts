import { ButtonComponent } from "../../components/button/buttonComponent";

export interface ParticipationActionsData {
  hasParticipation: boolean;
  isProgrammingExercise: boolean;
  isQuizExercise?: boolean;
  exerciseType?: string;
  exerciseTitle?: string;
  participationId?: number;
  uploadMessageIcon: string;
}

/**
 * Component for rendering participation actions (clone, submit, etc.)
 * and repository status indicators for exercises.
 */
export class ParticipationActionsComponent {
  /**
   * Generate the HTML for participation actions section
   */
  static generateHtml(data: ParticipationActionsData): string {
    const {
      hasParticipation,
      isProgrammingExercise,
      isQuizExercise,
      exerciseType,
      uploadMessageIcon,
      participationId,
    } = data;

    const changeStatusHtml =
      hasParticipation && isProgrammingExercise
        ? `
      <div class="changes-status" id="changesStatus" data-state="checking">
        <span class="changes-status-indicator"></span>
        <span id="changesStatusText">Checking workspace status...</span>
      </div>
    `
        : "";

    const actionsHtml = this._generateActionsHtml(
      hasParticipation,
      isProgrammingExercise,
      changeStatusHtml,
      uploadMessageIcon
    );

    // Determine participation info based on exercise type
    const { participationStatus, participationMessage } =
      this._getParticipationInfo(
        hasParticipation,
        isProgrammingExercise,
        isQuizExercise,
        exerciseType
      );

    // Return just the participation info and actions - NOT wrapped in participation-section
    // The participation-section wrapper will be added by the main view
    return `
      <div class="participation-info">
        <div class="participation-status">${participationStatus}</div>
        <div class="participation-message">${participationMessage}</div>
      </div>
      ${actionsHtml}
    `;
  }

  /**
   * Generate actions HTML based on participation status
   */
  private static _generateActionsHtml(
    hasParticipation: boolean,
    isProgrammingExercise: boolean,
    changeStatusHtml: string,
    uploadMessageIcon: string
  ): string {
    if (hasParticipation) {
      if (isProgrammingExercise) {
        return this._generateProgrammingExerciseActions(
          changeStatusHtml,
          uploadMessageIcon
        );
      } else {
        return this._generateNonProgrammingExerciseActions();
      }
    } else {
      if (isProgrammingExercise) {
        return this._generateNotParticipatedProgrammingActions();
      } else {
        return this._generateNotParticipatedNonProgrammingActions();
      }
    }
  }

  /**
   * Generate actions for participated programming exercises
   */
  private static _generateProgrammingExerciseActions(
    changeStatusHtml: string,
    uploadMessageIcon: string
  ): string {
    return `
      <div class="participation-actions">
        ${changeStatusHtml}
        <div class="cloned-repo-notice" id="clonedRepoNotice" style="display: none;">
          <span id="clonedRepoMessage">Repository recently cloned.</span> 
          ${ButtonComponent.generate({
            label: "Open now",
            variant: "link",
            command: "openClonedRepository(); return false;",
            className: "open-repo-link",
          })}
        </div>
        <div class="unsaved-changes-banner" id="unsavedChangesBanner" style="display: none;">
          <span class="unsaved-changes-icon">⚠️</span>
          <span class="unsaved-changes-text">
            <strong>Unsaved changes detected.</strong> Please save your files before submitting.
            ${ButtonComponent.generate({
              label: "Configure auto-save",
              variant: "link",
              command: "openAutoSaveSettings(); return false;",
              className: "unsaved-changes-link",
            })}
          </span>
        </div>
        <div class="submit-button-group" id="submitBtnGroup" style="display: none;">
          ${ButtonComponent.generate({
            label: "Submit",
            variant: "primary",
            id: "submitBtn",
            command: "submitExercise()",
            className: "participate-btn",
          })}
          ${ButtonComponent.generate({
            icon: uploadMessageIcon,
            variant: "primary",
            id: "uploadMessageBtn",
            command: "toggleCommitMessageInput()",
            className: "upload-message-btn",
          })}
        </div>
        <div class="commit-message-input-container" id="commitMessageContainer" style="display: none;">
          <input type="text" id="commitMessageInput" class="commit-message-input" placeholder="Enter commit message..." />
        </div>
        <div class="action-button-row">
          <button class="participate-btn" id="cloneBtn" onclick="cloneRepository()">Clone Repository</button>
          <div class="more-menu" id="moreMenu">
            <button class="more-toggle" onclick="toggleMoreMenu()">More options</button>
            <div class="more-dropdown">
              <button class="dropdown-item" id="cloneDropdownItem" onclick="cloneRepository()" style="display: none;">Clone Repository</button>
              <button class="dropdown-item" id="pullChangesItem" onclick="pullChanges()" style="display: none;">Pull Changes</button>
              <button class="dropdown-item" onclick="copyCloneUrl()">Copy Clone URL</button>
              <button class="dropdown-item" onclick="openExerciseInBrowser()">Open in browser</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Generate actions for participated non-programming exercises
   */
  private static _generateNonProgrammingExerciseActions(): string {
    return `
      <div class="participation-actions">
        <div class="action-button-row">
          <button class="participate-btn" onclick="openExerciseInBrowser()">Open in browser</button>
        </div>
      </div>
    `;
  }

  /**
   * Generate actions for not participated programming exercises
   */
  private static _generateNotParticipatedProgrammingActions(): string {
    return `
      <div class="participation-actions not-participated">
        <div class="action-button-row">
          <button class="participate-btn" onclick="participateInExercise()">Start Exercise</button>
          <button class="participate-btn secondary" onclick="openExerciseInBrowser()">Open in browser</button>
        </div>
      </div>
    `;
  }

  /**
   * Generate actions for not participated non-programming exercises
   */
  private static _generateNotParticipatedNonProgrammingActions(): string {
    return `
      <div class="participation-actions not-participated">
        <div class="action-button-row">
          <button class="participate-btn" onclick="openExerciseInBrowser()">Open in browser</button>
        </div>
      </div>
    `;
  }

  /**
   * Get participation status and message text
   */
  private static _getParticipationInfo(
    hasParticipation: boolean,
    isProgrammingExercise: boolean,
    isQuizExercise: boolean | undefined,
    exerciseType: string | undefined
  ): { participationStatus: string; participationMessage: string } {
    if (isProgrammingExercise) {
      return {
        participationStatus: hasParticipation
          ? "Repository Ready"
          : "Not Participating Yet",
        participationMessage: hasParticipation
          ? "You have already started this exercise."
          : "You have not started this exercise yet.",
      };
    } else {
      // For non-programming exercises (quiz, modeling, text, file-upload)
      const rawType = exerciseType || "";
      const normalizedType =
        typeof rawType === "string" ? rawType.toLowerCase() : "";
      const cleanedType = normalizedType.replace(/_/g, " ").replace(/-/g, " ");
      const exerciseTypeDisplay = cleanedType
        ? cleanedType.charAt(0).toUpperCase() + cleanedType.slice(1)
        : "Course";
      const exerciseTypePlain = cleanedType || "course";

      return {
        participationStatus: `${exerciseTypeDisplay} Exercise`,
        participationMessage: `This is a ${exerciseTypePlain} exercise. Complete it in the browser.`,
      };
    }
  }
}
