const HTML_ESCAPE_LOOKUP: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

const HTML_ESCAPE_REGEX = /[&<>"']/g;

const escapeHtml = (value: string): string => value.replace(HTML_ESCAPE_REGEX, char => HTML_ESCAPE_LOOKUP[char]);

const normalizeClassName = (value: string | undefined): string =>
    value?.trim().replace(/\s+/g, ' ') ?? '';

const composeClassName = (classes: string[]): string | undefined => {
    const normalized = normalizeClassName(classes.filter(Boolean).join(' '));
    return normalized.length > 0 ? normalized : undefined;
};

const renderAttributes = (attributes: Record<string, string | number | boolean | undefined | null>): string =>
    Object.entries(attributes)
        .filter(([, value]) => value !== undefined && value !== null && value !== false)
        .map(([key, value]) => {
            if (value === true) {
                return key;
            }

            return `${key}="${escapeHtml(String(value))}"`;
        })
        .join(' ');

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
    id?: string;
    label: string;
    icon?: string;
    trailingIcon?: string;
    variant?: ButtonVariant;
    size?: ButtonSize;
    className?: string;
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    attributes?: Record<string, string | number | boolean | undefined>;
}

export const Button = ({
    id,
    label,
    icon,
    trailingIcon,
    variant = 'primary',
    size = 'md',
    className,
    disabled,
    type = 'button',
    attributes = {},
}: ButtonProps): string => {
    const classes = ['iris-button', `iris-button--${variant}`, `iris-button--${size}`];

    if (className) {
        classes.push(className);
    }

    const attrs = { ...attributes };
    if (attrs.class) {
        classes.push(normalizeClassName(String(attrs.class)));
        delete attrs.class;
    }

    const baseAttributes: Record<string, string | number | boolean | undefined> = {
        id,
        type,
        class: composeClassName(classes),
        disabled,
        ...attrs,
    };

    const iconMarkup = icon ? `<span class="iris-button__icon" aria-hidden="true">${icon}</span>` : '';
    const trailingMarkup = trailingIcon
        ? `<span class="iris-button__icon iris-button__icon--trailing" aria-hidden="true">${trailingIcon}</span>`
        : '';
    const labelMarkup = `<span class="iris-button__label">${escapeHtml(label)}</span>`;

    return `<button ${renderAttributes(baseAttributes)}>${iconMarkup}${labelMarkup}${trailingMarkup}</button>`;
};

export interface IconButtonProps {
    id?: string;
    icon: string;
    label: string;
    variant?: ButtonVariant;
    size?: ButtonSize;
    className?: string;
    disabled?: boolean;
    attributes?: Record<string, string | number | boolean | undefined>;
}

export const IconButton = ({
    id,
    icon,
    label,
    variant = 'ghost',
    size = 'md',
    className,
    disabled,
    attributes = {},
}: IconButtonProps): string => {
    const classes = ['iris-icon-button', `iris-icon-button--${variant}`, `iris-icon-button--${size}`];
    if (className) {
        classes.push(className);
    }

    const attrs = { ...attributes };
    if (attrs.class) {
        classes.push(normalizeClassName(String(attrs.class)));
        delete attrs.class;
    }

    const baseAttributes: Record<string, string | number | boolean | undefined> = {
        id,
        class: composeClassName(classes),
        disabled,
        'aria-label': label,
        ...attrs,
    };

    return `<button ${renderAttributes(baseAttributes)}>${icon}<span class="iris-sr-only">${escapeHtml(label)}</span></button>`;
};

export type TextFieldSize = 'sm' | 'md' | 'lg';

export interface TextFieldProps {
    id?: string;
    name?: string;
    value?: string;
    placeholder?: string;
    type?: string;
    size?: TextFieldSize;
    className?: string;
    disabled?: boolean;
    readOnly?: boolean;
    leadingIcon?: string;
    trailingIcon?: string;
    attributes?: Record<string, string | number | boolean | undefined>;
}

export const TextField = ({
    id,
    name,
    value,
    placeholder,
    type = 'text',
    size = 'md',
    className,
    disabled,
    readOnly,
    leadingIcon,
    trailingIcon,
    attributes = {},
}: TextFieldProps): string => {
    const wrapperClasses = ['iris-text-field', `iris-text-field--${size}`];
    if (leadingIcon) {
        wrapperClasses.push('iris-text-field--with-leading');
    }
    if (trailingIcon) {
        wrapperClasses.push('iris-text-field--with-trailing');
    }
    if (className) {
        wrapperClasses.push(className);
    }

    const inputAttributes: Record<string, string | number | boolean | undefined> = {
        id,
        name,
        class: 'iris-text-field__input',
        type,
        value,
        placeholder,
        disabled,
        readonly: readOnly,
        ...attributes,
    };

    const leadingMarkup = leadingIcon ? `<span class="iris-text-field__icon iris-text-field__icon--leading">${leadingIcon}</span>` : '';
    const trailingMarkup = trailingIcon
        ? `<span class="iris-text-field__icon iris-text-field__icon--trailing">${trailingIcon}</span>`
        : '';

    const wrapperClass = composeClassName(wrapperClasses);
    const wrapperAttributes = wrapperClass ? ` class="${wrapperClass}"` : '';

    return `
        <div${wrapperAttributes}>
            ${leadingMarkup}
            <input ${renderAttributes(inputAttributes)} />
            ${trailingMarkup}
        </div>
    `.trim();
};

