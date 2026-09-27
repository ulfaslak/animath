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
#   - A change to the template, or to the domain, reaches /etc/nginx/nginx.conf
#     only when the container starts again: it needs a recreate (~2 s blip).
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
#   4. The same -> reload (picks up the included files; costs nothing).
#      Different -> recreate, so the template renders again.

# apply_nginx_config <compose-cmd>
#
# `compose-cmd` is the full docker compose invocation for the stack that owns
# the nginx service (word-split intentionally).
apply_nginx_config() {
	local compose_cmd="$1"
	local cid candidate running

	# shellcheck disable=SC2086
	cid=$(${compose_cmd} ps -q nginx 2>/dev/null | head -1)
	if [ -z "$cid" ]; then
		echo "    nginx not running — starting it"
		# shellcheck disable=SC2086
		${compose_cmd} up -d --no-deps nginx
		return 0
	fi

	# stdin closed on every docker call: a script fed on stdin (`bash -s`)
	# would otherwise have the rest of itself eaten by the first one.
	# shellcheck disable=SC2086
	if ! candidate=$(${compose_cmd} run --rm --no-deps -T -e NGINX_ENTRYPOINT_QUIET_LOGS=1 \
		nginx nginx -T 2>/dev/null </dev/null); then
		echo "    !! the checkout's nginx config FAILED validation — keeping the running config" >&2
		# shellcheck disable=SC2086
		${compose_cmd} run --rm --no-deps -T -e NGINX_ENTRYPOINT_QUIET_LOGS=1 \
			nginx nginx -t 2>&1 </dev/null | sed 's/^/       /' >&2 || true
		return 1
	fi

	# The service's definition itself (its image tag, ports, mounts, env: the
	# domain) is compose's to apply: it recreates nginx only when that changed,
	# and the new container renders the config just validated.
	# shellcheck disable=SC2086
	${compose_cmd} up -d --no-deps nginx
	# shellcheck disable=SC2086
	cid=$(${compose_cmd} ps -q nginx 2>/dev/null | head -1)

	running=$(docker exec "$cid" nginx -T 2>/dev/null </dev/null || true)
	if [ "$candidate" = "$running" ]; then
		echo "    nginx config: rendered template unchanged — reload only"
		docker exec "$cid" nginx -s reload </dev/null
		return
	fi

	echo "    nginx config: the template or the domain changed — recreating nginx to render it (~2 s blip)"
	# shellcheck disable=SC2086
	${compose_cmd} up -d --no-deps --force-recreate nginx
}
