#!/usr/bin/env node
/**
 * The witch doctor's card, measured ([[UI_SPEC]] § Doctor): its worst cases,
 * at every size a kid plays on, in English and Danish, with a finger and with
 * a keyboard. It prints each piece that leaves its card or the safe area,
 * each button (Back, the number pad's keys, the tabs, Set free and Bye, the
 * confirm's choices) cut or covered, each piece of the right-hand side over
 * another, and the doctor's line under the badge or the tokens, and exits
 * non-zero when anything is. A screenshot of one state shows one state:
 * #154, #160, #161, #162 and #166 each found a state or a size the check
 * before them had not looked at.
 *
 *   node scripts/doctor-fit.mjs --url http://localhost:<port>/ [--only <regex>]
 *                               [--shots <dir>] [--verbose] [--gpu metal|swiftshader]
 *
 * `--url` is your own dev server, never 5180: the script fills the card's
 * state through the page's own modules, so a production build won't do, and
 * neither will a dev server that has hot-updated `src/state/doctor.svelte.ts`
 * since it started (restart it; [[ENVIRONMENT_NOTES]]). It opens a throwaway
 * game (`?new`) with the API blocked and opens the card by filling `doctor`
 * as the controller would, one state after another on the open card, as a
 * visit changes it, and measures each once the page has laid it out.
 * `--only` keeps the cases whose name matches (`"1024x768 touch da shop-sum$"`:
 * size, input, language, state), `--shots` saves a frame of each, the card
 * and a strip of the world over it, with the strips outside the safe area
 * tinted red (read them), and `--verbose` prints every case with its
 * heights, the steps the right-hand side took to fit (`fit`) and how the
 * doctor's line is laid out (`flow`).
 *
 * The worst cases: three bears named with twelve W's (the widest name), a
 * tired one among them, beside a hurt rabbit; the longest heal prompt (a
 * bear's sequence); the paraglider's price (the priciest tool); balances and
 * rewards of four and five digits (a hand-over of 999 bears brings 29,970);
 * each beat after a right answer, when the doctor's lines are longest; and
 * the tabs' own sides with every line they can show at once.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

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
if (!args.url || args.url === 'true' || /:5180\b/.test(args.url)) {
	console.error('--url <your own dev server>: never 5180, the kids’ server');
	process.exit(2);
}
const only = args.only ? new RegExp(args.only) : null;
const shots = args.shots && args.shots !== 'true' ? args.shots : null;
const verbose = args.verbose === 'true';
if (shots) mkdirSync(shots, { recursive: true });
const GPU_ARGS = {
	metal: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
	swiftshader: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
};
const gpu = args.gpu ?? (process.platform === 'darwin' ? 'metal' : 'swiftshader');
if (!GPU_ARGS[gpu]) {
	console.error(`--gpu is metal or swiftshader, not "${gpu}"`);
	process.exit(2);
}

/** The phones held sideways, the tablets, the laptop, and a screen held upright with a keyboard. */
const SIZES = [
	{ name: '844x390i', w: 844, h: 390, safe: [0, 59, 21, 59] }, // an iPhone's notch and home indicator
	{ name: '844x390', w: 844, h: 390 },
	{ name: '740x360', w: 740, h: 360 },
	{ name: '667x375', w: 667, h: 375 },
	{ name: '1024x768', w: 1024, h: 768 },
	{ name: '1024x768i', w: 1024, h: 768, safe: [0, 0, 20, 0] }, // an iPad's home indicator
	{ name: '1180x820', w: 1180, h: 820 },
	{ name: '1280x720', w: 1280, h: 720 },
	{ name: '768x1024', w: 768, h: 1024 } // with a keyboard only: upright, a touch screen asks to be turned
];

