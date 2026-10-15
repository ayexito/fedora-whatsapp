#!/usr/bin/env bash
set -euo pipefail
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
podman build -t localhost/whatsapp-fedora-builder -f "$project_dir/Containerfile" "$project_dir"
podman run --rm -v "$project_dir:/work:z" -v whatsapp-cargo-cache:/root/.cargo localhost/whatsapp-fedora-builder cargo build "$@"
