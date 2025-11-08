import { primitives } from './tokens';
import {
    ThemeDefinition,
    ThemeRegistry,
    ThemeSemanticTokens,
    ThemeName,
    ThemePrimitives,
} from './types';

function alpha(color: string, value: number): string {
    const hexMatch = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!hexMatch) {
        return color;
    }

    const hexValue = hexMatch[1];
    const size = hexValue.length === 3 ? 1 : 2;
    const channels = hexValue
        .match(new RegExp(`.{${size}}`, 'g'))
        ?.map(part => parseInt(size === 1 ? part + part : part, 16));

    if (!channels || channels.length !== 3) {
        return color;
    }

    return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${value})`;
}

function deepMerge<T>(base: T, overrides: Partial<T>): T {
    const result: Record<string, unknown> = Array.isArray(base) ? [...(base as unknown[])] : { ...(base as Record<string, unknown>) };

    for (const key of Object.keys(overrides) as (keyof T)[]) {
        const overrideValue = overrides[key];
        if (overrideValue === undefined) {
            continue;
        }

        const baseValue = (base as Record<string, unknown>)[key];
        if (
            overrideValue &&
            typeof overrideValue === 'object' &&
            !Array.isArray(overrideValue) &&
            baseValue &&
            typeof baseValue === 'object'
        ) {
            result[key as string] = deepMerge(baseValue, overrideValue as Record<string, unknown>) as unknown;
        } else {
            result[key as string] = overrideValue as unknown;
        }
    }

    return result as T;
}

function createBaseTheme(primitivesSet: ThemePrimitives, mode: 'light' | 'dark'): ThemeSemanticTokens {
    const { palette, shadows, radii, typography, fontSizes, fontWeights, lineHeights, space } = primitivesSet;

    if (mode === 'light') {
        return {
            background: {
                app: palette.neutral['0'],
                surface: palette.neutral['50'],
                elevated: palette.neutral['0'],
                muted: palette.neutral['100'],
                overlay: 'rgba(15, 23, 42, 0.12)',
            },
            text: {
                primary: palette.neutral['900'],
                secondary: palette.neutral['700'],
                muted: palette.neutral['500'],
                accent: palette.iris['600'],
                inverse: palette.neutral['0'],
            },
            border: {
                subtle: palette.neutral['200'],
                default: palette.neutral['300'],
                strong: palette.neutral['400'],
                focus: palette.iris['600'],
            },
            button: {
                primary: {
                    background: palette.iris['600'],
                    foreground: palette.neutral['0'],
                    hover: palette.iris['500'],
                    active: palette.iris['700'],
                    border: 'transparent',
                    shadow: shadows.sm,
                },
                secondary: {
                    background: palette.neutral['100'],
                    foreground: palette.neutral['700'],
                    border: palette.neutral['200'],
                    hover: palette.neutral['200'],
                    active: palette.neutral['300'],
                    shadow: shadows.xs,
                },
                ghost: {
                    foreground: palette.neutral['700'],
                    hover: alpha(palette.neutral['600'], 0.1),
                    active: alpha(palette.neutral['700'], 0.18),
                },
            },
            input: {
                background: palette.neutral['0'],
                foreground: palette.neutral['900'],
                placeholder: palette.neutral['400'],
                border: palette.neutral['200'],
                focus: palette.iris['600'],
            },
            card: {
                background: palette.neutral['0'],
                border: palette.neutral['200'],
                shadow: shadows.sm,
                radius: radii.lg,
            },
            states: {
                success: {
                    text: palette.state.success,
                    background: alpha(palette.state.success, 0.12),
                    border: alpha(palette.state.success, 0.32),
                },
                warning: {
                    text: palette.state.warning,
                    background: alpha(palette.state.warning, 0.12),
                    border: alpha(palette.state.warning, 0.32),
                },
                danger: {
                    text: palette.state.danger,
                    background: alpha(palette.state.danger, 0.12),
                    border: alpha(palette.state.danger, 0.32),
                },
                info: {
                    text: palette.state.info,
                    background: alpha(palette.state.info, 0.12),
                    border: alpha(palette.state.info, 0.32),
                },
            },
            focusRing: primitivesSet.focusRing(palette.iris['600']),
            overlay: {
                backdrop: 'rgba(15, 23, 42, 0.08)',
                shadow: shadows.lg,
                filter: 'blur(18px)',
            },
            typography: {
                fontFamily: typography.sans,
                fontFamilyMono: typography.mono,
                fontSize: fontSizes.md,
                fontWeight: String(fontWeights.medium),
                lineHeight: lineHeights.standard,
            },
            layout: {
                containerPadding: space.lg,
                surfacePadding: space.md,
                gap: space.md,
                radius: radii.lg,
            },
        };
    }

    return {
        background: {
            app: palette.neutral['900'],
            surface: palette.neutral['800'],
            elevated: 'rgba(30, 41, 59, 0.82)',
            muted: palette.neutral['700'],
            overlay: 'rgba(2, 6, 23, 0.65)',
        },
        text: {
            primary: palette.neutral['0'],
            secondary: palette.neutral['100'],
            muted: palette.neutral['400'],
            accent: palette.iris['400'],
            inverse: palette.neutral['900'],
        },
        border: {
            subtle: 'rgba(148, 163, 184, 0.24)',
            default: 'rgba(148, 163, 184, 0.32)',
            strong: 'rgba(148, 163, 184, 0.48)',
            focus: palette.iris['400'],
        },
        button: {
            primary: {
                background: palette.iris['500'],
                foreground: palette.neutral['0'],
                hover: palette.iris['400'],
                active: palette.iris['600'],
                border: 'transparent',
                shadow: shadows.sm,
            },
            secondary: {
                background: 'rgba(148, 163, 184, 0.12)',
                foreground: palette.neutral['0'],
                border: 'rgba(148, 163, 184, 0.3)',
                hover: 'rgba(148, 163, 184, 0.2)',
                active: 'rgba(148, 163, 184, 0.32)',
                shadow: shadows.xs,
            },
            ghost: {
                foreground: palette.neutral['0'],
                hover: alpha(palette.iris['400'], 0.18),
                active: alpha(palette.iris['500'], 0.24),
            },
        },
        input: {
            background: 'rgba(15, 23, 42, 0.65)',
            foreground: palette.neutral['0'],
            placeholder: palette.neutral['400'],
            border: 'rgba(148, 163, 184, 0.28)',
            focus: palette.iris['400'],
        },
        card: {
            background: 'rgba(30, 41, 59, 0.82)',
            border: 'rgba(148, 163, 184, 0.2)',
            shadow: shadows.md,
            radius: radii.md,
        },
        states: {
            success: {
                text: palette.state.success,
                background: alpha(palette.state.success, 0.2),
                border: alpha(palette.state.success, 0.45),
            },
            warning: {
                text: palette.state.warning,
                background: alpha(palette.state.warning, 0.2),
                border: alpha(palette.state.warning, 0.45),
            },
            danger: {
                text: palette.state.danger,
                background: alpha(palette.state.danger, 0.2),
                border: alpha(palette.state.danger, 0.45),
            },
            info: {
                text: palette.state.info,
                background: alpha(palette.state.info, 0.2),
                border: alpha(palette.state.info, 0.45),
            },
        },
        focusRing: primitivesSet.focusRing(palette.iris['400']),
        overlay: {
            backdrop: 'rgba(15, 23, 42, 0.4)',
            shadow: shadows.lg,
            filter: 'blur(20px)',
        },
        typography: {
            fontFamily: typography.sans,
            fontFamilyMono: typography.mono,
            fontSize: fontSizes.md,
            fontWeight: String(fontWeights.medium),
            lineHeight: lineHeights.standard,
        },
        layout: {
            containerPadding: space.lg,
            surfacePadding: space.md,
            gap: space.md,
            radius: radii.md,
        },
    };
}

function buildThemeDefinition(
    id: ThemeName,
    label: string,
    mode: 'light' | 'dark',
    overrides: Partial<ThemeSemanticTokens>,
): ThemeDefinition {
    const base = createBaseTheme(primitives, mode);
    const tokens = deepMerge(base, overrides);

    return {
        id,
        label,
        mode,
        tokens,
    };
}

const lightDefinition = buildThemeDefinition('light', 'Light', 'light', {});
const darkDefinition = buildThemeDefinition('dark', 'Dark', 'dark', {});

const vscodeDefinition = buildThemeDefinition('vscode', 'VS Code', 'dark', {
    background: {
        app: 'var(--vscode-sideBar-background)',
        surface: 'var(--vscode-editor-background)',
        elevated: 'var(--vscode-editorWidget-background)',
        muted: 'var(--vscode-sideBarSectionHeader-background, rgba(0, 0, 0, 0.25))',
        overlay: 'rgba(0, 0, 0, 0.45)',
    },
    text: {
        primary: 'var(--vscode-foreground)',
        secondary: 'var(--vscode-descriptionForeground)',
        muted: 'var(--vscode-descriptionForeground)',
        accent: 'var(--vscode-textLink-activeForeground)',
        inverse: 'var(--vscode-editor-background)',
    },
    border: {
        subtle: 'var(--vscode-sideBar-border)',
        default: 'var(--vscode-input-border)',
        strong: 'var(--vscode-focusBorder)',
        focus: 'var(--vscode-focusBorder)',
    },
    button: {
        primary: {
            background: 'var(--vscode-button-background)',
            foreground: 'var(--vscode-button-foreground)',
            hover: 'var(--vscode-button-hoverBackground)',
            active: 'var(--vscode-button-hoverBackground)',
            border: 'var(--vscode-button-border, transparent)',
            shadow: primitives.shadows.none,
        },
        secondary: {
            background: 'var(--vscode-editor-background)',
            foreground: 'var(--vscode-foreground)',
            border: 'var(--vscode-input-border)',
            hover: 'var(--vscode-list-hoverBackground)',
            active: 'var(--vscode-list-activeSelectionBackground)',
            shadow: primitives.shadows.none,
        },
        ghost: {
            foreground: 'var(--vscode-foreground)',
            hover: 'var(--vscode-list-hoverBackground)',
            active: 'var(--vscode-list-activeSelectionBackground)',
        },
    },
    input: {
        background: 'var(--vscode-input-background)',
        foreground: 'var(--vscode-input-foreground)',
        placeholder: 'var(--vscode-descriptionForeground)',
        border: 'var(--vscode-input-border)',
        focus: 'var(--vscode-focusBorder)',
    },
    card: {
        background: 'var(--vscode-editor-background)',
        border: 'var(--vscode-sideBar-border)',
        shadow: primitives.shadows.none,
        radius: '4px',
    },
    states: {
        success: {
            text: 'var(--vscode-testing-iconPassed)',
            background: 'rgba(38, 166, 91, 0.12)',
            border: 'rgba(38, 166, 91, 0.4)',
        },
        danger: {
            text: 'var(--vscode-problemsErrorIcon-foreground)',
            background: 'rgba(229, 83, 83, 0.12)',
            border: 'rgba(229, 83, 83, 0.4)',
        },
        info: {
            text: 'var(--vscode-problemsInfoIcon-foreground)',
            background: 'rgba(71, 155, 255, 0.12)',
            border: 'rgba(71, 155, 255, 0.4)',
        },
        warning: {
            text: 'var(--vscode-problemsWarningIcon-foreground)',
            background: 'rgba(255, 179, 71, 0.12)',
            border: 'rgba(255, 179, 71, 0.4)',
        },
    },
    focusRing: primitives.focusRing('var(--vscode-focusBorder)'),
    overlay: {
        backdrop: 'rgba(0, 0, 0, 0.4)',
        shadow: 'var(--vscode-widget-shadow, 0 8px 24px rgba(0, 0, 0, 0.35))',
        filter: 'blur(12px)',
    },
    typography: {
        fontFamily: 'var(--vscode-font-family)',
        fontFamilyMono: 'var(--vscode-editor-font-family)',
        fontSize: 'var(--vscode-font-size, 13px)',
        fontWeight: '400',
        lineHeight: '1.4',
    },
    layout: {
        containerPadding: '12px',
        surfacePadding: '12px',
        gap: '12px',
        radius: '4px',
    },
});

const modernDefinition = buildThemeDefinition('modern', 'Modern', 'dark', {
    background: {
        app: 'var(--vscode-editor-background)',
        surface: 'var(--vscode-sideBar-background)',
        elevated: 'rgba(30, 41, 59, 0.78)',
        muted: 'rgba(148, 163, 184, 0.16)',
        overlay: 'rgba(15, 23, 42, 0.55)',
    },
    text: {
        accent: primitives.palette.iris['400'],
    },
    border: {
        subtle: 'rgba(148, 163, 184, 0.22)',
        default: 'rgba(148, 163, 184, 0.32)',
        strong: 'rgba(148, 163, 184, 0.48)',
    },
    button: {
        primary: {
            background: primitives.palette.iris['500'],
            foreground: primitives.palette.neutral['0'],
            hover: primitives.palette.iris['400'],
            active: primitives.palette.iris['600'],
            border: 'transparent',
            shadow: primitives.shadows.sm,
        },
        secondary: {
            background: 'rgba(99, 102, 241, 0.16)',
            foreground: primitives.palette.neutral['0'],
            border: 'rgba(99, 102, 241, 0.32)',
            hover: 'rgba(99, 102, 241, 0.28)',
            active: 'rgba(99, 102, 241, 0.4)',
            shadow: primitives.shadows.xs,
        },
        ghost: {
            foreground: primitives.palette.neutral['0'],
            hover: 'rgba(255, 255, 255, 0.08)',
            active: 'rgba(255, 255, 255, 0.16)',
        },
    },
    input: {
        background: 'rgba(15, 23, 42, 0.72)',
        foreground: primitives.palette.neutral['0'],
        border: 'rgba(99, 102, 241, 0.28)',
        focus: primitives.palette.iris['400'],
        placeholder: primitives.palette.neutral['400'],
    },
    card: {
        background: 'rgba(30, 41, 59, 0.78)',
        border: 'rgba(148, 163, 184, 0.22)',
        shadow: primitives.shadows.md,
        radius: primitives.radii.lg,
    },
    focusRing: primitives.focusRing(primitives.palette.iris['400']),
    overlay: {
        backdrop: 'rgba(15, 23, 42, 0.62)',
        shadow: primitives.shadows.lg,
        filter: 'blur(18px)',
    },
    layout: {
        containerPadding: primitives.space.xl,
        surfacePadding: primitives.space.lg,
        gap: primitives.space.md,
        radius: primitives.radii.lg,
    },
});

const synthwaveDefinition = buildThemeDefinition('synthwave', 'Synthwave', 'dark', {
    background: {
        app: 'linear-gradient(135deg, #0f0c29 0%, #302b63 35%, #24243e 100%)',
        surface: 'rgba(15, 12, 41, 0.92)',
        elevated: 'rgba(48, 43, 99, 0.9)',
        muted: 'rgba(255, 0, 110, 0.2)',
        overlay: 'rgba(255, 0, 110, 0.35)',
    },
    text: {
        primary: '#fdf4ff',
        secondary: '#fbc0ff',
        muted: 'rgba(255, 255, 255, 0.65)',
        accent: '#ff66c4',
        inverse: '#0f0c29',
    },
    border: {
        subtle: 'rgba(255, 0, 110, 0.32)',
        default: '#ff006e',
        strong: '#ff66c4',
        focus: '#ff66c4',
    },
    button: {
        primary: {
            background: 'linear-gradient(135deg, #ff006e 0%, #8338ec 100%)',
            foreground: '#ffffff',
            hover: 'linear-gradient(135deg, #ff1f8f 0%, #9d4edd 100%)',
            active: 'linear-gradient(135deg, #d90459 0%, #7209b7 100%)',
            border: 'transparent',
            shadow: '0 0 20px rgba(255, 0, 110, 0.45)',
        },
        secondary: {
            background: 'rgba(0, 245, 255, 0.12)',
            foreground: '#00f5ff',
            border: 'rgba(0, 245, 255, 0.4)',
            hover: 'rgba(0, 245, 255, 0.22)',
            active: 'rgba(0, 245, 255, 0.32)',
            shadow: '0 0 18px rgba(0, 245, 255, 0.3)',
        },
        ghost: {
            foreground: '#00f5ff',
            hover: 'rgba(255, 0, 110, 0.32)',
            active: 'rgba(255, 0, 110, 0.45)',
        },
    },
    input: {
        background: 'rgba(15, 12, 41, 0.8)',
        foreground: '#00f5ff',
        placeholder: 'rgba(0, 245, 255, 0.6)',
        border: '#00f5ff',
        focus: '#ff006e',
    },
    card: {
        background: 'rgba(15, 12, 41, 0.9)',
        border: 'rgba(255, 0, 110, 0.35)',
        shadow: '0 0 24px rgba(255, 0, 110, 0.4)',
        radius: primitives.radii.md,
    },
    states: {
        success: {
            text: '#39ff14',
            background: 'rgba(57, 255, 20, 0.15)',
            border: 'rgba(57, 255, 20, 0.5)',
        },
        danger: {
            text: '#ff073a',
            background: 'rgba(255, 7, 58, 0.18)',
            border: 'rgba(255, 7, 58, 0.5)',
        },
        info: {
            text: '#00f5ff',
            background: 'rgba(0, 245, 255, 0.18)',
            border: 'rgba(0, 245, 255, 0.5)',
        },
        warning: {
            text: '#ffbd39',
            background: 'rgba(255, 189, 57, 0.18)',
            border: 'rgba(255, 189, 57, 0.5)',
        },
    },
    focusRing: primitives.focusRing('#ff66c4'),
    overlay: {
        backdrop: 'rgba(15, 12, 41, 0.68)',
        shadow: '0 0 40px rgba(255, 0, 110, 0.55)',
        filter: 'blur(22px)',
    },
    typography: {
        fontFamily: '"Courier New", Consolas, "SF Mono", Monaco, monospace',
        fontFamilyMono: '"Courier New", Consolas, "SF Mono", Monaco, monospace',
        fontSize: primitives.fontSizes.md,
        fontWeight: '500',
        lineHeight: '1.6',
    },
    layout: {
        containerPadding: '24px',
        surfacePadding: '20px',
        gap: '20px',
        radius: primitives.radii.md,
    },
});

export const themeRegistry: ThemeRegistry = {
    light: lightDefinition,
    dark: darkDefinition,
    vscode: vscodeDefinition,
    modern: modernDefinition,
    synthwave: synthwaveDefinition,
};

export function getThemeDefinition(theme: ThemeName): ThemeDefinition {
    return themeRegistry[theme];
}

export const availableThemes: ThemeDefinition[] = Object.values(themeRegistry);
