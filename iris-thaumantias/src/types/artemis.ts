// Authentication related types
export interface LoginCredentials {
    username: string;
    password: string;
    rememberMe?: boolean;
}

export interface AuthenticationResult {
    success: boolean;
    token?: string;
    cookie?: string;
    user?: ArtemisUser;
}

// Artemis API types
export interface ArtemisUser {
    id?: number;
    login: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    activated?: boolean;
    langKey?: string;
    authorities?: string[];
}

export interface ArtemisCourse {
    id: number;
    title: string;
    shortName: string;
    description?: string;
    startDate?: string;
    endDate?: string;
    semester?: string;
    studentGroupName?: string;
    teachingAssistantGroupName?: string;
    editorGroupName?: string;
    instructorGroupName?: string;
}

export interface ArtemisExercise {
    id: number;
    title: string;
    shortName: string;
    type: 'programming' | 'modeling' | 'quiz' | 'text' | 'file-upload';
    releaseDate?: string;
    dueDate?: string;
    assessmentDueDate?: string;
    maxPoints?: number;
    bonusPoints?: number;
    course?: ArtemisCourse;
}

export interface ArtemisParticipation {
    id: number;
    type: 'student' | 'template' | 'solution';
    student?: ArtemisUser;
    team?: any; // TODO: Define team type
    exercise?: ArtemisExercise;
    repositoryUri?: string;
    buildPlanId?: string;
    results?: ArtemisResult[];
}

export interface ArtemisResult {
    id: number;
    completionDate?: string;
    successful?: boolean;
    score?: number;
    rated?: boolean;
    feedbacks?: ArtemisFeedback[];
    participation?: ArtemisParticipation;
    assessor?: ArtemisUser;
}

export interface ArtemisFeedback {
    id?: number;
    text?: string;
    detailText?: string;
    reference?: string;
    credits?: number;
    type?: 'AUTOMATIC' | 'MANUAL';
    positive?: boolean;
}

// WebView message types
export interface WebviewMessage {
    command: string;
    [key: string]: any;
}

export interface LoginMessage extends WebviewMessage {
    command: 'login';
    username: string;
    password: string;
    rememberMe: boolean;
}

export interface LogoutMessage extends WebviewMessage {
    command: 'logout';
}

export interface LoginSuccessMessage extends WebviewMessage {
    command: 'loginSuccess';
    username: string;
    serverUrl: string;
    user?: ArtemisUser;
}

export interface LoginErrorMessage extends WebviewMessage {
    command: 'loginError';
    error: string;
}

export interface LogoutSuccessMessage extends WebviewMessage {
    command: 'logoutSuccess';
}

// Iris Health Status types
export interface IrisRateLimitInfo {
    currentMessageCount: number;
    rateLimit: number;
    rateLimitTimeframeHours: number;
}

export interface IrisHealthStatus {
    active: boolean;
    rateLimitInfo?: IrisRateLimitInfo;
}

// WebSocket/STOMP message types
export enum ProgrammingSubmissionState {
    BUILDING = 'BUILDING',
    QUEUED = 'QUEUED',
    HAS_FAILED_SUBMISSION = 'HAS_FAILED_SUBMISSION',
    ILLEGAL = 'ILLEGAL'
}

export interface BuildTimingInfo {
    buildStartDate?: string;
    estimatedCompletionDate?: string;
}

export interface ArtemisSubmission {
    id: number;
    submissionDate?: string;
    type?: string;
    participation?: ArtemisParticipation;
    results?: ArtemisResult[];
    buildFailed?: boolean;
}

export interface ProgrammingSubmission extends ArtemisSubmission {
    commitHash?: string;
    buildArtifact?: boolean;
}

export interface SubmissionProcessingMessage {
    exerciseId?: number;
    participationId: number;
    commitHash?: string;
    submissionDate?: string;
    buildStartDate?: string;
    estimatedCompletionDate?: string;
    submissionState?: ProgrammingSubmissionState;
    submission?: ProgrammingSubmission;
    buildTimingInfo?: BuildTimingInfo;
}

export interface ResultDTO {
    id: number;
    completionDate?: string;
    successful?: boolean;
    score?: number;
    rated?: boolean;
    participation?: {
        id: number;
        type?: string;
    };
    assessmentType?: string;
    feedbacks?: ArtemisFeedback[];
    testCaseCount?: number;
    passedTestCaseCount?: number;
    codeIssueCount?: number;
    submission?: {
        id?: number;
        buildFailed?: boolean;
    };
}

export interface WebSocketMessageHandler {
    onNewResult?: (result: ResultDTO) => void;
    onNewSubmission?: (submission: ProgrammingSubmission) => void;
    onSubmissionProcessing?: (message: SubmissionProcessingMessage) => void;
}