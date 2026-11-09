/**
 * Safety hard guard: classifies shell commands to detect catastrophic actions.
 * Heuristic safety net that runs in every mode (even yolo).
 */

const CATASTROPHIC_PATTERNS: RegExp[] = [
  // 1. Recursive destructive file deletion at root, home, prefix, or current dir
  /\brm\s+.*-(?:[a-zA-Z]*r[a-zA-Z]*f|[a-zA-Z]*f[a-zA-Z]*r)[a-zA-Z]*\s+.*?(?:[/~]|\$HOME|\$PREFIX|\.\s*$|\.\/\s*$|\*)/i,
  /\brm\s+.*--recursive\s+.*--force\s+.*?(?:[/~]|\$HOME|\$PREFIX|\.\s*$|\.\/\s*$|\*)/i,
  /\brm\s+.*--force\s+.*--recursive\s+.*?(?:[/~]|\$HOME|\$PREFIX|\.\s*$|\.\/\s*$|\*)/i,
  /\brm\s+.*-[a-zA-Z]*r[a-zA-Z]*\s+.*-[a-zA-Z]*f[a-zA-Z]*\s+.*?(?:[/~]|\$HOME|\$PREFIX|\.\s*$|\.\/\s*$|\*)/i,
  /\brm\s+.*-[a-zA-Z]*f[a-zA-Z]*\s+.*-[a-zA-Z]*r[a-zA-Z]*\s+.*?(?:[/~]|\$HOME|\$PREFIX|\.\s*$|\.\/\s*$|\*)/i,
  /\brm\s+-(?:rf|fr)\s+(?:\/|\/\*|~|~\/|\$HOME|\$PREFIX|\.|\.\/|\*)/i,

  // 2. Fork bombs
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
  /\b(\w+)\(\)\s*\{\s*\1\s*\|\s*\1\s*&\s*\}\s*;\s*\1/,

  // 3. Raw block device writes
  /\bdd\s+.*of=\/dev\/(sd[a-z]|hd[a-z]|nvme|mmcblk|block|null|zero|urandom|loop)/i,
  />\s*\/dev\/(sd[a-z]|hd[a-z]|nvme|mmcblk|block)/i,

  // 4. Filesystem formatting & swap
  /\bmkfs(\.[a-z0-9]+)?\s+/i,
  /\bmkswap\s+\/dev\//i,

  // 5. System reboot / shutdown / wipe
  /\b(reboot|poweroff|halt|shutdown)(\s+.*)?$/i,
  /\binit\s+[06]\b/i,

  // 6. Permissions / ownership destruction at root, home, or prefix
  /\bchmod\s+.*-[a-zA-Z]*R[a-zA-Z]*\s+.*?(?:[/~]|\$HOME|\$PREFIX)/i,
  /\bchown\s+.*-[a-zA-Z]*R[a-zA-Z]*\s+.*?(?:[/~]|\$HOME|\$PREFIX)/i,

  // 7. Disk wiping tools
  /\b(shred|wipefs)\s+.*\/dev\//i,
];

/**
 * Returns true if the command matches any catastrophic pattern.
 */
export function isCatastrophic(command: string): boolean {
  if (!command || typeof command !== 'string') return false;

  const trimmed = command.trim();
  if (!trimmed) return false;

  // Check the full command string
  for (const pattern of CATASTROPHIC_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }

  // Also check individual sub-commands split by command separators: ;, &&, ||, |, \n
  const subCommands = trimmed.split(/[;&|\n]+/);
  if (subCommands.length > 1) {
    for (const sub of subCommands) {
      const subTrimmed = sub.trim();
      if (!subTrimmed) continue;
      for (const pattern of CATASTROPHIC_PATTERNS) {
        if (pattern.test(subTrimmed)) {
          return true;
        }
      }
    }
  }

  return false;
}
