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
    /**
     * Pending build statuses keyed by `participation.id`. Populated by the
     * extension's exerciseDataLoader after fetching the base details, and
     * later mutated in the webview store from WebSocket update events.
     *
     * Multiple participations may have concurrent pending builds (e.g.
     * graded + practice). The webview picks the entry that matches its
     * currently-selected participation. Previously this was a single
     * field that was silently overwritten per participation (#168).
     */
    pendingSubmissionsByParticipationId?: Record<number, PendingSubmissionStatus>;
    [key: string]: unknown;
}

/**
 * Pending-build status DTO shared between the extension host and the
 * webview store.
 *
 * Two producers feed this shape with deliberately asymmetric fidelity:
 *   - The REST `latest-pending-submission` endpoint only signals
 *     "a build is in flight for this participation" — the loader
 *     normalizes its `ProgrammingSubmission` response to bare
 *     `{ participationId }` (no state, no timing).
 *   - WebSocket `submissionProcessing` events carry the full status
 *     (queued vs. building, buildTimingInfo) and overwrite the entry.
 *
 * UI code is therefore tolerant of missing `state` and `buildTimingInfo`.
 */
export interface PendingSubmissionStatus {
    participationId: number;
    state?: string;
    buildTimingInfo?: {
        buildStartDate?: string;
        estimatedCompletionDate?: string;
    };
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
    repositoryUri?: string;
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
    lastActivityDate?: string;
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
    /**
     * `USER` | `LLM` | `ARTIFACT` | `CTXSWAP`, as Artemis persists them, and
     * deliberately widened to `string`: the server may add a sender this
     * build has never heard of, and a narrowed union would make that a parse
     * failure rather than a row we render conservatively. `CTXSWAP` rows are
     * context-change markers, not chat.
     */
    sender?: string;
    sentAt?: string;
    content?: IrisChatMessageContent[];
    origin?: string;
    proactiveOutcome?: 'DISMISSED' | 'RECOVERED' | 'ABANDONED';
    /** Client-allocated uuid grouping proactive messages by episode (C4/A9). */
    proactiveEpisodeId?: string;
    /** Tool activity persisted with this message; rendered as the trail. */
    activities?: IrisActivityDTO[];
    /** `false` marks an intermediate message. Absent or `true` means final. */
    final?: boolean;
    [key: string]: unknown;
}

export interface IrisChatMessageContent {
    type?: string;
    textContent?: string;
    /** Present on a `json` content item; the CTXSWAP marker payload lives here. */
    attributes?: unknown;
    [key: string]: unknown;
}

export type IrisRunState = 'RUNNING' | 'FINISHED' | 'FAILED';
export type IrisActivityState = 'RUNNING' | 'FINISHED' | 'FAILED';
export type IrisActivityKind = 'TOOL' | 'COMMAND';

/** One tool or command invocation reported by a Pyris run. */
export interface IrisActivityDTO {
    id: string;
    kind: IrisActivityKind;
    name: string;
    state: IrisActivityState;
    detail?: string;
    result?: string;
    durationMillis?: number;
}

export interface IrisSettingsResponse {
    settings?: {
        enabled?: boolean;
        /** Course-level proactive struggle detection toggle (spec §13; admin-only, default off). */
        proactiveStruggleEnabled?: boolean;
        [key: string]: unknown;
    };
    effectiveRateLimit?: {
        requests?: number;
        timeframeHours?: number;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}
