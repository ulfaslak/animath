#!/usr/bin/env node
/**
 * Visual check: open the game in headless Chrome, drive it with keys, and
 * save screenshots. This is the standard way to *look* at a change (see
 * CLAUDE.md § Phase 2). Uses the locally installed Google Chrome via
 * playwright-core, so nothing is downloaded.
 *
 *   node scripts/screenshot.mjs [--url http://localhost:5180/] [--out screenshots/x.png]
 *                               [--keys "ArrowRight*5,ArrowDown*3"] [--wait 1500]
 *                               [--settle 1500] [--key-interval 700]
 *                               [--width 1280 --height 800] [--scale 1]
 *                               [--clip x,y,w,h]
 *
 * `--keys` is a comma-separated script. A token is a key name (`ArrowRight`,
 * `Enter`, `2`), optionally `*n` to press it n times; or one of
 *   type:<text>   type each character of <text> (an answer: digits, a minus)
 *   wait:<ms>     pause, e.g. while a battle turn narrates
 *   shot:<name>   save an extra frame to `<out>-<name>.png` now
 * The final frame goes to `--out`. After every frame the script prints what
 * the screen says — the HUD line in explore (with the grid position), and in
 * a battle the narration line, the puzzle, the typed answer, the judgement,
 * the status boxes and the result card — so a flow can be asserted from the
 * console output, not only the images.
 *
 * Headless SwiftShader runs at a few frames per second, so buffered steps need
 * the `--settle` wait to finish before the screenshot. `--scale 3` renders the
 * same framing at three device pixels per CSS pixel and `--clip` keeps only a
 * region of it (CSS pixels): together they magnify a detail without changing
 * what the camera sees.
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
// One grid step takes ~3 frames at SwiftShader's frame rate; the client buffers
// only two taps by design, so keys are spaced out to let each step complete.
const keyInterval = Number(args['key-interval'] ?? 700);
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
		const m = /^(type|wait|shot):(.*)$/.exec(token);
		if (m) return [{ op: m[1], arg: m[2] }];
		const [key, n] = token.split('*');
		return Array(Number(n ?? 1)).fill({ op: 'key', arg: key });
	});

const browser = await chromium.launch({
	channel: 'chrome',
	headless: true,
	args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
const errors = [];
page.on('console', (m) => {
	// SwiftShader (headless software GL) spams "GPU stall" performance notes; not ours.
	if (/GPU stall/.test(m.text())) return;
	if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

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
	const hint = await textOf('.hint');
	if (hint !== null) lines.push(`hud: ${hint}`);
	const statuses = await page.locator('.status').allTextContents();
	if (statuses.length) {
		lines.push(`status: ${statuses.map((s) => s.replace(/\s+/g, ' ').trim()).join(' | ')}`);
	}
	const rows = await page.locator('.actions .row').evaluateAll((els) =>
		els.map((el) => {
			const label = el.querySelector('.label')?.textContent ?? '';
			const how = el.querySelector('.how')?.textContent.trim();
			const text = how ? `${label} (${how})` : label;
			const level = el.querySelector('.pill.on')?.textContent;
			if (!el.classList.contains('selected')) return text;
			return level ? `[${text} at level ${level}]` : `[${text}]`;
		})
	);
	if (rows.length) lines.push(`menu: ${rows.join(' | ')}`);
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
	await page.screenshot({ path, clip });
	console.log(`saved ${path}`);
	for (const line of await describe()) console.log(`  ${line}`);
}

const ext = extname(out);
const stem = join(dirname(out), basename(out, ext));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(wait);
for (const { op, arg } of script) {
	switch (op) {
		case 'key':
			await page.keyboard.down(arg);
			await page.waitForTimeout(220);
			await page.keyboard.up(arg);
			await page.waitForTimeout(keyInterval);
			break;
		case 'type':
			for (const ch of arg) {
				await page.keyboard.press(ch);
				await page.waitForTimeout(150);
			}
			await page.waitForTimeout(keyInterval);
			break;
		case 'wait':
			await page.waitForTimeout(Number(arg));
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

if (errors.length) {
	console.log('console errors/warnings:');
	for (const e of errors) console.log('  ' + e);
	process.exitCode = 1;
}
