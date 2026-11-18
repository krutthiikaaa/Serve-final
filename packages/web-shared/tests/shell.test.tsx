import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../src/layout';
import { IconGrid } from '../src/ui/icons';

afterEach(cleanup);

describe('Shell', () => {
  it('exposes a mobile navigation toggle that opens and closes the drawer', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Shell
          product="Admin portal"
          nav={[{ to: '/', label: 'Dashboard', icon: <IconGrid /> }]}
          onSignOut={vi.fn()}
          topbar={<strong>Title</strong>}
        >
          <p>Page body</p>
        </Shell>
      </MemoryRouter>,
    );

    const toggle = screen.getByRole('button', { name: 'Open navigation' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    const close = screen.getByRole('button', { name: 'Close navigation' });
    expect(close).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('.shell')).toHaveClass('shell-nav-open');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});
