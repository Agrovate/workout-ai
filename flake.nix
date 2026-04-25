{
  description = "Workout AI — full-stack dev environment (Python/uv + Rust + Node + Expo + PostgreSQL)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    rust-overlay.url = "github:oxalica/rust-overlay";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, rust-overlay, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        overlays = [ (import rust-overlay) ];

        pkgs = import nixpkgs {
          inherit system overlays;
        };

        rustToolchain = pkgs.rust-bin.stable.latest.default.override {
          extensions = [ "rust-src" "rust-analyzer" "clippy" "rustfmt" ];
          targets = [
            "x86_64-unknown-linux-gnu"
            "wasm32-unknown-unknown"
          ];
        };
      in {
        devShells.default = pkgs.mkShell {
          name = "workout-ai";

          packages = with pkgs; [
            # ── Python ───────────────────────────────────────────
            python311
            uv

            # ── Node / JS ────────────────────────────────────────
            nodejs_20
            pnpm

            # ── Dev tools ────────────────────────────────────────
            git
            just
            curl
            jq

            # ── Formatting / linting ─────────────────────────────
            prettier
            eslint
            typescript-language-server
            pyright
          ];

          shellHook = ''
            echo ""
            echo "╔══════════════════════════════════════════════╗"
            echo "║        Workout AI — Dev Environment          ║"
            echo "╠══════════════════════════════════════════════╣"
            echo "║  Python  : $(python3 --version)"
            echo "║  uv      : $(uv --version)"
            echo "║  Node    : $(node --version)"
            echo "╚══════════════════════════════════════════════╝"
            echo ""

            echo "Quick commands:"
            echo "  just backend    → start FastAPI dev server"
            echo "  just mobile     → start Expo dev server"
            echo "  just web        → start React (Vite) dev server"
            echo "  just db         → start PostgreSQL via Docker"
            echo "  just flash      → flash ESP32 firmware"
            echo ""

            # Python path
            export PYTHONPATH="$PWD/backend:$PYTHONPATH"

            # Environment
            export DATABASE_URL="postgresql://workout:workout@localhost:5432/workoutdb"
            export JWT_SECRET="dev-secret-change-in-prod"

            # uv config
            export UV_PYTHON="$(which python3)"
            export UV_PYTHON_PREFERENCE="only-system"
          '';
        };

        devShells.rust = pkgs.mkShell {
          name = "rust-dev";

          packages = with pkgs; [
            rustToolchain
            pkg-config
            openssl
            cargo-watch
            just
            git
          ];

          shellHook = ''
            echo ""
            echo "╔══════════════════════════════════════════════╗"
            echo "║        Workout AI — Rust Environment         ║"
            echo "╠══════════════════════════════════════════════╣"
            echo "║  Rustc  : $(rustc --version)"
            echo "║  Cargo  : $(cargo --version)"
            echo "╚══════════════════════════════════════════════╝"
            echo ""

            echo "  Quick commands:"
            echo "    cargo run             → run backend service"
            echo "    cargo watch -x run    → auto-reload dev loop"
            echo "    cargo test            → run tests"
            echo "    cargo build --release → optimized build"
            echo ""

            export RUST_LOG="info"
            export RUST_BACKTRACE="1"
          '';
        };

        devShells.firmware = pkgs.mkShell {
          name = "workout-ai-firmware";

          packages = with pkgs; [
            rustToolchain
            espflash
            probe-rs-tools
            pkg-config
            libiconv
            minicom
          ];

          shellHook = ''
            echo ""
            echo "╔══════════════════════════════════════════╗"
            echo "║   Workout AI — ESP32 Firmware Shell      ║"
            echo "╠══════════════════════════════════════════╣"
            echo "║  Rust : $(rustc --version)"
            echo "╚══════════════════════════════════════════╝"
            echo ""

            echo "  Commands:"
            echo "    cargo build --release    → build firmware"
            echo "    espflash flash --monitor → flash to ESP32"
            echo "    minicom -D /dev/ttyUSB0  → serial monitor"
            echo ""

            export RUST_LOG="info"
            export RUST_BACKTRACE="1"
          '';
        };
      }
    );
}
