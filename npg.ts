#!/usr/bin/env node

import { execSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const NPG_HOME: string = process.env.NPG_HOME ?? join(homedir(), ".local", "npg");
const NPG_BIN_DIR: string = process.env.NPG_BIN_DIR ?? join(homedir(), ".local", "bin");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function die(message: string): never {
  console.error(`npg: ${message}`);
  process.exit(1);
}

/** Run a command inside NPG_HOME, inheriting stdio. */
function npm(args: string[]): void {
  execSync(["npm", ...args].join(" "), {
    cwd: NPG_HOME,
    stdio: "inherit",
  });
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
      JSON.stringify(
        { name: "npm-global", private: true, description: "Global packages managed by npg" },
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

/**
 * Resolve a package spec (e.g. "typescript", "@scope/pkg", "@scope/pkg@5",
 * ".", "../foo") to the directory name it will occupy in node_modules.
 */
function pkgDirName(spec: string): string {
  // Local path – read the package.json from that directory
  if (spec.startsWith(".") || spec.startsWith("/")) {
    const dir = resolve(spec);
    const pkgFile = join(dir, "package.json");
    if (!existsSync(pkgFile)) die(`No package.json found in ${dir}`);
    const pkg = JSON.parse(readFileSync(pkgFile, "utf-8"));
    if (!pkg.name) die(`package.json in ${dir} has no name field`);
    return pkg.name;
  }
  // Strip version/tag: "@scope/pkg@1.2.3" → "@scope/pkg", "pkg@latest" → "pkg"
  if (spec.startsWith("@")) {
    // Scoped: first @ is scope, optional second @ is version
    const rest = spec.slice(1);
    const slashIdx = rest.indexOf("/");
    if (slashIdx === -1) return spec; // bare "@scope" – unlikely but pass through
    const afterSlash = rest.slice(slashIdx + 1);
    const atIdx = afterSlash.indexOf("@");
    if (atIdx === -1) return spec;
    return spec.slice(0, slashIdx + 2 + atIdx); // "@" + rest up to second "@"
  }
  const atIdx = spec.indexOf("@");
  if (atIdx === -1) return spec;
  return spec.slice(0, atIdx);
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
    bins.set(name!, pkg.bin);
  } else {
    for (const [name, path] of Object.entries(pkg.bin)) {
      bins.set(name, path as string);
    }
  }
  return bins;
}

/** Create symlinks in NPG_BIN_DIR for a package's bins. */
function linkBins(pkgName: string): void {
  const bins = readBins(pkgName);
  if (bins.size === 0) return;

  ensureBinDir();
  for (const [name] of bins) {
    const source = join(NPG_HOME, "node_modules", ".bin", name);
    const target = join(NPG_BIN_DIR, name);

    try {
      const stat = lstatSync(target);
      if (stat.isSymbolicLink()) {
        unlinkSync(target);
      } else {
        console.warn(`npg: ${target} already exists and is not a symlink, skipping`);
        continue;
      }
    } catch {
      // Doesn't exist, good
    }

    symlinkSync(source, target);
    console.log(`  ${name} → ${source}`);
  }
}

/** Remove symlinks in NPG_BIN_DIR for a package's bins. */
function unlinkBins(pkgName: string): void {
  const bins = readBins(pkgName);
  for (const [name] of bins) {
    const target = join(NPG_BIN_DIR, name);
    try {
      const stat = lstatSync(target);
      if (stat.isSymbolicLink()) {
        unlinkSync(target);
        console.log(`  removed ${name}`);
      }
    } catch {
      // doesn't exist, fine
    }
  }
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

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Resolve a spec to an absolute path if it's a local path, otherwise return as-is. */
function resolveSpec(spec: string): string {
  if (spec.startsWith(".") || spec.startsWith("/")) {
    return resolve(spec);
  }
  return spec;
}

function cmdInstall(args: string[]): void {
  if (args.length === 0) die("usage: npg install <pkg...>");
  ensureHome();

  // Resolve names before install (for local paths we need the name)
  const names = args.map(pkgDirName);
  // Resolve relative paths so they work from NPG_HOME cwd
  const specs = args.map(resolveSpec);

  npm(["install", ...specs]);

  for (const name of names) {
    linkBins(name);
  }
}

function cmdUninstall(args: string[]): void {
  if (args.length === 0) die("usage: npg uninstall <pkg...>");
  ensureHome();

  // Read bins before uninstalling so we know what to remove
  for (const name of args) {
    unlinkBins(name);
  }

  npm(["uninstall", ...args]);
}

function cmdLs(): void {
  ensureHome();
  npm(["ls", "--depth=0"]);
}

function cmdUpdate(args: string[]): void {
  const dryRun = args.includes("--dry-run");
  const pkgs = args.filter((a) => a !== "--dry-run");

  ensureHome();

  if (dryRun) {
    npm(["outdated", ...pkgs]);
    return;
  }

  npm(["update", ...pkgs]);

  // Re-symlink all bins in case versions changed
  const packages = pkgs.length > 0 ? pkgs : installedPackages();
  for (const name of packages) {
    linkBins(name);
  }
}

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

const [command, ...args] = process.argv.slice(2);

if (!command || command === "--help" || command === "-h") {
  console.log(`npg – Global npm package manager with lockfile support

Usage: npg <command> [options]

Commands:
  install <pkg...>       Install packages globally (aliases: add, i)
  uninstall <pkg...>     Uninstall packages (aliases: remove, rm)
  ls                     List installed packages (alias: list)
  update [pkg...]        Update packages (alias: up)
  update --dry-run       Show outdated packages without updating

Environment:
  NPG_HOME               Package directory (default: ~/.local/npg)
  NPG_BIN_DIR            Symlink directory (default: ~/.local/bin)`);
  process.exit(0);
}

const resolved = ALIASES[command] ?? command;

switch (resolved) {
  case "install":
    cmdInstall(args);
    break;
  case "uninstall":
    cmdUninstall(args);
    break;
  case "ls":
    cmdLs();
    break;
  case "update":
    cmdUpdate(args);
    break;
  default:
    die(`unknown command: ${command}`);
}
