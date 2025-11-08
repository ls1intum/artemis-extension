import { AttributeValue, buildAttributes, mergeClassNames } from '../utils/markup';

export interface SearchFieldProps {
    id?: string;
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    autoComplete?: string;
    onInput?: string;
    onChange?: string;
    onFocus?: string;
    onBlur?: string;
    ariaLabel?: string;
    icon?: string;
    name?: string;
    className?: string;
    inputClassName?: string;
    attributes?: Record<string, AttributeValue | AttributeValue[]>;
}

export function SearchField(props: SearchFieldProps): string {
    const {
        id,
        value,
        placeholder,
        disabled,
        autoComplete = 'off',
        onInput,
        onChange,
        onFocus,
        onBlur,
        ariaLabel,
        icon,
        name,
        className,
        inputClassName,
        attributes = {},
    } = props;

    const containerClass = mergeClassNames('iris-search-field', className);
    const inputClass = mergeClassNames('iris-search-field__input', inputClassName);

    const inputAttributes: Record<string, AttributeValue | AttributeValue[]> = {
        id,
        name,
        class: inputClass,
        type: 'search',
        value,
        placeholder,
        disabled,
        autocomplete: autoComplete,
        oninput: onInput,
        onchange: onChange,
        onfocus: onFocus,
        onblur: onBlur,
        'aria-label': ariaLabel,
        ...attributes,
    };

    const iconMarkup = icon ? `<span class="iris-search-field__icon">${icon}</span>` : '';

    return `<div class="${containerClass}">${iconMarkup}<input ${buildAttributes(inputAttributes)} /></div>`;
}
