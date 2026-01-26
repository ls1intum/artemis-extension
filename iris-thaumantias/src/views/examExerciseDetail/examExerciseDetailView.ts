import * as vscode from "vscode";
import { IconDefinitions } from "../../utils";
import { readCssFiles, processMarkdown, transformExerciseData } from "../utils";
import { BackLinkComponent } from "../components/backLink/backLinkComponent";
import { ButtonComponent } from "../components/button/buttonComponent";
import { FullscreenButton, CloseButton } from "../components/button/iconButtons";
import { BadgeComponent } from "../components/badge/badgeComponent";
import { ContainerComponent } from "../components/container/containerComponent";
import { AskIrisComponent } from "../components/askIris/askIrisComponent";
import { SubmissionStatusComponent } from "../exerciseDetail/components/submissionStatusComponent";
import { ParticipationActionsComponent } from "../exerciseDetail/components/participationActionsComponent";
import { RepositoryStatusScripts } from "../exerciseDetail/components/repositoryStatusScripts";
import { BuildProgressComponent } from "../exerciseDetail/components/buildProgressComponent";

export interface ExamContext {
    isExamExercise: boolean;
    courseId: number;
    examId: number;
    studentExam?: any;
}

export class ExamExerciseDetailView {
    private _extensionContext: vscode.ExtensionContext;

    constructor(
        extensionContext: vscode.ExtensionContext
    ) {
        this._extensionContext = extensionContext;
    }

    private _getExerciseIcon(type: string): string {
        return IconDefinitions.getIcon(type);
    }

    private _getUploadMessageIcon(): string {
        return IconDefinitions.getIcon("uploadMessage");
    }

    public generateHtml(
        exerciseData: any,
        hideDeveloperTools: boolean = false,
        webview?: vscode.Webview,
        examContext?: ExamContext
    ): string {
        const styles = readCssFiles(
            "components/backLink/back-link.css",
            "examExerciseDetail/exam-exercise-detail.css",
            "components/button/button.css",
            "components/button/iconButtons/iconButtons.css",
            "components/badge/badge.css",
            "components/container/container.css",
            "components/askIris/ask-iris.css"
        );

        // Get webview URI for the bundled components script (only if webview is provided)
        let webviewComponentsScriptTag = '';
        if (webview) {
            const webviewComponentsUri = webview.asWebviewUri(
                vscode.Uri.joinPath(
                    this._extensionContext.extensionUri,
                    'dist',
                    'webview-components.js'
                )
            );
            webviewComponentsScriptTag = `<script src="${webviewComponentsUri}"></script>`;
        }

        if (!exerciseData) {
            return this._getEmptyStateHtml(styles, webviewComponentsScriptTag, examContext);
        }

        return this._getExerciseDetailHtml(
            exerciseData,
            hideDeveloperTools,
            styles,
            webviewComponentsScriptTag,
            examContext
        );
    }

