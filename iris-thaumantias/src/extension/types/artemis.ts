import type { ResultDTO, ProgrammingSubmission, SubmissionProcessingMessage } from '../models/submissions';

export { ProfileInfo, LoginCredentials, AuthenticationResult, PROFILE_IRIS } from '../models/auth';
export { ApiError, ArtemisUser, ArtemisCourse, ArtemisExercise, ArtemisResult, ArtemisParticipation, ArtemisFeedback } from '../models/core';
export { IrisRateLimitInfo, IrisHealthStatus } from '../models/iris';
export { BuildTimingInfo, ArtemisSubmission, ProgrammingSubmission, SubmissionProcessingMessage, ResultDTO, ProgrammingSubmissionState } from '../models/submissions';
export { BuildLogEntry, ParsedBuildError } from '../models/build';

// Callback interface — stays here (not identical to class WebSocketMessageHandler in services/)
export interface WebSocketMessageHandler {
    onNewResult?: (result: ResultDTO) => void;
    onNewSubmission?: (submission: ProgrammingSubmission) => void;
    onSubmissionProcessing?: (message: SubmissionProcessingMessage) => void;
}
