import * as vscode from 'vscode';

import type { ExtensionToWebviewMessage } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

import type { ArtemisApiService } from '@extension/api';
import { collectUncommittedFiles } from '@extension/services/iris/conversation/collectUncommittedFiles';
import type { IrisConversationService } from '@extension/services/iris/conversation/conversationService';
import { toWireMessages } from '@extension/services/iris/conversation/messageFormatting';
import { SEND_REJECTION_MESSAGES, SendCoordinator } from '@extension/services/iris/conversation/sendCoordinator';
import type { IrisRunStateMachine } from '@extension/services/iris/irisRunStateMachine';
import { createRunLifecycle } from '@extension/services/iris/irisRunStateMachine';
import { LogCategory, logger } from '@extension/services/loggingService';
import type { NoAiDetectionService } from '@extension/services/workspace';
import type { WorkspaceExerciseTracker } from '@extension/services/workspace/workspaceExerciseTracker';

import type { ChatAvailabilityCoordinator } from './chatAvailabilityCoordinator';
import { historyResolvesRun } from './historyResolution';
import type { AvailabilityContext } from './irisAvailabilityService';
import type { IrisWebSocketMessageHandler } from './irisWebSocketMessageHandler';

/**
 * Baseline for missed-terminal-frame recovery. A bare id is not enough:
 * `generation` is the anti-stale key that tells a POST for an older send apart
 * from the still-current one.
 */
interface RecoveryBaseline {
    generation: number;      // `_runs.generation` at dispatch; the anti-stale key
    sessionId: number;       // the conversation the send went to
    baselineMessageId: number;
}

/** One step of a send's lifecycle, as reported to the session recorder. */
export interface IrisChatSendAttempt {
    content: string;
    status: 'pending' | 'sent' | 'failed';
    errorMessage?: string;
}

/** Why a send was refused before it ever reached the coordinator. */
interface SendRejection {
    reason: 'no-ai' | 'no-context' | 'iris-disabled' | 'iris-unavailable';
    contextLabel?: string;
    /** The context the classification belongs to; see `ChatAvailabilityCoordinator.isStillLive`. */
    capturedContext?: AvailabilityContext;
}

interface ChatSendDeps {
    /**
     * A GETTER, not a value. The conversation would work as a value in
     * production: it is assigned once, before this controller, and never
     * replaced. It is read at call time because the chat's white-box tests
     * install a conversation double after construction. See #440.
     */
    getConversation(): IrisConversationService | undefined;
    artemisApi: ArtemisApiService | undefined;
    availability: ChatAvailabilityCoordinator;
    noAi: NoAiDetectionService;
    runs: IrisRunStateMachine;
    websocketMessageHandler: IrisWebSocketMessageHandler;
    workspaceTracker: WorkspaceExerciseTracker;
    postMessage: (message: ExtensionToWebviewMessage) => void;
    /** Republishes the NoAi banner, which the provider owns. */
    postNoAiStatus: (isNoAiDetected: boolean) => void;
}

/**
 * Everything between the student pressing Enter and the run being settled:
 * the pre-send availability gate, the dispatch, the bubble's fate, and the
 * repair of a run whose terminal frame was lost to a websocket drop.
 *
 * The recovery half lives here rather than next to the websocket handler
 * because it is meaningless without the send: what it recovers is the run THIS
 * controller opened, against the baseline THIS controller recorded. Splitting
 * them puts the two halves of one invariant in two files.
 */
export class ChatSendController implements vscode.Disposable {
    private readonly _sendCoordinator: SendCoordinator | undefined;

    /** Generation opened by the most recent send, for the reconnect marker. */
    private _lastSendGeneration: number | undefined;

    /** `undefined` when no send is outstanding. Opened on each successful POST,
     *  cleared on navigation. */
    private _recovery: RecoveryBaseline | undefined;

    private readonly _onDidSendIrisChatMessage = new vscode.EventEmitter<string>();
    public readonly onDidSendIrisChatMessage = this._onDidSendIrisChatMessage.event;

    /**
     * Fired immediately before the API call ('pending'), after it succeeds
     * ('sent') and after it throws ('failed'). Consumers (e.g.
     * sessionRecorderWiring) record the full send lifecycle, including failed
     * sends that never become irisChatMessage events.
     */
    private readonly _onDidAttemptIrisChatSend = new vscode.EventEmitter<IrisChatSendAttempt>();
    public readonly onDidAttemptIrisChatSend = this._onDidAttemptIrisChatSend.event;

