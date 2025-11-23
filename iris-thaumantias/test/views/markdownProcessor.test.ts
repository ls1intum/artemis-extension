import * as assert from 'assert';
import { processMarkdown } from '../../src/views/utils/markdownProcessor';

suite('Markdown Processor Test Suite', () => {
    test('should extract download links', () => {
        const markdown = 'Download [file.pdf](/api/core/files/123/file.pdf) here';
        const result = processMarkdown(markdown);
        
        assert.strictEqual(result.downloadLinks.length, 1);
        assert.strictEqual(result.downloadLinks[0].text, 'file.pdf');
        assert.strictEqual(result.downloadLinks[0].url, '/api/core/files/123/file.pdf');
    });

    test('should extract PlantUML diagrams', () => {
        const markdown = '@startuml\nclass A\n@enduml';
        const result = processMarkdown(markdown);
        
        assert.strictEqual(result.plantUmlDiagrams.length, 1);
        assert.ok(result.plantUmlDiagrams[0].includes('@startuml'));
        assert.ok(result.html.includes('plantuml-placeholder'));
    });

    test('should convert code blocks to HTML', () => {
        const markdown = '```java\npublic class Test {}\n```';
        const result = processMarkdown(markdown);
        
        assert.ok(result.html.includes('<pre class="code-block">'));
        assert.ok(result.html.includes('language-java'));
        assert.ok(result.html.includes('public class Test'));
    });

    test('should convert headers', () => {
        const markdown = '# Header 1\n## Header 2\n### Header 3';
        const result = processMarkdown(markdown);
        
        assert.ok(result.html.includes('<h1>Header 1</h1>'));
        assert.ok(result.html.includes('<h2>Header 2</h2>'));
        assert.ok(result.html.includes('<h3>Header 3</h3>'));
    });

    test('should convert bold text', () => {
        const markdown = '**bold text**';
        const result = processMarkdown(markdown);
        
        assert.ok(result.html.includes('<strong>bold text</strong>'));
    });

    test('should convert inline code', () => {
        const markdown = 'Use `someFunction()` to do this';
        const result = processMarkdown(markdown);
        
        assert.ok(result.html.includes('<code>someFunction()</code>'));
    });

    test('should handle empty markdown', () => {
        const result = processMarkdown('');
        
        assert.ok(result.html);
        assert.strictEqual(result.downloadLinks.length, 0);
        assert.strictEqual(result.plantUmlDiagrams.length, 0);
    });

    test('should convert tables to HTML', () => {
        const markdown = '| Col1 | Col2 |\n|------|------|\n| A | B |';
        const result = processMarkdown(markdown);
        
        assert.ok(result.html.includes('<table'));
        assert.ok(result.html.includes('Col1'));
        assert.ok(result.html.includes('Col2'));
    });

    test('should escape HTML in code blocks', () => {
        const markdown = '```html\n<script>alert("xss")</script>\n```';
        const result = processMarkdown(markdown);
        
        assert.ok(result.html.includes('&lt;script&gt;'));
        assert.ok(!result.html.includes('<script>alert'));
    });
});
