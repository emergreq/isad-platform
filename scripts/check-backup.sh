#!/bin/sh
# Restore into a new temporary database; never overwrite the running application database.
set -eu
file="${1:?Укажите путь к резервной копии}"
name="isad_restore_check_$(date +%s)"
docker compose exec -T db createdb -U isad "$name"
trap 'docker compose exec -T db dropdb -U isad "$name"' EXIT INT TERM
docker compose exec -T db pg_restore -U isad -d "$name" --no-owner < "$file"
docker compose exec -T db psql -U isad -d "$name" -c 'SELECT count(*) AS restored_users FROM users;'
