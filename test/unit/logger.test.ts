import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger } from '../../src/util/logger.js';

describe('createLogger', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('writes to stderr, not stdout', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = createLogger();
    logger.info('hello');
    expect(stderrSpy).toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
    stdoutSpy.mockRestore();
  });

  it('output includes timestamp, level, and message', () => {
    const logger = createLogger();
    logger.info('test message');
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(output).toContain('INFO');
    expect(output).toContain('test message');
  });

  it('includes prefix when provided', () => {
    const logger = createLogger({ prefix: 'MyModule' });
    logger.info('something');
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain('[MyModule]');
  });

  it('does not include prefix when not provided', () => {
    const logger = createLogger();
    logger.warn('no prefix');
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).not.toContain('[');
  });

  it('includes serialized context when provided', () => {
    const logger = createLogger();
    logger.info('msg', { file: 'foo.ts', line: 42 });
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain('"file"');
    expect(output).toContain('foo.ts');
    expect(output).toContain('42');
  });

  it('does not append context when context is empty object', () => {
    const logger = createLogger();
    logger.info('msg', {});
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output.trim()).toBe(output.trim().replace(/\{.*\}/, '').trimEnd() + '');
    expect(output).not.toContain('{');
  });

  describe('log levels', () => {
    it('default level (info) suppresses debug', () => {
      const logger = createLogger();
      logger.debug('hidden');
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('default level (info) shows info', () => {
      const logger = createLogger();
      logger.info('visible');
      expect(stderrSpy).toHaveBeenCalled();
    });

    it('default level (info) shows warn', () => {
      const logger = createLogger();
      logger.warn('visible');
      expect(stderrSpy).toHaveBeenCalled();
    });

    it('default level (info) shows error', () => {
      const logger = createLogger();
      logger.error('visible');
      expect(stderrSpy).toHaveBeenCalled();
    });

    it('debug level shows debug messages', () => {
      const logger = createLogger({ level: 'debug' });
      logger.debug('shown');
      expect(stderrSpy).toHaveBeenCalled();
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('DEBUG');
    });

    it('warn level suppresses info', () => {
      const logger = createLogger({ level: 'warn' });
      logger.info('suppressed');
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('warn level shows warn', () => {
      const logger = createLogger({ level: 'warn' });
      logger.warn('shown');
      expect(stderrSpy).toHaveBeenCalled();
    });

    it('error level suppresses warn', () => {
      const logger = createLogger({ level: 'error' });
      logger.warn('suppressed');
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('error level shows error', () => {
      const logger = createLogger({ level: 'error' });
      logger.error('shown');
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('ERROR');
    });
  });

  it('output line ends with newline', () => {
    const logger = createLogger();
    logger.info('check newline');
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output.endsWith('\n')).toBe(true);
  });
});