    constructor(private readonly _deps: ChatSendDeps) {
        this._sendCoordinator = this._createSendCoordinator();
    }

    public dispose(): void {
        this._onDidSendIrisChatMessage.dispose();
        this._onDidAttemptIrisChatSend.dispose();
    }

    /**
     * Reset the run machine AND the recovery baseline together so they can
     * never drift. A run left `waiting` from the conversation the student just
     * left, and a baseline pointing into it, are both visible bugs rather than
     * bookkeeping.
     */
    public resetRunsAndRecovery(): void {
        this._recovery = undefined;
        this._deps.websocketMessageHandler.resetRuns();
    }

    /**
     * The conversation-first send path. The availability check (\.noai, no
     * context, Iris disabled/unavailable) stays IN FRONT of the coordinator:
     * it is the only thing that knows about instructor settings, and its
     * rejections still carry the banner side effects.
     */
    public async send(message: { text?: string; localId?: string; sessionId?: number }): Promise<void> {
        if (typeof message.text !== 'string') { return; }

        const content = message.text;
        const localId = typeof message.localId === 'string' ? message.localId : undefined;
        // The conversation the bubble was drawn in travels WITH the send, so a
        // navigation between composing and handling is caught here rather than
        // posting the student's text into whatever is open by then.
        const sessionId = typeof message.sessionId === 'number' ? message.sessionId : undefined;

        // Emit pending before the API call so the recording captures send attempts
        // even when the call never returns (e.g. network hang).
        this._onDidAttemptIrisChatSend.fire({ content, status: 'pending' });

        const unavailable = await this._checkSendAvailability();
        if (unavailable) {
            this._onDidAttemptIrisChatSend.fire({
                content,
                status: 'failed',
                errorMessage: `send-rejected: ${unavailable.reason}`,
            });
            this._handleRejectedSend(unavailable, localId, sessionId);
            return;
        }

        if (!this._sendCoordinator || !localId || sessionId === undefined) {
            // Nothing can carry this send. The bubble must still be failed, or
            // the student is left with a message stuck in `sending` and a
            // thinking indicator that never clears.
            this._onDidAttemptIrisChatSend.fire({
                content,
                status: 'failed',
                errorMessage: 'send-rejected: no-conversation',
            });
            if (localId && sessionId !== undefined) {
                this._deps.postMessage({
                    type: ExtensionMsg.SendRejected,
                    localId,
                    sessionId,
                    reason: 'no-conversation',
                    errorMessage: SEND_REJECTION_MESSAGES['no-conversation'],
                });
            }
            return;
        }

        try {
            const outcome = await this._sendCoordinator.send({ text: content, localId, sessionId });
            // Neither non-sent outcome needs anything here. `rejected` already
            // failed the bubble with its reason; `unknown` already surfaced its
            // message through `reportError` inside the coordinator, and posting
            // a second OpenSessionError would show the same failure twice.
            if (outcome.kind === 'sent') {
                // Open the recovery baseline ONLY for the still-current,
                // still-waiting generation: an inbound run may have opened a
                // newer one while the POST was in flight, and recovering
                // against it would resolve the wrong run. This is also what
                // stops an older POST completing late from replacing a newer
                // baseline.
                if (outcome.messageId !== undefined
                    && this._lastSendGeneration === this._deps.runs.generation
                    && this._deps.runs.waiting) {
                    this._recovery = {
                        generation: this._lastSendGeneration,
                        sessionId,
                        baselineMessageId: outcome.messageId,
                    };
                }
                this._onDidAttemptIrisChatSend.fire({ content, status: 'sent' });
                this._onDidSendIrisChatMessage.fire(content);
            } else {
                this._onDidAttemptIrisChatSend.fire({
                    content,
                    status: 'failed',
                    errorMessage: `send-${outcome.kind === 'rejected' ? `rejected: ${outcome.reason}` : 'unknown'}`,
                });
            }
        } catch (error: unknown) {
            // The coordinator resolves every failure it knows about, so a throw
            // here is a programmer error rather than a send failure. Surface it
            // and release the composer.
            const errorMessage = error instanceof Error ? error.message : String(error);
            this._onDidAttemptIrisChatSend.fire({ content, status: 'failed', errorMessage });
            vscode.window.showErrorMessage(`Failed to send message: ${errorMessage}`);
            this._deps.websocketMessageHandler.publishCurrentRunUi();
        }
    }

