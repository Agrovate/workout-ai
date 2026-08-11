{
  description = "Workout AI — full-stack dev environment (Python/uv + Node + Expo + PostgreSQL)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
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
            stdenv.cc.cc.lib
            zlib
          ];
          LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [
            pkgs.stdenv.cc.cc.lib
            pkgs.zlib
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

        devShells.firmware = pkgs.mkShell {
          name = "workout-ai-firmware";

          packages = with pkgs; [
            platformio-core   # manages xtensa toolchain + ESP-IDF components
            python311         # required by PlatformIO
            minicom           # serial monitor fallback
            git
            just
          ];

          shellHook = ''
            echo ""
            echo "╔══════════════════════════════════════════╗"
            echo "║   Workout AI — ESP32 Firmware Shell      ║"
            echo "╠══════════════════════════════════════════╣"
            echo "║  PlatformIO : $(pio --version)"
            echo "╚══════════════════════════════════════════╝"
            echo ""

            echo "  Commands:"
            echo "    just firmware-build      → compile (downloads toolchain on first run)"
            echo "    just flash               → compile + flash + open monitor"
            echo "    just firmware-monitor    → open serial monitor only"
            echo ""
          '';
        };
      }
    );
}
