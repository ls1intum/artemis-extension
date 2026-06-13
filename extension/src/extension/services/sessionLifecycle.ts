/**
 * Session-lifecycle contracts shared across services (EQ logger, struggle
 * coordinator). Neutral home so no service depends on another just for these
 * types. Moved out of services/telemetry/ in PR 2c as that layer is deleted.
 */
import type * as vscode from 'vscode';

export interface SessionStartContext {
    exerciseId: number;
    exerciseRoot?: vscode.Uri;
}

export interface SessionResettable {
    onSessionStart(context: SessionStartContext): void;
    onSessionEnd?(): void;
}
