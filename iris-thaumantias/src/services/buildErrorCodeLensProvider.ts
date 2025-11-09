import * as vscode from 'vscode';
import type { ParsedBuildError } from '../types';
import { normalizeRelativePath } from '../utils';

/**
 * CodeLens provider for displaying build errors above the affected line
 * Shows errors in the style of "X references" or "Run Test"
 */
export class BuildErrorCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    private buildErrors: Map<string, ParsedBuildError[]> = new Map();

    /**
     * Set build errors for a specific file
     * @param filePath Relative file path (e.g., "src/Main.java")
     * @param errors Array of build errors for this file
     */
    public setErrors(filePath: string, errors: ParsedBuildError[]): void {
        const normalizedPath = normalizeRelativePath(filePath);
        if (!normalizedPath) {
            return;
        }
        this.buildErrors.set(normalizedPath, errors);
        this._onDidChangeCodeLenses.fire();
    }

    /**
     * Clear all build errors
     */
    public clearErrors(): void {
        this.buildErrors.clear();
        this._onDidChangeCodeLenses.fire();
    }

    /**
     * Clear errors for a specific file
     * @param filePath Relative file path
     */
    public clearFileErrors(filePath: string): void {
        const normalizedPath = normalizeRelativePath(filePath);
        if (!normalizedPath) {
            return;
        }
        this.buildErrors.delete(normalizedPath);
        this._onDidChangeCodeLenses.fire();
    }

    /**
     * Get relative path for a document
     */
    private getRelativePath(document: vscode.TextDocument): string | null {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return null;
        }

        const relativePath = vscode.workspace.asRelativePath(document.uri, false);
        return normalizeRelativePath(relativePath);
    }

    /**
     * Provide CodeLens items for a document
     */
    public provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
        const codeLenses: vscode.CodeLens[] = [];
        const relativePath = this.getRelativePath(document);

        if (!relativePath) {
            return codeLenses;
        }

        // Get errors for this file
        const errors = this.buildErrors.get(relativePath);
        if (!errors || errors.length === 0) {
            return codeLenses;
        }

        // Create a CodeLens for each error
        for (const error of errors) {
            const line = Math.max(0, error.line - 1); // Convert to 0-based
            const range = new vscode.Range(line, 0, line, 0);

            // Create CodeLens with error message
            const codeLens = new vscode.CodeLens(range, {
                title: `❌ Artemis Build Error: ${error.message}`,
                command: 'artemis.goToSourceError',
                arguments: [error.filePath, error.line, error.column, error.message]
            });

            codeLenses.push(codeLens);
        }

        return codeLenses;
    }

    /**
     * Resolve a CodeLens (optional, we provide everything in provideCodeLenses)
     */
    public resolveCodeLens?(
        codeLens: vscode.CodeLens,
        token: vscode.CancellationToken
    ): vscode.CodeLens | Thenable<vscode.CodeLens> {
        return codeLens;
    }
}
