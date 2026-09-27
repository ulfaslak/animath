---
description: The game's production server — provision it, deploy, roll back, restore from a backup, read its logs
---

# Redeploy

The game runs on its own Hetzner VPS, set up the same way as lawcel's: a Docker Compose stack (the app, Postgres, nginx with Let's Encrypt, a backup sidecar) that every push to main redeploys. Read [[DEVELOPMENT]] § Deployment first; it says how the pieces fit. This is the runbook: do the section the task needs, and report what you did and what the human still has to do.

**Getting in.** The server is the domain in `deploy.env` (`MATHGAME_DOMAIN`), user `deploy`, with the key `~/.ssh/mathgame_deploy` on this Mac:

```bash
. ./deploy.env
ssh -i ~/.ssh/mathgame_deploy deploy@$MATHGAME_DOMAIN
```

On the server everything is under `~/mathgame`, a checkout of this repo, and compose is always `docker compose -f docker-compose.prod.yml` (the project `mathgame-prod`). **Never change a file there by hand**: every deploy resets the checkout to the deployed commit. Never print `terraform/terraform.tfvars`, `.env.production` or a private key: the transcript keeps them.

## First provisioning, or replacing a dead server

### 1. Provision (you, once the human has put the token in place)

The Hetzner API token goes in `terraform/terraform.tfvars` of the **primary clone** (`hcloud_token = "…"`; the file is gitignored), and Terraform runs there, because its state stays in that folder:

```bash
cd ~/git/mathgame/terraform
terraform init
terraform state rm hcloud_server.mathgame   # only when replacing a dead server
terraform apply
```

On a Mac without `terraform`: `brew tap hashicorp/tap && brew install hashicorp/tap/terraform`. Note `server_ip`, then wait for the first boot (up to 5 minutes):

```bash
ssh -i ~/.ssh/mathgame_deploy -o StrictHostKeyChecking=accept-new deploy@<server_ip> cloud-init status --wait
```

### 2. DNS (the human, meanwhile)

Point the domain at the server: an **A** record to `server_ip`, a **CNAME** `www` to the domain, and **no AAAA record**. Behind Docker's port proxy every IPv6 visitor would reach nginx from one address, so the per-address limits (nginx's on POSTs, the accounts' own) would count them all as one; over IPv4 each keeps their own. `www` only redirects to the domain (nginx gets it a certificate of its own). A new domain also goes in `deploy.env` (`MATHGAME_DOMAIN=…`, one line, merged like any change). nginx asks Let's Encrypt for the certificates over port 80 once the names resolve; nothing else is needed.

### 3. Set up the server (you)

On the server, as `deploy`:

1. A read-only deploy key for `git fetch`:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N "" -C "mathgame-prod"
   ```
   Add its public half to the repo from the Mac (read-only is the default):
   ```bash
   gh repo deploy-key add <(ssh -i ~/.ssh/mathgame_deploy deploy@<server_ip> cat .ssh/github_deploy.pub) -R ulfaslak/mathgame -t mathgame-prod
   ```
   A key added with `gh` goes when gh's token is revoked; the human can add it in the repo's Settings → Deploy keys instead, where it stays.
2. Clone, with the key remembered for every later fetch:
   ```bash
   git clone -c core.sshCommand="ssh -i ~/.ssh/github_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" git@github.com:ulfaslak/mathgame.git ~/mathgame
   ```
3. `~/mathgame/.env.production`, mode 600. Replacing a dead server: the offsite copy, `scp -i ~/.ssh/mathgame_deploy ~/mathgame-backups/.env.production deploy@<server_ip>:mathgame/`. A first server: from `.env.production.example`, with a new password (`openssl rand -base64 24 | tr -d '/+='`) in both `POSTGRES_PASSWORD` and `DATABASE_URL`.
4. The key the deploy workflow logs in with. On the server:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -N "" -C "mathgame-cicd"
   cat ~/.ssh/deploy_key.pub >> ~/.ssh/authorized_keys
   ```
   From the Mac, straight into the repo's secrets, never onto the screen, then drop the private half from the server:
   ```bash
   ssh -i ~/.ssh/mathgame_deploy deploy@<server_ip> cat .ssh/deploy_key | gh secret set VPS_SSH_KEY -R ulfaslak/mathgame
   gh secret set VPS_HOST -R ulfaslak/mathgame --body <server_ip>
   gh secret set VPS_USER -R ulfaslak/mathgame --body deploy
   ssh -i ~/.ssh/mathgame_deploy deploy@<server_ip> rm .ssh/deploy_key
   ```
