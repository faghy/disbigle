import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useDismiss } from './dismiss.ts';

function Popover() {
  const [open, setOpen] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  return (
    <main tabIndex={-1}>
      <div ref={ref}>
        <button type="button">inside</button>
        {open && <p>panel text</p>}
      </div>
      <button type="button">outside</button>
    </main>
  );
}

describe('useDismiss', () => {
  it('stays open when focus falls back to an ancestor, closes when it moves elsewhere', () => {
    render(<Popover />);
    const inside = screen.getByRole('button', { name: 'inside' });
    const main = screen.getByRole('main');
    act(() => inside.focus());
    // Clicking plain text in the panel focuses the nearest focusable ancestor.
    fireEvent.focusOut(inside, { relatedTarget: main });
    expect(screen.getByText('panel text')).toBeTruthy();
    fireEvent.focusOut(inside, { relatedTarget: screen.getByRole('button', { name: 'outside' }) });
    expect(screen.queryByText('panel text')).toBeNull();
  });
});
