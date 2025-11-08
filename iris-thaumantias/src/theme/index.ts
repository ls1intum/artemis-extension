import * as vscode from 'vscode';
import { VSCODE_CONFIG } from '../utils';

export type ThemeName = 'vscode' | 'modern' | 'synthwave';

export interface InteractiveState {
    background: string;
    foreground: string;
    hover: string;
    active: string;
    border: string;
    shadow?: string;
}

export interface StatusColor {
    foreground: string;
    background: string;
    border: string;
}

export interface SemanticColors {
    background: {
        canvas: string;
        surface: string;
        raised: string;
        sunken: string;
        overlay: string;
    };
    text: {
        primary: string;
        muted: string;
        subtle: string;
        inverted: string;
        accent: string;
    };
    border: {
        subtle: string;
        strong: string;
        focus: string;
    };
    interactive: {
        primary: InteractiveState;
        secondary: InteractiveState;
        ghost: InteractiveState;
    };
    input: {
        background: string;
        foreground: string;
        placeholder: string;
        border: string;
        focus: string;
    };
    status: {
        success: StatusColor;
        danger: StatusColor;
        warning: StatusColor;
        info: StatusColor;
    };
    accent: {
        default: string;
        emphasis: string;
        muted: string;
    };
    overlay: {
        scrim: string;
    };
}

export interface ThemeTypography {
    fontFamily: string;
    fontFamilyMono: string;
    sizes: typeof fontSizes;
    weights: {
        regular: number;
        medium: number;
        semibold: number;
        bold: number;
    };
    lineHeights: {
        snug: string;
        normal: string;
        relaxed: string;
    };
}

export interface ThemeLayout {
    container: {
        padding: string;
        radius: string;
    };
    stack: {
        gap: string;
        formGap: string;
        sectionGap: string;
    };
}

export interface ThemeDefinition {
    name: ThemeName;
    displayName: string;
    meta: {
        colorScheme: 'light' | 'dark' | 'auto';
        description?: string;
    };
    colors: SemanticColors;
    typography: ThemeTypography;
    space: typeof space;
    radii: typeof radii;
    shadows: typeof shadows;
    transitions: typeof transitions;
    layout: ThemeLayout;
    effects: {
        backdrop: string;
    };
}

export const palette = {
    neutral: {
        0: '#ffffff',
        50: '#f8fafc',
        100: '#f1f5f9',
        200: '#e2e8f0',
        300: '#cbd5f5',
        400: '#94a3b8',
        500: '#64748b',
        600: '#475569',
        700: '#334155',
        800: '#1e293b',
        900: '#0f172a',
    },
    accent: {
        300: '#a5b4fc',
        400: '#818cf8',
        500: '#6366f1',
        600: '#4f46e5',
        700: '#4338ca',
    },
    success: {
        400: '#34d399',
        500: '#10b981',
        600: '#059669',
    },
    danger: {
        400: '#fb7185',
        500: '#ef4444',
        600: '#dc2626',
    },
    warning: {
        400: '#fbbf24',
        500: '#f59e0b',
        600: '#d97706',
    },
    info: {
        400: '#60a5fa',
        500: '#3b82f6',
        600: '#2563eb',
    },
    synthwave: {
        backgroundCanvas: '#0f0221',
        backgroundSurface: '#160536',
        backgroundRaised: '#240a5c',
        textPrimary: '#f8e7ff',
        textMuted: 'rgba(248, 231, 255, 0.74)',
        accent: '#ff6ac1',
        accentHover: '#f938b7',
        accentActive: '#d7009f',
        border: 'rgba(255, 106, 193, 0.4)',
        glow: '0 0 20px rgba(255, 106, 193, 0.35)',
    },
};

export const fontSizes = {
    xs: '0.75rem',
    sm: '0.8125rem',
    md: '0.875rem',
    lg: '1rem',
    xl: '1.25rem',
};

export const space = {
    none: '0',
    '3xs': '0.125rem',
    '2xs': '0.25rem',
    xs: '0.5rem',
    sm: '0.75rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '2rem',
    '2xl': '3rem',
};

export const radii = {
    sm: '0.25rem',
    md: '0.5rem',
    lg: '0.75rem',
    xl: '1rem',
    pill: '999px',
};

