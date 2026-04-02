import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../');
const cliPath = path.join(projectRoot, 'bin', 'flow-complexity.ts');

function runCli(args: string[]): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync(
      'npx',
      ['tsx', cliPath, ...args],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
    return { stdout, stderr: '', status: 0 };
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: execErr.stdout ?? '',
      stderr: execErr.stderr ?? '',
      status: execErr.status ?? 1,
    };
  }
}

describe('CLI — help text', () => {
  it('includes the analyze command', () => {
    const { stdout } = runCli(['--help']);
    expect(stdout).toContain('analyze');
  });

  it('analyze --help includes --threshold option', () => {
    const { stdout } = runCli(['analyze', '--help']);
    expect(stdout).toContain('--threshold');
  });

  it('analyze --help includes --llm-runs option', () => {
    const { stdout } = runCli(['analyze', '--help']);
    expect(stdout).toContain('--llm-runs');
  });

  it('analyze --help includes --llm-provider option', () => {
    const { stdout } = runCli(['analyze', '--help']);
    expect(stdout).toContain('--llm-provider');
  });

  it('analyze --help includes --llm-model option', () => {
    const { stdout } = runCli(['analyze', '--help']);
    expect(stdout).toContain('--llm-model');
  });

  it('analyze --help includes --confidence-min option', () => {
    const { stdout } = runCli(['analyze', '--help']);
    expect(stdout).toContain('--confidence-min');
  });

  it('analyze --help includes --output option', () => {
    const { stdout } = runCli(['analyze', '--help']);
    expect(stdout).toContain('--output');
  });

  it('analyze --help includes --no-llm option', () => {
    const { stdout } = runCli(['analyze', '--help']);
    expect(stdout).toContain('--no-llm');
  });
});

describe('CLI — default values in help text', () => {
  it('shows default threshold O(n^2)', () => {
    const { stdout } = runCli(['analyze', '--help']);
    expect(stdout).toContain('O(n^2)');
  });

  it('shows default llm-runs 3', () => {
    const { stdout } = runCli(['analyze', '--help']);
    expect(stdout).toContain('3');
  });

  it('shows default output format tree', () => {
    const { stdout } = runCli(['analyze', '--help']);
    expect(stdout).toContain('tree');
  });

  it('shows default confidence-min 0.5', () => {
    const { stdout } = runCli(['analyze', '--help']);
    expect(stdout).toContain('0.5');
  });

  it('shows default llm-provider anthropic', () => {
    const { stdout } = runCli(['analyze', '--help']);
    expect(stdout).toContain('anthropic');
  });
});
