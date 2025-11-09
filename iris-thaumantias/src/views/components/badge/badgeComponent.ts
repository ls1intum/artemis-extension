export interface BadgeOptions {
    /** Badge label text */
    label: string;
    /** Badge variant */
    variant?: 'primary' | 'secondary' | 'success' | 'warning' | 'error';
    /** Additional CSS classes */
    className?: string;
    /** Badge ID attribute */
    id?: string;
    /** Icon SVG string (optional, placed before label) */
    icon?: string;
}

/**
 * Generates a badge/pill component for displaying status, points, or categorical information
 * - Primary: Blue (default button color)
 * - Secondary: White with border
 * - Success: Green
 * - Warning: Yellow/Orange
 * - Error: Red
 */
export class BadgeComponent {
    public static generate(options: BadgeOptions): string {
        const {
            label,
            variant = 'primary',
            className = '',
            id = '',
            icon = ''
        } = options;

        const classes = [
            'badge',
            `badge-${variant}`,
            className
        ].filter(Boolean).join(' ');

        const idAttr = id ? ` id="${id}"` : '';

        return `
            <span class="${classes}"${idAttr}>
                ${icon ? `<span class="badge-icon">${icon}</span>` : ''}
                <span class="badge-label">${label}</span>
            </span>
        `;
    }
}