export const shadows = {
    none: 'none',
    xs: '0 1px 1px rgba(15, 23, 42, 0.06)',
    sm: '0 1px 2px rgba(15, 23, 42, 0.1)',
    md: '0 8px 20px rgba(15, 23, 42, 0.18)',
    lg: '0 20px 45px rgba(15, 23, 42, 0.2)',
    button: '0 4px 12px rgba(15, 23, 42, 0.16)',
    focus: '0 0 0 2px rgba(99, 102, 241, 0.45)',
};

export const transitions = {
    fast: 'all 120ms ease-out',
    base: 'all 180ms ease',
    slow: 'all 320ms ease',
};

const defaultTypography: ThemeTypography = {
    fontFamily:
        "var(--vscode-font-family, 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif)",
    fontFamilyMono:
        "var(--vscode-editor-font-family, 'SFMono-Regular', 'Consolas', 'Liberation Mono', monospace)",
    sizes: fontSizes,
    weights: {
        regular: 400,
        medium: 500,
        semibold: 600,
        bold: 700,
    },
    lineHeights: {
        snug: '1.35',
        normal: '1.5',
        relaxed: '1.7',
    },
};

const defaultColors: SemanticColors = {
    background: {
        canvas: palette.neutral[900],
        surface: '#152238',
        raised: '#1c2e4b',
        sunken: '#0f172a',
        overlay: 'rgba(15, 23, 42, 0.9)',
    },
    text: {
        primary: palette.neutral[50],
        muted: 'rgba(248, 250, 252, 0.7)',
        subtle: 'rgba(248, 250, 252, 0.45)',
        inverted: palette.neutral[900],
        accent: palette.accent[400],
    },
    border: {
        subtle: 'rgba(148, 163, 184, 0.24)',
        strong: 'rgba(148, 163, 184, 0.4)',
        focus: 'rgba(99, 102, 241, 0.6)',
    },
    interactive: {
        primary: {
            background: palette.accent[500],
            foreground: palette.neutral[0],
            hover: palette.accent[400],
            active: palette.accent[600],
            border: 'transparent',
            shadow: shadows.button,
        },
        secondary: {
            background: 'rgba(148, 163, 184, 0.12)',
            foreground: palette.neutral[50],
            hover: 'rgba(148, 163, 184, 0.18)',
            active: 'rgba(148, 163, 184, 0.26)',
            border: 'rgba(148, 163, 184, 0.24)',
            shadow: shadows.none,
        },
        ghost: {
            background: 'transparent',
            foreground: palette.neutral[50],
            hover: 'rgba(148, 163, 184, 0.14)',
            active: 'rgba(148, 163, 184, 0.22)',
            border: 'transparent',
            shadow: shadows.none,
        },
    },
    input: {
        background: '#111827',
        foreground: palette.neutral[50],
        placeholder: 'rgba(248, 250, 252, 0.45)',
        border: 'rgba(148, 163, 184, 0.24)',
        focus: palette.accent[500],
    },
    status: {
        success: {
            foreground: palette.success[400],
            background: 'rgba(16, 185, 129, 0.16)',
            border: 'rgba(16, 185, 129, 0.4)',
        },
        danger: {
            foreground: palette.danger[400],
            background: 'rgba(239, 68, 68, 0.16)',
            border: 'rgba(239, 68, 68, 0.4)',
        },
        warning: {
            foreground: palette.warning[400],
            background: 'rgba(245, 158, 11, 0.18)',
            border: 'rgba(245, 158, 11, 0.4)',
        },
        info: {
            foreground: palette.info[400],
            background: 'rgba(59, 130, 246, 0.16)',
            border: 'rgba(59, 130, 246, 0.4)',
        },
    },
    accent: {
        default: palette.accent[400],
        emphasis: palette.accent[500],
        muted: 'rgba(99, 102, 241, 0.2)',
    },
    overlay: {
        scrim: 'rgba(15, 23, 42, 0.55)',
    },
};

const defaultLayout: ThemeLayout = {
    container: {
        padding: space.lg,
        radius: radii.lg,
    },
    stack: {
        gap: space.md,
        formGap: space.sm,
        sectionGap: space.lg,
    },
};

const defaultThemeBase = {
    meta: {
        colorScheme: 'dark' as const,
    },
    colors: defaultColors,
    typography: defaultTypography,
    space,
    radii,
    shadows,
    transitions,
    layout: defaultLayout,
    effects: {
        backdrop: 'none',
    },
};

