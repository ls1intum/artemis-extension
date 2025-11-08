import * as vscode from 'vscode';

export type ThemeType = 'vscode' | 'modern' | 'synthwave';

export type ThemeListener = (theme: SemanticTheme) => void;

export interface TypographyScale {
    family: string;
    mono: string;
    size: {
        xs: string;
        sm: string;
        md: string;
        lg: string;
        xl: string;
    };
    weight: {
        regular: number;
        medium: number;
        semibold: number;
    };
    lineHeight: {
        tight: string;
        base: string;
        relaxed: string;
    };
}

export interface SpacingScale {
    none: string;
    xxs: string;
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
    xxl: string;
}

export interface RadiusScale {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    pill: string;
}

export interface ShadowScale {
    none: string;
    xs: string;
    sm: string;
    md: string;
    lg: string;
}

export interface EffectScale {
    focusHalo: string;
    transition: string;
}

export interface ThemePrimitives {
    space: SpacingScale;
    radii: RadiusScale;
    typography: TypographyScale;
    shadows: ShadowScale;
    effects: EffectScale;
}

export interface ThemeColorTokens {
    background: {
        canvas: string;
        surface: string;
        surfaceAlt: string;
        raised: string;
        overlay: string;
    };
    text: {
        primary: string;
        secondary: string;
        muted: string;
        inverted: string;
        accent: string;
    };
    border: {
        subtle: string;
        strong: string;
        focus: string;
        accent: string;
    };
    action: {
        primary: {
            bg: string;
            fg: string;
            hover: string;
            active: string;
        };
        secondary: {
            bg: string;
            fg: string;
            border: string;
            hover: string;
            active: string;
        };
        ghost: {
            fg: string;
            hoverBg: string;
            activeBg: string;
        };
        link?: {
            fg: string;
            hover: string;
        };
    };
    input: {
        background: string;
        foreground: string;
        border: string;
        focus: string;
        placeholder: string;
    };
    status: {
        success: {
            bg: string;
            fg: string;
            border: string;
        };
        error: {
            bg: string;
            fg: string;
            border: string;
        };
        info: {
            bg: string;
            fg: string;
            border: string;
        };
        warning: {
            bg: string;
            fg: string;
            border: string;
        };
    };
    code: {
        bg: string;
        fg: string;
    };
}

export interface SemanticTheme {
    name: ThemeType;
    colors: ThemeColorTokens;
    typography: TypographyScale;
    space: SpacingScale;
    radii: RadiusScale;
    shadows: ShadowScale;
    effects: EffectScale & { focusRing: string };
    background: ThemeColorTokens['background'];
    text: ThemeColorTokens['text'];
    border: ThemeColorTokens['border'];
    action: ThemeColorTokens['action'];
    input: ThemeColorTokens['input'];
    status: ThemeColorTokens['status'];
    code: ThemeColorTokens['code'];
}

interface ThemeConfigInput {
    name: ThemeType;
    colors: ThemeColorTokens;
    typography?: Partial<TypographyScale>;
    space?: Partial<SpacingScale>;
    radii?: Partial<RadiusScale>;
    shadows?: Partial<ShadowScale>;
    effects?: Partial<EffectScale> & { focusHalo?: string };
}

const baseTypography: TypographyScale = {
    family: "var(--vscode-font-family, 'Inter', 'Segoe UI', sans-serif)",
    mono: "var(--vscode-terminal-fontFamily, 'JetBrains Mono', 'Fira Code', monospace)",
    size: {
        xs: '11px',
        sm: '13px',
        md: '14px',
        lg: '16px',
        xl: '18px',
    },
    weight: {
        regular: 400,
        medium: 500,
        semibold: 600,
    },
    lineHeight: {
        tight: '1.3',
        base: '1.5',
        relaxed: '1.7',
    },
};

const baseSpace: SpacingScale = {
    none: '0px',
    xxs: '2px',
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
    xxl: '32px',
};

const baseRadii: RadiusScale = {
    xs: '2px',
    sm: '4px',
    md: '8px',
    lg: '12px',
    pill: '999px',
};

const baseShadows: ShadowScale = {
    none: 'none',
    xs: '0 1px 2px rgba(15, 23, 42, 0.08)',
    sm: '0 2px 6px rgba(15, 23, 42, 0.12)',
    md: '0 8px 16px rgba(15, 23, 42, 0.16)',
    lg: '0 20px 40px rgba(15, 23, 42, 0.18)',
};

