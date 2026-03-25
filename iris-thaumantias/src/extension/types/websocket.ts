import type { ResultDTO, ProgrammingSubmission, SubmissionProcessingMessage } from '../domain';

export interface WebSocketMessageHandler {
    onNewResult?: (result: ResultDTO) => void;
    onNewSubmission?: (submission: ProgrammingSubmission) => void;
    onSubmissionProcessing?: (message: SubmissionProcessingMessage) => void;
}
