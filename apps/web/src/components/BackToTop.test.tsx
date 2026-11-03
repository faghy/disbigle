import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { aliceUser } from '../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../test/utils.tsx';

describe('back to top', () => {
  it('shows up after scrolling down and takes you back to the top', async () => {
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /timelines/home': { body: [] },
    });
    renderApp('/');
    await screen.findByRole('main');
    expect(screen.queryByRole('button', { name: 'Back to top' })).not.toBeInTheDocument();

    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    Object.defineProperty(window, 'scrollY', { value: 2000, configurable: true });
    fireEvent.scroll(window);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Back to top' }));
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));

    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    fireEvent.scroll(window);
    expect(screen.queryByRole('button', { name: 'Back to top' })).not.toBeInTheDocument();
    scrollTo.mockRestore();
  });
});
