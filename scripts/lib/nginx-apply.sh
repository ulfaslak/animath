#!/bin/bash
# Apply the checkout's nginx config to the running nginx container.
#
# Lawcel's scripts/lib/nginx-apply.sh, for a config that is rendered instead of
# bind-mounted as one file. docker-compose.prod.yml mounts the whole nginx/
# folder, and at every start the nginx image renders nginx.conf.template into
# /etc/nginx/nginx.conf with MATHGAME_DOMAIN (deploy.env). So:
#
#   - A change to an included file (app.conf, http.conf, 502.html) is on the
#     container's disk as soon as `git reset --hard` writes it: a reload reads
#     it. (Lawcel mounts nginx.conf as a single file, which keeps showing the
#     old file after a reset; that is what its version works around.)
#   - A change to the template reaches /etc/nginx/nginx.conf only when it is
#     rendered again: the image renders it at every start, and step 5 below
#     has the running container render it. A change to the domain changes the
#     service's environment, which needs a new container.
#
# What this does:
#
#   1. Render and test the checkout's config in a throwaway container of the
#      nginx service as the checkout defines it (image, env, mounts): `nginx -T`
#      prints the whole config as nginx would load it. A config that fails
#      leaves the running nginx alone, and returns 1.
#   2. `up -d` the service: compose recreates it only when its definition
#      changed (a new image tag, ports, the domain), and it then renders the
#      config step 1 passed.
#   3. Compare step 1's config with `nginx -T` in the running container, which
#      reads the included files fresh and its own rendered nginx.conf.
#   4. The same -> reload (picks up the included files).
#   5. Different (the template changed) -> the running container renders the
#      template again with the image's own script and its own environment, as
#      at a start, and when its config is now step 1's, a reload. Otherwise a
#      recreate, which renders it at the start.
#
# A reload counts once nginx runs new workers: nginx can still refuse, as it
# applies it, a config `nginx -T` passed, and then keeps its old workers and
# the config they run. That returns 1, and the deploy fails with nginx
# serving as it was.
#
# A reload refuses no connection: nginx's new workers take the new ones at
# once, and the old workers finish what they hold (a WebSocket stays with its
# old worker until it closes). A recreate refuses every connection until nginx
# is back, and nginx's graceful stop waits for its WebSockets until Docker
# kills it 10 s on: 12 s of refused connections with four presence sockets
# open on the local stack (2026-09-28). So only a new definition recreates.

# apply_nginx_config <compose-cmd>
#
# `compose-cmd` is the full docker compose invocation for the stack that owns
# the nginx service (word-split intentionally).
apply_nginx_config() {
	local compose_cmd="$1"
	local before after candidate running

	# shellcheck disable=SC2086
	before=$(${compose_cmd} ps -q nginx 2>/dev/null | head -1)
	if [ -z "$before" ]; then
		echo "    nginx not running — starting it"
		# shellcheck disable=SC2086
		${compose_cmd} up -d --no-deps nginx && nginx_is_up "$compose_cmd"
		return
	fi

	# stdin closed on every docker call: a script fed on stdin (`bash -s`)
	# would otherwise have the rest of itself eaten by the first one.
	# shellcheck disable=SC2086
	if ! candidate=$(${compose_cmd} run --rm --no-deps -T -e NGINX_ENTRYPOINT_QUIET_LOGS=1 \
		nginx nginx -T 2>/dev/null </dev/null); then
		echo "    !! the checkout's nginx config FAILED validation — the running nginx keeps its own" >&2
		# shellcheck disable=SC2086
		${compose_cmd} run --rm --no-deps -T -e NGINX_ENTRYPOINT_QUIET_LOGS=1 \
			nginx nginx -t 2>&1 </dev/null | sed 's/^/       /' >&2 || true
		return 1
	fi

	# The service's definition itself (its image tag, ports, mounts, env: the
	# domain) is compose's to apply: it recreates nginx only when that changed,
	# and a new container renders the config just validated, so nothing is
	# left to reload.
	# shellcheck disable=SC2086
	${compose_cmd} up -d --no-deps nginx || true
	# shellcheck disable=SC2086
	after=$(${compose_cmd} ps -q nginx 2>/dev/null | head -1)
	if [ "$after" != "$before" ]; then
		echo "    nginx recreated with the checkout's definition"
		nginx_is_up "$compose_cmd"
		return
	fi

	running=$(docker exec "$after" nginx -T 2>/dev/null </dev/null || true)
	if [ "$candidate" = "$running" ]; then
		echo "    nginx config: rendered template unchanged — reload only"
		reload_nginx "$after"
		return
	fi

	# The template changed: the running container renders it again, as its
	# entrypoint does at a start. That script exits 0 even when it could not
	# write, so what counts is its result: the running config must now be the
	# one step 1 passed.
	docker exec "$after" /docker-entrypoint.d/20-envsubst-on-templates.sh </dev/null >/dev/null 2>&1 || true
	running=$(docker exec "$after" nginx -T 2>/dev/null </dev/null || true)
	if [ "$candidate" = "$running" ]; then
		echo "    nginx config: the template changed — rendered again in the running nginx, reload"
		reload_nginx "$after"
		return
	fi

	echo "    nginx config: the template did not render in place — recreating nginx (no connections until it is back, up to ~12 s)"
	# shellcheck disable=SC2086
	${compose_cmd} up -d --no-deps --force-recreate nginx || true
	nginx_is_up "$compose_cmd"
}

# reload_nginx <container>: reloads nginx; 0 once it runs new workers. nginx
# can refuse a config `nginx -T` passed as it applies it (a port another
# process holds, say): `nginx -s reload` exits 0 all the same, and nginx says
# why in its log and goes on with its old workers and the config they run.
reload_nginx() {
	local cid="$1" before now
	before=$(nginx_workers "$cid")
	docker exec "$cid" nginx -s reload </dev/null || return 1
	for _ in $(seq 1 25); do
		sleep 0.2
		now=$(nginx_workers "$cid")
		[ -n "$now" ] && [ "$now" != "$before" ] && return 0
	done
	echo "    !! nginx refused the new config and serves with the one it had. Why: docker logs --tail 20 ${cid:0:12}" >&2
	return 1
}

# nginx_workers <container>: the PIDs of nginx's current workers, on one line
# (a worker left from an earlier config is "worker process is shutting down").
nginx_workers() {
	docker top "$1" -eo pid,args 2>/dev/null </dev/null | awk '/nginx: worker process$/ { print $1 }' | sort | tr '\n' ' '
}

# nginx_is_up <compose-cmd>: 0 when nginx is running a few seconds after a
# start; otherwise says so, with where to look. A config nginx -t passed can
# still fail to start (a port already taken).
nginx_is_up() {
	local compose_cmd="$1" cid
	sleep 3
	# shellcheck disable=SC2086
	cid=$(${compose_cmd} ps -q nginx 2>/dev/null | head -1)
	if [ -n "$cid" ] && [ "$(docker inspect --format '{{.State.Running}}' "$cid" 2>/dev/null)" = "true" ]; then
		return 0
	fi
	echo "    !! nginx is NOT running after its start: the site is down. Look at: $compose_cmd logs nginx" >&2
	return 1
}
