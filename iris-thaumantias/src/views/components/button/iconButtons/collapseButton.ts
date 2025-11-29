export interface CollapseButtonOptions {
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
    /** Initial collapsed state */
    collapsed?: boolean;
    /** Direction the chevron points when expanded */
    direction?: 'down' | 'up' | 'left' | 'right';
    /** ID of the element to toggle (for aria-controls) */
    targetId?: string;
}

/**
 * Generates a collapse/expand toggle button with a chevron icon
 * - Transparent background by default
 * - Shows background on hover
 * - Rotates chevron based on collapsed state
 * - Fixed size (compact)
 */
export class CollapseButton {
    public static generate(options: CollapseButtonOptions = {}): string {
        const {
            id = '',
            command = '',
            disabled = false,
            className = '',
            title = 'Toggle',
            collapsed = false,
            direction = 'down',
            targetId = ''
        } = options;

        const classes = [
            'icon-btn',
            'icon-btn-collapse',
            collapsed ? 'is-collapsed' : '',
            `icon-btn-collapse--${direction}`,
            disabled ? 'icon-btn-disabled' : '',
            className
        ].filter(Boolean).join(' ');

        const idAttr = id ? ` id="${id}"` : '';
        const disabledAttr = disabled ? ' disabled' : '';
        const onclickAttr = command && !disabled ? ` onclick="${command}"` : '';
        const titleAttr = title ? ` title="${title}"` : '';
        const ariaExpanded = ` aria-expanded="${collapsed ? 'false' : 'true'}"`;
        const ariaControls = targetId ? ` aria-controls="${targetId}"` : '';

        // Chevron icon (points down by default, CSS rotates based on direction/state)
        const chevronIcon = `<svg class="collapse-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;

        return `
            <button 
                class="${classes}"${idAttr}${disabledAttr}${onclickAttr}${titleAttr}${ariaExpanded}${ariaControls}
                aria-label="${title}"
            >
                ${chevronIcon}
            </button>
        `;
    }

    /**
     * Generates JavaScript for toggling collapse state
     * Call this once in your page to enable toggle functionality
     */
    public static generateScript(): string {
        return `
            (function initCollapseButtons() {
                document.addEventListener('click', function(event) {
                    const targetElement = event.target instanceof Element ? event.target : null;
                    const btn = targetElement ? targetElement.closest('.icon-btn-collapse') : null;
                    if (!btn || btn.hasAttribute('disabled')) {
                        return;
                    }

                    // Toggle collapsed state on the button
                    const isCollapsed = btn.classList.toggle('is-collapsed');
                    btn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');

                    // If there's an aria-controls target, toggle its visibility
                    const targetId = btn.getAttribute('aria-controls');
                    if (targetId) {
                        const target = document.getElementById(targetId);
                        if (target) {
                            target.classList.toggle('is-collapsed', isCollapsed);
                            target.setAttribute('aria-hidden', isCollapsed ? 'true' : 'false');
                        }
                    }
                });
            })();
        `;
    }
}
