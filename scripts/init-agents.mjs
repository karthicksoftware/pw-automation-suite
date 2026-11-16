import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const seedPath = new URL('../tests/seed.spec.ts', import.meta.url);
const seed = readFileSync(seedPath, 'utf8');
const cli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
let result;
try {
  result = spawnSync(
    process.execPath,
    [cli, 'init-agents', '--loop=codex', '--project=ui', ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
} finally {
  // Playwright rewrites seed.spec.ts even when it exists. Preserve our fixture contract.
  writeFileSync(seedPath, seed);
}
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
