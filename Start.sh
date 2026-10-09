#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Please install Node.js 24 from https://nodejs.org/ and reopen this file.'
  exit 1
fi
exec node scripts/start.mjs
