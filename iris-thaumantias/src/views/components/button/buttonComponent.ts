export interface ButtonOptions {
    /** Button label text */
    label?: string;
    /** Icon SVG string (from IconDefinitions) */
    icon?: string;
    /** Button variant */
    variant?: 'primary' | 'secondary' | 'icon' | 'link';
    /** Additional CSS classes */
    className?: string;
    /** Button click command */
    command?: string;
    /** Whether button is disabled */
    disabled?: boolean;
    /** Button ID attribute */
    id?: string;
    /** Full width button */
    fullWidth?: boolean;
    /** Fixed width in pixels (e.g., '120px' or '10rem') */
    width?: string;
    /** Fixed height in pixels (e.g., '40px' or '3rem') */
    height?: string;
    /** Text alignment - 'left', 'center', or 'right' */
    alignText?: 'left' | 'center' | 'right';
    /** Custom data attributes (e.g., { filter: 'all' } becomes data-filter="all") */
    dataAttributes?: Record<string, string>;
}
/**
 * Generates a VS Code-styled button component with optional icon support.
 * 
 * @example
 * // Primary button with icon
 * ButtonComponent.generate({
 *   label: 'Save',
 *   icon: IconDefinitions.getIcon('check'),
 *   variant: 'primary',
 *   command: 'saveData'
 * });
 * 
 * // Icon-only button
 * ButtonComponent.generate({
 *   icon: IconDefinitions.getIcon('gear'),
 *   variant: 'icon',
 *   command: 'openSettings'
 * });
 */
export class ButtonComponent {
    /**
     * Generates HTML for a button
     */
    public static generate(options: ButtonOptions): string {
        const {
            label = '',
            icon = '',
            variant = 'primary',
            className = '',
            command = '',
            disabled = false,
            id = '',
            fullWidth = false,
            width,
            height,
            alignText,
            dataAttributes = {}
        } = options;

        const classes = [
            'btn',
            `btn-${variant}`,
            fullWidth ? 'btn-full-width' : '',
            disabled ? 'btn-disabled' : '',
            (width || height) ? 'btn-fixed-size' : '',
            icon && label ? 'btn-with-icon' : '',
            alignText ? `btn-align-${alignText}` : '',
            className
        ].filter(Boolean).join(' ');

        const idAttr = id ? ` id="${id}"` : '';
        const disabledAttr = disabled ? ' disabled' : '';
        const onclickAttr = command && !disabled ? ` onclick="${command}"` : '';
        
        // Build data attributes
        const dataAttrs = Object.entries(dataAttributes)
            .map(([key, value]) => ` data-${key}="${value}"`)
            .join('');
        
        // Build inline styles for fixed dimensions
        const inlineStyles = [];
        if (width) {
            inlineStyles.push(`width: ${width}`);
        }
        if (height) {
            inlineStyles.push(`height: ${height}`);
        }
        const styleAttr = inlineStyles.length > 0 ? ` style="${inlineStyles.join('; ')}"` : '';

        // Icon-only button (no label)
        if (icon && !label) {
            return `
                <button 
                    class="${classes}"${idAttr}${disabledAttr}${onclickAttr}${styleAttr}${dataAttrs}
                    aria-label="${command || 'button'}"
                >
                    ${icon}
                </button>
            `;
        }

        // Button with icon and label
        if (icon && label) {
            return `
                <button 
                    class="${classes}"${idAttr}${disabledAttr}${onclickAttr}${styleAttr}${dataAttrs}
                >
                    <span class="btn-icon">${icon}</span>
                    <span class="btn-label">${label}</span>
                </button>
            `;
        }

        // Button with label only
        return `
            <button 
                class="${classes}"${idAttr}${disabledAttr}${onclickAttr}${styleAttr}${dataAttrs}
            >
                ${label}
            </button>
        `;
    }

    /**
     * Generates a primary button
     */
    public static primary(label: string, command: string, icon?: string): string {
        return ButtonComponent.generate({
            label,
            command,
            icon,
            variant: 'primary'
        });
    }

    /**
     * Generates a secondary button
     */
    public static secondary(label: string, command: string, icon?: string): string {
        return ButtonComponent.generate({
            label,
            command,
            icon,
            variant: 'secondary'
        });
    }

    /**
     * Generates an icon-only button
     */
    public static icon(icon: string, command: string, ariaLabel?: string): string {
        return ButtonComponent.generate({
            icon,
            command,
            variant: 'icon',
            id: ariaLabel
        });
    }
}
