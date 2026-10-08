/**
 * Several players at once: one headless Chrome, one browser context per
 * player (each its own localStorage, so its own guest and its own game),
 * all against one running game and its server, driven by one script of
 * steps and screenshotted player by player. The way to look at anything two
 * players share: seeing each other, Who's here and Go to, friendly matches.
 * Run it with the server package's tsx, which the root script does:
 *
 *   pnpm players --url http://localhost:5191/ \
 *     --player "ada:name=Ada,at=-2:6" \
 *     --player "bo:name=Bo,at=1:6,boat,party=otter:9*2" \
 *     --steps "ada:ArrowRight*2,all:wait:1500,all:shot:start,bo:Escape,bo:shot:menu" \
 *     --out screenshots/two/run
 *
 * `--player label:options` (once per player, in order) makes a player whose
 * game is a save put in its browser before the page opens, then picked up
 * with Continue on the title. Options, comma-separated:
 *   name=Ada      the character's name (without one the game asks for it first, and
 *                 until then nobody sees the player)
 *   world=7       the world number (1 by default)
 *   land=arctic   the land they are in (Nordland by default): its party, items and money are theirs
 *   at=x:y        where they stand (the world's spawn by default)
 *   facing=left   the way they face (down by default)
 *   party=...     their animals, as `?party=` writes them but joined with `+`
 *                 (a comma ends the option): `party=rabbit+fox:3*2`
 *   boat          they own the boat
 *   items=axe+glider  the tools they own, in the order bought (`boat` alone is `items=boat`)
 *   tokens=23     their tokens (0 by default)
 *   solved=312    the puzzles they have solved (0 by default)
 *   freed=50      how many of Nordland's species they have set free (its first ones, in the
 *                 registry's order; 0 by default): all 50 unlock The Arctic
 *   touch         a touch tablet (the touch controls on)
 *   safe=0:59:21:59  a safe area, as `scripts/screenshot.mjs --safe-area` gives one (top,
 *                 right, bottom, left: an iPhone held sideways here), tinted red in the frames
 *   calm          a system that asks for less motion (`prefers-reduced-motion`)
 *   lang=da       the game in this language
 *   size=1024x768 the window (1280x800 by default)
 *   steps=10      steps walked so far, which key the encounters: from the start tile,
 *                 steps=10 and one step Left meets a wild animal on the reed
 *   title         stay on the title (no Continue)
 *   nodebug       no `?debug` (which moves the top-right corner's pills down under its
 *                 badge): the corner as a kid sees it, and no `at:` line
 * A save that is already in the page's storage (after `reload:`) is kept.
 *
 * `--steps` is a comma-separated script; each step is `who:token`, `who` a
 * player's label or `all` (every player, one after the other). A token is a
 * key (`ArrowRight`, `Enter`, `*n` to press it n times), or one of:
 *   wait:<ms>          everyone waits
 *   shot:<name>        a frame of that player, to `<out>-<label>-<name>.png`
 *   burst:<name>:<n>   n frames as fast as they come (`-1`, `-2`…): a flourish that is soon over;
 *                      `burst:<name>:<n>:<x>:<y>:<w>:<h>` frames only that part of the page, quicker
 *   press:<key>        a key, going straight on to the next step (no pause after it)
 *   type:<text>        type into what has the focus
 *   hold:<key>:<ms>    hold a key down, auto-repeating
 *   down:<key>, up:<key>  press a key and keep it down while the next steps run; let it go
 *   click:<css> / tap:<css>   a click, or a finger (touch players), on an element
 *   reload:            reload the page, as F5 would
 *   close: / open:     close the page (the player leaves), or open it again
 *   offline: / online: the player's network goes, or comes back. Their presence sockets
 *                      close at both ends (the server hears them go, as its heartbeat
 *                      would find them gone), and no new one gets through until
 *                      `online:`, which also tells the page the network is back (its
 *                      `online` event), so it tries again at once. Chrome's own offline
 *                      switch leaves an open socket open, so it is not used.
 *   delay: / deliver:  what the player's page sends the server is held on the way (the
 *                      socket stays open, and the page thinks it went), and `deliver:`
 *                      sends all of it, in order: messages that cross. An `offline:`
 *                      meanwhile loses it, as a socket that dies loses what was on it.
 *   twin:<label>       open a second window of this player (same browser, same game),
 *                      which later steps call `<label>`: one player, two windows
 *   hide: / show:      the tab hidden and shown again (the page thinks so)
 *   size:<w>x<h>       resize the window
 *   until:<css>        wait (up to 20 s) for an element to be on the page
 *   run:<command>      run a shell command and wait for it (restart a server)
 *   solve:right / solve:wrong   answer the puzzle on this player's screen: the prompt
 *                      read off the page, worked out here (the server never sends an
 *                      answer), typed digit by digit, then Enter; `wrong` types one more
 *                      than the answer.
 *   turn:<level>       whatever this player's match screen asks of its kid now, if it
 *                      asks anything: on the menu, attack at <level> (1, 2, 3) once Go!
 *                      is lit; on the puzzle, solve it (`turn:3w` answers wrong); on the
 *                      list after a knock-out, send in the one highlighted. Nothing on
 *                      the other's turn. `all:turn:1,all:wait:3000`, again and again,
 *                      plays a match to its end.
 * After every shot it prints what that player's screen says: where they are,
 * the names over the others and what they are busy with, the arrows (their
 * names and where each stands), the explore screen's pieces that cover one
 * another (`overlaps:`), the note at the top, the message line, the pause
 * menu's rows and its list.
 *
 * The game's HTTP API is blocked in every browser unless `--api` (an
 * account made in a page would land in whatever database the page's Vite
 * proxies `/api` to); the presence socket is never blocked, since seeing the
 * others is the point.
 * So point `--url` at a Vite of your own whose `API_PORT` is your own
 * server ([[DEVELOPMENT]] § Running): the script refuses 5180, the kids'.
 * It exits non-zero when any page logs an error or a warning.
 */
