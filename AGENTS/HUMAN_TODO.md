# Human TODO

Tasks that genuinely require human action — accounts, consents, decisions that need human judgment. Running servers, migrations, and database operations are NOT human tasks; agents do those.

### Install a tunnel client so the game can be shared from this machine

**What**: Neither `ngrok` nor `cloudflared` is installed. Pick one:

- ngrok: `brew install ngrok`, then `ngrok config add-authtoken <token>` from your ngrok dashboard. Run with `ngrok http 5180`.
- cloudflared (no account needed for quick tunnels): `brew install cloudflared`, run with `cloudflared tunnel --url http://localhost:5180`.

Either way, start the client dev server with `TUNNEL=1 pnpm dev:client` so Vite accepts the tunnel hostname. Recipe in [[DEVELOPMENT]] § "Sharing the game through a tunnel".

**Why**: the authtoken is tied to your account; an agent can't create it. Until this is done the game is reachable only on this machine.

### Decide the game's name

**What**: the repo is `mathgame` and the page title is "Math Game". The real name goes in `packages/client/index.html` (`<title>`) and [[PRODUCT]] § 1. Ask the kid.

**Why**: naming is yours. Nothing blocks on it; it just leaks into copy the longer it waits.

### Confirm the target age range and devices

**What**: [[PRODUCT]] and [[DESIGN]] assume players aged roughly 6–12 on a laptop/desktop browser with a keyboard, with tablets (touch) as a follow-up. The puzzle difficulty ladder (difficulty 1 = single-digit addition, 10 = three-digit multiplication / roots up to 50) is calibrated to that guess. Correct either assumption if it's wrong and the difficulty tables in `packages/engine/src/puzzles/generators/` get re-tuned.

**Why**: only you know who's actually going to play and on what.
