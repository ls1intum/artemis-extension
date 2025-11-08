export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
    id?: string;
    label: string;
    variant?: ButtonVariant;
    size?: ButtonSize;
    leadingIcon?: string;
    trailingIcon?: string;
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    title?: string;
    className?: string;
    attributes?: Record<string, string | number | boolean | undefined>;
}

const formatAttributes = (attributes?: Record<string, string | number | boolean | undefined>): string => {
    if (!attributes) {
        return '';
    }

    return Object.entries(attributes)
        .filter(([, value]) => value !== undefined && value !== false)
        .map(([name, value]) => {
            if (value === true) {
                return `${name}`;
            }
            return `${name}="${String(value)}"`;
        })
        .join(' ');
};

const buildClassName = (variant: ButtonVariant, size: ButtonSize, className?: string): string => {
    const parts = [`iris-button`, `iris-button--${variant}`, `iris-button--${size}`];
    if (className) {
        parts.push(className);
    }
    return parts.join(' ');
};

export const Button = ({
    id,
    label,
    variant = 'primary',
    size = 'md',
    leadingIcon,
    trailingIcon,
    type = 'button',
    disabled = false,
    title,
    className,
    attributes,
}: ButtonProps): string => {
    const classes = buildClassName(variant, size, className);
    const mergedAttributes = [
        id ? `id="${id}"` : null,
        title ? `title="${title}"` : null,
        `type="${type}"`,
        disabled ? 'disabled' : null,
        formatAttributes(attributes),
    ]
        .filter(Boolean)
        .join(' ');

    const attrString = mergedAttributes ? ` ${mergedAttributes}` : '';

    const iconLeading = leadingIcon ? `<span class="iris-button__icon iris-button__icon--leading">${leadingIcon}</span>` : '';
    const iconTrailing = trailingIcon ? `<span class="iris-button__icon iris-button__icon--trailing">${trailingIcon}</span>` : '';

    return `<button class="${classes}"${attrString}>${iconLeading}<span class="iris-button__label">${label}</span>${iconTrailing}</button>`;
};
