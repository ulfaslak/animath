#!/usr/bin/env node
/**
 * Visual check: open the game in headless Chrome, drive it with keys, and
 * save screenshots. This is the standard way to *look* at a change (see
 * CLAUDE.md § Phase 2). Uses the locally installed Google Chrome via
 * playwright-core, so nothing is downloaded.
 *
 *   node scripts/screenshot.mjs [--url http://localhost:5180/] [--out screenshots/x.png]
 *                               [--keys "ArrowRight*5,ArrowDown*3"] [--wait 1500]
 *                               [--settle 1500] [--key-interval 700] [--tap-ms 100]
 *                               [--width 1280 --height 800] [--scale 1]
 *                               [--clip x,y,w,h] [--gpu metal|swiftshader]
 *                               [--reduced-motion] [--touch] [--api]
 *                               [--safe-area top,right,bottom,left]
 *                               [--host-rules "MAP old.example localhost"]
 *
 * `--host-rules` hands Chrome its `--host-resolver-rules`: the page can be
 * opened under a made-up name that leads to your own server, e.g. the old
 * tunnel's kind of address, to see what the game does away from its own
 * domain and from localhost (the moved card, `src/moved.ts`) without a hosts
 * file: `--host-rules "MAP old-tunnel.example localhost" --url
 * http://old-tunnel.example:<port>/`. Vite answers a name it does not know
 * only with `TUNNEL=1`.
 *
 * `--touch` opens the page as a touch tablet would (`hasTouch`, `isMobile`:
 * the page sees `pointer: coarse` and shows its touch controls), for the
 * `tap:` and `touch:` tokens below.
 *
 * `--keys` is a comma-separated script. A token is a key name (`ArrowRight`,
 * `Enter`, `2`), optionally `*n` to press it n times; or one of
 *   type:<text>   type each character of <text> (an answer: digits, a minus;
 *                 a name, emoji included; never a comma)
 *   hold:<key>:<ms>  hold a key down for <ms>, auto-repeating like a real
 *                 keyboard (a repeat every 100 ms after a 500 ms delay)
 *   wait:<ms>     pause, e.g. while a battle turn narrates
 *   shot:<name>   save an extra frame to `<out>-<name>.png` now
 *   size:<w>x<h>  resize the window now (e.g. mid-battle)
 *   reload:       reload the page and wait for it, as a kid pressing F5 would
 *   down:<key>    press a key and keep it down while the next tokens run; a
 *                 second `down:` of the same key is an auto-repeat
 *   up:<key>      let go of a key pressed with `down:`
 *   tap:<css>     tap the first element matching a CSS selector with a finger
 *                 (`--touch` only), e.g. `tap:.talk`, `tap:.pad .ok`
 *   touch:<css>:<ms>  keep a finger on that element for <ms>, e.g. an arrow
 *                 of the D-pad held down: `touch:.dpad .up:1200`
 *   click:<css>   click it with the mouse, e.g. `click:.actions .tile.selected`
 * A selector never holds a comma (the script's separator); `:nth-child(2)`
 * and friends are fine.
 * The final frame goes to `--out`. After every frame the script prints what
 * the screen says — on the title its menu, the confirm, the player's name
 * box, the starters and the starter's name box; the message line in explore (and the grid position and
 * facing with `?debug` in the URL), the party cards (and an open card's
 * animals) and the puzzles solved, tokens, tools and world in the corner; in the pause menu its
 * rows, the picked animal's options and the name box (with whether it has
 * the focus); at the doctor the doctor's line, the tokens, the tabs, the
 * tab's list and what its right-hand side says; and in a battle
 * the narration line, the menu's attack tiles and moves (or the switch list),
 * the preview card, the puzzle, the typed answer, the judgement, the status
 * boxes, a hit's burst and the result card — so a flow can be asserted from the console
 * output, not only the images. With `?debug`, it also prints the last sound
 * cues the game asked for (`cue:`), which headless Chrome plays to no one.
 *
 * `--reduced-motion` opens the page as a system that asks for less motion
 * (`prefers-reduced-motion: reduce`).
 *
 * `--safe-area 0,59,21,59` gives the screen a safe area, as a notch, rounded
 * corners or the home indicator do (the insets in CSS pixels, top, right,
 * bottom, left: an iPhone held sideways here; an iPad's home indicator is
 * `0,0,20,0`): the page's `env(safe-area-inset-*)` reports them. The frames
 * tint the strips outside the safe area red, so what sits under them shows.
 *
 * Each run is a fresh browser, so a new player with no game: the title, with
 * New game only (`?new` goes past it into a throwaway game); `reload:` keeps
 * the game, which is saved in the page's localStorage. The script exits
 * non-zero on console errors and warnings, except failed `/api/` calls: the
 * game saves locally without the API, so those are listed at the end instead.
 *
 * The game's API is blocked: every request to `/api/` is aborted in the
 * browser, as if the server were down, and the blocked calls are counted at
 * the end. Every Vite of this repo proxies `/api` to port 3000 (the primary
 * clone's API, which serves the kids on its tunnel) unless `API_PORT` says
 * otherwise: an unblocked run would walk into the kids' worlds as a player,
 * and an account made in it would land in their database (unblocked runs
 * once filled it with throwaway players, when guests were backed up there).
 * The game saves in the page and plays the same. `--api` lets the calls
 * through, for a run that tests accounts: against your own API and a
 * throwaway database. The presence socket (`/api/ws`) is held the same way:
 * it opens onto nothing, the page looks for other players and plays alone,
 * and `--api` lets it through too. To see other players, drive several
 * pages against your own server with `scripts/players.mjs`.
 *
 * WebGL draws on the GPU by default on a Mac (`--gpu metal`: ANGLE over Metal,
 * as Chrome itself draws there), at 15–20 frames a second headless.
 * `--gpu swiftshader` draws in software instead, the default elsewhere: well
 * under 3 frames a second, so buffered steps need the `--settle` wait to finish
 * before the screenshot. The first line printed names the renderer that drew.
 * `--scale 3` renders the same framing at three device pixels per CSS pixel
 * and `--clip` keeps only a region of it (CSS pixels): together they magnify a
 * detail without changing what the camera sees.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';

// `--name value`, or a lone `--name` (followed by another `--flag` or nothing) for true.
const args = Object.fromEntries(
	process.argv
		.slice(2)
		.map((a, i, all) => {
			if (!a.startsWith('--')) return null;
			const next = all[i + 1];
			return [a.slice(2), next === undefined || next.startsWith('--') ? 'true' : next];
		})
		.filter(Boolean)
);
const url = args.url ?? 'http://localhost:5180/';
const out = resolve(args.out ?? `screenshots/shot-${Date.now()}.png`);
const wait = Number(args.wait ?? 1500);
const settle = Number(args.settle ?? 1500);
// A grid step takes a few frames, a second or more in software; the client
// buffers only two taps by design, so keys are spaced out to let each step complete.
const keyInterval = Number(args['key-interval'] ?? 700);
// How long a key token holds its key. A step takes 0.18 s, and a key still
// down when a step lands walks another tile, so a hold longer than a step is
// two steps whenever the page draws fast. Keep taps shorter than a step.
const tapMs = Number(args['tap-ms'] ?? 100);
const touchScreen = args.touch === 'true';
const width = Number(args.width ?? 1280);
const height = Number(args.height ?? 800);
const scale = Number(args.scale ?? 1);
const clip = args.clip
	? (([x, y, w, h]) => ({ x, y, width: w, height: h }))(args.clip.split(',').map(Number))
	: undefined;
const script = (args.keys ?? '')
	.split(',')
	.filter(Boolean)
	.flatMap((token) => {
		const m = /^(type|wait|shot|hold|size|reload|down|up|tap|touch|click):(.*)$/.exec(token);
		if (m) return [{ op: m[1], arg: m[2] }];
		const [key, n] = token.split('*');
		return Array(Number(n ?? 1)).fill({ op: 'key', arg: key });
	});

// The Mac's GPU through ANGLE's Metal backend, or SwiftShader, Chrome's software
// renderer: the fallback for a machine without Metal, or to rule the GPU out.
const GPU_ARGS = {
	metal: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
	swiftshader: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
};
const gpu = args.gpu ?? (process.platform === 'darwin' ? 'metal' : 'swiftshader');
if (!GPU_ARGS[gpu]) {
	console.error(`--gpu is metal or swiftshader, not "${gpu}"`);
	process.exit(2);
}
// A lone flag: a value after it would be read as "not asked for" and block the API silently.
if (args.api !== undefined && args.api !== 'true') {
	console.error(`--api takes no value, not "${args.api}"`);
	process.exit(2);
}
const allowApi = args.api === 'true';
// A lone `--host-rules` would map nothing and open the real address instead.
if (args['host-rules'] === 'true') {
	console.error('--host-rules takes rules, e.g. "MAP old-tunnel.example localhost"');
	process.exit(2);
}
const hostRules = args['host-rules'] ? [`--host-resolver-rules=${args['host-rules']}`] : [];
const browser = await chromium.launch({
	channel: 'chrome',
	headless: true,
	args: [...GPU_ARGS[gpu], ...hostRules]
});
const context = await browser.newContext({
	viewport: { width, height },
	deviceScaleFactor: scale,
	reducedMotion: args['reduced-motion'] ? 'reduce' : 'no-preference',
	hasTouch: touchScreen,
	isMobile: touchScreen
});
/** A request to the game's API (`/api` and below; a module such as `/src/save/api.ts` is not one). */
const isApi = (u) => {
	try {
		return /^\/api(\/|$)/.test(new URL(u).pathname);
	} catch {
		return false;
	}
};
// Unless `--api`, every API request is aborted before it leaves the browser, on
// every page of the context, and counted here ("GET /api/account/ready" → 2).
const blocked = new Map();
if (!allowApi) {
	await context.route(isApi, (route) => {
		const call = `${route.request().method()} ${new URL(route.request().url()).pathname}`;
		blocked.set(call, (blocked.get(call) ?? 0) + 1);
		return route.abort('blockedbyclient');
	});
	// The presence socket (/api/ws) too: it opens onto nothing here and hears nothing back,
	// so the page looks for other players and plays on alone, as with the server down.
	await context.routeWebSocket(isApi, () => {
		blocked.set('WebSocket /api/ws', (blocked.get('WebSocket /api/ws') ?? 0) + 1);
	});
}
const page = await context.newPage();
if (args['safe-area']) {
	const [top, right, bottom, left] = args['safe-area'].split(',').map(Number);
	if (![top, right, bottom, left].every((n) => Number.isFinite(n) && n >= 0)) {
		console.error(`--safe-area is four insets, top,right,bottom,left, not "${args['safe-area']}"`);
		process.exit(2);
	}
	const cdp = await context.newCDPSession(page);
	await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top, right, bottom, left } });
	// Red strips where the notch and the home indicator would be, over everything, taking no taps.
	await page.addInitScript(`addEventListener('DOMContentLoaded', () => {
		const strips = document.createElement('div');
		strips.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;' +
			'border:solid rgba(242,95,92,0.45);border-width:${top}px ${right}px ${bottom}px ${left}px';
		document.documentElement.append(strips);
	});`);
}
const errors = [];
// The game saves locally and backs up to the API when it can; it plays the same
// without it. Failed API calls are listed, not counted as errors.
const api = [];
page.on('console', (m) => {
	// SwiftShader (headless software GL) spams "GPU stall" performance notes; not ours.
	if (/GPU stall/.test(m.text())) return;
	// Chrome logs every failed request; the API ones are listed below instead.
	if (/^Failed to load resource/.test(m.text()) && isApi(m.location().url)) return;
	// A presence socket the server did not take (it is down, or restarting): the game plays on.
	const socket = /^WebSocket connection to '([^']+)' failed/.exec(m.text());
	if (socket && isApi(socket[1].replace(/^ws/, 'http'))) {
		api.push(`WebSocket ${new URL(socket[1]).pathname} failed`);
		return;
	}
	if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('response', (r) => {
	if (!isApi(r.url())) return;
	const call = `${r.request().method()} ${new URL(r.url()).pathname}`;
	// Blocked, no API call gets an answer; one that did got past the block, which fails the run.
	if (!allowApi) errors.push(`[api] ${call} reached a server though the API is blocked`);
	else if (r.status() >= 400) api.push(`${call} → ${r.status()}`);
});
page.on('requestfailed', (r) => {
	// The blocked calls fail here too; they are counted in `blocked` instead.
	if (allowApi && isApi(r.url())) {
		api.push(`${r.method()} ${new URL(r.url()).pathname} failed (${r.failure()?.errorText})`);
	}
});

