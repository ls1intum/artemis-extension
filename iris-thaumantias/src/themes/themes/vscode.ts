import { Theme, ThemeConfig } from '../types';

// VS Code theme - authentic native VS Code styling
export const vscodeTheme: Theme = {
    // Colors using authentic VS Code CSS variables
    background: 'var(--vscode-sideBar-background)',
    foreground: 'var(--vscode-sideBar-foreground)',
    cardBackground: 'var(--vscode-editor-background)',
    border: 'var(--vscode-sideBar-border)',

    // Interactive elements - use primary button styling
    buttonBackground: 'var(--vscode-button-background)',
    buttonForeground: 'var(--vscode-button-foreground)',
    buttonHover: 'var(--vscode-button-hoverBackground)',
    buttonActive: 'var(--vscode-button-hoverBackground)',

    // Input elements - match VSCode input styling
    inputBackground: 'var(--vscode-input-background)',
    inputForeground: 'var(--vscode-input-foreground)',
    inputBorder: 'var(--vscode-input-border)',
    inputFocus: 'var(--vscode-focusBorder)',

    // Status colors - use semantic VSCode colors
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
    buttonShadow: 'none',
    buttonShadowHover: 'none',

    // Layout - VSCode native spacing and sizing
    containerPadding: '12px',
    containerBorderRadius: '3px',
    elementSpacing: '12px',
    formSpacing: '8px',

    // Visual effects - VSCode flat design
    boxShadow: 'none',
    backdrop: 'none',
    transition: 'none',

    // Typography - VSCode native font styling
    fontFamily: 'var(--vscode-font-family)',
    fontSize: 'var(--vscode-font-size)',
    fontWeight: '400',
    lineHeight: '1.4',
};

export const vscodeThemeConfig: ThemeConfig = {
    name: 'vscode',
    displayName: 'VS Code',
    theme: vscodeTheme,
};