const W = 'WWWWWWWWWWWW';
const bear = (id, hp) => ({ id, speciesId: 'bear', hp, nickname: W });
const bears = [bear('w1', 0), bear('w2', 10), bear('w3', 60)];
const well = (a) => (a.speciesId === 'bear' ? { ...a, hp: 100 } : a);
/** Three bears named with twelve W's (one tired), a hurt rabbit, a squirrel who walks, two foxes. */
const TEAM = [
	...bears,
	{ id: 'r1', speciesId: 'rabbit', hp: 5 },
	{ id: 's1', speciesId: 'squirrel', hp: 20 },
	{ id: 'f1', speciesId: 'fox', hp: 35 },
	{ id: 'f2', speciesId: 'fox', hp: 35 }
];
/** The foxes are the only ones who walk on, so their kind keeps one. */
const FOXES_WALK = [
	bear('w1', 0),
	bear('w2', 0),
	bear('w3', 0),
	{ id: 'r1', speciesId: 'rabbit', hp: 0 },
	{ id: 'f1', speciesId: 'fox', hp: 35 },
	{ id: 'f2', speciesId: 'fox', hp: 35 }
];
/** Nobody walks on. */
const ALL_TIRED = [bear('w1', 0), bear('w2', 0), { id: 'r1', speciesId: 'rabbit', hp: 0 }];
const ALL_WELL = TEAM.map(well).map((a) => (a.speciesId === 'rabbit' ? { ...a, hp: 22 } : a));
const SHOP = ['axe', 'pickaxe', 'boat', 'glider'];
const sum = (prompt, answer, kind = 'add') => ({ kind, difficulty: 5, prompt, answer });

const heal = (prompt, answer) => ({
	party: TEAM,
	tab: 'heal',
	screen: 'puzzle',
	patient: 0,
	puzzle: sum(prompt, answer),
	input: String(answer),
	find: { kind: 'animal', partyIndex: 0 },
	line: { say: 'letsHelp', animal: bears[0], others: 2 }
});
const handOver = (balance, reward) => ({
	party: TEAM,
	tab: 'home',
	screen: 'puzzle',
	marked: ['w1', 'w2', 'w3'],
	trade: { kind: 'home', ids: ['w1', 'w2', 'w3'], reward },
	balance,
	tokens: balance,
	puzzle: sum(`${balance} + ${reward} = ?`, balance + reward),
	input: String(balance + reward),
	find: { kind: 'bundle', speciesId: 'bear' },
	line: { say: 'homeCount' }
});
const buy = (balance) => ({
	party: TEAM,
	tab: 'shop',
	tokens: balance,
	screen: 'puzzle',
	trade: { kind: 'buy', itemId: 'glider', price: 34 },
	balance,
	puzzle: sum(`${balance} − 34 = ?`, balance - 34, 'sub'),
	input: String(balance - 34),
	find: { kind: 'item', itemId: 'glider' },
	line: { say: 'shopCount' }
});
/** A right answer's beats: "Correct!", then its reward on the list (`screen` busy all along). */
const right = (s, reward = {}) => ({ ...s, screen: 'busy', judged: { correct: true }, ...reward });
const wrong = (s, line) => ({ ...s, screen: 'busy', judged: { correct: false }, line });

