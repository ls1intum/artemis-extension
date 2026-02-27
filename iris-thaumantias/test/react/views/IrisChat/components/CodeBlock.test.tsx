import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock shiki before importing the component (structure tests only — no token testing)
vi.mock('shiki/core', () => ({
	createHighlighterCore: vi.fn().mockResolvedValue({
		getLoadedLanguages: vi.fn().mockReturnValue(['javascript', 'typescript', 'python']),
		codeToHtml: vi.fn().mockImplementation((code: string, { lang }: { lang: string }) => {
			return `<pre class="shiki"><code class="language-${lang}">${code}</code></pre>`;
		}),
	}),
}));

vi.mock('shiki/engine/javascript', () => ({
	createJavaScriptRegexEngine: vi.fn().mockReturnValue({}),
}));

// Mock all shiki language/theme imports
vi.mock('shiki/themes/github-dark.mjs', () => ({ default: {} }));
vi.mock('shiki/themes/github-light.mjs', () => ({ default: {} }));
vi.mock('shiki/langs/javascript.mjs', () => ({ default: {} }));
vi.mock('shiki/langs/typescript.mjs', () => ({ default: {} }));
vi.mock('shiki/langs/python.mjs', () => ({ default: {} }));
vi.mock('shiki/langs/java.mjs', () => ({ default: {} }));
vi.mock('shiki/langs/asm.mjs', () => ({ default: {} }));
vi.mock('shiki/langs/shellscript.mjs', () => ({ default: {} }));
vi.mock('shiki/langs/c.mjs', () => ({ default: {} }));
vi.mock('shiki/langs/cpp.mjs', () => ({ default: {} }));
vi.mock('shiki/langs/csharp.mjs', () => ({ default: {} }));
vi.mock('shiki/langs/dart.mjs', () => ({ default: {} }));
vi.mock('shiki/langs/go.mjs', () => ({ default: {} }));
vi.mock('shiki/langs/haskell.mjs', () => ({ default: {} }));
vi.mock('shiki/langs/kotlin.mjs', () => ({ default: {} }));
vi.mock('shiki/langs/matlab.mjs', () => ({ default: {} }));
vi.mock('shiki/langs/ocaml.mjs', () => ({ default: {} }));
vi.mock('shiki/langs/r.mjs', () => ({ default: {} }));
vi.mock('shiki/langs/ruby.mjs', () => ({ default: {} }));
vi.mock('shiki/langs/rust.mjs', () => ({ default: {} }));
vi.mock('shiki/langs/swift.mjs', () => ({ default: {} }));
vi.mock('shiki/langs/vhdl.mjs', () => ({ default: {} }));
vi.mock('shiki/langs/sql.mjs', () => ({ default: {} }));
vi.mock('shiki/langs/json.mjs', () => ({ default: {} }));
vi.mock('shiki/langs/yaml.mjs', () => ({ default: {} }));
vi.mock('shiki/langs/html.mjs', () => ({ default: {} }));
vi.mock('shiki/langs/css.mjs', () => ({ default: {} }));
vi.mock('shiki/langs/markdown.mjs', () => ({ default: {} }));
vi.mock('shiki/langs/xml.mjs', () => ({ default: {} }));

import { CodeBlock } from '../../../../../src/views/webview/react/views/IrisChat/components/CodeBlock';

describe('CodeBlock', () => {
	beforeEach(() => {
		// Mock clipboard API using defineProperty (navigator.clipboard is read-only in some environments)
		const clipboardMock = {
			writeText: vi.fn().mockResolvedValue(undefined),
		};
		Object.defineProperty(navigator, 'clipboard', {
			value: clipboardMock,
			writable: true,
			configurable: true,
		});
	});

	it('renders the code block container', async () => {
		const { container } = render(<CodeBlock language="javascript">const x = 1;</CodeBlock>);
		await waitFor(() => {
			// Container div renders immediately
			expect(container.firstChild).toBeInTheDocument();
		});
	});

	it('displays language label in header', () => {
		render(<CodeBlock language="typescript">const x: number = 1;</CodeBlock>);
		expect(screen.getByText('typescript')).toBeInTheDocument();
	});

	it('displays "text" as default language label when no language provided', () => {
		render(<CodeBlock>some plain text</CodeBlock>);
		expect(screen.getByText('text')).toBeInTheDocument();
	});

	it('renders copy button', () => {
		render(<CodeBlock language="javascript">const x = 1;</CodeBlock>);
		const copyButton = screen.getByRole('button', { name: 'Copy code' });
		expect(copyButton).toBeInTheDocument();
	});

	it('copy button shows "Copy" text initially', () => {
		render(<CodeBlock language="javascript">const x = 1;</CodeBlock>);
		expect(screen.getByText('Copy')).toBeInTheDocument();
	});

	it('copy button shows "Copied!" after click', async () => {
		render(<CodeBlock language="javascript">const x = 1;</CodeBlock>);
		const copyButton = screen.getByRole('button', { name: 'Copy code' });

		await userEvent.click(copyButton);

		await waitFor(() => {
			expect(screen.getByText('Copied!')).toBeInTheDocument();
		});
	});

	it('calls clipboard.writeText with code content when copy clicked', async () => {
		const code = 'const x = 1;';
		render(<CodeBlock language="javascript">{code}</CodeBlock>);

		const copyButton = screen.getByRole('button', { name: 'Copy code' });
		await userEvent.click(copyButton);

		expect(navigator.clipboard.writeText).toHaveBeenCalledWith(code);
	});

	it('renders highlighted HTML in code section after async highlight', async () => {
		const { container } = render(<CodeBlock language="javascript">const x = 1;</CodeBlock>);

		await waitFor(() => {
			// After async highlighting, a pre element should appear in the code section
			const preEl = container.querySelector('pre');
			expect(preEl).toBeInTheDocument();
		});
	});

	it('renders with "code" prop instead of children', async () => {
		const { container } = render(<CodeBlock language="python" code="print('hello')" />);

		await waitFor(() => {
			const preEl = container.querySelector('pre');
			expect(preEl).toBeInTheDocument();
		});
	});

	it('renders without crashing when no content provided', () => {
		expect(() => render(<CodeBlock language="javascript" />)).not.toThrow();
	});

	it('handles empty string content', () => {
		expect(() => render(<CodeBlock language="javascript">{''}</CodeBlock>)).not.toThrow();
	});
});
