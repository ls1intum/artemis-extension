import * as fs from 'fs';
import * as vscode from 'vscode';
import { ThemeType } from '../../theme';

export class StyleManager {
    constructor(private readonly _extensionUri: vscode.Uri) {}

    public getStyles(theme: ThemeType, additionalPaths: string[] = []): string {
        const defaultPaths = [
            'base.css',
            'components/primitives.css',
            `themes/theme-${theme}.css`,
        ];

        const uniquePaths = Array.from(new Set([...defaultPaths, ...additionalPaths]));

        return uniquePaths
            .map(path => this._readStyles(path))
            .filter(Boolean)
            .join('\n');
    }

    private _readStyles(relativePath: string): string {
        const fileUri = vscode.Uri.joinPath(this._extensionUri, 'media', 'styles', ...relativePath.split('/'));

        try {
            return fs.readFileSync(fileUri.fsPath, 'utf-8');
        } catch (error) {
            console.error(`[StyleManager] Failed to load stylesheet: ${relativePath}`, error);
            return '';
        }
    }
}