const STATES = {
	'heal-list': {
		party: TEAM,
		tab: 'heal',
		screen: 'list',
		find: { kind: 'animal', partyIndex: 0 },
		line: { say: 'healed', animal: bears[0], others: 2, someoneStillHurt: true }
	},
	'heal-allfit': {
		party: ALL_WELL,
		tab: 'heal',
		screen: 'list',
		find: { kind: 'bye' },
		line: { say: 'healed', animal: bears[0], others: 2, someoneStillHurt: false }
	},
	'heal-puzzle-seq': heal('13, 39, 117, 351, ?', 1053),
	'heal-puzzle-short': heal('20 − 10 = ?', 10),
	'heal-puzzle-div': heal('1620 ÷ 18 = ?', 90),
	'heal-miss': wrong(heal('13, 39, 117, 351, ?', 1053), { say: 'notQuite' }),
	'heal-correct': right(heal('13, 39, 117, 351, ?', 1053)),
	'heal-reward': right(heal('13, 39, 117, 351, ?', 1053), {
		party: TEAM.map(well),
		healed: { amounts: { 0: 100, 1: 90, 2: 40 }, n: 1 },
		line: { say: 'healed', animal: bears[0], others: 2, someoneStillHurt: true }
	}),
	'heal-reward-all': right(heal('20 − 10 = ?', 10), {
		party: ALL_WELL,
		healed: { amounts: { 0: 100, 1: 90, 2: 40 }, n: 1 },
		line: { say: 'healed', animal: bears[0], others: 2, someoneStillHurt: false }
	}),
	'home-list': {
		party: TEAM,
		tab: 'home',
		screen: 'list',
		find: { kind: 'bundle', speciesId: 'bear' },
		tokens: 1354,
		line: { say: 'tokensGiven', amount: 90, tokens: 1354 }
	},
	'home-list-keep': {
		party: FOXES_WALK,
		tab: 'home',
		screen: 'list',
		marked: ['w1', 'w2', 'w3'],
		find: { kind: 'bundle', speciesId: 'fox' },
		tokens: 31234,
		line: { say: 'tokensGiven', amount: 29970, tokens: 31234 }
	},
	'home-list-how-keep': {
		party: FOXES_WALK,
		tab: 'home',
		screen: 'list',
		find: { kind: 'bundle', speciesId: 'fox' },
		tokens: 31234,
		line: { say: 'tokensGiven', amount: 29970, tokens: 31234 }
	},
	'home-list-stays': {
		party: FOXES_WALK,
		tab: 'home',
		screen: 'list',
		marked: ['f2'],
		find: { kind: 'animal', partyIndex: 4 },
		tokens: 1354,
		line: { say: 'homeIntro' }
	},
	'home-nowalker': {
		party: ALL_TIRED,
		tab: 'home',
		screen: 'list',
		find: { kind: 'animal', partyIndex: 0 },
		tokens: 1354,
		line: { say: 'homeIntro' }
	},
	'home-confirm': {
		party: TEAM,
		tab: 'home',
		screen: 'confirm',
		marked: ['w1', 'w2', 'w3'],
		find: { kind: 'send' },
		tokens: 1264,
		line: { say: 'homeSure' }
	},
	'home-sum': handOver(1264, 90),
	'home-sum-small': handOver(64, 90),
	'home-sum-big': handOver(12640, 29970),
	'home-miss': wrong({ ...handOver(1264, 90), input: '1' }, { say: 'tryAgain' }),
	'home-correct': right(handOver(1264, 90)),
	'home-goodbye': right(handOver(1264, 90), {
		leaving: ['w1', 'w2', 'w3'],
		line: { say: 'wentHome', animals: bears }
	}),
	'home-goodbye-one': right(handOver(1264, 30), {
		marked: ['w3'],
		leaving: ['w3'],
		line: { say: 'wentHome', animals: [bears[2]] }
	}),
	'home-tokens': right(handOver(1264, 90), {
		party: TEAM.filter((a) => a.speciesId !== 'bear'),
		marked: [],
		find: { kind: 'animal', partyIndex: 0 },
		tokens: 1354,
		tokenPop: { amount: 90, n: 1 },
		line: { say: 'tokensGiven', amount: 90, tokens: 1354 }
	}),
	'home-tokens-big': right(handOver(12640, 29970), {
		party: TEAM.filter((a) => a.speciesId !== 'bear'),
		marked: [],
		find: { kind: 'animal', partyIndex: 0 },
		tokens: 42610,
		tokenPop: { amount: 29970, n: 1 },
		line: { say: 'tokensGiven', amount: 29970, tokens: 42610 }
	}),
	'shop-list': {
		party: TEAM,
		tab: 'shop',
		tokens: 1264,
		screen: 'list',
		find: { kind: 'item', itemId: 'glider' },
		line: { say: 'shopIntro', empty: false }
	},
	'shop-list-short': {
		party: TEAM,
		tab: 'shop',
		tokens: 0,
		screen: 'list',
		find: { kind: 'item', itemId: 'glider' },
		line: { say: 'shopIntro', empty: false }
	},
	'shop-list-owned': {
		party: TEAM,
		tab: 'shop',
		items: ['glider'],
		tokens: 31200,
		screen: 'list',
		find: { kind: 'item', itemId: 'glider' },
		line: { say: 'bought', itemId: 'glider', tokens: 31200 }
	},
	'shop-sum': buy(64),
	'shop-sum-rich': buy(1264),
	'shop-sum-richer': buy(31234),
	'shop-miss': wrong({ ...buy(64), input: '3' }, { say: 'tryAgain' }),
	'shop-correct': right(buy(64)),
	'shop-bought': right(buy(64), {
		items: ['glider'],
		tokens: 30,
		bought: 'glider',
		tokenPop: { amount: -34, n: 1 },
		line: { say: 'bought', itemId: 'glider', tokens: 30 }
	}),
	'shop-bought-rich': right(buy(31234), {
		items: ['glider'],
		tokens: 31200,
		bought: 'glider',
		tokenPop: { amount: -34, n: 1 },
		line: { say: 'bought', itemId: 'glider', tokens: 31200 }
	})
};

