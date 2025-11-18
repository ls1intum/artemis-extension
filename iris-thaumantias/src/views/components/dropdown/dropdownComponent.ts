export interface DropdownOption {
    /** Option value */
    value: string;
    /** Option label text */
    label: string;
    /** Whether this option is selected by default */
    selected?: boolean;
}

export interface DropdownOptions {
    /** Dropdown ID attribute */
    id: string;
    /** Array of dropdown options */
    options: DropdownOption[];
    /** onChange handler function name */
    onChange?: string;
    /** Additional CSS classes */
    className?: string;
    /** Size variant */
    size?: 'small' | 'medium' | 'large';
    /** Fixed height (e.g., '32px' or '2rem') */
    height?: string;
    /** Label for the dropdown */
    label?: string;
    /** Helper text below the dropdown */
    helperText?: string;
}

/**
 * Generates a styled dropdown/select component
 * - Consistent styling with theme variables
 * - Hover and focus states
 * - Size variants (small, medium, large)
 * - Optional label and helper text
 */
export class DropdownComponent {
    public static generate(options: DropdownOptions): string {
        const {
            id,
            options: dropdownOptions,
            onChange,
            className = '',
            size = 'medium',
            height,
            label,
            helperText
        } = options;

        const classes = [
            'dropdown',
            `dropdown-${size}`,
            className
        ].filter(Boolean).join(' ');

        const onChangeAttr = onChange ? ` onchange="${onChange}"` : '';
        const styleAttr = height ? ` style="height: ${height}"` : '';
        
        const optionsHtml = dropdownOptions.map(option => {
            const selectedAttr = option.selected ? ' selected' : '';
            return `<option value="${option.value}"${selectedAttr}>${option.label}</option>`;
        }).join('');

        const labelHtml = label ? `<label class="dropdown-label" for="${id}">${label}</label>` : '';
        const helperTextHtml = helperText ? `<span class="dropdown-helper-text">${helperText}</span>` : '';

        if (label || helperText) {
            return `
                <div class="dropdown-group">
                    ${labelHtml}
                    <select id="${id}" class="${classes}"${onChangeAttr}${styleAttr}>
                        ${optionsHtml}
                    </select>
                    ${helperTextHtml}
                </div>
            `;
        }

        return `<select id="${id}" class="${classes}"${onChangeAttr}${styleAttr}>${optionsHtml}</select>`;
    }
}
