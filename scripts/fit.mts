/**
 * The game's screens at their worst, measured ([[DEVELOPMENT]] § Looking at
 * the game, "Long names"; [[AGENT_MISTAKES]] § Patterns, "A layout sized with
 * ordinary content"). One seeded save holds the widest of everything at once —
 * a player's name of sixteen W's, six animals named with twelve W's, Æ's and
 * M's, some tired and one a bear, four-digit tokens and puzzles, every tool —
 * and each screen it reaches is measured at every size a kid plays on, with a
 * keyboard and with a finger, in English and Danish. It prints every piece of
 * text that is cut short, off the screen, or scrolled sideways, and a page
 * that scrolls sideways, and exits non-zero when there is one.
 *
 *   pnpm fit --url http://localhost:<port>/ [--only <regex>] [--shots <dir>] [--verbose]
 *
 * `--url` is your own dev server or `vite preview` of your build, never 5180.
 * The API is blocked: the save is put in the browser before the page loads.
 * `--only` keeps the cases whose name matches (`"844x390 touch da"`),
 * `--shots` saves a frame of each screen, and `--verbose` prints every case.
 *
 * The screens: the title (Continue on the long name), explore (the party
 * cards, the tokens and tools, the message line), the pause menu and an
 * animal's card opened in it (not on a phone, which UI_SPEC gives them no
 * layout for), and the druid's card (one Enter from World 1's spawn
 * tent). A battle is not reached here: its widest names are the species'
 * `wild` forms, which [[DEVELOPMENT]] says how to measure. The druid's card
 * in all its states is `scripts/doctor-fit.mjs`'s.
 *
 * What counts:
 * - **cut**: an element that clips its text sideways (`overflow` other than
 *   visible, or an ellipsis) and holds more than it shows
 *   (`scrollWidth > clientWidth`);
 * - **off screen**: text outside the window, unless a list that scrolls
 *   holds it (a long team in the pause menu scrolls by design);
 * - **scrolled sideways**: any element with a `scrollLeft`, and the page
 *   wider than the window.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import {
	EMPTY_BOOK,
	defaultStarter,
	newGame,
	recordParty,
	saveDocument,
	shopFor,
	type AnimalInstance
} from '../packages/engine/src/index.ts';

const argv = process.argv.slice(2);
const args: Record<string, string> = {};
for (let i = 0; i < argv.length; i++) {
	const a = argv[i]!;
	if (!a.startsWith('--')) continue;
	const next = argv[i + 1];
	args[a.slice(2)] = next === undefined || next.startsWith('--') ? 'true' : next;
}
if (!args.url) {
	console.error(
		'usage: pnpm fit --url http://localhost:<port>/ [--only <regex>] [--shots <dir>] [--verbose]'
	);
	process.exit(2);
}
const base = new URL(args.url);
if (base.port === '5180' || base.port === '3000') {
	console.error('fit: 5180 and 3000 are the human’s; run your own dev server');
	process.exit(2);
}
const only = args.only ? new RegExp(args.only) : null;
const shots = args.shots ? resolve(args.shots) : null;
const verbose = args.verbose === 'true';
if (shots) mkdirSync(shots, { recursive: true });

/** Every size a kid plays on ([[UI_SPEC]] § Frame). */
const SIZES: [number, number][] = [
	[1280, 720],
	[1024, 768],
	[1180, 820],
	[844, 390],
	[740, 360],
	[667, 375]
];
const LANGUAGES = ['en', 'da'];
/** Screens UI_SPEC gives no layout on a phone held sideways. */
const UNLAID_ON_PHONES = ['pause', 'card'];

/** The widest of everything, in one save: World 1, by its spawn's tent, facing it. */
function worstSave(): string {
	const game = newGame(1, { ...defaultStarter('nordland'), id: randomUUID() }, 'W'.repeat(16));
	const animal = (speciesId: string, hp: number, nickname: string): AnimalInstance => ({
		id: randomUUID(),
		speciesId,
		hp,
		nickname
	});
	const party = [
		animal('bear', 999, 'WWWWWWWWWWWW'),
		animal('rabbit', 0, 'ÆØÅÆØÅÆØÅÆØÅ'),
		animal('fox', 1, 'MMMMMMMMMMMM'),
		animal('squirrel', 0, 'WWWWWWWWWWWW'),
		animal('frog', 3, 'ÆØÅÆØÅÆØÅÆØÅ'),
		animal('otter', 9, 'MMMMMMMMMMMM')
	];
	const book = recordParty(EMPTY_BOOK, party);
	const doc = saveDocument(
		{
			...game,
			pos: { x: 5, y: 6 },
			facing: 'down',
			party,
			seen: [...book.seen],
			caught: [...book.caught],
			items: shopFor('nordland'),
			tokens: 9999,
			solved: 99999
		},
		{ lineage: 'fit', seq: 1 }
	);
	return JSON.stringify(doc);
}

/**
 * Where UI_SPEC lets a name give way and end in "…", by selector: an ellipsis
 * there is reported as given way, not as a problem. Each with where it says so.
 */
const GIVES_WAY: { selector: string; screen: string; shortOnly: boolean; why: string }[] = [
	{
		selector: '.doctor .list .label',
		screen: 'druid',
		// Half the card is a short screen's (`SHORT_SCREEN`, 560 px tall or less); a whole card shows names whole.
		shortOnly: true,
		why: '[[UI_SPEC]] § Doctor, "Lists": in half the card (a phone held sideways) the name gives way first and ends in "…"'
	}
];