import {
	ANIMALS,
	EMPTY_BOOK,
	LAND_IDS,
	defaultStarter,
	getLand,
	isLandId,
	landSeed,
	spawnPoint,
	getAnimal,
	newGame,
	isItemId,
	recordParty,
	saveDocument,
	type AnimalInstance,
	type Direction,
	type ItemId,
	type LandId
} from '../packages/engine/src/index.ts';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { chromium, type BrowserContext, type Page, type WebSocketRoute } from 'playwright-core';

// --- arguments ---------------------------------------------------------------------

const argv = process.argv.slice(2);
const players: string[] = [];
const args: Record<string, string> = {};
for (let i = 0; i < argv.length; i++) {
	const a = argv[i]!;
	if (!a.startsWith('--')) continue;
	const next = argv[i + 1];
	const value = next === undefined || next.startsWith('--') ? 'true' : (i++, next);
	if (a === '--player') players.push(value);
	else args[a.slice(2)] = value;
}
if (!args.url) fail('--url is required: your own client, e.g. --url http://localhost:5191/');
const base = new URL(args.url);
if (base.port === '5180') fail('5180 is the kids’ game: point --url at a Vite of your own');
if (players.length === 0) fail('at least one --player label:options');
const out = resolve(args.out ?? `screenshots/players-${Date.now()}.png`);
const stem = join(dirname(out), basename(out, extname(out)));
const allowApi = args.api === 'true';
const keyInterval = Number(args['key-interval'] ?? 500);
mkdirSync(dirname(out), { recursive: true });

function fail(message: string): never {
	console.error(message);
	process.exit(2);
}

interface Player {
	label: string;
	name: string | null;
	world: number;
	land: LandId;
	at: { x: number; y: number } | null;
	facing: Direction;
	party: AnimalInstance[] | null;
	items: ItemId[];
	tokens: number;
	solved: number;
	freed: number;
	touch: boolean;
	calm: boolean;
	lang: string | null;
	size: { width: number; height: number };
	safe: { top: number; right: number; bottom: number; left: number } | null;
	debug: boolean;
	title: boolean;
	steps: number;
	context?: BrowserContext;
	page?: Page;
	errors: string[];
	/** Sockets the server did not take: listed, not errors. */
	socketFailures: number;
	/** The player's network, which their second windows share: `offline:` and `online:`. */
	net: Net;
}

/** A browser's network, as its presence sockets meet it. */
interface Net {
	offline: boolean;
	/** What the page sends waits on the way (`delay:`) until `deliver:`. */
	delayed: boolean;
	/** The presence sockets it let through: the page's end of each, the server's, and what waits. */
	sockets: { page: WebSocketRoute; server: WebSocketRoute; held: (string | Buffer)[] }[];
}

