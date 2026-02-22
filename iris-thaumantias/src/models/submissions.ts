import { ArtemisFeedback, ArtemisParticipation, ArtemisResult } from './core';

// --- Submission State ---

export enum ProgrammingSubmissionState {
    BUILDING = 'BUILDING',
    QUEUED = 'QUEUED',
    HAS_FAILED_SUBMISSION = 'HAS_FAILED_SUBMISSION',
    ILLEGAL = 'ILLEGAL'
}

// --- WebSocket/STOMP Message Types ---

export class BuildTimingInfo {
    constructor(
        public readonly buildStartDate?: string,
        public readonly estimatedCompletionDate?: string,
    ) {}

    static fromJSON(data: unknown): BuildTimingInfo {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid BuildTimingInfo data');
        }
        const d = data as Record<string, unknown>;
        return new BuildTimingInfo(
            typeof d.buildStartDate === 'string' ? d.buildStartDate : undefined,
            typeof d.estimatedCompletionDate === 'string' ? d.estimatedCompletionDate : undefined,
        );
    }
}

export class ArtemisSubmission {
    constructor(
        public readonly id: number,
        public readonly submissionDate?: string,
        public readonly type?: string,
        public readonly participation?: ArtemisParticipation,
        public readonly results?: ArtemisResult[],
        public readonly buildFailed?: boolean,
    ) {}

    static fromJSON(data: unknown): ArtemisSubmission {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid ArtemisSubmission data');
        }
        const d = data as Record<string, unknown>;
        return new ArtemisSubmission(
            Number(d.id),
            typeof d.submissionDate === 'string' ? d.submissionDate : undefined,
            typeof d.type === 'string' ? d.type : undefined,
            d.participation && typeof d.participation === 'object' ? ArtemisParticipation.fromJSON(d.participation) : undefined,
            Array.isArray(d.results) ? d.results.map(r => ArtemisResult.fromJSON(r)) : undefined,
            typeof d.buildFailed === 'boolean' ? d.buildFailed : undefined,
        );
    }
}

export class ProgrammingSubmission extends ArtemisSubmission {
    constructor(
        id: number,
        public readonly commitHash?: string,
        public readonly buildArtifact?: boolean,
        submissionDate?: string,
        type?: string,
        participation?: ArtemisParticipation,
        results?: ArtemisResult[],
        buildFailed?: boolean,
    ) {
        super(id, submissionDate, type, participation, results, buildFailed);
    }

    static override fromJSON(data: unknown): ProgrammingSubmission {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid ProgrammingSubmission data');
        }
        const d = data as Record<string, unknown>;
        return new ProgrammingSubmission(
            Number(d.id),
            typeof d.commitHash === 'string' ? d.commitHash : undefined,
            typeof d.buildArtifact === 'boolean' ? d.buildArtifact : undefined,
            typeof d.submissionDate === 'string' ? d.submissionDate : undefined,
            typeof d.type === 'string' ? d.type : undefined,
            d.participation && typeof d.participation === 'object' ? ArtemisParticipation.fromJSON(d.participation) : undefined,
            Array.isArray(d.results) ? d.results.map(r => ArtemisResult.fromJSON(r)) : undefined,
            typeof d.buildFailed === 'boolean' ? d.buildFailed : undefined,
        );
    }
}

export class SubmissionProcessingMessage {
    constructor(
        public readonly participationId: number,
        public readonly exerciseId?: number,
        public readonly commitHash?: string,
        public readonly submissionDate?: string,
        public readonly buildStartDate?: string,
        public readonly estimatedCompletionDate?: string,
        public readonly submissionState?: ProgrammingSubmissionState,
        public readonly submission?: ProgrammingSubmission,
        public readonly buildTimingInfo?: BuildTimingInfo,
    ) {}

    static fromJSON(data: unknown): SubmissionProcessingMessage {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid SubmissionProcessingMessage data');
        }
        const d = data as Record<string, unknown>;
        return new SubmissionProcessingMessage(
            Number(d.participationId),
            typeof d.exerciseId === 'number' ? d.exerciseId : undefined,
            typeof d.commitHash === 'string' ? d.commitHash : undefined,
            typeof d.submissionDate === 'string' ? d.submissionDate : undefined,
            typeof d.buildStartDate === 'string' ? d.buildStartDate : undefined,
            typeof d.estimatedCompletionDate === 'string' ? d.estimatedCompletionDate : undefined,
            typeof d.submissionState === 'string' ? d.submissionState as ProgrammingSubmissionState : undefined,
            d.submission && typeof d.submission === 'object' ? ProgrammingSubmission.fromJSON(d.submission) : undefined,
            d.buildTimingInfo && typeof d.buildTimingInfo === 'object' ? BuildTimingInfo.fromJSON(d.buildTimingInfo) : undefined,
        );
    }
}

export class ResultDTO {
    constructor(
        public readonly id: number,
        public readonly completionDate?: string,
        public readonly successful?: boolean,
        public readonly score?: number,
        public readonly rated?: boolean,
        public readonly participation?: { id: number; type?: string },
        public readonly assessmentType?: string,
        public readonly feedbacks?: ArtemisFeedback[],
        public readonly testCaseCount?: number,
        public readonly passedTestCaseCount?: number,
        public readonly codeIssueCount?: number,
        public readonly submission?: { id?: number; buildFailed?: boolean },
    ) {}

    static fromJSON(data: unknown): ResultDTO {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid ResultDTO data');
        }
        const d = data as Record<string, unknown>;
        const rawParticipation = d.participation as Record<string, unknown> | undefined;
        const rawSubmission = d.submission as Record<string, unknown> | undefined;
        return new ResultDTO(
            Number(d.id),
            typeof d.completionDate === 'string' ? d.completionDate : undefined,
            typeof d.successful === 'boolean' ? d.successful : undefined,
            typeof d.score === 'number' ? d.score : undefined,
            typeof d.rated === 'boolean' ? d.rated : undefined,
            rawParticipation && typeof rawParticipation === 'object'
                ? { id: Number(rawParticipation.id), type: typeof rawParticipation.type === 'string' ? rawParticipation.type : undefined }
                : undefined,
            typeof d.assessmentType === 'string' ? d.assessmentType : undefined,
            Array.isArray(d.feedbacks) ? d.feedbacks.map(f => ArtemisFeedback.fromJSON(f)) : undefined,
            typeof d.testCaseCount === 'number' ? d.testCaseCount : undefined,
            typeof d.passedTestCaseCount === 'number' ? d.passedTestCaseCount : undefined,
            typeof d.codeIssueCount === 'number' ? d.codeIssueCount : undefined,
            rawSubmission && typeof rawSubmission === 'object'
                ? { id: typeof rawSubmission.id === 'number' ? rawSubmission.id : undefined, buildFailed: typeof rawSubmission.buildFailed === 'boolean' ? rawSubmission.buildFailed : undefined }
                : undefined,
        );
    }
}
