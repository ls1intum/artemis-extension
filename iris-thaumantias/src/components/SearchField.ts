import { TextField, TextFieldProps } from './TextField';

const SEARCH_ICON = `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M6.75 2a4.75 4.75 0 0 1 3.766 7.625l3.43 3.43-.708.708-3.43-3.43A4.75 4.75 0 1 1 6.75 2zm0 1.5a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5z"/></svg>`;

export interface SearchFieldProps extends Omit<TextFieldProps, 'leadingIcon'> {
    icon?: string;
}

export const SearchField = ({ icon = SEARCH_ICON, className, ...rest }: SearchFieldProps): string => {
    const mergedClass = ['iris-search-field', className].filter(Boolean).join(' ') || undefined;
    return TextField({
        ...rest,
        leadingIcon: icon,
        className: mergedClass,
        inputClassName: ['iris-search-field__input', rest.inputClassName].filter(Boolean).join(' ') || undefined,
    });
};