function parseParty(text: string, label: string): AnimalInstance[] {
	return text.split('+').flatMap((entry, i) => {
		const m = /^([a-z-]+)(?::(\d+))?(?:\*(\d+))?$/.exec(entry.trim());
		if (!m || !ANIMALS.some((a) => a.id === m[1])) fail(`${label}: no such animal "${entry}"`);
		const max = getAnimal(m[1]!).maxHp;
		const hp = Math.min(max, Number(m[2] ?? max));
		return Array.from({ length: Number(m[3] ?? 1) }, (_, j) => ({
			id: `${label}-${i}-${j}`,
			speciesId: m[1]!,
			hp
		}));
	});
}

function parsePlayer(spec: string): Player {
	const cut = spec.indexOf(':');
	const label = cut < 0 ? spec : spec.slice(0, cut);
	if (!/^[a-z0-9]+$/i.test(label) || label === 'all')
		fail(`a player's label is a word: "${label}"`);
	const p: Player = {
		label,
		name: null,
		world: 1,
		land: 'nordland',
		at: null,
		facing: 'down',
		party: null,
		items: [],
		tokens: 0,
		solved: 0,
		freed: 0,
		touch: false,
		calm: false,
		lang: null,
		size: { width: 1280, height: 800 },
		safe: null,
		debug: true,
		title: false,
		steps: 0,
		errors: [],
		socketFailures: 0,
		net: { offline: false, delayed: false, sockets: [] }
	};
	const options =
		cut < 0
			? []
			: spec
					.slice(cut + 1)
					.split(',')
					.filter(Boolean);
	for (const option of options) {
		const [key, value = ''] = option.split(/=(.*)/s);
		switch (key) {
			case 'name':
				p.name = value;
				break;
			case 'world':
				p.world = Number(value);
				if (!Number.isInteger(p.world) || p.world < 1 || p.world > 9999)
					fail(`${label}: world 1–9999`);
				break;
			case 'land':
				if (!isLandId(value)) fail(`${label}: no such land "${value}"`);
				p.land = value as LandId;
				break;
			case 'at': {
				const [x, y] = value.split(':').map(Number);
				if (!Number.isInteger(x) || !Number.isInteger(y)) fail(`${label}: at=x:y`);
				p.at = { x: x!, y: y! };
				break;
			}
			case 'facing':
				p.facing = value as Direction;
				break;
			case 'party':
				p.party = parseParty(value, label);
				break;
			case 'boat':
				if (!p.items.includes('boat')) p.items.push('boat');
				break;
			case 'items':
				for (const id of value.split('+')) {
					if (!isItemId(id)) fail(`${label}: no such tool "${id}"`);
					if (!p.items.includes(id)) p.items.push(id);
				}
				break;
			case 'freed': {
				const n = Number(value);
				const all = getLand('nordland').species.length;
				if (!Number.isInteger(n) || n < 0 || n > all) fail(`${label}: freed is 0 to ${all}`);
				p.freed = n;
				break;
			}
			case 'tokens':
			case 'solved': {
				const n = Number(value);
				if (!Number.isInteger(n) || n < 0) fail(`${label}: ${key} is a whole number`);
				p[key] = n;
				break;
			}
			case 'safe': {
				const [top, right, bottom, left] = value.split(':').map(Number);
				if (![top, right, bottom, left].every((n) => Number.isFinite(n) && n! >= 0))
					fail(`${label}: safe=top:right:bottom:left`);
				p.safe = { top: top!, right: right!, bottom: bottom!, left: left! };
				break;
			}
			case 'touch':
				p.touch = true;
				break;
			case 'calm':
				p.calm = true;
				break;
			case 'lang':
				p.lang = value;
				break;
			case 'size': {
				const [width, height] = value.split('x').map(Number);
				p.size = { width: width!, height: height! };
				break;
			}
			case 'steps':
				p.steps = Number(value);
				if (!Number.isInteger(p.steps) || p.steps < 0) fail(`${label}: steps is a whole number`);
				break;
			case 'title':
				p.title = true;
				break;
			case 'nodebug':
				p.debug = false;
				break;
			default:
				fail(`${label}: unknown option "${option}"`);
		}
	}
	return p;
}

