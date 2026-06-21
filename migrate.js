#!/usr/bin/env node
'use strict';
// migrate.js — run database migrations on purpose, with visible output.
//
// Usage:
//   DATABASE_URL=postgres://...  node migrate.js      # migrate production (Neon)
//   node migrate.js                                   # migrate local SQLite
//   node migrate.js --status                          # show applied/pending, don't change anything
//
// This calls the SAME runner the app uses at boot (db.init), so results are
// identical — but here you watch it happen and get a non-zero exit code if it
// fails, which makes it safe to wire into a deploy step.
//
// Recommended workflow for any schema change:
//   1. Add a new migrations/NNN_name.sql file.
//   2. Deploy code.
//   3. Run `DATABASE_URL=... node migrate.js` (or let boot apply it) and confirm ✓.

const db = require('./db');

async function main() {
  const statusOnly = process.argv.includes('--status');
  const engine = process.env.DATABASE_URL ? 'postgres (DATABASE_URL)' : 'sqlite (local)';
  console.log(`[migrate.js] target: ${engine}`);

  if (statusOnly) {
    // Ensure the tracking table exists, then just report.
    await db.run(`CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)`);
    const applied = new Set((await db.all('SELECT id FROM _migrations', [])).map(r => r.id));
    const fs = require('node:fs'); const path = require('node:path');
    let files = [];
    try { files = fs.readdirSync(path.join(__dirname, 'migrations')).filter(f => /^\d+.*\.sql$/.test(f)).sort(); } catch {}
    console.log('\n  status   migration');
    console.log('  ------   ---------');
    for (const f of files) {
      const id = f.replace(/\.sql$/, '');
      console.log(`  ${applied.has(id) ? 'APPLIED ' : 'PENDING '} ${id}`);
    }
    console.log('');
    process.exit(0);
  }

  // db.init() runs schema + the versioned migration runner + post-migrate backfill.
  // Pass --run-heavy to also execute deferred HEAVY data conversions (e.g. a big
  // re-score/scale shift) that are intentionally skipped on the serverless boot path
  // to avoid timeouts. Running them here is safe — no serverless time limit.
  const runHeavy = process.argv.includes('--run-heavy');
  if (runHeavy) console.log('[migrate.js] --run-heavy: heavy data conversions WILL run.');
  await db.init({ allowHeavy: runHeavy });
  console.log('[migrate.js] done ✓');
  process.exit(0);
}

main().catch(e => {
  console.error('[migrate.js] FAILED:', e.message);
  process.exit(1); // non-zero so a deploy step/CI catches it
});
