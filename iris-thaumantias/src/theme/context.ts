import * as vscode from 'vscode';
import { ThemeDefinition, ThemeManager, ThemeName } from './index';
import { VSCODE_CONFIG } from '../utils';

type ThemeListener = (theme: ThemeDefinition) => void;

declare const document: undefined | Document;

declare global {
    interface Document {
        adoptedStyleSheets?: CSSStyleSheet[];
    }
}

export interface SetThemeOptions {
    /** When true the VS Code setting is also updated. */
    persist?: boolean;
    /** The configuration target when persisting. Defaults to global settings. */
    target?: vscode.ConfigurationTarget;
}

export class ThemeStore {
    private readonly _listeners = new Set<ThemeListener>();
    private _theme: ThemeName;

    constructor(private readonly manager: ThemeManager = new ThemeManager()) {
        this._theme = manager.getCurrentTheme();
    }

    public get themeName(): ThemeName {
        return this._theme;
    }

    public get theme(): ThemeDefinition {
        return this.manager.getTheme(this._theme);
    }

    public subscribe(listener: ThemeListener, emitInitial: boolean = true): () => void {
        this._listeners.add(listener);
        if (emitInitial) {
            listener(this.theme);
        }

        return () => {
            this._listeners.delete(listener);
        };
    }

    public async setTheme(themeName: ThemeName, options: SetThemeOptions = {}): Promise<void> {
        if (!this.manager.themeExists(themeName) || this._theme === themeName) {
            return;
        }

        this._theme = themeName;
        this.notify();

        if (options.persist) {
            const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
            await config.update('theme', themeName, options.target ?? vscode.ConfigurationTarget.Global);
        }
    }

    public getThemeCSS(themeName?: ThemeName): string {
        return this.manager.getThemeCSS(themeName ?? this._theme);
    }

    private notify(): void {
        const snapshot = this.theme;
        this._listeners.forEach(listener => listener(snapshot));
    }
}

export class ThemeProvider {
    private styleElement: HTMLStyleElement | null = null;
    private unsubscribe?: () => void;

    constructor(private readonly store: ThemeStore, private readonly doc: Document | undefined = typeof document !== 'undefined' ? document : undefined) {
        if (!this.doc) {
            return;
        }

        this.styleElement = this.ensureStyleElement();
        this.unsubscribe = this.store.subscribe(theme => this.apply(theme));
    }

    public dispose(): void {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = undefined;
        }
    }

    private ensureStyleElement(): HTMLStyleElement | null {
        if (!this.doc) {
            return null;
        }

        const existing = this.doc.head.querySelector<HTMLStyleElement>('style[data-iris-theme="true"]');
        if (existing) {
            return existing;
        }

        const style = this.doc.createElement('style');
        style.setAttribute('data-iris-theme', 'true');
        this.doc.head.appendChild(style);
        return style;
    }

    private apply(theme: ThemeDefinition): void {
        if (!this.doc || !this.styleElement) {
            return;
        }

        this.styleElement.textContent = this.store.getThemeCSS(theme.name);
        this.doc.documentElement.style.setProperty('color-scheme', theme.meta.colorScheme);
        this.doc.body?.setAttribute('data-iris-theme', theme.name);
    }
}
