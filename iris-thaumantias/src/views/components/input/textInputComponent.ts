import { IconDefinitions } from '../../../utils/iconDefinitions';

export interface TextInputOptions {
    /** Input field ID */
    id?: string;
    /** Input field name attribute */
    name?: string;
    /** Input type */
    type?: 'text' | 'password' | 'email' | 'search' | 'url' | 'tel' | 'number';
    /** Placeholder text */
    placeholder?: string;
    /** Input value */
    value?: string;
    /** Label text (if provided, wraps input with label) */
    label?: string;
    /** Whether input is required */
    required?: boolean;
    /** Whether input is disabled */
    disabled?: boolean;
    /** Whether input is readonly */
    readonly?: boolean;
    /** Additional CSS classes */
    className?: string;
    /** Autocomplete attribute */
    autocomplete?: 'on' | 'off' | 'username' | 'current-password' | 'new-password' | 'email' | 'tel' | 'url';
    /** Input size variant */
    size?: 'small' | 'medium' | 'large';
    /** Full width input */
    fullWidth?: boolean;
    /** Error state */
    error?: boolean;
    /** Error message to display */
    errorMessage?: string;
    /** Helper text to display below input */
    helperText?: string;
    /** Maximum length */
    maxLength?: number;
    /** Minimum length */
    minLength?: number;
    /** Pattern for validation */
    pattern?: string;
    /** Input mode for mobile keyboards */
    inputMode?: 'none' | 'text' | 'tel' | 'url' | 'email' | 'numeric' | 'decimal' | 'search';
    /** ARIA label */
    ariaLabel?: string;
    /** ARIA describedby */
    ariaDescribedBy?: string;
    /** Show password reveal toggle for password inputs */
    showPasswordToggle?: boolean;
}

/**
 * Generates a VS Code-styled text input component with labels, validation, and error states.
 * 
 * @example
 * // Basic text input
 * TextInputComponent.generate({
 *   id: 'username',
 *   name: 'username',
 *   type: 'text',
 *   placeholder: 'Enter username',
 *   label: 'Username'
 * });
 * 
 * // Password input with error
 * TextInputComponent.generate({
 *   id: 'password',
 *   type: 'password',
 *   label: 'Password',
 *   required: true,
 *   error: true,
 *   errorMessage: 'Password is required'
 * });
 * 
 * // Search input
 * TextInputComponent.generate({
 *   type: 'search',
 *   placeholder: 'Search...',
 *   size: 'small'
 * });
 */
