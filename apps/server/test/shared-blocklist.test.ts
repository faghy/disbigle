import { IFTAS_DNI, parseBlocklistCsv, syncSharedBlocklist, unblockDomain } from '@disbigle/core';
import { schema } from '@disbigle/db';
import { describe, expect, it } from 'vitest';
import { Client, newUser, useTestApp } from './helpers.ts';

const app = useTestApp();

const csv = (rows: string[]) =>
  ['#domain,#severity,#reject_media,#reject_reports,#public_comment,#obfuscate', ...rows].join(
    '\n',
  );

describe('the IFTAS "Do Not Interact" list', () => {
  it('reads the Mastodon CSV format', () => {
    expect(
      parseBlocklistCsv(
        csv([
          'hate.example,suspend,FALSE,FALSE,iftas:hate-speech;online-harassment,TRUE',
          'noisy.example,silence,FALSE,FALSE,iftas:spam,FALSE',
          'not a domain,suspend,,,,',
        ]),
      ),
    ).toEqual([
      {
        domain: 'hate.example',
        severity: 'suspend',
        labels: ['hate-speech', 'online-harassment'],
        obfuscate: true,
      },
      { domain: 'noisy.example', severity: 'silence', labels: ['spam'], obfuscate: false },
    ]);
  });

  it('follows the list, leaves hand-made blocks alone, keeps exceptions and shows it all publicly', async () => {
    const ctx = app.ctx();
    const { blockDomain } = await import('@disbigle/core');
    await blockDomain(ctx, null, {
      domain: 'manual.example',
      severity: 'silence',
      publicComment: 'Spam',
    });

    const first = parseBlocklistCsv(
      csv([
        'nicecrew.example,suspend,FALSE,FALSE,iftas:hate-speech,TRUE',
        'harass.example,suspend,FALSE,FALSE,iftas:online-harassment,FALSE',
        'manual.example,suspend,FALSE,FALSE,iftas:spam,FALSE',
      ]),
    );
    expect(await syncSharedBlocklist(ctx, IFTAS_DNI.source, first)).toEqual({
      added: ['nicecrew.example', 'harass.example'],
      removed: [],
    });

    const shown = (await new Client(app).get('/api/v1/instance/domain_blocks')).json();
    expect(shown).toEqual([
      {
        domain: 'harass.example',
        severity: 'suspend',
        comment: 'online-harassment (IFTAS DNI)',
        source: 'iftas-dni',
      },
      { domain: 'manual.example', severity: 'silence', comment: 'Spam', source: null },
      {
        domain: 'n******w.example',
        severity: 'suspend',
        comment: 'hate-speech (IFTAS DNI)',
        source: 'iftas-dni',
      },
    ]);

    // An admin opens one server; the list drops another: neither is blocked after the update.
    await new Client(app).post('/api/v1/auth/register', newUser());
    const [admin] = await ctx.db.select().from(schema.users).limit(1);
    const adminUserId = admin?.id;
    await unblockDomain(ctx, adminUserId ?? null, 'harass.example', { keepException: true });
    const second = parseBlocklistCsv(
      csv(['harass.example,suspend,FALSE,FALSE,iftas:online-harassment,FALSE']),
    );
    expect(await syncSharedBlocklist(ctx, IFTAS_DNI.source, second)).toEqual({
      added: [],
      removed: ['nicecrew.example'],
    });
    const after = (await new Client(app).get('/api/v1/instance/domain_blocks')).json();
    expect(after.map((b: { domain: string }) => b.domain)).toEqual(['manual.example']);
  });
});
