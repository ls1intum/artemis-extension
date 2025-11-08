import * as vscode from 'vscode';
import { VSCODE_CONFIG } from '../utils';
import { primitives } from './tokens';
import { availableThemes, themeRegistry } from './themes';
import { ThemeDefinition, ThemeName, ThemeRegistry, ThemeSemanticTokens } from './types';

function buildBaseVariables(): Record<string, string> {
    const variables: Record<string, string> = {};

    Object.entries(primitives.space).forEach(([key, value]) => {
        variables[`--iris-space-${key}`] = value;
    });

    Object.entries(primitives.fontSizes).forEach(([key, value]) => {
        variables[`--iris-font-size-${key}`] = value;
    });

    Object.entries(primitives.fontWeights).forEach(([key, value]) => {
        variables[`--iris-font-weight-${key}`] = String(value);
    });

    Object.entries(primitives.lineHeights).forEach(([key, value]) => {
        variables[`--iris-line-height-${key}`] = value;
    });

    Object.entries(primitives.radii).forEach(([key, value]) => {
        variables[`--iris-radius-${key}`] = value;
    });

    Object.entries(primitives.shadows).forEach(([key, value]) => {
        variables[`--iris-shadow-${key}`] = value;
    });

    Object.entries(primitives.transitions).forEach(([key, value]) => {
        variables[`--iris-transition-${key}`] = value;
    });

    return variables;
}

const BASE_VARIABLES = buildBaseVariables();

function createThemeVariableMap(theme: ThemeDefinition): Record<string, string> {
    const tokens = theme.tokens;
    const variables: Record<string, string> = { ...BASE_VARIABLES };

    variables['--iris-color-bg-app'] = tokens.background.app;
    variables['--iris-color-bg-surface'] = tokens.background.surface;
    variables['--iris-color-bg-elevated'] = tokens.background.elevated;
    variables['--iris-color-bg-muted'] = tokens.background.muted;
    variables['--iris-color-bg-overlay'] = tokens.background.overlay;

    variables['--iris-color-text-primary'] = tokens.text.primary;
    variables['--iris-color-text-secondary'] = tokens.text.secondary;
    variables['--iris-color-text-muted'] = tokens.text.muted;
    variables['--iris-color-text-accent'] = tokens.text.accent;
    variables['--iris-color-text-inverse'] = tokens.text.inverse;

    variables['--iris-color-border-subtle'] = tokens.border.subtle;
    variables['--iris-color-border-default'] = tokens.border.default;
    variables['--iris-color-border-strong'] = tokens.border.strong;
    variables['--iris-color-border-focus'] = tokens.border.focus;

    variables['--iris-button-primary-bg'] = tokens.button.primary.background;
    variables['--iris-button-primary-fg'] = tokens.button.primary.foreground;
    variables['--iris-button-primary-border'] = tokens.button.primary.border ?? 'transparent';
    variables['--iris-button-primary-hover'] = tokens.button.primary.hover;
    variables['--iris-button-primary-active'] = tokens.button.primary.active;
    variables['--iris-button-primary-shadow'] = tokens.button.primary.shadow ?? primitives.shadows.none;

    variables['--iris-button-secondary-bg'] = tokens.button.secondary.background;
    variables['--iris-button-secondary-fg'] = tokens.button.secondary.foreground;
    variables['--iris-button-secondary-border'] = tokens.button.secondary.border ?? 'transparent';
    variables['--iris-button-secondary-hover'] = tokens.button.secondary.hover;
    variables['--iris-button-secondary-active'] = tokens.button.secondary.active;
    variables['--iris-button-secondary-shadow'] = tokens.button.secondary.shadow ?? primitives.shadows.none;

    variables['--iris-button-ghost-fg'] = tokens.button.ghost.foreground;
    variables['--iris-button-ghost-hover'] = tokens.button.ghost.hover;
    variables['--iris-button-ghost-active'] = tokens.button.ghost.active;

    variables['--iris-input-bg'] = tokens.input.background;
    variables['--iris-input-fg'] = tokens.input.foreground;
    variables['--iris-input-placeholder'] = tokens.input.placeholder;
    variables['--iris-input-border'] = tokens.input.border;
    variables['--iris-input-focus'] = tokens.input.focus;

    variables['--iris-card-bg'] = tokens.card.background;
    variables['--iris-card-border'] = tokens.card.border;
    variables['--iris-card-shadow'] = tokens.card.shadow;
    variables['--iris-card-radius'] = tokens.card.radius;

    variables['--iris-status-success-text'] = tokens.states.success.text;
    variables['--iris-status-success-bg'] = tokens.states.success.background;
    variables['--iris-status-success-border'] = tokens.states.success.border;

    variables['--iris-status-warning-text'] = tokens.states.warning.text;
    variables['--iris-status-warning-bg'] = tokens.states.warning.background;
    variables['--iris-status-warning-border'] = tokens.states.warning.border;

    variables['--iris-status-danger-text'] = tokens.states.danger.text;
    variables['--iris-status-danger-bg'] = tokens.states.danger.background;
    variables['--iris-status-danger-border'] = tokens.states.danger.border;

    variables['--iris-status-info-text'] = tokens.states.info.text;
    variables['--iris-status-info-bg'] = tokens.states.info.background;
    variables['--iris-status-info-border'] = tokens.states.info.border;

    variables['--iris-overlay-backdrop'] = tokens.overlay.backdrop;
    variables['--iris-overlay-shadow'] = tokens.overlay.shadow;
    variables['--iris-overlay-filter'] = tokens.overlay.filter;
    variables['--iris-focus-ring-shadow'] = tokens.focusRing;

    variables['--iris-font-family-sans'] = tokens.typography.fontFamily;
    variables['--iris-font-family-mono'] = tokens.typography.fontFamilyMono;
    variables['--iris-font-size-base'] = tokens.typography.fontSize;
    variables['--iris-font-weight-base'] = tokens.typography.fontWeight;
    variables['--iris-line-height-base'] = tokens.typography.lineHeight;

    variables['--iris-container-padding'] = tokens.layout.containerPadding;
    variables['--iris-surface-padding'] = tokens.layout.surfacePadding;
    variables['--iris-layout-gap'] = tokens.layout.gap;
    variables['--iris-layout-radius'] = tokens.layout.radius;

    return variables;
}

