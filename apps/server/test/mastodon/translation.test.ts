import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFakeTranslator } from '../fake-translator.ts';
import { form, mastodonUser, useMastodonApp } from './helpers.ts';

const { app, ctx } = useMastodonApp();
let translator: Awaited<ReturnType<typeof startFakeTranslator>>;

beforeAll(async () => {
  translator = await startFakeTranslator();
  ctx().config.TRANSLATION_URL = translator.url;
});
afterAll(() => translator.close());

describe('Mastodon API: translation', () => {
  it('announces translation and translates statuses into the user language or lang', async () => {
    const alice = await mastodonUser(app);
    const bruno = await mastodonUser(app);
    const instance = (await alice.api.get('/api/v2/instance')).json();
    expect(instance.configuration.translation).toEqual({ enabled: true });
    expect((await alice.api.get('/api/v1/instance/translation_languages')).json()).toMatchObject({
      it: expect.arrayContaining(['en', 'es']),
    });

    const status = (
      await bruno.api.post(
        '/api/v1/statuses',
        form({ status: 'Ciao amici, oggi andiamo al mare tutti insieme e torniamo stasera' }),
      )
    ).json();
    expect(status.language).toBe('it');
    const response = await alice.api.post(
      `/api/v1/statuses/${status.id}/translate`,
      form({ lang: 'es' }),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      content: expect.stringContaining('Hola amigos, hoy vamos a la playa'),
      spoiler_text: '',
      detected_source_language: 'it',
      provider: 'Bergamot',
      media_attachments: [],
    });
  });
});
