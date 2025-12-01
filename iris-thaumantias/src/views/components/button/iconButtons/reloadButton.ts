import { IconDefinitions } from '../../../../utils/iconDefinitions';

export interface ReloadButtonOptions {
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
    /** Show loading spinner state */
    loading?: boolean;
}

/**
 * Generates a reload/refresh icon button
 * - Transparent background by default
 * - Shows background on hover
 * - Fixed size (compact)
 * - Can show loading state with spinning animation
 */
export class ReloadButton {
    public static generate(options: ReloadButtonOptions = {}): string {
        const {
            id = '',
            command = '',
            disabled = false,
            className = '',
            title = 'Reload',
            loading = false
        } = options;

        const classes = [
            'icon-btn',
            'icon-btn-reload',
            disabled ? 'icon-btn-disabled' : '',
            loading ? 'icon-btn-loading' : '',
            className
        ].filter(Boolean).join(' ');

        const idAttr = id ? ` id="${id}"` : '';
        const disabledAttr = disabled || loading ? ' disabled' : '';
        const onclickAttr = command && !disabled && !loading ? ` onclick="${command}"` : '';
        const titleAttr = title ? ` title="${loading ? 'Loading...' : title}"` : '';

        const reloadIcon = IconDefinitions.getIcon('refresh');

        return `
            <button 
                class="${classes}"${idAttr}${disabledAttr}${onclickAttr}${titleAttr}
                aria-label="${loading ? 'Loading...' : title}"
            >
                ${reloadIcon}
            </button>
        `;
    }
}
