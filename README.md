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
npg install [pkg...]       # Install packages (aliases: add, i)
npg uninstall <pkg...>     # Uninstall packages (aliases: remove, rm)
npg ls                     # List installed packages (alias: list)
npg outdated [pkg...]      # Show outdated packages
npg update [pkg...]        # Update packages (alias: up)
npg completion fish        # Output fish shell completions
```

`npg install` without arguments installs from `package.json`, useful after manual edits. All npm flags are passed through, e.g. `npg install --dry-run cowsay`.

## Shell completions

```fish
npg completion fish | source                              # activate for current session
npg completion fish > ~/.config/fish/completions/npg.fish # persist
```

Completions include all commands and aliases. `uninstall`, `update`, and `outdated` complete with installed package names.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `NPG_HOME` | `~/.local/npg` | Project directory with package.json, lockfile, and node_modules |
| `NPG_BIN_DIR` | `~/.local/bin` | Directory where bin symlinks are created |

## How it works

npg is a thin wrapper around npm. It runs `npm install`, `npm uninstall`, etc. inside a dedicated project directory (`NPG_HOME`). After each operation, it syncs symlinks in `NPG_BIN_DIR`:

1. Removes dangling symlinks whose targets no longer exist
2. Creates missing symlinks for bins declared by installed packages
3. Skips symlinks that are already correct

Only binaries from explicitly installed packages are symlinked – transitive dependencies are not exposed.

## Requirements

Node.js 23.6+ (for native TypeScript type stripping).
