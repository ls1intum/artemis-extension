import * as vscode from 'vscode';
import { IconDefinitions } from '../../utils';
import { readCssFiles } from '../utils';
import { ButtonComponent } from '../components/button/buttonComponent';
import { ListItemComponent } from '../components/listItem/listItemComponent';
import { BackLinkComponent } from '../components/backLink/backLinkComponent';

export class ExamConductionView {
    private _extensionContext: vscode.ExtensionContext;

    constructor(extensionContext: vscode.ExtensionContext) {
        this._extensionContext = extensionContext;
    }

    public generateHtml(studentExam: any, courseId: number, examId: number): string {
        const styles = readCssFiles(
            'components/button/button.css',
            'components/listItem/list-item.css',
            'components/backLink/back-link.css',
            'examConduction/exam-conduction.css'
        );

        const exam = studentExam.exam;
        const title = exam.title || 'Exam';
        const exercises = studentExam.exercises || [];
        
        // Calculate end time
        // workingTime is in seconds
        // We need to know when it started or if we have an individual end date
        // Usually studentExam has individualEndDate if set, or we calculate from startDate + workingTime
        // For simplicity in this view, we'll rely on the client side timer if we can pass the absolute end time.
        // But studentExam usually has 'individualEndDate' if it's a real exam.
        // If not, we might need to calculate it.
        // Let's assume we pass the full studentExam object to the frontend and let it handle the timer logic or just display static info for now.
        
        const exercisesHtml = exercises.map((exercise: any, index: number) => {
            const exerciseIcon = IconDefinitions.getIcon(exercise.type);
            const points = exercise.maxPoints || 0;
            
            return ListItemComponent.generate(
                {
                    className: 'exercise-item',
                    clickable: true,
                    command: `openExercise(${exercise.id})`,
                    dataAttributes: {
                        'id': exercise.id.toString(),
                        'title': exercise.title
                    }
                },
                `
                    <div class="exercise-header">
                        <span class="exercise-number">Exercise ${index + 1}</span>
                        <span class="exercise-title">${exercise.title}</span>
                        <span class="exercise-type-icon">${exerciseIcon}</span>
                    </div>
                    <div class="exercise-info">
                        <span>${points} Points</span>
                        <span class="exercise-type">${exercise.type}</span>
                    </div>
                `
            );
        }).join('');

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
    <div class="exam-conduction-container">
        ${BackLinkComponent.generateHtml({
            label: '← Back to Course',
            command: 'backToCourseDetails',
            wrap: true
        })}
        <div class="exam-header">
            <div class="header-top">
                <h1>${title}</h1>
                <div class="timer-container" id="examTimer">
                    Loading timer...
                </div>
            </div>
            <div class="progress-bar-container">
                <div class="progress-bar" id="examProgressBar" style="width: 0%"></div>
            </div>
        </div>

        <div class="exercises-list">
            <h2>Exercises</h2>
            ${exercisesHtml}
        </div>

        <div class="exam-footer">
            <div class="warning-text">
                To submit your exam, please visit the Artemis website.
            </div>
            ${ButtonComponent.generate({
                label: 'Open in Artemis',
                variant: 'primary',
                className: 'submit-exam-btn',
                command: `openInBrowser()`,
                id: 'openInBrowserBtn'
            })}
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const studentExam = ${JSON.stringify(studentExam)};
        
        // Timer Logic
        function initTimer() {
            // Prefer individualEndDate if available, otherwise calculate
            // This is a simplified version. Real Artemis uses server time offset etc.
            let endTime;
            if (studentExam.individualEndDate) {
                endTime = new Date(studentExam.individualEndDate).getTime();
            } else if (studentExam.exam.endDate) {
                endTime = new Date(studentExam.exam.endDate).getTime();
            } else {
                // Fallback: workingTime is in seconds
                // This is inaccurate if we don't know exactly when it started relative to now
                // But usually individualEndDate is set for started exams
                endTime = new Date().getTime() + (studentExam.workingTime * 1000); 
            }

            const timerElement = document.getElementById('examTimer');
            const progressBar = document.getElementById('examProgressBar');
            
            // Total duration for progress bar (approximate if we don't have start time)
            // Let's assume workingTime is the total duration
            const totalDuration = studentExam.workingTime * 1000;

            function updateTimer() {
                const now = new Date().getTime();
                const timeLeft = endTime - now;

                if (timeLeft <= 0) {
                    timerElement.textContent = '00:00:00';
                    timerElement.classList.add('timer-expired');
                    progressBar.style.width = '100%';
                    return;
                }

                // Format time
                const hours = Math.floor(timeLeft / (1000 * 60 * 60));
                const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);

                timerElement.textContent = 
                    (hours < 10 ? '0' + hours : hours) + ':' +
                    (minutes < 10 ? '0' + minutes : minutes) + ':' +
                    (seconds < 10 ? '0' + seconds : seconds);
                
                // Update progress bar
                // We need start time to calculate progress correctly
                // If we don't have it, we can't show accurate progress bar growing
                // But we can show shrinking time?
                // Let's try to find start time
                let startTime;
                if (studentExam.exam.startDate) {
                    startTime = new Date(studentExam.exam.startDate).getTime();
                } else {
                    startTime = endTime - totalDuration;
                }
                
                const elapsed = now - startTime;
                const percentage = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
                progressBar.style.width = percentage + '%';
                
                if (timeLeft < 5 * 60 * 1000) { // Less than 5 mins
                    timerElement.classList.add('timer-warning');
                }
            }

            setInterval(updateTimer, 1000);
            updateTimer();
        }

        initTimer();

        window.openExercise = function(exerciseId) {
            vscode.postMessage({
                command: 'openExerciseDetails',
                exerciseId: exerciseId
            });
        };

        window.openInBrowser = function() {
            vscode.postMessage({
                command: 'openExamInBrowser',
                courseId: ${courseId},
                examId: ${examId}
            });
        };
        
        ${BackLinkComponent.generateScript()}
        
        // Enable keyboard navigation for list items
        ${ListItemComponent.generateScript()}
    </script>
</body>
</html>`;
    }
}