    private _getEmptyStateHtml(styles: string, webviewComponentsScriptTag: string, examContext?: ExamContext): string {
        const isExam = examContext?.isExamExercise ?? false;
        const backCommand = isExam ? "backToExam" : "backToCourseDetails";
        const backLabel = isExam ? "← Back to Exam" : "← Back to Course";

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Exercise Details</title>
    <style>
        ${styles}
    </style>
    ${webviewComponentsScriptTag}
</head>
<body>
    ${BackLinkComponent.generateHtml({
            command: backCommand,
            label: backLabel,
        })}
    
    <div class="empty-state">
        <h2>Exercise Details</h2>
        <p>Select an exercise to view its details</p>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        ${BackLinkComponent.generateScript()}
    </script>
</body>
</html>`;
    }

    private _getExerciseDetailHtml(
        exerciseData: any,
        hideDeveloperTools: boolean,
        styles: string,
        webviewComponentsScriptTag: string,
        examContext?: ExamContext
    ): string {
        const isExam = examContext?.isExamExercise ?? false;

        // For exam exercises, the exercise is passed directly; for regular exercises, it's wrapped
        const exercise = isExam ? exerciseData : exerciseData?.exercise;

        if (!exercise) {
            return this._getEmptyStateHtml(styles, webviewComponentsScriptTag, examContext);
        }

        // Transform exercise data using utility
        const transformed = transformExerciseData(exercise);

        // Extract transformed data for use in template
        const exerciseIcon = this._getExerciseIcon(exercise.type);
        const uploadMessageIcon = this._getUploadMessageIcon();
        const starAssistIcon = IconDefinitions.getIcon("star_4_edges");

        // Process markdown problem statement
        const { html: problemStatement, downloadLinks, plantUmlDiagrams } =
            processMarkdown(exercise.problemStatement || "No description available");

        // Course information
        const course = exercise.course;
        const courseName = course?.title || "Unknown Course";
        const semester = course?.semester || "No semester";
        const exerciseId = exercise.id || 0;
        const exerciseShortName = exercise.shortName || "";
        const releaseDateRaw = exercise.releaseDate || exercise.startDate || "";
        const dueDateRaw = exercise.dueDate || "";

        // Exam-specific settings
        const backCommand = isExam ? "backToExam" : "backToCourseDetails";
        const backLabel = isExam ? "← Back to Exam" : "← Back to Course";

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Exercise Details</title>
    <style>
        ${styles}
    </style>
    ${webviewComponentsScriptTag}
</head>
<body>
    <div class="back-link-container">
        ${BackLinkComponent.generateHtml({
            command: backCommand,
            label: backLabel,
            wrap: false,
        })}
        ${!isExam ? FullscreenButton.generate({
            id: 'fullscreenBtn',
            command: 'toggleFullscreen()',
            title: 'Open exercise in new editor tab'
        }) : ''}
    </div>
    
    <details class="exercise-card">
        <summary>
            <div class="summary-content">
                <div class="summary-text">
                    <div class="exercise-title">${transformed.exerciseTitle}</div>
                    <div class="exercise-meta">
                        <div class="exercise-icon-badge">${exerciseIcon}</div>
                        ${BadgeComponent.generate({
            label: `${transformed.maxPoints} ${transformed.maxPoints === 1 ? "point" : "points"}${transformed.bonusPoints > 0 ? ` + ${transformed.bonusPoints} bonus` : ""}`,
            variant: 'primary'
        })}
                        ${transformed.timeRemainingDisplay
                ? BadgeComponent.generate({
                    label: transformed.timeRemainingDisplay,
                    variant: 'secondary',
                    className: transformed.isDueSoon ? "due-soon" : ""
                })
                : ""
            }
                        ${!isExam ? `<button class="repo-status-icon unknown" id="repoStatusIcon" onclick="checkRepositoryStatus(true)" title="Check repository status">
                            ?
                        </button>` : ''}
                    </div>
                </div>
                <span class="toggle-icon" aria-hidden="true">
                    <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
                        <path d="M3 6l5 4 5-4" />
                    </svg>
                </span>
            </div>
        </summary>
        <div class="expanded-content">
            <div class="exercise-info-grid">
                <div class="info-item">
                    <div class="info-label">Release Date</div>
                    <div class="info-value">${transformed.releaseDate}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Mode</div>
                    <div class="info-value">${transformed.mode}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Grading</div>
                    <div class="info-value">${transformed.includedInScore}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Course</div>
                    <div class="info-value course-pill">
                        <span>${courseName}</span>
                        ${semester
                ? BadgeComponent.generate({
                    label: semester,
                    variant: 'secondary',
                    className: 'course-semester-badge badge-compact',
                    height: '1.5rem'
                })
                : ''
            }
                    </div>
                </div>
                ${transformed.filePattern
                ? `
                <div class="info-item">
                    <div class="info-label">File Formats</div>
                    <div class="info-value">${transformed.filePattern}</div>
                </div>
                `
                : ""
            }
            </div>
        </div>
    </details>
    

    ${(() => {
                // Generate submission status and participation actions using components
                const buildStatusHtml = SubmissionStatusComponent.generateHtml({
                    transformed,
                    exercise,
                    uploadMessageIcon,
                    pendingSubmission: exerciseData.pendingSubmission // Pass pending submission if exists
                });

                const participationActionsHtml = ParticipationActionsComponent.generateHtml({
                    hasParticipation: transformed.hasParticipation,
                    isProgrammingExercise: transformed.isProgrammingExercise,
                    isQuizExercise: transformed.isQuizExercise,
                    exerciseType: exercise.type || exercise.exerciseType,
                    participationId: transformed.participationId,
                    uploadMessageIcon,
                    isPracticeAvailable: transformed.isPracticeAvailable,
                    practiceParticipation: transformed.practiceParticipation,
                    isExamExercise: true
                });

                // Wrap everything in the participation container using ContainerComponent
                return ContainerComponent.generate({
                    id: 'participation-section',
                    bodyHtml: `${participationActionsHtml}${buildStatusHtml}`,
                    dataAttributes: {
                        'has-participation': String(transformed.hasParticipation),
                        'participation-id': String(transformed.participationId || '')
                    }
                });
            })()}

    ${AskIrisComponent.generate({
                id: 'iris-assist-section',
                className: 'iris-assist-section',
                title: 'Ask Iris about this exercise',
                description: 'Open the Iris chat to discuss this exercise or get guidance.',
                buttonId: 'askIrisAboutExerciseBtn'
            })}

    ${ContainerComponent.generate({
                id: 'exercise-description',
                header: {
                    title: 'Exercise Description'
                },
                bodyHtml: `<div class="problem-statement">${problemStatement}</div>
        ${downloadLinks.length > 0
                        ? `
        <div class="downloads-section">
            <div class="downloads-section-title">Downloads</div>
            <div class="download-links">
                ${downloadLinks
                            .map(
                                (link) => `
                    ${ButtonComponent.generate({
                                    label: `<span class="download-icon">📄</span>${link.text}`,
                                    variant: 'link',
                                    command: `downloadFile('${link.url}', '${link.text}')`,
                                    className: 'download-link'
                                })}
                `
                            )
                            .join("")}
            </div>
        </div>
        `
                        : ""
                    }`
            })}
    
    ${!hideDeveloperTools
                ? `
    <div class="action-buttons">
        ${ButtonComponent.generate({
                    label: 'Open Raw JSON',
                    variant: 'secondary',
                    command: 'openInEditor()'
                })}
        ${ButtonComponent.generate({
                    label: 'Copy Exercise Data',
                    variant: 'secondary',
                    command: 'copyToClipboard()'
                })}
        ${ButtonComponent.generate({
                    label: 'Submission Details',
                    variant: 'secondary',
                    command: 'showSubmissionDetails()'
                })}
    </div>
    `
                : ""
            }

    <script>
        const vscode = acquireVsCodeApi();
        const exerciseData = ${JSON.stringify(exerciseData)};
        
        // Make exercise data available globally for WebSocket handlers
        window.exerciseData = exerciseData;

        function getActiveExercise() {
            const raw = window.exerciseData;
            if (!raw) {
                return null;
            }
            if (raw.exercise && typeof raw.exercise === 'object') {
                return raw.exercise;
            }
            return raw;
        }

        function getStudentParticipations() {
            const exercise = getActiveExercise();
            const participations = exercise?.studentParticipations;
            return Array.isArray(participations) ? participations : [];
        }

        // Get latest submission by ID (matches Artemis client)
        // IDs are database auto-increment, guaranteed sequential with submission time
        function getLatestSubmission(participation) {
            const submissions = participation?.submissions;
            if (!Array.isArray(submissions) || submissions.length === 0) {
                return undefined;
            }
            return submissions.reduce((latest, current) => {
                const latestId = typeof latest?.id === 'number' ? latest.id : -Infinity;
                const currentId = typeof current?.id === 'number' ? current.id : -Infinity;
                return currentId > latestId ? current : latest;
            });
        }

        // Get latest result by completionDate (matches Artemis client)
        // Results can complete out of order due to varying build times
        // Uses completionDate to ensure the most recently completed result is returned
        function getLatestResult(submission) {
            const results = submission?.results;
            if (!Array.isArray(results) || results.length === 0) {
                return undefined;
            }
            return results.reduce((latest, current) => {
                const latestDate = latest?.completionDate ? new Date(latest.completionDate).getTime() : -Infinity;
                const currentDate = current?.completionDate ? new Date(current.completionDate).getTime() : -Infinity;
                
                // Fallback to ID if completionDates are equal or missing (rare edge case)
                if (latestDate === currentDate) {
                    const latestId = typeof latest?.id === 'number' ? latest.id : -Infinity;
                    const currentId = typeof current?.id === 'number' ? current.id : -Infinity;
                    return currentId > latestId ? current : latest;
                }
                
                return currentDate > latestDate ? current : latest;
            });
        }

        function matchesActiveExercise(entity) {
            const exercise = getActiveExercise();
            if (!exercise || !exercise.id) {
                return true;
            }

            const candidateIds = [
                entity?.exercise?.id,
                entity?.participation?.exercise?.id,
                entity?.submission?.participation?.exercise?.id
            ].filter((id) => typeof id === 'number');

            if (candidateIds.length === 0) {
                return true;
            }

            return candidateIds.every((id) => id === exercise.id);
        }

        function resolveParticipationById(participations, participationId) {
            if (typeof participationId !== 'number') {
                return undefined;
            }
            return participations.find((participation) => participation.id === participationId);
        }

        function resolveParticipationForSubmission(submission) {
            const participations = getStudentParticipations();
            if (!submission || participations.length === 0) {
                return undefined;
            }

            if (!matchesActiveExercise(submission)) {
                return undefined;
            }

            const participationId = submission?.participation?.id;
            if (typeof participationId === 'number') {
                return resolveParticipationById(participations, participationId);
            }

            return participations.length === 1 ? participations[0] : undefined;
        }

        function resolveParticipationForResult(result) {
            const participations = getStudentParticipations();
            if (!result || participations.length === 0) {
                return undefined;
            }

            if (!matchesActiveExercise(result)) {
                return undefined;
            }

            const participationId =
                (result?.participation && typeof result.participation.id === 'number'
                    ? result.participation.id
                    : undefined) ??
                (result?.submission && result.submission.participation && typeof result.submission.participation.id === 'number'
                    ? result.submission.participation.id
                    : undefined);

            if (typeof participationId === 'number') {
                return resolveParticipationById(participations, participationId);
            }

            return participations.length === 1 ? participations[0] : undefined;
        }

        function findLatestSubmissionContext() {
            const participations = getStudentParticipations();
            let latestContext;

            participations.forEach((participation) => {
                const candidate = getLatestSubmission(participation);
                if (!candidate) {
                    return;
                }
                const candidateId = typeof candidate?.id === 'number' ? candidate.id : -Infinity;
                const latestId = latestContext?.submission?.id;
                const currentLatestId = typeof latestId === 'number' ? latestId : -Infinity;
                
                if (!latestContext || candidateId > currentLatestId) {
                    latestContext = { participation, submission: candidate };
                }
            });

            return latestContext;
        }
        
        // Store PlantUML diagrams for rendering
        const plantUmlDiagrams = ${JSON.stringify(plantUmlDiagrams)};
        
        // Timeout for test results fetching to prevent infinite loading
        let fetchTestResultsTimeout = null;
        
        // Auto-render PlantUML diagrams
        function renderPlantUmlDiagram(index, plantUml) {
            const placeholder = document.querySelector(\`.plantuml-placeholder[data-index="\${index}"]\`);
            if (!placeholder) {
                console.error('PlantUML placeholder not found for index:', index);
                return;
            }
            
            console.log(\`🎨 Auto-rendering PlantUML diagram \${index + 1}/\${plantUmlDiagrams.length}\`);
            
            // Request rendering from VS Code
            vscode.postMessage({
                command: 'renderPlantUmlInline',
                plantUml: plantUml,
                index: index
            });
        }
        
        // Listen for rendered PlantUML responses
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'plantUmlRendered') {
                const placeholder = document.querySelector(\`.plantuml-placeholder[data-index="\${message.index}"]\`);
                if (placeholder) {
                    const container = document.createElement('div');
                    container.className = 'plantuml-rendered';
                    container.innerHTML = message.svg;
                    container.setAttribute('data-plantuml', placeholder.getAttribute('data-plantuml'));
                    container.setAttribute('data-index', message.index);
                    container.style.cursor = 'pointer';
                    container.title = 'Click to open in new tab';
                    
                    // Make it clickable to open in new tab
                    container.addEventListener('click', () => {
                        const plantUml = decodeURIComponent(container.getAttribute('data-plantuml'));
                        vscode.postMessage({
                            command: 'openPlantUmlInNewTab',
                            plantUml: plantUml,
                            index: message.index
                        });
                    });
                    
                    placeholder.parentNode.replaceChild(container, placeholder);
                    console.log(\`✅ PlantUML diagram \${message.index + 1} rendered successfully\`);
                }
            } else if (message.command === 'plantUmlError') {
                const placeholder = document.querySelector(\`.plantuml-placeholder[data-index="\${message.index}"]\`);
                if (placeholder) {
                    const errorDiv = document.createElement('div');
                    errorDiv.className = 'plantuml-error';
                    errorDiv.textContent = \`Error rendering PlantUML: \${message.error}\`;
                    placeholder.parentNode.replaceChild(errorDiv, placeholder);
                    console.error(\`❌ PlantUML diagram \${message.index + 1} failed to render:\`, message.error);
                }
            }
        });
        
        // Auto-render all PlantUML diagrams on page load
        if (plantUmlDiagrams.length > 0) {
            console.log(\`📊 Found \${plantUmlDiagrams.length} PlantUML diagram(s), auto-rendering...\`);
            plantUmlDiagrams.forEach((diagram, index) => {
                renderPlantUmlDiagram(index, diagram);
            });
        }
        
        const askIrisExerciseBtn = document.getElementById('askIrisAboutExerciseBtn');
        
        if (askIrisExerciseBtn) {
            askIrisExerciseBtn.addEventListener('click', () => {
                vscode.postMessage({
                    command: 'askIrisAboutExercise',
                    exerciseId: ${exerciseId},
                    exerciseTitle: ${JSON.stringify(transformed.exerciseTitle)},
                    exerciseShortName: ${JSON.stringify(exerciseShortName)},
                    releaseDate: ${JSON.stringify(releaseDateRaw)},
                    dueDate: ${JSON.stringify(dueDateRaw)},
                    courseId: ${exerciseData.exercise?.course?.id || exerciseData.course?.id}
                });
            });
        }
        
        ${BackLinkComponent.generateScript()}
        
        ${ContainerComponent.generateScript()}
        
        ${SubmissionStatusComponent.generateScript()}
        
        // PlantUML render function
        window.renderPlantUmlDiagrams = function() {
            if (plantUmlDiagrams.length > 0) {
                console.log('[PlantUML] 🎨 Rendering PlantUML diagrams:', plantUmlDiagrams);
                vscode.postMessage({
                    command: 'renderPlantUml',
                    plantUmlDiagrams: plantUmlDiagrams,
                    exerciseTitle: ${JSON.stringify(transformed.exerciseTitle)}
                });
            }
        };
        
        window.downloadFile = function(url, filename) {
            vscode.postMessage({ 
                command: 'downloadFile',
                url: url,
                filename: filename
            });
        };
        
        window.openInEditor = function() {
            vscode.postMessage({ 
                command: 'openInEditor',
                data: exerciseData
            });
        };
        
        window.copyToClipboard = function() {
            vscode.postMessage({
                command: 'copyToClipboard',
                text: JSON.stringify(exerciseData, null, 2)
            });
        };

        window.showSubmissionDetails = function() {
            try {
                const participations = getStudentParticipations();

                if (!participations.length) {
                    vscode.postMessage({ command: 'alert', text: 'No participation found. Start the exercise first.' });
                    return;
                }

                const latestContext = findLatestSubmissionContext();

                if (!latestContext) {
                    vscode.postMessage({ command: 'alert', text: 'No submissions found yet.' });
                    return;
                }

                const latestResult = getLatestResult(latestContext.submission);

                if (!latestResult) {
                    vscode.postMessage({ command: 'alert', text: 'No results found for the latest submission.' });
                    return;
                }

                vscode.postMessage({
                    command: 'showSubmissionDetails',
                    participationId: latestContext.participation.id,
                    resultId: latestResult.id
                });
            } catch (e) {
                console.error('Error preparing submission details:', e);
                vscode.postMessage({ command: 'alert', text: 'Error preparing submission details operation.' });
            }
        };

        window.renderTestResults = function(testCases) {
            // Clear the timeout since results have arrived
            if (fetchTestResultsTimeout) {
                clearTimeout(fetchTestResultsTimeout);
                fetchTestResultsTimeout = null;
            }

            const container = document.getElementById('testResultsContainer');
            if (!container) {
                return;
            }

            console.log('[Test Results] Rendering test results:', testCases);

            if (!testCases || !testCases.length) {
                container.innerHTML = '<div class="test-results-loading">No test results available</div>';
                container.dataset.loaded = 'true';
                return;
            }

            // Store original test cases for filtering
            window.allTestCases = testCases;

            // Sort test cases: failed first, then passed
            const sortedTests = [...testCases].sort((a, b) => {
                const aSuccessful = a.successful === true;
                const bSuccessful = b.successful === true;
                if (aSuccessful === bSuccessful) {
                    return 0;
                }
                return aSuccessful ? 1 : -1;
            });

            const failedCount = testCases.filter(t => !t.successful).length;
            const passedCount = testCases.filter(t => t.successful).length;

            const testItemsHtml = sortedTests.map((test, index) => {
                const passed = test.successful === true;
                const statusClass = passed ? 'passed' : 'failed';
                const icon = passed ? '✓' : '✗';
                const testName = test.testName || 'Unnamed Test';
                const message = test.detailText || test.message || (passed ? 'Test passed' : 'Test failed');
                const testType = test.type || 'BEHAVIORAL';

                // HTML escape the message to prevent HTML injection and display special characters
                const escapeHtml = (str) => {
                    const div = document.createElement('div');
                    div.textContent = str;
                    return div.innerHTML;
                };
                const escapedMessage = escapeHtml(message);

                // Format test type for display
                const typeLabel = testType === 'STRUCTURAL' ? 'Structural' :
                                testType === 'BEHAVIORAL' ? 'Behavioral' : testType;

                const typeBadgeHtml = \`<span class="test-type-badge test-type-\${testType.toLowerCase()}">\${typeLabel}</span>\`;

                return \`
                    <div class="test-result-item \${statusClass}" data-test-index="\${index}" data-test-name="\${testName.toLowerCase()}" data-test-type="\${testType}" data-test-status="\${statusClass}">
                        <div class="test-result-icon \${statusClass}">\${icon}</div>
                        <div class="test-result-content">
                            <div class="test-result-header">
                                <div class="test-result-name">\${testName}</div>
                                \${typeBadgeHtml}
                            </div>
                            <div class="test-result-message">\${escapedMessage}</div>
                        </div>
                    </div>
                \`;
            }).join('');

            container.innerHTML = \`
                <div class="test-results-controls">
                    <input type="text" class="test-results-search" id="testSearch" placeholder="Search tests..." oninput="filterTests()">
                    <div class="test-results-filters">
                        \${window.ButtonComponent.generate({
                            label: 'All (' + testCases.length + ')',
                            variant: 'primary',
                            command: "setTestFilter('all')",
                            className: 'test-filter-btn',
                            id: 'filter-all',
                            dataAttributes: { filter: 'all' }
                        })}
                        \${window.ButtonComponent.generate({
                            label: 'Failed (' + failedCount + ')',
                            variant: 'secondary',
                            command: "setTestFilter('failed')",
                            className: 'test-filter-btn',
                            id: 'filter-failed',
                            dataAttributes: { filter: 'failed' }
                        })}
                        \${window.ButtonComponent.generate({
                            label: 'Passed (' + passedCount + ')',
                            variant: 'secondary',
                            command: "setTestFilter('passed')",
                            className: 'test-filter-btn',
                            id: 'filter-passed',
                            dataAttributes: { filter: 'passed' }
                        })}
                        \${window.ButtonComponent.generate({
                            label: 'Structural',
                            variant: 'secondary',
                            command: "setTestFilter('structural')",
                            className: 'test-filter-btn',
                            id: 'filter-structural',
                            dataAttributes: { filter: 'structural' }
                        })}
                        \${window.ButtonComponent.generate({
                            label: 'Behavioral',
                            variant: 'secondary',
                            command: "setTestFilter('behavioral')",
                            className: 'test-filter-btn',
                            id: 'filter-behavioral',
                            dataAttributes: { filter: 'behavioral' }
                        })}
                    </div>
                </div>
                <div class="test-results-count" id="testResultsCount">Showing \${testCases.length} of \${testCases.length} tests</div>
                <div class="test-results-list" id="testResultsList">\${testItemsHtml}</div>
            \`;
            container.dataset.loaded = 'true';
            updateTestCount();
        };

        window.currentTestFilter = 'all';

        window.updateTestCount = function() {
            const list = document.getElementById('testResultsList');
            const countElement = document.getElementById('testResultsCount');

            if (!list || !countElement) {
                return;
            }

            const allItems = list.querySelectorAll('.test-result-item');
            const visibleItems = list.querySelectorAll('.test-result-item:not(.hidden)');

            countElement.textContent = \`Showing \${visibleItems.length} of \${allItems.length} tests\`;
        };

        window.setTestFilter = function(filter) {
            window.currentTestFilter = filter;

            // Update button variants - active filter gets primary, others get secondary
            const buttons = document.querySelectorAll('.test-filter-btn');
            buttons.forEach(btn => {
                const isActive = btn.getAttribute('data-filter') === filter;
                // Remove both variant classes
                btn.classList.remove('btn-primary', 'btn-secondary');
                // Add the appropriate variant class
                btn.classList.add(isActive ? 'btn-primary' : 'btn-secondary');
            });

            filterTests();
        };

        window.filterTests = function() {
            const searchInput = document.getElementById('testSearch');
            const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
            const filter = window.currentTestFilter || 'all';
            const testItems = document.querySelectorAll('.test-result-item');

            testItems.forEach(item => {
                const testName = item.getAttribute('data-test-name') || '';
                const testType = item.getAttribute('data-test-type') || '';
                const testStatus = item.getAttribute('data-test-status') || '';

                // Check search term
                const matchesSearch = !searchTerm || testName.includes(searchTerm);

                // Check filter
                let matchesFilter = true;
                if (filter === 'failed') {
                    matchesFilter = testStatus === 'failed';
                } else if (filter === 'passed') {
                    matchesFilter = testStatus === 'passed';
                } else if (filter === 'structural') {
                    matchesFilter = testType === 'STRUCTURAL';
                } else if (filter === 'behavioral') {
                    matchesFilter = testType === 'BEHAVIORAL';
                }

                // Show or hide item
                if (matchesSearch && matchesFilter) {
                    item.classList.remove('hidden');
                } else {
                    item.classList.add('hidden');
                }
            });

            // Update count using the central function
            updateTestCount();
        };

        window.participateInExercise = function() {
            vscode.postMessage({
                command: 'participateInExercise',
                exerciseId: exerciseData.exercise?.id || exerciseData.id,
                exerciseTitle: exerciseData.exercise?.title || exerciseData.title,
                courseId: exerciseData.exercise?.course?.id || exerciseData.course?.id
            });
        };

        window.startPractice = function() {
            vscode.postMessage({
                command: 'startPractice',
                exerciseId: exerciseData.exercise?.id || exerciseData.id,
                exerciseTitle: exerciseData.exercise?.title || exerciseData.title,
                courseId: exerciseData.exercise?.course?.id || exerciseData.course?.id
            });
        };

        window.openExerciseInBrowser = function() {
            vscode.postMessage({ 
                command: 'openExerciseInBrowser',
                exerciseId: exerciseData.exercise?.id || exerciseData.id,
                courseId: exerciseData.exercise?.course?.id || exerciseData.course?.id
            });
        };

        window.openExercise = function() {
            vscode.postMessage({ 
                command: 'openExercise',
                exerciseId: exerciseData.exercise?.id || exerciseData.id,
                courseId: exerciseData.exercise?.course?.id || exerciseData.course?.id
            });
        };

        window.toggleMoreMenu = function() {
            const moreMenu = document.getElementById('moreMenu');
            if (moreMenu) {
                moreMenu.classList.toggle('expanded');
            }
        };

        // Close more menu when clicking outside
        document.addEventListener('click', function(event) {
            const moreMenu = document.getElementById('moreMenu');
            if (moreMenu && !moreMenu.contains(event.target)) {
                moreMenu.classList.remove('expanded');
            }
        });

        // Repository status management (from RepositoryStatusScripts component)
        ${RepositoryStatusScripts.generateScripts()}

        // Build progress management (from BuildProgressComponent)
        ${BuildProgressComponent.generateScript()}

        // Listen for messages from the extension
        window.addEventListener('message', function(event) {
            const message = event.data;
            switch (message.command) {
                case 'updateRepoStatus':
                    if (message.isConnected) {
                        // Hide recently cloned notice if connected
                        const clonedNotice = document.getElementById('clonedRepoNotice');
                        if (clonedNotice) {
                            clonedNotice.style.display = 'none';
                            // Also clear from storage so it doesn't pop up again on reload
                            try {
                                const ex = exerciseData.exercise || exerciseData;
                                const storageKey = 'recentlyCloned_' + ex.id;
                                localStorage.removeItem(storageKey);
                            } catch (e) {}
                        }

                        const hasChanges = !!message.hasChanges;
                        const iconChar = '✓';
                        const tooltip = hasChanges
                            ? 'Connected to the exercise repository. Local changes detected. Click to rerun check.'
                            : 'Connected to the exercise repository. No local changes detected. Click to rerun check.';
                        updateRepoStatusIcon('connected', iconChar, tooltip, hasChanges);
                        updateButtonsForWorkspace(true, hasChanges);
                    } else {
                        if (message.isGradedRepo) {
                            updateRepoStatusIcon('warning', '⚠️', 'You are in the graded repository. Switch to practice repository.', false);
                            updateChangeStatus('wrong-repo', 'You are in the graded repository. Please open the practice repository.');
                        } else {
                            updateRepoStatusIcon('disconnected', '!', 'Open the exercise repository to enable submissions. Click to rerun check.', false);
                            updateButtonsForWorkspace(false);
                        }
                    }
                    break;
                case 'submissionResult':
                    console.log('[WebsocketLog] 📨 Received submissionResult', { success: message.success, error: message.error });
                    console.log('[WebsocketLog] 🔄 Setting submit loading to FALSE');
                    setSubmitLoading(false);
                    if (message.success) {
                        console.log('[WebsocketLog] ✅ Submission successful');
                        const input = document.getElementById('commitMessageInput');
                        const container = document.getElementById('commitMessageContainer');
                        if (input) {
                            input.value = '';
                        }
                        if (container) {
                            container.style.display = 'none';
                        }
                        checkRepositoryStatus(true);
                    } else if (message.error) {
                        console.warn('Submission failed:', message.error);
                    }
                    break;
                case 'newResult':
                    // Real-time result update from WebSocket
                    handleNewResult(message.result);
                    break;
                case 'newSubmission':
                    // Real-time submission update from WebSocket
                    handleNewSubmission(message.submission);
                    break;
                case 'submissionProcessing':
                    // Real-time build status update from WebSocket
                    handleSubmissionProcessing(message.state, message.buildTimingInfo);
                    break;
                case 'testResultsData':
                    // Received test results data
                    console.log('[Test Results] Received testResultsData message:', message);
                    if (message.testCases) {
                        renderTestResults(message.testCases);
                    } else {
                        console.log('[Test Results] No testCases in message, showing error');
                        const container = document.getElementById('testResultsContainer');
                        if (container) {
                            container.innerHTML = '<div class="test-results-loading">Error: ' + (message.error || 'No test data received') + '</div>';
                            container.dataset.loaded = 'true';
                        }
                    }
                    break;
                case 'buildLogParsed':
                    // Build log was parsed and error information is available
                    console.log('[Build Log] Received buildLogParsed message:', message);
                    const goToSourceLink = document.getElementById('goToSourceLink');
                    if (goToSourceLink && message.error) {
                        goToSourceLink.dataset.errorData = JSON.stringify(message.error);
                        goToSourceLink.style.display = 'inline-block';
                        console.log('[Build Log] ✅ "Go to Source" button enabled');
                    }
                    break;
                case 'showClonedRepoNotice':
                    // Show the recently cloned repository notice and store flag
                    const clonedNotice = document.getElementById('clonedRepoNotice');
                    const clonedMessage = document.getElementById('clonedRepoMessage');
                    if (clonedNotice) {
                        clonedNotice.style.display = 'block';
                    }
                    if (clonedMessage && message.exerciseTitle) {
                        clonedMessage.textContent = '"' + message.exerciseTitle + '" recently cloned.';
                    }
                    try {
                        const ex = exerciseData.exercise || exerciseData;
                        const storageKey = 'recentlyCloned_' + ex.id;
                        const storageData = JSON.stringify({
                            timestamp: Date.now(),
                            title: message.exerciseTitle || ex.title
                        });
                        localStorage.setItem(storageKey, storageData);
                    } catch (e) {
                        // Ignore storage errors
                    }
                    break;
                case 'updateDirtyPagesStatus':
                    // Update the unsaved changes banner visibility
                    // Only show if there are dirty pages AND auto-save is disabled
                    const unsavedBanner = document.getElementById('unsavedChangesBanner');
                    if (unsavedBanner) {
                        if (message.hasDirtyPages && !message.autoSaveEnabled) {
                            unsavedBanner.style.display = 'flex';
                        } else {
                            unsavedBanner.style.display = 'none';
                        }
                    }
                    break;
            }
        });

        // Check repository status on page load and poll periodically
        setTimeout(() => {
            checkRepositoryStatus(true);
        }, 500);

        if (window.repoStatusPollTimer) {
            clearInterval(window.repoStatusPollTimer);
        }
        window.repoStatusPollTimer = setInterval(() => {
            checkRepositoryStatus();
        }, 15000);

        // Auto-fetch build logs if build failed to enable "Go to Source" button
        (function() {
            try {
                const ex = exerciseData.exercise || exerciseData;
                const participations = ex.studentParticipations || [];
                if (participations.length > 0) {
                    const participation = participations[0];
                    const submissions = participation.submissions || [];
                    if (submissions.length > 0) {
                        // Get latest submission
                        const latestSubmission = submissions.reduce((latest, current) => {
                            const latestDate = latest.submissionDate ? new Date(latest.submissionDate).getTime() : 0;
                            const currentDate = current.submissionDate ? new Date(current.submissionDate).getTime() : 0;
                            return currentDate > latestDate ? current : latest;
                        }, submissions[0]);

                        if (latestSubmission.buildFailed) {
                            // Get latest result
                            const results = latestSubmission.results || [];
                            const latestResult = results.length > 0 ? results[results.length - 1] : null;
                            
                            console.log('[Build Log] 🔍 Build failed detected on page load, auto-fetching logs for error parsing...');
                            fetchBuildLogsForError(participation.id, latestResult?.id);
                        }
                    }
                }
            } catch (e) {
                console.error('Error auto-fetching build logs:', e);
            }
        })();

        // Check if this exercise was recently cloned and show notice
        try {
            const ex = exerciseData.exercise || exerciseData;
            const storageKey = 'recentlyCloned_' + ex.id;
            const clonedData = localStorage.getItem(storageKey);
            if (clonedData) {
                try {
                    const data = JSON.parse(clonedData);
                    const timeSinceClone = Date.now() - data.timestamp;
                    // Show notice if cloned within last 10 minutes
                    if (timeSinceClone < 10 * 60 * 1000) {
                        const clonedNotice = document.getElementById('clonedRepoNotice');
                        const clonedMessage = document.getElementById('clonedRepoMessage');
                        if (clonedNotice) {
                            clonedNotice.style.display = 'block';
                        }
                        if (clonedMessage && data.title) {
                            clonedMessage.textContent = '"' + data.title + '" recently cloned.';
                        }
                    } else {
                        // Clear old flag
                        localStorage.removeItem(storageKey);
                    }
                } catch (parseError) {
                    // Handle old format (just timestamp) or invalid JSON
                    const timestamp = parseInt(clonedData);
                    if (!isNaN(timestamp)) {
                        const timeSinceClone = Date.now() - timestamp;
                        if (timeSinceClone < 10 * 60 * 1000) {
                            const clonedNotice = document.getElementById('clonedRepoNotice');
                            if (clonedNotice) {
                                clonedNotice.style.display = 'block';
                            }
                        } else {
                            localStorage.removeItem(storageKey);
                        }
                    } else {
                        localStorage.removeItem(storageKey);
                    }
                }
            }
        } catch (e) {
            // Ignore storage errors
        }

        window.cloneRepository = function() {
            try {
                const ex = exerciseData.exercise || exerciseData;
                const participations = ex.studentParticipations || [];
                
                // Check for practice participation first
                let participation = participations.find(p => p.testRun);
                
                // If no practice participation, use the first one (graded)
                if (!participation && participations.length > 0) {
                    participation = participations[0];
                }

                if (!participation) {
                    vscode.postMessage({ command: 'alert', text: 'No participation found. Start the exercise first.' });
                    return;
                }
                
                vscode.postMessage({
                    command: 'cloneRepository',
                    participationId: participation.id,
                    repositoryUri: participation.repositoryUri,
                    exerciseId: ex.id,
                    exerciseTitle: ex.title
                });
            } catch (e) {
                vscode.postMessage({ command: 'alert', text: 'Error preparing clone operation.' });
            }
        };

        window.openClonedRepository = function() {
            try {
                const ex = exerciseData.exercise || exerciseData;
                vscode.postMessage({
                    command: 'openClonedRepository',
                    exerciseId: ex.id
                });
                // Hide the notice after clicking
                const clonedNotice = document.getElementById('clonedRepoNotice');
                if (clonedNotice) {
                    clonedNotice.style.display = 'none';
                }
                // Clear the flag from storage
                try {
                    const storageKey = 'recentlyCloned_' + ex.id;
                    localStorage.removeItem(storageKey);
                } catch (e) {
                    // Ignore storage errors
                }
            } catch (e) {
                vscode.postMessage({ command: 'alert', text: 'Error opening cloned repository.' });
            }
        };

        window.copyCloneUrl = function() {
            try {
                const ex = exerciseData.exercise || exerciseData;
                const participations = ex.studentParticipations || [];
                
                // Check for practice participation first
                let participation = participations.find(p => p.testRun);
                
                // If no practice participation, use the first one (graded)
                if (!participation && participations.length > 0) {
                    participation = participations[0];
                }

                if (!participation) {
                    vscode.postMessage({ command: 'alert', text: 'No participation found. Start the exercise first.' });
                    return;
                }
                
                vscode.postMessage({
                    command: 'copyCloneUrl',
                    participationId: participation.id,
                    repositoryUri: participation.repositoryUri,
                    exerciseId: ex.id,
                    exerciseTitle: ex.title
                });
            } catch (e) {
                vscode.postMessage({ command: 'alert', text: 'Error preparing copy clone URL operation.' });
            }
        };

        window.openAutoSaveSettings = function() {
            vscode.postMessage({
                command: 'openSettings',
                settingId: 'files.autoSave'
            });
        };

        window.pullChanges = function() {
            try {
                const ex = exerciseData.exercise || exerciseData;
                vscode.postMessage({
                    command: 'pullChanges',
                    exerciseId: ex.id,
                    exerciseTitle: ex.title
                });
            } catch (e) {
                vscode.postMessage({ command: 'alert', text: 'Error pulling changes from remote.' });
            }
        };

        function dispatchSubmission(commitMessage) {
            console.log('[WebsocketLog] 📤 dispatchSubmission called', { hasCommitMessage: !!commitMessage });
            const submitBtn = document.getElementById('submitBtn');
            const uploadBtn = document.getElementById('uploadMessageBtn');

            const isSubmitDisabled = submitBtn ? submitBtn.disabled : false;
            const isUploadDisabled = uploadBtn ? uploadBtn.disabled : false;
            console.log('[WebsocketLog] 🔍 Button states:', { isSubmitDisabled, isUploadDisabled });
            
            if (isSubmitDisabled || isUploadDisabled) {
                console.log('[WebsocketLog] ⚠️ Buttons disabled, cannot submit');
                vscode.postMessage({ command: 'alert', text: 'No local changes detected to submit.' });
                return;
            }

            try {
                const ex = exerciseData.exercise || exerciseData;
                const participations = ex.studentParticipations || [];
                
                // Check for practice participation first
                let participation = participations.find(p => p.testRun);
                
                // If no practice participation, use the first one (graded)
                if (!participation && participations.length > 0) {
                    participation = participations[0];
                }

                if (!participation) {
                    vscode.postMessage({ command: 'alert', text: 'No participation found. Start the exercise first.' });
                    return;
                }

                console.log('[WebsocketLog] 🔄 Setting submit loading to TRUE');
                setSubmitLoading(true);
                console.log('[WebsocketLog] 🚀 Posting submitExercise command to extension', {
                    participationId: participation.id,
                    exerciseId: ex.id,
                    exerciseTitle: ex.title,
                    hasCommitMessage: !!commitMessage
                });
                vscode.postMessage({
                    command: 'submitExercise',
                    participationId: participation.id,
                    exerciseId: ex.id,
                    exerciseTitle: ex.title,
                    commitMessage: commitMessage
                });
                console.log('[WebsocketLog] ✅ submitExercise command posted');
            } catch (e) {
                setSubmitLoading(false);
                vscode.postMessage({ command: 'alert', text: 'Error preparing submit operation.' });
            }
        }

        window.submitExercise = function() {
            console.log('[WebsocketLog] 🖱️ window.submitExercise called (submit button clicked)');
            const commitInput = document.getElementById('commitMessageInput');
            const commitContainer = document.getElementById('commitMessageContainer');
            const commitMessage = commitContainer && commitContainer.style.display !== 'none'
                ? (commitInput?.value.trim() || undefined)
                : undefined;
            console.log('[WebsocketLog] 📝 Commit message:', commitMessage || '(default)');
            dispatchSubmission(commitMessage);
        };

        window.toggleCommitMessageInput = function() {
            const uploadBtn = document.getElementById('uploadMessageBtn');
            const inputContainer = document.getElementById('commitMessageContainer');
            const input = document.getElementById('commitMessageInput');

            if (!uploadBtn || !inputContainer || !input) {
                vscode.postMessage({ command: 'alert', text: 'No local changes detected.' });
                return;
            }

            if (uploadBtn.disabled) {
                vscode.postMessage({ command: 'alert', text: 'No local changes detected to submit.' });
                return;
            }
            
            if (inputContainer.style.display === 'none') {
                // First click: Show input field
                inputContainer.style.display = 'block';
                input.focus();
                uploadBtn.title = 'Enter a commit message and click again to submit';
            } else {
                // Second click: Try submitting with the custom message
                const message = input.value.trim();
                if (message) {
                    dispatchSubmission(message);
                } else {
                    vscode.postMessage({ command: 'alert', text: 'Please enter a commit message.' });
                }
            }
        };

        // Fullscreen toggle functionality
        window.toggleFullscreen = function() {
            vscode.postMessage({ command: 'toggleFullscreen' });
        };

        // WebSocket real-time update handlers
        function handleNewResult(result) {
            if (!result || !window.exerciseData) {
                return;
            }

            const participation = resolveParticipationForResult(result);

            if (!participation) {
                return;
            }

            if (!Array.isArray(participation.submissions)) {
                participation.submissions = [];
            }

            let targetSubmission = null;

            if (result.submission && typeof result.submission.id === 'number') {
                targetSubmission = participation.submissions.find((submission) => submission.id === result.submission.id);
            }

            if (!targetSubmission) {
                targetSubmission = getLatestSubmission(participation);
            }

            if (!targetSubmission) {
                targetSubmission = {
                    id: typeof result?.submission?.id === 'number' ? result.submission.id : Date.now(),
                    submissionDate: result.completionDate || new Date().toISOString(),
                    results: []
                };
                participation.submissions.push(targetSubmission);
            }

            if (!Array.isArray(targetSubmission.results)) {
                targetSubmission.results = [];
            }

            if (!targetSubmission.submissionDate && result.completionDate) {
                targetSubmission.submissionDate = result.completionDate;
            }

            if (result.submission && typeof result.submission.buildFailed === 'boolean') {
                targetSubmission.buildFailed = result.submission.buildFailed;
            }

            const existingIndex = targetSubmission.results.findIndex((r) => r.id === result.id);

            if (existingIndex >= 0) {
                targetSubmission.results[existingIndex] = result;
            } else {
                targetSubmission.results.push(result);
            }

            console.log('[Submission] ✅ Updated exerciseData with new result. Submission results:', targetSubmission.results.length);

            const exercise = getActiveExercise();
            const scorePercentage = typeof result.score === 'number' ? result.score : 0;
            const successful = result.successful === true;
            const maxPoints = exercise?.maxPoints || 0;
            const scorePoints = Math.round((scorePercentage / 100) * maxPoints * 100) / 100;

            const totalTests = result.testCaseCount || 0;
            const passedTests = result.passedTestCaseCount || 0;
            const hasTestInfo = totalTests > 0;
            const buildFailed = targetSubmission.buildFailed ?? result.submission?.buildFailed ?? false;

            const participationId = typeof participation?.id === 'number' ? participation.id : null;
            const resultId = typeof result?.id === 'number' ? result.id : null;

            const buildStatusSection = ensureBuildStatusSection();
            if (buildStatusSection) {
                buildStatusSection.classList.remove('build-status--empty');
                delete buildStatusSection.dataset.progressMode;

                // Use SubmissionStatusComponent to generate the HTML (avoiding duplication)
                const statusHtml = window.SubmissionStatusComponent.generateProgrammingStatus({
                    buildFailed: buildFailed,
                    hasTestInfo: hasTestInfo,
                    passedTests: passedTests,
                    totalTests: totalTests,
                    successful: successful,
                    scorePercentage: scorePercentage,
                    scorePoints: scorePoints,
                    maxPoints: maxPoints,
                    participationId: participationId,
                    resultId: resultId
                });

                buildStatusSection.innerHTML = statusHtml;
            }

            setSubmitLoading(false);

            if (window.buildProgressInterval) {
                clearInterval(window.buildProgressInterval);
                window.buildProgressInterval = null;
            }

            checkRepositoryStatus();

            // Auto-fetch build logs if build failed to enable "Go to Source" button
            if (buildFailed && participationId && resultId) {
                console.log('[Build Log] 🔍 Build failed detected via WebSocket, auto-fetching logs for error parsing...');
                fetchBuildLogsForError(participationId, resultId);
            } else if (!buildFailed) {
                // Build succeeded - clear any existing CodeLens errors
                console.log('[Build Log] ✅ Build succeeded, requesting CodeLens error clear...');
                vscode.postMessage({
                    command: 'clearBuildErrors'
                });
            }
        }

        function handleNewSubmission(submission) {
            console.log('[Submission] 📤 Received new submission from WebSocket:', submission);

            if (!submission || !window.exerciseData) {
                return;
            }

            const participation = resolveParticipationForSubmission(submission);

            if (!participation) {
                console.log('[Submission] ℹ️ Ignoring submission that does not belong to the active exercise or participation.');
                return;
            }

            if (!Array.isArray(participation.submissions)) {
                participation.submissions = [];
            }

            if (!submission.submissionDate) {
                submission.submissionDate = new Date().toISOString();
            }

            const existingIndex = participation.submissions.findIndex((s) => s.id === submission.id);

            if (existingIndex >= 0) {
                participation.submissions[existingIndex] = {
                    ...participation.submissions[existingIndex],
                    ...submission
                };
            } else {
                participation.submissions.push(submission);
            }

            console.log('[Submission] ✅ Updated exerciseData with new submission. Total submissions:', participation.submissions.length);

            setSubmitLoading(true);
            
            const buildStatusSection = ensureBuildStatusSection();
            renderBuildProgress(buildStatusSection, '🔄 Submission received, queuing build...', 5, true);
        }
    </script>
</body>
</html>`;
    }
}
