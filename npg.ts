#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const NPG_HOME: string =
  process.env.NPG_HOME ?? join(homedir(), ".local", "npg");
const NPG_BIN_DIR: string =
  process.env.NPG_BIN_DIR ?? join(homedir(), ".local", "bin");

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const ALIASES: Record<string, string> = {
  add: "install",
  i: "install",
  remove: "uninstall",
  rm: "uninstall",
  list: "ls",
  up: "update",
};

const COMMANDS: Record<string, (args: string[]) => void> = {
  install: cmdInstall,
  uninstall: cmdUninstall,
  ls: cmdLs,
  outdated: cmdOutdated,
  update: cmdUpdate,
  completion: cmdCompletion,
};

const [command, ...args] = process.argv.slice(2);

if (!command || command === "--help" || command === "-h") {
  console.log(`npg – Global npm package manager with lockfile support

Usage: npg <command> [options]

Commands:
  install [pkg...]       Install packages globally (aliases: add, i)
  uninstall <pkg...>     Uninstall packages (aliases: remove, rm)
  ls                     List installed packages (alias: list)
  outdated [pkg...]      Show outdated packages
  update [pkg...]        Update packages (alias: up)
  completion <shell>     Output shell completions (fish)

Environment:
  NPG_HOME               Package directory (default: ~/.local/npg)
  NPG_BIN_DIR            Symlink directory (default: ~/.local/bin)`);
  process.exit(0);
}

const resolved = ALIASES[command] ?? command;
const handler = COMMANDS[resolved];
if (!handler) die(`unknown command: ${command}`);
handler(args);

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdInstall(args: string[]): void {
  ensureHome();

  const resolved = args.map(resolveSpec);
  if (npm(["install", ...resolved]) !== 0) return;

  syncBins();
}

function cmdUninstall(args: string[]): void {
  if (args.length === 0) die("usage: npg uninstall <pkg...>");
  ensureHome();

  if (npm(["uninstall", ...args]) !== 0) return;

  syncBins();
}

function cmdLs(): void {
  ensureHome();
  process.exitCode = npm(["ls", "--depth=0"]);
}

function cmdOutdated(args: string[]): void {
  ensureHome();
  process.exitCode = npm(["outdated", ...args]);
}

function cmdCompletion(args: string[]): void {
  const shell = args[0];
  if (shell !== "fish") {
    die("usage: npg completion fish");
  }
  const dir = dirname(fileURLToPath(import.meta.url));
  const script = readFileSync(join(dir, "completions.fish"), "utf-8");
  process.stdout.write(script);
}

function cmdUpdate(args: string[]): void {
  ensureHome();

  if (npm(["update", ...args]) !== 0) return;

  syncBins();
}

// ---------------------------------------------------------------------------
// Bin symlink management
// ---------------------------------------------------------------------------

/**
 * Remove dangling symlinks in NPG_BIN_DIR, then create missing symlinks for all
 * installed packages.
 */
function syncBins(): void {
  for (const name of removeDanglingSymlinks()) {
    console.log(`  removed ${name}`);
  }
  for (const name of linkMissingBins()) {
    console.log(`  added ${name}`);
  }
}

/**
 * Remove symlinks in NPG_BIN_DIR that point into NPG_HOME but whose target no
 * longer exists.
 */
function removeDanglingSymlinks(): string[] {
  const removed: string[] = [];
  if (!existsSync(NPG_BIN_DIR)) return removed;
  const prefix = join(NPG_HOME, "/");
  for (const entry of readdirSync(NPG_BIN_DIR)) {
    const path = join(NPG_BIN_DIR, entry);
    try {
      const stat = lstatSync(path);
      if (!stat.isSymbolicLink()) continue;
      const link = readlinkSync(path);
      if (link.startsWith(prefix) && !existsSync(path)) {
        unlinkSync(path);
        removed.push(entry);
      }
    } catch (err) {
      if (!isEnoent(err)) throw err;
    }
  }
  return removed;
}

/** Create missing symlinks in NPG_BIN_DIR for all installed packages. */
function linkMissingBins(): string[] {
  const added: string[] = [];
  ensureBinDir();
  for (const pkgName of installedPackages()) {
    const bins = readBins(pkgName);
    for (const [name] of bins) {
      const source = join(NPG_HOME, "node_modules", ".bin", name);
      const target = join(NPG_BIN_DIR, name);

      try {
        const stat = lstatSync(target);
        if (stat.isSymbolicLink()) {
          if (readlinkSync(target) === source) continue;
          unlinkSync(target);
        } else {
          console.warn(
            `npg: ${target} already exists and is not a symlink, skipping`,
          );
          continue;
        }
      } catch (err) {
        if (!isEnoent(err)) throw err;
      }

      symlinkSync(source, target);
      added.push(name);
    }
  }
  return added;
}

/** Read the `bin` field from an installed package's package.json. */
function readBins(pkgName: string): Map<string, string> {
  const bins = new Map<string, string>();
  const pkgJsonPath = join(NPG_HOME, "node_modules", pkgName, "package.json");
  if (!existsSync(pkgJsonPath)) return bins;

  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  if (!pkg.bin) return bins;

  if (typeof pkg.bin === "string") {
    // Single binary – name is the package name (without scope)
    const name = pkgName.startsWith("@") ? pkgName.split("/")[1] : pkgName;
    bins.set(name, pkg.bin);
  } else {
    for (const [name, path] of Object.entries(pkg.bin)) {
      bins.set(name, path as string);
    }
  }
  return bins;
}

// ---------------------------------------------------------------------------
// Package spec helpers
// ---------------------------------------------------------------------------

/** Resolve a spec to an absolute path if it's a local path, otherwise return as-is. */
function resolveSpec(spec: string): string {
  if (spec.startsWith(".") || spec.startsWith("/")) {
    return resolve(spec);
  }
  return spec;
}

// ---------------------------------------------------------------------------
// npm & filesystem helpers
// ---------------------------------------------------------------------------

/** Run a command inside NPG_HOME, inheriting stdio. Returns the exit code. */
function npm(args: string[]): number {
  const result = spawnSync("npm", args, {
    cwd: NPG_HOME,
    stdio: "inherit",
  });
  const code = result.status ?? 1;
  if (code !== 0) process.exitCode = code;
  return code;
}

/** Ensure NPG_HOME exists with a package.json. */
function ensureHome(): void {
  if (!existsSync(NPG_HOME)) {
    mkdirSync(NPG_HOME, { recursive: true });
  }
  const pkgPath = join(NPG_HOME, "package.json");
  if (!existsSync(pkgPath)) {
    writeFileSync(
      pkgPath,
      // biome-ignore lint/style/useTemplate: wtf
      JSON.stringify(
        {
          name: "npm-global",
          private: true,
          description: "Global packages managed by npg",
        },
        null,
        2,
      ) + "\n",
    );
  }
}

/** Ensure NPG_BIN_DIR exists. */
function ensureBinDir(): void {
  if (!existsSync(NPG_BIN_DIR)) {
    mkdirSync(NPG_BIN_DIR, { recursive: true });
  }
}

function die(message: string): never {
  console.error(`npg: ${message}`);
  process.exit(1);
}

function isEnoent(err: unknown): boolean {
  return (
    err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}

/**
 * Get all explicitly installed package names from NPG_HOME/package.json
 * (the "dependencies" field).
 */
function installedPackages(): string[] {
  const pkgPath = join(NPG_HOME, "package.json");
  if (!existsSync(pkgPath)) return [];
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  return Object.keys(pkg.dependencies ?? {});
}
