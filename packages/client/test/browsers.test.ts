import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import {
	colorMixFallbacks,
	hasLookbehind,
	inlineScripts,
	mixColours,
	paletteOf,
	scanScript,
	scanStyles
} from '../browsers';

/** What each finding says, without the code round it. */
function said(
	code: string,
	...rest: Parameters<typeof scanScript> extends [string, ...infer R] ? R : never
) {
	return scanScript(code, ...rest).map((finding) => finding.what);
}

describe('the syntax Safari 15.0 cannot read', () => {
	it('finds a lookbehind, in a literal or in a string a RegExp can be built from', () => {
		expect(said('text.split(/(?<=[.!?])\\s+/);')).toEqual([
			'a lookbehind in a regular expression (Safari 16.4)'
		]);
		expect(said('/(?<!a)b/.test(s);')).toHaveLength(1);
		expect(said('new RegExp("(?<=a)b");')).toEqual([
			'a lookbehind in a string a RegExp can be built from (Safari 16.4)'
		]);
		expect(said('new RegExp(`(?<=${a})b`);')).toHaveLength(1);
	});

	it('tells a lookbehind from a named group, an escaped bracket and a character class', () => {
		expect(hasLookbehind('(?<name>a)')).toBe(false);
		expect(hasLookbehind('\\(?<=a')).toBe(false);
		expect(hasLookbehind('[(?<=]')).toBe(false);
		expect(hasLookbehind('[\\]](?<=a)')).toBe(true);
		expect(said('/(?<year>\\d{4})/.exec(s);')).toEqual([]);
	});

	it("finds a class's static block, and syntax newer than ES2022", () => {
		expect(said('class A { static { A.b = 1; } }')).toEqual([
			"a class's static block (Safari 16.4)"
		]);
		expect(said('/[\\p{L}--[a-z]]/v.test(s);')[0]).toMatch(/^syntax newer than ES2022/);
	});

	it('reads what Safari 15.0 reads: class fields, private methods, `#x in`, top-level await', () => {
		const code =
			'class A { #a = 1; static b = 2; #m() { return #a in this; } static #n() {} }\n' +
			'await Promise.resolve(a?.b ?? 0);\nlet c = 1_000; c ||= 2;';
		expect(said(code)).toEqual([]);
	});

	it("keeps the error reports' chunk to ES2017 and the page's inline script to ES5", () => {
		expect(said('try { f(); } catch { g(); }', 2017)[0]).toMatch(/^syntax newer than ES2017/);
		expect(said('const a = b?.c;', 2017)[0]).toMatch(/^syntax newer than ES2017/);
		expect(said('const a = async () => { await b; };', 2017)).toEqual([]);
		expect(said('let a = 1;', 5, 'script')[0]).toMatch(/^syntax newer than ES5/);
		expect(said('var a = function () { return 1; };', 5, 'script')).toEqual([]);
	});
});

describe('the built-ins Safari 15.0 lacks', () => {
	it('finds each, by where it hangs', () => {
		expect(said("Object.hasOwn(a, 'b');")).toEqual(['Object.hasOwn (Safari 15.4)']);
		expect(said('AbortSignal.timeout(5000);')).toEqual(['AbortSignal.timeout (Safari 16)']);
		expect(said('list.findLast(f);')).toEqual(['.findLast() (Safari 15.4)']);
		expect(said('list.toSorted();')).toEqual(['.toSorted() (Safari 16)']);
		expect(said('crypto.randomUUID();')).toEqual(['.randomUUID() (Safari 15.4)']);
		expect(said('const copy = structuredClone(save);')).toEqual(['structuredClone (Safari 15.4)']);
		expect(said('requestIdleCallback(f);')).toEqual(['requestIdleCallback (no Safari)']);
	});

	it("tells `at(i)` and `with(i, value)` by their arguments from three.js's and the world's", () => {
		expect(said('queue.at(-1);')).toEqual(['.at() (Safari 15.4)']);
		expect(said('ray.at(t, target);')).toEqual([]);
		expect(said('list.with(0, 1);')).toEqual(['.with() (Safari 16)']);
		expect(said('edits.with(pos).without(regrown);')).toEqual([]);
	});

	it('lets a script use a name it asks for first', () => {
		expect(said('typeof OffscreenCanvas < "u" && new OffscreenCanvas(1, 1);')).toEqual([]);
		expect(
			said('const c = globalThis.crypto; typeof c.randomUUID == "function" && c.randomUUID();')
		).toEqual([]);
		expect(said('"structuredClone" in globalThis ? structuredClone(a) : copy(a);')).toEqual([]);
	});

	it('never counts a property or a key of the same name', () => {
		expect(
			said('a.structuredClone = 1; const b = { structuredClone: 2, OffscreenCanvas: 3 };')
		).toEqual([]);
		expect(said('class A { structuredClone() {} }')).toEqual([]);
	});
});

