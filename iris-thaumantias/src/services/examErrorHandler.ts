import { ApiError } from '../types';

/**
 * Maps Artemis exam error keys and messages to user-friendly error messages.
 * Error keys are defined in Artemis backend (ExamAccessService, ExamResource, StudentExamResource).
 */
export function getExamErrorMessage(error: unknown): string {
    const detail = (error instanceof ApiError ? (error.detail || error.message) : error instanceof Error ? error.message : '').toLowerCase();
    const status = error instanceof ApiError ? error.status : undefined;
    const rawDetail = error instanceof ApiError ? (error.detail || error.message) : error instanceof Error ? error.message : '';
    const errorKey = extractErrorKey(rawDetail);

    // Map of Artemis error keys to user-friendly messages
    const errorKeyMessages: Record<string, string> = {
        // Exam state errors
        'examhasalreadyended': 'This exam has already ended. You can no longer participate.',
        'examended': 'This exam has already ended. You can no longer participate.',
        'examnotvisible': 'This exam is not yet visible. Please check the exam schedule.',
        'examnotover': 'This exam is not yet over.',

        // Participation errors
        'cannotparticipateinexams': 'Instructors and administrators cannot participate in exams as students.',
        'cannotregisterinstructor': 'Instructors and administrators cannot be registered for exams.',
        'startexerciseonlyforrealelexams': 'This operation is only allowed for real exams.',

        // Registration errors
        'addstudentOnlyforrealelexams': 'Adding students is only allowed for real exams.',
        'unregisterstudentsonlyforrealelexams': 'Unregistering students is only allowed for real exams.',
        'unregisterallonlyforrealelexams': 'Unregistering all students is only allowed for real exams.',
        'generatestudentexamsonlyforrealelexams': 'Generating student exams is only allowed for real exams.',
        'evaluatequizexercisesonlyforrealelexams': 'Evaluating quiz exercises is only allowed for real exams.',
        'addcoursestudentsonlyforrealelexams': 'Adding course students is only allowed for real exams.',

        // Test run errors
        'testrunnoliverealvents': 'Test runs do not have live events.',

        // Conflict errors
        'studentexamexamconflict': 'The student exam does not belong to this exam.',
        'examcourseconflict': 'The exam does not belong to this course.',
        'usermismatch': 'You are not the owner of this exam attempt.',
    };

    // Check for exact error key match (case-insensitive)
    const normalizedKey = errorKey.toLowerCase();
    if (errorKeyMessages[normalizedKey]) {
        return errorKeyMessages[normalizedKey];
    }

    // Check for partial matches in detail string for AccessForbiddenException messages
    if (detail.includes('not registered for the exam')) {
        return 'You are not registered for this exam. Please contact your instructor.';
    }
    if (detail.includes('cannot be started yet')) {
        return 'The exam cannot be started yet. Please wait until closer to the start time.';
    }
    if (detail.includes('instructors or administrators cannot participate')) {
        return 'Instructors and administrators cannot participate in exams as students.';
    }
    if (detail.includes('not the user of the requested student exam')) {
        return 'You are not authorized to access this student exam.';
    }
    if (detail.includes('submit between start and end')) {
        return 'You can only submit during the exam period.';
    }
    if (detail.includes('not allowed to access the summary') && detail.includes('not submitted')) {
        return 'You cannot access the summary of an exam that was not submitted.';
    }
    if (detail.includes('minutes before the exam start')) {
        return 'You cannot access the exam until 5 minutes before the start time.';
    }
    if (detail.includes('not allowed to manage exams')) {
        return 'You are not allowed to manage exams in this course.';
    }
    if (detail.includes('not allowed to access exams')) {
        return 'You are not allowed to access exams in this course.';
    }
    if (detail.includes('not allowed to access this exam')) {
        return 'You are not allowed to access this exam.';
    }
    if (detail.includes('example solution') && detail.includes('not published')) {
        return 'The example solution for this exam is not published yet.';
    }

    // Fallback based on HTTP status
    const errorDetail = error instanceof ApiError ? error.detail : undefined;
    if (status === 403) {
        return errorDetail
            ? `Access denied: ${errorDetail}`
            : 'Access denied. You may not have permission to access this exam.';
    }
    if (status === 400) {
        return errorDetail
            ? `Invalid request: ${errorDetail}`
            : 'Invalid request. Please try again.';
    }
    if (status === 404) {
        return 'Exam not found. Please check if the exam still exists.';
    }
    if (status === 409) {
        return errorDetail
            ? `Conflict: ${errorDetail}`
            : 'There was a conflict with your request.';
    }

    return errorDetail
        ? `Failed to open exam: ${errorDetail}`
        : 'Failed to open exam. Please try again.';
}

/**
 * Extracts the error key from an Artemis error message.
 * Handles formats like "error.examHasAlreadyEnded" or just "examHasAlreadyEnded"
 */
function extractErrorKey(message: string): string {
    if (!message) {
        return '';
    }
    // Remove "error." prefix if present
    const cleaned = message.replace(/^error\./, '');
    // Return the first word/key (before any spaces or punctuation)
    return cleaned.split(/[\s:.,]/)[0];
}