/** What the page measures, handed to it as text (tsx wraps inner functions in a helper the page lacks). */
const MEASURE = `((allowed) => {
	const vw = innerWidth, vh = innerHeight, out = [];
	const page = document.scrollingElement;
	if (page.scrollWidth > vw + 1) out.push('page scrolls sideways: ' + page.scrollWidth + ' > ' + vw);
	const name = (el) => {
		let s = el.tagName.toLowerCase();
		if (typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.');
		const t = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 32);
		return t ? s + ' "' + t + '"' : s;
	};
	const inScroller = (el) => {
		for (let p = el.parentElement; p; p = p.parentElement) {
			const o = getComputedStyle(p).overflowY;
			if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight + 1) return true;
		}
		return false;
	};
	const root = document.getElementById('ui') || document.body;
	for (const el of root.querySelectorAll('*')) {
		if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
		const r = el.getBoundingClientRect();
		// Nothing to see, or text kept for a screen reader alone (a box of 1 px).
		if (r.width <= 1 || r.height <= 1) continue;
		const cs = getComputedStyle(el);
		const text = (el.textContent || '').trim();
		const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
		if (ownText && (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) && !inScroller(el)) {
			out.push('off screen: ' + name(el) + ' at ' + [r.left, r.top, r.right, r.bottom].map(Math.round).join(','));
		}
		if (text && (cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 1) {
			const gives = cs.textOverflow === 'ellipsis' && allowed.some((a) => el.matches(a));
			out.push((gives ? 'gives way: ' : 'cut: ') + name(el) + ' holds ' + el.scrollWidth + ' px in ' + el.clientWidth);
		}
		if (el.scrollLeft > 0) out.push('scrolled sideways: ' + name(el) + ' by ' + el.scrollLeft);
	}
	return out;
})`;

/** A key the page presses itself: untrusted, so it never switches the touch controls off. */
async function press(page: Page, key: string): Promise<void> {
	await page.evaluate((k) => {
		window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
		window.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true }));
	}, key);
}

const isApi = (u: URL) => u.pathname === '/api' || u.pathname.startsWith('/api/');
const GPU =
	process.platform === 'darwin'
		? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
		: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: GPU });
const save = worstSave();

let cases = 0;
let found = 0;
const errors: string[] = [];

for (const [width, height] of SIZES) {
	for (const touch of [false, true]) {
		for (const lang of LANGUAGES) {
			const label = `${width}x${height} ${touch ? 'touch' : 'keys'} ${lang}`;
			if (
				only &&
				!only.test(label) &&
				!['title', 'explore', 'pause', 'card', 'druid'].some((s) => only.test(`${label} ${s}`))
			)
				continue;
			const context = await browser.newContext({
				viewport: { width, height },
				hasTouch: touch,
				isMobile: touch
			});
			await context.route(
				(u) => isApi(u),
				(route) => route.abort('blockedbyclient')
			);
			await context.addInitScript(
				`try { if (localStorage.getItem('animath.save') === null) localStorage.setItem('animath.save', ${JSON.stringify(save)}); } catch {}`
			);
			const page = await context.newPage();
			page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
			const url = new URL(base);
			url.searchParams.set('lang', lang);

			const look = async (screen: string): Promise<void> => {
				const name = `${label} ${screen}`;
				if (only && !only.test(name)) return;
				// A phone held sideways is a supported size only where a screen's section says so
				// ([[UI_SPEC]] § Frame): the title, explore and the druid's card; not the pause menu.
				if (height <= 560 && UNLAID_ON_PHONES.includes(screen)) return;
				await page.waitForTimeout(700);
				const allowed = GIVES_WAY.filter(
					(g) => g.screen === screen && (!g.shortOnly || height <= 560)
				).map((g) => g.selector);
				const all = (await page.evaluate(`(${MEASURE})(${JSON.stringify(allowed)})`)) as string[];
				const problems = all.filter((p) => !p.startsWith('gives way: '));
				const given = all.length - problems.length;
				cases++;
				found += problems.length;
				if (problems.length > 0) console.log(`✗ ${name}\n    ${problems.join('\n    ')}`);
				else if (verbose)
					console.log(
						`✓ ${name}${given > 0 ? ` (${given} name(s) given way, as UI_SPEC allows)` : ''}`
					);
				if (shots) await page.screenshot({ path: join(shots, `${name.replace(/\s+/g, '-')}.png`) });
			};

			try {
				await page.goto(url.toString(), { waitUntil: 'networkidle' });
				await page.waitForSelector('.menu-card .row', { timeout: 30_000 });
				await page.waitForTimeout(1200);
				await look('title');
				await press(page, 'Enter');
				await page.waitForSelector('.menu-card', { state: 'detached', timeout: 30_000 });
				await page.waitForTimeout(1500);
				await look('explore');
				await press(page, 'Escape');
				await page.waitForSelector('.menu', { timeout: 10_000 });
				await look('pause');
				await press(page, 'Enter');
				await look('card');
				// Back to the team, then out of the menu: one Escape each, never one more (in explore
				// Escape opens the menu again).
				await press(page, 'Escape');
				await page.waitForTimeout(400);
				await press(page, 'Escape');
				await page.waitForSelector('.backdrop .menu', { state: 'detached', timeout: 10_000 });
				// Explore takes Enter only after its quiet moment.
				await page.waitForTimeout(1500);
				await press(page, 'Enter');
				await page.waitForSelector('.card.talk', { timeout: 10_000 });
				await look('druid');
			} catch (e) {
				errors.push(`${label}: ${(e as Error).message.split('\n')[0]}`);
				if (shots)
					await page.screenshot({ path: join(shots, `${label.replace(/\s+/g, '-')}-stuck.png`) });
			}
			await context.close();
		}
	}
}
await browser.close();

for (const e of errors) console.log(`! ${e}`);
console.log(
	`fit: ${cases} screens measured, ${found} problem(s), ${errors.length} case(s) that did not run through`
);
process.exit(found > 0 || errors.length > 0 ? 1 : 0);
