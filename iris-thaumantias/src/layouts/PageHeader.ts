export interface PageHeaderProps {
    id?: string;
    title: string;
    subtitle?: string;
    description?: string;
    actions?: string;
    className?: string;
}

export const PageHeader = ({
    id,
    title,
    subtitle,
    description,
    actions,
    className,
}: PageHeaderProps): string => {
    const classes = ['iris-page-header'];
    if (className) {
        classes.push(className);
    }

    const idAttr = id ? ` id="${id}"` : '';
    const subtitleMarkup = subtitle ? `<p class="iris-page-header__subtitle">${subtitle}</p>` : '';
    const descriptionMarkup = description ? `<p class="iris-page-header__description">${description}</p>` : '';
    const actionsMarkup = actions ? `<div class="iris-page-header__actions">${actions}</div>` : '';

    return `
<header class="${classes.join(' ')}"${idAttr}>
    <div class="iris-page-header__content">
        <h1 class="iris-page-header__title">${title}</h1>
        ${subtitleMarkup}
        ${descriptionMarkup}
    </div>
    ${actionsMarkup}
</header>
`.trim();
};
