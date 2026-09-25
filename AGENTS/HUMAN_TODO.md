# Human TODO

Tasks that genuinely require human action — accounts, consents, decisions that need human judgment. Running servers, migrations, and database operations are NOT human tasks; agents do those.

### Add your ngrok authtoken so the game can be shared from this machine

**What**: `ngrok` is installed (Homebrew, 2026-09-25) but has no authtoken yet. Copy the token from https://dashboard.ngrok.com/get-started/your-authtoken and run, in your own terminal:

```bash
ngrok config add-authtoken <token>
```

Then share the game with `TUNNEL=1 pnpm dev:client` in one terminal and `ngrok http 5180` in another; send the `https://….ngrok-free.app` URL it prints. Recipe in [[DEVELOPMENT]] § "Sharing the game through a tunnel".

**Why**: the authtoken is tied to your account; an agent must not handle it. Until this is done the game is reachable only on this machine.

### Decide the game's name

**What**: the repo is `mathgame` and the page title is "Math Game". The real name goes in `packages/client/index.html` (`<title>`) and [[PRODUCT]] § 1. Ask the kid.

**Why**: naming is yours. Nothing blocks on it; it just leaks into copy the longer it waits.

### Confirm the target age range and devices

**What**: [[PRODUCT]] and [[DESIGN]] assume players aged roughly 6–12 on a laptop/desktop browser with a keyboard, with tablets (touch) as a follow-up. The puzzle difficulty ladder (difficulty 1 = single-digit addition, 10 = three-digit multiplication / roots up to 50) is calibrated to that guess. Correct either assumption if it's wrong and the difficulty tables in `packages/engine/src/puzzles/generators/` get re-tuned.

**Why**: only you know who's actually going to play and on what.
