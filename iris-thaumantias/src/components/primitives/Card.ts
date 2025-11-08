import { AttributeValue, buildAttributes, mergeClassNames } from '../utils/markup';

export interface CardProps {
    id?: string;
    role?: string;
    className?: string;
    children: string;
    attributes?: Record<string, AttributeValue | AttributeValue[]>;
}

export function Card(props: CardProps): string {
    const { id, role, className, children, attributes = {} } = props;
    const classes = mergeClassNames('iris-card', className);

    const attributeMap: Record<string, AttributeValue | AttributeValue[]> = {
        id,
        role,
        class: classes,
        ...attributes,
    };

    return `<div ${buildAttributes(attributeMap)}>${children}</div>`;
}
