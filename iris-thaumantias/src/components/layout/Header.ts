export interface HeaderProps {
    title: string;
    subtitle?: string;
    icon?: string;
    actions?: string;
    className?: string;
    attributes?: Record<string, string | number | boolean | undefined>;
}

const buildAttributes = (attributes?: Record<string, string | number | boolean | undefined>): string => {
    if (!attributes) {
        return '';
    }

    return Object.entries(attributes)
        .filter(([, value]) => value !== undefined && value !== false)
        .map(([key, value]) => {
            if (value === true) {
                return key;
            }
            const escaped = String(value).replace(/"/g, '&quot;');
            return `${key}="${escaped}"`;
        })
        .join(' ');
};

export const Header = ({ title, subtitle, icon, actions, className, attributes }: HeaderProps): string => {
    const classes = ['iris-header'];
    if (className) {
        classes.push(className);
    }

    const attrs = [`class="${classes.join(' ')}"`, buildAttributes(attributes)]
        .filter(Boolean)
        .join(' ');

    const iconMarkup = icon ? `<span class="iris-header__icon">${icon}</span>` : '';
    const subtitleMarkup = subtitle ? `<p class="iris-header__subtitle">${subtitle}</p>` : '';
    const actionsMarkup = actions ? `<div class="iris-header__actions">${actions}</div>` : '';

    return `
<header ${attrs}>
    <div class="iris-header__content">
        ${iconMarkup}
        <div class="iris-header__titles">
            <h1 class="iris-header__title">${title}</h1>
            ${subtitleMarkup}
        </div>
    </div>
    ${actionsMarkup}
</header>
`.trim();
};