const baseEffects: EffectScale = {
    focusHalo: 'rgba(59, 130, 246, 0.3)',
    transition: '150ms ease',
};

const basePrimitives: ThemePrimitives = {
    space: baseSpace,
    radii: baseRadii,
    typography: baseTypography,
    shadows: baseShadows,
    effects: baseEffects,
};

const toRgbString = (value: string, fallback: string = '0, 122, 255'): string => {
    const color = value.trim();
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) {
        const hex = color.substring(1);
        const chunk = hex.length === 3 ? hex.split('').map(char => char + char).join('') : hex;
        const r = parseInt(chunk.substring(0, 2), 16);
        const g = parseInt(chunk.substring(2, 4), 16);
        const b = parseInt(chunk.substring(4, 6), 16);
        return `${r}, ${g}, ${b}`;
    }

    const rgbMatch = color.match(/rgba?\(([^)]+)\)/i);
    if (rgbMatch) {
        const parts = rgbMatch[1]
            .split(',')
            .map(part => part.trim())
            .slice(0, 3);
        if (parts.length === 3) {
            return parts.join(', ');
        }
    }

    return fallback;
};

export interface FocusRingOptions {
    inset?: boolean;
    halo?: string;
    thickness?: number;
    spread?: number;
}

export const focusRingStyles = (color: string, halo: string, options: FocusRingOptions = {}): string => {
    const thickness = options.thickness ?? 1;
    const spread = options.spread ?? 4;
    const prefix = options.inset ? 'inset ' : '';
    return `${prefix}0 0 0 ${thickness}px ${color}, ${prefix}0 0 0 ${spread}px ${halo}`;
};

const transitionProperties = ['background-color', 'color', 'border-color', 'box-shadow', 'transform'];

export const transitionStyles = (transition: string, properties: string[] = transitionProperties): string =>
    properties.map(property => `${property} ${transition}`).join(', ');

const createTheme = ({
    name,
    colors,
    typography,
    space,
    radii,
    shadows,
    effects,
}: ThemeConfigInput): SemanticTheme => {
    const mergedTypography = {
        ...baseTypography,
        ...typography,
        size: {
            ...baseTypography.size,
            ...typography?.size,
        },
        weight: {
            ...baseTypography.weight,
            ...typography?.weight,
        },
        lineHeight: {
            ...baseTypography.lineHeight,
            ...typography?.lineHeight,
        },
    };

    const mergedSpace = { ...baseSpace, ...space };
    const mergedRadii = { ...baseRadii, ...radii };
    const mergedShadows = { ...baseShadows, ...shadows };
    const mergedEffects = { ...baseEffects, ...effects };
    const focusHalo = effects?.focusHalo ?? mergedEffects.focusHalo;
    const focusRing = focusRingStyles(colors.border.focus, focusHalo);

    return {
        name,
        colors,
        typography: mergedTypography,
        space: mergedSpace,
        radii: mergedRadii,
        shadows: mergedShadows,
        effects: {
            ...mergedEffects,
            focusRing,
        },
        background: colors.background,
        text: colors.text,
        border: colors.border,
        action: colors.action,
        input: colors.input,
        status: colors.status,
        code: colors.code,
    };
};