type ThemeOverrides = Partial<Omit<ThemeDefinition, 'name' | 'displayName'>> & {
    colors?: Partial<SemanticColors>;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const deepMerge = <T>(target: T, source: Partial<T>): T => {
    const output: any = Array.isArray(target) ? [...(target as any)] : { ...(target as any) };
    Object.keys(source).forEach(key => {
        const typedKey = key as keyof T;
        const sourceValue = (source as any)[typedKey];
        if (sourceValue === undefined) {
            return;
        }

        const targetValue = (target as any)[typedKey];
        if (isObject(sourceValue) && isObject(targetValue)) {
            output[typedKey] = deepMerge(targetValue, sourceValue);
        } else if (isObject(sourceValue)) {
            output[typedKey] = deepMerge({}, sourceValue);
        } else {
            output[typedKey] = sourceValue;
        }
    });

    return output;
};

const createTheme = (
    name: ThemeName,
    displayName: string,
    overrides: ThemeOverrides,
): ThemeDefinition => {
    const base = deepMerge({}, defaultThemeBase) as Omit<ThemeDefinition, 'name' | 'displayName'>;
    if (overrides.colors) {
        base.colors = deepMerge(base.colors, overrides.colors);
    }

    const merged = deepMerge(base, { ...overrides, colors: undefined });

    return {
        name,
        displayName,
        ...merged,
    };
};

const themeRegistry: Record<ThemeName, ThemeDefinition> = {
    vscode: createTheme('vscode', 'VS Code', {
        meta: {
            colorScheme: 'auto',
            description: 'Matches the host VS Code workbench colors',
        },
        layout: {
            container: {
                padding: space.md,
                radius: radii.sm,
            },
            stack: {
                gap: space.sm,
                formGap: space.sm,
                sectionGap: space.md,
            },
        },
        shadows: {
            none: 'none',
            xs: 'none',
            sm: 'none',
            md: 'none',
            lg: 'none',
            button: 'none',
            focus: '0 0 0 1px var(--vscode-focusBorder)',
        },
        colors: {
            background: {
                canvas: 'var(--vscode-editor-background)',
                surface: 'var(--vscode-sideBar-background)',
                raised: 'var(--vscode-editorWidget-background)',
                sunken: 'var(--vscode-sideBar-dropBackground)',
                overlay: 'var(--vscode-menu-background, var(--vscode-editorWidget-background))',
            },
            text: {
                primary: 'var(--vscode-foreground)',
                muted: 'var(--vscode-descriptionForeground)',
                subtle: 'var(--vscode-disabledForeground)',
                inverted: 'var(--vscode-button-foreground)',
                accent: 'var(--vscode-textLink-foreground)',
            },
            border: {
                subtle: 'var(--vscode-sideBar-border)',
                strong: 'var(--vscode-editorWidget-border)',
                focus: 'var(--vscode-focusBorder)',
            },
            interactive: {
                primary: {
                    background: 'var(--vscode-button-background)',
                    foreground: 'var(--vscode-button-foreground)',
                    hover: 'var(--vscode-button-hoverBackground)',
                    active: 'var(--vscode-button-hoverBackground)',
                    border: 'transparent',
                    shadow: 'none',
                },
                secondary: {
                    background: 'rgba(255, 255, 255, 0.04)',
                    foreground: 'var(--vscode-foreground)',
                    hover: 'rgba(255, 255, 255, 0.08)',
                    active: 'rgba(255, 255, 255, 0.12)',
                    border: 'var(--vscode-contrastBorder, transparent)',
                    shadow: 'none',
                },
                ghost: {
                    background: 'transparent',
                    foreground: 'var(--vscode-foreground)',
                    hover: 'rgba(255, 255, 255, 0.04)',
                    active: 'rgba(255, 255, 255, 0.1)',
                    border: 'transparent',
                    shadow: 'none',
                },
            },
            input: {
                background: 'var(--vscode-input-background)',
                foreground: 'var(--vscode-input-foreground)',
                placeholder: 'var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground))',
                border: 'var(--vscode-input-border)',
                focus: 'var(--vscode-focusBorder)',
            },
            status: {
                success: {
                    foreground: 'var(--vscode-testing-iconPassed)',
                    background: 'rgba(38, 166, 91, 0.12)',
                    border: 'rgba(38, 166, 91, 0.4)',
                },
                danger: {
                    foreground: 'var(--vscode-problemsErrorIcon-foreground)',
                    background: 'rgba(229, 83, 83, 0.12)',
                    border: 'rgba(229, 83, 83, 0.4)',
                },
                warning: {
                    foreground: 'var(--vscode-problemsWarningIcon-foreground)',
                    background: 'rgba(255, 179, 71, 0.12)',
                    border: 'rgba(255, 179, 71, 0.4)',
                },
                info: {
                    foreground: 'var(--vscode-problemsInfoIcon-foreground)',
                    background: 'rgba(71, 155, 255, 0.12)',
                    border: 'rgba(71, 155, 255, 0.4)',
                },
            },
            accent: {
                default: 'var(--vscode-textLink-foreground)',
                emphasis: 'var(--vscode-textLink-activeForeground)',
                muted: 'rgba(99, 102, 241, 0.2)',
            },
            overlay: {
                scrim: 'rgba(0, 0, 0, 0.45)',
            },
        },
        effects: {
            backdrop: 'none',
        },
    }),
    modern: createTheme('modern', 'Modern', {
        meta: {
            colorScheme: 'auto',
            description: 'Airy cards and rounded controls that still respect VS Code colors',
        },
        layout: {
            container: {
                padding: space.xl,
                radius: radii.xl,
            },
            stack: {
                gap: space.lg,
                formGap: space.md,
                sectionGap: space.xl,
            },
        },
        shadows: {
            button: '0 6px 20px rgba(99, 102, 241, 0.3)',
            md: '0 12px 35px rgba(15, 23, 42, 0.25)',
            focus: '0 0 0 2px rgba(99, 102, 241, 0.35)',
        },
        colors: {
            background: {
                canvas: 'var(--vscode-editor-background)',
                surface: 'var(--vscode-sideBar-background)',
                raised: 'var(--vscode-editorWidget-background)',
                sunken: 'var(--vscode-sideBar-dropBackground, rgba(0, 0, 0, 0.35))',
                overlay: 'rgba(15, 23, 42, 0.6)',
            },
            text: {
                primary: 'var(--vscode-foreground)',
                muted: 'var(--vscode-descriptionForeground, rgba(148, 163, 184, 0.85))',
                subtle: 'rgba(148, 163, 184, 0.65)',
                inverted: palette.neutral[0],
                accent: palette.accent[500],
            },
            border: {
                subtle: 'rgba(148, 163, 184, 0.25)',
                strong: 'rgba(148, 163, 184, 0.45)',
                focus: 'rgba(99, 102, 241, 0.5)',
            },
            interactive: {
                primary: {
                    background: palette.accent[500],
                    foreground: palette.neutral[0],
                    hover: palette.accent[400],
                    active: palette.accent[600],
                    border: 'transparent',
                    shadow: '0 10px 30px rgba(99, 102, 241, 0.35)',
                },
                secondary: {
                    background: 'rgba(99, 102, 241, 0.12)',
                    foreground: palette.accent[500],
                    hover: 'rgba(99, 102, 241, 0.18)',
                    active: 'rgba(99, 102, 241, 0.24)',
                    border: 'rgba(99, 102, 241, 0.24)',
                    shadow: 'none',
                },
                ghost: {
                    background: 'transparent',
                    foreground: palette.accent[500],
                    hover: 'rgba(99, 102, 241, 0.16)',
                    active: 'rgba(99, 102, 241, 0.24)',
                    border: 'transparent',
                    shadow: 'none',
                },
            },
            input: {
                background: 'var(--vscode-input-background)',
                foreground: 'var(--vscode-input-foreground, var(--vscode-foreground))',
                placeholder: 'var(--vscode-input-placeholderForeground, rgba(148, 163, 184, 0.7))',
                border: 'rgba(148, 163, 184, 0.35)',
                focus: palette.accent[500],
            },
            status: {
                success: {
                    foreground: palette.success[500],
                    background: 'rgba(16, 185, 129, 0.14)',
                    border: 'rgba(16, 185, 129, 0.35)',
                },
                danger: {
                    foreground: palette.danger[500],
                    background: 'rgba(239, 68, 68, 0.16)',
                    border: 'rgba(239, 68, 68, 0.35)',
                },
                warning: {
                    foreground: palette.warning[500],
                    background: 'rgba(245, 158, 11, 0.18)',
                    border: 'rgba(245, 158, 11, 0.35)',
                },
                info: {
                    foreground: palette.info[500],
                    background: 'rgba(59, 130, 246, 0.16)',
                    border: 'rgba(59, 130, 246, 0.35)',
                },
            },
            accent: {
                default: palette.accent[500],
                emphasis: palette.accent[600],
                muted: 'rgba(99, 102, 241, 0.15)',
            },
            overlay: {
                scrim: 'rgba(15, 23, 42, 0.52)',
            },
        },
        effects: {
            backdrop: 'blur(12px)',
        },
    }),
    synthwave: createTheme('synthwave', 'Synthwave', {
        meta: {
            colorScheme: 'dark',
            description: 'High-contrast neon palette inspired by synthwave visuals',
        },
        layout: {
            container: {
                padding: space.lg,
                radius: radii.lg,
            },
            stack: {
                gap: space.md,
                formGap: space.sm,
                sectionGap: space.lg,
            },
        },
        shadows: {
            button: palette.synthwave.glow,
            md: '0 20px 50px rgba(64, 0, 128, 0.45)',
            focus: '0 0 0 2px rgba(255, 106, 193, 0.45)',
        },
        colors: {
            background: {
                canvas: palette.synthwave.backgroundCanvas,
                surface: palette.synthwave.backgroundSurface,
                raised: palette.synthwave.backgroundRaised,
                sunken: '#080014',
                overlay: 'rgba(10, 0, 30, 0.85)',
            },
            text: {
                primary: palette.synthwave.textPrimary,
                muted: palette.synthwave.textMuted,
                subtle: 'rgba(248, 231, 255, 0.5)',
                inverted: '#0f0221',
                accent: palette.synthwave.accent,
            },
            border: {
                subtle: palette.synthwave.border,
                strong: 'rgba(255, 106, 193, 0.6)',
                focus: palette.synthwave.accent,
            },
            interactive: {
                primary: {
                    background: palette.synthwave.accent,
                    foreground: '#160536',
                    hover: palette.synthwave.accentHover,
                    active: palette.synthwave.accentActive,
                    border: 'transparent',
                    shadow: palette.synthwave.glow,
                },
                secondary: {
                    background: 'rgba(255, 106, 193, 0.16)',
                    foreground: palette.synthwave.accent,
                    hover: 'rgba(255, 106, 193, 0.24)',
                    active: 'rgba(255, 106, 193, 0.32)',
                    border: 'rgba(255, 106, 193, 0.4)',
                    shadow: palette.synthwave.glow,
                },
                ghost: {
                    background: 'transparent',
                    foreground: palette.synthwave.textPrimary,
                    hover: 'rgba(255, 106, 193, 0.18)',
                    active: 'rgba(255, 106, 193, 0.28)',
                    border: 'transparent',
                    shadow: palette.synthwave.glow,
                },
            },
            input: {
                background: 'rgba(12, 2, 30, 0.8)',
                foreground: palette.synthwave.textPrimary,
                placeholder: 'rgba(248, 231, 255, 0.5)',
                border: palette.synthwave.border,
                focus: palette.synthwave.accent,
            },
            status: {
                success: {
                    foreground: '#6fffe9',
                    background: 'rgba(111, 255, 233, 0.18)',
                    border: 'rgba(111, 255, 233, 0.4)',
                },
                danger: {
                    foreground: '#ff8ba7',
                    background: 'rgba(255, 139, 167, 0.2)',
                    border: 'rgba(255, 139, 167, 0.4)',
                },
                warning: {
                    foreground: '#ffd166',
                    background: 'rgba(255, 209, 102, 0.2)',
                    border: 'rgba(255, 209, 102, 0.45)',
                },
                info: {
                    foreground: '#72ddf7',
                    background: 'rgba(114, 221, 247, 0.2)',
                    border: 'rgba(114, 221, 247, 0.45)',
                },
            },
            accent: {
                default: palette.synthwave.accent,
                emphasis: palette.synthwave.accentHover,
                muted: 'rgba(255, 106, 193, 0.2)',
            },
            overlay: {
                scrim: 'rgba(15, 0, 32, 0.65)',
            },
        },
        effects: {
            backdrop: 'blur(10px)',
        },
    }),
};

const flattenKeys = (
    value: unknown,
    path: string[] = [],
    result: Record<string, string> = {},
): Record<string, string> => {
    if (isObject(value)) {
        Object.entries(value).forEach(([key, nested]) => {
            flattenKeys(nested, [...path, key], result);
        });
    } else if (Array.isArray(value)) {
        value.forEach((nested, index) => flattenKeys(nested, [...path, String(index)], result));
    } else if (value !== undefined && value !== null) {
        const joined = path
            .map(segment => segment.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`))
            .join('-');
        result[joined] = String(value);
    }

    return result;
};

const buildThemeVariables = (theme: ThemeDefinition): Record<string, string> => {
    const variables: Record<string, string> = {};

    const applySection = (section: unknown, prefix: string[]) => {
        const flat = flattenKeys(section, prefix);
        Object.entries(flat).forEach(([key, value]) => {
            variables[`iris-${key}`] = value;
        });
    };

    applySection(theme.colors, ['color']);
    applySection(theme.typography, ['typography']);
    applySection(theme.space, ['space']);
    applySection(theme.radii, ['radius']);
    applySection(theme.shadows, ['shadow']);
    applySection(theme.transitions, ['transition']);
    applySection(theme.layout, ['layout']);
    applySection(theme.effects, ['effect']);

    variables['iris-meta-color-scheme'] = theme.meta.colorScheme;

    const legacyMappings: Record<string, string> = {
        'theme-background': variables['iris-color-background-canvas'],
        'theme-foreground': variables['iris-color-text-primary'],
        'theme-card-background': variables['iris-color-background-surface'],
        'theme-border': variables['iris-color-border-subtle'],
        'theme-button-background': variables['iris-color-interactive-primary-background'],
        'theme-button-foreground': variables['iris-color-interactive-primary-foreground'],
        'theme-button-hover': variables['iris-color-interactive-primary-hover'],
        'theme-button-active': variables['iris-color-interactive-primary-active'],
        'theme-input-background': variables['iris-color-input-background'],
        'theme-input-foreground': variables['iris-color-input-foreground'],
        'theme-input-border': variables['iris-color-input-border'],
        'theme-input-focus': variables['iris-color-input-focus'],
        'theme-success': variables['iris-color-status-success-foreground'],
        'theme-error': variables['iris-color-status-danger-foreground'],
        'theme-info': variables['iris-color-status-info-foreground'],
        'theme-container-padding': variables['iris-layout-container-padding'],
        'theme-container-radius': variables['iris-layout-container-radius'],
        'theme-element-spacing': variables['iris-layout-stack-gap'],
        'theme-form-spacing': variables['iris-layout-stack-form-gap'],
        'theme-box-shadow': variables['iris-shadow-md'],
        'theme-backdrop': variables['iris-effect-backdrop'],
        'theme-transition': variables['iris-transition-base'],
        'theme-font-family': variables['iris-typography-font-family'],
        'theme-font-size': variables['iris-typography-sizes-md'],
        'theme-font-weight': variables['iris-typography-weights-medium'],
        'theme-line-height': variables['iris-typography-line-heights-normal'],
        'theme-muted': variables['iris-color-text-muted'],
    };

    Object.entries(legacyMappings).forEach(([legacyKey, value]) => {
        if (value !== undefined) {
            variables[legacyKey] = value;
        }
    });

    return variables;
};

const renderCSSVariables = (variables: Record<string, string>): string =>
    Object.entries(variables)
        .map(([key, value]) => `    --${key}: ${value};`)
        .join('\n');

export class ThemeManager {
    public getCurrentTheme(): ThemeName {
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        const theme = config.get<ThemeName>('theme', 'vscode');
        return theme in themeRegistry ? theme : 'vscode';
    }

    public getTheme(themeName?: ThemeName): ThemeDefinition {
        const resolved = themeName ?? this.getCurrentTheme();
        return themeRegistry[resolved];
    }

    public getThemeCSS(themeName?: ThemeName): string {
        const theme = this.getTheme(themeName);
        const variables = buildThemeVariables(theme);
        const cssVariables = renderCSSVariables(variables);

        return `:root {\n${cssVariables}\n}`;
    }

    public getAvailableThemes(): ThemeDefinition[] {
        return Object.values(themeRegistry);
    }

    public themeExists(themeName: string): themeName is ThemeName {
        return themeName in themeRegistry;
    }
}

export const getThemeRegistry = (): Record<ThemeName, ThemeDefinition> => ({ ...themeRegistry });