const THEME_VARIABLES = Object.fromEntries(
    Object.entries(themeRegistry).map(([name, definition]) => [name, createThemeVariableMap(definition)]),
) as Record<ThemeName, Record<string, string>>;

export class ThemeManager {
    constructor(private readonly registry: ThemeRegistry = themeRegistry) {}

    public getCurrentTheme(): ThemeName {
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        const theme = config.get<ThemeName>('theme', 'vscode');
        if (this.registry[theme]) {
            return theme;
        }
        return 'vscode';
    }

    public getThemeDefinition(themeType?: ThemeName): ThemeDefinition {
        const theme = themeType ?? this.getCurrentTheme();
        return this.registry[theme] ?? this.registry.vscode;
    }

    public getThemeTokens(themeType?: ThemeName): ThemeSemanticTokens {
        return this.getThemeDefinition(themeType).tokens;
    }

    public getThemeCSS(themeType?: ThemeName): string {
        const theme = this.getThemeDefinition(themeType);
        const variables = createThemeVariableMap(theme);
        const declarations = Object.entries(variables)
            .map(([key, value]) => `    ${key}: ${value};`)
            .join('\n');
        return `:root {\n${declarations}\n}`;
    }

    public getThemeScript(themeType?: ThemeName): string {
        const current = themeType ?? this.getCurrentTheme();
        return `(() => {\n` +
            `    const themeVariables = ${JSON.stringify(THEME_VARIABLES)};\n` +
            `    const listeners = new Set();\n` +
            `    let activeTheme = '${current}';\n` +
            `    const applyTheme = (themeName) => {\n` +
            `        const variables = themeVariables[themeName];\n` +
            `        if (!variables) {\n` +
            `            console.warn('[IrisTheme] Unknown theme', themeName);\n` +
            `            return;\n` +
            `        }\n` +
            `        const root = document.documentElement;\n` +
            `        Object.entries(variables).forEach(([name, value]) => {\n` +
            `            root.style.setProperty(name, value);\n` +
            `        });\n` +
            `        const body = document.body;\n` +
            `        if (body) {\n` +
            `            body.dataset.irisTheme = themeName;\n` +
            `            Array.from(body.classList)\n` +
            `                .filter(cls => cls.startsWith('theme-'))\n` +
            `                .forEach(cls => body.classList.remove(cls));\n` +
            `            body.classList.add('theme-' + themeName);\n` +
            `        }\n` +
            `        activeTheme = themeName;\n` +
            `        listeners.forEach(listener => listener(themeName));\n` +
            `    };\n` +
            `    window.irisTheme = {\n` +
            `        getTheme: () => activeTheme,\n` +
            `        setTheme: applyTheme,\n` +
            `        subscribe: (listener) => {\n` +
            `            listeners.add(listener);\n` +
            `            return () => listeners.delete(listener);\n` +
            `        },\n` +
            `        themes: Object.keys(themeVariables),\n` +
            `        getVariables: (themeName) => themeVariables[themeName],\n` +
            `    };\n` +
            `    applyTheme('${current}');\n` +
            `})();`;
    }

    public getAvailableThemes(): ThemeDefinition[] {
        return availableThemes;
    }

    public themeExists(themeType: string): themeType is ThemeName {
        return Boolean(this.registry[themeType as ThemeName]);
    }
}

export * from './types';
export { primitives } from './tokens';
