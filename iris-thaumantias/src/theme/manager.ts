import * as vscode from 'vscode';
import { VSCODE_CONFIG } from '../utils/constants';
import { focusRing, surfaceShadow } from './helpers';
import { themes, themeConfigs } from './themes';
import { fontWeights, lineHeights, radii, shadows, space, transitions, zIndices } from './tokens';
import { Theme, ThemeConfig, ThemeType } from './types';

const indent = (entries: Array<[string, string | number]>): string =>
    entries
        .map(([name, value]) => `    ${name}: ${value};`)
        .join('\n');

const buildPrimitiveVars = (theme: Theme): string => {
    const entries: Array<[string, string | number]> = [
        ['--iris-font-family-body', theme.typography.fontFamily],
        ['--iris-font-family-mono', theme.typography.fontFamilyMono],
        ['--iris-font-size-base', theme.typography.fontSize],
        ['--iris-font-size-small', theme.typography.fontSizeSmall],
        ['--iris-font-size-h1', theme.typography.heading.h1],
        ['--iris-font-size-h2', theme.typography.heading.h2],
        ['--iris-font-size-h3', theme.typography.heading.h3],
        ['--iris-font-weight-regular', fontWeights.regular],
        ['--iris-font-weight-medium', fontWeights.medium],
        ['--iris-font-weight-semibold', fontWeights.semibold],
        ['--iris-line-height-base', theme.typography.lineHeight],
        ['--iris-line-height-snug', lineHeights.snug],
        ['--iris-line-height-relaxed', lineHeights.relaxed],
        ['--iris-line-height-loose', lineHeights.loose],
        ['--iris-radius-xs', radii.xs],
        ['--iris-radius-sm', radii.sm],
        ['--iris-radius-md', radii.md],
        ['--iris-radius-lg', radii.lg],
        ['--iris-radius-xl', radii.xl],
        ['--iris-radius-pill', radii.pill],
        ['--iris-shadow-xs', shadows.xs],
        ['--iris-shadow-sm', shadows.sm],
        ['--iris-shadow-md', shadows.md],
        ['--iris-shadow-lg', shadows.lg],
        ['--iris-transition-fast', transitions.fast],
        ['--iris-transition-base', transitions.base],
        ['--iris-transition-slow', transitions.slow],
        ['--iris-transition-interactive', theme.transitions.interactive],
        ['--iris-transition-soft', theme.transitions.soft],
        ['--iris-space-0', space[0]],
        ['--iris-space-xs', space.xs],
        ['--iris-space-sm', space.sm],
        ['--iris-space-md', space.md],
        ['--iris-space-lg', space.lg],
        ['--iris-space-xl', space.xl],
        ['--iris-space-2xl', space['2xl']],
        ['--iris-space-3xl', space['3xl']],
        ['--iris-z-index-base', zIndices.base],
        ['--iris-z-index-overlay', zIndices.overlay],
        ['--iris-z-index-popover', zIndices.popover],
        ['--iris-z-index-modal', zIndices.modal],
    ];

    return indent(entries);
};

