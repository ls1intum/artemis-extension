import { AttributeValue, buildAttributes, mergeClassNames } from '../utils/markup';

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
    onClick?: string;
    ariaLabel?: string;
    className?: string;
    attributes?: Record<string, AttributeValue | AttributeValue[]>;
}

function renderIcon(icon: string | undefined, position: 'leading' | 'trailing'): string {
    if (!icon) {
        return '';
    }
    return `<span class="iris-button__icon iris-button__icon--${position}">${icon}</span>`;
}

export function Button(props: ButtonProps): string {
    const {
        id,
        label,
        variant = 'secondary',
        size = 'md',
        leadingIcon,
        trailingIcon,
        type = 'button',
        disabled,
        onClick,
        ariaLabel,
        className,
        attributes = {},
    } = props;

    const classes = mergeClassNames(
        'iris-button',
        `iris-button--${variant}`,
        size ? `iris-button--${size}` : undefined,
        className,
    );

    const attributeMap: Record<string, AttributeValue | AttributeValue[]> = {
        id,
        type,
        class: classes,
        onclick: onClick,
        'aria-label': ariaLabel,
        disabled,
        ...attributes,
    };

    const inner = `${renderIcon(leadingIcon, 'leading')}<span class="iris-button__label">${label}</span>${renderIcon(trailingIcon, 'trailing')}`;

    return `<button ${buildAttributes(attributeMap)}>${inner}</button>`;
}