export class TextInputComponent {
    /**
     * Generates HTML for a text input
     */
    public static generate(options: TextInputOptions): string {
        const {
            id = '',
            name = id,
            type = 'text',
            placeholder = '',
            value = '',
            label,
            required = false,
            disabled = false,
            readonly = false,
            className = '',
            autocomplete = 'off',
            size = 'medium',
            fullWidth = false,
            error = false,
            errorMessage,
            helperText,
            maxLength,
            minLength,
            pattern,
            inputMode,
            ariaLabel,
            ariaDescribedBy,
            showPasswordToggle = true
        } = options;

        const inputClasses = [
            'input',
            `input-${size}`,
            fullWidth ? 'input-full-width' : '',
            error ? 'input-error' : '',
            disabled ? 'input-disabled' : '',
            className
        ].filter(Boolean).join(' ');

        const idAttr = id ? ` id="${id}"` : '';
        const nameAttr = name ? ` name="${name}"` : '';
        const placeholderAttr = placeholder ? ` placeholder="${placeholder}"` : '';
        const valueAttr = value ? ` value="${value}"` : '';
        const requiredAttr = required ? ' required' : '';
        const disabledAttr = disabled ? ' disabled' : '';
        const readonlyAttr = readonly ? ' readonly' : '';
        const autocompleteAttr = ` autocomplete="${autocomplete}"`;
        const maxLengthAttr = maxLength ? ` maxlength="${maxLength}"` : '';
        const minLengthAttr = minLength ? ` minlength="${minLength}"` : '';
        const patternAttr = pattern ? ` pattern="${pattern}"` : '';
        const inputModeAttr = inputMode ? ` inputmode="${inputMode}"` : '';
        const ariaLabelAttr = ariaLabel ? ` aria-label="${ariaLabel}"` : '';
        const ariaDescribedByAttr = ariaDescribedBy ? ` aria-describedby="${ariaDescribedBy}"` : '';

        // For password inputs with toggle, wrap in a container
        const isPasswordWithToggle = type === 'password' && showPasswordToggle;
        const toggleId = isPasswordWithToggle ? `${id || 'password'}-toggle` : '';
        const eyeOpenIcon = IconDefinitions.getIcon('eye-open');
        const eyeClosedIcon = IconDefinitions.getIcon('eye-closed');
        
        const inputElement = isPasswordWithToggle ? `
            <div class="input-password-wrapper">
                <input
                    type="password"
                    class="${inputClasses}"${idAttr}${nameAttr}${placeholderAttr}${valueAttr}${requiredAttr}${disabledAttr}${readonlyAttr}${autocompleteAttr}${maxLengthAttr}${minLengthAttr}${patternAttr}${inputModeAttr}${ariaLabelAttr}${ariaDescribedByAttr}
                />
                <button type="button" class="input-password-toggle" id="${toggleId}" aria-label="Toggle password visibility" tabindex="-1">
                    <span class="input-password-icon-hide">${eyeOpenIcon}</span>
                    <span class="input-password-icon-show" style="display: none;">${eyeClosedIcon}</span>
                </button>
            </div>
        ` : `
            <input
                type="${type}"
                class="${inputClasses}"${idAttr}${nameAttr}${placeholderAttr}${valueAttr}${requiredAttr}${disabledAttr}${readonlyAttr}${autocompleteAttr}${maxLengthAttr}${minLengthAttr}${patternAttr}${inputModeAttr}${ariaLabelAttr}${ariaDescribedByAttr}
            />
        `;

        // If no label, return just the input
        if (!label && !errorMessage && !helperText) {
            return inputElement;
        }

        // Build the full input group with label and messages
        const labelElement = label ? `<label class="input-label" ${id ? `for="${id}"` : ''}>${label}${required ? '<span class="input-required">*</span>' : ''}</label>` : '';
        const errorElement = error && errorMessage ? `<span class="input-error-message">${errorMessage}</span>` : '';
        const helperElement = !error && helperText ? `<span class="input-helper-text">${helperText}</span>` : '';
        
        // Add script for password toggle if needed
        const passwordToggleScript = isPasswordWithToggle ? `
            <script>
                (function() {
                    const toggle = document.getElementById('${toggleId}');
                    if (toggle) {
                        const input = toggle.previousElementSibling;
                        const hideIcon = toggle.querySelector('.input-password-icon-hide');
                        const showIcon = toggle.querySelector('.input-password-icon-show');
                        
                        toggle.addEventListener('click', function() {
                            if (input.type === 'password') {
                                input.type = 'text';
                                hideIcon.style.display = 'none';
                                showIcon.style.display = 'block';
                            } else {
                                input.type = 'password';
                                hideIcon.style.display = 'block';
                                showIcon.style.display = 'none';
                            }
                        });
                    }
                })();
            </script>
        ` : '';

        return `
            <div class="input-group${fullWidth ? ' input-group-full-width' : ''}">
                ${labelElement}
                ${inputElement}
                ${errorElement}
                ${helperElement}
            </div>
            ${passwordToggleScript}
        `;
    }

    /**
     * Generates a text input (convenience method)
     */
    public static text(id: string, placeholder: string, label?: string): string {
        return TextInputComponent.generate({
            id,
            name: id,
            type: 'text',
            placeholder,
            label
        });
    }

    /**
     * Generates a password input (convenience method)
     */
    public static password(id: string, placeholder: string, label?: string): string {
        return TextInputComponent.generate({
            id,
            name: id,
            type: 'password',
            placeholder,
            label,
            autocomplete: 'current-password'
        });
    }

    /**
     * Generates a search input (convenience method)
     */
    public static search(placeholder: string, id?: string): string {
        return TextInputComponent.generate({
            id,
            type: 'search',
            placeholder
        });
    }

    /**
     * Generates an email input (convenience method)
     */
    public static email(id: string, placeholder: string, label?: string): string {
        return TextInputComponent.generate({
            id,
            name: id,
            type: 'email',
            placeholder,
            label,
            autocomplete: 'email',
            inputMode: 'email'
        });
    }
}