/** The save the player's browser starts with, as the game writes one: in their world, their home. */
function saveOf(p: Player): string {
	const base = newGame(p.world, { ...defaultStarter(p.land), id: randomUUID() }, p.name);
	// In a land past the first, the game is there, Nordland left with its starter.
	const game =
		p.land === 'nordland'
			? base
			: {
					...base,
					land: p.land,
					pos: spawnPoint(landSeed(p.land, p.world)),
					lands: [
						{
							land: 'nordland' as LandId,
							// Nordland's own starter: an Arctic animal never walks in Nordland.
							party: [{ ...defaultStarter('nordland'), id: randomUUID() }],
							tokens: 0,
							items: [],
							worlds: []
						}
					],
					unlocked: [...LAND_IDS]
				};
	const party = p.party ?? game.party;
	// The animal book of a game that begins with this party: its kinds, caught.
	const book = recordParty(EMPTY_BOOK, party);
	// Kinds set free at a witch doctor's, met first: the way to The Arctic.
	const freed = getLand('nordland').species.slice(0, p.freed);
	const doc = saveDocument(
		{
			...game,
			pos: p.at ?? game.pos,
			steps: p.steps,
			facing: p.facing,
			party,
			seen: [...new Set([...book.seen, ...freed])],
			caught: [...book.caught],
			freed: [...new Set([...(game.freed ?? []), ...freed])],
			items: [...p.items],
			tokens: p.tokens,
			solved: p.solved
		},
		{ lineage: `players-${p.label}`, seq: 1 }
	);
	return JSON.stringify(doc);
}

const roster = players.map(parsePlayer);
const byLabel = new Map(roster.map((p) => [p.label, p]));

// --- the steps ---------------------------------------------------------------------

interface Step {
	who: Player[];
	op: string;
	arg: string;
}
/** Second windows (`twin:`), each sharing its player's browser, so its storage and its game. */
const twins = new Map<Player, Player>();
const steps: Step[] = (args.steps ?? '')
	.split(',')
	.filter(Boolean)
	.flatMap((token) => {
		const cut = token.indexOf(':');
		const whoName = token.slice(0, cut);
		const rest = token.slice(cut + 1);
		const who =
			whoName === 'all' ? roster : [byLabel.get(whoName) ?? fail(`no player "${whoName}"`)];
		const m =
			/^(wait|shot|burst|press|type|hold|click|tap|reload|close|open|offline|online|delay|deliver|twin|hide|show|size|until|run|solve|turn|down|up):(.*)$/s.exec(
				rest
			);
		if (m?.[1] === 'twin') {
			// Another window of the same player, which later steps call by its own label.
			const of = who[0]!;
			const twin: Player = { ...of, label: m[2]!, page: undefined, errors: [], socketFailures: 0 };
			if (byLabel.has(twin.label)) fail(`twin: "${twin.label}" is taken`);
			byLabel.set(twin.label, twin);
			twins.set(twin, of);
			return [{ who: [twin], op: 'twin', arg: m[2]! }];
		}
		if (m) return [{ who, op: m[1]!, arg: m[2]! }];
		const [key, n] = rest.split('*');
		return Array.from({ length: Number(n ?? 1) }, () => ({ who, op: 'key', arg: key! }));
	});

// --- the browser -------------------------------------------------------------------

/**
 * Whether a player goes offline in this script, or has what they send held on the way: then
 * every presence socket is routed (`openPage`).
 */
const cutsSockets = steps.some((s) => s.op === 'offline' || s.op === 'delay');

const GPU =
	process.platform === 'darwin'
		? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
		: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: GPU });

/** A request to the game's API (`/api` and below), the socket aside. */
const isApi = (u: URL | string) => {
	try {
		const path = new URL(u).pathname;
		return /^\/api(\/|$)/.test(path) && path !== '/api/ws';
	} catch {
		return false;
	}
};

function urlOf(p: Player): string {
	const url = new URL(base);
	if (p.debug) url.searchParams.set('debug', '');
	if (p.lang) url.searchParams.set('lang', p.lang);
	return url.toString().replace('debug=', 'debug');
}

