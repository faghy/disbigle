import { beforeAll, describe, expect, it } from 'vitest';
import {
  baseLanguage,
  guessLanguage,
  loadLanguageDetector,
  plainTextForLanguage,
} from '../src/social/language.ts';
import { protectForTranslation, restoreAfterTranslation } from '../src/social/translations.ts';

beforeAll(() => loadLanguageDetector());

describe('language of posts', () => {
  it('reads language tags', () => {
    expect(baseLanguage('it')).toBe('it');
    expect(baseLanguage('pt-BR')).toBe('pt');
    expect(baseLanguage('es_ES')).toBe('es');
    expect(baseLanguage('')).toBeNull();
    expect(baseLanguage('not a language')).toBeNull();
    expect(baseLanguage(null)).toBeNull();
  });

  it('guesses from the words only, and not from short texts', () => {
    const html =
      '<p>Stamattina nebbia fittissima sulla pianura, <a href="https://x.org/the-weather">the weather</a> #fog @bob@example.org</p>';
    expect(plainTextForLanguage(html)).toBe('Stamattina nebbia fittissima sulla pianura,');
    expect(guessLanguage(html)).toBe('it');
    expect(guessLanguage('<p>Hoy en el mercado compré tomates y queso fresco</p>')).toBe('es');
    expect(guessLanguage('<p>Quick reminder: the meetup moved to Thursday evening</p>')).toBe('en');
    expect(guessLanguage('<p>Grazie!</p>')).toBeNull();
  });

  it('knows short messages in Chinese, Japanese and Korean by their script', () => {
    expect(guessLanguage('<p>@alice 你好，最近怎么样？</p>')).toBe('zh');
    expect(guessLanguage('<p>谢谢你的帮助</p>')).toBe('zh');
    expect(guessLanguage('<p>ありがとうございます</p>')).toBe('ja');
    expect(guessLanguage('<p>今日は雨です</p>')).toBe('ja');
    expect(guessLanguage('<p>안녕하세요 반갑습니다</p>')).toBe('ko');
    // Too short, or a few characters in a text in another language.
    expect(guessLanguage('<p>好的</p>')).toBeNull();
    expect(
      guessLanguage('<p>Oggi ho imparato a scrivere 你好 in cinese, che bello davvero</p>'),
    ).toBe('it');
  });
});

describe('placeholders for translation', () => {
  it('takes out links, mentions and hashtags and puts them back', () => {
    const html =
      '<p>Ciao <span class="h-card"><a href="https://a.org/@bob" class="u-url mention">@<span>bob</span></a></span>, guarda #estate e @carol@b.org: <a href="https://c.org">qui</a> &#39;ok&#39;</p>';
    const { html: sent, kept } = protectForTranslation(html);
    expect(kept).toEqual([
      '<a href="https://a.org/@bob" class="u-url mention">@<span>bob</span></a>',
      '#estate',
      '@carol@b.org',
      '<a href="https://c.org">qui</a>',
    ]);
    expect(sent).not.toMatch(/bob|carol|estate|c\.org/);
    expect(sent).toContain('&#39;ok&#39;');
    expect(restoreAfterTranslation(sent, kept)).toBe(html);
  });

  it('keeps what the translator dropped, at the end, and ignores unknown placeholders', () => {
    const { kept } = protectForTranslation('<p>#uno e #due</p>');
    expect(
      restoreAfterTranslation('<p><span data-k="1">x</span> y <span data-k="7">x</span></p>', kept),
    ).toBe('<p>#due y </p> #uno');
  });
});
