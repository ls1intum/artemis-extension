import { ButtonProps, ButtonVariant, ButtonSize } from './Button';

export interface IconButtonProps {
    id?: string;
    icon: string;
    label: string;
    variant?: ButtonVariant;
    size?: ButtonSize;
    disabled?: boolean;
    title?: string;
    className?: string;
    attributes?: ButtonProps['attributes'];
}

export const IconButton = ({
    id,
    icon,
    label,
    variant = 'ghost',
    size = 'sm',
    disabled = false,
    title,
    className,
    attributes,
}: IconButtonProps): string => {
    const classes = ['iris-icon-button', `iris-icon-button--${variant}`, `iris-icon-button--${size}`];
    if (className) {
        classes.push(className);
    }

    const attr: Record<string, string | number | boolean | undefined> = {
        ...attributes,
        'aria-label': label,
        type: 'button',
    };

    if (disabled) {
        attr.disabled = true;
    }
    if (id) {
        attr.id = id;
    }
    if (title) {
        attr.title = title;
    }

    const attrString = Object.entries(attr)
        .filter(([, value]) => value !== undefined && value !== false)
        .map(([name, value]) => {
            if (value === true) {
                return `${name}`;
            }
            return `${name}="${String(value)}"`;
        })
        .join(' ');

    const attrSuffix = attrString ? ` ${attrString}` : '';

    return `<button class="${classes.join(' ')}"${attrSuffix}>${icon}</button>`;
};
