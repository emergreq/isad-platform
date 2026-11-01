#!/bin/sh
set -eu
mkdir -p work/backups
file="work/backups/isad-$(date +%Y%m%d-%H%M%S).dump"
docker compose exec -T db pg_dump -U isad -d isad -Fc > "$file"
printf 'Резервная копия: %s\n' "$file"
