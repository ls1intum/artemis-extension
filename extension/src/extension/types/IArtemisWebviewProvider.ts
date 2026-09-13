import type * as vscode from 'vscode';

import type {
    ProblemStatementScrollPayload,
    ProblemStatementSelectionPayload,
    TaskFeedbackClosedPayload,
    TaskFeedbackOpenedPayload,
    TestResultsOverviewClosedPayload,
    TestResultsOverviewOpenedPayload,
} from '@shared/messageContracts/webviewCommands';

import type { SubmissionPayload } from '@extension/services/telemetry/recording/types';

/**
 * Minimal contract for the Artemis webview provider, exposing only what the
 * command-handler layer and sessionRecorderWiring need. Keeps the provider
 * decoupled from the heavyweight `ArtemisWebviewProvider` class type.
 */
export interface IArtemisWebviewProvider {
    fireTestResultsOverviewOpened(payload: TestResultsOverviewOpenedPayload): void;
    fireTestResultsOverviewClosed(payload: TestResultsOverviewClosedPayload): void;
    fireTaskFeedbackOpened(payload: TaskFeedbackOpenedPayload): void;
    fireTaskFeedbackClosed(payload: TaskFeedbackClosedPayload): void;
    fireSubmission(payload: SubmissionPayload): void;
    fireProblemStatementScroll(payload: ProblemStatementScrollPayload): void;
    fireProblemStatementSelection(payload: ProblemStatementSelectionPayload): void;

    readonly onDidOpenTestResultsOverview: vscode.Event<TestResultsOverviewOpenedPayload>;
    readonly onDidCloseTestResultsOverview: vscode.Event<TestResultsOverviewClosedPayload>;
    readonly onDidOpenTaskFeedback: vscode.Event<TaskFeedbackOpenedPayload>;
    readonly onDidCloseTaskFeedback: vscode.Event<TaskFeedbackClosedPayload>;
    readonly onDidSubmission: vscode.Event<SubmissionPayload>;
    readonly onDidProblemStatementScroll: vscode.Event<ProblemStatementScrollPayload>;
    readonly onDidProblemStatementSelection: vscode.Event<ProblemStatementSelectionPayload>;
}
