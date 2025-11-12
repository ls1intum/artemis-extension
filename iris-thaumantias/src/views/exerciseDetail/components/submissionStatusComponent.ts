import { BadgeComponent } from "../../components/badge/badgeComponent";
import { ButtonComponent } from "../../components/button/buttonComponent";
import { CloseButton } from "../../components/button/iconButtons";
import { TransformedExerciseData } from "../../utils";

export interface SubmissionStatusData {
  transformed: TransformedExerciseData;
  exercise: any;
  uploadMessageIcon: string;
  pendingSubmission?: any; // Optional: pending submission info (build in progress)
}

/**
 * Component for rendering submission status, build results, and test information
 * for both programming and non-programming exercises.
 */
export class SubmissionStatusComponent {
  /**
   * Generate the HTML for the submission status section
   */
  static generateHtml(data: SubmissionStatusData): string {
    const { transformed, exercise, pendingSubmission } = data;
    const {
      hasParticipation,
      participationId,
      latestSubmission,
      latestResult,
      isProgrammingExercise,
      isQuizExercise,
      scorePercentage = 0,
      scorePoints = 0,
      totalTests = 0,
      passedTests = 0,
      hasTestInfo = false,
    } = transformed;

    // Check if there's a pending submission (build in progress)
    // This takes priority over showing old results
    if (pendingSubmission && isProgrammingExercise) {
      console.log('🔨 Showing building state for pending submission');
      return this._generateBuildingStatus(pendingSubmission, participationId);
    }

    // No submission status to show
    if (!hasParticipation || !latestSubmission) {
      // Show empty state for programming exercises that have participation but no submissions
      if (hasParticipation && isProgrammingExercise) {
        return `
          <div class="build-status build-status--empty">
            <div class="build-status-title">Latest Build Status</div>
            <div class="build-status-info">
              <div class="build-status-placeholder">No submissions yet. Submit to see build results.</div>
            </div>
          </div>
        `;
      }
      return "";
    }

    const result = latestResult ?? null;

    // Programming Exercise Status
    if (isProgrammingExercise) {
      return this._generateProgrammingExerciseStatus({
        latestSubmission,
        result,
        participationId,
        scorePercentage,
        scorePoints,
        maxPoints: transformed.maxPoints,
        totalTests,
        passedTests,
        hasTestInfo,
      });
    }

    // Non-programming Exercise Status (but not quiz)
    if (!isQuizExercise) {
      return this._generateNonProgrammingExerciseStatus({
        latestSubmission,
        result,
        scorePercentage,
        maxPoints: exercise.maxPoints || 0,
      });
    }

    return "";
  }

  /**
   * Generate building/pending status for a submission that's currently building
   */
  private static _generateBuildingStatus(
    pendingSubmission: any,
    participationId: number | undefined
  ): string {
    const isProcessing = pendingSubmission.isProcessing || false;
    const buildStartDate = pendingSubmission.buildStartDate;
    const estimatedCompletionDate = pendingSubmission.estimatedCompletionDate;

    // Building badge
    const statusBadge = BadgeComponent.generate({
      label: isProcessing ? "Building..." : "Queued...",
      variant: "warning",
    });

    // ETA info if available
    let etaInfo = "";
    if (isProcessing && estimatedCompletionDate) {
      const eta = new Date(estimatedCompletionDate);
      const now = new Date();
      const secondsRemaining = Math.max(0, Math.floor((eta.getTime() - now.getTime()) / 1000));
      const minutesRemaining = Math.floor(secondsRemaining / 60);
      const seconds = secondsRemaining % 60;
      
      if (minutesRemaining > 0 || seconds > 0) {
        etaInfo = `
          <div class="build-eta">
            <span class="build-eta-label">Estimated completion:</span>
            <span class="build-eta-time">${minutesRemaining}m ${seconds}s</span>
          </div>
        `;
      }
    }

    return `
      <div class="build-status build-status--building" data-progress-mode="indeterminate">
        <div class="build-status-header">
          <div class="build-status-title">
            <span class="build-icon">🔨</span>
            Latest Build Status
          </div>
          ${statusBadge}
        </div>
        
        <div class="build-status-info">
          <div class="build-progress-container">
            <div class="build-progress-track">
              <div class="build-progress-bar indeterminate"></div>
            </div>
          </div>
          <div class="build-message">
            ${isProcessing 
              ? "Building and testing your code..." 
              : "Your submission is queued and will be processed soon..."}
          </div>
          ${etaInfo}
        </div>
      </div>
    `;
  }

