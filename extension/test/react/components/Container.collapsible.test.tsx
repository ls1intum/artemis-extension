import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Container } from '@webview/components';

describe('Container collapsible', () => {
    it('defaultCollapsed hides the body but keeps it mounted', () => {
        render(<Container collapsible defaultCollapsed header="H"><div>BODY</div></Container>);
        const body = screen.getByText('BODY');
        expect(body).toBeInTheDocument();                 // mounted
        expect(body.closest('[data-collapsed="true"]')).not.toBeNull(); // hidden
    });
    it('clicking the header toggles collapse', () => {
        render(<Container collapsible header="H"><div>BODY</div></Container>);
        const btn = screen.getByRole('button', { name: /H/ });
        expect(screen.getByText('BODY').closest('[data-collapsed="true"]')).toBeNull();
        fireEvent.click(btn);
        expect(screen.getByText('BODY').closest('[data-collapsed="true"]')).not.toBeNull();
    });
});
