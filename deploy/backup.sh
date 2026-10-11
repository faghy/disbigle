#!/bin/bash
# Nightly Disbigle backup: database, media and configuration, the last 14 kept.
# The database holds every account's private keys: keep backups private, and copy them off the
# server (see docs/deploy.md).
set -euo pipefail
umask 077
ENV_FILE=${ENV_FILE:-/etc/disbigle/env}
DEST=${DEST:-/var/backups/disbigle}
KEEP=${KEEP:-14}
MEDIA_DIR=$(grep -E '^MEDIA_DIR=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')
DB_NAME=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')
DIR="$DEST/$(date +%Y-%m-%d_%H%M)"
mkdir -p "$DIR"
cd /tmp
sudo -u postgres pg_dump -w -Fc --no-owner "$DB_NAME" > "$DIR/database.dump"
tar -C "$(dirname "$MEDIA_DIR")" -czf "$DIR/media.tar.gz" "$(basename "$MEDIA_DIR")"
cp "$ENV_FILE" "$DIR/env"
sha256sum "$DIR"/* > "$DIR/SHA256SUMS"
ls -1d "$DEST"/20* | sort | head -n -"$KEEP" | xargs -r rm -rf
echo "backup ok: $DIR ($(du -sh "$DIR" | cut -f1))"
