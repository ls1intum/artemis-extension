import { AttributeValue, buildAttributes, mergeClassNames } from '../utils/markup';

export interface TextFieldProps {
    id?: string;
    label?: string;
    description?: string;
    value?: string;
    placeholder?: string;
    multiline?: boolean;
    rows?: number;
    disabled?: boolean;
    readOnly?: boolean;
    name?: string;
    type?: string;
    autoComplete?: string;
    onInput?: string;
    onChange?: string;
    onBlur?: string;
    ariaLabel?: string;
    className?: string;
    inputClassName?: string;
    attributes?: Record<string, AttributeValue | AttributeValue[]>;
}

function escapeContent(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function TextField(props: TextFieldProps): string {
    const {
        id,
        label,
        description,
        value,
        placeholder,
        multiline,
        rows = 3,
        disabled,
        readOnly,
        name,
        type = 'text',
        autoComplete,
        onInput,
        onChange,
        onBlur,
        ariaLabel,
        className,
        inputClassName,
        attributes = {},
    } = props;

    const containerClasses = mergeClassNames('iris-text-field', className);
    const inputClasses = mergeClassNames('iris-text-field__input', inputClassName, multiline ? 'iris-text-field__input--multiline' : undefined);

    const baseAttributes: Record<string, AttributeValue | AttributeValue[]> = {
        id,
        name,
        class: inputClasses,
        placeholder,
        disabled,
        readonly: readOnly,
        autocomplete: autoComplete,
        oninput: onInput,
        onchange: onChange,
        onblur: onBlur,
        'aria-label': ariaLabel,
        ...attributes,
    };

    let controlMarkup: string;

    if (multiline) {
        const textareaAttributes = {
            ...baseAttributes,
            rows,
        };
        const content = value ? escapeContent(value) : '';
        controlMarkup = `<textarea ${buildAttributes(textareaAttributes)}>${content}</textarea>`;
    } else {
        const inputAttributes = {
            ...baseAttributes,
            type,
            value,
        };
        controlMarkup = `<input ${buildAttributes(inputAttributes)} />`;
    }

    const labelMarkup = label ? `<label class="iris-text-field__label" for="${id ?? ''}">${label}</label>` : '';
    const descriptionMarkup = description ? `<div class="iris-text-field__description">${description}</div>` : '';

    return `<div class="${containerClasses}">${labelMarkup}${controlMarkup}${descriptionMarkup}</div>`;
}
