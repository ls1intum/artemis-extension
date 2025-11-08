export interface PanelProps {
    id?: string;
    element?: 'div' | 'section' | 'article';
    className?: string;
    padding?: 'none' | 'sm' | 'md' | 'lg';
    interactive?: boolean;
    children: string;
    attributes?: Record<string, string | number | boolean | undefined>;
}

const buildAttributes = (attributes?: Record<string, string | number | boolean | undefined>): string => {
    if (!attributes) {
        return '';
    }

    return Object.entries(attributes)
        .filter(([, value]) => value !== undefined && value !== false)
        .map(([key, value]) => {
            if (value === true) {
                return key;
            }
            const escaped = String(value).replace(/"/g, '&quot;');
            return `${key}="${escaped}"`;
        })
        .join(' ');
};

export const Panel = ({
    id,
    element = 'div',
    className,
    padding = 'md',
    interactive,
    children,
    attributes,
}: PanelProps): string => {
    const classes = ['iris-panel', `iris-panel--padding-${padding}`];
    if (interactive) {
        classes.push('iris-panel--interactive');
    }
    if (className) {
        classes.push(className);
    }

    const attrs = [
        id ? `id="${id}"` : '',
        `class="${classes.join(' ')}"`,
        buildAttributes(attributes),
    ]
        .filter(Boolean)
        .join(' ');

    return `<${element} ${attrs}>${children}</${element}>`;
};
