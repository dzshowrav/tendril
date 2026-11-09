export interface DoctorCheck {
  id: string;
  name: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  message: string;
  fix?: string;
}

export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
}

export function parseSemver(version: string): { major: number; minor: number; patch: number } | null {
  const clean = version.replace(/^v/, '').trim();
  const parts = clean.split('.');
  if (parts.length < 2) return null;
  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);
  const patch = parts[2] ? parseInt(parts[2], 10) : 0;
  if (isNaN(major) || isNaN(minor)) return null;
  return { major, minor, patch };
}

export function checkNodeVersion(currentVersion = process.versions.node): DoctorCheck {
  const parsed = parseSemver(currentVersion);
  if (!parsed) {
    return {
      id: 'node_version',
      name: 'Node.js version',
      status: 'FAIL',
      message: `Invalid Node version: ${currentVersion}`,
      fix: 'Install Node.js 24.15 or newer (pkg install nodejs-lts)',
    };
  }

  const isSupported = parsed.major > 24 || (parsed.major === 24 && parsed.minor >= 15);
  if (isSupported) {
    return {
      id: 'node_version',
      name: 'Node.js version',
      status: 'PASS',
      message: `Node.js v${currentVersion} (>= 24.15 required)`,
    };
  }

  return {
    id: 'node_version',
    name: 'Node.js version',
    status: 'FAIL',
    message: `Node.js v${currentVersion} is older than minimum supported v24.15`,
    fix: 'Update Node.js with: pkg install nodejs-lts',
  };
}

export async function checkSqlite(): Promise<DoctorCheck> {
  try {
    const sqlite = await import('node:sqlite');
    if (sqlite && typeof sqlite.DatabaseSync === 'function') {
      return {
        id: 'sqlite',
        name: 'SQLite (node:sqlite)',
        status: 'PASS',
        message: 'Built-in node:sqlite (DatabaseSync) is supported',
      };
    }
    return {
      id: 'sqlite',
      name: 'SQLite (node:sqlite)',
      status: 'FAIL',
      message: 'DatabaseSync not found in node:sqlite module',
      fix: 'Node.js 24.15+ is required for built-in SQLite',
    };
  } catch (err) {
    return {
      id: 'sqlite',
      name: 'SQLite (node:sqlite)',
      status: 'FAIL',
      message: `Failed to import node:sqlite: ${(err as Error).message}`,
      fix: 'Ensure you are running on Node.js 24.15+ without compile flags',
    };
  }
}

export function checkTermux(): DoctorCheck {
  const prefix = process.env.PREFIX || '';
  const termuxVersion = process.env.TERMUX_VERSION;
  const isTermux = Boolean(termuxVersion || prefix.includes('com.termux'));

  if (isTermux) {
    return {
      id: 'termux',
      name: 'Termux environment',
      status: 'PASS',
      message: `Running inside Termux on Android${termuxVersion ? ` (v${termuxVersion})` : ''}`,
    };
  }

  return {
    id: 'termux',
    name: 'Termux environment',
    status: 'WARN',
    message: 'Not running in Termux (desktop/server environment)',
    fix: 'Mobile-specific features like Termux:API will be disabled',
  };
}

export async function runDoctor(): Promise<DoctorResult> {
  const nodeCheck = checkNodeVersion();
  const sqliteCheck = await checkSqlite();
  const termuxCheck = checkTermux();

  const checks = [nodeCheck, sqliteCheck, termuxCheck];
  const ok = !checks.some((c) => c.status === 'FAIL');

  return { ok, checks };
}
