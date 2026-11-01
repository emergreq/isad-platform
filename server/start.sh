#!/bin/sh
set -eu
npm run migrate
npm run dev:api &
api_pid=$!
trap 'kill "$api_pid" 2>/dev/null || true' EXIT INT TERM
npm run dev