    /**
     * The single path for a resubscribe, covering both halves of the repair.
     *
     * `IrisConversationService.onSubscriptionActive` re-reads the conversation
     * and merges it (host state and, through `deliverTranscript`, the visible
     * transcript), which recovers the ANSWER. It cannot recover the RUN,
     * because the run machine is this controller's. So this method awaits the
     * reconciliation and then, on conclusive proof only (a persisted assistant
     * message past the send baseline), resolves the run and republishes clean
     * run UI. Without the second half the thinking indicator spins forever
     * after a mid-answer disconnect even though the answer is on screen.
     *
     * Everything is gated so an idle, pre-dispatch or never-bound run resolves
     * nothing, and so a newer send, a same-generation run rebind or a
     * navigation during the reconciliation aborts the resolve.
     */
    public async recoverOnResubscribe(sessionId: number): Promise<void> {
        const conversation = this._deps.getConversation();
        if (!conversation) { return; }
        const runs = this._deps.runs;

        // Captured BEFORE the await, so the decision is made against the state
        // the resubscribe found, not against whatever it settles into.
        const baseline = this._recovery;
        // pendingGeneration true => the first frame never arrived => the run
        // was never bound, and resolving it would finalize the wrong one.
        const eligible = baseline !== undefined
            && runs.waiting
            && !runs.pendingGeneration
            && baseline.generation === runs.generation
            && baseline.sessionId === sessionId
            && sessionId === conversation.state.snapshot().currentSessionId;
        // Pin the bound run: within ONE generation, admit() can rebind
        // _currentRunId to a later unknown run (A -> C) without bumping the
        // generation. History proving A finished must not then finalize C.
        const boundRunId = runs.currentRunId;

        try {
            await conversation.onSubscriptionActive(sessionId);
        } catch (error: unknown) {
            logger.error('Reconnect reconciliation failed', LogCategory.IRIS_CHAT, error);
            return;
        }

        if (!eligible || !baseline || !boundRunId) { return; }
        // Re-validate EVERYTHING after the await.
        if (this._recovery !== baseline
            || runs.generation !== baseline.generation
            || runs.currentRunId !== boundRunId
            || !runs.waiting
            || runs.pendingGeneration
            || conversation.state.snapshot().currentSessionId !== baseline.sessionId) {
            return;
        }
        // Persisted history alone cannot prove a run ENDED (a missed FAILED
        // frame leaves no message), so only a newer final assistant message
        // counts. Anything else leaves the run waiting for the manual reload.
        const messages = toWireMessages(conversation.state.snapshot().detail?.messages);
        if (!historyResolvesRun(messages, baseline.baselineMessageId)) { return; }
        runs.resolveCurrentRun();
        // A pure WS drop mid-answer never clears the handler's own
        // draft/activities/error (only the webview store is reset on
        // disconnect), so a plain republish would resurrect the stale partial
        // as a phantom duplicate bubble. Clear it here.
        this._deps.websocketMessageHandler.resetRunUiAndPublish();
        this._recovery = undefined;
    }

    /**
     * Built once, next to the conversation it sends into. `sessionId` is read
     * at CALL time, never captured: the open conversation changes underneath
     * this coordinator. Both bubble callbacks take the ORIGIN session as their
     * first argument, so a bubble is always addressed in the conversation it
     * was drawn in.
     */
    private _createSendCoordinator(): SendCoordinator | undefined {
        const { artemisApi, websocketMessageHandler, workspaceTracker } = this._deps;
        const conversation = this._deps.getConversation();
        if (!artemisApi || !conversation) { return undefined; }
        const runLifecycle = createRunLifecycle(
            this._deps.runs,
            () => websocketMessageHandler.resetRunUiAndPublish(),
            () => websocketMessageHandler.publishCurrentRunUi(),
        );
        return new SendCoordinator(artemisApi, conversation, {
            runLifecycle: {
                // Remembers the generation the coordinator opened: the reconnect
                // marker needs it and `SendOutcome` deliberately does not carry
                // it, so recovery of a missed terminal frame records it here.
                beginGeneration: () => {
                    const generation = runLifecycle.beginGeneration();
                    this._lastSendGeneration = generation;
                    return generation;
                },
                abortGeneration: (generation) => runLifecycle.abortGeneration(generation),
            },
            resetRunUiAndPublish: () => websocketMessageHandler.resetRunUiAndPublish(),
            collectUncommittedFiles: () => collectUncommittedFiles((msg) => this._deps.postMessage(msg)),
            // Both keys are derived from the ORIGIN session ARGUMENT, never
            // read from controller state: a navigation that completes while the
            // POST is open must not re-address a bubble that was drawn in the
            // conversation the student has just left.
            confirmBubble: (sessionId, localId, id) => {
                if (id === undefined) { return; }
                this._deps.postMessage({
                    type: ExtensionMsg.ConfirmSentMessage,
                    sessionId, localId, id,
                });
            },
            failBubble: (sessionId, localId, reason) => this._deps.postMessage({
                type: ExtensionMsg.SendRejected,
                localId,
                sessionId,
                reason,
                errorMessage: SEND_REJECTION_MESSAGES[reason],
            }),
            reportError: (message) => this._deps.postMessage({ type: ExtensionMsg.OpenSessionError, message }),
            getWorkspaceExerciseId: () => workspaceTracker.exerciseId,
        });
    }