/** Text of the first element matching `selector`, or null when there is none. */
async function textOf(selector) {
	const locator = page.locator(selector);
	if ((await locator.count()) === 0) return null;
	const text = await locator.first().textContent();
	return text === null ? null : text.replace(/\s+/g, ' ').trim();
}

/** What the screen says right now, one `key: value` per line. */
async function describe() {
	const lines = [];
	// The moved card, before the game on an old address: its words, and where its button goes.
	const moved = await textOf('.moved .title');
	if (moved !== null) {
		const go = await page.locator('.moved .go').getAttribute('href');
		lines.push(
			`moved: ${moved} [${await textOf('.moved .go')} → ${go}] (${await textOf('.moved .here')})`
		);
	}
	// The title: its menu rows (the lit one in brackets), the confirm's choices,
	// the player's name box, the starters' name tags (the lit one in brackets)
	// and the card under them.
	const lit = (selector) =>
		page.locator(selector).evaluateAll((els) =>
			els.map((el) => {
				const text = el.textContent.replace(/[▸\s]+/g, ' ').trim();
				return el.classList.contains('lit') ? `[${text}]` : text;
			})
		);
	const titleRows = await lit('.menu-card .row');
	if (titleRows.length) lines.push(`title: ${titleRows.join(' | ')}`);
	const confirm = await textOf('.confirm .heading');
	if (confirm !== null)
		lines.push(`confirm: ${confirm} ${(await lit('.confirm .row')).join(' | ')}`);
	// The player's name box: its question, what is typed, and the rule or why a name did not go.
	const playerName = await textOf('.player-card .heading');
	if (playerName !== null) {
		const typed = await page.locator('.player-card .name-box').inputValue();
		const note = await textOf('.player-card .note');
		lines.push(`player: ${playerName} [${typed}]${note === null ? '' : ` — ${note}`}`);
	}
	const starters = await lit('.starter-screen .tag');
	if (starters.length) lines.push(`starters: ${starters.join(' | ')}`);
	const starterCard = await textOf('.starter-card .heading');
	if (starterCard !== null) {
		const loves = await textOf('.starter-card .loves');
		lines.push(`starter: ${[starterCard, loves].filter((t) => t !== null).join(' — ')}`);
	}
	const titleNotes = await page.locator('.menu-card .note, .starter-card .note').allTextContents();
	if (titleNotes.length) lines.push(`title notes: ${titleNotes.map((n) => n.trim()).join(' | ')}`);
	const debug = await textOf('.debug:not(.debug-cue)');
	if (debug !== null) lines.push(`at: ${debug}`);
	const cue = await textOf('.debug-cue');
	if (cue !== null) lines.push(`cue: ${cue}`);
	// The touch controls on screen: the D-pad (and the arrow held), Talk (its
	// label, and lit when it does something: a tent, a tree or a rock with its
	// tool), Menu, the number pad; and the turn-sideways screen.
	const controls = await page.evaluate(() => {
		const out = [];
		if (!document.documentElement.classList.contains('touch')) return out;
		out.push('on');
		const dpad = document.querySelector('.dpad');
		if (dpad)
			out.push(
				`dpad${dpad.querySelector('.on') ? ` (${dpad.querySelector('.on').className.split(' ')[1]} held)` : ''}`
			);
		const talk = document.querySelector('.talk-button');
		if (talk) {
			out.push(
				`talk "${talk.textContent.trim()}"${talk.classList.contains('ready') ? ' (lit)' : ''}`
			);
		}
		if (document.querySelector('.menu-button')) out.push('menu');
		const pad = document.querySelector('.pad');
		if (pad) out.push(`number pad${pad.classList.contains('off') ? ' (dimmed)' : ''}`);
		if (document.querySelector('.turn')) out.push('TURN SIDEWAYS');
		return out;
	});
	if (controls.length) lines.push(`touch: ${controls.join(', ')}`);
	const message = await textOf('.hint .message');
	const prompt = await textOf('.hint .prompt');
	if (message !== null || prompt !== null) {
		lines.push(`hud: ${[message, prompt].filter((t) => t !== null).join(' | ')}`);
	}
	const doctorLine = await textOf('.doctor-line');
	if (doctorLine !== null) lines.push(`doctor: ${doctorLine}`);
	// The doctor's tabs (the one on screen in brackets) and the player's tokens.
	const tabs = await page
		.locator('.doctor .tab')
		.evaluateAll((els) =>
			els.map((el) =>
				el.classList.contains('on') ? `[${el.textContent.trim()}]` : el.textContent.trim()
			)
		);
	if (tabs.length)
		lines.push(`tabs: ${tabs.join(' | ')} · ${await textOf('.doctor .purse .tokens')}`);
	// The tab's list: the highlighted row in brackets, a picked animal (or a
	// whole kind) with ✓, a kind picked in part with –, one who has to stay
	// marked, what a kind brings or an item costs, a greyed row marked.
	const patients = await page.locator('.patients .row').evaluateAll((els) =>
		els.map((el) => {
			const label = (el.querySelector('.label')?.textContent ?? '').replace(/\s+/g, ' ').trim();
			const tag = el.querySelector('.tag')?.textContent;
			const hp = el.querySelector('.hp .text')?.textContent;
			const worth = el.querySelector('.worth')?.textContent.trim();
			const picked = el.classList.contains('marked')
				? '✓ '
				: el.classList.contains('some')
					? '– '
					: '';
			const stays = el.querySelector('.check.stays') ? '(stays)' : '';
			const off = el.classList.contains('healthy') || el.classList.contains('off');
			const text =
				picked +
				[label, tag && `(${tag})`, hp, worth, stays, off && '(greyed)'].filter(Boolean).join(' ');
			return el.classList.contains('selected') ? `[${text}]` : text;
		})
	);
	if (patients.length) lines.push(`patients: ${patients.join(' | ')}`);
	// The right-hand side before a pick: its title, a hand-over's running total, what the highlighted row does.
	const side = await page
		.locator('.doctor .puzzle :is(.soft, .tally, .detail, .ware-name)')
		.evaluateAll((els) => els.map((el) => el.textContent.replace(/\s+/g, ' ').trim()));
	if (side.length) lines.push(`side: ${side.join(' · ')}`);
	const choices = await page
		.locator('.doctor .choice')
		.evaluateAll((els) =>
			els.map((el) =>
				el.classList.contains('lit') ? `[${el.textContent.trim()}]` : el.textContent.trim()
			)
		);
	if (choices.length)
		lines.push(`confirm: ${await textOf('.doctor .question')} ${choices.join(' | ')}`);
	const story = await textOf('.story');
	if (story !== null) lines.push(`story: ${story}`);
	// The puzzles solved, the tokens, the tools and the world in explore's top right corner.
	const belongings = await page
		.locator('.belongings :is(.solved, .purse, .tool, .world)')
		.allTextContents();
	if (belongings.length) lines.push(`belongings: ${belongings.map((b) => b.trim()).join(' · ')}`);
	// Party cards in explore, one per species, the lead's in brackets and an open one in braces:
	// "[1 Pip 20/20 goes first] | {2 Rabbit ×4 3 ready · 1 tired}"; then the open card's animals.
	const cards = await page.locator('.party .cards .bundle').evaluateAll((els) =>
		els.map((el) => {
			const text = el.textContent.replace(/\s+/g, ' ').trim();
			const shown = el.classList.contains('open') ? `{${text}}` : text;
			return el.classList.contains('lead') ? `[${shown}]` : shown;
		})
	);
	if (cards.length) lines.push(`party: ${cards.join(' | ')}`);
	const fan = await page.locator('.party .fan .animal').evaluateAll((els) =>
		els.map((el) => {
			const text = el.textContent.replace(/\s+/g, ' ').trim();
			return el.classList.contains('lead') ? `[${text}]` : text;
		})
	);
	if (fan.length)
		lines.push(
			`open card (${fan.length}): ${fan.slice(0, 8).join(' | ')}${fan.length > 8 ? ' | …' : ''}`
		);
	// The pause menu: its rows (the lit one in brackets), the picked animal's
	// options (greyed ones in parentheses), and the name box.
	const pauseRows = await page.locator('.menu .team .row').evaluateAll((els) =>
		els.map((el) => {
			const text = el.textContent.replace(/\s+/g, ' ').trim();
			return el.classList.contains('lit') ? `[${text}]` : text;
		})
	);
	if (pauseRows.length) lines.push(`pause: ${pauseRows.join(' | ')}`);
	// A card's animals on the right of the pause menu, the lit one in brackets.
	const members = await page.locator('.menu .side .animal').evaluateAll((els) =>
		els.map((el) => {
			const text = el.textContent.replace(/\s+/g, ' ').trim();
			return el.classList.contains('lit') ? `[${text}]` : text;
		})
	);
	if (members.length) {
		lines.push(
			`card (${members.length}): ${members.slice(0, 8).join(' | ')}${members.length > 8 ? ' | …' : ''}`
		);
	}
	const options = await page.locator('.menu .option').evaluateAll((els) =>
		els.map((el) => {
			const text = el.textContent.replace(/[▸\s]+/g, ' ').trim();
			if (el.classList.contains('off')) return `(${text})`;
			return el.classList.contains('lit') ? `[${text}]` : text;
		})
	);
	if (options.length) lines.push(`options: ${options.join(' | ')}`);
	const nameBox = page.locator('.name-box');
	if ((await nameBox.count()) > 0) {
		const focused = await nameBox.evaluate((el) => el === document.activeElement);
		lines.push(
			`name box: "${await nameBox.inputValue()}"${focused ? ' (focused)' : ' (NOT focused)'}`
		);
	}
	const notes = await page.locator('.menu .note').allTextContents();
	if (notes.length) lines.push(`notes: ${notes.map((n) => n.trim()).join(' | ')}`);
	const statuses = await page.locator('.status').allTextContents();
	if (statuses.length) {
		lines.push(`status: ${statuses.map((s) => s.replace(/\s+/g, ' ').trim()).join(' | ')}`);
	}
	// The action menu: each attack's tile with its level word and hit badge,
	// then the moves under them with the leash's hint, the highlighted one in
	// brackets, a greyed one marked.
	const menu = await page.locator('.actions .tile, .actions .move').evaluateAll((els) =>
		els.map((el) => {
			const tile = el.classList.contains('tile');
			const label = el.querySelector(tile ? '.name' : '.word')?.textContent.trim() ?? '';
			const notes = tile
				? [
						el.querySelector('.level')?.textContent.trim(),
						`✸${el.querySelector('.n')?.textContent}`
					]
				: [el.querySelector('.hint')?.textContent.trim(), el.classList.contains('off') && 'greyed'];
			const said = notes.filter(Boolean);
			const text = [label, said.length && `(${said.join(', ')})`].filter(Boolean).join(' ');
			return el.classList.contains('selected') ? `[${text}]` : text;
		})
	);
	if (menu.length) lines.push(`menu: ${menu.join(' | ')}`);
	// The battle's switch list stands where the menu was (`party:` is the explore
	// HUD's cards): the highlighted row in brackets, greyed rows marked.
	const rows = await page.locator('.actions.party .row').evaluateAll((els) =>
		els.map((el) => {
			const label = el.querySelector('.label')?.textContent ?? '';
			const hp = el.querySelector('.hp .text')?.textContent.trim();
			const how = el.querySelector('.how')?.textContent.trim();
			const notes = [how, el.classList.contains('off') && 'greyed'].filter(Boolean);
			const text = [label, hp, notes.length && `(${notes.join(', ')})`].filter(Boolean).join(' ');
			return el.classList.contains('selected') ? `[${text}]` : text;
		})
	);
	if (rows.length) lines.push(`switch: ${rows.join(' | ')}`);
	// The preview card before a pick: the move's title, its badge, its operator
	// chips, each level with its damage (the one set in brackets), the leash's
	// hint and "That would tire it out!" in « ».
	const previews = await page.locator('.preview').evaluateAll((els) =>
		els.map((el) => {
			const levels = [...el.querySelectorAll('.levels .level')].map((l) => {
				const text = `${l.querySelector('.word')?.textContent.trim()} ✸${l.querySelector('.n')?.textContent}`;
				return l.classList.contains('on') ? `[${text}]` : text;
			});
			const chips = [...el.querySelectorAll('.chip')].map((c) => c.textContent.trim());
			const badge = el.querySelector('.head .badge .n')?.textContent;
			const hint = el.querySelector('.hint')?.textContent.trim();
			const tires = el.querySelector('.tires')?.textContent.trim();
			return [
				el.querySelector('.title')?.textContent.trim(),
				badge && `✸${badge}`,
				chips.length && `[${chips.join(' ')}]`,
				levels.join(' · '),
				hint && `(${hint})`,
				tires && `«${tires}»`
			]
				.filter(Boolean)
				.join('  ');
		})
	);
	if (previews.length) lines.push(`preview: ${previews.join(' | ')}`);
	// A hit landing: the burst beside a status box, and its level.
	const bursts = await page
		.locator('.burst')
		.evaluateAll((els) =>
			els.map(
				(el) => `${el.textContent.trim()} (${[...el.classList].find((c) => /^l\d$/.test(c))})`
			)
		);
	if (bursts.length) lines.push(`burst: ${bursts.join(' | ')}`);
	for (const [label, selector] of [
		['line', '.battle-line'],
		['detail', '.detail'],
		['puzzle', '.puzzle-prompt'],
		['answer', '.answer'],
		['judged', '.judgement'],
		['result', '.result-title'],
		['result-text', '.result-text']
	]) {
		const text = await textOf(selector);
		if (text !== null) lines.push(`${label}: ${text}`);
	}
	return lines;
}