describe("a page's inline scripts", () => {
	it('are the scripts with no src and no type', () => {
		const html =
			'<script type="module" src="/a.js"></script><script>var a = 1;</script>' +
			'<script type="module">let b;</script><script src="/c.js"></script><script defer>var d;</script>';
		expect(inlineScripts(html)).toEqual(['var a = 1;', 'var d;']);
	});
});

describe('the styles Safari 15.0 drops', () => {
	function whats(css: string): string[] {
		return scanStyles(css).map((finding) => finding.what);
	}

	it('finds :has(), and a selector list a pseudo-class it lacks drops whole', () => {
		expect(whats('.a:has(.b) { color: red }')).toEqual([':has() (Safari 15.4)']);
		expect(whats('.go:focus-visible, .here { outline: 0 }')).toHaveLength(1);
		expect(whats('.go:focus-visible, .here:focus-visible { outline: 0 }')).toEqual([]);
	});

	it('finds an at-rule it skips whole', () => {
		expect(whats('@layer base { .a { color: red } }')).toEqual(['@layer (Safari 15.4)']);
		expect(whats('@container (min-width: 10px) { .a { color: red } }')).toEqual([
			'@container (Safari 16)'
		]);
	});

	it('finds a subgrid or a dynamic viewport unit with no value before it', () => {
		expect(whats('.r { display: grid; grid-template-columns: subgrid }')).toEqual([
			'subgrid (Safari 16) with no value before it'
		]);
		expect(whats('.r { grid-template-columns: 1fr auto; grid-template-columns: subgrid }')).toEqual(
			[]
		);
		expect(whats('.h { height: 100dvh }')).toHaveLength(1);
		expect(whats('.h { height: 100vh; height: 100dvh }')).toEqual([]);
	});

	it('finds a color-mix() outside an @supports that asks for it', () => {
		const mix = 'background: color-mix(in srgb, var(--accent) 40%, white)';
		expect(whats(`.a { ${mix} }`)).toEqual(['color-mix() (Safari 16.2) outside @supports']);
		expect(whats(`@supports (color: color-mix(in srgb, red, red)) { .a { ${mix} } }`)).toEqual([]);
	});
});

