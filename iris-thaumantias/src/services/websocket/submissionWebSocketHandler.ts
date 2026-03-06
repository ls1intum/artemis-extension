import { ExtensionMsg } from '../../shared/messageContracts';
import type { ExtensionToWebviewMessage } from '../../shared/messageContracts';
import {
    type WebSocketMessageHandler as WSHandler,
    type ResultDTO,
    type ProgrammingSubmission,
    ProgrammingSubmissionState,
    type SubmissionProcessingMessage,
} from '../../types';
import type { ResultSummary, SubmissionSummary } from '../../types/apiResponses';

export class SubmissionWebSocketHandler {
    constructor(
        private readonly _postMessage: (msg: ExtensionToWebviewMessage) => void,
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
            feedbacks: result.feedbacks?.map(f => ({
                id: f.id,
                text: f.text,
                detailText: f.detailText,
                credits: f.credits,
                positive: f.positive,
            })),
            participationId: result.participation?.id,
        };
        this._postMessage({
            type: ExtensionMsg.WebsocketUpdate,
            updateType: 'newResult',
            data: summary,
        });
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
                feedbacks: r.feedbacks?.map(f => ({
                    id: f.id,
                    text: f.text,
                    detailText: f.detailText,
                    credits: f.credits,
                    positive: f.positive,
                })),
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
