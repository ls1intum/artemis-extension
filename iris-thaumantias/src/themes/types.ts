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