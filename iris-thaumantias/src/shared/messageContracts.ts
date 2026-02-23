/**
 * Message contracts for typed extension-webview communication.
 *
 * This file defines discriminated union types for bidirectional messaging
 * between the extension host (Node.js) and webview (browser) contexts.
 * It's importable from both contexts (no vscode imports).
 */

/**
 * VS Code API interface available in webview context.
 * Acquired via window.acquireVsCodeApi() in webview code.
 */
export interface VsCodeApi {
    postMessage(message: WebviewToExtensionMessage): void;
    getState<T = unknown>(): T | undefined;
    setState<T = unknown>(state: T): void;
}

// ============================================================================
// Extension → Webview Messages
// ============================================================================

/**
 * Generic initialization message for views.
 * Views can use this or define view-specific init messages.
 */
export interface GenericInitMessage {
    type: 'init';
    view: string;
    payload: Record<string, unknown>;
}

/**
 * GitCredentials view initialization message.
 */
export interface GitCredentialsInitMessage {
    type: 'gitCredentialsInit';
    payload: {
        currentName?: string;
        currentEmail?: string;
    };
}

/**
 * GitCredentials operation result message.
 */
export interface GitCredentialsResultMessage {
    type: 'gitCredentialsResult';
    status: 'success' | 'error' | 'warning';
    message: string;
}

/**
 * ServiceStatus view initialization message.
 */
export interface ServiceStatusInitMessage {
    type: 'serviceStatusInit';
    payload: {
        serverUrl?: string;
    };
}

/**
 * Health check results message.
 */
export interface HealthCheckResultsMessage {
    type: 'healthCheckResults';
    payload: {
        results: Record<string, {
            status: string;
            message: string;
            endpoint: string;
            httpStatus: number | null;
            response: string | null;
        }>;
    };
}

/**
 * RecommendedExtensions view initialization message.
 */
export interface RecommendedExtensionsInitMessage {
    type: 'recommendedExtensionsInit';
    payload: {
        categories: Array<{
            id: string;
            name: string;
            description: string;
            extensions: Array<{
                id: string;
                name: string;
                publisher: string;
                version?: string;
                description: string;
                reason: string;
                optional?: boolean;
                isInstalled: boolean;
            }>;
        }>;
    };
}

/**
 * All messages that can be sent FROM extension host TO webview.
 * Discriminated by 'type' property.
 */
export type ExtensionToWebviewMessage =
    | GenericInitMessage
    | GitCredentialsInitMessage
    | GitCredentialsResultMessage
    | ServiceStatusInitMessage
    | HealthCheckResultsMessage
    | RecommendedExtensionsInitMessage
    | { type: 'error'; payload: { message: string } };

// ============================================================================
// Webview → Extension Messages
// ============================================================================

/**
 * Ready signal sent by webview after React hydration.
 */
export interface ReadyMessage {
    type: 'ready';
}

/**
 * Save Git identity command.
 */
export interface SaveGitIdentityCommand {
    type: 'command';
    command: 'saveGitIdentity';
    payload: {
        name: string;
        email: string;
    };
}

/**
 * Request current Git identity command.
 */
export interface RequestGitIdentityCommand {
    type: 'command';
    command: 'requestGitIdentity';
}

/**
 * Copy text to clipboard command.
 */
export interface CopyToClipboardCommand {
    type: 'command';
    command: 'copyToClipboard';
    payload: {
        text: string;
    };
}

/**
 * Navigate back to dashboard command.
 */
export interface BackToDashboardCommand {
    type: 'command';
    command: 'backToDashboard';
}

/**
 * Perform health checks command.
 */
export interface PerformHealthChecksCommand {
    type: 'command';
    command: 'performHealthChecks';
    payload: {
        serverUrl: string;
    };
}

/**
 * Request recommended extensions data command.
 */
export interface RequestRecommendedExtensionsCommand {
    type: 'command';
    command: 'requestRecommendedExtensions';
}

/**
 * Search VS Code marketplace for extension command.
 */
export interface SearchMarketplaceCommand {
    type: 'command';
    command: 'searchMarketplace';
    payload: {
        extensionId: string;
    };
}

/**
 * Error message from webview to extension.
 */
export interface ErrorMessage {
    type: 'error';
    payload: {
        message: string;
        stack?: string;
        componentStack?: string;
    };
}

/**
 * All messages that can be sent FROM webview TO extension host.
 * Discriminated by 'type' property.
 */
export type WebviewToExtensionMessage =
    | ReadyMessage
    | SaveGitIdentityCommand
    | RequestGitIdentityCommand
    | CopyToClipboardCommand
    | BackToDashboardCommand
    | PerformHealthChecksCommand
    | RequestRecommendedExtensionsCommand
    | SearchMarketplaceCommand
    | ErrorMessage;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for extension-to-webview messages.
 * Validates message structure and narrows type.
 */
export function isExtensionMessage(msg: unknown): msg is ExtensionToWebviewMessage {
    return typeof msg === 'object' && msg !== null && 'type' in msg
        && typeof (msg as { type: unknown }).type === 'string'
        && ['init', 'gitCredentialsInit', 'gitCredentialsResult', 'serviceStatusInit', 'healthCheckResults', 'recommendedExtensionsInit', 'error'].includes((msg as { type: string }).type);
}

/**
 * Type guard for webview-to-extension messages.
 * Validates message structure and narrows type.
 */
export function isWebviewMessage(msg: unknown): msg is WebviewToExtensionMessage {
    return typeof msg === 'object' && msg !== null && 'type' in msg
        && typeof (msg as { type: unknown }).type === 'string'
        && ['ready', 'command', 'error'].includes((msg as { type: string }).type);
}