export interface SearchFieldProps extends Omit<TextFieldProps, 'type' | 'leadingIcon'> {
    searchIcon?: string;
}

export const SearchField = ({ searchIcon = '🔍', ...props }: SearchFieldProps): string => {
    const iconMarkup = `<span class="iris-text-field__icon-graphic" aria-hidden="true">${searchIcon}</span>`;
    return TextField({
        ...props,
        type: 'search',
        leadingIcon: iconMarkup,
    });
};

export interface CardProps {
    id?: string;
    className?: string;
    padding?: boolean;
    role?: string;
    attributes?: Record<string, string | number | boolean | undefined>;
    children: string;
}

export const Card = ({
    id,
    className,
    padding = true,
    role,
    attributes = {},
    children,
}: CardProps): string => {
    const classes = ['iris-card'];
    if (padding) {
        classes.push('iris-card--padded');
    }
    if (className) {
        classes.push(className);
    }

    const attrs = { ...attributes };
    if (attrs.class) {
        classes.push(normalizeClassName(String(attrs.class)));
        delete attrs.class;
    }

    const baseAttributes: Record<string, string | number | boolean | undefined> = {
        id,
        role,
        class: composeClassName(classes),
        ...attrs,
    };

    return `<div ${renderAttributes(baseAttributes)}>${children}</div>`;
};

export interface ToolbarProps {
    id?: string;
    className?: string;
    attributes?: Record<string, string | number | boolean | undefined>;
    children: string;
}

export const Toolbar = ({ id, className, attributes = {}, children }: ToolbarProps): string => {
    const classes = ['iris-toolbar'];
    if (className) {
        classes.push(className);
    }

    const attrs = { ...attributes };
    if (attrs.class) {
        classes.push(normalizeClassName(String(attrs.class)));
        delete attrs.class;
    }

    const baseAttributes: Record<string, string | number | boolean | undefined> = {
        id,
        class: composeClassName(classes),
        ...attrs,
    };

    return `<div ${renderAttributes(baseAttributes)}>${children}</div>`;
};

export interface HeaderProps {
    id?: string;
    title?: string;
    subtitle?: string;
    className?: string;
    start?: string;
    end?: string;
    attributes?: Record<string, string | number | boolean | undefined>;
}

export const Header = ({
    id,
    title,
    subtitle,
    className,
    start,
    end,
    attributes = {},
}: HeaderProps): string => {
    const classes = ['iris-header'];
    if (className) {
        classes.push(className);
    }

    const attrs = { ...attributes };
    if (attrs.class) {
        classes.push(normalizeClassName(String(attrs.class)));
        delete attrs.class;
    }

    const baseAttributes: Record<string, string | number | boolean | undefined> = {
        id,
        class: composeClassName(classes),
        ...attrs,
    };

    const titleMarkup = title ? `<h1 class="iris-header__title">${escapeHtml(title)}</h1>` : '';
    const subtitleMarkup = subtitle ? `<p class="iris-header__subtitle">${escapeHtml(subtitle)}</p>` : '';
    const startMarkup = start ? `<div class="iris-header__start">${start}</div>` : '';
    const endMarkup = end ? `<div class="iris-header__end">${end}</div>` : '';

    return `
        <header ${renderAttributes(baseAttributes)}>
            ${startMarkup}
            <div class="iris-header__body">
                ${titleMarkup}
                ${subtitleMarkup}
            </div>
            ${endMarkup}
        </header>
    `.trim();
};

export interface PanelProps {
    id?: string;
    className?: string;
    children: string;
    attributes?: Record<string, string | number | boolean | undefined>;
}

export const Panel = ({ id, className, children, attributes = {} }: PanelProps): string => {
    const classes = ['iris-panel'];
    if (className) {
        classes.push(className);
    }

    const attrs = { ...attributes };
    if (attrs.class) {
        classes.push(normalizeClassName(String(attrs.class)));
        delete attrs.class;
    }

    const baseAttributes: Record<string, string | number | boolean | undefined> = {
        id,
        class: normalizeClassName(classes.join(' ')),
        ...attrs,
    };

    return `<section ${renderAttributes(baseAttributes)}>${children}</section>`;
};

export const srOnly = (content: string): string => `<span class="iris-sr-only">${escapeHtml(content)}</span>`;
