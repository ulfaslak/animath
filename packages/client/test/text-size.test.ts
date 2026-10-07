import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { parseSvelte, walk, type AstNode } from './source';

/**
 * No text below 16 px ([[DESIGN]] § Accessibility), anywhere in the client:
 * a smaller size reads as fine on a laptop and is too small for a kid on a
 * tablet. Key caps, counts, a greyed button's reason and the name tags over a
 * friend's battle all shipped at 12–15 px before this test.
 *
 * It parses the components, the stylesheets and the page (Svelte's parser;
 * a `.css` file as a component's `<style>`), and reads every `font-size` and
 * `font` declaration, in a rule, a `style` attribute or a `style:font-size`
 * directive, and every custom property such a declaration reads
 * (`font-size: var(--text)`, with `--text` set per level in the same file).
 * Each size written out counts: a px or rem number, a `clamp()`'s floor, a
 * `min()`'s or `max()`'s every term. What a `calc()` works out at run time
 * (the celebration's name, sized to its card) is the component's to keep in
 * bounds and is not read here. In TypeScript, a size a string sets: a
 * canvas's `ctx.font = …`, `el.style.fontSize = …`, a `fontSize` option.
 */
const markup = import.meta.glob(['../src/**/*.svelte', '../index.html'], {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;
const stylesheets = import.meta.glob('../src/**/*.css', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;
const modules = import.meta.glob('../src/**/*.ts', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

const FLOOR_PX = 16;

/** A declaration's value with every `calc(…)` taken out, nested brackets and all. */
function withoutCalc(value: string): string {
	let out = '';
	for (let i = 0; i < value.length;) {
		if (value.startsWith('calc(', i)) {
			let depth = 0;
			let j = i + 4;
			for (; j < value.length; j++) {
				if (value[j] === '(') depth++;
				else if (value[j] === ')' && --depth === 0) break;
			}
			out += ' ';
			i = j + 1;
		} else out += value[i++];
	}
	return out;
}

/** The sizes in px a font-size value writes out: every px or rem number not inside a calc(). */
function sizesIn(value: string): number[] {
	// A `font` shorthand's line height follows a slash (`600 20px/1.4 Nunito`): not a size.
	const bare = withoutCalc(value).replace(/\/\s*[\d.]+[a-z%]*/gi, ' ');
	return [...bare.matchAll(/(-?[\d.]+)(px|rem)\b/g)].map(
		(m) => Number(m[1]) * (m[2] === 'rem' ? 16 : 1)
	);
}

/** Every declaration a component or page makes: in its styles, its `style` attributes and its `style:` directives. */
function declarations(source: string): { property: string; value: string }[] {
	const found: { property: string; value: string }[] = [];
	const text = (value: unknown): string | null =>
		Array.isArray(value) && value.every((v: AstNode) => v.type === 'Text')
			? value.map((v: AstNode) => String(v.data)).join('')
			: null;
	for (const node of walk(parseSvelte(source))) {
		if (node.type === 'Declaration') {
			found.push({ property: String(node.property), value: String(node.value) });
		} else if (node.type === 'Attribute' && node.name === 'style') {
			for (const decl of (text(node.value) ?? '').split(';')) {
				const colon = decl.indexOf(':');
				if (colon < 0) continue;
				found.push({ property: decl.slice(0, colon).trim(), value: decl.slice(colon + 1).trim() });
			}
		} else if (node.type === 'StyleDirective') {
			const value = text(node.value);
			if (value !== null) found.push({ property: String(node.name), value });
		}
	}
	return found;
}

/** Every text size a component, a page or a stylesheet sets under the floor, as `file: property: value`. */
function tooSmall(file: string, source: string): string[] {
	const decls = declarations(file.endsWith('.css') ? `<style>${source}</style>` : source);
	const sized = decls.filter((d) => d.property === 'font-size' || d.property === 'font');
	const read = new Set(
		sized.flatMap((d) => [...d.value.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]!))
	);
	return [...sized, ...decls.filter((d) => read.has(d.property))]
		.filter((d) => sizesIn(d.value).some((px) => px < FLOOR_PX))
		.map((d) => `${file}: ${d.property}: ${d.value}`);
}

/** Every text size a module sets in a string under the floor: `ctx.font = …`, `style.fontSize = …`, `fontSize: …`. */
function tooSmallInScript(file: string, source: string): string[] {
	const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
	const found: string[] = [];
	const literal = (node: ts.Node): string | null =>
		ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
			? node.text
			: ts.isTemplateExpression(node)
				? node.head.text + node.templateSpans.map((s) => ' ' + s.literal.text).join('')
				: null;
	const isSize = (name: string): boolean => name === 'font' || name === 'fontSize';
	const visit = (node: ts.Node): void => {
		let value: string | null = null;
		if (
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
			ts.isPropertyAccessExpression(node.left) &&
			isSize(node.left.name.text)
		) {
			value = literal(node.right);
		} else if (
			ts.isPropertyAssignment(node) &&
			(ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
			node.name.text === 'fontSize'
		) {
			value = literal(node.initializer);
		}
		if (value !== null && sizesIn(value).some((px) => px < FLOOR_PX)) {
			found.push(`${file}: ${node.getText(sf)}`);
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);
	return found;
}

describe('text size', () => {
	it('reads the sizes a value writes out', () => {
		expect(sizesIn('14px')).toEqual([14]);
		expect(sizesIn('clamp(40px, 7vh, 64px)')).toEqual([40, 64]);
		expect(sizesIn('min(52px, calc(var(--room) / (var(--longest) * 0.66)))')).toEqual([52]);
		expect(sizesIn('600 20px/1.4 Nunito, system-ui')).toEqual([20]);
		expect(sizesIn('0.75rem')).toEqual([12]);
		expect(sizesIn('inherit')).toEqual([]);
	});

	it('catches a small size wherever it is set', () => {
		const style = (css: string): string => `<style>${css}</style>`;
		expect(tooSmall('a.svelte', style('.why { font-size: 14px; }'))).toEqual([
			'a.svelte: font-size: 14px'
		]);
		expect(
			tooSmall('a.svelte', style('@media (max-height: 560px) { .who { font-size: 14px } }'))
		).toHaveLength(1);
		expect(
			tooSmall('a.svelte', style('.n { font-size: var(--text); } .l1 { --text: 15px; }'))
		).toEqual(['a.svelte: --text: 15px']);
		expect(tooSmall('a.svelte', style('.t { font: 800 12px/1.2 Nunito; }'))).toHaveLength(1);
		expect(tooSmall('a.svelte', style('.t { font-size: clamp(12px, 3vh, 20px); }'))).toHaveLength(
			1
		);
		expect(tooSmall('a.css', '.t { font-size: 15px; }')).toHaveLength(1);
		expect(tooSmall('a.svelte', '<b style="color: red; font-size: 10px">x</b>')).toHaveLength(1);
		expect(tooSmall('a.svelte', '<b style:font-size="12px">x</b>')).toHaveLength(1);
		// A custom property no font-size reads is a width, a gap, a burst's size.
		expect(tooSmall('a.svelte', style('.n { width: var(--size); } .l1 { --size: 8px; }'))).toEqual(
			[]
		);
		// A comment, or a word in the template, is not a style.
		expect(
			tooSmall(
				'a.svelte',
				`<p>font-size: 12px</p>${style('/* font-size: 12px */ .t { font-size: 16px; }')}`
			)
		).toEqual([]);
		expect(tooSmallInScript('a.ts', "ctx.font = '800 12px Nunito';")).toHaveLength(1);
		expect(tooSmallInScript('a.ts', 'el.style.fontSize = `${n}px 14px`;')).toHaveLength(1);
		expect(tooSmallInScript('a.ts', "const o = { fontSize: '0.5rem' };")).toHaveLength(1);
		expect(tooSmallInScript('a.ts', "// ctx.font = '12px'\nctx.font = '20px Nunito';")).toEqual([]);
	});

	it('is never below 16 px in the client', () => {
		expect(Object.keys(markup).length).toBeGreaterThan(20);
		expect(Object.keys(stylesheets).length).toBeGreaterThan(0);
		const found = [
			...Object.entries({ ...markup, ...stylesheets }).flatMap(([file, text]) =>
				tooSmall(file, text)
			),
			...Object.entries(modules).flatMap(([file, text]) => tooSmallInScript(file, text))
		];
		expect(found).toEqual([]);
	});
});
