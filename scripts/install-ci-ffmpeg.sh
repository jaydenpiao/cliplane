#!/usr/bin/env bash
set -euo pipefail

# The hosted Ubuntu sources read this mirror list. Keep their suites and signing keys.
if [[ -f /etc/apt/apt-mirrors.txt ]]; then
  printf '%s\n' 'https://archive.ubuntu.com/ubuntu/' | sudo tee /etc/apt/apt-mirrors.txt >/dev/null
fi

if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
  apt_options=(-o Acquire::Retries=2 -o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15)
  sudo apt-get "${apt_options[@]}" update
  sudo apt-get "${apt_options[@]}" install -y --no-install-recommends ffmpeg
fi