5. Optional: alerts from the backup service to Slack, `~/mathgame/.env.monitoring` holding `MONITORING_SLACK_WEBHOOK_URL=…` (mode 600).

### 4. Restore the database (replacing a dead server only)

Before the first deploy, from the newest dump in `~/mathgame-backups/` on the Mac:

```bash
scp -i ~/.ssh/mathgame_deploy ~/mathgame-backups/<newest>.dump deploy@<server_ip>:mathgame/backups/
# on the server
cd ~/mathgame
docker compose -f docker-compose.prod.yml up -d --wait postgres
docker compose -f docker-compose.prod.yml exec -T postgres pg_restore -U mathgame -d mathgame --clean --if-exists --no-owner < backups/<newest>.dump
```

### 5. First deploy

With the secrets set, from the Mac: `gh workflow run deploy.yml`, then `gh run watch`. It tests and builds main, and `scripts/deploy.sh` starts the whole stack, migrations first. (By hand on the server it is `bash scripts/deploy.sh`, after a `docker login ghcr.io -u ulfaslak` with a classic token that has `read:packages`: the workflow logs in with its own token for each deploy, and the server keeps none.)

Check it answers, on its certificate, with main's commit:

```bash
curl -fsS https://$MATHGAME_DOMAIN/api/health   # {"ok":true,"db":true,"sha":"<main's tip>"}
```

and load the game in a browser. The certificate can take a minute after DNS resolves.

### 6. Offsite backups on this Mac

From the primary clone: `./scripts/install-backup-sync.sh`. It installs the launchd agent `com.mathgame.backup-sync`, which pulls the dumps, `.env.production` and the server's git key into `~/mathgame-backups/` every 6 hours, and waits for its first run. Healthy is `runs >= 1`, `last exit code = 0` and a `Backup sync OK:` line.

## Deploy

Every push to main deploys itself ([[DEVELOPMENT]] § Deployment). Watch a run with `gh run watch`. A run that stops at `!! nginx refused the new config` left nginx serving with the config it had: `logs nginx` says why, in an `[emerg]` line. When main is ahead of prod (a merge with `[skip deploy]`, or a failed run), `gh workflow run deploy.yml` builds and deploys main's tip.

## Roll back

```bash
pnpm rollback          # the recent deploys, newest first
pnpm rollback <sha>    # prod back to the image built from <sha>
```

It dispatches the deploy workflow: no build, no tests, the same canary swap and health check. It holds until the next push to main; to stay back, merge a revert. With GitHub Actions down, on the server (after a `docker login` as in § First deploy):

```bash
cd ~/mathgame && git fetch origin main && git reset --hard <sha> && bash scripts/deploy.sh <sha>
```

## Restore from a backup

The dumps are in `~/mathgame/backups/` on the server (every 6 hours, 30 days) and in `~/mathgame-backups/` on this Mac. A restore replaces the whole database, so first keep what is there:

```bash
cd ~/mathgame
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U mathgame -d mathgame -Fc > backups/before-restore_$(date -u +%Y%m%d_%H%M%S).dump
docker compose -f docker-compose.prod.yml exec -T postgres pg_restore -U mathgame -d mathgame --clean --if-exists --no-owner < backups/<dump>
docker compose -f docker-compose.prod.yml exec -T postgres psql -U mathgame -d mathgame -c "select count(*) from players; select count(*) from saves;"
```

