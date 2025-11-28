import * as vscode from 'vscode';
import { IconDefinitions } from '../../utils';
import { readCssFiles, processMarkdown } from '../utils';
import { BackLinkComponent } from '../components/backLink/backLinkComponent';
import { ButtonComponent } from '../components/button/buttonComponent';
import { ContainerComponent } from '../components/container/containerComponent';
import { BadgeComponent } from '../components/badge/badgeComponent';

export class ExamExerciseDetailView {
    private _extensionContext: vscode.ExtensionContext;

    constructor(extensionContext: vscode.ExtensionContext) {
        this._extensionContext = extensionContext;
    }

    public generateHtml(
        exercise: any,
        studentExam: any,
        courseId: number,
        examId: number,
        webview?: vscode.Webview
    ): string {
        const styles = readCssFiles(
            'components/button/button.css',
            'components/backLink/back-link.css',
            'components/container/container.css',
            'components/badge/badge.css',
            'examExerciseDetail/exam-exercise-detail.css'
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

        if (!exercise) {
            return this._getEmptyStateHtml(styles, webviewComponentsScriptTag);
        }

        return this._getExerciseDetailHtml(exercise, studentExam, courseId, examId, styles, webviewComponentsScriptTag);
    }

    private _getEmptyStateHtml(styles: string, webviewComponentsScriptTag: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Exam Exercise</title>
    <style>
        ${styles}
    </style>
    ${webviewComponentsScriptTag}
</head>
<body>
    ${BackLinkComponent.generateHtml({
            command: 'backToExam',
            label: '← Back to Exam',
            wrap: true
        })}
    
    <div class="empty-state">
        <h2>Exercise Not Found</h2>
        <p>The exercise could not be loaded.</p>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        ${BackLinkComponent.generateScript()}
    </script>
</body>
</html>`;
    }

    private _getExerciseDetailHtml(
        exercise: any,
        studentExam: any,
        courseId: number,
        examId: number,
        styles: string,
        webviewComponentsScriptTag: string
    ): string {
        const exerciseType = exercise.type || 'unknown';
        const exerciseIcon = IconDefinitions.getIcon(exerciseType);
        const title = exercise.title || 'Exercise';
        const maxPoints = exercise.maxPoints || 0;
        const bonusPoints = exercise.bonusPoints || 0;

        // Process problem statement markdown
        const { html: problemStatementHtml } = processMarkdown(
            exercise.problemStatement || 'No problem statement available.'
        );

        // Determine exercise type category
        const isProgramming = exerciseType === 'programming';
        const isQuiz = exerciseType === 'quiz';
        const isText = exerciseType === 'text';
        const isModeling = exerciseType === 'modeling';
        const isFileUpload = exerciseType === 'file-upload';

        // Get exercise-specific content
        const exerciseSpecificContent = this._getExerciseTypeContent(exercise, isProgramming, isQuiz, isText, isModeling, isFileUpload);

        // Header container with exercise info
        const headerContainer = ContainerComponent.generate({
            id: 'exercise-header',
            variant: 'highlight',
            accentPosition: 'left',
            bodyHtml: `
                <div class="exercise-header-content">
                    <div class="exercise-icon-large">${exerciseIcon}</div>
                    <div class="exercise-header-info">
                        <h1 class="exercise-title">${title}</h1>
                        <div class="exercise-meta">
                            ${BadgeComponent.generate({
                label: exerciseType,
                variant: 'secondary'
            })}
                            ${BadgeComponent.generate({
                label: `${maxPoints} ${maxPoints === 1 ? 'Point' : 'Points'}${bonusPoints > 0 ? ` + ${bonusPoints} Bonus` : ''}`,
                variant: 'primary'
            })}
                        </div>
                    </div>
                </div>
            `,
            className: 'exercise-header-card'
        });

        // Problem statement container
        const problemContainer = ContainerComponent.generate({
            id: 'problem-statement',
            header: {
                title: 'Problem Statement',
                collapsible: true,
                collapsed: false
            },
            bodyHtml: `<div class="problem-statement-content">${problemStatementHtml}</div>`,
            className: 'problem-statement-card'
        });

        // Exercise-specific container (different for each type)
        const exerciseContentContainer = exerciseSpecificContent;

        // Actions container
        const actionsContainer = this._getActionsContainer(exercise, isProgramming, courseId, examId);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        ${styles}
    </style>
    ${webviewComponentsScriptTag}
</head>
<body>
    <div class="exam-exercise-container">
        ${BackLinkComponent.generateHtml({
            command: 'backToExam',
            label: '← Back to Exam',
            wrap: true
        })}
        
        ${headerContainer}
        ${problemContainer}
        ${exerciseContentContainer}
        ${actionsContainer}
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const exercise = ${JSON.stringify(exercise)};
        const studentExam = ${JSON.stringify(studentExam)};
        const courseId = ${courseId};
        const examId = ${examId};

        ${BackLinkComponent.generateScript()}

        function backToExam() {
            vscode.postMessage({
                command: 'backToExam'
            });
        }

        function openInBrowser() {
            vscode.postMessage({
                command: 'openExerciseInBrowser',
                courseId: courseId,
                examId: examId,
                exerciseId: exercise.id
            });
        }

        function cloneRepository() {
            vscode.postMessage({
                command: 'cloneExamExercise',
                exerciseId: exercise.id,
                exerciseTitle: exercise.title
            });
        }

        function openRepository() {
            vscode.postMessage({
                command: 'openExamExerciseRepository',
                exerciseId: exercise.id
            });
        }

        function submitExercise() {
            vscode.postMessage({
                command: 'submitExamExercise',
                exerciseId: exercise.id
            });
        }

        // Collapsible sections
        document.querySelectorAll('.ui-container__toggle').forEach(toggle => {
            toggle.addEventListener('click', () => {
                const container = toggle.closest('.ui-container');
                if (container) {
                    container.classList.toggle('is-collapsed');
                }
            });
        });
    </script>
</body>
</html>`;
    }

    private _getExerciseTypeContent(
        exercise: any,
        isProgramming: boolean,
        isQuiz: boolean,
        isText: boolean,
        isModeling: boolean,
        isFileUpload: boolean
    ): string {
        if (isProgramming) {
            return this._getProgrammingExerciseContent(exercise);
        } else if (isQuiz) {
            return this._getQuizExerciseContent(exercise);
        } else if (isText) {
            return this._getTextExerciseContent(exercise);
        } else if (isModeling) {
            return this._getModelingExerciseContent(exercise);
        } else if (isFileUpload) {
            return this._getFileUploadExerciseContent(exercise);
        }
        return this._getGenericExerciseContent(exercise);
    }

    private _getProgrammingExerciseContent(exercise: any): string {
        const programmingLanguage = exercise.programmingLanguage || 'Unknown';
        const allowOnlineEditor = exercise.allowOnlineEditor ?? true;
        const allowOfflineIde = exercise.allowOfflineIde ?? true;

        return ContainerComponent.generate({
            id: 'programming-details',
            header: {
                title: 'Programming Exercise',
                icon: IconDefinitions.getIcon('programming')
            },
            bodyHtml: `
                <div class="programming-info">
                    <div class="info-row">
                        <span class="info-label">Language:</span>
                        <span class="info-value">${programmingLanguage}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Online Editor:</span>
                        <span class="info-value">${allowOnlineEditor ? 'Allowed' : 'Not Allowed'}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Offline IDE:</span>
                        <span class="info-value">${allowOfflineIde ? 'Allowed' : 'Not Allowed'}</span>
                    </div>
                </div>
                <div class="programming-actions">
                    <p class="action-hint">Clone the repository to work on this exercise in VS Code.</p>
                    ${ButtonComponent.generate({
                label: 'Clone Repository',
                variant: 'primary',
                command: 'cloneRepository()',
                className: 'clone-btn'
            })}
                    ${ButtonComponent.generate({
                label: 'Open Existing Repository',
                variant: 'secondary',
                command: 'openRepository()',
                className: 'open-btn'
            })}
                </div>
            `,
            className: 'programming-details-card'
        });
    }

    private _getQuizExerciseContent(exercise: any): string {
        const quizQuestions = exercise.quizQuestions || [];
        const questionCount = quizQuestions.length;

        return ContainerComponent.generate({
            id: 'quiz-details',
            variant: 'muted',
            header: {
                title: 'Quiz Exercise',
                icon: IconDefinitions.getIcon('quiz'),
                badge: `${questionCount} Question${questionCount !== 1 ? 's' : ''}`
            },
            bodyHtml: `
                <div class="quiz-info">
                    <p class="quiz-notice">
                        Quiz exercises must be completed in the Artemis web interface.
                    </p>
                    <p class="quiz-hint">
                        Click the button below to open this quiz in your browser.
                    </p>
                </div>
            `,
            className: 'quiz-details-card'
        });
    }

    private _getTextExerciseContent(exercise: any): string {
        return ContainerComponent.generate({
            id: 'text-details',
            variant: 'muted',
            header: {
                title: 'Text Exercise',
                icon: IconDefinitions.getIcon('text')
            },
            bodyHtml: `
                <div class="text-info">
                    <p class="text-notice">
                        Text exercises must be completed in the Artemis web interface.
                    </p>
                    <p class="text-hint">
                        Click the button below to open this exercise in your browser and submit your text answer.
                    </p>
                </div>
            `,
            className: 'text-details-card'
        });
    }

    private _getModelingExerciseContent(exercise: any): string {
        const diagramType = exercise.diagramType || 'Unknown';

        return ContainerComponent.generate({
            id: 'modeling-details',
            variant: 'muted',
            header: {
                title: 'Modeling Exercise',
                icon: IconDefinitions.getIcon('modeling')
            },
            bodyHtml: `
                <div class="modeling-info">
                    <div class="info-row">
                        <span class="info-label">Diagram Type:</span>
                        <span class="info-value">${diagramType}</span>
                    </div>
                    <p class="modeling-notice">
                        Modeling exercises must be completed in the Artemis web interface.
                    </p>
                    <p class="modeling-hint">
                        Click the button below to open the modeling editor in your browser.
                    </p>
                </div>
            `,
            className: 'modeling-details-card'
        });
    }

    private _getFileUploadExerciseContent(exercise: any): string {
        const filePattern = exercise.filePattern || '*.*';

        return ContainerComponent.generate({
            id: 'file-upload-details',
            variant: 'muted',
            header: {
                title: 'File Upload Exercise',
                icon: IconDefinitions.getIcon('file-upload')
            },
            bodyHtml: `
                <div class="file-upload-info">
                    <div class="info-row">
                        <span class="info-label">Allowed Files:</span>
                        <span class="info-value">${filePattern}</span>
                    </div>
                    <p class="file-upload-notice">
                        File upload exercises must be completed in the Artemis web interface.
                    </p>
                    <p class="file-upload-hint">
                        Click the button below to upload your files in the browser.
                    </p>
                </div>
            `,
            className: 'file-upload-details-card'
        });
    }

    private _getGenericExerciseContent(exercise: any): string {
        return ContainerComponent.generate({
            id: 'generic-details',
            variant: 'muted',
            header: {
                title: 'Exercise Details'
            },
            bodyHtml: `
                <div class="generic-info">
                    <p class="generic-notice">
                        This exercise type should be completed in the Artemis web interface.
                    </p>
                </div>
            `,
            className: 'generic-details-card'
        });
    }

    private _getActionsContainer(
        exercise: any,
        isProgramming: boolean,
        courseId: number,
        examId: number
    ): string {
        const actionButtons = isProgramming
            ? `
                ${ButtonComponent.generate({
                label: 'Submit via Git',
                variant: 'primary',
                command: 'submitExercise()',
                className: 'submit-btn'
            })}
                ${ButtonComponent.generate({
                label: 'Open in Browser',
                variant: 'secondary',
                command: 'openInBrowser()',
                className: 'browser-btn'
            })}
            `
            : `
                ${ButtonComponent.generate({
                label: 'Open in Browser',
                variant: 'primary',
                command: 'openInBrowser()',
                className: 'browser-btn'
            })}
            `;

        return ContainerComponent.generate({
            id: 'actions-footer',
            bodyHtml: `
                <div class="actions-content">
                    ${actionButtons}
                </div>
            `,
            className: 'actions-card'
        });
    }
}