    /**
     * The pre-send availability gate, kept out of the coordinator so it does
     * not have to know about instructor settings. Returns the rejection to
     * report, or `undefined` when the send may proceed.
     */
    private async _checkSendAvailability(): Promise<SendRejection | undefined> {
        if (this._deps.noAi.isNoAiEnabled) {
            logger.warn('Chat blocked: .noai file detected', LogCategory.IRIS_CHAT);
            return { reason: 'no-ai' };
        }
        const activeContext = this._deps.availability.context();
        if (!activeContext) {
            logger.warn('No conversation to check availability for', LogCategory.IRIS_CHAT);
            return { reason: 'no-context' };
        }
        const availability = await this._deps.availability.check(activeContext);
        if (availability.kind === 'enabled') { return undefined; }
        // Disabled and unavailable are kept apart so the webview's Retry stays
        // active for the transient case and inert for the intentional one.
        return {
            reason: availability.kind === 'disabled' ? 'iris-disabled' : 'iris-unavailable',
            contextLabel: activeContext.type === 'course' ? 'course' : 'exercise',
            capturedContext: activeContext,
        };
    }

    /**
     * Dispatch a synchronous send rejection back to the webview.
     *
     * Runs the collateral side-effects (NoAi banner, disabled banner) so
     * visible chat state stays consistent, AND posts a targeted SendRejected so
     * the webview can mark the optimistic user message as failed and clear its
     * thinking indicator. Without that second post the thinking dots loop
     * forever.
     *
     * Without a `localId`/`sessionId` pair there is no bubble to fail, so the
     * reason is surfaced as a notification and the composer released through
     * the run-UI projection, which owns clearing the indicator.
     */
    private _handleRejectedSend(
        result: SendRejection,
        localId: string | undefined,
        sessionId: number | undefined,
    ): void {
        const errorMessage = friendlyRejectionMessage(result);

        switch (result.reason) {
            case 'no-ai':
                this._deps.postNoAiStatus(true);
                break;
            case 'no-context':
                // No persistent UI state to update; the inline failed
                // message communicates this fully.
                break;
            case 'iris-disabled':
            case 'iris-unavailable': {
                // A slow settings check returning after the student switched
                // would mislabel the NEW context's banner with the OLD
                // context's classification. If they diverge, skip the banner.
                // The SendRejected message-level signal is still delivered so
                // the optimistic user message gets marked failed.
                const captured = result.capturedContext;
                if (!captured || !this._deps.availability.isStillLive(captured)) { break; }
                this._deps.availability.post(
                    result.reason === 'iris-disabled'
                        ? { kind: 'disabled' }
                        : { kind: 'unavailable', reason: 'Send rejected: iris-unavailable' },
                    captured,
                );
                break;
            }
        }

        if (localId && sessionId !== undefined) {
            this._deps.postMessage({
                type: ExtensionMsg.SendRejected,
                localId,
                sessionId,
                reason: result.reason,
                errorMessage,
            });
            return;
        }

        // Nothing to address a bubble to. Deliberately no AddMessage: a bubble
        // with no conversation to belong to would land in whatever the student
        // opens next.
        vscode.window.showWarningMessage(errorMessage);
        this._deps.websocketMessageHandler.publishCurrentRunUi();
    }
}

function friendlyRejectionMessage(result: SendRejection): string {
    switch (result.reason) {
        case 'no-ai':
            return 'Not sent because AI assistance is disabled for this workspace.';
        case 'no-context':
            return 'Please select a course or exercise context first.';
        case 'iris-disabled':
            return `Iris chat is disabled for this ${result.contextLabel ?? 'context'}.`;
        case 'iris-unavailable':
            return 'Iris is temporarily unavailable. Try again in a moment.';
    }
}
