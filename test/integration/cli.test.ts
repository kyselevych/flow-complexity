import { describe, it, expect } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../');
const cliPath = path.join(projectRoot, 'bin', 'flow-complexity.ts');
const fixturesPath = path.join(projectRoot, 'test', 'fixtures');

async function runCli(
  args: string[],
  env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync(
      'npx',
      ['tsx', cliPath, ...args],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        timeout: 60_000,
        env: { ...process.env, ...env },
      },
    );
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
    };
  } catch (err: unknown) {
    const execErr = err as {
      stdout?: string;
      stderr?: string;
      code?: number;
    };
    return {
      stdout: execErr.stdout ?? '',
      stderr: execErr.stderr ?? '',
      exitCode: execErr.code ?? 1,
    };
  }
}

describe('CLI integration — --no-llm mode', () => {
  it('runs successfully with --no-llm on fixture project', async () => {
    const result = await runCli(
      ['analyze', fixturesPath, '--no-llm'],
      { ANTHROPIC_API_KEY: '' },
    );

    expect(result.exitCode).not.toBe(3);
  }, 60_000);

  it('produces output with --no-llm', async () => {
    const result = await runCli(
      ['analyze', fixturesPath, '--no-llm'],
      { ANTHROPIC_API_KEY: '' },
    );

    expect(result.stdout.length + result.stderr.length).toBeGreaterThan(0);
  }, 60_000);
});

describe('CLI integration — JSON output', () => {
  it('--output json produces valid JSON', async () => {
    const result = await runCli(
      ['analyze', fixturesPath, '--no-llm', '--output', 'json'],
      { ANTHROPIC_API_KEY: '' },
    );

    expect(() => JSON.parse(result.stdout)).not.toThrow();
  }, 60_000);

  it('JSON output has expected structure', async () => {
    const result = await runCli(
      ['analyze', fixturesPath, '--no-llm', '--output', 'json'],
      { ANTHROPIC_API_KEY: '' },
    );

    const parsed = JSON.parse(result.stdout) as {
      entries: unknown[];
      exitCode: number;
      summary: {
        totalFunctions: number;
        thresholdExceeded: number;
        lowConfidence: number;
        errors: number;
      };
    };

    expect(parsed).toHaveProperty('entries');
    expect(parsed).toHaveProperty('exitCode');
    expect(parsed).toHaveProperty('summary');
    expect(Array.isArray(parsed.entries)).toBe(true);
    expect(typeof parsed.summary.totalFunctions).toBe('number');
  }, 60_000);
});

describe('CLI integration — invalid project path', () => {
  it('exits with code 3 for non-existent project path', async () => {
    const result = await runCli(
      ['analyze', '/tmp/this-path-definitely-does-not-exist-flow-complexity-test'],
    );

    expect(result.exitCode).toBe(3);
  }, 15_000);

  it('prints error message for non-existent project path', async () => {
    const result = await runCli(
      ['analyze', '/tmp/this-path-definitely-does-not-exist-flow-complexity-test'],
    );

    expect(result.stderr).toContain('Error');
  }, 15_000);
});

describe('CLI integration — exit code semantics', () => {
  it('exit code is a number 0–3', async () => {
    const result = await runCli(
      ['analyze', fixturesPath, '--no-llm'],
      { ANTHROPIC_API_KEY: '' },
    );

    expect([0, 1, 2, 3]).toContain(result.exitCode);
  }, 60_000);

  it('JSON exitCode field matches process exit code', async () => {
    const result = await runCli(
      ['analyze', fixturesPath, '--no-llm', '--output', 'json'],
      { ANTHROPIC_API_KEY: '' },
    );

    const parsed = JSON.parse(result.stdout) as { exitCode: number };
    expect(parsed.exitCode).toBe(result.exitCode);
  }, 60_000);
});
