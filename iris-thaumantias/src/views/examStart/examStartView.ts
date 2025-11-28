import * as vscode from 'vscode';
import { readCssFiles } from '../utils';
import { ButtonComponent } from '../components/button/buttonComponent';
import { BackLinkComponent } from '../components/backLink/backLinkComponent';

export class ExamStartView {
    private _extensionContext: vscode.ExtensionContext;

    constructor(extensionContext: vscode.ExtensionContext) {
        this._extensionContext = extensionContext;
    }

    public generateHtml(studentExam: any, courseId: number, examId: number, hideDeveloperTools: boolean = false): string {
        const styles = readCssFiles(
            'components/button/button.css',
            'components/backLink/back-link.css',
            'examStart/exam-start.css'
        );

        const exam = studentExam.exam;
        let startText = exam.startText || 'No rules defined for this exam.';
        
        if (startText) {
            // Remove HTML comments
            startText = startText.replace(/<!--[\s\S]*?-->/g, '');
            
            // Normalize newlines
            startText = startText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            
            // Remove newlines around block elements to prevent double spacing with white-space: pre-line
            // We want to rely on CSS margins for block elements, but keep newlines for plain text
            const blockTags = 'div|p|ul|ol|li|h[1-6]|blockquote';
            startText = startText.replace(new RegExp(`\\n+\\s*<(${blockTags})`, 'gi'), '<$1');
            startText = startText.replace(new RegExp(`</(${blockTags})>\\s*\\n+`, 'gi'), '</$1>');
            
            // Collapse multiple newlines to max 2 (one empty line) for plain text sections
            startText = startText.replace(/\n{3,}/g, '\n\n');
            
            // Trim <br> tags and whitespace at start and end
            startText = startText.replace(/^(\s*<br\s*\/?>\s*)+/i, '').replace(/(\s*<br\s*\/?>\s*)+$/i, '');
            startText = startText.trim();
        }

        const title = exam.title || 'Exam';
        const startDate = exam.startDate ? new Date(exam.startDate).toLocaleString() : 'Unknown';
        const endDate = exam.endDate ? new Date(exam.endDate).toLocaleString() : 'Unknown';

        const debugButton = !hideDeveloperTools ? ButtonComponent.generate({
            label: 'Debug: Open Rules',
            variant: 'secondary',
            className: 'debug-btn',
            command: 'openRulesInEditor()',
            height: '2rem'
        }) : '';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        ${styles}
        .debug-btn {
            margin-top: 10px;
        }
    </style>
</head>
<body>
    <div class="exam-start-container">
        ${BackLinkComponent.generateHtml({
            label: '← Back to Course',
            command: 'backToCourseDetails',
            wrap: true
        })}
        
        <div class="exam-header-card">
            <h1>${title}</h1>
            <div class="exam-dates">
                <span>Start: ${startDate}</span>
                <span>End: ${endDate}</span>
            </div>
        </div>

        <div class="exam-rules-card">
            <h2>Exam Rules</h2>
            <div class="rules-content">${startText}</div>
        </div>

        <div class="exam-confirmation-card">
            <div class="checkbox-container">
                <input type="checkbox" id="confirmRules" onchange="toggleStartButton()">
                <label for="confirmRules">I confirm that I have read and understood the exam rules.</label>
            </div>

            <div class="actions" style="display: flex; flex-direction: row; justify-content: center; gap: 16px; flex-wrap: wrap;">
                ${ButtonComponent.generate({
                    label: 'Start Exam',
                    variant: 'primary',
                    id: 'startExamBtn',
                    height: '2rem',
                    disabled: true,
                    dataAttributes: {
                        'command': `startExam(${courseId}, ${examId}, ${studentExam.id})`
                    }
                })}
                ${ButtonComponent.generate({
                    label: 'Open in Browser',
                    variant: 'secondary',
                    command: `openInBrowser(${courseId}, ${examId})`,
                    height: '2rem'
                })}
                ${debugButton}
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const startText = ${JSON.stringify(startText)};
        
        ${BackLinkComponent.generateScript()}

        function toggleStartButton() {
            const checkbox = document.getElementById('confirmRules');
            const startBtn = document.getElementById('startExamBtn');
            if (checkbox && startBtn) {
                if (checkbox.checked) {
                    startBtn.removeAttribute('disabled');
                    startBtn.classList.remove('btn-disabled');
                    const command = startBtn.dataset.command;
                    if (command) {
                        startBtn.setAttribute('onclick', command);
                    }
                } else {
                    startBtn.setAttribute('disabled', 'true');
                    startBtn.classList.add('btn-disabled');
                    startBtn.removeAttribute('onclick');
                }
            }
        }

        function openRulesInEditor() {
            vscode.postMessage({
                command: 'openRulesInEditor',
                text: startText
            });
        }

        function openInBrowser(courseId, examId) {
            vscode.postMessage({
                command: 'openExamInBrowser',
                courseId: courseId,
                examId: examId
            });
        }
    </script>
</body>
</html>`;
    }
}