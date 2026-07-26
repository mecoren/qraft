# Qraft

> A local-first developer toolbox built with Rust + Tauri + React.

## Prerequisites

- [Node.js](https://nodejs.org/) 22+ (managed via `.nvmrc`)
- [pnpm](https://pnpm.io/) 9+ (`corepack enable`)
- [Rust](https://www.rust-lang.org/) stable (1.85+, managed via `src-tauri/rust-toolchain.toml`)

### Platform-specific requirements

- **Windows**: Visual Studio Build Tools 2022 with C++ desktop workload + WebView2
- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **Linux**: `sudo apt install libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`

## Getting Started

```bash
# Clone the repository
git clone <repo-url> qraft
cd qraft

# Install dependencies
pnpm install

# Copy environment template
cp .env.example .env

# Start development (full desktop app)
pnpm tauri dev

# Or start frontend only (HMR)
pnpm dev
```

## Scripts

| Command            | Description                            |
| ------------------ | -------------------------------------- |
| `pnpm dev`         | Start Vite dev server (frontend only)  |
| `pnpm tauri dev`   | Start Tauri + React development        |
| `pnpm build`       | Build frontend for production          |
| `pnpm tauri build` | Build desktop app for current platform |
| `pnpm test`        | Run frontend tests                     |
| `pnpm lint`        | Run ESLint                             |
| `pnpm format`      | Format code with Prettier              |
| `pnpm typecheck`   | Run TypeScript type checking           |

## Project Structure

```
qraft/
├── src/              # React frontend
├── src-tauri/        # Rust + Tauri backend
├── .github/          # CI/CD workflows
├── prd/              # Product requirement documents
└── docs/             # User documentation
```

## Tech Stack

- **Rust** (stable, edition 2024) — Core engine
- **Tauri V2** — Desktop framework
- **React 19** + **TypeScript 5.5** — UI
- **Vite 5** — Build tool
- **Tailwind CSS 3.4** — Styling
- **pnpm 9** — Package manager

## License

MIT
