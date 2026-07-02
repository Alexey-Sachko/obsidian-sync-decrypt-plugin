#!/usr/bin/env bash
#
# One-command installer/updater for the encryptor CLI on a VPS.
# Downloads the prebuilt single-file bundle + docs + example config from the
# latest GitHub release (no build toolchain needed — only Node.js >= 20 + curl).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Alexey-Sachko/obsidian-sync-decrypt-plugin/main/scripts/install-encryptor.sh | bash
#   # custom dir / repo:
#   curl -fsSL .../install-encryptor.sh | INSTALL_DIR=/opt/encryptor bash
#   curl -fsSL .../install-encryptor.sh | REPO=owner/repo INSTALL_DIR=/opt/encryptor bash
#
# Re-run any time to update encryptor.mjs (your config.json is preserved).
set -euo pipefail

REPO="${REPO:-Alexey-Sachko/obsidian-sync-decrypt-plugin}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/obsidian-encryptor}"
BASE="https://github.com/${REPO}/releases/latest/download"

echo "encryptor installer"
echo "  repo:    ${REPO}"
echo "  target:  ${INSTALL_DIR}"

# --- prerequisites -----------------------------------------------------------
if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl is required." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js >= 20 not found on PATH. Install Node.js first." >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${NODE_MAJOR}" -lt 20 ]; then
  echo "ERROR: Node.js >= 20 required (found $(node --version))." >&2
  exit 1
fi

# --- download ----------------------------------------------------------------
mkdir -p "${INSTALL_DIR}"

dl() { # <asset-name> <dest>
  echo "  downloading $1"
  if ! curl -fsSL "${BASE}/$1" -o "$2"; then
    echo "ERROR: could not download $1 from the latest release of ${REPO}." >&2
    echo "       Ensure a release exists that includes encryptor assets." >&2
    exit 1
  fi
}

dl "encryptor.mjs"        "${INSTALL_DIR}/encryptor.mjs"
dl "encryptor-README.md"  "${INSTALL_DIR}/README.md"
dl "config.example.json"  "${INSTALL_DIR}/config.example.json"

# Never clobber an existing config; seed one from the example on first install.
if [ ! -f "${INSTALL_DIR}/config.json" ]; then
  cp "${INSTALL_DIR}/config.example.json" "${INSTALL_DIR}/config.json"
  SEEDED=1
else
  SEEDED=0
fi

# --- done --------------------------------------------------------------------
echo
echo "Installed to ${INSTALL_DIR}:"
echo "  encryptor.mjs        (the CLI)"
echo "  README.md            (operator reference)"
echo "  config.example.json  (template)"
if [ "${SEEDED}" -eq 1 ]; then
  echo "  config.json          (created from the template — EDIT IT)"
fi
echo
echo "Next steps:"
echo "  1) edit ${INSTALL_DIR}/config.json   (docs: ${INSTALL_DIR}/README.md)"
echo "  2) run:  node ${INSTALL_DIR}/encryptor.mjs --config ${INSTALL_DIR}/config.json"
echo "  3) check: node ${INSTALL_DIR}/encryptor.mjs --help"
echo
echo "Re-run this installer any time to update encryptor.mjs (config.json is kept)."
