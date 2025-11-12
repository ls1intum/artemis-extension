import { BadgeComponent } from "../../components/badge/badgeComponent";

export interface BuildProgressData {
  state: 'BUILDING' | 'QUEUED' | 'IDLE';
  message?: string;
  progressPercent?: number;
  isIndeterminate?: boolean;
  buildTimingInfo?: {
    buildStartDate?: string;
    estimatedCompletionDate?: string;
  };
}

/**
 * Component for rendering build progress bars with ETA support.
 * Used for both initial server-side rendering and client-side dynamic updates.
 */
export class BuildProgressComponent {
  /**
   * Generate the HTML for build progress section (for initial page load)
   */
  static generateHtml(data: BuildProgressData): string {
    const { state, message, progressPercent = 5, isIndeterminate = true, buildTimingInfo } = data;

    // Calculate initial progress and message
    const { displayMessage, calculatedProgress, calculatedIndeterminate } = 
      this._calculateProgress(state, message, progressPercent, isIndeterminate, buildTimingInfo);

    // Generate progress bar HTML
    const progressBarClass = calculatedIndeterminate ? 'build-progress-bar indeterminate' : 'build-progress-bar';
    const progressBarStyle = calculatedIndeterminate ? '' : `width: ${calculatedProgress}%`;

    // Store buildTimingInfo in data attributes for client-side updates
    const timingDataAttrs = buildTimingInfo?.estimatedCompletionDate && buildTimingInfo?.buildStartDate
      ? `data-eta="${buildTimingInfo.estimatedCompletionDate}" data-start="${buildTimingInfo.buildStartDate}"`
      : '';

    return `
      <div class="build-status build-status--building" data-progress-mode="${calculatedIndeterminate ? 'indeterminate' : 'determinate'}" ${timingDataAttrs}>
        <div class="build-status-title">Build in Progress</div>
        <div class="build-status-info">
          <div class="build-status-message">${displayMessage}</div>
          <div class="build-progress-track">
            <div class="${progressBarClass}" style="${progressBarStyle}"></div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Calculate progress information based on build timing
   */
  private static _calculateProgress(
    state: string,
    message: string | undefined,
    progressPercent: number,
    isIndeterminate: boolean,
    buildTimingInfo?: { buildStartDate?: string; estimatedCompletionDate?: string }
  ): { displayMessage: string; calculatedProgress: number; calculatedIndeterminate: boolean } {
    let displayMessage = message || (state === 'BUILDING' ? 'Building your submission...' : '⏳ Build queued, waiting for resources...');
    let calculatedProgress = progressPercent;
    let calculatedIndeterminate = isIndeterminate;

    // If we have timing info, calculate progress and ETA
    if (state === 'BUILDING' && buildTimingInfo?.estimatedCompletionDate && buildTimingInfo?.buildStartDate) {
      const eta = new Date(buildTimingInfo.estimatedCompletionDate);
      const startDate = new Date(buildTimingInfo.buildStartDate);
      const now = new Date();
      const totalTime = eta.getTime() - startDate.getTime();
      const elapsed = now.getTime() - startDate.getTime();
      
      calculatedProgress = Math.min(100, Math.max(5, (elapsed / totalTime) * 100));
      calculatedIndeterminate = false;

      const seconds = Math.max(0, Math.floor((eta.getTime() - now.getTime()) / 1000));
      if (seconds > 0) {
        displayMessage = `Building your submission... (ETA: ${seconds}s)`;
      } else {
        displayMessage = 'Building your submission...';
        calculatedIndeterminate = true; // Switch to indeterminate if past ETA
      }
    } else if (state === 'QUEUED') {
      calculatedProgress = 5;
      calculatedIndeterminate = true;
    }

    return { displayMessage, calculatedProgress, calculatedIndeterminate };
  }

  /**
   * Generate client-side JavaScript for build progress updates
   */
  static generateScript(): string {
    return `
      /**
       * Render build progress (called from client-side)
       */
      window.renderBuildProgress = function(section, messageText, progressPercent, isIndeterminate = false) {
        if (!section) {
          return;
        }

        section.classList.remove('build-status--empty');
        section.classList.add('build-status--building');
        section.innerHTML = '';

        const title = document.createElement('div');
        title.className = 'build-status-title';
        title.textContent = 'Build in Progress';

        const info = document.createElement('div');
        info.className = 'build-status-info';

        const messageEl = document.createElement('div');
        messageEl.className = 'build-status-message';
        messageEl.textContent = messageText;

        const track = document.createElement('div');
        track.className = 'build-progress-track';

        const bar = document.createElement('div');
        bar.className = 'build-progress-bar';
        if (isIndeterminate) {
          bar.classList.add('indeterminate');
        } else {
          const width = Math.max(5, Math.min(100, progressPercent || 0));
          bar.style.width = width + '%';
        }

        track.appendChild(bar);
        info.appendChild(messageEl);
        info.appendChild(track);

        section.appendChild(title);
        section.appendChild(info);

        section.dataset.progressMode = isIndeterminate ? 'indeterminate' : 'determinate';
      };

      /**
       * Update build status with progress and ETA
       */
      window.updateBuildStatusWithProgress = function(message, progressPercent, buildTimingInfo, isIndeterminate = false) {
        const buildStatusSection = ensureBuildStatusSection();
        if (!buildStatusSection) return;
        
        renderBuildProgress(buildStatusSection, message, progressPercent, isIndeterminate);
        
        // Update progress bar periodically if we have timing info
        if (buildTimingInfo?.estimatedCompletionDate && buildTimingInfo?.buildStartDate) {
          if (window.buildProgressInterval) {
            clearInterval(window.buildProgressInterval);
          }
          
          window.buildProgressInterval = setInterval(() => {
            const eta = new Date(buildTimingInfo.estimatedCompletionDate);
            const startDate = new Date(buildTimingInfo.buildStartDate);
            const now = new Date();
            const totalTime = eta - startDate;
            const elapsed = now - startDate;
            const percent = Math.min(100, Math.max(5, (elapsed / totalTime) * 100));
            
            const progressBar = buildStatusSection.querySelector('.build-progress-bar');
            const messageEl = buildStatusSection.querySelector('.build-status-message');
            
            if (progressBar) {
              // If past ETA, switch to indeterminate progress bar
              if (now >= eta) {
                progressBar.style.width = '100%';
                progressBar.classList.add('indeterminate');
              } else {
                progressBar.style.width = percent + '%';
                progressBar.classList.remove('indeterminate');
              }
            }
            
            // Update ETA message
            const seconds = Math.max(0, Math.floor((eta - now) / 1000));
            if (messageEl) {
              if (seconds > 0) {
                messageEl.textContent = 'Building your submission... (ETA: ' + seconds + 's)';
              } else {
                // After ETA expires, show indefinite loading message
                messageEl.textContent = 'Building your submission...';
              }
            }
          }, 500); // Update every 500ms
        }
      };

      /**
       * Handle submission processing state updates from WebSocket
       */
      window.handleSubmissionProcessing = function(state, buildTimingInfo) {
        console.log('⚙️ Received submission processing update:', state, buildTimingInfo);
        
        let message = '';
        let progressPercent = 0;
        let isIndeterminate = false;
        let isBuilding = false;
        
        switch (state) {
          case 'BUILDING':
            message = 'Building your submission...';
            isBuilding = true;
            if (buildTimingInfo?.estimatedCompletionDate && buildTimingInfo?.buildStartDate) {
              const eta = new Date(buildTimingInfo.estimatedCompletionDate);
              const startDate = new Date(buildTimingInfo.buildStartDate);
              const now = new Date();
              const totalTime = eta - startDate;
              const elapsed = now - startDate;
              progressPercent = Math.min(100, Math.max(0, (elapsed / totalTime) * 100));
              
              const seconds = Math.max(0, Math.floor((eta - now) / 1000));
              if (seconds > 0) {
                message = 'Building your submission... (ETA: ' + seconds + 's)';
              }
            }
            isIndeterminate = !buildTimingInfo || !buildTimingInfo.estimatedCompletionDate || !buildTimingInfo.buildStartDate;
            break;
          case 'QUEUED':
            message = '⏳ Build queued, waiting for resources...';
            isBuilding = true;
            progressPercent = 5;
            isIndeterminate = true;
            break;
        }
        
        if (isBuilding) {
          updateBuildStatusWithProgress(message, progressPercent, buildTimingInfo, isIndeterminate);
          setSubmitLoading(true);
        }
      };

      /**
       * Initialize build progress updates on page load if timing data exists
       */
      (function initializeBuildProgress() {
        const buildStatusSection = document.querySelector('.build-status--building');
        if (!buildStatusSection) return;

        const etaAttr = buildStatusSection.getAttribute('data-eta');
        const startAttr = buildStatusSection.getAttribute('data-start');

        if (etaAttr && startAttr) {
          console.log('🔄 Initializing build progress updates from page load data');
          const buildTimingInfo = {
            estimatedCompletionDate: etaAttr,
            buildStartDate: startAttr
          };

          // Start the progress update interval immediately
          if (window.buildProgressInterval) {
            clearInterval(window.buildProgressInterval);
          }

          window.buildProgressInterval = setInterval(() => {
            const eta = new Date(buildTimingInfo.estimatedCompletionDate);
            const startDate = new Date(buildTimingInfo.buildStartDate);
            const now = new Date();
            const totalTime = eta - startDate;
            const elapsed = now - startDate;
            const percent = Math.min(100, Math.max(5, (elapsed / totalTime) * 100));

            const progressBar = buildStatusSection.querySelector('.build-progress-bar');
            const messageEl = buildStatusSection.querySelector('.build-status-message');

            if (progressBar) {
              // If past ETA, switch to indeterminate progress bar
              if (now >= eta) {
                progressBar.style.width = '100%';
                progressBar.classList.add('indeterminate');
                buildStatusSection.dataset.progressMode = 'indeterminate';
              } else {
                progressBar.style.width = percent + '%';
                progressBar.classList.remove('indeterminate');
                buildStatusSection.dataset.progressMode = 'determinate';
              }
            }

            // Update ETA message
            const seconds = Math.max(0, Math.floor((eta - now) / 1000));
            if (messageEl) {
              if (seconds > 0) {
                messageEl.textContent = 'Building your submission... (ETA: ' + seconds + 's)';
              } else {
                // After ETA expires, show indefinite loading message
                messageEl.textContent = 'Building your submission...';
              }
            }
          }, 500); // Update every 500ms
        }
      })();
    `;
  }
}