const vscodeTheme = createTheme({
    name: 'vscode',
    colors: {
        background: {
            canvas: 'var(--vscode-editor-background)',
            surface: 'var(--vscode-sideBar-background)',
            surfaceAlt: 'var(--vscode-editorWidget-background)',
            raised: 'var(--vscode-editor-background)',
            overlay: 'rgba(0, 0, 0, 0.45)',
        },
        text: {
            primary: 'var(--vscode-foreground)',
            secondary: 'var(--vscode-descriptionForeground)',
            muted: 'var(--vscode-descriptionForeground)',
            inverted: 'var(--vscode-editor-background)',
            accent: 'var(--vscode-textLink-activeForeground)',
        },
        border: {
            subtle: 'var(--vscode-sideBar-border)',
            strong: 'var(--vscode-contrastBorder, var(--vscode-sideBar-border))',
            focus: 'var(--vscode-focusBorder)',
            accent: 'var(--vscode-textLink-activeForeground)',
        },
        action: {
            primary: {
                bg: 'var(--vscode-button-background)',
                fg: 'var(--vscode-button-foreground)',
                hover: 'var(--vscode-button-hoverBackground)',
                active: 'var(--vscode-button-hoverBackground)',
            },
            secondary: {
                bg: 'rgba(255, 255, 255, 0.02)',
                fg: 'var(--vscode-foreground)',
                border: 'var(--vscode-sideBar-border)',
                hover: 'var(--vscode-list-hoverBackground)',
                active: 'var(--vscode-list-activeSelectionBackground)',
            },
            ghost: {
                fg: 'var(--vscode-foreground)',
                hoverBg: 'var(--vscode-list-hoverBackground)',
                activeBg: 'var(--vscode-list-activeSelectionBackground)',
            },
            link: {
                fg: 'var(--vscode-textLink-foreground)',
                hover: 'var(--vscode-textLink-activeForeground)',
            },
        },
        input: {
            background: 'var(--vscode-input-background)',
            foreground: 'var(--vscode-input-foreground)',
            border: 'var(--vscode-input-border)',
            focus: 'var(--vscode-focusBorder)',
            placeholder: 'var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground))',
        },
        status: {
            success: {
                bg: 'rgba(38, 166, 91, 0.12)',
                fg: 'var(--vscode-testing-iconPassed)',
                border: 'rgba(38, 166, 91, 0.4)',
            },
            error: {
                bg: 'rgba(229, 83, 83, 0.12)',
                fg: 'var(--vscode-problemsErrorIcon-foreground)',
                border: 'rgba(229, 83, 83, 0.4)',
            },
            info: {
                bg: 'rgba(71, 155, 255, 0.12)',
                fg: 'var(--vscode-problemsInfoIcon-foreground)',
                border: 'rgba(71, 155, 255, 0.4)',
            },
            warning: {
                bg: 'rgba(255, 179, 71, 0.12)',
                fg: 'var(--vscode-problemsWarningIcon-foreground)',
                border: 'rgba(255, 179, 71, 0.4)',
            },
        },
        code: {
            bg: 'var(--vscode-editor-inactiveSelectionBackground)',
            fg: 'var(--vscode-editor-foreground)',
        },
    },
    effects: {
        focusHalo: 'rgba(56, 139, 253, 0.35)',
        transition: '0.12s ease-in-out',
    },
});

const modernTheme = createTheme({
    name: 'modern',
    colors: {
        background: {
            canvas: '#f5f7fb',
            surface: '#ffffff',
            surfaceAlt: '#eef2ff',
            raised: '#ffffff',
            overlay: 'rgba(15, 23, 42, 0.4)',
        },
        text: {
            primary: '#0f172a',
            secondary: '#334155',
            muted: '#64748b',
            inverted: '#ffffff',
            accent: '#2563eb',
        },
        border: {
            subtle: '#e2e8f0',
            strong: '#cbd5f5',
            focus: '#2563eb',
            accent: '#2563eb',
        },
        action: {
            primary: {
                bg: '#2563eb',
                fg: '#ffffff',
                hover: '#1d4ed8',
                active: '#1e40af',
            },
            secondary: {
                bg: '#e2e8f0',
                fg: '#0f172a',
                border: '#cbd5f5',
                hover: '#dbeafe',
                active: '#bfdbfe',
            },
            ghost: {
                fg: '#2563eb',
                hoverBg: 'rgba(37, 99, 235, 0.12)',
                activeBg: 'rgba(37, 99, 235, 0.2)',
            },
            link: {
                fg: '#2563eb',
                hover: '#1d4ed8',
            },
        },
        input: {
            background: '#ffffff',
            foreground: '#0f172a',
            border: '#cbd5f5',
            focus: '#2563eb',
            placeholder: '#94a3b8',
        },
        status: {
            success: {
                bg: '#dcfce7',
                fg: '#166534',
                border: '#4ade80',
            },
            error: {
                bg: '#fee2e2',
                fg: '#b91c1c',
                border: '#f87171',
            },
            info: {
                bg: '#e0f2fe',
                fg: '#1d4ed8',
                border: '#38bdf8',
            },
            warning: {
                bg: '#fef3c7',
                fg: '#b45309',
                border: '#facc15',
            },
        },
        code: {
            bg: '#0f172a0d',
            fg: '#1e293b',
        },
    },
    typography: {
        size: {
            xs: '11px',
            sm: '13px',
            md: '15px',
            lg: '18px',
            xl: '20px',
        },
    },
    effects: {
        focusHalo: 'rgba(37, 99, 235, 0.25)',
        transition: '0.16s ease-in-out',
    },
    shadows: {
        sm: '0 4px 16px rgba(15, 23, 42, 0.12)',
        md: '0 8px 24px rgba(15, 23, 42, 0.16)',
        lg: '0 20px 40px rgba(15, 23, 42, 0.2)',
    },
    radii: {
        sm: '6px',
        md: '10px',
        lg: '16px',
    },
});

