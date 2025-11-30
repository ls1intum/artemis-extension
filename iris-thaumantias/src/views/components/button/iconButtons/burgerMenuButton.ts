export interface BurgerMenuButtonOptions {
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
    /** Whether the menu is currently open (for animated state) */
    isOpen?: boolean;
}

/**
 * Generates a burger menu icon button (for navigation/menu actions)
 * - Transparent background by default
 * - Shows background on hover
 * - Fixed size (compact)
 */
export class BurgerMenuButton {
    public static generate(options: BurgerMenuButtonOptions = {}): string {
        const {
            id = '',
            command = '',
            disabled = false,
            className = '',
            title = 'Menu',
            isOpen = false
        } = options;

        const classes = [
            'icon-btn',
            'icon-btn-burger-menu',
            isOpen ? 'icon-btn-burger-menu-open' : '',
            disabled ? 'icon-btn-disabled' : '',
            className
        ].filter(Boolean).join(' ');

        const idAttr = id ? ` id="${id}"` : '';
        const disabledAttr = disabled ? ' disabled' : '';
        const onclickAttr = command && !disabled ? ` onclick="${command}"` : '';
        const titleAttr = title ? ` title="${title}"` : '';

        // Burger menu icon (three horizontal lines)
        const burgerIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 4H14M2 8H14M2 12H14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>`;

        return `
            <button 
                class="${classes}"${idAttr}${disabledAttr}${onclickAttr}${titleAttr}
                aria-label="${title}"
                aria-expanded="${isOpen}"
            >
                ${burgerIcon}
            </button>
        `;
    }
}
