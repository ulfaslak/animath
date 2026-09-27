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
 *   name=Ada      the character's name (a player without one is seen by nobody)
 *   world=7       the world number (1 by default)
 *   at=x:y        where they stand (the world's spawn by default)
 *   facing=left   the way they face (down by default)
 *   party=...     their animals, as `?party=` writes them but joined with `+`
 *                 (a comma ends the option): `party=rabbit+fox:3*2`
 *   boat          they own the boat
 *   touch         a touch tablet (the touch controls on)
 *   lang=da       the game in this language
 *   size=1024x768 the window (1280x800 by default)
 *   title         stay on the title (no Continue)
 * A save that is already in the page's storage (after `reload:`) is kept.
 *
 * `--steps` is a comma-separated script; each step is `who:token`, `who` a
 * player's label or `all` (every player, one after the other). A token is a
 * key (`ArrowRight`, `Enter`, `*n` to press it n times), or one of:
 *   wait:<ms>          everyone waits
 *   shot:<name>        a frame of that player, to `<out>-<label>-<name>.png`
 *   burst:<name>:<n>   n frames as fast as they come (`-1`, `-2`…): a flourish that is soon over
 *   press:<key>        a key, going straight on to the next step (no pause after it)
 *   type:<text>        type into what has the focus
 *   hold:<key>:<ms>    hold a key down, auto-repeating
 *   click:<css> / tap:<css>   a click, or a finger (touch players), on an element
 *   reload:            reload the page, as F5 would
 *   close: / open:     close the page (the player leaves), or open it again
 *   hide: / show:      the tab hidden and shown again (the page thinks so)
 *   size:<w>x<h>       resize the window
 *   until:<css>        wait (up to 20 s) for an element to be on the page
 *   run:<command>      run a shell command and wait for it (restart a server)
 * After every shot it prints what that player's screen says: where they are,
 * the names over the others and what they are busy with, the arrows, the
 * note at the top, the message line, the pause menu's rows and its list.
 *
 * The game's HTTP API is blocked in every browser unless `--api` (the
 * backup would reach whatever the page's Vite proxies `/api` to); the
 * presence socket is never blocked, since seeing the others is the point.
 * So point `--url` at a Vite of your own whose `API_PORT` is your own
 * server ([[DEVELOPMENT]] § Running): the script refuses 5180, the kids'.
 * It exits non-zero when any page logs an error or a warning.
 */
import {
	ANIMALS,
	getAnimal,
	hashString,
	newGame,
	saveDocument,
	spawnPoint,
	type AnimalInstance,
	type Direction
} from '../packages/engine/src/index.ts';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';

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

/** World `n`'s seed, as `feat/worlds-names` numbers them: World 1 is the prototype's. */
function worldSeedOf(n: number): number {
	return (hashString('prototype') + n - 1) >>> 0;
}

interface Player {
	label: string;
	name: string | null;
	world: number;
	at: { x: number; y: number } | null;
	facing: Direction;
	party: AnimalInstance[] | null;
	boat: boolean;
	touch: boolean;
	lang: string | null;
	size: { width: number; height: number };
	title: boolean;
	context?: BrowserContext;
	page?: Page;
	errors: string[];
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
		at: null,
		facing: 'down',
		party: null,
		boat: false,
		touch: false,
		lang: null,
		size: { width: 1280, height: 800 },
		title: false,
		errors: []
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
				p.boat = true;
				break;
			case 'touch':
				p.touch = true;
				break;
			case 'lang':
				p.lang = value;
				break;
			case 'size': {
				const [width, height] = value.split('x').map(Number);
				p.size = { width: width!, height: height! };
				break;
			}
			case 'title':
				p.title = true;
				break;
			default:
				fail(`${label}: unknown option "${option}"`);
		}
	}
	return p;
}

