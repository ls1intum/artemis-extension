import type { ExtensionToWebviewMessage } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

import { toFeedbackSummary } from '@extension/services/ui/resultSummaryMappers';
import type { ResultSummary, SubmissionSummary } from '@extension/types';
import {
    type ProgrammingSubmission,
    ProgrammingSubmissionState,
    type ResultDTO,
    type SubmissionProcessingMessage,
    type WebSocketMessageHandler as WSHandler,
} from '@extension/types';

export class SubmissionWebSocketHandler {
    constructor(
        private readonly _postMessage: (msg: ExtensionToWebviewMessage) => void,
        private readonly _onBuildResult?: (result: ResultDTO) => void,
        private readonly _onResultReceived?: (result: ResultDTO) => void,
    ) {}

    public createHandler(): WSHandler {
        return {
            onNewResult: (result: ResultDTO) => this.handleNewResult(result),
            onNewSubmission: (submission: ProgrammingSubmission) => this.handleNewSubmission(submission),
            onSubmissionProcessing: (message: SubmissionProcessingMessage) => this.handleSubmissionProcessing(message),
        };
    }

    public handleNewResult(result: ResultDTO): void {
        const summary: ResultSummary = {
            id: result.id,
            completionDate: result.completionDate,
            successful: result.successful,
            score: result.score,
            testCaseCount: result.testCaseCount,
            passedTestCaseCount: result.passedTestCaseCount,
            codeIssueCount: result.codeIssueCount,
            feedbacks: result.feedbacks?.map(toFeedbackSummary),
            participationId: result.participation?.id,
            buildFailed: result.submission?.buildFailed,
        };
        this._postMessage({
            type: ExtensionMsg.WebsocketUpdate,
            updateType: 'newResult',
            data: summary,
        });
        this._onBuildResult?.(result);
        this._onResultReceived?.(result);
    }

    public handleNewSubmission(submission: ProgrammingSubmission): void {
        const summary: SubmissionSummary = {
            id: submission.id,
            submissionDate: submission.submissionDate,
            buildFailed: submission.buildFailed,
            commitHash: submission.commitHash,
            results: submission.results?.map(r => ({
                id: r.id,
                completionDate: r.completionDate,
                successful: r.successful,
                score: r.score,
                feedbacks: r.feedbacks?.map(toFeedbackSummary),
            })),
            participationId: submission.participation?.id,
        };
        this._postMessage({
            type: ExtensionMsg.WebsocketUpdate,
            updateType: 'newSubmission',
            data: summary,
        });
    }

    public handleSubmissionProcessing(message: SubmissionProcessingMessage): void {
        let state = message.submissionState;
        if (!state && (message.buildStartDate || message.estimatedCompletionDate)) {
            state = ProgrammingSubmissionState.BUILDING;
        }

        const buildTimingInfo = message.buildTimingInfo || {
            buildStartDate: message.buildStartDate,
            estimatedCompletionDate: message.estimatedCompletionDate,
            submissionDate: message.submissionDate
        };

        this._postMessage({
            type: ExtensionMsg.WebsocketUpdate,
            updateType: 'submissionProcessing',
            data: {
                state: state || 'BUILDING',
                participationId: message.participationId,
                buildTimingInfo: buildTimingInfo
            }
        });
    }
}
