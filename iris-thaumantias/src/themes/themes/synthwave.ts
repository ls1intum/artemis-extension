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