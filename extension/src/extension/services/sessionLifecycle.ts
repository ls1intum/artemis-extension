/**
 * Session-lifecycle contracts shared across services (EQ logger, struggle
 * coordinator). Neutral home so no service depends on another just for these
 * types. Moved out of the former v1 telemetry layer in PR 2c as it was deleted.
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
