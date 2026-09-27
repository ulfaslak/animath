#!/bin/bash
# Deploy the game on the prod server, with no gap in service. The deploy
# workflow runs it over SSH after every push to main; by hand it is the first
# deploy and the way back when GitHub Actions is down:
#
#   cd ~/mathgame && bash scripts/deploy.sh          # what :prod points at
#   cd ~/mathgame && bash scripts/deploy.sh <sha>    # the image built from <sha>
#
# `ghcr.io/ulfaslak/mathgame:prod` is the image CI last built, or the one
# `pnpm rollback <sha>` pointed it back at. With a SHA the script pulls that
# commit's image and tags it :prod on this server only (the registry's :prod is
# left alone; `pnpm rollback` moves both). Pulling needs a `docker login
# ghcr.io`: the workflow logs in for each deploy with its own token.
#
# Lawcel's scripts/deploy.sh, a canary swap behind nginx, with six
# differences:
#   1. Migrations run from the new image before it takes any traffic (lawcel
#      migrates after the swap, which its DEFERRED tracks).
#   2. The new image is checked (healthy, and serving the game's page) in a
#      container nginx cannot reach, before a canary of it takes a request.
#   3. With no app running yet (the first deploy) it starts the whole stack.
#   4. If the recreated app never turns healthy, the canary keeps serving and
#      the deploy fails, rather than removing the only healthy app.
#   5. An image that did not change still gets nginx and the backup service
#      reconciled.
#   6. nginx's config is applied before the swap, not after it, so the swap
#      runs under the config this commit ships; and nginx is reloaded as soon
#      as the canary is gone (below).
#
# nginx looks `app` up in Docker's DNS as it serves (nginx/http.conf), so a
# canary carrying the network alias `app` takes traffic as soon as it listens,
# and the compose app can be recreated behind it without a gap. A container
# that leaves takes its address with it, and an address no container holds
# answers nothing, not even a refusal: nginx/app.conf's proxy_connect_timeout
# is what a request sent there costs.
#
# For trying it on a Mac against the local stack (docker-compose.local.yml),
# MATHGAME_DIR names the checkout and MATHGAME_COMPOSE_OVERRIDE the extra
# compose file; an image that is not in the registry is then used as it is.

set -euo pipefail

# shellcheck source=lib/nginx-apply.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/nginx-apply.sh"

REGISTRY_IMAGE="ghcr.io/ulfaslak/mathgame"
CHECK_NAME="mathgame-app-check"
CANARY_NAME="mathgame-app-canary"
DEPLOY_SHA="${1:-}"

cd "${MATHGAME_DIR:-$HOME/mathgame}"

# One deploy at a time: the workflow's runs queue, but a deploy by hand could
# start beside one, and the two would take each other's check container. The
# lock goes when the script ends, however it ends. (A Mac has no flock; the
# local stack runs one deploy at a time anyway.)
if command -v flock >/dev/null 2>&1; then
	exec 9>"/tmp/mathgame-deploy.lock"
	flock -n 9 || {
		echo "ERROR: another deploy is running here (it holds /tmp/mathgame-deploy.lock)"
		exit 1
	}
fi

COMPOSE="docker compose -f docker-compose.prod.yml"
if [ -n "${MATHGAME_COMPOSE_OVERRIDE:-}" ]; then
	COMPOSE="$COMPOSE -f $MATHGAME_COMPOSE_OVERRIDE"
fi

if [ -z "${MATHGAME_COMPOSE_OVERRIDE:-}" ]; then
	[ -s .env.production ] || {
		echo "ERROR: $(pwd)/.env.production is missing (see .env.production.example)"
		exit 1
	}
	# shellcheck source=../deploy.env
	. ./deploy.env
	[ -n "${MATHGAME_DOMAIN:-}" ] || {
		echo "ERROR: MATHGAME_DOMAIN is empty in deploy.env: nginx cannot get a certificate without a domain"
		exit 1
	}
fi

# The image compose runs as the app (compose's own answer, so the canary and
# the recreated app can never run two different images). `config --images
# app` would list app's dependencies' images too.
IMAGE=$($COMPOSE config --format json | jq -r '.services.app.image')

# A missing bind-mount source is created by Docker as root. Make it as us.
mkdir -p backups

# A canary still here means an earlier deploy stopped half way, and one that
# stopped at the recreate left it serving on purpose. It answers as `app`
# whatever this deploy does, so nothing goes on until someone has looked:
# otherwise a first deploy's `up`, or an image that did not change, would
# leave two builds answering for good.
if docker container inspect "$CANARY_NAME" >/dev/null 2>&1; then
	echo "ERROR: a canary from an earlier deploy is still there ($CANARY_NAME), answering as"
	echo "       the app. Check the app ($COMPOSE ps; $COMPOSE logs app), then: docker rm -f $CANARY_NAME"
	exit 1
fi

