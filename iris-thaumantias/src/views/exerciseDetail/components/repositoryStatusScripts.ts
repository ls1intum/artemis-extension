/**
 * Repository Status Management Scripts
 * 
 * Handles all repository/workspace connection and status checking logic:
 * - Repository connectivity checking
 * - Status icon updates
 * - Change detection status
 * - Button state management (enable/disable submit buttons)
 * - Loading states
 */

export class RepositoryStatusScripts {
  /**
   * Generate all repository status management scripts
   */
  static generateScripts(): string {
    return `
      // Repository status checking
      window.checkRepositoryStatus = function(showChecking = false) {
          const participation = exerciseData.exercise?.studentParticipations?.[0] || exerciseData.studentParticipations?.[0];
          const repoUrl = participation?.repositoryUri;
          
          if (!repoUrl) {
              updateRepoStatusIcon('unknown', '!', 'Open the exercise repository.', false);
              updateChangeStatus('disconnected');
              updateButtonsForWorkspace(false);
              return;
          }

          if (showChecking) {
              updateRepoStatusIcon('checking', '⟳', 'Checking repository connection... Click to rerun check', false);
              updateChangeStatus('checking');
          }
          
          // Send message to extension to check repository status
          vscode.postMessage({ 
              command: 'checkRepositoryStatus',
              expectedRepoUrl: repoUrl,
              exerciseId: exerciseData.exercise?.id || exerciseData.id
          });
      };

      function updateRepoStatusIcon(status, icon, tooltip, hasChanges = false) {
          const iconElement = document.getElementById('repoStatusIcon');
          if (!iconElement) {
              return;
          }
          
          // Only show when disconnected - hide all other states
          iconElement.style.display = status === 'disconnected' ? 'flex' : 'none';
          
          iconElement.className = 'repo-status-icon ' + status + (hasChanges ? ' has-changes' : '');
          iconElement.textContent = icon;
          iconElement.title = tooltip;
          iconElement.setAttribute('aria-label', tooltip);
      }

      function updateChangeStatus(state, textOverride) {
          const statusElement = document.getElementById('changesStatus');
          const textElement = document.getElementById('changesStatusText');
          if (!statusElement || !textElement) {
              return;
          }
          statusElement.style.display = 'flex';
          statusElement.dataset.state = state;
          let text = textOverride;
          if (!text) {
              switch (state) {
                  case 'dirty':
                      text = 'Local changes detected. Ready to submit.';
                      break;
                  case 'clean':
                      text = 'No local changes detected.';
                      break;
                  case 'checking':
                      text = 'Checking workspace status...';
                      break;
                  case 'disconnected':
                  default:
                      text = 'Open the exercise repository.';
                      break;
              }
          }
          textElement.textContent = text;
      }

      function updateButtonsForWorkspace(isWorkspace, hasChanges = false) {
          const submitBtnGroup = document.getElementById('submitBtnGroup');
          const cloneBtn = document.getElementById('cloneBtn');
          const cloneDropdownItem = document.getElementById('cloneDropdownItem');
          const submitBtn = document.getElementById('submitBtn');
          const uploadBtn = document.getElementById('uploadMessageBtn');
          const commitContainer = document.getElementById('commitMessageContainer');
          const commitInput = document.getElementById('commitMessageInput');
          
          // Check both the loading class AND if progress is actively shown
          const isLoading = submitBtnGroup?.classList.contains('loading');
          const buildSection = document.querySelector('.build-status');
          const hasActiveProgress = buildSection?.dataset.progressMode != null;
          const shouldLock = isLoading || hasActiveProgress;
          
          const canSubmit = isWorkspace && hasChanges && !shouldLock;

          if (submitBtnGroup) {
              submitBtnGroup.style.display = isWorkspace ? 'flex' : 'none';
          }

          if (cloneBtn) {
              cloneBtn.style.display = isWorkspace ? 'none' : 'inline-block';
          }

          if (cloneDropdownItem) {
              cloneDropdownItem.style.display = isWorkspace ? 'block' : 'none';
          }

          const pullChangesItem = document.getElementById('pullChangesItem');
          if (pullChangesItem) {
              pullChangesItem.style.display = isWorkspace ? 'block' : 'none';
          }

          if (submitBtn) {
              if (shouldLock) {
                  submitBtn.disabled = true;
                  submitBtn.title = 'Build in progress, please wait...';
              } else {
                  submitBtn.disabled = !canSubmit;
                  submitBtn.title = !isWorkspace
                      ? 'Connect the exercise repository to enable submissions'
                      : canSubmit
                          ? 'Submit solution with automatic commit message'
                          : 'No local changes detected yet';
              }
          }

          if (uploadBtn) {
              if (shouldLock) {
                  uploadBtn.disabled = true;
                  uploadBtn.title = 'Build in progress, please wait...';
              } else {
                  uploadBtn.disabled = !canSubmit;
                  uploadBtn.title = !isWorkspace
                      ? 'Connect the exercise repository to enable submissions'
                      : canSubmit
                          ? 'Submit solution with custom commit message'
                          : 'No local changes detected yet';
              }
          }

          if (commitContainer) {
              if (shouldLock) {
                  commitContainer.style.display = 'none';
              } else if (!canSubmit) {
                  commitContainer.style.display = 'none';
                  if (commitInput) {
                      commitInput.value = '';
                  }
              }
          }

          updateChangeStatus(!isWorkspace ? 'disconnected' : hasChanges ? 'dirty' : 'clean');
      }

      function setSubmitLoading(isLoading) {
          const submitBtn = document.getElementById('submitBtn');
          const uploadBtn = document.getElementById('uploadMessageBtn');
          const submitBtnGroup = document.getElementById('submitBtnGroup');

          if (submitBtn) {
              if (isLoading) {
                  submitBtn.dataset.prevDisabled = submitBtn.disabled ? 'true' : 'false';
                  submitBtn.disabled = true;
                  submitBtn.textContent = 'Submitting...';
              } else {
                  const wasDisabled = submitBtn.dataset.prevDisabled === 'true';
                  submitBtn.disabled = wasDisabled;
                  submitBtn.textContent = 'Submit';
                  delete submitBtn.dataset.prevDisabled;
              }
          }

          if (uploadBtn) {
              if (isLoading) {
                  uploadBtn.dataset.prevDisabled = uploadBtn.disabled ? 'true' : 'false';
                  uploadBtn.disabled = true;
              } else {
                  const wasDisabled = uploadBtn.dataset.prevDisabled === 'true';
                  uploadBtn.disabled = wasDisabled;
                  delete uploadBtn.dataset.prevDisabled;
              }
          }

          if (submitBtnGroup) {
              submitBtnGroup.classList.toggle('loading', isLoading);
          }
      }

      function ensureBuildStatusSection() {
          let section = document.querySelector('.build-status');
          if (!section) {
              const participationInfo = document.querySelector('.participation-info');
              if (participationInfo) {
                  section = document.createElement('div');
                  section.className = 'build-status';
                  participationInfo.appendChild(section);
              }
          }
          return section;
      }
    `;
  }
}