const buildThemeVars = (theme: Theme): string => {
    const entries: Array<[string, string | number]> = [
        ['--iris-color-background-app', theme.colors.background.app],
        ['--iris-color-background-surface', theme.colors.background.surface],
        ['--iris-color-background-elevated', theme.colors.background.elevated],
        ['--iris-color-background-sunken', theme.colors.background.sunken],
        ['--iris-color-overlay', theme.colors.background.overlay],
        ['--iris-color-text-primary', theme.colors.text.primary],
        ['--iris-color-text-secondary', theme.colors.text.secondary],
        ['--iris-color-text-muted', theme.colors.text.muted],
        ['--iris-color-text-accent', theme.colors.text.accent],
        ['--iris-color-text-inverse', theme.colors.text.inverse],
        ['--iris-color-text-link', theme.colors.text.link],
        ['--iris-color-text-link-hover', theme.colors.text.linkHover],
        ['--iris-color-border-subtle', theme.colors.border.subtle],
        ['--iris-color-border-default', theme.colors.border.default],
        ['--iris-color-border-strong', theme.colors.border.strong],
        ['--iris-color-border-focus', theme.colors.border.focus],
        ['--iris-color-accent', theme.colors.accent.primary],
        ['--iris-color-accent-muted', theme.colors.accent.muted],
        ['--iris-color-accent-foreground', theme.colors.accent.onPrimary],
        ['--iris-color-status-success', theme.colors.status.success],
        ['--iris-color-status-success-foreground', theme.colors.status.successForeground],
        ['--iris-color-status-success-subtle', theme.colors.status.successSubtle],
        ['--iris-color-status-warning', theme.colors.status.warning],
        ['--iris-color-status-warning-foreground', theme.colors.status.warningForeground],
        ['--iris-color-status-warning-subtle', theme.colors.status.warningSubtle],
        ['--iris-color-status-danger', theme.colors.status.danger],
        ['--iris-color-status-danger-foreground', theme.colors.status.dangerForeground],
        ['--iris-color-status-danger-subtle', theme.colors.status.dangerSubtle],
        ['--iris-color-status-info', theme.colors.status.info],
        ['--iris-color-status-info-foreground', theme.colors.status.infoForeground],
        ['--iris-color-status-info-subtle', theme.colors.status.infoSubtle],
        ['--iris-color-action-primary', theme.colors.interactive.primary.default],
        ['--iris-color-action-primary-hover', theme.colors.interactive.primary.hover],
        ['--iris-color-action-primary-active', theme.colors.interactive.primary.active],
        ['--iris-color-action-primary-disabled', theme.colors.interactive.primary.disabled],
        ['--iris-color-action-primary-foreground', theme.colors.interactive.primary.foreground],
        ['--iris-color-action-secondary', theme.colors.interactive.secondary.default],
        ['--iris-color-action-secondary-hover', theme.colors.interactive.secondary.hover],
        ['--iris-color-action-secondary-active', theme.colors.interactive.secondary.active],
        ['--iris-color-action-secondary-disabled', theme.colors.interactive.secondary.disabled],
        ['--iris-color-action-secondary-foreground', theme.colors.interactive.secondary.foreground],
        ['--iris-color-action-ghost', theme.colors.interactive.ghost.default],
        ['--iris-color-action-ghost-hover', theme.colors.interactive.ghost.hover],
        ['--iris-color-action-ghost-active', theme.colors.interactive.ghost.active],
        ['--iris-color-action-ghost-disabled', theme.colors.interactive.ghost.disabled],
        ['--iris-color-action-ghost-foreground', theme.colors.interactive.ghost.foreground],
        ['--iris-shadow-focus-ring', theme.shadows.focus],
        ['--iris-shadow-surface', surfaceShadow(theme)],
        ['--iris-shadow-raised', theme.shadows.raised],
        ['--iris-focus-ring', focusRing(theme)],
        ['--iris-layout-gutter', theme.layout.gutter],
        ['--iris-layout-surface-padding', theme.layout.surfacePadding],
        ['--iris-layout-stack-gap', theme.layout.stackGap],
        ['--iris-layout-card-radius', theme.layout.cardRadius],
    ];

    return indent(entries);
};

export class ThemeManager {
    private static configs = themeConfigs;

    public getCurrentTheme(): ThemeType {
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        return config.get<ThemeType>(VSCODE_CONFIG.THEME_KEY, 'vscode');
    }

    public getThemeConfig(themeType?: ThemeType): ThemeConfig {
        const type = themeType ?? this.getCurrentTheme();
        return ThemeManager.configs[type];
    }

    public getTheme(themeType?: ThemeType): Theme {
        const type = themeType ?? this.getCurrentTheme();
        return themes[type];
    }

    public getThemeCSS(themeType?: ThemeType): string {
        const theme = this.getTheme(themeType);
        const primitives = buildPrimitiveVars(theme);
        const scoped = buildThemeVars(theme);

        return `
:root {
${primitives}
}

body {
    margin: 0;
    font-family: var(--iris-font-family-body);
    font-size: var(--iris-font-size-base);
    line-height: var(--iris-line-height-base);
    background-color: var(--iris-color-background-app);
    color: var(--iris-color-text-primary);
}

body.iris-theme {
    min-height: 100vh;
    background-color: var(--iris-color-background-app);
    color: var(--iris-color-text-primary);
}

body.theme-${theme.type} {
    color-scheme: ${theme.colorScheme};
${scoped}
}
`;
    }

    public getAvailableThemes(): ThemeConfig[] {
        return Object.values(ThemeManager.configs);
    }

    public themeExists(themeType: string): themeType is ThemeType {
        return themeType in ThemeManager.configs;
    }
}

export { ThemeType, Theme, ThemeConfig } from './types';