async function openPage(p: Player): Promise<void> {
	if (!p.context) {
		p.context = await browser.newContext({
			viewport: p.size,
			hasTouch: p.touch,
			isMobile: p.touch,
			reducedMotion: p.calm ? 'reduce' : 'no-preference'
		});
		if (!allowApi)
			await p.context.route(
				(u) => isApi(u),
				(route) => route.abort('blockedbyclient')
			);
		// A script that takes a player offline, or holds what they send, passes every presence socket
		// through here, so `offline:` can cut them and `delay:` hold them. Any other script leaves the
		// socket as the browser opens it.
		if (cutsSockets) {
			const net = p.net;
			await p.context.routeWebSocket(
				(u) => u.pathname === '/api/ws',
				(ws) => {
					// No network: the socket reaches nothing, and the page tries again later.
					if (net.offline) return void ws.close().catch(() => {});
					const socket = {
						page: ws,
						server: ws.connectToServer(),
						held: [] as (string | Buffer)[]
					};
					// What the page says goes on, in order, unless `delay:` holds it till `deliver:`.
					ws.onMessage((message) => {
						if (net.delayed) socket.held.push(message);
						else socket.server.send(message);
					});
					net.sockets.push(socket);
				}
			);
		}
		// The save goes in before the page's own scripts run, once: a reload keeps the game played since.
		await p.context.addInitScript(
			`(() => {
				try {
					if (localStorage.getItem('animath.save') === null) localStorage.setItem('animath.save', ${JSON.stringify(saveOf(p))});
				} catch {}
				// Hidden or shown, as a tab the kid left: the page reads these every frame.
				window.__hidden = false;
				const visibility = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
				Object.defineProperty(document, 'visibilityState', { get: () => (window.__hidden ? 'hidden' : visibility.get.call(document)) });
				Object.defineProperty(document, 'hidden', { get: () => window.__hidden });
			})();`
		);
	}
	const page = await p.context.newPage();
	p.page = page;
	if (p.safe) {
		const { top, right, bottom, left } = p.safe;
		const cdp = await p.context.newCDPSession(page);
		await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: p.safe });
		// Red strips where the notch and the home indicator would be, over everything, taking no taps.
		await page.addInitScript(`addEventListener('DOMContentLoaded', () => {
			const strips = document.createElement('div');
			strips.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;' +
				'border:solid rgba(242,95,92,0.45);border-width:${top}px ${right}px ${bottom}px ${left}px';
			document.documentElement.append(strips);
		});`);
	}
	page.on('console', (m) => {
		if (/GPU stall/.test(m.text())) return;
		if (/^Failed to load resource/.test(m.text()) && isApi(m.location().url)) return;
		// A socket the server did not take (it is restarting, say): the game tries again on its own.
		if (/^WebSocket connection to '[^']*\/api\/ws' failed/.test(m.text())) {
			p.socketFailures++;
			return;
		}
		if (m.type() === 'error' || m.type() === 'warning') p.errors.push(`[${m.type()}] ${m.text()}`);
	});
	page.on('pageerror', (e) => p.errors.push(`[pageerror] ${e.message}`));
	await page.goto(urlOf(p), { waitUntil: 'networkidle' });
	if (!p.title) await continueGame(p, page);
}

/**
 * Past the title: Continue, once its row is there and takes keys; a tap on it
 * for a touch player (a key from a real keyboard would switch their touch
 * controls off).
 */
async function continueGame(p: Player, page: Page): Promise<void> {
	await page.waitForSelector('.menu-card .row', { timeout: 30_000 });
	await page.waitForTimeout(1200);
	if (p.touch) await page.locator('.menu-card .row').first().tap();
	else await page.keyboard.press('Enter');
	await page.waitForSelector('.menu-card', { state: 'detached', timeout: 30_000 });
	await page.waitForTimeout(800);
}

/**
 * What a player's screen says, one line each. Handed to the page as text:
 * tsx wraps a function's inner functions in a helper the page does not have
 * ([[ENVIRONMENT_NOTES]] § Looking at the game).
 */
