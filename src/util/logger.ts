export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let globalLogLevel: LogLevel = 'warn';

export function setGlobalLogLevel(level: LogLevel): void {
  globalLogLevel = level;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface Logger {
  debug(msg: string, context?: Record<string, unknown>): void;
  info(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
  error(msg: string, context?: Record<string, unknown>): void;
}

export function createLogger(options?: { level?: LogLevel; prefix?: string }): Logger {
  const minLevel: LogLevel = options?.level ?? globalLogLevel;
  const prefix = options?.prefix;

  function log(level: LogLevel, msg: string, context?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;

    const timestamp = new Date().toISOString();
    const parts: string[] = [timestamp, level.toUpperCase()];
    if (prefix) parts.push(`[${prefix}]`);
    parts.push(msg);

    let line = parts.join(' ');
    if (context && Object.keys(context).length > 0) {
      line += ' ' + JSON.stringify(context);
    }

    process.stderr.write(line + '\n');
  }

  return {
    debug(msg, context) { log('debug', msg, context); },
    info(msg, context)  { log('info',  msg, context); },
    warn(msg, context)  { log('warn',  msg, context); },
    error(msg, context) { log('error', msg, context); },
  };
}
