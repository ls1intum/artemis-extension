// Theme type definitions
export interface Theme {
    // Color scheme
    background: string;
    foreground: string;
    cardBackground: string;
    border: string;
    
    // Interactive elements
    buttonBackground: string;
    buttonForeground: string;
    buttonHover: string;
    buttonActive: string;
    
    // Input elements
    inputBackground: string;
    inputForeground: string;
    inputBorder: string;
    inputFocus: string;
    
    // Status colors
    successColor: string;
    errorColor: string;
    infoColor: string;
    warningColor: string;
    
    // Status backgrounds and borders
    successBackground: string;
    successBorder: string;
    successForeground: string;
    errorBackground: string;
    errorBorder: string;
    errorForeground: string;
    infoBackground: string;
    infoBorder: string;
    infoForeground: string;
    warningBackground: string;
    warningBorder: string;
    warningForeground: string;
    
    // Code elements
    codeBackground: string;
    codeForeground: string;
    fontFamilyMono: string;
    
    // Additional UI
    accent: string;
    buttonShadow: string;
    buttonShadowHover: string;
    
    // Layout properties
    containerPadding: string;
    containerBorderRadius: string;
    elementSpacing: string;
    formSpacing: string;
    
    // Visual effects
    boxShadow: string;
    backdrop: string;
    transition: string;
    
    // Typography
    fontFamily: string;
    fontSize: string;
    fontWeight: string;
    lineHeight: string;
}

export type ThemeType = 'vscode' | 'modern' | 'synthwave';

export interface ThemeConfig {
    name: string;
    displayName: string;
    theme: Theme;
}