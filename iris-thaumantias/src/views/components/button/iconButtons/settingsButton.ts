import { IconDefinitions } from '../../../../utils/iconDefinitions';

export interface SettingsButtonOptions {
    /** Button ID attribute */
    id?: string;
    /** Whether button is disabled */
    disabled?: boolean;
    /** Additional CSS classes */
    className?: string;
    /** Tooltip title */
    title?: string;
}

/**
 * Generates a settings/gear icon button
 * - Transparent background by default
 * - Shows background on hover
 * - Fixed size (compact)
 * - Posts 'openSettings' command on click
 */
export class SettingsButton {
    public static generate(options: SettingsButtonOptions = {}): string {
        const {
            id = 'settingsBtn',
            disabled = false,
            className = '',
            title = 'Settings'
        } = options;

        const classes = [
            'icon-btn',
            'icon-btn-settings',
            disabled ? 'icon-btn-disabled' : '',
            className
        ].filter(Boolean).join(' ');

        const idAttr = id ? ` id="${id}"` : '';
        const disabledAttr = disabled ? ' disabled' : '';
        const onclickAttr = !disabled ? ` onclick="vscode.postMessage({ command: 'openSettings' })"` : '';
        const titleAttr = title ? ` title="${title}"` : '';

        const settingsIcon = IconDefinitions.getIcon('gear');

        return `
            <button
                class="${classes}"${idAttr}${disabledAttr}${onclickAttr}${titleAttr}
                aria-label="${title}"
            >
                ${settingsIcon}
            </button>
        `;
    }
}
