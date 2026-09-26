# Play

Run the game locally from the current worktree and look at it. This is the game's equivalent of staging a web app: nothing about rendering, movement or feel is verified until you have seen it.

## Usage

`/play` — start a client dev server and take a screenshot of the initial state
`/play walk right 5, down 3` — also press keys before the screenshot
`/play at 390x844` — use a phone-sized viewport

## Steps

1. **Port.** The primary clone's Vite holds **5180** and its API **3000**; both serve the human's tunnel, often with kids on it, so never point a run at them. Pick a free port for your own client (`lsof -nP -iTCP:5191 -sTCP:LISTEN` prints nothing), and never kill a listener you didn't start — see [[ENVIRONMENT_NOTES]].
2. **Start the client** in the background, logging to the scratchpad: `pnpm -F @mathgame/client exec vite --port <port> --strictPort`. Confirm with `curl -o /dev/null -w '%{http_code}' localhost:<port>/`. Start no API server and no database: the game saves in the browser, and the screenshot script keeps it away from any API (next step).
3. **The API is blocked.** The screenshot script aborts every `/api/` request in the browser, as if the server were down, and counts the blocked calls at the end. Your Vite proxies `/api` to 3000, the human's API, unless `API_PORT` says otherwise, and a game started in a fresh browser makes a player on the server, so without the block every run filled the kids' database with throwaway players. The game plays and saves the same. Only when your change touches the backup (the autosave's server side, the save routes) pass `--api`, with your own API and a database of your own behind your Vite ([[DEVELOPMENT]] § Running has the commands); drop the database when you are done.
4. **Look.** Run `node scripts/screenshot.mjs --url http://localhost:<port>/ --out screenshots/<what>.png [--keys "ArrowRight*5"] [--width 390 --height 844]` and **read the image**. The script drives the locally installed Chrome headlessly. On a Mac WebGL draws on the GPU (`--gpu metal`, the default there; `--gpu swiftshader` draws in software, many times slower), and the first line printed names the renderer. It prints any console errors — a non-zero exit means the page logged errors, fix them before going on.
5. **Play the flow you changed.** Movement, encounters, battle turns, puzzle input, doctor healing — whichever your change touches. Chain key presses with `--keys` and screenshot at each state that matters. If a flow needs more than key presses (typing an answer, clicking a button), extend the script rather than improvising a one-off.
6. **Stop what you started** when done (Phase 4 in CLAUDE.md): kill only the server processes you launched.

Screenshots go in `screenshots/` (gitignored). Link the ones worth showing in the PR body.
