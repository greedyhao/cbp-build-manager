# CBP Build Manager — Agent Guide

## Project Overview

VS Code extension for managing and building Code::Blocks projects (.cbp files).
Converts .cbp projects to compile_commands.json via [cbp2clangd](https://github.com/greedyhao/cbp2clangd), then builds using Ninja.

## Tech Stack

- **Language**: TypeScript
- **Runtime**: Node.js 18+
- **Bundler**: esbuild (single file output: `dist/extension.js`)
- **Package manager**: pnpm
- **Formatter**: Prettier (`.prettierrc`)
- **Linter**: ESLint (`eslint.config.mjs`)
- **VS Code SDK**: `@types/vscode` ~1.80.0

## Key Files & Directories

| Path | Purpose |
|------|---------|
| `src/extension.ts` | Extension entry point — `activate()` function |
| `src/services/DataManager.ts` | Core business logic, manages queue/scan |
| `src/providers/` | Tree view data providers (BuildQueue, ProjectLibrary, CompileCommands) |
| `src/terminal/TerminalManager.ts` | Pseudoterminal management for build output |
| `src/models/` | Data models (CbpProjectItem, etc.) |
| `src/utils/` | Utilities (encoding, streaming line buffers, formatting, version comparison) |
| `dist/extension.js` | Compiled output (bundled by esbuild) |
| `package.json` | Extension manifest & scripts |

## Commands & Contributions

All commands are registered in `contributes.commands` in `package.json`:
- Prefix: `cbp-build-manager.`
- Category: `"CBP"` (required for command palette visibility)
- Examples: `cbp-build-manager.buildSelected`, `cbp-build-manager.generateToolchainConfig`

## Build & Release

```bash
pnpm install          # Install dependencies
pnpm run compile      # Dev build (type-check + lint + esbuild)
pnpm run vsix         # Production build + create .vsix package
```

`pnpm run vsix` runs `vscode:prepublish` → `pnpm run package` → `vsce package`.

## Code Conventions

- **Quotes**: Double quotes (`"` not `'`)
- **Semicolons**: Required
- **Trailing commas**: Always (all)
- **Print width**: 80
- **Indentation**: 2 spaces
- **Line endings**: auto (CRLF/LF)
- Format with Prettier before committing

## Testing

```bash
pnpm run test         # Run all tests
```

## Activation

- No `activationEvents` in package.json — VS Code infers activation from contributions
- Activated on view open (`onView:cbpBuildQueue`, etc.) or command execution
- All commands must have `registerCommand` in `activate()` and be declared in `contributes.commands`

## Key Architectural Notes

- `CbpDataManager` is the central service — manages project scanning, queue state, and compile commands
- Tree views use VS Code's `TreeDataProvider` with checkbox support
- Build output uses Pseudoterminal with ANSI color support
- stdout and stderr must each own a line buffer (`StreamOutputBuffer` in `src/utils/CommonUtils.ts`). Feeding both streams into one buffer glues their half-lines into lines that exist in neither stream, which is both unreadable and wrong (the caret column of a diagnostic no longer lines up)
- A line ends on `\r`, `\n` or `\r\n`: build scripts emit bare-`\r` progress text (e.g. `"app.g.bin" successful`), and compiler diagnostics write the trailing `^` caret line without a newline
- Queue persistence: `.cbp-build/queue.json` in the workspace root
- Extension kind: workspace (runs in workspace extension host)
