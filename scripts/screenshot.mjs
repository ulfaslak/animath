#!/usr/bin/env node
/**
 * Visual check: open the game in headless Chrome, optionally press keys, and
 * save a screenshot. This is the standard way to *look* at a change (see
 * CLAUDE.md § Phase 2). Uses the locally installed Google Chrome via
 * playwright-core, so nothing is downloaded.
 *
 *   node scripts/screenshot.mjs [--url http://localhost:5180/] [--out screenshots/x.png]
 *                               [--keys "ArrowRight*5,ArrowDown*3"] [--wait 1500]
 *                               [--settle 1500] [--key-interval 700]
 *                               [--width 1280 --height 800]
 *
 * Prints the HUD hint line (which carries the player's grid position) so a
 * movement check can be asserted from the console output, not only the image.
 * Headless SwiftShader runs at a few frames per second, so buffered steps need
 * the `--settle` wait to finish before the screenshot.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

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
const keys = (args.keys ?? '')
	.split(',')
	.filter(Boolean)
	.flatMap((spec) => {
		const [key, n] = spec.split('*');
		return Array(Number(n ?? 1)).fill(key);
	});

const browser = await chromium.launch({
	channel: 'chrome',
	headless: true,
	args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => {
	// SwiftShader (headless software GL) spams "GPU stall" performance notes; not ours.
	if (/GPU stall/.test(m.text())) return;
	if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(wait);
for (const key of keys) {
	await page.keyboard.down(key);
	await page.waitForTimeout(220);
	await page.keyboard.up(key);
	await page.waitForTimeout(keyInterval);
}
await page.waitForTimeout(keys.length ? settle : 200);
mkdirSync(dirname(out), { recursive: true });
await page.screenshot({ path: out });
const hint = await page
	.locator('.hint')
	.textContent()
	.catch(() => null);
await browser.close();

console.log(`saved ${out}`);
if (hint) console.log(`hud: ${hint.replace(/\s+/g, ' ').trim()}`);
if (errors.length) {
	console.log('console errors/warnings:');
	for (const e of errors) console.log('  ' + e);
	process.exitCode = 1;
}
