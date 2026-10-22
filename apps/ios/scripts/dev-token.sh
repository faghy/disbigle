#!/bin/bash
# Prints an access token for a seeded development server (apps/server/src/seed.ts), going
# through the same OAuth consent the app uses. For screenshots and UI checks only.
#   scripts/dev-token.sh http://localhost:3300 [username] [password]
set -euo pipefail
server=${1:?server URL}
user=${2:-alice}
password=${3:-disbigle-demo}
jar=$(mktemp)
trap 'rm -f "$jar"' EXIT

curl -sf -c "$jar" -H 'content-type: application/json' \
  -d "{\"login\":\"$user\",\"password\":\"$password\"}" "$server/api/v1/auth/login" >/dev/null
app=$(curl -sf -d client_name=Screenshots -d redirect_uris=disbigle://oauth \
  -d 'scopes=read write follow push' "$server/api/v1/apps")
field() { sed -E "s/.*\"$1\":\"([^\"]+)\".*/\1/" <<<"$2"; }
client_id=$(field client_id "$app")
client_secret=$(field client_secret "$app")
page=$(curl -sf -b "$jar" -G "$server/oauth/authorize" \
  --data-urlencode response_type=code --data-urlencode "client_id=$client_id" \
  --data-urlencode redirect_uri=disbigle://oauth --data-urlencode 'scope=read write follow push')
csrf=$(grep -oE 'name="csrf" value="[^"]+"' <<<"$page" | sed -E 's/.*value="([^"]+)"/\1/')
location=$(curl -s -o /dev/null -w '%{redirect_url}' -b "$jar" "$server/oauth/authorize" \
  --data-urlencode response_type=code --data-urlencode "client_id=$client_id" \
  --data-urlencode redirect_uri=disbigle://oauth --data-urlencode 'scope=read write follow push' \
  --data-urlencode "csrf=$csrf" --data-urlencode decision=approve)
code=$(sed -E 's/.*[?&]code=([^&]+).*/\1/' <<<"$location")
token=$(curl -sf "$server/oauth/token" -d grant_type=authorization_code -d "code=$code" \
  -d "client_id=$client_id" -d "client_secret=$client_secret" -d redirect_uri=disbigle://oauth)
field access_token "$token"
