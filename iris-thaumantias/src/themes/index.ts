import * as vscode from 'vscode';
import { Theme, ThemeType, ThemeConfig } from './types';
import { vscodeThemeConfig } from './themes/vscode';
import { modernThemeConfig } from './themes/modern';
import { synthwaveThemeConfig } from './themes/synthwave';
import { VSCODE_CONFIG } from '../utils';

export class ThemeManager {
    private static themes: Record<ThemeType, ThemeConfig> = {
        vscode: vscodeThemeConfig,
        modern: modernThemeConfig,
        synthwave: synthwaveThemeConfig
    };

    /**
     * Get the current theme from VS Code settings
     */
    public getCurrentTheme(): ThemeType {
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        return config.get<ThemeType>('theme', 'vscode');
    }

    /**
     * Get the theme configuration for a specific theme
     */
    public getThemeConfig(themeType?: ThemeType): ThemeConfig {
        const theme = themeType || this.getCurrentTheme();
        return ThemeManager.themes[theme];
    }

    /**
     * Get the theme object for a specific theme
     */
    public getTheme(themeType?: ThemeType): Theme {
        return this.getThemeConfig(themeType).theme;
    }

    /**
     * Generate CSS custom properties for the current theme
     */
    public getThemeCSS(themeType?: ThemeType): string {
        const theme = this.getTheme(themeType);
        
        return `
            :root {
                /* Color scheme */
                --theme-background: ${theme.background};
                --theme-foreground: ${theme.foreground};
                --theme-card-background: ${theme.cardBackground};
                --theme-border: ${theme.border};
                
                /* Interactive elements */
                --theme-button-background: ${theme.buttonBackground};
                --theme-button-foreground: ${theme.buttonForeground};
                --theme-button-hover: ${theme.buttonHover};
                --theme-button-active: ${theme.buttonActive};
                
                /* Input elements */
                --theme-input-background: ${theme.inputBackground};
                --theme-input-foreground: ${theme.inputForeground};
                --theme-input-border: ${theme.inputBorder};
                --theme-input-focus: ${theme.inputFocus};
                
                /* Status colors */
                --theme-success: ${theme.successColor};
                --theme-error: ${theme.errorColor};
                --theme-info: ${theme.infoColor};
                
                /* Layout properties */
                --theme-container-padding: ${theme.containerPadding};
                --theme-container-radius: ${theme.containerBorderRadius};
                --theme-element-spacing: ${theme.elementSpacing};
                --theme-form-spacing: ${theme.formSpacing};
                
                /* Visual effects */
                --theme-box-shadow: ${theme.boxShadow};
                --theme-backdrop: ${theme.backdrop};
                --theme-transition: ${theme.transition};
                
                /* Typography */
                --theme-font-family: ${theme.fontFamily};
                --theme-font-size: ${theme.fontSize};
                --theme-font-weight: ${theme.fontWeight};
                --theme-line-height: ${theme.lineHeight};
            }
        `;
    }

    /**
     * Get all available themes
     */
    public getAvailableThemes(): ThemeConfig[] {
        return Object.values(ThemeManager.themes);
    }

    /**
     * Check if a theme exists
     */
    public themeExists(themeType: string): themeType is ThemeType {
        return themeType in ThemeManager.themes;
    }
}

// Export theme types and configs for external use
export { ThemeType, Theme, ThemeConfig } from './types';
export { vscodeThemeConfig } from './themes/vscode';
export { modernThemeConfig } from './themes/modern';
export { synthwaveThemeConfig } from './themes/synthwave';