/** Fill the open card, field by field as the controller does, leaving it mounted between states. */
function show(state) {
	const { doctor, tabRows } = window.__doctor;
	const blank = {
		party: [],
		tokens: 0,
		items: [],
		shop: ['axe', 'pickaxe', 'boat', 'glider'],
		line: null,
		tab: 'heal',
		cursor: 0,
		marked: [],
		confirm: 0,
		patient: null,
		trade: null,
		balance: 0,
		puzzle: null,
		input: '',
		judged: null,
		screen: 'busy',
		healed: null,
		leaving: null,
		tokenPop: null,
		bought: null,
		shake: null
	};
	for (const [key, value] of Object.entries({ ...blank, ...state })) {
		if (key !== 'find') doctor[key] = structuredClone(value);
	}
	if (state.find) {
		const rows = tabRows(doctor.tab, doctor.party, doctor.shop);
		const at = rows.findIndex((row) => Object.entries(state.find).every(([k, v]) => row[k] === v));
		doctor.cursor = Math.max(0, at);
	}
	doctor.active = true;
}

/** What is wrong with the card as laid out now, and its heights. */
function measure(safe) {
	const out = [];
	const area = {
		left: safe[3],
		top: safe[0],
		right: innerWidth - safe[1],
		bottom: innerHeight - safe[2]
	};
	const rect = (el) => el.getBoundingClientRect();
	const tol = 0.5;
	const inside = (a, b) =>
		a.left >= b.left - tol &&
		a.right <= b.right + tol &&
		a.top >= b.top - tol &&
		a.bottom <= b.bottom + tol;
	const over = (a, b) =>
		a.left < b.right - tol &&
		b.left < a.right - tol &&
		a.top < b.bottom - tol &&
		b.top < a.bottom - tol;
	const past = (a, b) =>
		[
			['left', b.left - a.left],
			['top', b.top - a.top],
			['right', a.right - b.right],
			['bottom', a.bottom - b.bottom]
		]
			.filter(([, d]) => d > tol)
			.map(([side, d]) => `${side} ${d.toFixed(1)}`)
			.join(' ');
	const shown = (el) => {
		if (!el || !el.getClientRects().length) return false;
		for (let e = el; e && e !== document.body; e = e.parentElement) {
			const cs = getComputedStyle(e);
			if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.05)
				return false;
		}
		return true;
	};
	const name = (el) => {
		if (!el) return 'nothing';
		const cls = [...el.classList]
			.filter((c) => !c.startsWith('s-') && !c.startsWith('svelte-'))
			.join('.');
		const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 24);
		return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${text ? ` "${text}"` : ''}`;
	};
	const lineRects = (el) => {
		const range = document.createRange();
		range.selectNodeContents(el);
		return [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
	};
	const card = document.querySelector('.doctor');
	if (!card) return { flags: ['no card on screen'], info: {} };
	const info = {};
	for (const part of [...card.children].filter((c) => c.classList.contains('card') && shown(c))) {
		const box = rect(part);
		const which = ['talk', 'patients', 'puzzle'].find((c) => part.classList.contains(c));
		info[which] = Math.round(box.height);
		if (!inside(box, area)) out.push(`${which} card off the safe area (${past(box, area)})`);
		if (which !== 'patients' && part.scrollHeight > part.clientHeight + 1)
			out.push(`${which}: holds ${part.scrollHeight} px in ${part.clientHeight}`);
		// Every piece inside its card; the list scrolls up and down, so its rows are its own,
		// but never across: what a row shows stays between the list's sides (but a row going
		// home, which slides off, and a shaking one).
		const list = part.querySelector('.list');
		if (list) {
			const edge = rect(list);
			for (const el of list.querySelectorAll('.row:not(.leaving, .shake-a, .shake-b) *')) {
				if (el.closest('.heal, .sparkles') || !shown(el)) continue;
				const r = rect(el);
				if (r.width >= 0.5 && (r.left < edge.left - tol || r.right > edge.right + tol)) {
					const across = { left: r.left, right: r.right, top: edge.top, bottom: edge.bottom };
					out.push(`${which}: ${name(el)} runs past the list's side (${past(across, edge)})`);
				}
			}
		}
		for (const el of part.querySelectorAll('*')) {
			if (list && list !== el && list.contains(el)) continue;
			if (el.closest('.token-pop, .heal, .sparkles')) continue; // pops that rise over their place
			if (!shown(el)) continue;
			const r = rect(el);
			if (r.width < 0.5 || r.height < 0.5) continue;
			if (!inside(r, box)) out.push(`${which}: ${name(el)} leaves the card (${past(r, box)})`);
		}
	}
	// Every button whole, in its card and the safe area, and nothing over it.
	for (const b of card.querySelectorAll('.back, .pad .key, .tab, .choice, .footer .row')) {
		if (!shown(b)) continue;
		const r = rect(b);
		const box = rect(b.closest('.card'));
		if (!inside(r, box)) out.push(`BUTTON ${name(b)} cut by its card (${past(r, box)})`);
		if (!inside(r, area)) out.push(`BUTTON ${name(b)} off the safe area (${past(r, area)})`);
		if (b.closest('[inert]')) continue; // the list under the confirm waits and takes no taps
		const x = (r.left + r.right) / 2;
		const y = (r.top + r.bottom) / 2;
		// Its middle and each edge's middle, 3 px in: a rounded corner is not the button's.
		for (const [px, py] of [
			[x, y],
			[r.left + 3, y],
			[r.right - 3, y],
			[x, r.top + 3],
			[x, r.bottom - 3]
		]) {
			if (px < 0 || py < 0 || px >= innerWidth || py >= innerHeight) continue;
			const hit = document.elementFromPoint(px, py);
			if (!hit || !(hit === b || b.contains(hit))) {
				out.push(`BUTTON ${name(b)} covered at ${px.toFixed(0)},${py.toFixed(0)} by ${name(hit)}`);
				break;
			}
		}
	}
	// The right-hand side's pieces apart, and their words inside it.
	const side = card.querySelector('.card.puzzle');
	if (side) {
		const box = rect(side);
		const pieces = [];
		const words =
			'.story, .puzzle-prompt, .judgement, .keys, :scope > .soft, :scope > .detail, :scope > .tally, :scope > .question, .price, .ware-name, .ware .detail';
		for (const el of side.querySelectorAll(words)) {
			if (!shown(el)) continue;
			pieces.push({ el, r: rect(el) });
			for (const r of lineRects(el))
				if (!inside(r, box)) out.push(`words ${name(el)} leave the side (${past(r, box)})`);
		}
		for (const el of side.querySelectorAll('.answer, .back, .pad, .choice, .ware > :first-child')) {
			if (shown(el)) pieces.push({ el, r: rect(el) });
		}
		for (let i = 0; i < pieces.length; i++)
			for (let j = i + 1; j < pieces.length; j++) {
				const [a, b] = [pieces[i], pieces[j]];
				if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
				if (over(a.r, b.r)) out.push(`overlap: ${name(a.el)} / ${name(b.el)}`);
			}
		info.fit = side.dataset.fit ?? '';
	}
	// The doctor's line keeps off the badge and the tokens, and inside its card.
	const talk = card.querySelector('.talk');
	const line = talk?.querySelector('.doctor-line');
	if (line) {
		const lines = lineRects(line);
		info.lines = new Set(lines.map((r) => Math.round(r.top))).size;
		info.flow = talk.classList.contains('small')
			? 'small'
			: talk.classList.contains('crowded')
				? 'crowded'
				: '';
		for (const other of talk.querySelectorAll('.who, .purse')) {
			if (lines.some((r) => over(r, rect(other))))
				out.push(`the doctor's line runs under ${name(other)}`);
		}
		if (lines.some((r) => !inside(r, rect(talk)))) out.push(`the doctor's line leaves its card`);
	}
	return { flags: [...new Set(out)], info };
}

