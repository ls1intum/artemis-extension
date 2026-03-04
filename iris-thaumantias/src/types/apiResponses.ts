// Lightweight response interfaces for Tier-2 API methods.
// These are passed through to WebViews as raw JSON — no runtime conversion.
// The index signature preserves extra fields the server may add.

export interface CourseDashboardResponse {
    courses?: CourseDashboardEntry[];
    [key: string]: unknown;
}

export interface CourseDashboardEntry {
    course?: CourseDashboardCourse;
    exercises?: ExerciseDetail[];
    [key: string]: unknown;
}

export interface CourseDashboardCourse {
    id?: number;
    title?: string;
    shortName?: string;
    description?: string;
    semester?: string;
    color?: string;
    startDate?: string;
    endDate?: string;
    numberOfStudents?: number;
    studentGroupName?: string;
    teachingAssistantGroupName?: string;
    editorGroupName?: string;
    instructorGroupName?: string;
    exercises?: ExerciseDetail[];
    exams?: ExamSummary[];
    [key: string]: unknown;
}

export interface ExerciseDetailsResponse {
    exercise?: ExerciseDetail;
    course?: CourseDashboardCourse;
    [key: string]: unknown;
}

export interface ExerciseDetail {
    id?: number;
    title?: string;
    shortName?: string;
    type?: string;
    releaseDate?: string;
    startDate?: string;
    dueDate?: string;
    maxPoints?: number;
    bonusPoints?: number;
    problemStatement?: string;
    mode?: string;
    includedInScore?: boolean;
    filePattern?: string;
    course?: CourseDashboardCourse;
    studentParticipations?: ParticipationSummary[];
    [key: string]: unknown;
}

export interface ParticipationSummary {
    id?: number;
    type?: string;
    repositoryUri?: string;
    submissions?: SubmissionSummary[];
    results?: ResultSummary[];
    [key: string]: unknown;
}

export interface SubmissionSummary {
    id?: number;
    submissionDate?: string;
    buildFailed?: boolean;
    commitHash?: string;
    results?: ResultSummary[];
    participationId?: number;
    [key: string]: unknown;
}

export interface ResultSummary {
    id?: number;
    completionDate?: string;
    successful?: boolean;
    score?: number;
    feedbacks?: FeedbackSummary[];
    participationId?: number;
    [key: string]: unknown;
}

export interface FeedbackSummary {
    id?: number;
    text?: string;
    detailText?: string;
    credits?: number;
    positive?: boolean;
    [key: string]: unknown;
}

export interface IrisChatSession {
    id: number;
    creationDate?: string;
    messages?: IrisChatMessage[];
    [key: string]: unknown;
}

export interface IrisChatMessage {
    id?: number;
    sender?: string;
    sentAt?: string;
    content?: IrisChatMessageContent[];
    [key: string]: unknown;
}

export interface IrisChatMessageContent {
    textContent?: string;
    type?: string;
    [key: string]: unknown;
}

export interface IrisSettingsResponse {
    settings?: {
        enabled?: boolean;
        [key: string]: unknown;
    };
    effectiveRateLimit?: {
        requests?: number;
        timeframeHours?: number;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

export interface ExamSummary {
    id?: number;
    title?: string;
    startDate?: string;
    endDate?: string;
    [key: string]: unknown;
}

export interface StudentExam {
    id?: number;
    started?: boolean;
    exam?: ExamSummary & {
        startText?: string;
    };
    exercises?: ExerciseDetail[];
    workingTime?: number;
    individualEndDate?: string;
    startedDate?: string;
    [key: string]: unknown;
}


/**
 * Archived course structure (courses from previous semesters).
 */
export interface ArchivedCourse {
    id: number;
    title: string;
    semester?: string;
    color?: string;
    [key: string]: unknown;
}

/**
 * Full course detail data with exercises and exams.
 */
export interface CourseDetailData {
    course: CourseDashboardCourse & {
        exercises?: ExerciseDetail[];
        exams?: ExamSummary[];
        isArchived?: boolean;
    };
    [key: string]: unknown;
}
