import { TextField, TextFieldProps } from './TextField';

const defaultSearchIcon = `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 101.57 1.57l.27.28v.79l4.5 4.5a1 1 0 001.41-1.41l-4.5-4.5zm-6 0a4.5 4.5 0 114.5-4.5 4.5 4.5 0 01-4.5 4.5z" fill="currentColor"/></svg>`;

export interface SearchFieldProps extends Omit<TextFieldProps, 'type' | 'textarea'> {
    showClearButton?: boolean;
    clearButtonId?: string;
    clearButtonLabel?: string;
    clearButtonIcon?: string;
}

export const SearchField = ({
    className,
    leadingIcon = defaultSearchIcon,
    showClearButton = false,
    clearButtonId,
    clearButtonLabel = 'Clear search',
    clearButtonIcon = '<span aria-hidden="true">&times;</span>',
    trailingIcon,
    inputClassName,
    ...rest
}: SearchFieldProps): string => {
    const wrapperClasses = ['iris-search-field'];
    if (className) {
        wrapperClasses.push(className);
    }

    let trailing = trailingIcon;
    if (showClearButton) {
        const buttonId = clearButtonId ? ` id=\"${clearButtonId}\"` : '';
        trailing = `
            <button class="iris-search-field__clear" type="button"${buttonId} aria-label="${clearButtonLabel}">
                ${clearButtonIcon}
            </button>
        `;
    }

    return TextField({
        ...rest,
        className: wrapperClasses.join(' '),
        leadingIcon,
        trailingIcon: trailing,
        inputClassName,
        type: 'search',
    });
};