describe('color-mix() for a browser without it', () => {
	const palette = new Map([
		['--accent', '#ff9f43'],
		['--panel-cream', '#fffcf5'],
		['--panel-bg', 'rgba(255, 252, 245, 0.92)']
	]);

	/** CSS without the spaces round its punctuation, which the plugin's new rules do not keep. */
	function squeezed(css: string): string {
		return css
			.replace(/\s*([{}:;,()])\s*/g, '$1')
			.replace(/\s+/g, ' ')
			.trim();
	}

	function fallbacks(css: string, colours = palette): string {
		return squeezed(postcss([colorMixFallbacks(colours)]).process(css, { from: undefined }).css);
	}

	it('mixes as CSS Color 5 does, alpha premultiplied', () => {
		const white = { r: 255, g: 255, b: 255, a: 1 };
		const accent = { r: 255, g: 159, b: 67, a: 1 };
		const clear = { r: 0, g: 0, b: 0, a: 0 };
		expect(mixColours(accent, 25, white, undefined)).toEqual({ r: 255, g: 231, b: 208, a: 1 });
		expect(mixColours(accent, 45, clear, undefined)).toEqual({ r: 255, g: 159, b: 67, a: 0.45 });
		expect(mixColours(accent, undefined, white, undefined)).toEqual({
			r: 255,
			g: 207,
			b: 161,
			a: 1
		});
		// Shares under 100% fade the mix.
		expect(mixColours(accent, 20, white, 20)?.a).toBeCloseTo(0.4);
	});

	it('keeps the colour worked out in the rule, and the mix as written inside @supports after it', () => {
		expect(
			fallbacks(
				'.key:active { transform: none; background: color-mix(in srgb, var(--accent) 25%, white); }'
			)
		).toBe(
			squeezed(
				'.key:active { transform: none; background: #ffe7d0; } @supports (color: color-mix(in srgb, red, red)) { .key:active { background: color-mix(in srgb, var(--accent) 25%, white); } }'
			)
		);
	});

	it('mixes a translucent colour, and one inside a longer value', () => {
		expect(
			fallbacks('.a { background: color-mix(in srgb, var(--accent) 16%, var(--panel-bg)) }')
		).toContain(squeezed('background: rgba(255, 236, 214, 0.933)'));
		expect(
			fallbacks(
				'.a { box-shadow: 0 0 0 3px red, 0 0 16px 4px color-mix(in srgb, var(--accent) 45%, transparent) }'
			)
		).toContain(squeezed('box-shadow: 0 0 0 3px red, 0 0 16px 4px rgba(255, 159, 67, 0.45)'));
	});

	it('copies a @keyframes whole', () => {
		const out = fallbacks(
			'@keyframes glow { to { box-shadow: 0 0 0 10px color-mix(in srgb, var(--accent) 0%, transparent) } }'
		);
		expect(out).toBe(
			squeezed(
				'@keyframes glow { to { box-shadow: 0 0 0 10px rgba(0, 0, 0, 0) } } @supports (color: color-mix(in srgb, red, red)) { @keyframes glow { to { box-shadow: 0 0 0 10px color-mix(in srgb, var(--accent) 0%, transparent) } } }'
			)
		);
	});

	it("lays the palette's colour at its share over a colour the element sets, on a background", () => {
		expect(
			fallbacks(
				'.hint { --band: red; background: color-mix(in srgb, var(--band) 35%, var(--panel-cream)) }'
			)
		).toContain(
			squeezed(
				'background: linear-gradient(rgba(255, 252, 245, 0.65), rgba(255, 252, 245, 0.65)), var(--band)'
			)
		);
	});

	it('fails the build over a mix it cannot work out, a colour the stylesheet sets itself included', () => {
		expect(() => fallbacks('.a { color: color-mix(in srgb, var(--nowhere) 50%, white) }')).toThrow(
			/color-mix/
		);
		expect(() =>
			fallbacks('.x { --accent: red } .a { color: color-mix(in srgb, var(--accent) 50%, white) }')
		).toThrow(/color-mix/);
		expect(() => fallbacks('.a { color: color-mix(in oklab, red, white) }')).toThrow(/color-mix/);
	});

	it('leaves a mix already inside @supports alone', () => {
		const css =
			'@supports (color: color-mix(in srgb, red, red)) { .a { color: color-mix(in srgb, red, white) } }';
		expect(fallbacks(css)).toBe(squeezed(css));
	});

	it('reads the palette from the root, each colour set there once and nowhere else', () => {
		const css =
			':root { --a: #fff; --c: red } @media (max-width: 9px) { :root { --b: #000 } } .x { --c: blue }';
		expect([...paletteOf(css)]).toEqual([['--a', '#fff']]);
	});
});
