# Play

Run the game locally from the current worktree and look at it. This is the game's equivalent of staging a web app: nothing about rendering, movement or feel is verified until you have seen it.

## Usage

`/play` — start both dev servers and take a screenshot of the initial state
`/play walk right 5, down 3` — also press keys before the screenshot
`/play at 390x844` — use a phone-sized viewport

## Steps

1. **Ports.** The client dev server uses **5180** and the API server **3000**. Check both are free (`lsof -nP -iTCP:5180 -sTCP:LISTEN`, same for 3000). If another session holds one, pick the next free port and pass it explicitly (`vite --port 5181`, `PORT=3001`), and never kill a listener you didn't start — see [[ENVIRONMENT_NOTES]].
2. **Database.** `pnpm db:up` if the `mathgame-postgres-1` container isn't running; `pnpm db:migrate` if migrations are pending.
3. **Start servers** in the background, logging to the scratchpad: `pnpm dev:server` and `pnpm dev:client`. Confirm with `curl localhost:3000/api/health` (expects `{"ok":true,"db":true}`) and `curl -o /dev/null -w '%{http_code}' localhost:5180/`.
4. **Look.** Run `node scripts/screenshot.mjs --out screenshots/<what>.png [--keys "ArrowRight*5"] [--width 390 --height 844]` and **read the image**. The script drives the locally installed Chrome headlessly (WebGL via SwiftShader) and prints any console errors — a non-zero exit means the page logged errors, fix them before going on.
5. **Play the flow you changed.** Movement, encounters, battle turns, puzzle input, doctor healing — whichever your change touches. Chain key presses with `--keys` and screenshot at each state that matters. If a flow needs more than key presses (typing an answer, clicking a button), extend the script rather than improvising a one-off.
6. **Stop what you started** when done (Phase 4 in CLAUDE.md): kill only the server processes you launched.

Screenshots go in `screenshots/` (gitignored). Link the ones worth showing in the PR body.
