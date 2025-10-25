import * as vscode from 'vscode';
import { ThemeManager } from '../../themes';
import { IconDefinitions } from '../../utils';
import { StyleManager } from '../styles';

export class ExerciseDetailView {
    private _themeManager: ThemeManager;
    private _extensionContext: vscode.ExtensionContext;
    private _styleManager: StyleManager;

    constructor(extensionContext: vscode.ExtensionContext, styleManager: StyleManager) {
        this._themeManager = new ThemeManager();
        this._extensionContext = extensionContext;
        this._styleManager = styleManager;
    }

    private _getExerciseIcon(type: string): string {
        return IconDefinitions.getIcon(type);
    }

    private _getUploadMessageIcon(): string {
        return IconDefinitions.getIcon('uploadMessage');
    }

    // Get latest submission by ID (matches Artemis frontend approach)
    // IDs are database auto-increment, guaranteed to be sequential with submission time
    private _getLatestSubmission(participation: any): any | undefined {
        if (!participation || !Array.isArray(participation.submissions) || participation.submissions.length === 0) {
            return undefined;
        }

        return participation.submissions.reduce((latest: any, current: any) => {
            const latestId = typeof latest?.id === 'number' ? latest.id : -Infinity;
            const currentId = typeof current?.id === 'number' ? current.id : -Infinity;
            return currentId > latestId ? current : latest;
        });
    }