const DESCRIBE = `(() => {
	const text = (el) => (el && el.textContent ? el.textContent.replace(/\\s+/g, ' ').trim() : null);
	const lit = (el) => (el.classList.contains('lit') ? '[' + text(el) + ']' : text(el));
	const lines = [];
	const debug = text(document.querySelector('.debug:not(.debug-cue)'));
	if (debug) lines.push('at: ' + debug);
	const labels = [...document.querySelectorAll('.others .label')].map((el) => {
		const busy = el.querySelector('.bubble')?.getAttribute('aria-label');
		return text(el.querySelector('.name')) + (busy ? ' (' + busy + ')' : '');
	});
	if (labels.length) lines.push('others: ' + labels.join(' | '));
	// Battles seen from outside: the thought bubbles, the animals' HP bars, the damage floating up.
	const thoughts = [...document.querySelectorAll('.others .label')].flatMap((el) => {
		const cloud = el.querySelector('.thought .cloud');
		if (!cloud) return [];
		const mood = cloud.classList.contains('right') ? ' ✓' : cloud.classList.contains('wrong') ? ' ✗' : '';
		return [text(el.querySelector('.name')) + ': ' + (text(cloud.querySelector('.sum')) ?? '…') + mood];
	});
	if (thoughts.length) lines.push('thoughts: ' + thoughts.join(' | '));
	const bars = [...document.querySelectorAll('.others .hp')].map(
		(el) => text(el.querySelector('.hp-name')) + ' ' + (el.querySelector('.fill')?.style.width ?? '?')
	);
	if (bars.length) lines.push('bars: ' + bars.join(' | '));
	const pops = [...document.querySelectorAll('.others .pop .n')].map(text);
	if (pops.length) lines.push('pops: ' + pops.join(' | '));
	// Each arrow with the names beside it (and "+2 more"), and where it points.
	const arrows = [...document.querySelectorAll('.others .arrow')].map(
		(el) =>
			[...el.querySelectorAll('.arrow-name, .arrow-more')].map(text).join(', ') +
			' (' + el.style.transform.replace(/translate\\(|px|\\)/g, '').replace(', ', ',') + ')'
	);
	if (arrows.length) lines.push('arrows: ' + arrows.join(' | '));
	const note = text(document.querySelector('.note[role=status]'));
	if (note) lines.push('note: ' + note);
	// The explore screen's pieces that cover one another, and by how much (width × height,
	// their boxes): a card only where its column shows it, the round buttons as squares.
	const column = document.querySelector('.party .cards')?.getBoundingClientRect();
	const pieces = [
		['.party .bundle', () => 'card'],
		['.party .keys', () => 'party hint'],
		['.belongings .purse', () => 'tokens'],
		['.belongings .solved', () => 'puzzles'],
		['.belongings .tool', (el) => text(el)],
		['.belongings .world', () => 'world'],
		['.coords', () => 'coordinates'],
		['.dpad .arrow, .dpad .hub', () => 'D-pad'],
		['.talk-button', () => 'Talk'],
		['.menu-button', () => 'Menu'],
		['.fly-button', () => 'Fly'],
		['.bottom .hint', () => 'message line'],
		['.bottom .challenge', () => 'Challenge'],
		['.others .arrow', (el) => 'arrow ' + text(el)],
		['.others .arrow-name', (el) => 'name ' + text(el)],
		['.others .arrow-more', (el) => text(el)],
		['.doctor-arrow .disc', () => 'tent marker'],
		['.note[role=status]', () => 'note']
	].flatMap(([selector, name]) =>
		[...document.querySelectorAll(selector)].map((el) => {
			let r = el.getBoundingClientRect();
			if (column && el.matches('.party .bundle'))
				r = { left: r.left, right: r.right, top: Math.max(r.top, column.top), bottom: Math.min(r.bottom, column.bottom) };
			// An arrow is its 30 px picture round its middle, turned or not (a turned box's
			// bounds would reach past its corners, which are empty).
			if (el.matches('.others .arrow')) r = { left: r.left - 15, right: r.left + 15, top: r.top - 15, bottom: r.top + 15 };
			return { name: name(el), el, r };
		})
	).filter((p) => p.r.right > p.r.left && p.r.bottom > p.r.top);
	const overlaps = [];
	for (let i = 0; i < pieces.length; i++) {
		for (let j = i + 1; j < pieces.length; j++) {
			const [a, b] = [pieces[i], pieces[j]];
			if (a.name === b.name || a.el.contains(b.el) || b.el.contains(a.el)) continue;
			// An arrow and its own name, or two arms of the D-pad: one piece.
			if (a.el.closest('.arrow') && a.el.closest('.arrow') === b.el.closest('.arrow')) continue;
			const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
			const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
			if (w >= 1 && h >= 1) overlaps.push(a.name + ' × ' + b.name + ' (' + Math.round(w) + ' × ' + Math.round(h) + ')');
		}
	}
	lines.push('overlaps: ' + (overlaps.length ? overlaps.join(' | ') : 'none'));
	const message = text(document.querySelector('.hint .message'));
	if (message) lines.push('message: ' + message);
	const pause = [...document.querySelectorAll('.menu .team .row')].map(lit);
	if (pause.length) lines.push('pause: ' + pause.join(' | '));
	const side = [...document.querySelectorAll('.menu .side .player, .menu .side .note')].map(lit);
	if (side.length) lines.push('side: ' + side.join(' | '));
	const battle = text(document.querySelector('.battle-line'));
	if (battle) lines.push('battle: ' + battle);
	// Friendly matches: the button, the invite, the match's notes and its result.
	const challenge = text(document.querySelector('.challenge'));
	if (challenge) lines.push('challenge: ' + challenge);
	const invite = text(document.querySelector('.invite'));
	if (invite) lines.push('invite: ' + invite);
	const notes = text(document.querySelector('.notes'));
	if (notes) lines.push('notes: ' + notes);
	const prompt = text(document.querySelector('.puzzle-prompt'));
	if (prompt) lines.push('puzzle: ' + prompt);
	const result = text(document.querySelector('.result-card'));
	if (result) lines.push('result: ' + result);
	return lines;
})()`;

