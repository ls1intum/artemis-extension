export type ThemeName = 'light' | 'dark' | 'vscode' | 'modern' | 'synthwave';

export interface NeutralPalette {
    '0': string;
    '50': string;
    '100': string;
    '200': string;
    '300': string;
    '400': string;
    '500': string;
    '600': string;
    '700': string;
    '800': string;
    '900': string;
    '950': string;
}

export interface BrandPalette {
    '50': string;
    '100': string;
    '200': string;
    '300': string;
    '400': string;
    '500': string;
    '600': string;
    '700': string;
    '800': string;
    '900': string;
}

export interface StatePalette {
    success: string;
    warning: string;
    danger: string;
    info: string;
}

export interface ThemePalette {
    neutral: NeutralPalette;
    iris: BrandPalette;
    accent: BrandPalette;
    state: StatePalette;
}

export interface FontScale {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
}

export interface FontWeightScale {
    regular: number;
    medium: number;
    semibold: number;
    bold: number;
}

export interface LineHeightScale {
    tight: string;
    standard: string;
    relaxed: string;
}

export interface SpaceScale {
    none: string;
    '3xs': string;
    '2xs': string;
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
    '2xl': string;
}

export interface RadiiScale {
    none: string;
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

export interface TransitionScale {
    fast: string;
    base: string;
    slow: string;
}

export interface TypographyTokens {
    fontFamily: string;
    fontFamilyMono: string;
    fontSize: string;
    fontWeight: number;
    lineHeight: string;
}

export interface ButtonTokens {
    background: string;
    foreground: string;
    border?: string;
    hover: string;
    active: string;
    shadow?: string;
}

export interface GhostButtonTokens {
    foreground: string;
    hover: string;
    active: string;
}

export interface InputTokens {
    background: string;
    foreground: string;
    placeholder: string;
    border: string;
    focus: string;
}

export interface CardTokens {
    background: string;
    border: string;
    shadow: string;
    radius: string;
}

export interface StateTokens {
    text: string;
    background: string;
    border: string;
}

export interface ThemeSemanticTokens {
    background: {
        app: string;
        surface: string;
        elevated: string;
        muted: string;
        overlay: string;
    };
    text: {
        primary: string;
        secondary: string;
        muted: string;
        accent: string;
        inverse: string;
    };
    border: {
        subtle: string;
        default: string;
        strong: string;
        focus: string;
    };
    button: {
        primary: ButtonTokens;
        secondary: ButtonTokens;
        ghost: GhostButtonTokens;
    };
    input: InputTokens;
    card: CardTokens;
    states: {
        success: StateTokens;
        warning: StateTokens;
        danger: StateTokens;
        info: StateTokens;
    };
    focusRing: string;
    overlay: {
        backdrop: string;
        shadow: string;
        filter: string;
    };
    typography: {
        fontFamily: string;
        fontFamilyMono: string;
        fontSize: string;
        fontWeight: string;
        lineHeight: string;
    };
    layout: {
        containerPadding: string;
        surfacePadding: string;
        gap: string;
        radius: string;
    };
}

export interface ThemeDefinition {
    id: ThemeName;
    label: string;
    mode: 'light' | 'dark';
    tokens: ThemeSemanticTokens;
}

export interface ThemePrimitives {
    palette: ThemePalette;
    fontSizes: FontScale;
    fontWeights: FontWeightScale;
    lineHeights: LineHeightScale;
    space: SpaceScale;
    radii: RadiiScale;
    shadows: ShadowScale;
    transitions: TransitionScale;
    typography: {
        sans: string;
        mono: string;
    };
    focusRing: (color: string) => string;
}

export type ThemeRegistry = Record<ThemeName, ThemeDefinition>;
