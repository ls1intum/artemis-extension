export interface TextFieldProps {
    id: string;
    name?: string;
    label?: string;
    value?: string;
    placeholder?: string;
    type?: string;
    disabled?: boolean;
    readOnly?: boolean;
    leadingIcon?: string;
    trailingIcon?: string;
    hint?: string;
    className?: string;
    inputClassName?: string;
    autoComplete?: string;
    attributes?: Record<string, string | number | boolean | undefined>;
    textarea?: boolean;
    rows?: number;
}

const buildAttributeString = (attributes?: Record<string, string | number | boolean | undefined>): string =>
    attributes
        ? Object.entries(attributes)
              .filter(([, value]) => value !== undefined && value !== false)
              .map(([name, value]) => {
                  if (value === true) {
                      return `${name}`;
                  }
                  return `${name}="${String(value)}"`;
              })
              .join(' ')
        : '';

export const TextField = ({
    id,
    name,
    label,
    value,
    placeholder,
    type = 'text',
    disabled = false,
    readOnly = false,
    leadingIcon,
    trailingIcon,
    hint,
    className,
    inputClassName,
    autoComplete = 'off',
    attributes,
    textarea = false,
    rows,
}: TextFieldProps): string => {
    const wrapperClasses = ['iris-text-field'];
    if (className) {
        wrapperClasses.push(className);
    }

    const controlClasses = ['iris-text-field__control'];
    if (leadingIcon) {
        controlClasses.push('iris-text-field__control--with-leading');
    }
    if (trailingIcon) {
        controlClasses.push('iris-text-field__control--with-trailing');
    }

    const inputClasses = ['iris-text-field__input'];
    if (inputClassName) {
        inputClasses.push(inputClassName);
    }

    const hintId = hint ? `${id}-hint` : undefined;

    const baseAttributes = [
        `id="${id}"`,
        name ? `name="${name}"` : null,
        disabled ? 'disabled' : null,
        readOnly ? 'readonly' : null,
        hintId ? `aria-describedby="${hintId}"` : null,
        `autocomplete="${autoComplete}"`,
        buildAttributeString(attributes),
    ]
        .filter(Boolean)
        .join(' ');

    const inputValue = value ?? '';
    const placeholderAttr = placeholder ? ` placeholder="${placeholder}"` : '';
    const baseAttrSuffix = baseAttributes ? ` ${baseAttributes}` : '';

    const leading = leadingIcon ? `<span class="iris-text-field__icon iris-text-field__icon--leading">${leadingIcon}</span>` : '';
    const trailing = trailingIcon ? `<span class="iris-text-field__icon iris-text-field__icon--trailing">${trailingIcon}</span>` : '';

    const inputElement = textarea
        ? `<textarea class="${inputClasses.join(' ')}"${baseAttrSuffix}${placeholderAttr}${rows ? ` rows="${rows}"` : ''}>${inputValue}</textarea>`
        : `<input class="${inputClasses.join(' ')}" type="${type}" value="${inputValue}"${baseAttrSuffix}${placeholderAttr} />`;

    const labelElement = label
        ? `<label class="iris-text-field__label" for="${id}">${label}</label>`
        : '';

    const hintElement = hint ? `<p class="iris-text-field__hint" id="${hintId}">${hint}</p>` : '';

    return `
<div class="${wrapperClasses.join(' ')}">
    ${labelElement}
    <div class="${controlClasses.join(' ')}">
        ${leading}
        ${inputElement}
        ${trailing}
    </div>
    ${hintElement}
</div>
`.trim();
};