/**
 * The answer to a prompt as the game shows it, worked out here: the same
 * independent solver the engine's puzzle tests use, never the game's own.
 */
function solve(prompt: string): number {
	const seq = prompt.match(/^([\d, ]+), \?$/);
	if (seq) return nextInSequence(seq[1]!.split(', ').map(Number));
	const root = prompt.match(/^√(\d+) = \?$/);
	if (root) return Math.sqrt(Number(root[1]));
	const missing = prompt.match(/^(\d+) ([+×]) \? = (\d+)$/);
	if (missing) {
		const [, a, op, c] = missing;
		return op === '+' ? Number(c) - Number(a) : Number(c) / Number(a);
	}
	const bin = prompt.match(/^(\d+) ([+−×÷]) (\d+) = \?$/);
	if (!bin) fail(`no sum I can read: ${prompt}`);
	const [, a, op, b] = bin;
	const [x, y] = [Number(a), Number(b)];
	return op === '+' ? x + y : op === '−' ? x - y : op === '×' ? x * y : x / y;
}

function nextInSequence(t: number[]): number {
	const d = t.slice(1).map((v, i) => v - t[i]!);
	if (d.every((v) => v === d[0])) return t.at(-1)! + d[0]!;
	const r = t[1]! / t[0]!;
	if (t.every((v, i) => i === 0 || v === t[i - 1]! * r)) return t.at(-1)! * r;
	if (t.every((v, i) => i < 2 || v === t[i - 1]! + t[i - 2]!)) return t.at(-1)! + t.at(-2)!;
	const dd = d.slice(1).map((v, i) => v - d[i]!);
	if (dd.every((v) => v === dd[0])) return t.at(-1)! + d.at(-1)! + dd[0]!;
	fail(`no pattern I can read: ${t.join(', ')}`);
}

/** Answer the puzzle on `page`'s screen, rightly (or, `wrong`, one more than right), then Enter. */
async function answer(page: Page, wrong: boolean): Promise<void> {
	const prompt = page.locator('.puzzle-prompt');
	await prompt.waitFor({ timeout: 20_000 });
	const sum = solve((await prompt.textContent()) ?? '') + (wrong ? 1 : 0);
	for (const digit of String(sum)) await page.keyboard.press(digit);
	await page.waitForTimeout(150);
	await page.keyboard.press('Enter');
	await page.waitForTimeout(400);
}

async function describe(p: Player): Promise<string[]> {
	return (await p.page!.evaluate(DESCRIBE)) as string[];
}

