import * as vscode from 'vscode';

import type { PlatformCapabilities } from './types';

/**
 * Probes the runtime environment for API capabilities that may differ
 * between VS Code Desktop and Theia.
 *
 * Results are used to conditionally register event listeners and
 * select fallback strategies. Called once during activation.
 */
export function detectPlatformCapabilities(): PlatformCapabilities {
    return Object.freeze({
        hasTerminalShellExecution:
            typeof vscode.window.onDidStartTerminalShellExecution === 'function',
        hasVscodeGitExtension:
            vscode.extensions.getExtension('vscode.git') !== undefined,
    });
}
