import { AttributeValue, buildAttributes, mergeClassNames } from '../utils/markup';

export interface ToolbarProps {
    id?: string;
    title: string;
    leading?: string;
    actions?: string;
    className?: string;
    titleClassName?: string;
    attributes?: Record<string, AttributeValue | AttributeValue[]>;
}

export function Toolbar(props: ToolbarProps): string {
    const { id, title, leading, actions, className, titleClassName, attributes = {} } = props;
    const classes = mergeClassNames('iris-toolbar', className);

    const attributeMap: Record<string, AttributeValue | AttributeValue[]> = {
        id,
        class: classes,
        ...attributes,
    };

    const leadingMarkup = leading ? `<div class="iris-toolbar__leading">${leading}</div>` : '';
    const actionsMarkup = actions ? `<div class="iris-toolbar__actions">${actions}</div>` : '';
    const titleClasses = mergeClassNames('iris-toolbar__title', titleClassName);

    return `<header ${buildAttributes(attributeMap)}>${leadingMarkup}<h1 class="${titleClasses}">${title}</h1>${actionsMarkup}</header>`;
}
