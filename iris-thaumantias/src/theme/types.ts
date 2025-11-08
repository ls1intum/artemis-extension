import { fontSizes, fontWeights, lineHeights, palette, radii, shadows, space, transitions, zIndices } from './tokens';

export type ThemeType = 'vscode' | 'modern' | 'synthwave';

export interface ThemePrimitives {
    palette: typeof palette;
    fontSizes: typeof fontSizes;
    fontWeights: typeof fontWeights;
    lineHeights: typeof lineHeights;
    space: typeof space;
    radii: typeof radii;
    shadows: typeof shadows;
    transitions: typeof transitions;
    zIndices: typeof zIndices;
}

export interface SemanticInteractiveToken {
    default: string;
    hover: string;
    active: string;
    disabled: string;
    foreground: string;
}

export interface Theme {
    type: ThemeType;
    name: string;
    colorScheme: 'light' | 'dark';
    typography: {
        fontFamily: string;
        fontFamilyMono: string;
        fontSize: string;
        fontSizeSmall: string;
        fontWeight: number;
        lineHeight: number;
        heading: {
            h1: string;
            h2: string;
            h3: string;
        };
    };
    colors: {
        background: {
            app: string;
            surface: string;
            elevated: string;
            sunken: string;
            overlay: string;
        };
        text: {
            primary: string;
            secondary: string;
            muted: string;
            accent: string;
            inverse: string;
            link: string;
            linkHover: string;
        };
        border: {
            subtle: string;
            default: string;
            strong: string;
            focus: string;
        };
        status: {
            success: string;
            successForeground: string;
            successSubtle: string;
            warning: string;
            warningForeground: string;
            warningSubtle: string;
            danger: string;
            dangerForeground: string;
            dangerSubtle: string;
            info: string;
            infoForeground: string;
            infoSubtle: string;
        };
        accent: {
            primary: string;
            onPrimary: string;
            muted: string;
        };
        interactive: {
            primary: SemanticInteractiveToken;
            secondary: SemanticInteractiveToken;
            ghost: SemanticInteractiveToken;
        };
    };
    layout: {
        gutter: string;
        surfacePadding: string;
        stackGap: string;
        cardRadius: string;
    };
    shadows: {
        focus: string;
        surface: string;
        raised: string;
    };
    transitions: {
        interactive: string;
        soft: string;
    };
    primitives: ThemePrimitives;
}

export interface ThemeConfig {
    id: ThemeType;
    label: string;
    theme: Theme;
}
