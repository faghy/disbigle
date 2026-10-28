# Deploying Disbigle

A production instance runs two Node.js processes (API server and worker) behind nginx, with PostgreSQL and Redis on the same machine or nearby. No containers are required. The files referenced here are in [`deploy/`](../deploy).

## 1. System packages (Debian 13)

```sh
sudo apt install -y postgresql redis-server nginx certbot python3-certbot-nginx git curl
# Node.js 22 LTS (NodeSource or your preferred source), then:
sudo corepack enable
```

## 2. User, database, code

```sh
sudo useradd --system --create-home --home-dir /opt/disbigle disbigle
sudo -u postgres createuser disbigle
sudo -u postgres createdb -O disbigle disbigle
sudo mkdir -p /var/lib/disbigle/media /etc/disbigle
sudo chown -R disbigle: /var/lib/disbigle

sudo -u disbigle git clone https://github.com/faghy/disbigle.git /opt/disbigle
cd /opt/disbigle
sudo -u disbigle pnpm install --frozen-lockfile
sudo -u disbigle pnpm --filter @disbigle/web build
```

## 3. Configuration

Create `/etc/disbigle/env` (readable by the `disbigle` user only; quote values that contain spaces):

```sh
PUBLIC_URL=https://example.org
LOCAL_DOMAIN=example.org
HOST=127.0.0.1
PORT=3000
DATABASE_URL=postgres:///disbigle?host=/var/run/postgresql
REDIS_URL=redis://127.0.0.1:6379/0
SESSION_SECRET=<output of: openssl rand -hex 32>
REGISTRATION_MODE=approval
MEDIA_DIR=/var/lib/disbigle/media
INSTANCE_TITLE=Example
INSTANCE_DESCRIPTION="A friendly corner of the Fediverse"
SMTP_URL=smtps://user:password@mail.example.org:465
MAIL_FROM="Example <noreply@example.org>"
```

**Analytics (optional).** With `MATOMO_URL=https://matomo.example.org` and `MATOMO_SITE_ID=3` the web client sends Matomo a page view at each screen: no cookies, no script from the Matomo server (an image request, so the Content Security Policy stays as it is), only the screen's generic address (`/@profile/post`, never names, posts or searches), and nothing at all from browsers that ask not to be tracked (Do Not Track, Global Privacy Control). Mention it in your privacy policy.

`LOCAL_DOMAIN` becomes part of every handle (`user@example.org`) and **cannot change later** without breaking federation.

**Split domain.** Handles can live on a different host from the app: `LOCAL_DOMAIN=example.org` with `PUBLIC_URL=https://social.example.org` gives handles like `user@example.org`. The app answers WebFinger for both hosts. The server at `example.org` (any web server or site) only has to send the discovery paths to the app:

```nginx
location = /.well-known/webfinger { return 301 https://social.example.org$request_uri; }
location = /.well-known/host-meta { return 301 https://social.example.org$request_uri; }
location = /.well-known/nodeinfo  { return 301 https://social.example.org$request_uri; }
```

Mastodon and diaspora* follow these redirects.

Apply the migrations:

```sh
cd /opt/disbigle
sudo -u disbigle bash -c 'set -a; . /etc/disbigle/env; set +a; pnpm db:migrate'
```

## 4. Services

```sh
sudo cp deploy/disbigle-server.service deploy/disbigle-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now disbigle-server disbigle-worker
```

The server sets `RUN_FEDERATION_QUEUE=false`, so federation delivery happens in the worker. For more delivery throughput, run more workers.

## 5. nginx and TLS

Edit the domain and paths in `deploy/nginx.conf`, then:

```sh
sudo cp deploy/nginx.conf /etc/nginx/sites-available/disbigle
sudo ln -s ../sites-available/disbigle /etc/nginx/sites-enabled/disbigle
sudo certbot --nginx -d example.org
sudo nginx -t && sudo systemctl reload nginx
```

Open the site and register: **the first account becomes the administrator**, even when registrations are closed.

## On a Plesk server

Plesk owns the nginx virtual hosts, so the configuration is split in two:

- `map` and `upstream` blocks (http level) go in `/etc/nginx/conf.d/disbigle.conf`, with names that don't clash with other sites (e.g. `$disbigle_connection_upgrade`).
- The `location` blocks and the CSP `set` go in the domain's **Additional nginx directives** (Apache & nginx Settings), or in `/var/www/vhosts/system/<domain>/conf/vhost_nginx.conf` followed by `plesk sbin httpdmng --reconfigure-domain <domain>`. Leave out `client_max_body_size`: Plesk already sets it. Give each location its own `root` (the app's `apps/web/dist`), since the server root is the domain's `httpdocs`.
- Keep the domain's nginx proxy mode off (PHP-FPM served by nginx), so there is no `location /` from Plesk to clash with.
- A database created in Plesk belongs to Plesk's admin role: grant the app's user `CREATE` on the database and on schema `public` before migrating.
- On a shared server, bind Redis to localhost with `requirepass`, and don't add nginx to the `disbigle` group (it would be able to read `/etc/disbigle/env`); make the web build and the media directory world-readable instead.
- Plesk ships Node.js in `/opt/plesk/node/<version>/bin`: put it on `PATH` in the systemd units.