const synthwaveTheme = createTheme({
    name: 'synthwave',
    colors: {
        background: {
            canvas: '#1a103d',
            surface: '#221751',
            surfaceAlt: '#2a1f5f',
            raised: '#311d6e',
            overlay: 'rgba(255, 0, 110, 0.3)',
        },
        text: {
            primary: '#fdf2ff',
            secondary: '#e4d9ff',
            muted: '#a78bfa',
            inverted: '#1a103d',
            accent: '#ff71c1',
        },
        border: {
            subtle: 'rgba(244, 114, 182, 0.35)',
            strong: 'rgba(244, 114, 182, 0.55)',
            focus: '#ff71c1',
            accent: '#ff71c1',
        },
        action: {
            primary: {
                bg: '#ff71c1',
                fg: '#1a103d',
                hover: '#ff85d6',
                active: '#ff9deb',
            },
            secondary: {
                bg: 'rgba(255, 113, 193, 0.14)',
                fg: '#fdf2ff',
                border: 'rgba(255, 113, 193, 0.45)',
                hover: 'rgba(255, 113, 193, 0.22)',
                active: 'rgba(255, 113, 193, 0.3)',
            },
            ghost: {
                fg: '#ff71c1',
                hoverBg: 'rgba(255, 113, 193, 0.16)',
                activeBg: 'rgba(255, 113, 193, 0.24)',
            },
            link: {
                fg: '#f472b6',
                hover: '#fb7185',
            },
        },
        input: {
            background: '#2a1f5f',
            foreground: '#fdf2ff',
            border: 'rgba(244, 114, 182, 0.4)',
            focus: '#ff71c1',
            placeholder: '#c4b5fd',
        },
        status: {
            success: {
                bg: 'rgba(16, 185, 129, 0.2)',
                fg: '#34d399',
                border: 'rgba(16, 185, 129, 0.45)',
            },
            error: {
                bg: 'rgba(248, 113, 113, 0.2)',
                fg: '#fca5a5',
                border: 'rgba(248, 113, 113, 0.45)',
            },
            info: {
                bg: 'rgba(59, 130, 246, 0.22)',
                fg: '#60a5fa',
                border: 'rgba(59, 130, 246, 0.45)',
            },
            warning: {
                bg: 'rgba(251, 191, 36, 0.22)',
                fg: '#fbbf24',
                border: 'rgba(251, 191, 36, 0.45)',
            },
        },
        code: {
            bg: 'rgba(30, 64, 175, 0.28)',
            fg: '#fdf2ff',
        },
    },
    effects: {
        focusHalo: 'rgba(255, 113, 193, 0.35)',
        transition: '0.18s ease-in-out',
    },
    shadows: {
        sm: '0 4px 16px rgba(255, 113, 193, 0.25)',
        md: '0 12px 24px rgba(255, 113, 193, 0.3)',
        lg: '0 24px 48px rgba(255, 113, 193, 0.35)',
    },
    radii: {
        sm: '6px',
        md: '12px',
        lg: '18px',
    },
});

const themeRegistry: Record<ThemeType, SemanticTheme> = {
    vscode: vscodeTheme,
    modern: modernTheme,
    synthwave: synthwaveTheme,
};

class ThemeStore {
    private _listeners = new Set<ThemeListener>();
    private _theme: SemanticTheme;

    constructor(initialTheme: SemanticTheme) {
        this._theme = initialTheme;
    }

    public getTheme(): SemanticTheme {
        return this._theme;
    }