  /**
   * Generate programming exercise build status HTML
   */
  private static _generateProgrammingExerciseStatus(data: {
    latestSubmission: any;
    result: any;
    participationId: number | undefined;
    scorePercentage: number;
    scorePoints: number;
    maxPoints: number;
    totalTests: number;
    passedTests: number;
    hasTestInfo: boolean;
  }): string {
    const {
      latestSubmission,
      result,
      participationId,
      scorePercentage,
      scorePoints,
      maxPoints,
      totalTests,
      passedTests,
      hasTestInfo,
    } = data;

    const buildFailed = latestSubmission.buildFailed;
    const successful = result ? result.successful : false;

    // Generate status badge
    let statusBadge = "";
    if (buildFailed) {
      statusBadge = BadgeComponent.generate({
        label: "Build Failed",
        variant: "error",
      });
    } else if (hasTestInfo) {
      const passPercentage = totalTests > 0 ? (passedTests / totalTests) * 100 : 0;
      const badgeVariant =
        passPercentage >= 80 ? "success" : passPercentage >= 40 ? "warning" : "error";
      statusBadge = BadgeComponent.generate({
        label: `${passedTests}/${totalTests} tests passed`,
        variant: badgeVariant,
      });
    } else {
      statusBadge = successful
        ? BadgeComponent.generate({
            label: "Build Success",
            variant: "success",
          })
        : BadgeComponent.generate({
            label: "Tests Failed",
            variant: "error",
          });
    }

    // Build action buttons
    const buildFailedButtons = buildFailed
      ? `${ButtonComponent.generate({
          label: "View build log",
          variant: "link",
          command:
            "viewBuildLog(event, " +
            participationId +
            ", " +
            (result?.id || "null") +
            ")",
          id: "buildLogLink",
          className: "build-log-link",
        })}
        ${ButtonComponent.generate({
          label: "Go to source →",
          variant: "link",
          command: "goToSourceError(event)",
          id: "goToSourceLink",
          className: "go-to-source-link",
        })}`
      : "";

    const testResultsButton = hasTestInfo
      ? ButtonComponent.generate({
          label: "See test results",
          variant: "link",
          command: "toggleTestResults(event)",
          id: "testResultsToggle",
          className: "test-results-toggle",
        })
      : "";

    const testResultsModal = hasTestInfo
      ? `<div class="test-results-modal" id="testResultsModal" aria-hidden="true" onclick="handleTestResultsBackdrop(event)">
          <div class="test-results-modal-content">
            <div class="test-results-modal-header">
              <div class="test-results-modal-title">Test Results</div>
              ${CloseButton.generate({
                command: "closeTestResultsModal()",
                title: "Close test results",
                className: "test-results-modal-close",
              })}
            </div>
            <div class="test-results-modal-body">
              <div class="test-results-container" id="testResultsContainer">
                <div class="test-results-loading">Loading test results...</div>
              </div>
            </div>
          </div>
        </div>`
      : "";

    return `
      <div class="build-status">
        <div class="build-status-title">Latest Build Status</div>
        <div class="build-status-info">
          ${statusBadge}
          <div class="score-info">
            Score: <span class="score-points">${scorePoints}/${maxPoints} (${scorePercentage.toFixed(
      2
    )}%)</span> ${maxPoints === 1 ? "point" : "points"}
          </div>
        </div>
        <div class="test-results-toggle-container">
          ${buildFailedButtons}
          ${testResultsButton}
        </div>
        ${testResultsModal}
      </div>
    `;
  }

  /**
   * Generate non-programming exercise submission status HTML
   */
  private static _generateNonProgrammingExerciseStatus(data: {
    latestSubmission: any;
    result: any;
    scorePercentage: number;
    maxPoints: number;
  }): string {
    const { latestSubmission, result, scorePercentage, maxPoints } = data;

    const submitted = latestSubmission.submitted;
    const empty = latestSubmission.empty;
    const scorePoints =
      Math.round((scorePercentage / 100) * maxPoints * 100) / 100;

    let statusBadge = "";
    let statusText = "";
    if (submitted && !empty) {
      statusBadge = '<span class="status-badge success">Submitted</span>';
      statusText = "Latest Submission Status";
    } else if (!empty) {
      statusBadge = '<span class="status-badge building">Draft Saved</span>';
      statusText = "Current Status";
    } else {
      statusBadge = '<span class="status-badge failed">No Submission</span>';
      statusText = "Submission Status";
    }

    let scoreDisplay = "";
    if (result) {
      scoreDisplay = `
        <div class="score-info">
          Score: <span class="score-points">${scorePoints}/${maxPoints} (${scorePercentage.toFixed(
        2
      )}%)</span> ${maxPoints === 1 ? "point" : "points"}
        </div>
      `;
    }

    return `
      <div class="build-status">
        <div class="build-status-title">${statusText}</div>
        <div class="build-status-info">
          ${statusBadge}
          ${scoreDisplay}
        </div>
      </div>
    `;
  }

