// Command line entry point:
//   pnpm --filter @disbigle/diaspora-import import -- --source postgres://… \
//     --uploads /srv/diaspora/public/uploads [--dry-run] [--batch-size 500] [--include-private-details]
// The Disbigle side is configured from the environment, like the server (DATABASE_URL,
// PUBLIC_URL, LOCAL_DOMAIN, MEDIA_DIR, …).
import { parseArgs } from 'node:util';
import { loadConfig } from '@disbigle/config';
import { LocalMediaStorage, MemoryKeyValueStore } from '@disbigle/core';
import { createDatabase } from '@disbigle/db';
import { type ImportProgress, importDiasporaPod } from './import.ts';

const usage = `Usage: import --source <postgres-url> [--uploads <diaspora public/uploads>] [--dry-run]
              [--batch-size <n>] [--include-private-details]`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' },
      uploads: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'batch-size': { type: 'string' },
      'include-private-details': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  if (values.help || !values.source) {
    console.log(usage);
    return values.help ? 0 : 2;
  }
  if (!/^postgres(ql)?:\/\//.test(values.source)) {
    console.error('Only PostgreSQL sources are supported for now (postgres://…).');
    return 2;
  }

  const config = loadConfig();
  const { db, close } = createDatabase(config.DATABASE_URL, { max: 4 });
  let lastPhase = '';
  const onProgress = (p: ImportProgress) => {
    if (p.phase !== lastPhase) {
      if (lastPhase) process.stderr.write('\n');
      lastPhase = p.phase;
    }
    process.stderr.write(`\r${p.phase}: ${p.processed}${p.total !== null ? `/${p.total}` : ''}`);
  };

  try {
    const summary = await importDiasporaPod({
      source: values.source,
      target: { db, config, kv: new MemoryKeyValueStore() },
      options: {
        ...(values.uploads
          ? { uploadsDir: values.uploads, mediaStorage: new LocalMediaStorage(config.MEDIA_DIR) }
          : {}),
        dryRun: values['dry-run'],
        ...(values['batch-size'] ? { batchSize: Number(values['batch-size']) } : {}),
        includePrivateProfileDetails: values['include-private-details'],
        onProgress,
      },
    });
    process.stderr.write('\n');
    console.log(
      `\ndiaspora* import into ${summary.domain}${summary.dryRun ? ' (dry run, nothing written)' : ''}`,
    );
    console.table(summary.counts);
    console.log(`Files copied: ${summary.filesCopied}, missing: ${summary.filesMissing}`);
    console.log(`Duration: ${(summary.durationMs / 1000).toFixed(1)} s`);
    if (summary.warningCount > 0) {
      console.log(`\nWarnings (${summary.warningCount}):`);
      for (const warning of summary.warnings) console.log(`  - ${warning}`);
      if (summary.warningCount > summary.warnings.length) {
        console.log(`  … and ${summary.warningCount - summary.warnings.length} more`);
      }
    }
    return 0;
  } finally {
    await close();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
