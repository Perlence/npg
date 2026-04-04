# npg

Global npm package manager with lockfile support.

Unlike `npm install -g`, npg maintains a proper project at `~/.local/npg` with a `package.json` and `package-lock.json`, giving you deterministic, reproducible global installs.

## Install

```bash
# Clone and bootstrap
git clone https://github.com/Perlence/npg.git
cd npg
./npg.ts install .

# npg is now available at ~/.local/bin/npg
```

Make sure `~/.local/bin` is on your PATH.

## Usage

```bash
npg install <pkg...>       # Install packages (aliases: add, i)
npg uninstall <pkg...>     # Uninstall packages (aliases: remove, rm)
npg ls                     # List installed packages (alias: list)
npg update [pkg...]        # Update packages (alias: up)
npg update --dry-run       # Show outdated packages without updating
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `NPG_HOME` | `~/.local/npg` | Project directory with package.json, lockfile, and node_modules |
| `NPG_BIN_DIR` | `~/.local/bin` | Directory where bin symlinks are created |

## How it works

npg is a thin wrapper around npm. It runs `npm install`, `npm uninstall`, etc. inside a dedicated project directory (`NPG_HOME`). After installing a package, it reads the package's `bin` field and creates symlinks in `NPG_BIN_DIR` pointing to `NPG_HOME/node_modules/.bin/<name>`.

Only binaries from explicitly installed packages are symlinked – transitive dependencies are not exposed.

## Requirements

Node.js 23.6+ (for native TypeScript type stripping).
