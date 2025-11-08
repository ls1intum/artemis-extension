import { palette, fontSizes, fontWeights, lineHeights, radii, shadows, space, transitions, zIndices } from './tokens';
import { SemanticInteractiveToken, Theme, ThemeConfig, ThemePrimitives, ThemeType } from './types';

const primitives: ThemePrimitives = {
    palette,
    fontSizes,
    fontWeights,
    lineHeights,
    space,
    radii,
    shadows,
    transitions,
    zIndices,
};

type InteractiveOverrides = Partial<SemanticInteractiveToken> & Pick<SemanticInteractiveToken, 'default'>;

const withInteractiveDefaults = (overrides: InteractiveOverrides): SemanticInteractiveToken => ({
    default: overrides.default,
    hover: overrides.hover ?? overrides.default,
    active: overrides.active ?? overrides.hover ?? overrides.default,
    disabled: overrides.disabled ?? 'rgba(148, 163, 184, 0.28)',
    foreground: overrides.foreground ?? 'inherit',
});

interface ThemeInput {
    type: ThemeType;
    name: string;
    colorScheme: 'light' | 'dark';
    colors: Theme['colors'];
    shadows?: Partial<Theme['shadows']>;
    typography?: Partial<Theme['typography']>;
    layout?: Partial<Theme['layout']>;
    transitions?: Partial<Theme['transitions']>;
}

const baseTypography: Theme['typography'] = {
    fontFamily: "var(--vscode-font-family, 'Inter', 'Segoe UI', sans-serif)",
    fontFamilyMono: "var(--vscode-editor-font-family, 'JetBrains Mono', 'Fira Code', monospace)",
    fontSize: fontSizes.md,
    fontSizeSmall: fontSizes.sm,
    fontWeight: fontWeights.regular,
    lineHeight: lineHeights.relaxed,
    heading: {
        h1: '1.625rem',
        h2: '1.375rem',
        h3: '1.125rem',
    },
};

const baseLayout: Theme['layout'] = {
    gutter: space.xl,
    surfacePadding: space.lg,
    stackGap: space.lg,
    cardRadius: radii.md,
};

const baseShadows: Theme['shadows'] = {
    focus: `0 0 0 2px ${palette.iris[400]}`,
    surface: shadows.sm,
    raised: shadows.md,
};

const baseTransitions: Theme['transitions'] = {
    interactive: `${transitions.base}`,
    soft: `${transitions.slow}`,
};

const createTheme = (input: ThemeInput): Theme => ({
    type: input.type,
    name: input.name,
    colorScheme: input.colorScheme,
    typography: { ...baseTypography, ...(input.typography ?? {}) },
    colors: input.colors,
    layout: { ...baseLayout, ...(input.layout ?? {}) },
    shadows: { ...baseShadows, ...(input.shadows ?? {}) },
    transitions: { ...baseTransitions, ...(input.transitions ?? {}) },
    primitives,
});

