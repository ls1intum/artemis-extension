import { Theme, ThemeConfig } from '../types';

// Synthwave theme - retro-futuristic neon aesthetic
export const synthwaveTheme: Theme = {
    // Colors - dark synthwave with neon gradients
    background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 35%, #24243e 100%)',
    foreground: '#ff006e',
    cardBackground: 'rgba(15, 12, 41, 0.9)',
    border: '#ff006e',
    
    // Interactive elements - neon glow effects
    buttonBackground: 'linear-gradient(135deg, #ff006e 0%, #8338ec 100%)',
    buttonForeground: '#ffffff',
    buttonHover: 'linear-gradient(135deg, #ff1f8f 0%, #9d4edd 100%)',
    buttonActive: 'linear-gradient(135deg, #d90459 0%, #7209b7 100%)',
    
    // Input elements - synthwave neon styling
    inputBackground: 'rgba(15, 12, 41, 0.8)',
    inputForeground: '#00f5ff',
    inputBorder: '#00f5ff',
    inputFocus: '#ff006e',
    
    // Status colors - vibrant synthwave palette
    successColor: '#39ff14',
    errorColor: '#ff073a',
    infoColor: '#00f5ff',
    warningColor: '#ffbd39',
    
    // Status backgrounds and borders
    successBackground: 'rgba(57, 255, 20, 0.15)',
    successBorder: 'rgba(57, 255, 20, 0.5)',
    successForeground: '#39ff14',
    errorBackground: 'rgba(255, 7, 58, 0.15)',
    errorBorder: 'rgba(255, 7, 58, 0.5)',
    errorForeground: '#ff073a',
    infoBackground: 'rgba(0, 245, 255, 0.15)',
    infoBorder: 'rgba(0, 245, 255, 0.5)',
    infoForeground: '#00f5ff',
    warningBackground: 'rgba(255, 189, 57, 0.15)',
    warningBorder: 'rgba(255, 189, 57, 0.5)',
    warningForeground: '#ffbd39',
    
    // Code elements
    codeBackground: 'rgba(0, 245, 255, 0.1)',
    codeForeground: '#00f5ff',
    fontFamilyMono: '"Courier New", Consolas, "SF Mono", Monaco, monospace',
    
    // Additional UI
    accent: '#ff006e',
    buttonShadow: '0 0 20px rgba(255, 0, 110, 0.4)',
    buttonShadowHover: '0 0 30px rgba(255, 0, 110, 0.6)',
    
    // Layout - retro spacing with sharp edges
    containerPadding: '24px',
    containerBorderRadius: '8px',
    elementSpacing: '20px',
    formSpacing: '16px',
    
    // Visual effects - neon glow and retro styling
    boxShadow: '0 0 20px rgba(255, 0, 110, 0.4), inset 0 0 20px rgba(0, 245, 255, 0.1)',
    backdrop: 'blur(8px)',
    transition: 'all 0.3s ease-in-out',
    
    // Typography - retro-futuristic font
    fontFamily: '"Courier New", Consolas, "SF Mono", Monaco, monospace',
    fontSize: '14px',
    fontWeight: '500',
    lineHeight: '1.6',
};

export const synthwaveThemeConfig: ThemeConfig = {
    name: 'synthwave',
    displayName: 'Synthwave',
    theme: synthwaveTheme,
};