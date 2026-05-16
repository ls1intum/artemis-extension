import * as vscode from 'vscode';

import { getTheiaEnvironment } from '../theia';
import { CONFIG, VSCODE_CONFIG } from './constants';

/**
 * Resolves the Artemis server URL from the appropriate source.
 *
 * In Theia/EduIDE: reads from the TheiaEnvironment singleton (populated from ARTEMIS_URL env var).
 * In VS Code: reads from workspace configuration (`artemis.serverUrl`).
 * Falls back to the default URL if neither source provides a value.
 *
 * This is the single source of truth for server URL resolution.
 * Both ArtemisApiService and ArtemisWebsocketService must use this function
 * to prevent URL mismatch between API calls and WebSocket connections.
 */
export function resolveServerUrl(): string {
    const theiaEnv = getTheiaEnvironment();
    if (theiaEnv.artemisUrl) {
        return theiaEnv.artemisUrl;
    }
    const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
    return config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY) || CONFIG.ARTEMIS_SERVER_URL_DEFAULT;
}
