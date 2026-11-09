#!/usr/bin/env bash
# Tendril Installer for Termux on Android
# https://github.com/tendril/tendril

set -euo pipefail

# ANSI color codes
BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
CYAN='\033[36m'
RESET='\033[0m'

echo -e "${BOLD}${CYAN}=== Tendril Installer ===${RESET}"
echo -e "${DIM}The AI coding harness for Termux on Android${RESET}\n"

# 1. Environment check: verify Termux
IS_TERMUX=false
if [ -n "${TERMUX_VERSION:-}" ] || [ -d "/data/data/com.termux" ] || [[ "${PREFIX:-}" == *"com.termux"* ]]; then
  IS_TERMUX=true
fi

if [ "$IS_TERMUX" = false ]; then
  echo -e "${YELLOW}Notice:${RESET} You are running this installer outside of Termux on Android."
  echo -e "Tendril is optimized for Termux, but can run in desktop mode on Linux/macOS."
  echo -e "To install on a desktop system, run:"
  echo -e "  ${BOLD}npm install -g tendril${RESET}"
  echo -e "or clone the repository and build from source."
  if [ "${1:-}" != "--force" ]; then
    echo -e "\nTo proceed anyway, run: ${BOLD}$0 --force${RESET}"
    exit 0
  fi
fi

# Root check: strictly no sudo in Termux
if [ "$(id -u)" -eq 0 ]; then
  echo -e "${RED}Error:${RESET} Do not run this installer as root/sudo in Termux."
  echo -e "Termux packages must be installed as the default unprivileged user."
  exit 1
fi

# 2. Package installation via pkg (Termux)
if [ "$IS_TERMUX" = true ]; then
  echo -e "${CYAN}==>${RESET} Updating Termux package repositories..."
  pkg update -y

  echo -e "${CYAN}==>${RESET} Installing dependencies (nodejs-lts, git, ripgrep, termux-api, termux-tools)..."
  pkg install -y nodejs-lts git ripgrep termux-api termux-tools

  # 3. Configure ~/.termux/termux.properties
  echo -e "${CYAN}==>${RESET} Configuring Termux properties..."
  mkdir -p "$HOME/.termux"
  TERMUX_PROPS="$HOME/.termux/termux.properties"
  if [ -f "$TERMUX_PROPS" ]; then
    if grep -q "^[[:space:]]*allow-external-apps[[:space:]]*=[[:space:]]*true" "$TERMUX_PROPS"; then
      echo -e "  ${GREEN}✓${RESET} allow-external-apps is already enabled"
    else
      echo "allow-external-apps = true" >> "$TERMUX_PROPS"
      echo -e "  ${GREEN}✓${RESET} Added allow-external-apps = true to $TERMUX_PROPS"
    fi
  else
    echo "allow-external-apps = true" > "$TERMUX_PROPS"
    echo -e "  ${GREEN}✓${RESET} Created $TERMUX_PROPS with allow-external-apps = true"
  fi
fi

# 4. Verify Node.js version and SQLite
echo -e "${CYAN}==>${RESET} Verifying Node.js and built-in SQLite..."
if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}Error:${RESET} Node.js binary not found. Please install nodejs-lts."
  exit 1
fi

NODE_VERSION=$(node -v)
echo -e "  Node.js version: ${BOLD}${NODE_VERSION}${RESET}"

# Test node:sqlite DatabaseSync
if ! node -e 'import("node:sqlite").then(m => { if (!m.DatabaseSync) process.exit(1); }).catch(() => process.exit(1))'; then
  echo -e "${RED}Error:${RESET} Built-in node:sqlite is not functional on this Node.js version."
  echo -e "Node.js v24.15 or newer is required."
  exit 1
fi
echo -e "  ${GREEN}✓${RESET} Built-in node:sqlite verified"

# 5. Install or build Tendril
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

if [ -f "$REPO_ROOT/package.json" ] && grep -q '"name": "tendril-monorepo"' "$REPO_ROOT/package.json" 2>/dev/null; then
  echo -e "${CYAN}==>${RESET} Installing Tendril from local source checkout..."
  cd "$REPO_ROOT"
  npm run build
  npm link --workspace=packages/cli || npm install -g packages/cli
else
  echo -e "${CYAN}==>${RESET} Installing Tendril globally via npm..."
  npm install -g tendril
fi

# 6. Run diagnostic doctor
echo -e "\n${CYAN}==>${RESET} Running Tendril Doctor diagnostic...\n"
if command -v tendril >/dev/null 2>&1; then
  tendril doctor || true
elif [ -f "$REPO_ROOT/packages/cli/dist/index.js" ]; then
  node "$REPO_ROOT/packages/cli/dist/index.js" doctor || true
fi

# 7. Next steps guidance
echo -e "\n${BOLD}${GREEN}Tendril installation complete!${RESET}\n"
echo -e "${BOLD}Recommended next steps:${RESET}"
if [ "$IS_TERMUX" = true ]; then
  echo -e "  1. ${BOLD}Storage:${RESET} Run ${CYAN}termux-setup-storage${RESET} to grant access to shared files (/sdcard)."
  echo -e "  2. ${BOLD}Hardware API:${RESET} Install the Termux:API companion app from GitHub or F-Droid."
  echo -e "  3. ${BOLD}Background Execution:${RESET} Disable Android battery optimizations for Termux."
  echo -e "     See ${DIM}https://dontkillmyapp.com${RESET} for vendor-specific battery killer guidance."
fi
echo -e "  4. ${BOLD}Start REPL:${RESET} Run ${CYAN}tendril${RESET} in any workspace folder."
echo -e "  5. ${BOLD}Pair Mobile Shell / Web:${RESET} Run ${CYAN}tendril pair${RESET} to connect via browser or companion app."
echo ""