    // Get latest result by completionDate (matches Artemis frontend approach)
    // Results can complete out of order due to varying build times
    // Uses completionDate to ensure the most recently completed result is returned
    private _getLatestResult(submission: any): any | undefined {
        if (!submission || !Array.isArray(submission.results) || submission.results.length === 0) {
            return undefined;
        }

        return submission.results.reduce((latest: any, current: any) => {
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

    public generateHtml(exerciseData: any, hideDeveloperTools: boolean = false): string {
        const themeCSS = this._themeManager.getThemeCSS();
        const currentTheme = this._themeManager.getCurrentTheme();
        const styles = this._styleManager.getStyles(currentTheme, [
            'views/exercise-detail.css'
        ]);

        if (!exerciseData) {
            return this._getEmptyStateHtml(themeCSS, currentTheme, styles);
        }

        return this._getExerciseDetailHtml(exerciseData, themeCSS, currentTheme, hideDeveloperTools, styles);
    }

    private _getEmptyStateHtml(themeCSS: string, currentTheme: string, styles: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Exercise Details</title>
    <style>
        ${styles}
        ${themeCSS}
    </style>

</head>
<body class="theme-${currentTheme}">
    <div class="back-link-container">
        <div class="back-link" onclick="backToCourseDetails()">← Back to Course</div>
    </div>
    
    <div class="empty-state">
        <h2>Exercise Details</h2>
        <p>Select an exercise to view its details</p>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        window.backToCourseDetails = function() {
            vscode.postMessage({ command: 'backToCourseDetails' });
        };
    </script>
</body>
</html>`;
    }

    private _getExerciseDetailHtml(exerciseData: any, themeCSS: string, currentTheme: string, hideDeveloperTools: boolean, styles: string): string {
        const exercise = exerciseData?.exercise;

        if (!exercise) {
            return this._getEmptyStateHtml(themeCSS, currentTheme, styles);
        }

        const exerciseTitle = exercise.title || 'Unknown Exercise';
        const exerciseType = exercise.type?.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) || 'Unknown';
        const exerciseIcon = this._getExerciseIcon(exercise.type);
        const uploadMessageIcon = this._getUploadMessageIcon();
        const starAssistIcon = IconDefinitions.getIcon('star_4_edges');
        const maxPoints = exercise.maxPoints || 0;
        const bonusPoints = exercise.bonusPoints || 0;
        const releaseDate = exercise.releaseDate ? new Date(exercise.releaseDate).toLocaleString() : 'No release date';
        
        // Calculate due date and time remaining
        let dueDateDisplay = 'No due date';
        let timeRemainingDisplay = '';
        let isDueSoon = false;
        if (exercise.dueDate) {
            const dueDate = new Date(exercise.dueDate);
            const now = new Date();
            const timeRemaining = dueDate.getTime() - now.getTime();
            const hoursRemaining = timeRemaining / (1000 * 60 * 60);
            const daysRemaining = Math.floor(hoursRemaining / 24);
            const remainingHours = Math.floor(hoursRemaining % 24);
            
            dueDateDisplay = dueDate.toLocaleString();
            
            if (timeRemaining < 0) {
                timeRemainingDisplay = 'Overdue';
                isDueSoon = true;
            } else if (hoursRemaining < 24) {
                timeRemainingDisplay = `Due in ${Math.floor(hoursRemaining)}h`;
                isDueSoon = true;
            } else if (daysRemaining < 7) {
                timeRemainingDisplay = `Due in ${daysRemaining}d ${remainingHours}h`;
            } else {
                timeRemainingDisplay = `Due in ${daysRemaining} days`;
            }
        }
        
        const mode = exercise.mode?.toLowerCase().replace('_', ' ') || 'Unknown';
        const includedInScore = exercise.includedInOverallScore === 'NOT_INCLUDED' ? 'Not included in overall score' :
            exercise.includedInOverallScore === 'INCLUDED_COMPLETELY' ? 'Included in overall score' :
                'Partially included in score';
        const filePattern = exercise.filePattern ? exercise.filePattern.split(',').map((ext: string) => ext.trim().toUpperCase()).join(', ') : '';

        // Extract problem statement and process markdown links
        let problemStatement = exercise.problemStatement || 'No description available';
        const downloadLinks: { text: string; url: string }[] = [];

        // Extract markdown links for file downloads
        const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        let match;
        while ((match = markdownLinkRegex.exec(problemStatement)) !== null) {
            if (match[2].includes('/api/core/files/') || match[1].includes('.pdf') || match[1].includes('.png')) {
                downloadLinks.push({
                    text: match[1],
                    url: match[2]
                });
            }
        }

        // Remove markdown links from problem statement for cleaner display
        problemStatement = problemStatement.replace(markdownLinkRegex, '$1');

        // Extract PlantUML diagrams and replace with placeholders for auto-rendering
        const plantUmlRegex = /@startuml([^@]*)@enduml/g;
        const plantUmlDiagrams: string[] = [];
        let plantUmlIndex = 0;
        problemStatement = problemStatement.replace(plantUmlRegex, (match: string) => {
            plantUmlDiagrams.push(match);
            const placeholder = `<div class="plantuml-placeholder" data-index="${plantUmlIndex}" data-plantuml="${encodeURIComponent(match)}">Loading PlantUML diagram...</div>`;
            plantUmlIndex++;
            return placeholder;
        });

        // Preserve fenced code blocks before further processing
        const codeBlocks: Array<{ placeholder: string; html: string }> = [];
        problemStatement = problemStatement.replace(/```(\w+)?\n([\s\S]*?)```/g, (_fullMatch: string, language: string | undefined, codeContent: string) => {
            const index = codeBlocks.length;
            const placeholder = `__CODE_BLOCK_${index}__`;
            const escapedCode = codeContent
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
            const classAttr = language ? ` class="language-${language}"` : '';
            codeBlocks.push({
                placeholder,
                html: `<pre class="code-block"><code${classAttr}>${escapedCode.trimEnd()}</code></pre>`
            });
            return placeholder;
        });

        // Clean up excessive whitespace and normalize line breaks
        problemStatement = problemStatement
            .replace(/\r\n/g, '\n')  // Normalize line endings
            .replace(/\n{3,}/g, '\n\n')  // Replace 3+ line breaks with 2
            .replace(/[ \t]+/g, ' ')  // Replace multiple spaces/tabs with single space
            .trim();  // Remove leading/trailing whitespace

        // Convert markdown tables to HTML tables
        // Match tables: header row, separator row, and data rows
        const tableRegex = /^(\|[^\n]+\|\r?\n)(\|[\s:|-]+\|\r?\n)((?:\|[^\n]+\|\r?\n?)+)/gm;
        problemStatement = problemStatement.replace(tableRegex, (match: string, headerRow: string, separatorRow: string, dataRows: string) => {
            // Parse header
            const headers = headerRow.trim().split('|').filter((cell: string) => cell.trim()).map((cell: string) => cell.trim());
            
            // Parse separator to detect alignment
            const separators = separatorRow.trim().split('|').filter((cell: string) => cell.trim());
            const alignments = separators.map((sep: string) => {
                const trimmed = sep.trim();
                if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center';
                if (trimmed.endsWith(':')) return 'right';
                if (trimmed.startsWith(':')) return 'left';
                return '';
            });
            
            // Parse data rows
            const rows = dataRows.trim().split('\n').map((row: string) => 
                row.trim().split('|').filter((cell: string) => cell.trim()).map((cell: string) => cell.trim())
            );
            
            // Build HTML table
            let tableHtml = '<table class="markdown-table">\n<thead>\n<tr>\n';
            headers.forEach((header: string, i: number) => {
                const align = alignments[i] ? ` style="text-align: ${alignments[i]}"` : '';
                tableHtml += `<th${align}>${header}</th>\n`;
            });
            tableHtml += '</tr>\n</thead>\n<tbody>\n';
            
            rows.forEach((row: string[]) => {
                tableHtml += '<tr>\n';
                row.forEach((cell: string, i: number) => {
                    const align = alignments[i] ? ` style="text-align: ${alignments[i]}"` : '';
                    tableHtml += `<td${align}>${cell}</td>\n`;
                });
                tableHtml += '</tr>\n';
            });
            tableHtml += '</tbody>\n</table>';
            
            return tableHtml;
        });

        // Convert numbered tasks with [task][task name](<testid>...) pattern to container with structured layout
        problemStatement = problemStatement.replace(
            /(^|\n)\s*(\d+)\.\s*\[task\](?:\[([^\]]+)\])?(?:\(([^)]*)\))?\s*([^\n]*)/g,
            (_match: string, prefix: string, index: string, explicitTitle: string | undefined, testsBlock: string | undefined, remainder: string) => {
                const stripTaskMetadata = (text: string) => {
                    if (!text) {
                        return '';
                    }

                    let cleaned = text
                        .replace(/<testid>\s*\d+\s*<\/testid>/gi, ' ')
                        .replace(/\btest[A-Za-z0-9_]*\s*\(\s*\)/gi, ' ')
                        .replace(/\b\d{4,}\b/g, ' ')
                        .replace(/\s*,\s*/g, ' ');

                    cleaned = cleaned
                        .replace(/\(\s*\)/g, ' ')
                        .replace(/\s{2,}/g, ' ')
                        .replace(/^\s+|\s+$/g, '')
                        .replace(/^[,;:]+/, '')
                        .replace(/[,;:]+$/, '')
                        .replace(/[()]+$/, '')
                        .replace(/^[()]+/, '')
                        .trim();

                    return cleaned;
                };

                const normalizedRemainder = remainder?.trim() || '';

                let headerText = explicitTitle?.trim() || '';
                let bodyText = '';

                if (!headerText && normalizedRemainder) {
                    const firstSentenceMatch = normalizedRemainder.match(/^(.{1,120}?[.!?])(\s+.*)?$/);
                    if (firstSentenceMatch) {
                        headerText = firstSentenceMatch[1].trim();
                        bodyText = (firstSentenceMatch[2] || '').trim();
                    } else {
                        headerText = normalizedRemainder;
                    }
                } else {
                    bodyText = normalizedRemainder;
                }

                if (testsBlock) {
                    headerText = headerText.replace(testsBlock, '');
                    bodyText = bodyText.replace(testsBlock, '');
                }

                headerText = stripTaskMetadata(headerText);
                bodyText = stripTaskMetadata(bodyText);

                if (!headerText) {
                    headerText = `Task ${index}`;
                }

                const descriptionHtml = bodyText
                    ? `<div class="task-body">${bodyText}</div>`
                    : '';

                const headerHtml = `<div class="task-header">Task ${index}${headerText ? `: ${headerText}` : ''}</div>`;

                return `${prefix}<div class="task-container">${headerHtml}${descriptionHtml}</div>`;
            }
        );

        // Convert backticks to code tags for syntax highlighting AFTER tasks
        problemStatement = problemStatement.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Convert markdown headers to proper HTML - from largest to smallest to avoid conflicts
        problemStatement = problemStatement
            .replace(/^###### (.*$)/gm, '<h6>$1</h6>')
            .replace(/^##### (.*$)/gm, '<h5>$1</h5>')
            .replace(/^#### (.*$)/gm, '<h4>$1</h4>')
            .replace(/^### (.*$)/gm, '<h3>$1</h3>')
            .replace(/^## (.*$)/gm, '<h2>$1</h2>')
            .replace(/^# (.*$)/gm, '<h1>$1</h1>');

        // Convert --- to horizontal rule
        problemStatement = problemStatement.replace(/^---$/gm, '<hr>');

        // Convert **bold** to <strong>
        problemStatement = problemStatement.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        // Convert bullet points (- item) to proper HTML lists
        problemStatement = problemStatement.replace(/^- (.+)$/gm, '<li>$1</li>');

        // Wrap consecutive <li> items in <ul> tags
        problemStatement = problemStatement.replace(/(<li>.*?<\/li>(?:\s*<li>.*?<\/li>)*)/gs, '<ul>$1</ul>');

        // Convert double line breaks to paragraphs
        problemStatement = problemStatement.replace(/\n\n/g, '</p><p>');
        problemStatement = '<p>' + problemStatement + '</p>';

        // Clean up empty paragraphs and fix paragraph around other elements
        problemStatement = problemStatement
            .replace(/<p><\/p>/g, '')  // Remove empty paragraphs
            .replace(/<p>(<h[1-6]>)/g, '$1')  // Don't wrap headers in paragraphs
            .replace(/(<\/h[1-6]>)<\/p>/g, '$1')  // Don't wrap headers in paragraphs
            .replace(/<p>(<ul>)/g, '$1')  // Don't wrap lists in paragraphs
            .replace(/(<\/ul>)<\/p>/g, '$1')  // Don't wrap lists in paragraphs
            .replace(/<p>(<div class="task-container">)/g, '$1')  // Don't wrap tasks in paragraphs
            .replace(/(<\/div>)<\/p>/g, '$1')  // Don't wrap tasks in paragraphs
            .replace(/<p>(<pre class="code-block">)/g, '$1')  // Don't wrap code blocks in paragraphs
            .replace(/(<\/pre>)<\/p>/g, '$1')  // Don't wrap code blocks in paragraphs
            .replace(/<p>(<table class="markdown-table">)/g, '$1')  // Don't wrap tables in paragraphs
            .replace(/(<\/table>)<\/p>/g, '$1');  // Don't wrap tables in paragraphs

        // Restore preserved code blocks
        for (const block of codeBlocks) {
            problemStatement = problemStatement.replace(block.placeholder, block.html);
        }

        // Course information
        const course = exercise.course;
        const courseName = course?.title || 'Unknown Course';
        const semester = course?.semester || 'No semester';
        const exerciseId = exercise.id || 0;
        const exerciseShortName = exercise.shortName || '';
        const releaseDateRaw = exercise.releaseDate || exercise.startDate || '';
        const dueDateRaw = exercise.dueDate || '';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Exercise Details</title>
    <style>
        ${styles}
        ${themeCSS}
    </style>
</head>
<body class="theme-${currentTheme}">
    <div class="back-link-container">
        <div class="back-link" onclick="backToCourseDetails()">← Back to Course</div>
        <button class="fullscreen-btn" id="fullscreenBtn" onclick="toggleFullscreen()" title="Open exercise in new editor tab">
            ⛶
        </button>
    </div>
    
    <details class="exercise-card">
        <summary>
            <div class="summary-content">
                <div class="summary-text">
                    <div class="exercise-title">${exerciseTitle}</div>
                    <div class="exercise-meta">
                        <div class="exercise-type-icon">${exerciseIcon}</div>
                        <div class="points-badge">${maxPoints} ${maxPoints === 1 ? 'point' : 'points'}${bonusPoints > 0 ? ` + ${bonusPoints} bonus` : ''}</div>
                        ${timeRemainingDisplay ? `<div class="due-date-badge ${isDueSoon ? 'due-soon' : ''}">${timeRemainingDisplay}</div>` : ''}
                        <button class="repo-status-icon unknown" id="repoStatusIcon" onclick="checkRepositoryStatus(true)" title="Check repository status">
                            ?
                        </button>
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
                    <div class="info-value">${releaseDate}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Mode</div>
                    <div class="info-value">${mode}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Grading</div>
                    <div class="info-value">${includedInScore}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Course</div>
                    <div class="info-value course-pill">
                        <span>${courseName}</span>
                        <span class="course-semester">${semester}</span>
                    </div>
                </div>
                ${filePattern ? `
                <div class="info-item">
                    <div class="info-label">File Formats</div>
                    <div class="info-value">${filePattern}</div>
                </div>
                ` : ''}
            </div>
        </div>
    </details>
    

    ${(() => {
                const hasParticipation = Array.isArray(exercise.studentParticipations) && exercise.studentParticipations.length > 0;
                const firstParticipation = hasParticipation ? exercise.studentParticipations[0] : undefined;
                const participationId = firstParticipation?.id;
                const rawExerciseType = exercise.type || exercise.exerciseType || '';
                const normalizedExerciseType = typeof rawExerciseType === 'string' ? rawExerciseType.toLowerCase() : '';
                const isProgrammingExercise = normalizedExerciseType === 'programming';
                const isQuizExercise = normalizedExerciseType === 'quiz';

                // Get latest submission and build status
                let buildStatusHtml = '';
                const latestSubmission = hasParticipation ? this._getLatestSubmission(firstParticipation) : undefined;
                if (hasParticipation && latestSubmission) {

                    const latestResult = this._getLatestResult(latestSubmission) ?? null;

                    // Only show build status for programming exercises
                    if (isProgrammingExercise) {
                        const buildFailed = latestSubmission.buildFailed;
                        const scorePercentage = latestResult ? latestResult.score : 0; // This is 0-100
                        const maxPoints = exercise.maxPoints || 0;
                        const scorePoints = Math.round((scorePercentage / 100) * maxPoints * 100) / 100; // Convert to points
                        const successful = latestResult ? latestResult.successful : false;

                        // Calculate test statistics
                        const totalTests = latestResult?.testCaseCount || 0;
                        const passedTests = latestResult?.passedTestCaseCount || 0;
                        const hasTestInfo = totalTests > 0;

                        // Generate status badge (logic shared with websocket handler)
                        let statusBadge = '';
                        if (buildFailed) {
                            statusBadge = '<span class="status-badge failed">Build Failed</span>';
                        } else if (hasTestInfo) {
                            const passPercentage = totalTests > 0 ? (passedTests / totalTests) * 100 : 0;
                            const badgeClass = passPercentage >= 80 ? 'success' : passPercentage >= 40 ? 'partial' : 'failed';
                            statusBadge = `<span class="status-badge ${badgeClass}">${passedTests}/${totalTests} tests passed</span>`;
                        } else {
                            statusBadge = successful
                                ? '<span class="status-badge success">Build Success</span>'
                                : '<span class="status-badge failed">Tests Failed</span>';
                        }

                        buildStatusHtml = `
                    <div class="build-status">
                        <div class="build-status-title">Latest Build Status</div>
                        <div class="build-status-info">
                            ${statusBadge}
                            <div class="score-info">
                                Score: <span class="score-points">${scorePoints}/${maxPoints} (${scorePercentage.toFixed(2)}%)</span> ${maxPoints === 1 ? 'point' : 'points'}
                            </div>
                        </div>
                        ${hasTestInfo ? `<div class="test-results-toggle-container">
                            <a href="#" class="test-results-toggle" onclick="toggleTestResults(event)" id="testResultsToggle">
                                See test results
                            </a>
                        </div>
                        <div class="test-results-modal" id="testResultsModal" aria-hidden="true" onclick="handleTestResultsBackdrop(event)">
                            <div class="test-results-modal-content">
                                <div class="test-results-modal-header">
                                    <div class="test-results-modal-title">Test Results</div>
                                    <button class="test-results-modal-close" onclick="closeTestResultsModal()" aria-label="Close test results">&times;</button>
                                </div>
                                <div class="test-results-modal-body">
                                    <div class="test-results-container" id="testResultsContainer">
                                        <div class="test-results-loading">Loading test results...</div>
                                    </div>
                                </div>
                            </div>
                        </div>` : ''}
                    </div>
                `;
                    } else if (!isQuizExercise) {
                        // For non-programming exercises, show submission status
                        const submitted = latestSubmission.submitted;
                        const empty = latestSubmission.empty;
                        const scorePercentage = latestResult ? latestResult.score : 0; // This is 0-100
                        const maxPoints = exercise.maxPoints || 0;
                        const scorePoints = Math.round((scorePercentage / 100) * maxPoints * 100) / 100; // Convert to points

                        let statusBadge = '';
                        let statusText = '';
                        if (submitted && !empty) {
                            statusBadge = '<span class="status-badge success">Submitted</span>';
                            statusText = 'Latest Submission Status';
                        } else if (!empty) {
                            statusBadge = '<span class="status-badge building">Draft Saved</span>';
                            statusText = 'Current Status';
                        } else {
                            statusBadge = '<span class="status-badge failed">No Submission</span>';
                            statusText = 'Submission Status';
                        }

                        let scoreDisplay = '';
                        if (latestResult) {
                            scoreDisplay = `
                        <div class="score-info">
                            Score: <span class="score-points">${scorePoints}/${maxPoints} (${scorePercentage.toFixed(2)}%)</span> ${maxPoints === 1 ? 'point' : 'points'}
                        </div>
                    `;
                        }

                        buildStatusHtml = `
                    <div class="build-status">
                        <div class="build-status-title">${statusText}</div>
                        <div class="build-status-info">
                            ${statusBadge}
                            ${scoreDisplay}
                        </div>
                    </div>
                `;
                    }
                }

                if (hasParticipation && isProgrammingExercise && !buildStatusHtml) {
                    buildStatusHtml = `
                <div class="build-status build-status--empty">
                    <div class="build-status-title">Latest Build Status</div>
                    <div class="build-status-info">
                        <div class="build-status-placeholder">No submissions yet. Submit to see build results.</div>
                    </div>
                </div>
            `;
                }

                const changeStatusHtml = hasParticipation && isProgrammingExercise ? `
            <div class=\"changes-status\" id=\"changesStatus\" data-state=\"checking\">
                <span class=\"changes-status-indicator\"></span>
                <span id=\"changesStatusText\">Checking workspace status...</span>
            </div>
        ` : '';

                const actionsHtml = hasParticipation
                    ? (isProgrammingExercise
                        ? `<div class=\"participation-actions\">
                    ${changeStatusHtml}
                    <div class=\"cloned-repo-notice\" id=\"clonedRepoNotice\" style=\"display: none;\">
                        <span id=\"clonedRepoMessage\">Repository recently cloned.</span> <a href=\"#\" class=\"open-repo-link\" onclick=\"openClonedRepository(); return false;\">Open now</a>
                    </div>
                    <div class=\"unsaved-changes-banner\" id=\"unsavedChangesBanner\" style=\"display: none;\">
                        <span class=\"unsaved-changes-icon\">⚠️</span>
                        <span class=\"unsaved-changes-text\">
                            <strong>Unsaved changes detected.</strong> Please save your files before submitting.
                            <a href=\"#\" class=\"unsaved-changes-link\" onclick=\"openAutoSaveSettings(); return false;\">Configure auto-save</a>
                        </span>
                    </div>
                    <div class=\"submit-button-group\" id=\"submitBtnGroup\" style=\"display: none;\">
                        <button class=\"participate-btn\" id=\"submitBtn\" onclick=\"submitExercise()\" title=\"Submit solution with automatic commit message\">Submit</button>
                        <button class=\"upload-message-btn\" id=\"uploadMessageBtn\" onclick=\"toggleCommitMessageInput()\" title=\"Submit solution with custom commit message\">
                            ${uploadMessageIcon}
                        </button>
                    </div>
                    <div class=\"commit-message-input-container\" id=\"commitMessageContainer\" style=\"display: none;\">
                        <input type=\"text\" id=\"commitMessageInput\" class=\"commit-message-input\" placeholder=\"Enter commit message...\" />
                    </div>
                    <div class=\"action-button-row\">
                        <button class=\"participate-btn\" id=\"cloneBtn\" onclick=\"cloneRepository()\">Clone Repository</button>
                        <div class=\"more-menu\" id=\"moreMenu\">
                            <button class=\"more-toggle\" onclick=\"toggleMoreMenu()\">
                                More options
                            </button>
                            <div class=\"more-dropdown\">
                                <button class=\"dropdown-item\" id=\"cloneDropdownItem\" onclick=\"cloneRepository()\" style=\"display: none;\">Clone Repository</button>
                                <button class=\"dropdown-item\" id=\"pullChangesItem\" onclick=\"pullChanges()\" style=\"display: none;\">Pull Changes</button>
                                <button class=\"dropdown-item\" onclick=\"copyCloneUrl()\">Copy Clone URL</button>
                                <button class=\"dropdown-item\" onclick=\"openExerciseInBrowser()\">Open in browser</button>
                            </div>
                        </div>
                    </div>
                </div>`
                        : `<div class=\"participation-actions\">
                    <div class=\"action-button-row\">
                        <button class=\"participate-btn\" onclick=\"openExerciseInBrowser()\">Open in browser</button>
                    </div>
                </div>`)
                    : (isProgrammingExercise
                        ? `<div class=\"participation-actions not-participated\">
                    <div class=\"action-button-row\">
                        <button class=\"participate-btn\" onclick=\"participateInExercise()\">Start Exercise</button>
                        <button class=\"participate-btn secondary\" onclick=\"openExerciseInBrowser()\">Open in browser</button>
                    </div>
                </div>`
                        : `<div class=\"participation-actions not-participated\">
                    <div class=\"action-button-row\">
                        <button class=\"participate-btn\" onclick=\"openExerciseInBrowser()\">Open in browser</button>
                    </div>
                </div>`);

                // Determine participation info based on exercise type
                let participationStatus = '';
                let participationMessage = '';

                if (isProgrammingExercise) {
                    participationStatus = hasParticipation ? 'Repository Ready' : 'Not Participating Yet';
                    participationMessage = hasParticipation ? 'You have already started this exercise.' : 'You have not started this exercise yet.';
                } else {
                    // For non-programming exercises (quiz, modeling, text, file-upload)
                    const cleanedType = normalizedExerciseType.replace(/_/g, ' ').replace(/-/g, ' ');
                    const exerciseTypeDisplay = cleanedType
                        ? cleanedType.charAt(0).toUpperCase() + cleanedType.slice(1)
                        : 'Course';
                    const exerciseTypePlain = cleanedType || 'course';
                    participationStatus = `${exerciseTypeDisplay} Exercise`;
                    participationMessage = `This is a ${exerciseTypePlain} exercise. Complete it in the browser.`;
                }

                return `<div class=\"participation-section\" data-has-participation=\"${hasParticipation}\" data-participation-id=\"${participationId || ''}\">
        <div class=\"participation-info\">
            <div class=\"participation-status\">${participationStatus}</div>
            <div class=\"participation-message\">${participationMessage}</div>
        </div>
        ${actionsHtml}
        ${buildStatusHtml}
    </div>`;
            })()}

    <div class="content-section iris-assist-section">
        <div class="iris-assist-content">
            <div class="iris-assist-title">Ask Iris about this exercise</div>
            <p class="iris-assist-description">Open the Iris chat to discuss this exercise or get guidance.</p>
        </div>
        <button class="iris-assist-button" id="askIrisAboutExerciseBtn">
            <span class="iris-assist-button-icon">${starAssistIcon}</span>
            Ask Iris
        </button>
    </div>

    <div class="content-section">
        <div class="section-title">Exercise Description</div>
        <div class="problem-statement">${problemStatement}</div>
        
        ${downloadLinks.length > 0 ? `
        <div class="downloads-section">
            <div class="section-title">Downloads</div>
            <div class="download-links">
                ${downloadLinks.map(link => `
                    <a href="#" class="download-link" onclick="downloadFile('${link.url}', '${link.text}')">
                        <span class="download-icon">📄</span>
                        ${link.text}
                    </a>
                `).join('')}
            </div>
        </div>
        ` : ''}
    </div>
    
    ${!hideDeveloperTools ? `
    <div class="action-buttons">
        <button class="btn btn-primary" onclick="openInEditor()">Open Raw JSON</button>
        <button class="btn" onclick="copyToClipboard()">Copy Exercise Data</button>
        <button class="btn" onclick="showSubmissionDetails()">Submission Details</button>
    </div>
    ` : ''}

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

        // Get latest submission by ID (matches Artemis frontend)
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

        // Get latest result by completionDate (matches Artemis frontend)
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
                    exerciseTitle: ${JSON.stringify(exerciseTitle)},
                    exerciseShortName: ${JSON.stringify(exerciseShortName)},
                    releaseDate: ${JSON.stringify(releaseDateRaw)},
                    dueDate: ${JSON.stringify(dueDateRaw)}
                });
            });
        }
        
        window.backToCourseDetails = function() {
            vscode.postMessage({ command: 'backToCourseDetails' });
        };
        
        // PlantUML render function
        window.renderPlantUmlDiagrams = function() {
            if (plantUmlDiagrams.length > 0) {
                console.log('🎨 Rendering PlantUML diagrams:', plantUmlDiagrams);
                vscode.postMessage({
                    command: 'renderPlantUml',
                    plantUmlDiagrams: plantUmlDiagrams,
                    exerciseTitle: ${JSON.stringify(exerciseTitle)}
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
            if (fetchTestResultsTimeout) {
                clearTimeout(fetchTestResultsTimeout);
            }

            // Set a timeout to prevent infinite loading (15 seconds)
            fetchTestResultsTimeout = setTimeout(() => {
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
                    clearTimeout(fetchTestResultsTimeout);
                    container.innerHTML = '<div class="test-results-loading">No participation found</div>';
                    container.dataset.loaded = 'true';
                    return;
                }

                const latestContext = findLatestSubmissionContext();

                if (!latestContext) {
                    clearTimeout(fetchTestResultsTimeout);
                    container.innerHTML = '<div class="test-results-loading">No submissions found</div>';
                    container.dataset.loaded = 'true';
                    return;
                }

                const latestResult = getLatestResult(latestContext.submission);

                if (!latestResult) {
                    clearTimeout(fetchTestResultsTimeout);
                    container.innerHTML = '<div class="test-results-loading">No results found</div>';
                    container.dataset.loaded = 'true';
                    return;
                }

                vscode.postMessage({
                    command: 'fetchTestResults',
                    participationId: latestContext.participation.id,
                    resultId: latestResult.id
                });
            } catch (e) {
                clearTimeout(fetchTestResultsTimeout);
                console.error('Error fetching test results:', e);
                container.innerHTML = '<div class="test-results-loading">Error loading test results</div>';
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

            console.log('Rendering test results:', testCases);

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
                        <button class="test-filter-btn active" data-filter="all" onclick="setTestFilter('all')">All (\${testCases.length})</button>
                        <button class="test-filter-btn" data-filter="failed" onclick="setTestFilter('failed')">Failed (\${failedCount})</button>
                        <button class="test-filter-btn" data-filter="passed" onclick="setTestFilter('passed')">Passed (\${passedCount})</button>
                        <button class="test-filter-btn" data-filter="structural" onclick="setTestFilter('structural')">Structural</button>
                        <button class="test-filter-btn" data-filter="behavioral" onclick="setTestFilter('behavioral')">Behavioral</button>
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

            // Update button states
            const buttons = document.querySelectorAll('.test-filter-btn');
            buttons.forEach(btn => {
                if (btn.getAttribute('data-filter') === filter) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
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

        function generateStatusBadge(buildFailed, hasTestInfo, passedTests, totalTests, successful) {
            if (buildFailed) {
                return '<span class="status-badge failed">Build Failed<' + '/span>';
            }
            
            if (hasTestInfo) {
                const passPercentage = (passedTests / totalTests) * 100;
                let badgeClass = 'failed';
                
                if (passPercentage >= 80) {
                    badgeClass = 'success';
                } else if (passPercentage >= 40) {
                    badgeClass = 'partial';
                }
                
                return '<span class="status-badge ' + badgeClass + '">' + passedTests + '/' + totalTests + ' tests passed<' + '/span>';
            }
            
            return successful 
                ? '<span class="status-badge success">Build Success<' + '/span>'
                : '<span class="status-badge failed">Tests Failed<' + '/span>';
        }

        function renderBuildProgress(section, messageText, progressPercent, isIndeterminate = false) {
            if (!section) {
                return;
            }

            section.classList.remove('build-status--empty');
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
        }

        // Listen for messages from the extension
        window.addEventListener('message', function(event) {
            const message = event.data;
            switch (message.command) {
                case 'updateRepoStatus':
                    if (message.isConnected) {
                        const hasChanges = !!message.hasChanges;
                        const iconChar = '✓';
                        const tooltip = hasChanges
                            ? 'Connected to the exercise repository. Local changes detected. Click to rerun check.'
                            : 'Connected to the exercise repository. No local changes detected. Click to rerun check.';
                        updateRepoStatusIcon('connected', iconChar, tooltip, hasChanges);
                        updateButtonsForWorkspace(true, hasChanges);
                    } else {
                        updateRepoStatusIcon('disconnected', '!', 'Open the exercise repository to enable submissions. Click to rerun check.', false);
                        updateButtonsForWorkspace(false);
                    }
                    break;
                case 'submissionResult':
                    setSubmitLoading(false);
                    if (message.success) {
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
                    console.log('Received testResultsData message:', message);
                    if (message.testCases) {
                        renderTestResults(message.testCases);
                    } else {
                        console.log('No testCases in message, showing error');
                        const container = document.getElementById('testResultsContainer');
                        if (container) {
                            container.innerHTML = '<div class="test-results-loading">Error: ' + (message.error || 'No test data received') + '</div>';
                            container.dataset.loaded = 'true';
                        }
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
                if (!participations.length) {
                    vscode.postMessage({ command: 'alert', text: 'No participation found. Start the exercise first.' });
                    return;
                }
                const participation = participations[0];
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
                if (!participations.length) {
                    vscode.postMessage({ command: 'alert', text: 'No participation found. Start the exercise first.' });
                    return;
                }
                const participation = participations[0];
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
            const submitBtn = document.getElementById('submitBtn');
            const uploadBtn = document.getElementById('uploadMessageBtn');

            const isSubmitDisabled = submitBtn ? submitBtn.disabled : false;
            const isUploadDisabled = uploadBtn ? uploadBtn.disabled : false;
            if (isSubmitDisabled || isUploadDisabled) {
                vscode.postMessage({ command: 'alert', text: 'No local changes detected to submit.' });
                return;
            }

            try {
                const ex = exerciseData.exercise || exerciseData;
                const participations = ex.studentParticipations || [];
                if (!participations.length) {
                    vscode.postMessage({ command: 'alert', text: 'No participation found. Start the exercise first.' });
                    return;
                }
                const participation = participations[0];

                setSubmitLoading(true);
                vscode.postMessage({
                    command: 'submitExercise',
                    participationId: participation.id,
                    exerciseId: ex.id,
                    exerciseTitle: ex.title,
                    commitMessage: commitMessage
                });
            } catch (e) {
                setSubmitLoading(false);
                vscode.postMessage({ command: 'alert', text: 'Error preparing submit operation.' });
            }
        }

        window.submitExercise = function() {
            const commitInput = document.getElementById('commitMessageInput');
            const commitContainer = document.getElementById('commitMessageContainer');
            const commitMessage = commitContainer && commitContainer.style.display !== 'none'
                ? (commitInput?.value.trim() || undefined)
                : undefined;
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
            console.log('📊 Received new result from WebSocket:', result);

            if (!result || !window.exerciseData) {
                return;
            }

            const participation = resolveParticipationForResult(result);

            if (!participation) {
                console.log('ℹ️ Ignoring result that does not belong to the active exercise or participation.');
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

            console.log('✅ Updated exerciseData with new result. Submission results:', targetSubmission.results.length);

            const exercise = getActiveExercise();
            const scorePercentage = typeof result.score === 'number' ? result.score : 0;
            const successful = result.successful === true;
            const maxPoints = exercise?.maxPoints || 0;
            const scorePoints = Math.round((scorePercentage / 100) * maxPoints * 100) / 100;

            const totalTests = result.testCaseCount || 0;
            const passedTests = result.passedTestCaseCount || 0;
            const hasTestInfo = totalTests > 0;
            const buildFailed = targetSubmission.buildFailed ?? result.submission?.buildFailed ?? false;

            const buildStatusSection = ensureBuildStatusSection();
            if (buildStatusSection) {
                buildStatusSection.classList.remove('build-status--empty');
                delete buildStatusSection.dataset.progressMode;

                const statusBadge = generateStatusBadge(buildFailed, hasTestInfo, passedTests, totalTests, successful);

                const testResultsToggle = hasTestInfo ?
                    '<div class="test-results-toggle-container">' +
                        '<a href="#" class="test-results-toggle" onclick="toggleTestResults(event)" id="testResultsToggle">' +
                            'See test results' +
                        '<' + '/a>' +
                    '<' + '/div>' +
                    '<div class="test-results-modal" id="testResultsModal" aria-hidden="true" onclick="handleTestResultsBackdrop(event)">' +
                        '<div class="test-results-modal-content">' +
                            '<div class="test-results-modal-header">' +
                                '<div class="test-results-modal-title">Test Results<' + '/div>' +
                                '<button class="test-results-modal-close" onclick="closeTestResultsModal()" aria-label="Close test results">&times;<' + '/button>' +
                            '<' + '/div>' +
                            '<div class="test-results-modal-body">' +
                                '<div class="test-results-container" id="testResultsContainer">' +
                                    '<div class="test-results-loading">Loading test results...<' + '/div>' +
                                '<' + '/div>' +
                            '<' + '/div>' +
                        '<' + '/div>' +
                    '<' + '/div>' : '';

                const resultHtml =
                    '<div class="build-status-title">Latest Build Status<' + '/div>' +
                    '<div class="build-status-info">' +
                        statusBadge +
                        '<div class="score-info">' +
                            'Score: <span class="score-points">' + scorePoints + '/' + maxPoints + ' (' + scorePercentage.toFixed(2) + '%)<' + '/span> ' + (maxPoints === 1 ? 'point' : 'points') +
                        '<' + '/div>' +
                    '<' + '/div>' +
                    testResultsToggle;

                buildStatusSection.innerHTML = resultHtml;
            }

            setSubmitLoading(false);

            if (window.buildProgressInterval) {
                clearInterval(window.buildProgressInterval);
                window.buildProgressInterval = null;
            }

            checkRepositoryStatus();
        }

        function handleNewSubmission(submission) {
            console.log('📤 Received new submission from WebSocket:', submission);

            if (!submission || !window.exerciseData) {
                return;
            }

            const participation = resolveParticipationForSubmission(submission);

            if (!participation) {
                console.log('ℹ️ Ignoring submission that does not belong to the active exercise or participation.');
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

            console.log('✅ Updated exerciseData with new submission. Total submissions:', participation.submissions.length);

            setSubmitLoading(true);
            
            const buildStatusSection = ensureBuildStatusSection();
            renderBuildProgress(buildStatusSection, '🔄 Submission received, queuing build...', 5, true);
        }

        function handleSubmissionProcessing(state, buildTimingInfo) {
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
        }
        
        function updateBuildStatusWithProgress(message, progressPercent, buildTimingInfo, isIndeterminate = false) {
            const buildStatusSection = ensureBuildStatusSection();
            if (!buildStatusSection) return;
            renderBuildProgress(buildStatusSection, message, progressPercent, isIndeterminate);
            
            // Update progress bar periodically
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
                    
                    const progressBar = document.querySelector('.build-progress-bar');
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
        }
    </script>
</body>
</html>`;
    }
}
