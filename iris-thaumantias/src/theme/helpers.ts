import { Theme } from './types';

export const focusRing = (theme: Theme, width: string = '2px'): string =>
    `0 0 0 ${width} ${theme.colors.border.focus}`;

export const interactiveTransition = (
    theme: Theme,
    properties: string = 'background-color, border-color, color, box-shadow, transform'
): string => `${properties} ${theme.transitions.interactive}`;

export const surfaceShadow = (theme: Theme): string => theme.shadows.surface;
