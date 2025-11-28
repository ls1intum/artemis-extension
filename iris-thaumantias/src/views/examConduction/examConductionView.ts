import * as vscode from 'vscode';
import { IconDefinitions } from '../../utils';
import { readCssFiles } from '../utils';
import { ButtonComponent } from '../components/button/buttonComponent';
import { ListItemComponent } from '../components/listItem/listItemComponent';
import { BackLinkComponent } from '../components/backLink/backLinkComponent';
import { ContainerComponent } from '../components/container/containerComponent';

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
            'components/container/container.css',
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
                    command: `openExamExercise(${index})`,
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

        const headerContainer = ContainerComponent.generate({
            id: 'exam-header',
            bodyHtml: `
                <div class="exam-header-content">
                    <h1 class="exam-title">${title}</h1>
                    <div class="timer-container" id="examTimer">Loading timer...</div>
                </div>
                <div class="progress-bar-container"><div class="progress-bar" id="examProgressBar" style="width: 0%"></div></div>
            `,
            className: 'exam-header-card'
        });

        const exercisesContainer = ContainerComponent.generate({
            id: 'exercises-section',
            header: {
                title: 'Exercises',
                badge: exercises.length.toString()
            },
            bodyHtml: `<div class="exercises-list">${exercisesHtml}</div>`,
            className: 'exercises-section'
        });

        const footerContainer = ContainerComponent.generate({
            id: 'exam-footer',
            bodyHtml: `
                <div class="warning-text" style="margin-bottom: 16px; text-align: center;">
                    To submit your exam, please visit the Artemis website.
                </div>
                <div style="display: flex; justify-content: center;">
                    ${ButtonComponent.generate({
                label: 'Open in Artemis',
                variant: 'primary',
                className: 'submit-exam-btn',
                command: `openInBrowser(${courseId}, ${examId})`,
                height: '2rem',
                alignText: 'center'
            })}
                </div>
            `,
            className: 'exam-footer-card'
        });

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
        
        ${headerContainer}
        ${exercisesContainer}
        ${footerContainer}
    </div>

    <script>


        const vscode = acquireVsCodeApi();
        const studentExam = ${JSON.stringify(studentExam)};
        
        // Timer Logic
        function initTimer() {
            // Calculate individual end date like Artemis does:
            // For regular exams: exam.startDate + studentExam.workingTime
            // For test exams: studentExam.startedDate + studentExam.workingTime
            let endTime;
            let startTime;
            
            if (studentExam.exam.testExam && studentExam.startedDate) {
                // Test exam: use startedDate
                startTime = new Date(studentExam.startedDate).getTime();
                endTime = startTime + (studentExam.workingTime * 1000);
            } else if (studentExam.exam.startDate && studentExam.workingTime) {
                // Regular exam: use exam startDate + individual workingTime
                startTime = new Date(studentExam.exam.startDate).getTime();
                endTime = startTime + (studentExam.workingTime * 1000);
            } else {
                // Fallback (should not happen in practice)
                startTime = new Date().getTime();
                endTime = startTime + (studentExam.workingTime * 1000);
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
                    timerElement.textContent = '0min 0s';
                    timerElement.classList.add('timer-expired');
                    progressBar.style.width = '100%';
                    return;
                }

                // Format time like Artemis
                const totalSeconds = Math.floor(timeLeft / 1000);
                const hours = Math.floor(totalSeconds / 3600);
                const minutes = Math.floor((totalSeconds % 3600) / 60);
                const seconds = totalSeconds % 60;

                // Artemis format:
                // >= 1 hour: show hours and minutes (e.g., "1h 7min")
                // >= 10 minutes: show only minutes (e.g., "15min")
                // 1-10 minutes: show minutes and seconds (e.g., "8min 0s")
                // < 1 minute: show only seconds (e.g., "45s")
                let displayText;
                if (hours > 0) { // >= 1 hour
                    displayText = hours + 'h ' + minutes + 'min';
                } else if (totalSeconds >= 600) { // >= 10 minutes
                    displayText = minutes + 'min';
                } else if (totalSeconds >= 60) { // 1-10 minutes
                    displayText = minutes + 'min ' + seconds + 's';
                } else { // < 1 minute
                    displayText = seconds + 's';
                }

                timerElement.textContent = displayText;
                
                // Update progress bar based on working time
                const totalDuration = studentExam.workingTime * 1000;
                const elapsed = now - startTime;
                const percentage = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
                progressBar.style.width = percentage + '%';
                
                // Add warning class if less than 5 minutes
                if (timeLeft < 5 * 60 * 1000) {
                    timerElement.classList.add('timer-warning');
                }
            }

            setInterval(updateTimer, 1000);
            updateTimer();
        }

        initTimer();

        window.openExamExercise = function(exerciseIndex) {
            const exercise = studentExam.exercises[exerciseIndex];
            vscode.postMessage({
                command: 'openExamExerciseDetails',
                exercise: exercise,
                exerciseIndex: exerciseIndex,
                courseId: ${courseId},
                examId: ${examId}
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
