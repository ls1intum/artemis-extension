import type { ArtemisFeedback, ArtemisParticipation, ArtemisResult } from './core';
import { parseArtemisFeedback, parseArtemisParticipation, parseArtemisResult } from './core';

// --- Submission State ---

export enum ProgrammingSubmissionState {
    BUILDING = 'BUILDING',
}

// --- WebSocket/STOMP Message Types ---

export interface BuildTimingInfo {
    readonly buildStartDate?: string;
    readonly estimatedCompletionDate?: string;
}

function parseBuildTimingInfo(data: unknown): BuildTimingInfo {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid BuildTimingInfo data');
    }
    const d = data as Record<string, unknown>;
    return {
        buildStartDate: typeof d.buildStartDate === 'string' ? d.buildStartDate : undefined,
        estimatedCompletionDate: typeof d.estimatedCompletionDate === 'string' ? d.estimatedCompletionDate : undefined,
    };
}

interface ArtemisSubmission {
    readonly id: number;
    readonly submissionDate?: string;
    readonly type?: string;
    readonly participation?: ArtemisParticipation;
    readonly results?: ArtemisResult[];
    readonly buildFailed?: boolean;
}

export interface ProgrammingSubmission extends ArtemisSubmission {
    readonly commitHash?: string;
    readonly buildArtifact?: boolean;
}

export function parseProgrammingSubmission(data: unknown): ProgrammingSubmission {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Invalid ProgrammingSubmission data');
    }
    const d = data as Record<string, unknown>;
    // Strict typeof check on the raw value: `Number(null)`, `Number(false)`,
    // and `Number('')` all coerce to 0, which would silently pass a downstream
    // `Number.isFinite` guard. Require the server to send a real number.
    if (typeof d.id !== 'number' || !Number.isFinite(d.id)) {
        throw new Error('Invalid ProgrammingSubmission: missing or non-numeric id');
    }
    return {
        id: d.id,
        commitHash: typeof d.commitHash === 'string' ? d.commitHash : undefined,
        buildArtifact: typeof d.buildArtifact === 'boolean' ? d.buildArtifact : undefined,
        submissionDate: typeof d.submissionDate === 'string' ? d.submissionDate : undefined,
        type: typeof d.type === 'string' ? d.type : undefined,
        participation: d.participation && typeof d.participation === 'object' ? parseArtemisParticipation(d.participation) : undefined,
        results: Array.isArray(d.results) ? d.results.map(r => parseArtemisResult(r)) : undefined,
        buildFailed: typeof d.buildFailed === 'boolean' ? d.buildFailed : undefined,
    };
}

export interface SubmissionProcessingMessage {
    readonly participationId: number;
    readonly exerciseId?: number;
    readonly commitHash?: string;
    readonly submissionDate?: string;
    readonly buildStartDate?: string;
    readonly estimatedCompletionDate?: string;
    readonly submissionState?: ProgrammingSubmissionState;
    readonly submission?: ProgrammingSubmission;
    readonly buildTimingInfo?: BuildTimingInfo;
}

export function parseSubmissionProcessingMessage(data: unknown): SubmissionProcessingMessage {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid SubmissionProcessingMessage data');
    }
    const d = data as Record<string, unknown>;
    return {
        participationId: Number(d.participationId),
        exerciseId: typeof d.exerciseId === 'number' ? d.exerciseId : undefined,
        commitHash: typeof d.commitHash === 'string' ? d.commitHash : undefined,
        submissionDate: typeof d.submissionDate === 'string' ? d.submissionDate : undefined,
        buildStartDate: typeof d.buildStartDate === 'string' ? d.buildStartDate : undefined,
        estimatedCompletionDate: typeof d.estimatedCompletionDate === 'string' ? d.estimatedCompletionDate : undefined,
        submissionState: typeof d.submissionState === 'string' ? d.submissionState as ProgrammingSubmissionState : undefined,
        submission: d.submission && typeof d.submission === 'object' ? parseProgrammingSubmission(d.submission) : undefined,
        buildTimingInfo: d.buildTimingInfo && typeof d.buildTimingInfo === 'object' ? parseBuildTimingInfo(d.buildTimingInfo) : undefined,
    };
}

export interface ResultDTO {
    readonly id: number;
    readonly completionDate?: string;
    readonly successful?: boolean;
    readonly score?: number;
    readonly rated?: boolean;
    readonly participation?: { id: number; type?: string };
    readonly assessmentType?: string;
    readonly feedbacks?: ArtemisFeedback[];
    readonly testCaseCount?: number;
    readonly passedTestCaseCount?: number;
    readonly codeIssueCount?: number;
    readonly submission?: { id?: number; buildFailed?: boolean };
}

export function parseResultDTO(data: unknown): ResultDTO {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid ResultDTO data');
    }
    const d = data as Record<string, unknown>;
    const rawParticipation = d.participation as Record<string, unknown> | undefined;
    const rawSubmission = d.submission as Record<string, unknown> | undefined;
    return {
        id: Number(d.id),
        completionDate: typeof d.completionDate === 'string' ? d.completionDate : undefined,
        successful: typeof d.successful === 'boolean' ? d.successful : undefined,
        score: typeof d.score === 'number' ? d.score : undefined,
        rated: typeof d.rated === 'boolean' ? d.rated : undefined,
        participation: rawParticipation && typeof rawParticipation === 'object'
            ? { id: Number(rawParticipation.id), type: typeof rawParticipation.type === 'string' ? rawParticipation.type : undefined }
            : undefined,
        assessmentType: typeof d.assessmentType === 'string' ? d.assessmentType : undefined,
        feedbacks: Array.isArray(d.feedbacks) ? d.feedbacks.map(f => parseArtemisFeedback(f)) : undefined,
        testCaseCount: typeof d.testCaseCount === 'number' ? d.testCaseCount : undefined,
        passedTestCaseCount: typeof d.passedTestCaseCount === 'number' ? d.passedTestCaseCount : undefined,
        codeIssueCount: typeof d.codeIssueCount === 'number' ? d.codeIssueCount : undefined,
        submission: rawSubmission && typeof rawSubmission === 'object'
            ? { id: typeof rawSubmission.id === 'number' ? rawSubmission.id : undefined, buildFailed: typeof rawSubmission.buildFailed === 'boolean' ? rawSubmission.buildFailed : undefined }
            : undefined,
    };
}
