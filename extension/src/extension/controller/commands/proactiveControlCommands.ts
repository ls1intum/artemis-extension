import type { ExtensionToWebviewMessage, WebCmd, WebviewToExtensionMessage } from '@shared/messageContracts';
import { ExtensionMsg, getPayload, WebviewCmd } from '@shared/messageContracts';

import type { CommandContext, CommandMap } from './types';

/** AskIris On/Off switch + 3-state badge + Resume (spec §12.2). Preference is client-side; pause comes from the engine seam. */
export class ProactiveControlCommandModule {
    constructor(private readonly context: CommandContext) {}

    public getHandlers(): CommandMap {
        return {
            [WebviewCmd.RequestProactiveControl]: this.handleRequest,
            [WebviewCmd.SetProactiveEnabled]: this.handleSetEnabled,
            [WebviewCmd.ResumeProactive]: this.handleResume,
        };
    }

    private handleRequest = async (message: WebviewToExtensionMessage): Promise<void> => {
        const { exerciseId } = getPayload<WebCmd<'requestProactiveControl'>>(message);
        this._push(exerciseId);
    };

    private handleSetEnabled = async (message: WebviewToExtensionMessage): Promise<void> => {
        const { exerciseId, enabled } = getPayload<WebCmd<'setProactiveEnabled'>>(message);
        this.context.proactivePreference?.setProactiveOn(exerciseId, enabled);
        this.context.proactiveControl?.setStudentProactive(exerciseId, enabled);
        this._push(exerciseId);
    };

    private handleResume = async (message: WebviewToExtensionMessage): Promise<void> => {
        const { exerciseId } = getPayload<WebCmd<'resumeProactive'>>(message);
        this.context.proactiveControl?.resumeProactive(exerciseId);
        this._push(exerciseId);
    };

    private _push(exerciseId: number): void {
        // No proactive engine (clean/Open VSX build) → never surface a switch for a feature that isn't shipped.
        if (!this.context.proactiveControl) {
            return;
        }
        const on = this.context.proactivePreference?.isProactiveOn(exerciseId) ?? true;
        // Off wins over Auto-paused in the badge: a backoff pause only shows while the student still has it On.
        const autoPaused = on && (this.context.proactiveControl?.isProactivePaused(exerciseId) ?? false);
        const msg: ExtensionToWebviewMessage = {
            type: ExtensionMsg.UpdateProactiveControl,
            exerciseId,
            preference: on ? 'on' : 'off',
            autoPaused,
        };
        this.context.sendMessage(msg);
    }
}
