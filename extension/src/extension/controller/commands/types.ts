import type * as vscode from 'vscode';

import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '@shared/messageContracts';

import type { ArtemisApiService } from '@extension/api';
import type { AppStateManager } from '@extension/controller/appStateManager';
import type { WebViewActionHandler } from '@extension/controller/types';
import type { AuthManager } from '@extension/services/auth';
import type { CourseAccessStorageService } from '@extension/services/courseAccessStorageService';
import type { CourseDataCache } from '@extension/services/courseDataCache';
import type { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import type { ProactivePreferenceService } from '@extension/services/proactivePreferenceService';
import type { IProviderRegistry } from '@extension/services/ui';
import type { ArtemisWebsocketService } from '@extension/services/websocket';

export type CommandHandler = (message: WebviewToExtensionMessage) => Promise<void>;
export type CommandMap = Record<string, CommandHandler>;

export interface CommandContext {
    authManager: AuthManager;
    artemisApi: ArtemisApiService;
    appStateManager: AppStateManager;
    actionHandler: WebViewActionHandler;
    sendMessage(message: ExtensionToWebviewMessage): void;
    updateAuthContext(isAuthenticated: boolean): Promise<void>;
    getWebsocketService?: () => ArtemisWebsocketService | undefined;
    recheckRepoStatus?: () => Promise<void>;
    extensionContext: vscode.ExtensionContext;
    exerciseRegistry: ExerciseRegistry;
    providerRegistry: IProviderRegistry;
    courseDataCache?: CourseDataCache;
    courseAccessStorage?: CourseAccessStorageService;
    /**
     * Live engine-decision feed for the developer-mode struggle view. Each
     * subscriber registers a stable sender function as a sink; the feed fans
     * out to all registered sinks. Optional: absent in the clean (no-engine)
     * build and in tests that don't exercise the live view.
     */
    struggleLiveFeed?: {
        subscribe(sink: (msg: ExtensionToWebviewMessage) => void): void;
        unsubscribe(sink: (msg: ExtensionToWebviewMessage) => void): void;
        dropSink(sink: (msg: ExtensionToWebviewMessage) => void): void;
    };
    /**
     * Returns the sender function that is currently active for this host
     * (i.e. the function that will be used to post the next message to the
     * webview). Used by subscribe/unsubscribe handlers to register a stable
     * per-panel identity rather than a transient closure.
     */
    getCurrentSender(): (m: ExtensionToWebviewMessage) => void;
    /** Durable per-exercise proactive-help level (client-side, spec §12.2). Absent in tests that don't need it. */
    proactivePreference?: ProactivePreferenceService;
    /** Behind-the-`@telemetry`-seam proactive control surface; absent in the clean (no-engine) build. */
    proactiveControl?: {
        setStudentProactive(exerciseId: number, on: boolean): void;
        /** The two §14 gate causes, independently (consent vs 404 latch). Session-global → no exercise id. */
        getProactiveGateState(): { consentMissing: boolean; serverUnavailable: boolean };
    };
}