# A deploy never recreates Postgres: a new image (a new major version needs its
# data upgraded first) is put in by hand, on purpose (.claude/commands/
# redeploy.md § Changing Postgres). When the checkout names another image than
# the one running, say so where the run shows it, and deploy the app anyway: a
# rollback across such a change must still go through, and the app does not
# care which Postgres serves it.
PG_CID=$($COMPOSE ps -q postgres 2>/dev/null || true)
if [ -n "$PG_CID" ]; then
	PG_WANTED=$($COMPOSE config --format json | jq -r '.services.postgres.image')
	PG_RUNNING=$(docker inspect --format '{{.Config.Image}}' "$PG_CID")
	if [ "$PG_WANTED" != "$PG_RUNNING" ]; then
		echo "::warning title=Postgres not changed::The checkout names $PG_WANTED, and $PG_RUNNING runs. A deploy never changes Postgres: apply it by hand (.claude/commands/redeploy.md § Changing Postgres)."
	fi
fi

if [ -n "$DEPLOY_SHA" ]; then
	[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || {
		echo "ERROR: '$DEPLOY_SHA' is not a full 40-character commit SHA"
		exit 1
	}
	echo "Pulling ${REGISTRY_IMAGE}:${DEPLOY_SHA} and tagging it ${IMAGE} here..."
	docker pull "${REGISTRY_IMAGE}:${DEPLOY_SHA}"
	docker tag "${REGISTRY_IMAGE}:${DEPLOY_SHA}" "$IMAGE"
elif [[ "$IMAGE" == "$REGISTRY_IMAGE":* ]]; then
	echo "Pulling ${IMAGE}..."
	docker pull "$IMAGE"
else
	echo "Using ${IMAGE} as it is (not in the registry)"
fi

# wait_healthy <container> <tries>: polls every 5 s; 0 once healthy.
wait_healthy() {
	local container="$1" tries="$2" health
	for _ in $(seq 1 "$tries"); do
		health=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "gone")
		[ "$health" = "healthy" ] && return 0
		sleep 5
	done
	echo "    (still '${health}' after $((tries * 5)) s)"
	return 1
}

migrate() {
	echo "Applying migrations with the new image..."
	$COMPOSE run --rm --no-deps -T app node dist/migrate.mjs </dev/null
}

# nginx's definition and config, as the checkout has them (lib/nginx-apply.sh):
# checked first, then a reload, or a recreate when the template changed.
apply_nginx() {
	echo "Applying the nginx config..."
	apply_nginx_config "$COMPOSE" || {
		echo "ERROR: nginx was not applied (why, above)"
		exit 1
	}
}

APP_CID=$($COMPOSE ps -q app 2>/dev/null || true)
CURRENT_IMAGE=""
if [ -n "$APP_CID" ]; then
	CURRENT_IMAGE=$(docker inspect --format='{{.Image}}' "$APP_CID")
fi
NEW_IMAGE=$(docker image inspect "$IMAGE" --format='{{.Id}}')

if [ -z "$APP_CID" ]; then
	echo "No app running: a first deploy. Starting Postgres..."
	$COMPOSE up -d --wait postgres
	migrate
	echo "Starting the stack..."
	$COMPOSE up -d
	wait_healthy "$($COMPOSE ps -q app)" 24 || {
		echo "ERROR: the app did not turn healthy. Its log: $COMPOSE logs app"
		exit 1
	}
	apply_nginx
elif [ "$CURRENT_IMAGE" = "$NEW_IMAGE" ]; then
	echo "Image unchanged: no swap."
	apply_nginx
