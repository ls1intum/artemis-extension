import { IconDefinitions } from '../../../../utils/iconDefinitions';

export interface CheckmarkButtonOptions {
    /** Button ID attribute */
    id?: string;
    /** Button click command */
    command?: string;
    /** Whether button is disabled */
    disabled?: boolean;
    /** Additional CSS classes */
    className?: string;
    /** Tooltip title */
    title?: string;
}

/**
 * Generates a checkmark icon button (for accept/confirm actions)
 * - Transparent background by default
 * - Shows background on hover
 * - Fixed size (compact)
 */
export class CheckmarkButton {
    public static generate(options: CheckmarkButtonOptions = {}): string {
        const {
            id = '',
            command = '',
            disabled = false,
            className = '',
            title = 'Confirm'
        } = options;

        const classes = [
            'icon-btn',
            'icon-btn-checkmark',
            disabled ? 'icon-btn-disabled' : '',
            className
        ].filter(Boolean).join(' ');

        const idAttr = id ? ` id="${id}"` : '';
        const disabledAttr = disabled ? ' disabled' : '';
        const onclickAttr = command && !disabled ? ` onclick="${command}"` : '';
        const titleAttr = title ? ` title="${title}"` : '';

        // You can use a simple checkmark SVG or get from IconDefinitions if available
        const checkmarkIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13.5 4L6 11.5L2.5 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;

        return `
            <button 
                class="${classes}"${idAttr}${disabledAttr}${onclickAttr}${titleAttr}
                aria-label="${title}"
            >
                ${checkmarkIcon}
            </button>
        `;
    }
}