  /**
   * Generate the JavaScript for submission status interactions
   */
  static generateScript(): string {
    return `
      // Test Results Modal Functions
      window.toggleTestResults = function(event) {
        if (event) {
          event.preventDefault();
        }

        const modal = document.getElementById('testResultsModal');

        if (!modal) {
          return;
        }

        if (modal.classList.contains('open')) {
          closeTestResultsModal();
        } else {
          openTestResultsModal();
        }
      };

      window.openTestResultsModal = function() {
        const modal = document.getElementById('testResultsModal');
        const container = document.getElementById('testResultsContainer');
        const toggle = document.getElementById('testResultsToggle');

        if (!modal || !container) {
          return;
        }

        if (modal.parentElement && modal.parentElement !== document.body) {
          document.body.appendChild(modal);
        }

        if (!modal.classList.contains('open')) {
          modal.classList.add('open');
          modal.setAttribute('aria-hidden', 'false');
          document.body.classList.add('test-results-modal-open');

          if (toggle) {
            toggle.textContent = 'Hide test results';
          }

          if (!container.dataset.loaded) {
            fetchTestResults();
          }
        }
      };

      window.closeTestResultsModal = function() {
        const modal = document.getElementById('testResultsModal');
        const toggle = document.getElementById('testResultsToggle');

        if (!modal) {
          return;
        }

        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('test-results-modal-open');

        if (toggle) {
          toggle.textContent = 'See test results';
        }
      };

      window.viewBuildLog = function(event, participationId, resultId) {
        if (event) {
          event.preventDefault();
        }

        if (!participationId) {
          vscode.postMessage({ command: 'alert', text: 'Cannot view build log: missing participation ID.' });
          return;
        }

        vscode.postMessage({
          command: 'viewBuildLog',
          participationId: participationId,
          resultId: resultId
        });
      };

      window.goToSourceError = function(event) {
        if (event) {
          event.preventDefault();
        }

        const link = document.getElementById('goToSourceLink');
        if (!link || !link.dataset.errorData) {
          vscode.postMessage({ command: 'alert', text: 'No error information available.' });
          return;
        }

        try {
          const errorData = JSON.parse(link.dataset.errorData);
          vscode.postMessage({
            command: 'goToSourceError',
            filePath: errorData.filePath,
            line: errorData.line,
            column: errorData.column,
            message: errorData.message
          });
        } catch (e) {
          vscode.postMessage({ command: 'alert', text: 'Error parsing error information.' });
        }
      };

      // Auto-fetch build logs to enable "Go to Source" button
      window.fetchBuildLogsForError = function(participationId, resultId) {
        console.log('🔍 Auto-fetching build logs to parse errors...');
        
        vscode.postMessage({
          command: 'fetchBuildLogsForError',
          participationId: participationId,
          resultId: resultId
        });
      };

      window.handleTestResultsBackdrop = function(event) {
        if (event && event.target && event.target.id === 'testResultsModal') {
          closeTestResultsModal();
        }
      };

      window.fetchTestResults = function() {
        const container = document.getElementById('testResultsContainer');
        if (!container) {
          return;
        }

        // Clear any existing timeout
        if (window.fetchTestResultsTimeout) {
          clearTimeout(window.fetchTestResultsTimeout);
        }

        // Set a timeout to prevent infinite loading (10 seconds)
        window.fetchTestResultsTimeout = setTimeout(() => {
          if (container && !container.dataset.loaded) {
            container.innerHTML = 
              '<div class="test-results-loading">' +
              'Loading timed out. The request took too long.<br>' +
              '<button onclick="fetchTestResults()" style="margin-top: 12px; padding: 8px 16px; cursor: pointer;">Retry</button>' +
              '</div>';
            container.dataset.loaded = 'true';
            console.warn('Test results fetch timed out after 10 seconds');
          }
        }, 10000);

        try {
          const participations = getStudentParticipations();

          if (!participations.length) {
            container.innerHTML = '<div class="test-results-empty">No participation found.</div>';
            container.dataset.loaded = 'true';
            return;
          }

          const latestSubmission = participations[0].submissions
            ? participations[0].submissions.reduce((latest, current) => {
                const latestId = typeof latest?.id === 'number' ? latest.id : -Infinity;
                const currentId = typeof current?.id === 'number' ? current.id : -Infinity;
                return currentId > latestId ? current : latest;
              })
            : undefined;

          if (!latestSubmission) {
            container.innerHTML = '<div class="test-results-empty">No submissions found.</div>';
            container.dataset.loaded = 'true';
            return;
          }

          const latestResult = latestSubmission.results
            ? latestSubmission.results.reduce((latest, current) => {
                const latestDate = latest?.completionDate ? new Date(latest.completionDate).getTime() : -Infinity;
                const currentDate = current?.completionDate ? new Date(current.completionDate).getTime() : -Infinity;
                
                if (latestDate === currentDate) {
                  const latestId = typeof latest?.id === 'number' ? latest.id : -Infinity;
                  const currentId = typeof current?.id === 'number' ? current.id : -Infinity;
                  return currentId > latestId ? current : latest;
                }
                
                return currentDate > latestDate ? current : latest;
              })
            : undefined;

          if (!latestResult) {
            container.innerHTML = '<div class="test-results-empty">No test results available yet.</div>';
            container.dataset.loaded = 'true';
            return;
          }

          vscode.postMessage({
            command: 'fetchTestResults',
            resultId: latestResult.id,
            participationId: participations[0].id
          });

          container.dataset.loaded = 'true';
        } catch (error) {
          console.error('Error fetching test results:', error);
          container.innerHTML = '<div class="test-results-error">Error loading test results. Please try again.</div>';
          container.dataset.loaded = 'true';
        }
      };
    `;
  }
}