    public setTheme(theme: SemanticTheme): void {
        this._theme = theme;
        this._listeners.forEach(listener => listener(theme));
    }

    public subscribe(listener: ThemeListener): () => void {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }
}

export const primitives = basePrimitives;

const toCssVariables = (theme: SemanticTheme): Record<string, string> => {
    const focusRgb = toRgbString(theme.border.focus);

    const vars: Record<string, string> = {
        '--iris-bg-canvas': theme.background.canvas,
        '--iris-bg-surface': theme.background.surface,
        '--iris-bg-surface-alt': theme.background.surfaceAlt,
        '--iris-bg-elevated': theme.background.raised,
        '--iris-bg-overlay': theme.background.overlay,
        '--iris-text-primary': theme.text.primary,
        '--iris-text-secondary': theme.text.secondary,
        '--iris-text-muted': theme.text.muted,
        '--iris-text-inverted': theme.text.inverted,
        '--iris-text-accent': theme.text.accent,
        '--iris-border-subtle': theme.border.subtle,
        '--iris-border-strong': theme.border.strong,
        '--iris-border-focus': theme.border.focus,
        '--iris-border-accent': theme.border.accent,
        '--iris-action-primary-bg': theme.action.primary.bg,
        '--iris-action-primary-fg': theme.action.primary.fg,
        '--iris-action-primary-hover': theme.action.primary.hover,
        '--iris-action-primary-active': theme.action.primary.active,
        '--iris-action-secondary-bg': theme.action.secondary.bg,
        '--iris-action-secondary-fg': theme.action.secondary.fg,
        '--iris-action-secondary-border': theme.action.secondary.border,
        '--iris-action-secondary-hover': theme.action.secondary.hover,
        '--iris-action-secondary-active': theme.action.secondary.active,
        '--iris-action-ghost-fg': theme.action.ghost.fg,
        '--iris-action-ghost-hover': theme.action.ghost.hoverBg,
        '--iris-action-ghost-active': theme.action.ghost.activeBg,
        '--iris-link-fg': theme.action.link?.fg ?? theme.text.accent,
        '--iris-link-hover': theme.action.link?.hover ?? theme.action.link?.fg ?? theme.text.accent,
        '--iris-input-bg': theme.input.background,
        '--iris-input-fg': theme.input.foreground,
        '--iris-input-border': theme.input.border,
        '--iris-input-focus': theme.input.focus,
        '--iris-input-placeholder': theme.input.placeholder,
        '--iris-status-success-bg': theme.status.success.bg,
        '--iris-status-success-fg': theme.status.success.fg,
        '--iris-status-success-border': theme.status.success.border,
        '--iris-status-error-bg': theme.status.error.bg,
        '--iris-status-error-fg': theme.status.error.fg,
        '--iris-status-error-border': theme.status.error.border,
        '--iris-status-info-bg': theme.status.info.bg,
        '--iris-status-info-fg': theme.status.info.fg,
        '--iris-status-info-border': theme.status.info.border,
        '--iris-status-warning-bg': theme.status.warning.bg,
        '--iris-status-warning-fg': theme.status.warning.fg,
        '--iris-status-warning-border': theme.status.warning.border,
        '--iris-code-bg': theme.code.bg,
        '--iris-code-fg': theme.code.fg,
        '--iris-shadow-xs': theme.shadows.xs,
        '--iris-shadow-sm': theme.shadows.sm,
        '--iris-shadow-md': theme.shadows.md,
        '--iris-shadow-lg': theme.shadows.lg,
        '--iris-radius-xs': theme.radii.xs,
        '--iris-radius-sm': theme.radii.sm,
        '--iris-radius-md': theme.radii.md,
        '--iris-radius-lg': theme.radii.lg,
        '--iris-radius-pill': theme.radii.pill,
        '--iris-space-none': theme.space.none,
        '--iris-space-xxs': theme.space.xxs,
        '--iris-space-xs': theme.space.xs,
        '--iris-space-sm': theme.space.sm,
        '--iris-space-md': theme.space.md,
        '--iris-space-lg': theme.space.lg,
        '--iris-space-xl': theme.space.xl,
        '--iris-space-xxl': theme.space.xxl,
        '--iris-font-family': theme.typography.family,
        '--iris-font-family-mono': theme.typography.mono,
        '--iris-font-size-xs': theme.typography.size.xs,
        '--iris-font-size-sm': theme.typography.size.sm,
        '--iris-font-size-md': theme.typography.size.md,
        '--iris-font-size-lg': theme.typography.size.lg,
        '--iris-font-size-xl': theme.typography.size.xl,
        '--iris-font-weight-regular': `${theme.typography.weight.regular}`,
        '--iris-font-weight-medium': `${theme.typography.weight.medium}`,
        '--iris-font-weight-semibold': `${theme.typography.weight.semibold}`,
        '--iris-line-height-tight': theme.typography.lineHeight.tight,
        '--iris-line-height-base': theme.typography.lineHeight.base,
        '--iris-line-height-relaxed': theme.typography.lineHeight.relaxed,
        '--iris-focus-ring': theme.effects.focusRing,
        '--iris-transition': transitionStyles(theme.effects.transition),
        '--iris-border-focus-rgb': focusRgb,
    };

    // Legacy tokens for existing stylesheets (to be migrated gradually)
    vars['--theme-background'] = theme.background.canvas;
    vars['--theme-foreground'] = theme.text.primary;
    vars['--theme-card-background'] = theme.background.surface;
    vars['--theme-border'] = theme.border.subtle;
    vars['--theme-border-color'] = theme.border.subtle;
    vars['--theme-secondary-background'] = theme.background.surfaceAlt;
    vars['--theme-tertiary-background'] = theme.background.raised;
    vars['--theme-button-background'] = theme.action.primary.bg;
    vars['--theme-button-foreground'] = theme.action.primary.fg;
    vars['--theme-button-hover'] = theme.action.primary.hover;
    vars['--theme-button-active'] = theme.action.primary.active;
    vars['--theme-button-shadow'] = theme.shadows.xs;
    vars['--theme-button-shadow-hover'] = theme.shadows.sm;
    vars['--theme-input-background'] = theme.input.background;
    vars['--theme-input-foreground'] = theme.input.foreground;
    vars['--theme-input-border'] = theme.input.border;
    vars['--theme-input-focus'] = theme.input.focus;
    vars['--theme-success'] = theme.status.success.fg;
    vars['--theme-error'] = theme.status.error.fg;
    vars['--theme-info'] = theme.status.info.fg;
    vars['--theme-warning'] = theme.status.warning.fg;
    vars['--theme-success-background'] = theme.status.success.bg;
    vars['--theme-success-border'] = theme.status.success.border;
    vars['--theme-success-foreground'] = theme.status.success.fg;
    vars['--theme-error-background'] = theme.status.error.bg;
    vars['--theme-error-border'] = theme.status.error.border;
    vars['--theme-error-foreground'] = theme.status.error.fg;
    vars['--theme-info-background'] = theme.status.info.bg;
    vars['--theme-info-border'] = theme.status.info.border;
    vars['--theme-info-foreground'] = theme.status.info.fg;
    vars['--theme-warning-background'] = theme.status.warning.bg;
    vars['--theme-warning-border'] = theme.status.warning.border;
    vars['--theme-warning-foreground'] = theme.status.warning.fg;
    vars['--theme-code-background'] = theme.code.bg;
    vars['--theme-code-foreground'] = theme.code.fg;
    vars['--theme-container-padding'] = theme.space.lg;
    vars['--theme-container-radius'] = theme.radii.md;
    vars['--theme-element-spacing'] = theme.space.lg;
    vars['--theme-form-spacing'] = theme.space.md;
    vars['--theme-box-shadow'] = theme.shadows.sm;
    vars['--theme-backdrop'] = 'none';
    vars['--theme-transition'] = transitionStyles(theme.effects.transition);
    vars['--theme-font-family'] = theme.typography.family;
    vars['--theme-font-size'] = theme.typography.size.md;
    vars['--theme-font-weight'] = `${theme.typography.weight.medium}`;
    vars['--theme-line-height'] = theme.typography.lineHeight.base;
    vars['--theme-muted'] = theme.text.muted;
    vars['--theme-muted-color'] = theme.text.muted;
    vars['--theme-muted-foreground'] = theme.text.muted;
    vars['--theme-primary-color'] = theme.border.focus;
    vars['--theme-primary-color-rgb'] = focusRgb;
    vars['--theme-accent'] = theme.text.accent;
    vars['--theme-accent-background'] = theme.action.secondary.bg;
    vars['--theme-accent-foreground'] = theme.action.secondary.fg;
    vars['--theme-link-color'] = vars['--iris-link-fg'];
    vars['--theme-link-hover'] = vars['--iris-link-hover'];
    vars['--theme-hover-background'] = theme.action.secondary.hover;

    return vars;
};