## 6. Updating

```sh
cd /opt/disbigle
sudo -u disbigle git pull
sudo -u disbigle pnpm install --frozen-lockfile
sudo -u disbigle pnpm --filter @disbigle/web build
sudo -u disbigle bash -c 'set -a; . /etc/disbigle/env; set +a; pnpm db:migrate'
sudo systemctl restart disbigle-server disbigle-worker
```

## 7. Email

Disbigle sends password resets and alerts. The simplest setup uses the mail server already on the
machine (Postfix, as on Plesk) through localhost:

```sh
SMTP_URL=smtp://127.0.0.1:25/?ignoreTLS=true
MAIL_FROM="Example <noreply@example.org>"
```

Mail from your domain only reaches inboxes when the domain vouches for the server, in the DNS
that is actually public (check with `dig NS example.org`: on Cloudflare, add them there, as
"DNS only"):

| Name | Type | Value |
| --- | --- | --- |
| `example.org` | TXT | `v=spf1 ip4:<server IPv4> -all` |
| `default._domainkey.example.org` | TXT | `v=DKIM1; p=<public key>` (Plesk shows it in the domain's DNS settings when "DKIM" is on) |
| `_dmarc.example.org` | TXT | `v=DMARC1; p=none` (move to `quarantine` once reports look right) |
| `example.org` | MX | `10 <server host name>` (for bounces) |

The server's reverse DNS (PTR) should name a host that resolves back to its address.

## 8. Backups

`deploy/backup.sh` saves the database (`pg_dump -Fc`), the media directory and the configuration
to `/var/backups/disbigle`, keeping the last 14:

```sh
sudo cp deploy/disbigle-backup.service deploy/disbigle-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now disbigle-backup.timer
sudo systemctl start disbigle-backup.service   # a first backup now
```

The database holds the private keys of every account: backups stay readable by root only, and a
copy should leave the server (another machine, encrypted storage) so a lost disk doesn't take
them along.

To restore (try it once on a scratch database, and compare a few counts):

```sh
B=/var/backups/disbigle/<date>
sudo -u postgres createdb --maintenance-db=template1 -w disbigle_restore
cat $B/database.dump | sudo -u postgres pg_restore -w --no-owner -d disbigle_restore
sudo tar -C /var/lib/disbigle -xzf $B/media.tar.gz      # media
```

(`--maintenance-db=template1 -w`: on Plesk, connecting to the `postgres` database asks for a
password; `-w` makes the command fail instead of waiting for one.)

## 9. Monitoring

`deploy/healthcheck.sh` runs every 5 minutes: it checks the services, the app (locally and at its
public address) and failed diaspora* deliveries, restarts what is down, and mails an alert once
per problem and once when it is over. Put the recipient in `/etc/disbigle/alert-to`:

```sh
sudo cp deploy/disbigle-health.service deploy/disbigle-health.timer /etc/systemd/system/
echo admin@example.org | sudo tee /etc/disbigle/alert-to
sudo systemctl daemon-reload && sudo systemctl enable --now disbigle-health.timer
```

## Migrating a diaspora\* pod in place

Disbigle can take over an existing pod **on the same domain**, keeping handles, keys and GUIDs, so contacts on other pods keep working. Details and mapping rules are in [`packages/diaspora-import/README.md`](../packages/diaspora-import/README.md).

1. Install Disbigle as above on the pod's server (or a new one), with `LOCAL_DOMAIN` equal to the pod's domain. Do not switch nginx yet.
2. Run a trial import against a copy of the pod database:
   ```sh
   sudo -u disbigle bash -c 'set -a; . /etc/disbigle/env; set +a; exec "$@"' _ \
     pnpm --filter @disbigle/diaspora-import run import \
       --source postgres://diaspora@localhost/diaspora_production \
       --uploads /opt/diaspora/public/uploads --dry-run
   ```
   Then run it without `--dry-run` and check the result in the web interface.
3. At the switch-over: put the pod in maintenance (stop its services), run the import again (it is idempotent and only adds what changed), then point nginx at Disbigle. Keep the `/uploads/images/` location from `deploy/nginx.conf`: other pods hotlink the old photo URLs.
4. Users sign in with their old passwords; each is converted to Argon2id at first sign-in. If the pod changed Devise's pepper, set `DIASPORA_PASSWORD_PEPPER` in the environment.
5. Old profile and post links (`/u/name`, `/people/guid`, `/posts/guid`) redirect to the new pages.
