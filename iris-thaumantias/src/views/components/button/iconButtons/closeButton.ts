export interface CloseButtonOptions {
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
 * Generates a close/X icon button (for cancel/close actions)
 * - Transparent background by default
 * - Shows background on hover
 * - Fixed size (compact)
 */
export class CloseButton {
    public static generate(options: CloseButtonOptions = {}): string {
        const {
            id = '',
            command = '',
            disabled = false,
            className = '',
            title = 'Close'
        } = options;

        const classes = [
            'icon-btn',
            'icon-btn-close',
            disabled ? 'icon-btn-disabled' : '',
            className
        ].filter(Boolean).join(' ');

        const idAttr = id ? ` id="${id}"` : '';
        const disabledAttr = disabled ? ' disabled' : '';
        const onclickAttr = command && !disabled ? ` onclick="${command}"` : '';
        const titleAttr = title ? ` title="${title}"` : '';

        // X icon
        const closeIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;

        return `
            <button 
                class="${classes}"${idAttr}${disabledAttr}${onclickAttr}${titleAttr}
                aria-label="${title}"
            >
                ${closeIcon}
            </button>
        `;
    }
}
