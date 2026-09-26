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
 * The final frame goes to `--out`. After every frame the script prints what
 * the screen says — on the title its menu, the confirm, the starters and the
 * name box; the message line in explore (and the grid position and
 * facing with `?debug` in the URL) and the party cards; in the pause menu its
 * rows, the picked animal's options and the name box (with whether it has
 * the focus); at the doctor the doctor's line and the party; and in a battle
 * the narration line, the puzzle, the typed answer, the judgement, the status
 * boxes and the result card — so a flow can be asserted from the console
 * output, not only the images.
 *
 * Each run is a fresh browser, so a new player with no game: the title, with
 * New game only (`?new` goes past it into a throwaway game); `reload:` keeps
 * the game, which is saved in the page's localStorage. The script exits
 * non-zero on console errors and warnings, except failed `/api/` calls: the
 * game saves locally without the API, so those are listed at the end instead.
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

const args = Object.fromEntries(
	process.argv
		.slice(2)
		.map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] ?? 'true'] : null))
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
		const m = /^(type|wait|shot|hold|size|reload|down|up):(.*)$/.exec(token);
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
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: GPU_ARGS[gpu] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
const errors = [];
// The game saves locally and backs up to the API when it can; it plays the same
// without it. Failed API calls are listed, not counted as errors.
const api = [];
const isApi = (u) => {
	try {
		return new URL(u).pathname.startsWith('/api/');
	} catch {
		return false;
	}
};
page.on('console', (m) => {
	// SwiftShader (headless software GL) spams "GPU stall" performance notes; not ours.
	if (/GPU stall/.test(m.text())) return;
	// Chrome logs every failed request; the API ones are listed below instead.
	if (/^Failed to load resource/.test(m.text()) && isApi(m.location().url)) return;
	if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('response', (r) => {
	if (isApi(r.url()) && r.status() >= 400) {
		api.push(`${r.request().method()} ${new URL(r.url()).pathname} → ${r.status()}`);
	}
});
page.on('requestfailed', (r) => {
	if (isApi(r.url())) {
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
	// The title: its menu rows (the lit one in brackets), the confirm's choices,
	// the starters' name tags (the lit one in brackets) and the card under them.
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
	const starters = await lit('.starter-screen .tag');
	if (starters.length) lines.push(`starters: ${starters.join(' | ')}`);
	const starterCard = await textOf('.starter-card .heading');
	if (starterCard !== null) {
		const loves = await textOf('.starter-card .loves');
		lines.push(`starter: ${[starterCard, loves].filter((t) => t !== null).join(' — ')}`);
	}
	const titleNotes = await page.locator('.menu-card .note, .starter-card .note').allTextContents();
	if (titleNotes.length) lines.push(`title notes: ${titleNotes.map((n) => n.trim()).join(' | ')}`);
	const debug = await textOf('.debug');
	if (debug !== null) lines.push(`at: ${debug}`);
	const message = await textOf('.hint .message');
	const prompt = await textOf('.hint .prompt');
	if (message !== null || prompt !== null) {
		lines.push(`hud: ${[message, prompt].filter((t) => t !== null).join(' | ')}`);
	}
	const doctorLine = await textOf('.doctor-line');
	if (doctorLine !== null) lines.push(`doctor: ${doctorLine}`);
	const patients = await page.locator('.patients .row').evaluateAll((els) =>
		els.map((el) => {
			const label = el.querySelector('.label')?.textContent ?? '';
			const tag = el.querySelector('.tag')?.textContent;
			const hp = el.querySelector('.hp .text')?.textContent;
			const text = [label, tag && `(${tag})`, hp].filter(Boolean).join(' ');
			return el.classList.contains('selected') ? `[${text}]` : text;
		})
	);
	if (patients.length) lines.push(`patients: ${patients.join(' | ')}`);
	// Party cards in explore, the lead in brackets: "[1 Pip 20/20 goes first] | 2 Rabbit 0/22 tired".
	const cards = await page.locator('.party .member').evaluateAll((els) =>
		els.map((el) => {
			const text = el.textContent.replace(/\s+/g, ' ').trim();
			return el.classList.contains('lead') ? `[${text}]` : text;
		})
	);
	if (cards.length) lines.push(`party: ${cards.join(' | ')}`);
	// The pause menu: its rows (the lit one in brackets), the picked animal's
	// options (greyed ones in parentheses), and the name box.
	const pauseRows = await page.locator('.menu .team .row').evaluateAll((els) =>
		els.map((el) => {
			const text = el.textContent.replace(/\s+/g, ' ').trim();
			return el.classList.contains('lit') ? `[${text}]` : text;
		})
	);
	if (pauseRows.length) lines.push(`pause: ${pauseRows.join(' | ')}`);
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
	// The action menu, or the party list in its place: the highlighted row in
	// brackets, each attack with its own level word, greyed rows marked.
	const rows = await page.locator('.actions .row').evaluateAll((els) =>
		els.map((el) => {
			const label = el.querySelector('.label')?.textContent ?? '';
			const hp = el.querySelector('.hp .text')?.textContent.trim();
			const how = el.querySelector('.how')?.textContent.trim();
			const level = el.querySelector('.pill.on')?.textContent.trim();
			const notes = [how, level, el.classList.contains('off') && 'greyed'].filter(Boolean);
			const text = [label, hp, notes.length && `(${notes.join(', ')})`].filter(Boolean).join(' ');
			return el.classList.contains('selected') ? `[${text}]` : text;
		})
	);
	// The battle's switch list stands where the menu was; `party:` is the explore HUD's cards.
	const list = (await page.locator('.actions.party').count()) ? 'switch' : 'menu';
	if (rows.length) lines.push(`${list}: ${rows.join(' | ')}`);
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
		case 'shot':
			await page.waitForTimeout(400);
			await shoot(`${stem}-${arg}${ext || '.png'}`);
			break;
	}
}
await page.waitForTimeout(script.length ? settle : 200);
await shoot(out);
await browser.close();

if (api.length) {
	console.log('api calls that did not succeed (the game plays on and saves locally):');
	for (const line of api) console.log('  ' + line);
}
if (errors.length) {
	console.log('console errors/warnings:');
	for (const e of errors) console.log('  ' + e);
	process.exitCode = 1;
}
