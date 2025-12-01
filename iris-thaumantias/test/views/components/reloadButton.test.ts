import * as assert from 'assert';
import { ReloadButton, type ReloadButtonOptions } from '../../../src/views/components/button/iconButtons/reloadButton';

suite('ReloadButton Component Test Suite', () => {
    test('should generate basic reload button HTML', () => {
        const html = ReloadButton.generate();

        assert.ok(html.includes('class="icon-btn icon-btn-reload"'));
        assert.ok(html.includes('aria-label="Reload"'));
        assert.ok(html.includes('title="Reload"'));
        assert.ok(html.includes('<svg')); // Should contain refresh icon
    });

    test('should include custom id when provided', () => {
        const html = ReloadButton.generate({ id: 'myReloadBtn' });

        assert.ok(html.includes('id="myReloadBtn"'));
    });

    test('should include onclick handler when command provided', () => {
        const html = ReloadButton.generate({ command: 'reloadData()' });

        assert.ok(html.includes('onclick="reloadData()"'));
    });

    test('should not include onclick when disabled', () => {
        const html = ReloadButton.generate({
            command: 'reloadData()',
            disabled: true
        });

        assert.ok(!html.includes('onclick='));
        assert.ok(html.includes('disabled'));
        assert.ok(html.includes('icon-btn-disabled'));
    });

    test('should use custom title for tooltip and aria-label', () => {
        const html = ReloadButton.generate({ title: 'Refresh Course Data' });

        assert.ok(html.includes('title="Refresh Course Data"'));
        assert.ok(html.includes('aria-label="Refresh Course Data"'));
    });

    test('should add loading class and disable when loading', () => {
        const html = ReloadButton.generate({
            command: 'reloadData()',
            loading: true
        });

        assert.ok(html.includes('icon-btn-loading'));
        assert.ok(html.includes('disabled'));
        assert.ok(!html.includes('onclick=')); // No onclick when loading
        assert.ok(html.includes('title="Loading..."'));
        assert.ok(html.includes('aria-label="Loading..."'));
    });

    test('should include custom className', () => {
        const html = ReloadButton.generate({ className: 'my-custom-class' });

        assert.ok(html.includes('my-custom-class'));
    });

    test('should combine multiple options correctly', () => {
        const options: ReloadButtonOptions = {
            id: 'courseReloadBtn',
            command: 'reloadCourse(123)',
            title: 'Reload Course',
            className: 'course-reload'
        };

        const html = ReloadButton.generate(options);

        assert.ok(html.includes('id="courseReloadBtn"'));
        assert.ok(html.includes('onclick="reloadCourse(123)"'));
        assert.ok(html.includes('title="Reload Course"'));
        assert.ok(html.includes('course-reload'));
        assert.ok(html.includes('icon-btn'));
        assert.ok(html.includes('icon-btn-reload'));
    });
});
