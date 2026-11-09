import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, getAccent, getTheme, setAccent, setTheme } from './theme.ts';

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.accent;
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

  it('has a black mode for OLED screens, with a black browser bar', () => {
    document.head.insertAdjacentHTML('beforeend', '<meta name="theme-color" content="#cf3200">');
    setTheme('black');
    expect(document.documentElement.dataset.theme).toBe('black');
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe(
      '#000000',
    );
  });

  it('remembers an accent colour, Disbigle orange by default', () => {
    expect(getAccent()).toBe('orange');
    applyTheme();
    expect(document.documentElement.dataset.accent).toBeUndefined();
    setAccent('green');
    expect(document.documentElement.dataset.accent).toBe('green');
    expect(getAccent()).toBe('green');
    localStorage.setItem('disbigle-accent', 'fuchsia');
    expect(getAccent()).toBe('orange');
  });
});
