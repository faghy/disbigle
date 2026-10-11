#!/bin/bash
# Every 5 minutes: services up, the app answering (locally and at its public address), diaspora*
# deliveries not piling up failures. Restarts what is down; mails an alert once per problem and
# once when it is over (recipient in /etc/disbigle/alert-to; journal only when it is empty).
set -uo pipefail
ENV_FILE=${ENV_FILE:-/etc/disbigle/env}
val() { grep -E "^$1=" "$ENV_FILE" | cut -d= -f2- | tr -d '"'; }
PUBLIC_URL=$(val PUBLIC_URL); PORT=$(val PORT); REDIS_URL=$(val REDIS_URL)
FROM=$(val MAIL_FROM | sed -E 's/.*<([^>]+)>.*/\1/')
STATE=/var/lib/disbigle-health; mkdir -p "$STATE"; chmod 700 "$STATE"
TO=$(cat /etc/disbigle/alert-to 2>/dev/null || true)
problems=()
for svc in disbigle-server disbigle-worker redis-server postgresql; do
  if ! systemctl is-active --quiet "$svc"; then
    problems+=("$svc was not running (restarted)"); systemctl restart "$svc" || true
  fi
done
curl -fsS -m 10 -o /dev/null "http://127.0.0.1:${PORT:-3000}/health" || problems+=("the app does not answer locally")
curl -fsS -m 20 -o /dev/null "$PUBLIC_URL/health" || problems+=("$PUBLIC_URL does not answer")
DEAD=$(redis-cli -u "$REDIS_URL" LLEN disbigle:diaspora:dead 2>/dev/null || echo 0)
LAST=$(cat "$STATE/dead" 2>/dev/null || echo 0); echo "$DEAD" > "$STATE/dead"
[ "${DEAD:-0}" -gt "${LAST:-0}" ] && problems+=("diaspora* deliveries given up: $((DEAD - LAST)) new ($DEAD in all)")
notify() {
  logger -t disbigle-health "$1: $2"
  [ -n "$TO" ] && printf 'Subject: [Disbigle] %s\nFrom: %s\nTo: %s\n\n%s\n\n%s\n' "$1" "$FROM" "$TO" "$2" "$(date)" \
    | /usr/sbin/sendmail -f "$FROM" "$TO"
  return 0
}
if [ ${#problems[@]} -gt 0 ]; then
  msg=$(printf '%s\n' "${problems[@]}")
  if [ "$(cat "$STATE/last" 2>/dev/null)" != "$msg" ]; then notify "problem" "$msg"; echo "$msg" > "$STATE/last"; fi
  exit 1
elif [ -s "$STATE/last" ]; then
  notify "back to normal" "Solved: $(cat "$STATE/last")"; : > "$STATE/last"
fi
