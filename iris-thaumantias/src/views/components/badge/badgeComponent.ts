export interface BadgeOptions {
    /** Badge label text */
    label: string;
    /** Badge variant */
    variant?: 'primary' | 'secondary' | 'success' | 'warning' | 'error';
    /** Fixed width (e.g., '120px' or '8rem') */
    width?: string;
    /** Fixed height (e.g., '32px' or '2.5rem') */
    height?: string;
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
            width,
            height,
            className = '',
            id = '',
            icon = ''
        } = options;

        const classes = [
            'badge',
            `badge-${variant}`,
            (width || height) ? 'badge-fixed-size' : '',
            className
        ].filter(Boolean).join(' ');

        const idAttr = id ? ` id="${id}"` : '';
        const inlineStyles = [];
        if (width) {
            inlineStyles.push(`width: ${width}`);
        }
        if (height) {
            inlineStyles.push(`height: ${height}`);
        }
        const styleAttr = inlineStyles.length > 0 ? ` style="${inlineStyles.join('; ')}"` : '';

        return `
            <span class="${classes}"${idAttr}${styleAttr}>
                ${icon ? `<span class="badge-icon">${icon}</span>` : ''}
                <span class="badge-label">${label}</span>
            </span>
        `;
    }
}
