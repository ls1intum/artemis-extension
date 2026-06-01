import { type ReactNode, useMemo } from 'react';

import { CodeBlock } from '@webview/views/IrisChat/components/CodeBlock';

/**
 * Shared Streamdown component configuration for rendering fenced code blocks
 * via the CodeBlock component. Used by MessageBubble.
 */
export function useStreamdownConfig() {
    return useMemo(() => ({
        code: ({ node, className, children, ...props }: {
            node?: unknown;
            className?: string;
            children?: ReactNode;
            [key: string]: unknown;
        }) => {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : undefined;

            if (language || className?.includes('language-')) {
                return (
                    <CodeBlock language={language}>
                        {String(children).replace(/\n$/, '')}
                    </CodeBlock>
                );
            }

            return (
                <code className={className} {...props}>
                    {children}
                </code>
            );
        },
    }), []);
}
