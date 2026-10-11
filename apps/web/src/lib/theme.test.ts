import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, getTheme, setTheme } from './theme.ts';

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('is light unless the user picks another one', () => {
    expect(getTheme()).toBe('light');
    applyTheme();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('remembers the choice on this device', () => {
    setTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(getTheme()).toBe('dark');
    setTheme('system');
    expect(getTheme()).toBe('system');
  });

  it('ignores unknown stored values', () => {
    localStorage.setItem('disbigle-theme', 'purple');
    expect(getTheme()).toBe('light');
  });
});
