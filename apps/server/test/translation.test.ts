import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFakeTranslator } from './fake-translator.ts';
import { Client, newUser, useTestApp } from './helpers.ts';

const app = useTestApp();
let translator: Awaited<ReturnType<typeof startFakeTranslator>>;
const requests = () => translator.requests;

beforeAll(async () => {
  translator = await startFakeTranslator();
  app.ctx().config.TRANSLATION_URL = translator.url;
});
afterAll(() => translator.close());

async function signedIn() {
  const client = new Client(app);
  const user = newUser();
  const response = await client.post('/api/v1/auth/register', user);
  if (response.statusCode !== 201) throw new Error(`register failed: ${response.body}`);
  return { client, account: response.json().user.account as { id: string; username: string } };
}

const ITALIAN = 'Ciao amici, oggi andiamo al mare tutti insieme e torniamo stasera';

describe('translation of posts', () => {
  it('says the server translates, and guesses the language of posts that have none', async () => {
    const bruno = await signedIn();
    expect((await bruno.client.get('/api/v1/instance')).json()).toMatchObject({
      translation: true,
      translationLanguages: { it: ['en', 'es'], es: ['en', 'it'] },
    });
    const post = (await bruno.client.post('/api/v1/statuses', { content: ITALIAN })).json();
    expect(post.language).toBe('it');
    const short = (await bruno.client.post('/api/v1/statuses', { content: 'Ciao!' })).json();
    expect(short.language).toBeNull();
  });

  it('translates into the reader language, keeping mentions, hashtags and links', async () => {
    const alice = await signedIn();
    const bruno = await signedIn();
    const post = (
      await bruno.client.post('/api/v1/statuses', {
        content: `${ITALIAN} con @${alice.account.username}, #estate https://example.org/mare`,
        summary: 'Ciao, domani',
      })
    ).json();
    const before = requests().length;

    const response = await alice.client.post(`/api/v1/statuses/${post.id}/translate`, {
      lang: 'es-ES',
    });
    expect(response.statusCode).toBe(200);
    const translation = response.json();
    expect(translation).toMatchObject({
      sourceLanguage: 'it',
      language: 'es',
      provider: 'Bergamot',
      summary: 'Hola, mañana',
    });
    expect(translation.content).toContain('Hola amigos, hoy vamos a la playa');
    expect(translation.content).toContain(`>@${alice.account.username}</a>`);
    expect(translation.content).toContain('#<span>estate</span></a>');
    expect(translation.content).toContain('href="https://example.org/mare"');
    // The service never saw them, only placeholders.
    const sent = requests().at(-1);
    expect(sent).toMatchObject({ source: 'it', target: 'es' });
    expect(sent?.q[0]).not.toContain(alice.account.username);
    expect(sent?.q[0]).not.toContain('estate');

    // Kept: asked again, the service is not called; after an edit it is.
    const again = await alice.client.post(`/api/v1/statuses/${post.id}/translate`, { lang: 'es' });
    expect(again.json().content).toBe(translation.content);
    expect(requests().length).toBe(before + 1);
    await bruno.client.put(`/api/v1/statuses/${post.id}`, { content: 'Ciao amici, oggi piove' });
    const edited = await alice.client.post(`/api/v1/statuses/${post.id}/translate`, {
      lang: 'es',
    });
    expect(edited.json().content).toContain('Hola amigos, hoy piove');
    expect(requests().length).toBe(before + 2);
  });

  it('refuses posts already in that language, posts the reader cannot see and visitors', async () => {
    const alice = await signedIn();
    const bruno = await signedIn();
    const post = (await bruno.client.post('/api/v1/statuses', { content: ITALIAN })).json();
    const same = await alice.client.post(`/api/v1/statuses/${post.id}/translate`, { lang: 'it' });
    expect(same.statusCode).toBe(422);
    expect(same.json().error).toBe('translation_unavailable');

    const secret = (
      await bruno.client.post('/api/v1/statuses', { content: ITALIAN, visibility: 'followers' })
    ).json();
    const hidden = await alice.client.post(`/api/v1/statuses/${secret.id}/translate`, {
      lang: 'es',
    });
    expect(hidden.statusCode).toBe(404);

    const visitor = new Client(app);
    expect(
      (await visitor.post(`/api/v1/statuses/${post.id}/translate`, { lang: 'es' })).statusCode,
    ).toBe(401);
  });

  it('answers translation_unavailable when the service is down', async () => {
    const alice = await signedIn();
    const bruno = await signedIn();
    const post = (await bruno.client.post('/api/v1/statuses', { content: `${ITALIAN}!` })).json();
    app.ctx().config.TRANSLATION_URL = 'http://127.0.0.1:9';
    try {
      const response = await alice.client.post(`/api/v1/statuses/${post.id}/translate`, {
        lang: 'en',
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error).toBe('translation_unavailable');
    } finally {
      app.ctx().config.TRANSLATION_URL = translator.url;
    }
  });
});