/** The save the player's browser starts with: as the game writes one, with the name beside it. */
function saveOf(p: Player): string {
	const seed = worldSeedOf(p.world);
	const game = newGame(seed);
	const party = p.party ?? game.party;
	const doc = saveDocument(
		{
			...game,
			pos: p.at ?? spawnPoint(seed),
			facing: p.facing,
			party,
			items: p.boat ? ['boat'] : []
		},
		{ lineage: `players-${p.label}`, seq: 1 }
	);
	return JSON.stringify(p.name === null ? doc : { ...doc, name: p.name });
}

const roster = players.map(parsePlayer);
const byLabel = new Map(roster.map((p) => [p.label, p]));

// --- the steps ---------------------------------------------------------------------

interface Step {
	who: Player[];
	op: string;
	arg: string;
}
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
			/^(wait|shot|burst|press|type|hold|click|tap|reload|close|open|hide|show|size|until|run):(.*)$/s.exec(
				rest
			);
		if (m) return [{ who, op: m[1]!, arg: m[2]! }];
		const [key, n] = rest.split('*');
		return Array.from({ length: Number(n ?? 1) }, () => ({ who, op: 'key', arg: key! }));
	});

// --- the browser -------------------------------------------------------------------

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
	url.searchParams.set('debug', '');
	if (p.lang) url.searchParams.set('lang', p.lang);
	return url.toString().replace('debug=', 'debug');
}

async function openPage(p: Player): Promise<void> {
	if (!p.context) {
		p.context = await browser.newContext({
			viewport: p.size,
			hasTouch: p.touch,
			isMobile: p.touch
		});
		if (!allowApi)
			await p.context.route(
				(u) => isApi(u),
				(route) => route.abort('blockedbyclient')
			);
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
	page.on('console', (m) => {
		if (/GPU stall/.test(m.text())) return;
		if (/^Failed to load resource/.test(m.text()) && isApi(m.location().url)) return;
		if (m.type() === 'error' || m.type() === 'warning') p.errors.push(`[${m.type()}] ${m.text()}`);
	});
	page.on('pageerror', (e) => p.errors.push(`[pageerror] ${e.message}`));
	await page.goto(urlOf(p), { waitUntil: 'networkidle' });
	if (!p.title) await continueGame(page);
}

/** Past the title: Continue, once its row is there and takes keys. */
async function continueGame(page: Page): Promise<void> {
	await page.waitForSelector('.menu-card .row', { timeout: 30_000 });
	await page.waitForTimeout(1200);
	await page.keyboard.press('Enter');
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
	const arrows = [...document.querySelectorAll('.others .arrow-name')].map(text);
	if (arrows.length) lines.push('arrows: ' + arrows.join(' | '));
	const note = text(document.querySelector('.note[role=status]'));
	if (note) lines.push('note: ' + note);
	const message = text(document.querySelector('.hint .message'));
	if (message) lines.push('message: ' + message);
	const pause = [...document.querySelectorAll('.menu .team .row')].map(lit);
	if (pause.length) lines.push('pause: ' + pause.join(' | '));
	const side = [...document.querySelectorAll('.menu .side .player, .menu .side .note')].map(lit);
	if (side.length) lines.push('side: ' + side.join(' | '));
	const battle = text(document.querySelector('.narration'));
	if (battle) lines.push('battle: ' + battle);
	return lines;
})()`;

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
				const [name, n] = step.arg.split(':');
				for (let i = 1; i <= Number(n ?? 4); i++) {
					await page!.screenshot({ path: `${stem}-${p.label}-${name}-${i}.png` });
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
				if (!p.title) await continueGame(page!);
				break;
			case 'close':
				await page?.close();
				p.page = undefined;
				break;
			case 'open':
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
		}
	}
}

for (const p of roster) await openPage(p);
for (const step of steps) await run(step);
await browser.close();

let failed = false;
for (const p of roster) {
	if (p.errors.length === 0) continue;
	failed = true;
	console.log(`${p.label}: console errors/warnings:`);
	for (const e of p.errors) console.log(`  ${e}`);
}
if (failed) process.exitCode = 1;
