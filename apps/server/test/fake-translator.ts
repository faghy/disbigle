import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const WORDS: Record<string, string> = {
  Ciao: 'Hola',
  amici: 'amigos',
  oggi: 'hoy',
  andiamo: 'vamos',
  'al mare': 'a la playa',
  domani: 'mañana',
};

/** A translation service with LibreTranslate's API that knows a few Italian words. */
export async function startFakeTranslator() {
  const requests: { source: string; target: string; q: string[] }[] = [];
  const server = createServer((request, response) => {
    let data = '';
    request.on('data', (chunk) => {
      data += chunk;
    });
    request.on('end', () => {
      response.setHeader('content-type', 'application/json');
      if (request.url === '/languages') {
        const all = ['en', 'es', 'it'];
        response.end(
          JSON.stringify(all.map((code) => ({ code, targets: all.filter((t) => t !== code) }))),
        );
        return;
      }
      const body = JSON.parse(data) as { q: string[]; source: string; target: string };
      requests.push(body);
      const translate = (text: string) =>
        Object.entries(WORDS).reduce((t, [from, to]) => t.replaceAll(from, to), text);
      response.setHeader('x-translation-provider', 'Bergamot');
      response.end(
        JSON.stringify({
          translatedText: body.q.map(translate),
          ...(body.source === 'auto'
            ? { detectedLanguage: { language: 'it', confidence: 90 } }
            : {}),
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    close: () => server.close(),
  };
}