A kid's browser keeps its own save and sends a backup with a higher `seq` than an older copy the server holds, so the server catches up by itself as they play ([[DECISIONS]] § Saves). To give one kid a game back instead, see [[DEVELOPMENT]] § Database.

## Changing Postgres

A deploy never recreates the `postgres` service, so a merge that changes it in `docker-compose.prod.yml` (the image tag, the volume, the healthcheck, the log cap) changes nothing on the server until it is applied by hand. When the image differs, every deploy says so in a warning on its run. On the server:

```bash
cd ~/mathgame
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U mathgame -d mathgame -Fc > backups/before-postgres-change_$(date -u +%Y%m%d_%H%M%S).dump
docker compose -f docker-compose.prod.yml up -d --no-deps --wait postgres
docker compose -f docker-compose.prod.yml ps
```

The app loses its database for the seconds Postgres restarts; the game plays on in the browser. A new **major** version (18 to 19) cannot start on the old one's data: restore that dump into the new version instead (§ Restore from a backup, into a fresh volume).

## Logs and a look inside

On the server, in `~/mathgame`:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail 200 -f app     # the server: one line per request
docker compose -f docker-compose.prod.yml logs --tail 100 nginx      # requests (with the app addresses nginx tried), certificates
docker compose -f docker-compose.prod.yml logs --tail 20 backup      # "backup ok: …" every 6 hours
docker compose -f docker-compose.prod.yml exec -T postgres psql -U mathgame -d mathgame
df -h / && docker system df                                          # the disk
```

Each service keeps a capped log (docker-compose.prod.yml), and drops its oldest lines at the cap: nginx's 3 × 10 MB held about two days on 2026-09-27, the app's 5 × 20 MB about three. Nothing older survives on the server; Hetzner's own nightly image of the machine keeps the logs of its night for 7 days, in the Cloud Console under the server's Backups. No log names a player's IP address ([[DECISIONS]] § Deployment): nginx's access log has none, and its error log writes a line about a request only when nginx itself runs out of connections, files or memory. (The lines nginx wrote before #115's change, 2026-09-27, name clients; they leave the server as Docker drops them at the cap, or at once when nginx is recreated.) What went wrong with a request is in its access-log line: its status, and the app addresses nginx tried with what each answered ([[DEVELOPMENT]] § What a request meets during a swap). A TLS handshake that fails, for a missing certificate too, leaves no line: it is no request. Why a certificate is missing is the certificate module's to say, in nginx's own lines (`[notice]` and worse, none about a request): a certificate Let's Encrypt would not issue or renew is a `[warn]` or `[error]` line naming the issuer, `letsencrypt` (`logs nginx | grep -i acme`). `curl -v https://$MATHGAME_DOMAIN/api/health` shows what a browser gets.

**Accounts** (once the accounts server is in; its admin command is bundled into the image as `dist/admin.mjs`): with no email, a forgotten password or a deleted account is the human's job, done on the server:

```bash
docker compose -f docker-compose.prod.yml exec app node dist/admin.mjs list
docker compose -f docker-compose.prod.yml exec app node dist/admin.mjs reset-password <name>   # a made-up password
printf '%s' "$PW" | docker compose -f docker-compose.prod.yml exec -T app node dist/admin.mjs reset-password <name> --stdin
docker compose -f docker-compose.prod.yml exec app node dist/admin.mjs delete-account <name> [--yes]
```

**Moving a kid's game here** from the server it was played on before (the tunnel's, on the Mac): export it there and pipe it into `import-save` here, which makes his account with no password and prints a one-time welcome link for him. The exact commands, from the Mac over SSH, are [[DEVELOPMENT]] § Moving a kid's game to production. The link is his key until he uses it: hand it to the human, and never print it into a PR, an issue or a log.
