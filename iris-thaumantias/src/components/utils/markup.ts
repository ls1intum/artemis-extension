const attributeEscapeMap: Record<string, string> = {
    '&': '&amp;',
    '"': '&quot;',
    "'": '&#39;',
    '<': '&lt;',
    '>': '&gt;',
};

function escapeAttribute(value: string): string {
    return value.replace(/[&"'<>]/g, char => attributeEscapeMap[char]);
}

export function mergeClassNames(...classes: Array<string | undefined | null | false>): string {
    return classes.filter(Boolean).join(' ');
}

export type AttributeValue = string | number | boolean | undefined | null;

export function buildAttributes(attributes: Record<string, AttributeValue | AttributeValue[]>): string {
    const pairs: string[] = [];

    for (const [key, value] of Object.entries(attributes)) {
        if (value === undefined || value === null || value === false) {
            continue;
        }

        if (value === true) {
            pairs.push(key);
            continue;
        }

        if (Array.isArray(value)) {
            const filtered = value.filter(item => item !== undefined && item !== null && item !== false);
            if (!filtered.length) {
                continue;
            }
            pairs.push(`${key}="${escapeAttribute(filtered.join(' '))}"`);
            continue;
        }

        pairs.push(`${key}="${escapeAttribute(String(value))}"`);
    }

    return pairs.join(' ');
}
