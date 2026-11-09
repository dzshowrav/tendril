import { existsSync, mkdirSync, statSync, appendFileSync, renameSync, unlinkSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerOptions {
  logFilePath: string;
  maxSizeBytes?: number; // Default 5 MB
  maxFiles?: number;     // Default 4 (.1 to .4)
  toConsole?: boolean;   // Default false in daemon, true in CLI/dev
  level?: LogLevel;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class Logger {
  private logFilePath: string;
  private maxSizeBytes: number;
  private maxFiles: number;
  private toConsole: boolean;
  private currentLevel: LogLevel;
  private registeredSecrets: Set<string> = new Set();

  constructor(options: LoggerOptions) {
    this.logFilePath = options.logFilePath;
    this.maxSizeBytes = options.maxSizeBytes ?? 5 * 1024 * 1024; // 5 MB
    this.maxFiles = options.maxFiles ?? 4;
    this.toConsole = options.toConsole ?? false;
    this.currentLevel = options.level ?? 'info';

    const dir = dirname(this.logFilePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }

  public registerSecret(secret: string | null | undefined): void {
    if (secret && typeof secret === 'string' && secret.trim().length >= 4) {
      this.registeredSecrets.add(secret.trim());
    }
  }

  public redact(text: string): string {
    if (!text || typeof text !== 'string') return text;

    let redacted = text;

    // 1. Redact dynamically registered secrets
    for (const secret of this.registeredSecrets) {
      if (secret) {
        redacted = redacted.replaceAll(secret, '[REDACTED]');
      }
    }

    // 2. Redact Bearer tokens: Bearer <token>
    redacted = redacted.replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, 'Bearer [REDACTED]');

    // 3. Redact Cookie tokens: tdl_session=<token>
    redacted = redacted.replace(/tdl_session=[^;\s&]+/gi, 'tdl_session=[REDACTED]');

    // 4. Redact common API key formats (sk-..., ant-...)
    redacted = redacted.replace(/\b(sk-[A-Za-z0-9_\-]{10,}|ant-[A-Za-z0-9_\-]{10,})\b/gi, '[REDACTED]');

    // 5. Redact headers like authorization: ..., x-api-key: ...
    redacted = redacted.replace(/((?:authorization|x-api-key)\s*:\s*)([^\r\n,]+)/gi, '$1[REDACTED]');

    // 6. Redact sensitive JSON properties
    redacted = redacted.replace(/"(apiKey|token|cliToken|password|secret)"\s*:\s*"[^"]+"/gi, '"$1": "[REDACTED]"');

    return redacted;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.currentLevel];
  }

  private rotateIfNeeded(): void {
    try {
      if (!existsSync(this.logFilePath)) return;
      const stat = statSync(this.logFilePath);
      if (stat.size < this.maxSizeBytes) return;

      // Rotate: daemon.log.4 is deleted, 3 -> 4, 2 -> 3, 1 -> 2, daemon.log -> daemon.log.1
      const oldest = `${this.logFilePath}.${this.maxFiles}`;
      if (existsSync(oldest)) {
        unlinkSync(oldest);
      }

      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const source = `${this.logFilePath}.${i}`;
        const target = `${this.logFilePath}.${i + 1}`;
        if (existsSync(source)) {
          renameSync(source, target);
        }
      }

      const firstBackup = `${this.logFilePath}.1`;
      renameSync(this.logFilePath, firstBackup);
    } catch {
      // Rotation failures shouldn't crash the host
    }
  }

  private write(level: LogLevel, message: string, meta?: unknown): void {
    if (!this.shouldLog(level)) return;

    const timestamp = new Date().toISOString();
    let formatted = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

    if (meta !== undefined) {
      if (meta instanceof Error) {
        formatted += `\n${meta.stack || meta.message}`;
      } else if (typeof meta === 'object') {
        try {
          formatted += ` ${JSON.stringify(meta)}`;
        } catch {
          formatted += ` [Unserializable Object]`;
        }
      } else {
        formatted += ` ${String(meta)}`;
      }
    }

    const safeText = this.redact(formatted) + '\n';

    if (this.toConsole) {
      if (level === 'error') {
        console.error(safeText.trimEnd());
      } else if (level === 'warn') {
        console.warn(safeText.trimEnd());
      } else {
        console.log(safeText.trimEnd());
      }
    }

    try {
      this.rotateIfNeeded();
      appendFileSync(this.logFilePath, safeText, { mode: 0o600, encoding: 'utf-8' });
      try {
        chmodSync(this.logFilePath, 0o600);
      } catch {}
    } catch {
      // Silently discard log write failures
    }
  }

  public debug(message: string, meta?: unknown): void {
    this.write('debug', message, meta);
  }

  public info(message: string, meta?: unknown): void {
    this.write('info', message, meta);
  }

  public warn(message: string, meta?: unknown): void {
    this.write('warn', message, meta);
  }

  public error(message: string, meta?: unknown): void {
    this.write('error', message, meta);
  }
}
