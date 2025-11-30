import * as vscode from "vscode";
import { readCssFiles } from "../utils";
import { ButtonComponent } from "../components/button/buttonComponent";
import { BackLinkComponent } from "../components/backLink/backLinkComponent";
import { ContainerComponent } from "../components/container/containerComponent";

export class ExamStartView {
    private _extensionContext: vscode.ExtensionContext;

    constructor(extensionContext: vscode.ExtensionContext) {
        this._extensionContext = extensionContext;
    }

    public generateHtml(
        studentExam: any,
        courseId: number,
        examId: number,
        hideDeveloperTools: boolean = false
    ): string {
        const styles = readCssFiles(
            "components/container/container.css",
            "components/button/button.css",
            "components/button/iconButtons/iconButtons.css",
            "components/backLink/back-link.css",
            "examStart/exam-start.css"
        );

        const exam = studentExam.exam;
        let startText = exam.startText || "No rules defined for this exam.";

        if (startText) {
            // Remove HTML comments
            startText = startText.replace(/<!--[\s\S]*?-->/g, "");

            // Normalize newlines
            startText = startText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

            // Remove newlines around block elements to prevent double spacing with white-space: pre-line
            // We want to rely on CSS margins for block elements, but keep newlines for plain text
            const blockTags = "div|p|ul|ol|li|h[1-6]|blockquote";
            startText = startText.replace(
                new RegExp(`\\n+\\s*<(${blockTags})`, "gi"),
                "<$1"
            );
            startText = startText.replace(
                new RegExp(`</(${blockTags})>\\s*\\n+`, "gi"),
                "</$1>"
            );

            // Collapse multiple newlines to max 2 (one empty line) for plain text sections
            startText = startText.replace(/\n{3,}/g, "\n\n");

            // Trim <br> tags and whitespace at start and end
            startText = startText
                .replace(/^(\s*<br\s*\/?>\s*)+/i, "")
                .replace(/(\s*<br\s*\/?>\s*)+$/i, "");
            startText = startText.trim();
        }

        const title = exam.title || "Exam";
        const startDate = exam.startDate
            ? new Date(exam.startDate).toLocaleString()
            : "Unknown";
        const endDate = exam.endDate
            ? new Date(exam.endDate).toLocaleString()
            : "Unknown";

        // Check if exam can be started (within 5 minutes of start time)
        const now = new Date();
        const examStartDate = exam.startDate ? new Date(exam.startDate) : null;
        const examEndDate = exam.endDate ? new Date(exam.endDate) : null;
        const waitTimeMinutes = 5;
        const canStart = examStartDate
            ? now.getTime() + waitTimeMinutes * 60 * 1000 >= examStartDate.getTime()
            : false;

        // Calculate relative time for start
        const hasStarted = examStartDate ? now >= examStartDate : false;
        const startLabel = hasStarted ? "Started" : "Starts";
        const startRelative = examStartDate ? this.getRelativeTime(examStartDate, now) : "";

        // Calculate relative time for end
        const hasEnded = examEndDate ? now >= examEndDate : false;
        const endLabel = hasEnded ? "Ended" : "Ends";
        const endRelative = examEndDate ? this.getRelativeTime(examEndDate, now) : "";

        const debugButton = !hideDeveloperTools
            ? ButtonComponent.generate({
                label: "Debug: Open Rules",
                variant: "secondary",
                className: "debug-btn",
                command: "openRulesInEditor()",
                height: "2rem",
            })
            : "";

        const headerCard = ContainerComponent.generate({
            id: "examHeader",
            className: "exam-card exam-card__header",
            header: {
                title,
            },
            bodyHtml: `
                <div class="exam-dates">
                    <div class="exam-date">
                        <div class="label">${startLabel}</div>
                        <div class="value">${startDate}</div>
                        ${startRelative ? `<div class="relative">${startRelative}</div>` : ''}
                    </div>
                    <div class="exam-date">
                        <div class="label">${endLabel}</div>
                        <div class="value">${endDate}</div>
                        ${endRelative ? `<div class="relative">${endRelative}</div>` : ''}
                    </div>
                </div>
            `,
        });

        const rulesCard = ContainerComponent.generate({
            id: "examRules",
            className: "exam-card exam-card__rules",
            header: {
                title: "Exam Rules",
                subtitle: "Please review before you begin",
                collapsible: true,
                ariaToggleLabel: "Toggle exam rules",
                divider: true,
            },
            bodyHtml: `<div class="rules-content">${startText}</div>`,
        });

        const confirmationCard = ContainerComponent.generate({
            id: "examConfirmation",
            className: "exam-card exam-card__confirm",
            variant: "default",
            textAlign: "center",
            header: {
                title: "Start the exam in Artemis",
                subtitle: "Open in browser, then return to continue",
                textAlign: "center",
            },
            bodyHtml: `
                <div class="exam-confirmation">
                    <p class="exam-confirmation__text">
                        Please start the exam in the Artemis browser interface. Once started, return here and refresh to continue in VS Code.
                    </p>
                    <div class="actions">
                        ${ButtonComponent.generate({
                label: "Open in Browser",
                variant: "primary",
                command: `openInBrowser(${courseId}, ${examId})`,
            })}
                        ${ButtonComponent.generate({
                label: "Refresh / Enter Exam",
                variant: "secondary",
                command: `refreshExam(${courseId}, ${examId}, ${studentExam.id})`,
            })}
                        ${debugButton}
                    </div>
                </div>
            `,
        });

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
    ${BackLinkComponent.generateHtml({
            label: "← Back to Course",
            command: "backToCourseDetails",
            wrap: true,
        })}
    <div class="exam-start-container">
        ${headerCard}
        ${rulesCard}
        ${confirmationCard}
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const startText = ${JSON.stringify(startText)};
        
        ${BackLinkComponent.generateScript()}

        function refreshExam(courseId, examId, studentExamId) {
            vscode.postMessage({
                command: 'refreshExam',
                courseId: courseId,
                examId: examId,
                studentExamId: studentExamId
            });
        }

        function openInBrowser(courseId, examId) {
            vscode.postMessage({
                command: 'openExamInBrowser',
                courseId: courseId,
                examId: examId
            });
        }

        function openRulesInEditor() {
            vscode.postMessage({
                command: 'openRulesInEditor',
                text: startText
            });
        }

        ${ContainerComponent.generateScript()}
    </script>
</body>
</html>`;
    }

    /**
     * Get a human-readable relative time string
     */
    private getRelativeTime(targetDate: Date, now: Date): string {
        const diffMs = targetDate.getTime() - now.getTime();
        const absDiffMs = Math.abs(diffMs);
        const isPast = diffMs < 0;

        const minutes = Math.floor(absDiffMs / (1000 * 60));
        const hours = Math.floor(absDiffMs / (1000 * 60 * 60));
        const days = Math.floor(absDiffMs / (1000 * 60 * 60 * 24));

        let timeStr: string;
        if (days > 0) {
            timeStr = days === 1 ? '1 day' : `${days} days`;
        } else if (hours > 0) {
            timeStr = hours === 1 ? '1 hour' : `${hours} hours`;
        } else if (minutes > 0) {
            timeStr = minutes === 1 ? '1 minute' : `${minutes} minutes`;
        } else {
            timeStr = 'less than a minute';
        }

        return isPast ? `${timeStr} ago` : `in ${timeStr}`;
    }
}