const frame = () =>
	new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30))));

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: GPU_ARGS[gpu] });
let flagged = 0;
let cases = 0;
try {
	for (const input of ['touch', 'keys']) {
		const context = await browser.newContext({
			viewport: { width: 1024, height: 768 },
			hasTouch: input === 'touch',
			isMobile: input === 'touch'
		});
		// No API: the page plays alone and joins nobody's world (scripts/screenshot.mjs does the same).
		const isApi = (u) => /^\/api(\/|$)/.test(new URL(u).pathname);
		await context.route(
			(u) => isApi(u.href),
			(r) => r.abort('blockedbyclient')
		);
		await context.routeWebSocket(
			(u) => isApi(u.href),
			() => {}
		);
		const page = await context.newPage();
		page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
		await page.goto(new URL('?new', args.url).href);
		await page.waitForSelector('.party', { timeout: 120_000 });
		const fonts = await page.evaluate(async () => {
			const [state, copy] = await Promise.all([
				import('/src/state/doctor.svelte.ts'),
				import('/src/copy/index.ts')
			]);
			window.__doctor = { doctor: state.doctor, tabRows: state.tabRows, language: copy.language };
			await document.fonts.ready;
			return document.fonts.check('800 20px Nunito');
		});
		if (!fonts) {
			console.error('Nunito did not load (no network?): a stand-in font measures nothing');
			process.exit(2);
		}
		const cdp = await context.newCDPSession(page);
		for (const lang of ['en', 'da']) {
			await page.evaluate((l) => window.__doctor.language.set(l), lang);
			for (const size of SIZES) {
				if (input === 'touch' && size.h > size.w) continue;
				const safe = size.safe ?? [0, 0, 0, 0];
				await cdp.send('Emulation.setSafeAreaInsetsOverride', {
					insets: { top: safe[0], right: safe[1], bottom: safe[2], left: safe[3] }
				});
				await page.setViewportSize({ width: size.w, height: size.h });
				// Red where the notch and the home indicator would be, taking no taps (as screenshot.mjs).
				await page.evaluate((s) => {
					let strips = document.getElementById('safe-strips');
					if (!strips) {
						strips = document.createElement('div');
						strips.id = 'safe-strips';
						strips.style.cssText =
							'position:fixed;inset:0;z-index:2147483647;pointer-events:none;border:solid rgba(242,95,92,0.45)';
						document.documentElement.append(strips);
					}
					strips.style.borderWidth = `${s[0]}px ${s[1]}px ${s[2]}px ${s[3]}px`;
				}, safe);
				for (const [state, fill] of Object.entries(STATES)) {
					const key = `${size.name} ${input} ${lang} ${state}`;
					if (only && !only.test(key)) continue;
					await page.evaluate(show, fill);
					await page.evaluate(frame);
					await page.evaluate(frame);
					const { flags, info } = await page.evaluate(measure, safe);
					cases++;
					if (flags.length) flagged++;
					if (flags.length || verbose) {
						console.log(`${flags.length ? '✗' : '✓'} ${key} ${JSON.stringify(info)}`);
						for (const f of flags) console.log(`    ${f}`);
					}
					if (shots) {
						// The card, and 32 px of the world over it: a "+N" rises over the tokens.
						const top = await page.evaluate(() =>
							Math.max(0, document.querySelector('.doctor').getBoundingClientRect().top - 32)
						);
						await page.screenshot({
							path: `${shots}/${size.name}-${input}-${lang}-${state}.png`,
							clip: { x: 0, y: top, width: size.w, height: size.h - top }
						});
					}
				}
			}
		}
		await context.close();
	}
} finally {
	await browser.close();
}
console.log(`${flagged} of ${cases} cases flagged`);
process.exit(flagged > 0 ? 1 : 0);
