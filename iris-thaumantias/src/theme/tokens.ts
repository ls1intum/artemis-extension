import { ThemePalette, ThemePrimitives } from './types';

const neutral: ThemePalette['neutral'] = {
    '0': '#ffffff',
    '50': '#f8fafc',
    '100': '#f1f5f9',
    '200': '#e2e8f0',
    '300': '#cbd5f5',
    '400': '#94a3b8',
    '500': '#64748b',
    '600': '#475569',
    '700': '#334155',
    '800': '#1e293b',
    '900': '#0f172a',
    '950': '#020617',
};

const iris: ThemePalette['iris'] = {
    '50': '#eef2ff',
    '100': '#e0e7ff',
    '200': '#c7d2fe',
    '300': '#a5b4fc',
    '400': '#818cf8',
    '500': '#6366f1',
    '600': '#4f46e5',
    '700': '#4338ca',
    '800': '#3730a3',
    '900': '#312e81',
};

const accent: ThemePalette['accent'] = {
    '50': '#ecfeff',
    '100': '#cffafe',
    '200': '#a5f3fc',
    '300': '#67e8f9',
    '400': '#22d3ee',
    '500': '#06b6d4',
    '600': '#0891b2',
    '700': '#0e7490',
    '800': '#155e75',
    '900': '#164e63',
};

const state: ThemePalette['state'] = {
    success: '#3fb950',
    warning: '#f59e0b',
    danger: '#ef4444',
    info: '#3b82f6',
};

export const palette: ThemePalette = {
    neutral,
    iris,
    accent,
    state,
};

const fontSizes = {
    xs: '12px',
    sm: '13px',
    md: '14px',
    lg: '16px',
    xl: '18px',
};

const fontWeights = {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
};

const lineHeights = {
    tight: '1.3',
    standard: '1.5',
    relaxed: '1.7',
};

const space = {
    none: '0px',
    '3xs': '2px',
    '2xs': '4px',
    xs: '8px',
    sm: '12px',
    md: '16px',
    lg: '24px',
    xl: '32px',
    '2xl': '40px',
};

const radii = {
    none: '0px',
    xs: '4px',
    sm: '6px',
    md: '8px',
    lg: '12px',
    pill: '999px',
};

const shadows = {
    none: 'none',
    xs: '0 1px 1px rgba(15, 23, 42, 0.08)',
    sm: '0 1px 2px rgba(15, 23, 42, 0.12)',
    md: '0 6px 16px rgba(15, 23, 42, 0.16)',
    lg: '0 12px 32px rgba(15, 23, 42, 0.18)',
};

const transitions = {
    fast: 'all 0.15s ease',
    base: 'all 0.2s ease',
    slow: 'all 0.3s ease',
};

function withAlpha(color: string, alpha: number): string {
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

    return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
}

const createFocusRing = (color: string): string => {
    if (color.startsWith('var(')) {
        return `0 0 0 2px ${color}`;
    }

    return `0 0 0 1px ${color}, 0 0 0 4px ${withAlpha(color, 0.35)}`;
};

export const primitives: ThemePrimitives = {
    palette,
    fontSizes,
    fontWeights,
    lineHeights,
    space,
    radii,
    shadows,
    transitions,
    typography: {
        sans: 'var(--vscode-font-family, "Inter", "Segoe UI", system-ui, sans-serif)',
        mono: 'var(--vscode-editor-font-family, "JetBrains Mono", "Fira Code", monospace)',
    },
    focusRing: createFocusRing,
};

export type { ThemePrimitives };
