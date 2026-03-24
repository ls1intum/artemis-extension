import type { IrisChatMessageContent } from '../../types';

export function extractIrisMessageContent(content: unknown): string {
    if (content && Array.isArray(content) && content.length > 0) {
        return content.map((item: IrisChatMessageContent) => {
            if (item.textContent) {
                return item.textContent;
            }
            return item.toString?.() ?? String(item);
        }).join('\n');
    }
    if (typeof content === 'string') {
        return content;
    }
    return JSON.stringify(content);
}
