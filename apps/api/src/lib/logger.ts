type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const currentLevel: LogLevel = process.env.NODE_ENV === 'production' ? 'info' : 'debug';

function log(level: LogLevel, ...args: unknown[]) {
  if (levelPriority[level] < levelPriority[currentLevel]) return;
  const prefix = `[${level.toUpperCase()}]`;
  // eslint-disable-next-line no-console
  (console as any)[level === 'debug' ? 'log' : level](prefix, ...args);
}

export const logger = {
  debug: (...args: unknown[]) => log('debug', ...args),
  info: (...args: unknown[]) => log('info', ...args),
  warn: (...args: unknown[]) => log('warn', ...args),
  error: (...args: unknown[]) => log('error', ...args),
};


