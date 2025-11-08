export interface BackLinkOptions {
    label?: string;
    containerClass?: string | null;
    linkClass?: string;
    extraClasses?: string;
    id?: string;
    wrap?: boolean;
    asButton?: boolean;
    command?: string;
}

export class BackLinkComponent {
    private static readonly DEFAULT_COMMAND = 'backToDashboard';

    public static generateHtml(options: BackLinkOptions = {}): string {
        const {
            label = '← Back to Dashboard',
            containerClass = 'back-link-container',
            linkClass = 'back-link',
            extraClasses,
            id,
            wrap = true,
            asButton = false,
            command = BackLinkComponent.DEFAULT_COMMAND,
        } = options;

        const tagName = asButton ? 'button' : 'div';
        const classes = [linkClass, extraClasses].filter(Boolean).join(' ').trim();
        const idAttribute = id ? ` id="${id}"` : '';
        const classAttribute = classes ? ` class="${classes}"` : '';
        const commandAttribute = ` data-back-command="${command}"`;
        const element = `<${tagName}${idAttribute}${classAttribute}${commandAttribute} data-back-link="true">${label}</${tagName}>`;

        if (!wrap || containerClass === null) {
            return element;
        }

        const containerAttr = containerClass ? ` class="${containerClass}"` : '';
        return `<div${containerAttr}>${element}</div>`;
    }

    public static generateScript(): string {
        return `
        (function initializeBackLinks() {
            const backLinks = Array.from(document.querySelectorAll('[data-back-link="true"]'));
            backLinks.forEach(link => {
                if (link.dataset.backLinkInitialized === 'true') {
                    return;
                }
                link.dataset.backLinkInitialized = 'true';
                link.addEventListener('click', event => {
                    event.preventDefault();
                    const command = link.getAttribute('data-back-command') || '${BackLinkComponent.DEFAULT_COMMAND}';
                    vscode.postMessage({ command });
                });
            });
        })();
        `;
    }
}
