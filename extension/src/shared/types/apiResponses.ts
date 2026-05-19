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
    [key: string]: unknown;
}

export interface ExerciseDetailsResponse {
    exercise?: ExerciseDetail;
    plagiarismCaseInfo?: unknown;
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
    branch?: string;
    initializationState?: string;
    initializationDate?: string;
    testRun?: boolean;
    submissions?: SubmissionSummary[];
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
    /** Relative score in % (0-100, can exceed 100 with bonus points) */
    score?: number;
    rated?: boolean;
    assessmentType?: string;
    testCaseCount?: number;
    passedTestCaseCount?: number;
    codeIssueCount?: number;
    feedbacks?: FeedbackSummary[];
    participationId?: number;
    buildFailed?: boolean;
    [key: string]: unknown;
}

export interface FeedbackSummary {
    id?: number;
    text?: string;
    detailText?: string;
    reference?: string;
    credits?: number;
    positive?: boolean;
    type?: string;
    visibility?: string;
    hasLongFeedbackText?: boolean;
    testCase?: { id?: number; testName?: string };
    [key: string]: unknown;
}

export type IrisChatMode =
    | 'PROGRAMMING_EXERCISE_CHAT'
    | 'TEXT_EXERCISE_CHAT'
    | 'COURSE_CHAT'
    | 'LECTURE_CHAT';

/** Detail DTO returned by /api/iris/chat/sessions/current, /sessions, and /{courseId}/session/{sessionId}. */
export interface IrisChatSession {
    id: number;
    mode?: IrisChatMode;
    entityId?: number;
    userId?: number;
    title?: string;
    creationDate?: string;
    messages?: IrisChatMessage[];
    [key: string]: unknown;
}

/** Listing DTO returned by /api/iris/chat/{courseId}/sessions/overview. No messages. */
export interface IrisChatSessionSummary {
    id: number;
    entityId: number;
    entityName?: string;
    title?: string;
    creationDate: string;
    lastActivityDate?: string;
    mode: IrisChatMode;
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

export interface IrisStageDTO {
    name?: string;
    weight?: number;
    state?: 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE' | 'SKIPPED' | 'ERROR';
    message?: string;
    internal?: boolean;
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