const vscodeTheme = createTheme({
    type: 'vscode',
    name: 'VS Code',
    colorScheme: 'dark',
    colors: {
        background: {
            app: 'var(--vscode-sideBar-background)',
            surface: 'var(--vscode-editor-background)',
            elevated: 'var(--vscode-editorWidget-background)',
            sunken: 'var(--vscode-editor-inactiveSelectionBackground)',
            overlay: palette.overlay,
        },
        text: {
            primary: 'var(--vscode-foreground)',
            secondary: 'var(--vscode-descriptionForeground)',
            muted: 'color-mix(in srgb, var(--vscode-descriptionForeground) 70%, transparent)',
            accent: 'var(--vscode-textLink-activeForeground)',
            inverse: 'var(--vscode-editor-background)',
            link: 'var(--vscode-textLink-foreground)',
            linkHover: 'var(--vscode-textLink-activeForeground)',
        },
        border: {
            subtle: 'var(--vscode-sideBar-border)',
            default: 'var(--vscode-editorWidget-border, var(--vscode-sideBar-border))',
            strong: 'color-mix(in srgb, var(--vscode-editor-foreground) 35%, transparent)',
            focus: 'var(--vscode-focusBorder)',
        },
        status: {
            success: 'var(--vscode-testing-iconPassed)',
            successForeground: 'var(--vscode-testing-iconPassed)',
            successSubtle: 'rgba(38, 166, 91, 0.12)',
            warning: 'var(--vscode-problemsWarningIcon-foreground)',
            warningForeground: 'var(--vscode-problemsWarningIcon-foreground)',
            warningSubtle: 'rgba(255, 179, 71, 0.12)',
            danger: 'var(--vscode-problemsErrorIcon-foreground)',
            dangerForeground: 'var(--vscode-problemsErrorIcon-foreground)',
            dangerSubtle: 'rgba(229, 83, 83, 0.12)',
            info: 'var(--vscode-problemsInfoIcon-foreground)',
            infoForeground: 'var(--vscode-problemsInfoIcon-foreground)',
            infoSubtle: 'rgba(71, 155, 255, 0.12)',
        },
        accent: {
            primary: 'var(--vscode-focusBorder)',
            onPrimary: 'var(--vscode-button-foreground)',
            muted: 'color-mix(in srgb, var(--vscode-focusBorder) 28%, transparent)',
        },
        interactive: {
            primary: withInteractiveDefaults({
                default: 'var(--vscode-button-background)',
                hover: 'var(--vscode-button-hoverBackground)',
                active: 'var(--vscode-button-hoverBackground)',
                disabled: 'color-mix(in srgb, var(--vscode-button-background) 35%, transparent)',
                foreground: 'var(--vscode-button-foreground)',
            }),
            secondary: withInteractiveDefaults({
                default: 'transparent',
                hover: 'var(--vscode-list-hoverBackground)',
                active: 'var(--vscode-list-activeSelectionBackground)',
                foreground: 'var(--vscode-foreground)',
                disabled: 'color-mix(in srgb, var(--vscode-list-inactiveSelectionBackground) 35%, transparent)',
            }),
            ghost: withInteractiveDefaults({
                default: 'transparent',
                hover: 'color-mix(in srgb, var(--vscode-focusBorder) 8%, transparent)',
                active: 'color-mix(in srgb, var(--vscode-focusBorder) 16%, transparent)',
                foreground: 'var(--vscode-foreground)',
                disabled: 'transparent',
            }),
        },
    },
    shadows: {
        focus: '0 0 0 1px var(--vscode-focusBorder)',
        surface: 'var(--vscode-widget-shadow, 0 4px 16px rgba(0, 0, 0, 0.25))',
        raised: 'var(--vscode-widget-shadow, 0 12px 32px rgba(0, 0, 0, 0.32))',
    },
});

const modernTheme = createTheme({
    type: 'modern',
    name: 'Modern',
    colorScheme: 'dark',
    colors: {
        background: {
            app: palette.neutral[950],
            surface: palette.neutral[900],
            elevated: palette.neutral[800],
            sunken: palette.neutral[800],
            overlay: palette.overlay,
        },
        text: {
            primary: palette.neutral[50],
            secondary: palette.neutral[200],
            muted: 'rgba(226, 232, 240, 0.65)',
            accent: palette.iris[300],
            inverse: palette.neutral[900],
            link: palette.iris[300],
            linkHover: palette.iris[200],
        },
        border: {
            subtle: 'rgba(148, 163, 184, 0.12)',
            default: 'rgba(148, 163, 184, 0.24)',
            strong: 'rgba(148, 163, 184, 0.36)',
            focus: palette.iris[400],
        },
        status: {
            success: palette.success[500],
            successForeground: palette.neutral[50],
            successSubtle: 'rgba(34, 197, 94, 0.16)',
            warning: palette.warning[400],
            warningForeground: palette.neutral[950],
            warningSubtle: 'rgba(245, 158, 11, 0.2)',
            danger: palette.danger[500],
            dangerForeground: palette.neutral[50],
            dangerSubtle: 'rgba(248, 113, 113, 0.16)',
            info: palette.info[500],
            infoForeground: palette.neutral[50],
            infoSubtle: 'rgba(96, 165, 250, 0.18)',
        },
        accent: {
            primary: palette.iris[500],
            onPrimary: palette.neutral[0],
            muted: palette.iris[200],
        },
        interactive: {
            primary: withInteractiveDefaults({
                default: palette.iris[500],
                hover: palette.iris[400],
                active: palette.iris[600],
                foreground: palette.neutral[0],
            }),
            secondary: withInteractiveDefaults({
                default: 'rgba(99, 102, 241, 0.1)',
                hover: 'rgba(99, 102, 241, 0.16)',
                active: 'rgba(99, 102, 241, 0.22)',
                foreground: palette.iris[200],
            }),
            ghost: withInteractiveDefaults({
                default: 'transparent',
                hover: 'rgba(255, 255, 255, 0.08)',
                active: 'rgba(255, 255, 255, 0.12)',
                foreground: palette.neutral[100],
                disabled: 'rgba(148, 163, 184, 0.18)',
            }),
        },
    },
    shadows: {
        focus: `0 0 0 2px ${palette.iris[500]}`,
        surface: '0 18px 35px rgba(15, 23, 42, 0.32)',
        raised: '0 32px 60px rgba(15, 23, 42, 0.4)',
    },
    layout: {
        surfacePadding: space.xl,
        cardRadius: radii.lg,
    },
    typography: {
        fontWeight: fontWeights.medium,
    },
});