const cssFromVariables = (variables: Record<string, string>): string => {
    const entries = Object.entries(variables)
        .map(([key, value]) => `        ${key}: ${value};`)
        .join('\n');

    return `:root {\n${entries}\n    }`;
};

export const focusRing = (theme: SemanticTheme): string => theme.effects.focusRing;

export class ThemeManager {
    private static store = new ThemeStore(themeRegistry.vscode);

    public getCurrentTheme(): ThemeType {
        const config = vscode.workspace.getConfiguration('artemis');
        const rawTheme = config.get<ThemeType>('theme', 'vscode');
        return themeRegistry[rawTheme] ? rawTheme : 'vscode';
    }

    public getTheme(themeType?: ThemeType): SemanticTheme {
        const name = themeType ?? this.getCurrentTheme();
        const theme = themeRegistry[name];
        if (!theme) {
            return themeRegistry.vscode;
        }
        return theme;
    }

    public getThemeCSS(themeType?: ThemeType): string {
        const theme = this.getTheme(themeType);
        ThemeManager.store.setTheme(theme);
        const cssVariables = toCssVariables(theme);
        return cssFromVariables(cssVariables);
    }

    public getAvailableThemes(): SemanticTheme[] {
        return Object.values(themeRegistry);
    }

    public themeExists(themeType: string): themeType is ThemeType {
        return Boolean(themeRegistry[themeType as ThemeType]);
    }

