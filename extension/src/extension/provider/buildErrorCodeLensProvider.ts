import * as vscode from 'vscode';

import type { ParsedBuildError } from '@extension/types';
import { normalizeRelativePath } from '@extension/utils';

interface TrackedBuildError {
    /**
     * Immutable build-result snapshot. Its `.line` is the original build-time
     * line and goes stale after edits. Use the outer `line` field for the
     * current position.
     */
    readonly error: ParsedBuildError;
    /** Live 1-based line, kept in sync with document edits. */
    line: number;
}

/** Displays Artemis build errors as a CodeLens above the affected line. */
export class BuildErrorCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    private buildErrors: Map<string, TrackedBuildError[]> = new Map();
    private readonly _changeSubscription: vscode.Disposable;

    constructor() {
        this._changeSubscription = vscode.workspace.onDidChangeTextDocument((e) =>
            this.handleDocumentChange(e.document, e.contentChanges)
        );
    }

    /** `filePath` is relative to the workspace root, e.g. "src/Main.java". */
    public setErrors(filePath: string, errors: ParsedBuildError[]): void {
        const normalizedPath = normalizeRelativePath(filePath);
        if (!normalizedPath) {
            return;
        }
        this.buildErrors.set(
            normalizedPath,
            errors.map((error) => ({ error, line: error.line }))
        );
        this._onDidChangeCodeLenses.fire();
    }

    public clearErrors(): void {
        this.buildErrors.clear();
        this._onDidChangeCodeLenses.fire();
    }

    public clearFileErrors(filePath: string): void {
        const normalizedPath = normalizeRelativePath(filePath);
        if (!normalizedPath) {
            return;
        }
        this.buildErrors.delete(normalizedPath);
        this._onDidChangeCodeLenses.fire();
    }

    protected getRelativePath(document: vscode.TextDocument): string | null {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return null;
        }

        const relativePath = vscode.workspace.asRelativePath(document.uri, false);
        return normalizeRelativePath(relativePath);
    }

    public provideCodeLenses(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
        const codeLenses: vscode.CodeLens[] = [];
        const relativePath = this.getRelativePath(document);

        if (!relativePath) {
            return codeLenses;
        }

        const errors = this.buildErrors.get(relativePath);
        if (!errors || errors.length === 0) {
            return codeLenses;
        }

        for (const tracked of errors) {
            const line = Math.max(0, tracked.line - 1); // Convert to 0-based
            const range = new vscode.Range(line, 0, line, 0);

            const codeLens = new vscode.CodeLens(range, {
                title: `❌ Artemis Build Error: ${tracked.error.message}`,
                command: 'artemis.goToSourceError',
                arguments: [tracked.error.filePath, tracked.line, tracked.error.column, tracked.error.message]
            });

            codeLenses.push(codeLens);
        }

        return codeLenses;
    }

    /**
     * Shift tracked error lines so CodeLenses follow the code they point at
     * when the user inserts or removes lines.
     */
    public handleDocumentChange(
        document: vscode.TextDocument,
        changes: readonly vscode.TextDocumentContentChangeEvent[]
    ): void {
        if (changes.length === 0) {
            return;
        }
        const relativePath = this.getRelativePath(document);
        if (!relativePath) {
            return;
        }
        const errors = this.buildErrors.get(relativePath);
        if (!errors || errors.length === 0) {
            return;
        }

        const maxLine = Math.max(0, document.lineCount - 1);
        let changed = false;
        for (const tracked of errors) {
            const shifted = shiftAnchorLine(tracked.line - 1, changes); // 0-based math
            const clamped = Math.min(Math.max(0, shifted), maxLine);
            const newLine = clamped + 1; // back to 1-based
            if (newLine !== tracked.line) {
                tracked.line = newLine;
                changed = true;
            }
        }

        if (changed) {
            this._onDidChangeCodeLenses.fire();
        }
    }

    /** Pass-through: `provideCodeLenses` already fills in everything. */
    public resolveCodeLens?(
        codeLens: vscode.CodeLens,
        _token: vscode.CancellationToken
    ): vscode.CodeLens | Thenable<vscode.CodeLens> {
        return codeLens;
    }

    public dispose(): void {
        this._changeSubscription.dispose();
        this._onDidChangeCodeLenses.dispose();
    }
}

/**
 * Compute the new 0-based line of an error anchored at column 0, given all the
 * content changes of a single document-change event.
 *
 * The changes of one VS Code change event are non-overlapping and expressed in
 * the coordinates of the document *before* the event (Monaco's model). That
 * makes the result order-independent, so we accumulate over the array without
 * sorting or sequential re-coordinating:
 *   - a change strictly containing the anchor line (start < anchor < end, end
 *     exclusive) deletes/replaces that line  -> clamp the anchor to start.line;
 *   - any change entirely above the anchor (end <= anchor) shifts it by the
 *     change's net line delta;
 *   - changes at or below the anchor are ignored.
 * The clamp target is itself shifted by the above-changes, which is correct
 * because those changes lie above the clamp start too (non-overlapping).
 *
 * Scope: line-level only. An edit on the error's own line after column 0 (e.g.
 * splitting the line) does not move the column-0 anchor. That is acceptable for
 * a line-anchored CodeLens; only line insertion/removal has to be tracked.
 */
function shiftAnchorLine(
    line: number,
    changes: readonly vscode.TextDocumentContentChangeEvent[]
): number {
    const anchor = new vscode.Position(line, 0);
    let clampLine: number | null = null;
    let shift = 0;

    for (const change of changes) {
        const start = change.range.start;
        const end = change.range.end;
        const delta = countNewlines(change.text) - (end.line - start.line);

        if (start.isBefore(anchor) && anchor.isBefore(end)) {
            clampLine = start.line; // anchor line is inside the replaced region
        } else if (end.isBeforeOrEqual(anchor)) {
            shift += delta; // change is entirely above the anchor (end exclusive)
        }
    }

    return (clampLine ?? line) + shift;
}

function countNewlines(text: string): number {
    let count = 0;
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 10 /* \n */) {
            count++;
        }
    }
    return count;
}
