import * as vscode from 'vscode';
import { VSCODE_CONFIG } from '../utils/constants';
import { ThemeManager } from './manager';
import { Theme, ThemeType } from './types';

type ThemeSubscriber = (theme: Theme, themeType: ThemeType) => void;

interface SetThemeOptions {
    persist?: boolean;
}

export class ThemeStore {
    private readonly manager = new ThemeManager();
    private readonly subscribers = new Set<ThemeSubscriber>();
    private currentType: ThemeType;

    constructor(initialTheme?: ThemeType) {
        this.currentType = initialTheme ?? this.manager.getCurrentTheme();
    }

    public get theme(): Theme {
        return this.manager.getTheme(this.currentType);
    }

    public get themeType(): ThemeType {
        return this.currentType;
    }

    public get css(): string {
        return this.manager.getThemeCSS(this.currentType);
    }

    public subscribe(callback: ThemeSubscriber): () => void {
        this.subscribers.add(callback);
        callback(this.theme, this.currentType);
        return () => this.subscribers.delete(callback);
    }

    public async setTheme(themeType: ThemeType, options: SetThemeOptions = {}): Promise<void> {
        if (!this.manager.themeExists(themeType)) {
            throw new Error(`Theme '${themeType}' is not registered.`);
        }

        if (themeType === this.currentType) {
            return;
        }

        this.currentType = themeType;

        if (options.persist !== false) {
            const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
            await config.update(VSCODE_CONFIG.THEME_KEY, themeType, vscode.ConfigurationTarget.Global);
        }

        this.emit();
    }

    public refreshFromConfiguration(): void {
        const resolved = this.manager.getCurrentTheme();
        if (resolved !== this.currentType) {
            this.currentType = resolved;
            this.emit();
        }
    }

    public syncWithVSCodeColorTheme(kind: vscode.ColorThemeKind): void {
        if (kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast) {
            void this.setTheme('modern', { persist: false });
        } else {
            void this.setTheme('vscode', { persist: false });
        }
    }

    private emit(): void {
        const theme = this.theme;
        for (const subscriber of this.subscribers) {
            subscriber(theme, this.currentType);
        }
    }
}
