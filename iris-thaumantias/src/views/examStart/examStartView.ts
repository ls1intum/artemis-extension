import * as vscode from 'vscode';
import { readCssFiles } from '../utils';
import { ButtonComponent } from '../components/button/buttonComponent';

export class ExamStartView {
    private _extensionContext: vscode.ExtensionContext;

    constructor(extensionContext: vscode.ExtensionContext) {
        this._extensionContext = extensionContext;
    }

    public generateHtml(studentExam: any, courseId: number, examId: number): string {
        const styles = readCssFiles(
            'components/button/button.css',
            'examStart/exam-start.css'
        );

        const exam = studentExam.exam;
        const startText = exam.startText || 'No rules defined for this exam.';
        const title = exam.title || 'Exam';
        const startDate = exam.startDate ? new Date(exam.startDate).toLocaleString() : 'Unknown';
        const endDate = exam.endDate ? new Date(exam.endDate).toLocaleString() : 'Unknown';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        ${styles}
    </style>
</head>
<body>
    <div class="exam-start-container">
        <div class="exam-header">
            <h1>${title}</h1>
            <div class="exam-dates">
                <span>Start: ${startDate}</span>
                <span>End: ${endDate}</span>
            </div>
        </div>

        <div class="exam-rules">
            <h2>Exam Rules</h2>
            <div class="rules-content">
                ${this._renderMarkdown(startText)}
            </div>
        </div>

        <div class="confirmation-section">
            <div class="checkbox-container">
                <input type="checkbox" id="confirmRules" onchange="toggleStartButton()">
                <label for="confirmRules">I confirm that I have read and understood the exam rules.</label>
            </div>

            <div class="actions">
                ${ButtonComponent.generate({
            label: 'Start Exam',
            variant: 'primary',
            id: 'startExamBtn',
            command: `startExam(${courseId}, ${examId}, ${studentExam.id})`,
            disabled: true
        })}
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function toggleStartButton() {
            const checkbox = document.getElementById('confirmRules');
            const startBtn = document.getElementById('startExamBtn');
            if (checkbox && startBtn) {
                if (checkbox.checked) {
                    startBtn.removeAttribute('disabled');
                    startBtn.classList.remove('button-disabled');
                } else {
                    startBtn.setAttribute('disabled', 'true');
                    startBtn.classList.add('button-disabled');
                }
            }
        }

        function startExam(courseId, examId, studentExamId) {
            vscode.postMessage({
                command: 'startExam',
                courseId: courseId,
                examId: examId,
                studentExamId: studentExamId
            });
        }
    </script>
</body>
</html>`;
    }

    private _renderMarkdown(text: string): string {
        // Simple markdown rendering for now. 
        // In a real implementation, use a library like marked or markdown-it.
        // This handles basic bold, italic, and lists.
        let html = text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');

        return html;
    }
}
