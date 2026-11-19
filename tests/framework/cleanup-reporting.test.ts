import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

interface ReportedResult {
  status: string;
  errors: { message?: string }[];
  stdout: { text?: string }[];
}

interface ReportedSpec {
  title: string;
  tests: { results: ReportedResult[] }[];
}

await test('Playwright records test, provisioning, and cleanup errors without custom reporting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pw-cleanup-reporting-'));
  const fixturePath = fileURLToPath(new URL('../../src/fixtures/test.ts', import.meta.url));
  const cliPath = fileURLToPath(
    new URL('../../node_modules/@playwright/test/cli.js', import.meta.url),
  );
  try {
    // Run the real framework fixtures with offline account operations. Intentional failures
    // live outside application test discovery and never contact the practice application.
    await writeFile(
      join(directory, 'cleanup.spec.ts'),
      `import { test as frameworkTest, expect } from ${JSON.stringify(fixturePath)};

const test = frameworkTest.extend({
  api: async ({}, use, info) => {
    await use({
      accounts: {
        create: async () => { throw new Error('PROVISION_FAILURE'); },
        delete: async (user, options) => {
          expect(user.email).toContain('@example.com');
          expect(options).toEqual({ retryOn503: true });
          console.log('CLEANUP_ATTEMPTED');
          if (['cleanup-only', 'both-fail', 'setup-and-cleanup'].includes(info.title))
            throw new Error('CLEANUP_FAILURE');
          return { httpStatus: 200, body: { responseCode: 200 } };
        },
      },
    });
  },
});

for (const title of ['all-pass', 'cleanup-only', 'body-only', 'both-fail']) {
  test(title, async ({ userDraft }) => {
    expect(userDraft.email).toContain('@example.com');
    if (['body-only', 'both-fail'].includes(title)) throw new Error('BODY_FAILURE');
  });
}

test('setup-and-cleanup', async ({ account }) => {
  throw new Error('BODY_SHOULD_NOT_RUN');
});
`,
    );
    await writeFile(
      join(directory, 'playwright.config.cjs'),
      `module.exports = {
  testDir: __dirname,
  outputDir: require('path').join(__dirname, 'artifacts'),
  workers: 1,
  retries: 0,
  timeout: 3000,
  reporter: 'json',
};
`,
    );
    const run = spawnSync(process.execPath, [cliPath, 'test', '--config', directory], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 20_000,
      env: { ...process.env, CI: 'false', AGENT_SEED: '0' },
    });
    assert.ifError(run.error);
    assert.equal(run.status, 1, run.stderr); // Four deliberately failing test attempts.
    const report = JSON.parse(run.stdout) as { suites: { specs: ReportedSpec[] }[] };
    const outcomes = report.suites.flatMap((suite) =>
      suite.specs.map((spec) => {
        assert.equal(spec.tests.length, 1);
        const results = spec.tests[0]!.results;
        assert.equal(results.length, 1);
        const result = results[0]!;
        assert.equal(
          result.stdout.filter((item) => item.text?.includes('CLEANUP_ATTEMPTED')).length,
          1,
        );
        return {
          title: spec.title,
          status: result.status,
          errors: result.errors.map((error) =>
            error.message?.split('\n')[0]?.replace(/^Error: /, ''),
          ),
        };
      }),
    );
    assert.deepEqual(outcomes, [
      { title: 'all-pass', status: 'passed', errors: [] },
      { title: 'cleanup-only', status: 'failed', errors: ['CLEANUP_FAILURE'] },
      { title: 'body-only', status: 'failed', errors: ['BODY_FAILURE'] },
      { title: 'both-fail', status: 'failed', errors: ['BODY_FAILURE', 'CLEANUP_FAILURE'] },
      {
        title: 'setup-and-cleanup',
        status: 'failed',
        errors: ['PROVISION_FAILURE', 'CLEANUP_FAILURE'],
      },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
