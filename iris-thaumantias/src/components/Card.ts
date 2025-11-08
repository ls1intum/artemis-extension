export type CardVariant = 'surface' | 'elevated';

export interface CardProps {
    id?: string;
    variant?: CardVariant;
    className?: string;
    heading?: string;
    headingActions?: string;
    body: string;
    footer?: string;
}

export const Card = ({
    id,
    variant = 'surface',
    className,
    heading,
    headingActions,
    body,
    footer,
}: CardProps): string => {
    const classes = ['iris-card', `iris-card--${variant}`];
    if (className) {
        classes.push(className);
    }

    const idAttr = id ? ` id="${id}"` : '';
    const headingMarkup = heading
        ? `
        <header class="iris-card__header">
            <h2 class="iris-card__title">${heading}</h2>
            ${headingActions ? `<div class="iris-card__actions">${headingActions}</div>` : ''}
        </header>`
        : '';

    const footerMarkup = footer ? `<footer class="iris-card__footer">${footer}</footer>` : '';

    return `
<section class="${classes.join(' ')}"${idAttr}>
    ${headingMarkup}
    <div class="iris-card__body">${body}</div>
    ${footerMarkup}
</section>
`.trim();
};
