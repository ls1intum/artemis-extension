export type PanelVariant = 'surface' | 'sunken' | 'elevated';

export interface PanelProps {
    id?: string;
    variant?: PanelVariant;
    padded?: boolean;
    className?: string;
    children: string;
}

export const Panel = ({
    id,
    variant = 'surface',
    padded = true,
    className,
    children,
}: PanelProps): string => {
    const classes = ['iris-panel', `iris-panel--${variant}`];
    if (padded) {
        classes.push('iris-panel--padded');
    }
    if (className) {
        classes.push(className);
    }

    const idAttr = id ? ` id="${id}"` : '';

    return `<section class="${classes.join(' ')}"${idAttr}>${children}</section>`;
};
