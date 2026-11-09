import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { isTermuxApiAvailable } from './tools/termux-api.js';

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

export function checkGit(): DoctorCheck {
  try {
    const res = spawnSync('git', ['--version'], { encoding: 'utf8' });
    if (res.status === 0 && res.stdout) {
      return {
        id: 'git',
        name: 'Git version control',
        status: 'PASS',
        message: res.stdout.trim(),
      };
    }
  } catch {
    // ignore
  }

  return {
    id: 'git',
    name: 'Git version control',
    status: 'FAIL',
    message: 'Git is not installed or not found on PATH',
    fix: 'Install Git: pkg install git (or apt install git)',
  };
}

export function checkRipgrep(): DoctorCheck {
  try {
    const res = spawnSync('rg', ['--version'], { encoding: 'utf8' });
    if (res.status === 0 && res.stdout) {
      const firstLine = res.stdout.split('\n')[0].trim();
      return {
        id: 'ripgrep',
        name: 'Ripgrep search tool',
        status: 'PASS',
        message: firstLine,
      };
    }
  } catch {
    // ignore
  }

  return {
    id: 'ripgrep',
    name: 'Ripgrep search tool',
    status: 'WARN',
    message: 'Ripgrep (rg) not found; fallback pure-JS grep will be used on workspaces',
    fix: 'Install Ripgrep for fast searches: pkg install ripgrep',
  };
}

export interface TermuxCheckResult extends DoctorCheck {
  isTermux: boolean;
}

export function checkTermux(): TermuxCheckResult {
  const prefix = process.env.PREFIX || '';
  const termuxVersion = process.env.TERMUX_VERSION;
  const apkRelease = process.env.TERMUX_APK_RELEASE;
  const isTermux = Boolean(termuxVersion || prefix.includes('com.termux'));

  if (isTermux) {
    const details = [
      termuxVersion ? `v${termuxVersion}` : null,
      apkRelease ? `source: ${apkRelease}` : null,
    ].filter(Boolean).join(', ');

    return {
      id: 'termux',
      name: 'Termux environment',
      status: 'PASS',
      message: `Running inside Termux on Android${details ? ` (${details})` : ''}`,
      isTermux: true,
    };
  }

  return {
    id: 'termux',
    name: 'Termux environment',
    status: 'PASS',
    message: 'Not running in Termux (running on generic Linux/macOS; desktop mode)',
    isTermux: false,
  };
}

export function checkStoragePermission(isTermux: boolean): DoctorCheck {
  if (!isTermux) {
    return {
      id: 'storage_permission',
      name: 'Shared storage permission',
      status: 'PASS',
      message: 'Non-Termux environment; standard OS storage permissions apply',
    };
  }

  const sharedPath = join(homedir(), 'storage', 'shared');
  const sdcard = '/sdcard';
  const hasAccess = existsSync(sharedPath) || existsSync(sdcard);

  if (hasAccess) {
    return {
      id: 'storage_permission',
      name: 'Shared storage permission',
      status: 'PASS',
      message: 'Shared Android storage is accessible (~/storage/shared)',
    };
  }

  return {
    id: 'storage_permission',
    name: 'Shared storage permission',
    status: 'WARN',
    message: 'Shared Android storage is not accessible',
    fix: "Run 'termux-setup-storage' to grant shared storage access",
  };
}

export function checkTermuxApiSupport(isTermux: boolean): DoctorCheck {
  if (!isTermux) {
    return {
      id: 'termux_api',
      name: 'Termux:API support',
      status: 'PASS',
      message: 'Non-Termux environment; Termux:API not applicable',
    };
  }

  if (isTermuxApiAvailable()) {
    return {
      id: 'termux_api',
      name: 'Termux:API support',
      status: 'PASS',
      message: 'Termux:API commands are available',
    };
  }

  return {
    id: 'termux_api',
    name: 'Termux:API support',
    status: 'WARN',
    message: 'Termux:API package or companion app is not available',
    fix: "Run 'pkg install termux-api' and install the Termux:API companion APK from GitHub/F-Droid",
  };
}

export function checkAllowExternalApps(isTermux: boolean): DoctorCheck {
  if (!isTermux) {
    return {
      id: 'allow_external_apps',
      name: 'Allow external apps property',
      status: 'PASS',
      message: 'Non-Termux environment; property not applicable',
    };
  }

  const propsPath = join(homedir(), '.termux', 'termux.properties');
  if (existsSync(propsPath)) {
    try {
      const content = readFileSync(propsPath, 'utf8');
      if (/^\s*allow-external-apps\s*=\s*true/m.test(content)) {
        return {
          id: 'allow_external_apps',
          name: 'Allow external apps property',
          status: 'PASS',
          message: 'allow-external-apps is enabled in ~/.termux/termux.properties',
        };
      }
    } catch {
      // ignore
    }
  }

  return {
    id: 'allow_external_apps',
    name: 'Allow external apps property',
    status: 'WARN',
    message: 'allow-external-apps is not enabled (required for Android WebView shell app)',
    fix: "Add 'allow-external-apps = true' to ~/.termux/termux.properties",
  };
}

export function checkWakeLock(isTermux: boolean): DoctorCheck {
  if (!isTermux) {
    return {
      id: 'wake_lock',
      name: 'Termux wake-lock support',
      status: 'PASS',
      message: 'Non-Termux environment; wake-lock not applicable',
    };
  }

  try {
    const res = spawnSync('which', ['termux-wake-lock'], { stdio: 'ignore' });
    if (res.status === 0) {
      return {
        id: 'wake_lock',
        name: 'Termux wake-lock support',
        status: 'PASS',
        message: 'termux-wake-lock is available for background daemon execution',
      };
    }
  } catch {
    // ignore
  }

  return {
    id: 'wake_lock',
    name: 'Termux wake-lock support',
    status: 'WARN',
    message: 'termux-wake-lock not found',
    fix: "Run 'pkg install termux-tools' to enable background daemon wake-locks",
  };
}

export function checkBatteryOptimization(isTermux: boolean): DoctorCheck {
  if (!isTermux) {
    return {
      id: 'battery_optimization',
      name: 'Battery optimization & phantom processes',
      status: 'PASS',
      message: 'Non-Android environment; phantom process killer not applicable',
    };
  }

  return {
    id: 'battery_optimization',
    name: 'Battery optimization & phantom processes',
    status: 'WARN',
    message: 'Android phantom process killer or battery optimization may kill background daemons',
    fix: 'Disable battery optimization for Termux and check https://dontkillmyapp.com',
  };
}

export async function runDoctor(): Promise<DoctorResult> {
  const nodeCheck = checkNodeVersion();
  const sqliteCheck = await checkSqlite();
  const gitCheck = checkGit();
  const rgCheck = checkRipgrep();
  const termuxCheck = checkTermux();
  const isTermux = termuxCheck.isTermux;
  const storageCheck = checkStoragePermission(isTermux);
  const termuxApiCheck = checkTermuxApiSupport(isTermux);
  const allowExtAppsCheck = checkAllowExternalApps(isTermux);
  const wakeLockCheck = checkWakeLock(isTermux);
  const batteryCheck = checkBatteryOptimization(isTermux);

  const checks = [
    nodeCheck,
    sqliteCheck,
    gitCheck,
    rgCheck,
    termuxCheck,
    storageCheck,
    termuxApiCheck,
    allowExtAppsCheck,
    wakeLockCheck,
    batteryCheck,
  ];

  const ok = !checks.some((c) => c.status === 'FAIL');

  return { ok, checks };
}
