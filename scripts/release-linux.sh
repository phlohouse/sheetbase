#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
binary="$("$root/scripts/build-release.sh" linux amd64 "$root/bin/release")"

if [[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]]; then
  "$binary" help >/dev/null
fi

echo "$binary"
