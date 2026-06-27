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
     * Live engine-decision feed for the developer-mode struggle view. Subscribe
     * streams buffered + live ticks to the webview; unsubscribe stops the stream.
     * Optional: absent in the clean (no-engine) build and in tests that don't
     * exercise the live view.
     */
    struggleLiveFeed?: { subscribe(): void; unsubscribe(): void };
    /** Durable per-exercise proactive on/off preference (client-side, spec §12.2). Absent in tests that don't need it. */
    proactivePreference?: ProactivePreferenceService;
    /** Behind-the-`@telemetry`-seam proactive control surface; absent in the clean (no-engine) build. */
    proactiveControl?: {
        isProactivePaused(exerciseId: number): boolean;
        setStudentProactive(exerciseId: number, on: boolean): void;
        resumeProactive(exerciseId: number): void;
    };
}
