import { resolve, relative, isAbsolute, sep } from 'node:path';
import { realpathSync, existsSync } from 'node:fs';

export class WorkspacePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspacePathError';
  }
}

export class WorkspaceGuard {
  public readonly workspaceRoot: string;
  public readonly workspaceReal: string;
  public readonly additionalDirs: string[];

  constructor(workspaceRoot: string, additionalDirs: string[] = []) {
    this.workspaceRoot = resolve(workspaceRoot);
    if (!existsSync(this.workspaceRoot)) {
      throw new Error(`Workspace root does not exist: ${this.workspaceRoot}`);
    }
    this.workspaceReal = realpathSync(this.workspaceRoot);
    this.additionalDirs = additionalDirs
      .filter((dir) => existsSync(dir))
      .map((dir) => realpathSync(resolve(dir)));
  }

  /**
   * Resolves a relative or absolute path against the workspace root and checks containment.
   * Throws WorkspacePathError if the path escapes workspace boundaries (via .. or symlink).
   */
  public resolvePath(targetPath: string): string {
    if (!targetPath || typeof targetPath !== 'string') {
      throw new WorkspacePathError('Target path must be a non-empty string');
    }

    // Resolve against workspace root if relative, or resolve directly if absolute
    const resolved = isAbsolute(targetPath)
      ? resolve(targetPath)
      : resolve(this.workspaceRoot, targetPath);

    // Resolve symlinks to obtain canonical path
    let canonical: string;
    if (existsSync(resolved)) {
      canonical = realpathSync(resolved);
    } else {
      // For paths that do not exist yet (e.g. new files), resolve the nearest existing parent
      canonical = this.resolveNonExistentPath(resolved);
    }

    if (!this.isContained(canonical)) {
      throw new WorkspacePathError(
        `Path "${targetPath}" resolves outside workspace: ${canonical}`,
      );
    }

    return canonical;
  }

  /**
   * Checks whether a canonical path is contained within the workspace or configured additionalDirs.
   */
  public isContained(canonicalPath: string): boolean {
    if (this.isPrefixOrExact(this.workspaceReal, canonicalPath)) {
      return true;
    }

    for (const allowedDir of this.additionalDirs) {
      if (this.isPrefixOrExact(allowedDir, canonicalPath)) {
        return true;
      }
    }

    return false;
  }

  private isPrefixOrExact(base: string, target: string): boolean {
    if (base === target) return true;
    const baseWithSep = base.endsWith(sep) ? base : base + sep;
    return target.startsWith(baseWithSep);
  }

  private resolveNonExistentPath(targetPath: string): string {
    const parts: string[] = [];
    let curr = targetPath;

    while (curr !== resolve(curr, '..') && !existsSync(curr)) {
      const parent = resolve(curr, '..');
      const base = relative(parent, curr);
      parts.unshift(base);
      curr = parent;
    }

    const realParent = existsSync(curr) ? realpathSync(curr) : curr;
    return resolve(realParent, ...parts);
  }

  /**
   * Returns path relative to workspace realpath.
   */
  public toRelative(canonicalPath: string): string {
    return relative(this.workspaceReal, canonicalPath);
  }
}
