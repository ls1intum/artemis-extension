export type TextFieldSize = 'sm' | 'md' | 'lg';

export interface TextFieldProps {
    id?: string;
    name?: string;
    value?: string;
    placeholder?: string;
    type?: string;
    size?: TextFieldSize;
    disabled?: boolean;
    readOnly?: boolean;
    multiline?: boolean;
    rows?: number;
    leadingIcon?: string;
    trailingIcon?: string;
    className?: string;
    inputClassName?: string;
    attributes?: Record<string, string | number | boolean | undefined>;
    inputAttributes?: Record<string, string | number | boolean | undefined>;
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

export const TextField = ({
    id,
    name,
    value,
    placeholder,
    type = 'text',
    size = 'md',
    disabled,
    readOnly,
    multiline,
    rows = 3,
    leadingIcon,
    trailingIcon,
    className,
    inputClassName,
    attributes,
    inputAttributes,
}: TextFieldProps): string => {
    const wrapperClasses = ['iris-text-field', `iris-text-field--${size}`];
    if (className) {
        wrapperClasses.push(className);
    }

    const inputClasses = ['iris-text-field__input'];
    if (inputClassName) {
        inputClasses.push(inputClassName);
    }

    const wrapperAttrs = [
        `class="${wrapperClasses.join(' ')}"`,
        buildAttributes(attributes),
    ]
        .filter(Boolean)
        .join(' ');

    const baseInputAttrs = [
        id ? `id="${id}"` : '',
        name ? `name="${name}"` : '',
        placeholder ? `placeholder="${placeholder}"` : '',
        disabled ? 'disabled' : '',
        readOnly ? 'readonly' : '',
        `class="${inputClasses.join(' ')}"`,
        buildAttributes(inputAttributes),
    ]
        .filter(Boolean)
        .join(' ');

    const inputMarkup = multiline
        ? `<textarea ${baseInputAttrs} rows="${rows}">${value ?? ''}</textarea>`
        : `<input ${baseInputAttrs} type="${type}" value="${value ?? ''}" />`;

    const iconMarkup = (icon?: string, position: 'leading' | 'trailing' = 'leading') =>
        icon ? `<span class="iris-text-field__icon iris-text-field__icon--${position}">${icon}</span>` : '';

    return `
<div ${wrapperAttrs}>
    ${iconMarkup(leadingIcon, 'leading')}
    ${inputMarkup}
    ${iconMarkup(trailingIcon, 'trailing')}
</div>
`.trim();
};