    public getThemeStore(): ThemeStore {
        const currentTheme = this.getTheme();
        ThemeManager.store.setTheme(currentTheme);
        return ThemeManager.store;
    }

    public setTheme(themeType: ThemeType): void {
        const config = vscode.workspace.getConfiguration('artemis');
        config.update('theme', themeType, vscode.ConfigurationTarget.Global);
        const theme = this.getTheme(themeType);
        ThemeManager.store.setTheme(theme);
    }

    public getThemeBootstrapScript(themeType?: ThemeType): string {
        const theme = this.getTheme(themeType);
        const cssVariables = toCssVariables(theme);
        const payload = {
            name: theme.name,
            background: theme.background,
            text: theme.text,
            border: theme.border,
            action: theme.action,
            input: theme.input,
            status: theme.status,
            space: theme.space,
            radii: theme.radii,
            typography: theme.typography,
            shadows: theme.shadows,
            effects: {
                transition: transitionStyles(theme.effects.transition),
                focusRing: theme.effects.focusRing,
            },
        };

        return `(() => {\n` +
            `    const theme = ${JSON.stringify(payload)};\n` +
            `    const cssVars = ${JSON.stringify(cssVariables)};\n` +
            `    const listeners = new Set();\n` +
            `    const apply = (vars) => {\n` +
            `        const root = document.documentElement;\n` +
            `        Object.entries(vars).forEach(([key, value]) => root.style.setProperty(key, value));\n` +
            `    };\n` +
            `    apply(cssVars);\n` +
            `    const api = {\n` +
            `        getTheme: () => theme,\n` +
            `        subscribe: (listener) => {\n` +
            `            listeners.add(listener);\n` +
            `            return () => listeners.delete(listener);\n` +
            `        },\n` +
            `        applyTheme: (vars) => apply(vars),\n` +
            `        setTheme: (payload) => {\n` +
            `            if (!payload) {\n` +
            `                return;\n` +
            `            }\n` +
            `            if (payload.cssVariables) {\n` +
            `                apply(payload.cssVariables);\n` +
            `            }\n` +
            `            if (payload.theme) {\n` +
            `                Object.assign(theme, payload.theme);\n` +
            `            }\n` +
            `            listeners.forEach(listener => listener(theme));\n` +
            `        }\n` +
            `    };\n` +
            `    window.irisTheme = api;\n` +
            `})();`;
    }
}

export const themes = themeRegistry;