async function shoot(path) {
	mkdirSync(dirname(path), { recursive: true });
	// A loaded machine (several headless Chromes on SwiftShader) can take longer than
	// Playwright's 30 s default to draw one frame.
	await page.screenshot({ path, clip, timeout: 180_000 });
	console.log(`saved ${path}`);
	for (const line of await describe()) console.log(`  ${line}`);
}

const ext = extname(out);
const stem = join(dirname(out), basename(out, ext));

await page.goto(url, { waitUntil: 'networkidle' });
// Which renderer drew the frames: a fresh canvas, so the game's context keeps its settings.
const renderer = await page.evaluate(() => {
	const gl = document.createElement('canvas').getContext('webgl2');
	const info = gl?.getExtension('WEBGL_debug_renderer_info');
	const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER);
	gl?.getExtension('WEBGL_lose_context')?.loseContext();
	return name ?? 'no WebGL';
});
console.log(`gpu: ${gpu} (${renderer})`);
if (allowApi) console.log("api: on, to whatever this page's server proxies /api to");
await page.waitForTimeout(wait);
for (const { op, arg } of script) {
	switch (op) {
		case 'key':
			await page.keyboard.down(arg);
			await page.waitForTimeout(tapMs);
			await page.keyboard.up(arg);
			await page.waitForTimeout(keyInterval);
			break;
		case 'type':
			// `type` presses a key for anything on a keyboard and inserts the rest
			// (an emoji, an accented letter) as text, as a real input method would.
			for (const ch of arg) {
				await page.keyboard.type(ch);
				await page.waitForTimeout(150);
			}
			await page.waitForTimeout(keyInterval);
			break;
		case 'hold': {
			const [key, ms] = arg.split(':');
			const until = Date.now() + Number(ms);
			await page.keyboard.down(key);
			await page.waitForTimeout(Math.min(500, Number(ms)));
			// Playwright marks a second `down` of a held key as `repeat: true`.
			while (Date.now() < until) {
				await page.keyboard.down(key);
				await page.waitForTimeout(100);
			}
			await page.keyboard.up(key);
			await page.waitForTimeout(keyInterval);
			break;
		}
		case 'wait':
			await page.waitForTimeout(Number(arg));
			break;
		case 'size': {
			const [w, h] = arg.split('x').map(Number);
			await page.setViewportSize({ width: w, height: h });
			await page.waitForTimeout(400);
			break;
		}
		case 'reload':
			await page.reload({ waitUntil: 'networkidle' });
			await page.waitForTimeout(wait);
			break;
		case 'down':
			await page.keyboard.down(arg);
			await page.waitForTimeout(keyInterval);
			break;
		case 'up':
			await page.keyboard.up(arg);
			await page.waitForTimeout(keyInterval);
			break;
		case 'tap':
			if (!touchScreen) throw new Error('tap: needs --touch; a mouse clicks with click:');
			await page.locator(arg).first().tap({ timeout: 20_000 });
			await page.waitForTimeout(keyInterval);
			break;
		case 'click':
			await page.locator(arg).first().click({ timeout: 20_000 });
			await page.waitForTimeout(keyInterval);
			break;
		case 'touch': {
			// A finger held down on the element's centre, then lifted: `touch:<css>:<ms>`.
			if (!touchScreen) throw new Error('touch: needs --touch');
			const cut = arg.lastIndexOf(':');
			const box = await page.locator(arg.slice(0, cut)).first().boundingBox({ timeout: 20_000 });
			if (!box) throw new Error(`touch: nothing to touch at ${arg.slice(0, cut)}`);
			const finger = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
			const cdp = await context.newCDPSession(page);
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [finger] });
			await page.waitForTimeout(Number(arg.slice(cut + 1)));
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
			await cdp.detach();
			await page.waitForTimeout(keyInterval);
			break;
		}
		case 'shot':
			await page.waitForTimeout(400);
			await shoot(`${stem}-${arg}${ext || '.png'}`);
			break;
	}
}
await page.waitForTimeout(script.length ? settle : 200);
await shoot(out);
await browser.close();

if (blocked.size) {
	const calls = [...blocked].map(([call, n]) => (n > 1 ? `${call} ×${n}` : call));
	console.log(
		`api calls blocked (the game saves locally; --api lets them through): ${calls.join(', ')}`
	);
}
if (api.length) {
	console.log('api calls that did not succeed (the game plays on and saves locally):');
	for (const line of api) console.log('  ' + line);
}
if (errors.length) {
	console.log('console errors/warnings:');
	for (const e of errors) console.log('  ' + e);
	process.exitCode = 1;
}
