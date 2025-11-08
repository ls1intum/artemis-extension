export interface ToolbarProps {
    id?: string;
    className?: string;
    align?: 'start' | 'center' | 'end' | 'space-between';
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

export const Toolbar = ({
    id,
    className,
    align = 'center',
    children,
    attributes,
}: ToolbarProps): string => {
    const classes = ['iris-toolbar', `iris-toolbar--${align}`];
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

    return `<div ${attrs}>${children}</div>`;
};