const synthwaveTheme = createTheme({
    type: 'synthwave',
    name: 'Synthwave',
    colorScheme: 'dark',
    colors: {
        background: {
            app: '#190423',
            surface: '#240637',
            elevated: '#2F0B4A',
            sunken: '#170321',
            overlay: 'rgba(56, 0, 86, 0.65)',
        },
        text: {
            primary: '#F9E8FF',
            secondary: '#E2C7FF',
            muted: 'rgba(242, 221, 255, 0.65)',
            accent: '#FF71F0',
            inverse: '#120019',
            link: '#FF71F0',
            linkHover: '#FF9FF8',
        },
        border: {
            subtle: 'rgba(255, 113, 240, 0.2)',
            default: 'rgba(255, 113, 240, 0.35)',
            strong: 'rgba(255, 113, 240, 0.6)',
            focus: '#FF71F0',
        },
        status: {
            success: '#7CF4B4',
            successForeground: '#120019',
            successSubtle: 'rgba(124, 244, 180, 0.18)',
            warning: '#FFC857',
            warningForeground: '#170321',
            warningSubtle: 'rgba(255, 200, 87, 0.22)',
            danger: '#FF6B97',
            dangerForeground: '#120019',
            dangerSubtle: 'rgba(255, 107, 151, 0.24)',
            info: '#66D9FF',
            infoForeground: '#120019',
            infoSubtle: 'rgba(102, 217, 255, 0.2)',
        },
        accent: {
            primary: '#FF71F0',
            onPrimary: '#120019',
            muted: '#C66BFF',
        },
        interactive: {
            primary: withInteractiveDefaults({
                default: '#FF71F0',
                hover: '#FF85F3',
                active: '#FF5BEB',
                foreground: '#1B021F',
            }),
            secondary: withInteractiveDefaults({
                default: 'rgba(255, 113, 240, 0.16)',
                hover: 'rgba(255, 113, 240, 0.24)',
                active: 'rgba(255, 113, 240, 0.32)',
                foreground: '#F9E8FF',
            }),
            ghost: withInteractiveDefaults({
                default: 'transparent',
                hover: 'rgba(255, 113, 240, 0.24)',
                active: 'rgba(255, 113, 240, 0.34)',
                foreground: '#F9E8FF',
                disabled: 'rgba(249, 232, 255, 0.18)',
            }),
        },
    },
    shadows: {
        focus: '0 0 0 2px rgba(255, 113, 240, 0.65)',
        surface: '0 18px 45px rgba(255, 46, 173, 0.35)',
        raised: '0 32px 65px rgba(162, 0, 255, 0.55)',
    },
    layout: {
        surfacePadding: space.xl,
        cardRadius: radii.xl,
    },
    typography: {
        fontFamily: "'Space Grotesk', var(--vscode-font-family, 'Inter', sans-serif)",
        fontWeight: fontWeights.semibold,
    },
});

export const themeConfigs: Record<ThemeType, ThemeConfig> = {
    vscode: { id: 'vscode', label: 'VS Code', theme: vscodeTheme },
    modern: { id: 'modern', label: 'Modern', theme: modernTheme },
    synthwave: { id: 'synthwave', label: 'Synthwave', theme: synthwaveTheme },
};

export const themes: Record<ThemeType, Theme> = {
    vscode: vscodeTheme,
    modern: modernTheme,
    synthwave: synthwaveTheme,
};
