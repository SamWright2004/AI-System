#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing $1. $2" >&2
    exit 1
  fi
}

require_command git "Install Git and reopen your terminal."
require_command node "Install Node.js 24 LTS and reopen your terminal."
require_command pnpm "Run: npm install --global pnpm@11"
require_command docker "Install and start Docker Desktop or Docker Engine."

node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if [[ "$node_major" != "24" ]]; then
  echo "Node.js 24 LTS is required. Found $(node --version)." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  app_secret="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
  node -e "const fs=require('node:fs');const p='.env';fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace('development-only-secret-change-me',process.argv[1]))" "$app_secret"
  echo "Created local .env configuration."
else
  echo "Keeping the existing .env configuration."
fi

personalisation_file="config/personalisation/profile.local.json"
if [[ ! -f "$personalisation_file" ]]; then
  cp config/personalisation/profile.example.json "$personalisation_file"
  echo "Created local personalisation profile."
else
  echo "Keeping the existing personalisation profile."
fi

pnpm install
docker compose up -d

echo "Waiting for PostgreSQL..."
ready=false
for _ in {1..30}; do
  if docker compose exec -T postgres pg_isready -U personal_ai -d personal_ai >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done

if [[ "$ready" != "true" ]]; then
  echo "PostgreSQL did not become ready. Run: docker compose logs postgres" >&2
  exit 1
fi

pnpm db:migrate
pnpm db:seed

echo
echo "Foundation ready. Run: pnpm dev"
echo "Then open: http://127.0.0.1:5173"
echo "Personalise it in: $personalisation_file"
