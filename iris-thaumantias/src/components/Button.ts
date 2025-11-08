export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
    id?: string;
    type?: 'button' | 'submit' | 'reset';
    label?: string;
    children?: string;
    icon?: string;
    iconPosition?: 'start' | 'end';
    variant?: ButtonVariant;
    size?: ButtonSize;
    disabled?: boolean;
    ariaLabel?: string;
    title?: string;
    className?: string;
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

const buildIcon = (icon?: string, position: 'start' | 'end' = 'start'): string => {
    if (!icon) {
        return '';
    }

    return `<span class="iris-button__icon iris-button__icon--${position}">${icon}</span>`;
};

export const Button = ({
    id,
    type = 'button',
    label,
    children,
    icon,
    iconPosition = 'start',
    variant = 'primary',
    size = 'md',
    disabled,
    ariaLabel,
    title,
    className,
    attributes,
}: ButtonProps): string => {
    const classNames = ['iris-button', `iris-button--${variant}`, `iris-button--${size}`];
    if (className) {
        classNames.push(className);
    }

    const attributeString = buildAttributes(attributes);
    const pieces: string[] = [];
    const iconMarkup = buildIcon(icon, iconPosition);

    if (iconMarkup && iconPosition === 'start') {
        pieces.push(iconMarkup);
    }

    if (children) {
        pieces.push(children);
    } else if (label) {
        pieces.push(`<span class="iris-button__label">${label}</span>`);
    }

    if (iconMarkup && iconPosition === 'end') {
        pieces.push(iconMarkup);
    }

    const attr = [
        id ? `id="${id}"` : '',
        `class="${classNames.join(' ')}"`,
        `type="${type}"`,
        ariaLabel ? `aria-label="${ariaLabel}"` : '',
        title ? `title="${title}"` : '',
        disabled ? 'disabled' : '',
        attributeString,
    ]
        .filter(Boolean)
        .join(' ');

    return `<button ${attr}>${pieces.join('')}</button>`;
};
