import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

if (existsSync('.env')) loadEnvFile('.env');

const settings = z
  .object({
    BASE_URL: z.url().default('https://automationexercise.com'),
    WORKERS: z.coerce.number().int().min(1).max(8).optional(),
    TEST_RUN_ID: z.string().min(1).max(80).optional(),
    CI: z.string().optional(),
  })
  .parse(process.env);

export const environment = {
  baseURL: settings.BASE_URL.replace(/\/$/, ''),
  workers: settings.WORKERS ?? (settings.CI === 'true' ? 1 : 2),
  isCI: settings.CI === 'true',
  runId: settings.TEST_RUN_ID ?? `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
};

// Workers inherit one run identifier from the runner, while account UUIDs remain test-local.
process.env.TEST_RUN_ID = environment.runId;
