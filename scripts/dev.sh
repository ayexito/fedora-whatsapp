#!/usr/bin/env bash
set -euo pipefail
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
if [[ ! -x "$project_dir/target/debug/whatsapp-desktop" ]]; then
  "$project_dir/scripts/build-fedora.sh"
fi
exec "$project_dir/target/debug/whatsapp-desktop" "$@"
