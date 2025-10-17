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