else
	migrate

	# First the new image on its own: the app service's container config (env,
	# network, init, healthcheck, log cap) without its network alias, so nothing
	# sends it a request. Docker lists a container under an alias from the moment
	# it starts, healthy or not, so the canary below takes kids' requests at once:
	# only an image that passed here becomes one.
	echo "Checking the new image, with no traffic..."
	docker rm -f "$CHECK_NAME" >/dev/null 2>&1 || true # a deploy that died half way; it never served
	$COMPOSE run -d --no-deps --name "$CHECK_NAME" app >/dev/null </dev/null
	if ! wait_healthy "$CHECK_NAME" 12; then
		echo "ERROR: the new image never turned healthy; the old app keeps serving. Its log:"
		docker logs --tail 50 "$CHECK_NAME" 2>&1 | sed 's/^/    /'
		docker rm -f "$CHECK_NAME" >/dev/null
		exit 1
	fi
	# /api/health says the server is up. Ask for the game's page too: it must be
	# there, and from the same build.
	PAGE_CHECK=$(docker exec "$CHECK_NAME" node -e "
		Promise.all([
			fetch('http://localhost:3000/').then((r) => (r.ok ? r.text() : '')),
			fetch('http://localhost:3000/api/health').then((r) => r.json())
		]).then(([page, health]) => console.log(
			page.includes('<canvas id=\"game\"') && page.includes('content=\"' + health.sha + '\"') ? 'ok' : 'wrong page'
		)).catch(() => console.log('fetch failed'))" </dev/null || echo "exec failed")
	docker rm -f "$CHECK_NAME" >/dev/null
	if [ "$PAGE_CHECK" != "ok" ]; then
		echo "ERROR: the new image's page check says '$PAGE_CHECK'; the old app keeps serving"
		exit 1
	fi
	echo "The new image is healthy and serves the game's page"

	# Before the canary, so the swap runs under the config this commit ships
	# (how long nginx waits on an address that answers nothing, above all).
	# A config that fails its check stops the deploy here, the old app serving.
	apply_nginx

	echo "Starting the canary..."
	# The same config, now with the network alias, so nginx sends it requests.
	$COMPOSE run -d --no-deps --use-aliases --name "$CANARY_NAME" app >/dev/null </dev/null
	if ! wait_healthy "$CANARY_NAME" 12; then
		echo "ERROR: the canary never turned healthy; the old app keeps serving. Its log:"
		docker logs --tail 50 "$CANARY_NAME" 2>&1 | sed 's/^/    /'
		docker rm -f "$CANARY_NAME" >/dev/null
		exit 1
	fi
	echo "The canary is healthy"

	echo "Recreating the app with the new image (the canary serves meanwhile)..."
	$COMPOSE up -d --no-deps --force-recreate app
	if ! wait_healthy "$($COMPOSE ps -q app)" 24; then
		echo "ERROR: the recreated app never turned healthy. The canary keeps serving;"
		echo "       check $COMPOSE logs app, then remove it: docker rm -f $CANARY_NAME"
		exit 1
	fi

	echo "Removing the canary..."
	# Looked up first: compose takes a second to answer, and the reload below
	# must follow the stop at once.
	NGINX_CID=$($COMPOSE ps -q nginx)
	docker stop "$CANARY_NAME" >/dev/null
	# Its address left with it, but each nginx worker keeps its last answer for
	# `app` up to 5 s (nginx/http.conf), the canary's address in it: a request
	# sent there would wait out proxy_connect_timeout, a presence socket coming
	# back from the canary most of all. A reload (SIGHUP to nginx, its PID 1)
	# starts fresh workers, which keep no answer and ask Docker's DNS, and it
	# no longer names the canary. The config is the one applied above.
	docker kill --signal HUP "$NGINX_CID" >/dev/null ||
		echo "    (nginx did not take the reload: it lets go of the canary's address within 5 s)"
	docker rm "$CANARY_NAME" >/dev/null
fi

# The swap above only touches `app`. Without this, a change to the backup
# service (its schedule, its mounts) would never be applied, and the old loop
# would keep running and look healthy. Compose recreates it only when its
# definition changed, so a dump in progress is not cut short for nothing. A
# change to scripts/backup.sh alone changes no definition: the loop runs the
# copy it took at its start (docker-compose.prod.yml), so a different one means
# a restart with the new script.
echo "Reconciling the backup service..."
BACKUP_CID=$($COMPOSE ps -q backup 2>/dev/null || true)
if [ -n "$BACKUP_CID" ] &&
	! docker exec "$BACKUP_CID" cat /tmp/backup.sh </dev/null 2>/dev/null | cmp -s - scripts/backup.sh; then
	echo "    scripts/backup.sh changed: restarting the backup service with it"
	$COMPOSE up -d --no-deps --force-recreate backup
else
	$COMPOSE up -d --no-deps backup
fi

# Image retention: the running image, :prod, and the 3 newest others (for a
# quick rollback); everything else goes. Lawcel's disk filled twice with old
# images before it counted them itself (`docker image prune -a --filter
# until=...` reclaimed nothing on Docker 29).
KEEP=3
RUNNING_IMAGE_ID=$(docker inspect --format='{{.Image}}' "$($COMPOSE ps -q app)" 2>/dev/null || echo "")
echo "Removing old images (keeping the running one, :prod and ${KEEP} more)..."
# --no-trunc: full IDs, the form `docker inspect` gives the running one in.
docker images --no-trunc "$REGISTRY_IMAGE" --format '{{.CreatedAt}}|{{.ID}}|{{.Repository}}:{{.Tag}}' |
	sort -t'|' -k1,1r |
	awk -F'|' -v running="$RUNNING_IMAGE_ID" -v keep="$KEEP" '
		{
			is_running = ($2 == running)
			is_prod = ($3 ~ /:prod$/)
			if (!is_running && !is_prod && !($2 in rank)) rank[$2] = ++count
			if (is_running || is_prod) next
			if (rank[$2] <= keep) next
			print $3
		}
	' |
	xargs -r -n1 docker rmi 2>&1 | grep -v '^$' || true
docker image prune -f >/dev/null 2>&1 || true

echo "Deploy complete: $($COMPOSE exec -T app node -e "fetch('http://localhost:3000/api/health').then((r) => r.json()).then((h) => console.log(h.sha))" </dev/null)"
