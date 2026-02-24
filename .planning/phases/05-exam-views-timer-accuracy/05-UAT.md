---
status: complete
phase: 05-exam-views-timer-accuracy
source: 05-01-SUMMARY.md, 05-02-SUMMARY.md
started: 2026-02-24T12:00:00Z
updated: 2026-02-24T12:30:00Z
---

## Current Test

[testing complete]

## Tests

### 1. ExamConduction View Layout
expected: Open a started exam. The ExamConduction view should show: "Back to Course" link at top, "Open in Browser" and "Refresh" icon buttons, ExamTimer with countdown and progress bar, exam title as heading, exercise list with exercise number, title, type icon, max points, and type badge.
result: skipped
reason: requires active exam environment

### 2. Exercise Workspace Highlighting
expected: With a workspace exercise cloned/open, the ExamConduction exercise list should show an "Open" badge next to that exercise, distinguishing it from other exercises.
result: skipped
reason: requires active exam environment

### 3. Test Exam Badge
expected: When viewing a test/practice exam (testExam=true), a "Test Exam" badge should appear in the ExamConduction view header area.
result: skipped
reason: requires active exam environment

### 4. Timer Artemis Format
expected: Timer displays Artemis-compatible format at different durations: "1h 7min" for >= 1 hour, "15min" for >= 10 minutes, "8min 0s" for 1-10 minutes, "45s" for < 1 minute.
result: skipped
reason: requires active exam environment

### 5. Timer Warning State
expected: When less than 5 minutes remain on the exam timer, it should turn red with a pulse animation to warn the student.
result: skipped
reason: requires active exam environment

### 6. Timer Expired Overlay
expected: When the exam timer reaches zero, a modal overlay appears with "Time's Up" heading, message about exam expiry, and a "Close" button to dismiss it.
result: skipped
reason: requires active exam environment

### 7. ExamStart View - Before Exam Starts
expected: When viewing an exam that hasn't started yet, ExamStart shows: "Back to Course" link, exam title, relative start/end dates ("Starts: in 2 days"), working time duration, countdown timer to start time ("Exam starts in: [timer]"), "Refresh" button, and "Open in Browser" button.
result: skipped
reason: requires active exam environment

### 8. ExamStart View - During Exam
expected: When viewing a started exam from the start page, ExamStart shows: remaining working time timer ("Time remaining: [timer]") with progress bar, "Enter Exam" button (instead of "Refresh"), relative dates showing "Started: X ago".
result: skipped
reason: requires active exam environment

### 9. Exam Rules Display
expected: ExamStart view shows exam rules (startText) in a collapsible section labeled "Exam Rules" with subtitle "Please review before you begin". HTML content is sanitized (no script injection). Rules can be expanded/collapsed.
result: skipped
reason: requires active exam environment

### 10. ExamExerciseDetail Layout
expected: Opening an exercise from the exam shows: timer header with "Back to Exam" link and ExamTimer with progress bar, then exercise content below (problem statement, submission status, score info, test results if available). No "Ask Iris" button visible. No fullscreen button.
result: skipped
reason: requires active exam environment

### 11. Back to Exam Navigation
expected: Clicking "Back to Exam" from ExamExerciseDetail returns to the ExamConduction view with the exercise list and timer still running.
result: skipped
reason: requires active exam environment

### 12. ExamConduction Reload
expected: Clicking the "Refresh" button on ExamConduction fetches fresh exam data and updates the view (exercise list, timer, workspace highlighting) without a full page reload or flash.
result: skipped
reason: requires active exam environment

## Summary

total: 12
passed: 0
issues: 0
pending: 0
skipped: 12

## Gaps

[none yet]
