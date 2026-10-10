import { afterEach, describe, expect, it } from 'vitest';
import i18n from '../lib/i18n.ts';
import { ApiError } from './client.ts';
import { errorMessage, fieldErrorsFrom } from './errors.ts';

describe('errorMessage', () => {
  afterEach(() => i18n.changeLanguage('en'));

  it('translates known API error codes', async () => {
    const error = new ApiError(409, 'username_taken', 'This username is already taken');
    expect(errorMessage(error)).toBe('This username is already taken.');
    await i18n.changeLanguage('it');
    expect(errorMessage(error)).toBe('Questo nome utente è già in uso.');
  });

  it('falls back to the server message for unknown codes', () => {
    const error = new ApiError(418, 'teapot' as never, 'I am a teapot');
    expect(errorMessage(error)).toBe('I am a teapot');
  });

  it('reports network failures in plain words', () => {
    expect(errorMessage(new ApiError(0, 'network_error', 'Failed to fetch'))).toMatch(
      /Cannot reach the server/,
    );
  });

  it('maps 422 details to translated field messages', async () => {
    const error = new ApiError(422, 'validation_failed', 'Some fields are invalid', [
      { path: 'username', message: 'Use 1-30 letters, digits or underscores' },
      { path: 'fields.0.name', message: 'Too long' },
    ]);
    await i18n.changeLanguage('it');
    expect(fieldErrorsFrom(error)).toEqual({
      username: 'Usa da 1 a 30 lettere, cifre o trattini bassi.',
      'fields.0.name': 'Too long',
    });
  });
});