async function run(step: Step): Promise<void> {
	for (const p of step.who) {
		const page = p.page;
		switch (step.op) {
			case 'key':
				await page!.keyboard.down(step.arg);
				await page!.waitForTimeout(100);
				await page!.keyboard.up(step.arg);
				await page!.waitForTimeout(keyInterval);
				break;
			case 'type':
				for (const ch of step.arg) {
					await page!.keyboard.type(ch);
					await page!.waitForTimeout(120);
				}
				break;
			case 'down':
				// A key pressed and kept down while the next steps run (a skier holding an arrow).
				await page!.keyboard.down(step.arg);
				break;
			case 'up':
				await page!.keyboard.up(step.arg);
				break;
			case 'hold': {
				const [key, ms] = step.arg.split(':');
				const until = Date.now() + Number(ms);
				await page!.keyboard.down(key!);
				await page!.waitForTimeout(Math.min(500, Number(ms)));
				while (Date.now() < until) {
					await page!.keyboard.down(key!);
					await page!.waitForTimeout(100);
				}
				await page!.keyboard.up(key!);
				break;
			}
			case 'wait':
				// Everyone waits the same time: once, not once a player.
				if (p === step.who[0]) await new Promise((r) => setTimeout(r, Number(step.arg)));
				break;
			case 'shot': {
				const file = `${stem}-${p.label}-${step.arg}.png`;
				await page!.waitForTimeout(300);
				await page!.screenshot({ path: file });
				console.log(`${file}`);
				for (const line of await describe(p)) console.log(`  ${p.label} ${line}`);
				break;
			}
			case 'burst': {
				// `burst:name:n`, or `burst:name:n:x:y:w:h` for only that part of the page: a
				// smaller frame is quicker to take, so more of them land inside a flourish.
				const [name, n, ...box] = step.arg.split(':');
				const [x, y, width, height] = box.map(Number);
				const clip =
					box.length === 4 ? { x: x!, y: y!, width: width!, height: height! } : undefined;
				for (let i = 1; i <= Number(n ?? 4); i++) {
					await page!.screenshot({ path: `${stem}-${p.label}-${name}-${i}.png`, clip });
				}
				console.log(`${stem}-${p.label}-${name}-1..${n ?? 4}.png`);
				break;
			}
			case 'press':
				await page!.keyboard.press(step.arg);
				break;
			case 'click':
				await page!.locator(step.arg).first().click({ timeout: 20_000 });
				await page!.waitForTimeout(keyInterval);
				break;
			case 'tap':
				await page!.locator(step.arg).first().tap({ timeout: 20_000 });
				await page!.waitForTimeout(keyInterval);
				break;
			case 'reload':
				await page!.reload({ waitUntil: 'networkidle' });
				if (!p.title) await continueGame(p, page!);
				break;
			case 'close':
				await page?.close();
				p.page = undefined;
				break;
			case 'open':
				await openPage(p);
				break;
			case 'offline': {
				// The network goes: each socket closes at both ends, the server's first, so the
				// server hears the player go as its heartbeat would, and the page sees its socket drop.
				p.net.offline = true;
				const cut = p.net.sockets.splice(0);
				for (const s of cut) await s.server.close().catch(() => {});
				for (const s of cut) await s.page.close().catch(() => {});
				break;
			}
			case 'online':
				p.net.offline = false;
				// The browser says the network is back: the page tries its socket again at once.
				await page!.evaluate(`window.dispatchEvent(new Event('online'))`);
				break;
			case 'delay':
				p.net.delayed = true;
				break;
			case 'deliver':
				// Everything held goes on, in the order it was sent, before anything new.
				p.net.delayed = false;
				for (const s of p.net.sockets) {
					for (const message of s.held.splice(0)) {
						try {
							s.server.send(message);
						} catch {
							// That socket has gone: what was on it goes with it.
						}
					}
				}
				break;
			case 'twin':
				p.context = twins.get(p)!.context;
				await openPage(p);
				break;
			case 'hide':
			case 'show':
				await page!.evaluate(
					`window.__hidden = ${step.op === 'hide'}; document.dispatchEvent(new Event('visibilitychange'));`
				);
				break;
			case 'size': {
				const [w, h] = step.arg.split('x').map(Number);
				await page!.setViewportSize({ width: w!, height: h! });
				await page!.waitForTimeout(400);
				break;
			}
			case 'until':
				await page!.waitForSelector(step.arg, { timeout: 20_000 });
				break;
			case 'run':
				if (p === step.who[0]) execSync(step.arg, { stdio: 'inherit', shell: '/bin/zsh' });
				break;
			case 'solve':
				await answer(page!, step.arg === 'wrong');
				break;
			case 'turn': {
				const pg = page!;
				if (await pg.locator('.puzzle-panel .cursor.blink').count()) {
					await answer(pg, step.arg.endsWith('w'));
				} else if (await pg.locator('.card.actions.party').count()) {
					await pg.waitForSelector('.pill-button.go:not(.idle)', { timeout: 20_000 });
					await pg.keyboard.press('Enter');
				} else if (await pg.locator('.card.actions.menu:not(.dim)').count()) {
					await pg.waitForSelector('.pill-button.go:not(.idle)', { timeout: 20_000 });
					await pg.keyboard.press(step.arg.replace('w', '') || '1');
				}
				break;
			}
		}
	}
}

for (const p of roster) await openPage(p);
for (const step of steps) await run(step);
await browser.close();

let failed = false;
for (const p of [...roster, ...twins.keys()]) {
	if (p.socketFailures)
		console.log(`${p.label}: ${p.socketFailures} socket(s) the server did not take`);
	if (p.errors.length === 0) continue;
	failed = true;
	console.log(`${p.label}: console errors/warnings:`);
	for (const e of p.errors) console.log(`  ${e}`);
}
if (failed) process.exitCode = 1;
