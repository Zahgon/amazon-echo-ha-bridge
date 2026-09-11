/**
 * Console logging in Spring Boot's default Logback layout.
 *
 * The original writes through `org.apache.log4j.Logger`, which Spring Boot
 * routes to Logback's console appender under `CONSOLE_LOG_PATTERN`:
 *
 *   %d{yyyy-MM-dd HH:mm:ss.SSS} %5p ${PID} --- [%15.15t] %-40.40logger{39} : %m%n
 *
 * The log line is observable output, so the layout is reproduced here rather
 * than approximated. Node has a single execution thread, so the thread column
 * is always `main`.
 */

export type Level = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LEVEL_ORDER: Record<Level, number> = {
  TRACE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
};

/** Spring Boot's default root level. `log.debug(...)` is therefore suppressed. */
let threshold: Level = 'INFO';

/** Test seam: silence the console without changing what callers do. */
let sink: (line: string) => void = (line) => process.stdout.write(`${line}\n`);

export function setRootLevel(level: Level): void {
  threshold = level;
}

export function setSink(next: (line: string) => void): void {
  sink = next;
}

export function resetSink(): void {
  sink = (line) => process.stdout.write(`${line}\n`);
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function pad3(value: number): string {
  return value.toString().padStart(3, '0');
}

/** `%d{yyyy-MM-dd HH:mm:ss.SSS}` in the JVM's default (here: local) zone. */
export function formatTimestamp(at: Date): string {
  return (
    `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())} ` +
    `${pad2(at.getHours())}:${pad2(at.getMinutes())}:${pad2(at.getSeconds())}.` +
    pad3(at.getMilliseconds())
  );
}

/**
 * Logback's `TargetLengthBasedClassNameAbbreviator`: shorten package segments
 * to their first character, left to right, until the name fits `target`.
 */
export function abbreviateLoggerName(name: string, target: number): string {
  if (name.length <= target) {
    return name;
  }
  const parts = name.split('.');
  const out = [...parts];
  let total = name.length;
  for (let i = 0; i < parts.length - 1 && total > target; i++) {
    const part = parts[i] ?? '';
    if (part.length <= 1) {
      continue;
    }
    out[i] = part.charAt(0);
    total -= part.length - 1;
  }
  return out.join('.');
}

/** `%-40.40x`: pad right to 40, and when longer keep the *last* 40 characters. */
function fitLoggerField(name: string): string {
  const abbreviated = abbreviateLoggerName(name, 39);
  return abbreviated.length > 40
    ? abbreviated.slice(abbreviated.length - 40)
    : abbreviated.padEnd(40, ' ');
}

export function formatLine(
  at: Date,
  level: Level,
  pid: number,
  thread: string,
  loggerName: string,
  message: string,
): string {
  const threadField = thread.length > 15 ? thread.slice(thread.length - 15) : thread.padStart(15, ' ');
  return (
    `${formatTimestamp(at)} ${level.padStart(5, ' ')} ${pid} --- ` +
    `[${threadField}] ${fitLoggerField(loggerName)} : ${message}`
  );
}

/** Rendering of the `Throwable` argument the log4j API accepts. */
function renderThrowable(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  return String(error);
}

export class Logger {
  constructor(private readonly name: string) {}

  private write(level: Level, message: string, error?: unknown): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[threshold]) {
      return;
    }
    sink(formatLine(new Date(), level, process.pid, 'main', this.name, message));
    if (error !== undefined) {
      sink(renderThrowable(error));
    }
  }

  debug(message: string, error?: unknown): void {
    this.write('DEBUG', message, error);
  }

  info(message: string, error?: unknown): void {
    this.write('INFO', message, error);
  }

  warn(message: string, error?: unknown): void {
    this.write('WARN', message, error);
  }

  error(message: string, error?: unknown): void {
    this.write('ERROR', message, error);
  }
}

/** Counterpart of `org.apache.log4j.Logger.getLogger(Foo.class)`. */
export function getLogger(name: string): Logger {
  return new Logger(name);
}
