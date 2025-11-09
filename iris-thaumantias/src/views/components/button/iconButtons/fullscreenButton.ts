export interface FullscreenButtonOptions {
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
 * Generates a fullscreen icon button (for expand/fullscreen actions)
 * - Transparent background by default
 * - Shows background on hover
 * - Fixed size (compact)
 */
export class FullscreenButton {
    public static generate(options: FullscreenButtonOptions = {}): string {
        const {
            id = '',
            command = '',
            disabled = false,
            className = '',
            title = 'Fullscreen'
        } = options;

        const classes = [
            'icon-btn',
            'icon-btn-fullscreen',
            disabled ? 'icon-btn-disabled' : '',
            className
        ].filter(Boolean).join(' ');

        const idAttr = id ? ` id="${id}"` : '';
        const disabledAttr = disabled ? ' disabled' : '';
        const onclickAttr = command && !disabled ? ` onclick="${command}"` : '';
        const titleAttr = title ? ` title="${title}"` : '';

        // Fullscreen/maximize icon
        const fullscreenIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 5V2H5M14 5V2H11M14 11V14H11M2 11V14H5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;

        return `
            <button 
                class="${classes}"${idAttr}${disabledAttr}${onclickAttr}${titleAttr}
                aria-label="${title}"
            >
                ${fullscreenIcon}
            </button>
        `;
    }
}
