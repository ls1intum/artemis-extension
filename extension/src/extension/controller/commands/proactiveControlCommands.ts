import type { ExtensionToWebviewMessage, WebCmd, WebviewToExtensionMessage } from '@shared/messageContracts';
import { ExtensionMsg, getPayload, WebviewCmd } from '@shared/messageContracts';

import { classifyIrisCourseAvailability } from '@extension/services/iris/chat/chatSessionService';
import { deriveProactiveCardState } from '@extension/services/proactiveCardState';

import type { CommandContext, CommandMap } from './types';

/** AskIris On/Off switch + 4-state availability card (spec §12.2 / §14). Preference is client-side; pause + degraded come from the engine seam. */
export class ProactiveControlCommandModule {
    constructor(private readonly context: CommandContext) {}

    /** Generation counter: a slow `await`ing `_push` must never overwrite a newer one's card (rapid init/refocus/toggle). */
    private _pushSeq = 0;

    public getHandlers(): CommandMap {
        return {
            [WebviewCmd.RequestProactiveControl]: this.handleRequest,
            [WebviewCmd.SetProactiveEnabled]: this.handleSetEnabled,
            [WebviewCmd.ResumeProactive]: this.handleResume,
        };
    }

    private handleRequest = async (message: WebviewToExtensionMessage): Promise<void> => {
        const { exerciseId, courseId } = getPayload<WebCmd<'requestProactiveControl'>>(message);
        await this._push(exerciseId, courseId);
    };

    private handleSetEnabled = async (message: WebviewToExtensionMessage): Promise<void> => {
        const { exerciseId, enabled, courseId } = getPayload<WebCmd<'setProactiveEnabled'>>(message);
        this.context.proactivePreference?.setProactiveOn(exerciseId, enabled);
        this.context.proactiveControl?.setStudentProactive(exerciseId, enabled);
        await this._push(exerciseId, courseId);
    };

    private handleResume = async (message: WebviewToExtensionMessage): Promise<void> => {
        const { exerciseId, courseId } = getPayload<WebCmd<'resumeProactive'>>(message);
        this.context.proactiveControl?.resumeProactive(exerciseId);
        await this._push(exerciseId, courseId);
    };

    private async _push(exerciseId: number, courseId?: number): Promise<void> {
        // No proactive engine (clean/Open VSX build) → never surface a card for a feature that isn't shipped.
        // First statement so the clean build does ZERO work (no profile/settings fetch) and sends nothing.
        if (!this.context.proactiveControl) {
            return;
        }
        const seq = ++this._pushSeq;
        const on = this.context.proactivePreference?.isProactiveOn(exerciseId) ?? true;
        // Off wins over Auto-paused in the badge: a backoff pause only shows while the student still has it On.
        const autoPaused = on && (this.context.proactiveControl.isProactivePaused(exerciseId) ?? false);

        // §14 availability — shared classifier (profile + course settings). courseId absent → optimistic enabled
        // (self-heals on the next push that carries it; the webview always has exercise.course?.id at every call site).
        let irisAvailability: 'enabled' | 'disabled' | 'unavailable' = 'enabled';
        let courseProactiveEnabled: boolean | undefined;
        if (courseId !== undefined) {
            try {
                const { availability, settings } = await classifyIrisCourseAvailability(
                    this.context.artemisApi, async () => courseId);
                irisAvailability = availability.kind;
                courseProactiveEnabled = settings?.settings?.proactiveStruggleEnabled;
            } catch {
                irisAvailability = 'unavailable';   // never let a probe failure crash the card; self-heals next push
            }
        }

        // .noai: await the initial workspace scan so the card we SEND reflects the settled marker (prevents a card
        // pushed 'available' then flipping to 'unavailable' once the async scan resolves). This does NOT make the
        // exercise view's first paint fail-closed — that paint can briefly show a plain card before this push lands;
        // the real .noai egress protection is engine-side (decideOutcome reads the live marker), so that is harmless.
        const chat = this.context.providerRegistry.getChatWebviewProvider();
        await chat?.whenNoAiReady();
        const noAi = chat?.isNoAiEnabled() ?? false;
        const degraded = this.context.proactiveControl.isProactiveDegraded() ?? false;

        const { state: cardState, reason: cardReason } = deriveProactiveCardState({
            irisAvailability,
            noAi,
            courseProactiveEnabled,
            degraded,
        });

        // A newer _push superseded this one mid-await → drop the stale paint (cross-exercise staleness is the
        // webview's render-time exerciseId guard; this guards same-exercise rapid re-pushes).
        if (seq !== this._pushSeq) {
            return;
        }

        const msg: ExtensionToWebviewMessage = {
            type: ExtensionMsg.UpdateProactiveControl,
            exerciseId,
            preference: on ? 'on' : 'off',
            autoPaused,
            cardState,
            cardReason,
        };
        this.context.sendMessage(msg);
    }
}
