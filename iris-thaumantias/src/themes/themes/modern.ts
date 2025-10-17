import { Theme, ThemeConfig } from '../types';

// Modern theme - clean, card-based design inspired by modern web apps
export const modernTheme: Theme = {
    // Colors - clean, professional palette that adapts to VS Code theme
    background: 'var(--vscode-editor-background)',
    foreground: 'var(--vscode-foreground)',
    cardBackground: 'var(--vscode-sideBar-background)',
    border: 'var(--vscode-sideBar-border)',

    // Interactive elements - use VS Code button tokens
    buttonBackground: 'var(--vscode-button-background)',
    buttonForeground: 'var(--vscode-button-foreground)',
    buttonHover: 'var(--vscode-button-hoverBackground)',
    buttonActive: 'var(--vscode-button-hoverBackground)',

    // Input elements - VS Code-aligned
    inputBackground: 'var(--vscode-input-background)',
    inputForeground: 'var(--vscode-input-foreground)',
    inputBorder: 'var(--vscode-input-border)',
    inputFocus: 'var(--vscode-focusBorder)',

    // Status colors - VS Code semantic colors
    successColor: 'var(--vscode-terminal-ansiGreen)',
    errorColor: 'var(--vscode-errorForeground)',
    infoColor: 'var(--vscode-terminal-ansiBlue)',
    warningColor: 'var(--vscode-editorWarning-foreground)',

    // Status backgrounds and borders
    successBackground: 'rgba(38, 166, 91, 0.12)',
    successBorder: 'rgba(38, 166, 91, 0.4)',
    successForeground: 'var(--vscode-testing-iconPassed)',
    errorBackground: 'rgba(229, 83, 83, 0.12)',
    errorBorder: 'rgba(229, 83, 83, 0.4)',
    errorForeground: 'var(--vscode-problemsErrorIcon-foreground)',
    infoBackground: 'rgba(71, 155, 255, 0.12)',
    infoBorder: 'rgba(71, 155, 255, 0.4)',
    infoForeground: 'var(--vscode-problemsInfoIcon-foreground)',
    warningBackground: 'rgba(255, 179, 71, 0.12)',
    warningBorder: 'rgba(255, 179, 71, 0.4)',
    warningForeground: 'var(--vscode-problemsWarningIcon-foreground)',

    // Code elements
    codeBackground: 'var(--vscode-editor-inactiveSelectionBackground)',
    codeForeground: 'var(--vscode-editor-foreground)',
    fontFamilyMono: 'var(--vscode-editor-font-family)',

    // Additional UI
    accent: 'var(--vscode-textLink-activeForeground)',
    buttonShadow: '0 2px 8px rgba(0,0,0,0.1)',
    buttonShadowHover: '0 4px 12px rgba(0,0,0,0.15)',

    // Layout - spacious, card-focused
    containerPadding: '28px',
    containerBorderRadius: '12px',
    elementSpacing: '24px',
    formSpacing: '18px',

    // Visual effects - subtle, professional (flat in VS Code)
    boxShadow: 'none',
    backdrop: 'none',
    transition: 'all 0.15s ease-in-out',

    // Typography - clean, readable
    fontFamily: 'var(--vscode-font-family)',
    fontSize: '14px',
    fontWeight: '500',
    lineHeight: '1.5',
};

export const modernThemeConfig: ThemeConfig = {
    name: 'modern',
    displayName: 'Modern',
    theme: modernTheme,
};