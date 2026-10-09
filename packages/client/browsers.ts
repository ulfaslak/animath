/**
 * The browsers the game is built for, and the build's check that it keeps to
 * them ([[DECISIONS]] § The page): Safari 15 and up, as on an iPad or iPhone
 * with iPadOS or iOS 15, which many family iPads stay on, and every browser as
 * new. A Safari that cannot read one line of a script runs none of it: before
 * #169 the page stayed empty on every Safari before 16.4.
 *
 * `BUILD_TARGET` is what the build writes its scripts and styles for. esbuild
 * lowers what Safari 15.0 cannot read (a class's static block, which three.js
 * has) and prefixes what it reads only prefixed (`-webkit-mask`). What it
 * cannot lower, `oldBrowsers` finds in the built files and fails the build
 * over, so a build Safari 15 cannot start never reaches a kid:
 *
 * - syntax (`scanScript`): anything newer than ES2022, a class's static block,
 *   and a regular expression's lookbehind (Safari 16.4), which esbuild can
 *   only turn into a `new RegExp` that throws when it runs. The error
 *   reports' chunk keeps to ES2017, and the page's inline script to ES5;
 * - built-ins Safari 15.0 lacks (`scanScript`): `Object.hasOwn` and
 *   `Array.prototype.at` (15.4), `structuredClone` (15.4),
 *   `AbortSignal.timeout` (16), … unless the chunk asks for the name first
 *   (`typeof`, `in`), as three.js does for `OffscreenCanvas`;
 * - styles it drops (`scanStyles`): `:has()`, `@layer`, `@container`, a
 *   `subgrid` or a dynamic viewport unit with no value before it, and a
 *   `color-mix()` outside `@supports`.
 *
 * `colorMixFallbacks` gives every `color-mix()` its colour worked out at
 * build time, for a browser without it (Safari before 16.2).
 */
import { parse } from 'acorn';
import postcss, {
	type ChildNode,
	type Container,
	type Declaration,
	type Plugin as StylePlugin,
	type Root
} from 'postcss';
import type { Plugin } from 'vite';

/** What the build writes the scripts and styles for (Vite's `build.target`, in esbuild's names). */
export const BUILD_TARGET = ['es2022', 'safari15', 'ios15'];

/** Something in a built file that Safari 15.0 cannot read or run. */
export interface Finding {
	/** What it is, and from which Safari on it works. */
	what: string;
	/** The code round it. */
	near: string;
}

type Node = { type: string; start: number; end: number; [key: string]: unknown };

function isNode(value: unknown): value is Node {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as { type?: unknown }).type === 'string'
	);
}

function walk(
	node: Node,
	visit: (node: Node, parent: Node | null) => void,
	parent: Node | null = null
): void {
	visit(node, parent);
	for (const key in node) {
		const value = node[key];
		if (Array.isArray(value)) {
			for (const child of value) if (isNode(child)) walk(child, visit, node);
		} else if (isNode(value)) {
			walk(value, visit, node);
		}
	}
}

function near(code: string, at: number): string {
	return code.slice(Math.max(0, at - 40), Math.min(code.length, at + 60)).replace(/\s+/g, ' ');
}

/**
 * Whether a regular expression's source has a lookbehind (`(?<=`, `(?<!`)
 * outside a character class, which a Safari before 16.4 refuses as it reads
 * the script. A named group (`(?<name>`) is no lookbehind.
 */
export function hasLookbehind(source: string): boolean {
	let inClass = false;
	for (let i = 0; i < source.length; i++) {
		const c = source[i];
		if (c === '\\') {
			i++;
		} else if (inClass) {
			if (c === ']') inClass = false;
		} else if (c === '[') {
			inClass = true;
		} else if (c === '(' && source[i + 1] === '?' && source[i + 2] === '<') {
			if (source[i + 3] === '=' || source[i + 3] === '!') return true;
		}
	}
	return false;
}

/** Static members Safari 15.0 lacks, by the global they hang on, and the Safari each came in. */
const STATICS: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map([
	[
		'Object',
		new Map([
			['hasOwn', '15.4'],
			['groupBy', '17.4']
		])
	],
	['Map', new Map([['groupBy', '17.4']])],
	['Array', new Map([['fromAsync', '16.4']])],
	[
		'Promise',
		new Map([
			['withResolvers', '17.4'],
			['try', '18.2']
		])
	],
	[
		'AbortSignal',
		new Map([
			['timeout', '16'],
			['any', '17.4']
		])
	],
	['Atomics', new Map([['waitAsync', '16.4']])],
	[
		'Intl',
		new Map([
			['DurationFormat', '16.4'],
			['supportedValuesOf', '15.4']
		])
	],
	['navigator', new Map([['locks', '15.4']])]
]);

/**
 * Methods Safari 15.0 lacks, by a name no method of the game or three.js
 * shares. `at(i)` (15.4) and `with(i, value)` (16) are told by how many
 * arguments they take: three.js's `Ray.at` takes two, the world's
 * `WorldEdits.with` one.
 */
const METHODS: ReadonlyMap<string, string> = new Map([
	['findLast', '15.4'],
	['findLastIndex', '15.4'],
	['toSorted', '16'],
	['toReversed', '16'],
	['toSpliced', '16'],
	['isWellFormed', '16.4'],
	['toWellFormed', '16.4'],
	['randomUUID', '15.4'],
	['throwIfAborted', '15.4'],
	['showModal', '15.4'],
	['requestVideoFrameCallback', '15.4'],
	['checkVisibility', '17.4']
]);

/** Globals Safari 15.0 lacks ('' where no Safari has one yet). */
const GLOBALS: ReadonlyMap<string, string> = new Map([
	['structuredClone', '15.4'],
	['BroadcastChannel', '15.4'],
	['OffscreenCanvas', '16.4'],
	['CompressionStream', '16.4'],
	['DecompressionStream', '16.4'],
	['ElementInternals', '16.4'],
	['VideoFrame', '16.4'],
	['VideoDecoder', '16.4'],
	['VideoEncoder', '16.4'],
	['requestIdleCallback', ''],
	['cancelIdleCallback', ''],
	['ImageDecoder', '']
]);

function since(version: string): string {
	return version === '' ? 'no Safari' : `Safari ${version}`;
}

/** The name a member expression reads (`a.b`, `a['b']`), if it says it. */
function memberName(node: Node): string | null {
	const property = node.property as Node;
	if (!node.computed && property.type === 'Identifier') return property.name as string;
	if (node.computed && property.type === 'Literal' && typeof property.value === 'string') {
		return property.value;
	}
	return null;
}

/** Whether an identifier is a name the code reads: not a property's or a key's, nor what `typeof` asks about. */
function isRead(node: Node, parent: Node | null): boolean {
	if (!parent) return true;
	if (parent.type === 'UnaryExpression' && parent.operator === 'typeof') return false;
	if (parent.type === 'MemberExpression') return parent.object === node || parent.computed === true;
	if (
		parent.type === 'Property' ||
		parent.type === 'MethodDefinition' ||
		parent.type === 'PropertyDefinition'
	) {
		return parent.key !== node || parent.computed === true || parent.shorthand === true;
	}
	return true;
}

/** What the page's globals are reached through, as well as by their names. */
const GLOBAL_OBJECTS: ReadonlySet<string> = new Set(['window', 'self', 'globalThis']);

const FUNCTIONS: ReadonlySet<string> = new Set([
	'FunctionExpression',
	'FunctionDeclaration',
	'ArrowFunctionExpression',
	'ClassExpression',
	'ClassDeclaration'
]);

/**
 * The names an expression asks for, short of the functions in it: `typeof x`,
 * `typeof x.name`, `'name' in x`, and a variable set from such a test
 * (`aliases`), as three.js keeps whether it has an `OffscreenCanvas`.
 */
function askedIn(test: Node, aliases: ReadonlyMap<string, ReadonlySet<string>>): Set<string> {
	const names = new Set<string>();
	const visit = (node: Node): void => {
		if (FUNCTIONS.has(node.type)) return;
		if (node.type === 'UnaryExpression' && node.operator === 'typeof') {
			const argument = node.argument as Node;
			if (argument.type === 'Identifier') names.add(argument.name as string);
			if (argument.type === 'MemberExpression') names.add(memberName(argument) ?? '');
		} else if (node.type === 'BinaryExpression' && node.operator === 'in') {
			const left = node.left as Node;
			if (left.type === 'Literal' && typeof left.value === 'string') names.add(left.value);
		} else if (node.type === 'Identifier') {
			for (const name of aliases.get(node.name as string) ?? []) names.add(name);
		}
		for (const key in node) {
			const value = node[key];
			if (Array.isArray(value)) {
				for (const child of value) if (isNode(child)) visit(child);
			} else if (isNode(value)) {
				visit(value);
			}
		}
	};
	visit(test);
	return names;
}

/** Each variable set from a test that asks for names (`v = typeof OffscreenCanvas < 'u' && …`), and those names. */
function aliasesIn(program: Node): Map<string, Set<string>> {
	const aliases = new Map<string, Set<string>>();
	const note = (id: unknown, value: unknown) => {
		if (!isNode(id) || id.type !== 'Identifier' || !isNode(value)) return;
		const names = askedIn(value, new Map());
		if (names.size === 0) return;
		const name = id.name as string;
		aliases.set(name, new Set([...(aliases.get(name) ?? []), ...names]));
	};
	walk(program, (node) => {
		if (node.type === 'VariableDeclarator') note(node.id, node.init);
		if (node.type === 'AssignmentExpression') note(node.left, node.right);
	});
	return aliases;
}

/**
 * What in a built script Safari 15.0 cannot read or run: syntax newer than
 * `ecmaVersion` (ES2022 for the game; ES2017 for the error reports' chunk,
 * ES5 for the page's inline script), a class's static block, a lookbehind in
 * a regular expression or in a string one may be built from, and the
 * built-ins it lacks. A built-in is let be only where the script has asked
 * for it: inside an `if` or a `?:` whose test asks, or after a `&&` or `||`
 * whose left side does (`askedIn`).
 */
export function scanScript(
	code: string,
	ecmaVersion: 5 | 2017 | 2022 = 2022,
	sourceType: 'module' | 'script' = 'module'
): Finding[] {
	let program: Node;
	try {
		program = parse(code, { ecmaVersion, sourceType }) as unknown as Node;
	} catch (error) {
		const at = (error as { pos?: number }).pos ?? 0;
		return [
			{
				what: `syntax newer than ES${ecmaVersion} (${(error as Error).message})`,
				near: near(code, at)
			}
		];
	}
	const found: Finding[] = [];
	const aliases = aliasesIn(program);
	const flag = (what: string, at: number) => found.push({ what, near: near(code, at) });
	const use = (name: string, what: string, at: number, asked: ReadonlySet<string>) => {
		if (!asked.has(name)) flag(what, at);
	};

	function check(node: Node, parent: Node | null, asked: ReadonlySet<string>): void {
		switch (node.type) {
			case 'StaticBlock':
				flag("a class's static block (Safari 16.4)", node.start);
				break;
			case 'Literal': {
				const regex = node.regex as { pattern: string } | undefined;
				if (regex && hasLookbehind(regex.pattern)) {
					flag('a lookbehind in a regular expression (Safari 16.4)', node.start);
				} else if (typeof node.value === 'string' && hasLookbehind(node.value)) {
					flag('a lookbehind in a string a RegExp can be built from (Safari 16.4)', node.start);
				}
				break;
			}
			case 'TemplateElement':
				if (hasLookbehind((node.value as { raw: string }).raw)) {
					flag('a lookbehind in a string a RegExp can be built from (Safari 16.4)', node.start);
				}
				break;
			case 'MemberExpression': {
				const object = node.object as Node;
				const name = memberName(node);
				if (object.type !== 'Identifier' || name === null) break;
				const owner = object.name as string;
				const version = GLOBAL_OBJECTS.has(owner)
					? GLOBALS.get(name)
					: STATICS.get(owner)?.get(name);
				const typeofArgument = parent?.type === 'UnaryExpression' && parent.operator === 'typeof';
				if (version !== undefined && !typeofArgument) {
					use(name, `${owner}.${name} (${since(version)})`, node.start, asked);
				}
				break;
			}
			case 'CallExpression': {
				const callee = node.callee as Node;
				if (callee.type !== 'MemberExpression') break;
				const name = memberName(callee);
				const count = (node.arguments as unknown[]).length;
				const version =
					name === 'at' && count === 1
						? '15.4'
						: name === 'with' && count === 2
							? '16'
							: name !== null
								? METHODS.get(name)
								: undefined;
				if (name !== null && version !== undefined) {
					use(name, `.${name}() (${since(version)})`, callee.end, asked);
				}
				break;
			}
			case 'Identifier': {
				const name = node.name as string;
				const version = GLOBALS.get(name);
				if (version !== undefined && isRead(node, parent)) {
					use(name, `${name} (${since(version)})`, node.start, asked);
				}
				break;
			}
		}
	}

	function visit(node: Node, parent: Node | null, asked: ReadonlySet<string>): void {
		check(node, parent, asked);
		const test =
			node.type === 'IfStatement' || node.type === 'ConditionalExpression'
				? node.test
				: node.type === 'LogicalExpression'
					? node.left
					: null;
		let within = asked;
		if (isNode(test)) {
			const names = askedIn(test, aliases);
			if (names.size > 0) within = new Set([...asked, ...names]);
		}
		for (const key in node) {
			const value = node[key];
			const inner = value === test ? asked : within;
			if (Array.isArray(value)) {
				for (const child of value) if (isNode(child)) visit(child, node, inner);
			} else if (isNode(value)) {
				visit(value, node, inner);
			}
		}
	}

	visit(program, null, new Set());
	return found;
}

/** The scripts a page runs from its own text: every `<script>` with no `src` and no `type`. */
export function inlineScripts(html: string): string[] {
	const scripts: string[] = [];
	for (const found of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
		const attributes = found[1] ?? '';
		if (!/\b(src|type)\s*=/i.test(attributes)) scripts.push(found[2] ?? '');
	}
	return scripts;
}

/** Pseudo-classes Safari 15.0 lacks: a selector list with one of them it drops whole. */
const NEWER_PSEUDO =
	/:(focus-visible|has\(|modal|user-invalid|user-valid|popover-open|dir\()|::backdrop/;
/** At-rules Safari 15.0 skips with everything in them. */
const NEWER_AT_RULES: ReadonlyMap<string, string> = new Map([
	['layer', '15.4'],
	['container', '16'],
	['scope', '17.4'],
	['starting-style', '17.5']
]);
const DYNAMIC_VIEWPORT = /\d(?:[dsl]v(?:h|w|i|b|min|max))\b/;
const COLOR_MIX = /color-mix\(/i;

/** Whether `node` is inside an at-rule named `name` (whose condition matches `params`). */
function insideAtRule(node: ChildNode, name: RegExp, params?: RegExp): boolean {
	type Up = ChildNode | Root | undefined;
	for (let up = node.parent as Up; up && up.type !== 'root'; up = up.parent as Up) {
		if (up.type === 'atrule' && name.test(up.name) && (!params || params.test(up.params))) {
			return true;
		}
	}
	return false;
}

/**
 * What in a built stylesheet Safari 15.0 drops: `:has()`, a selector list
 * that mixes a pseudo-class it lacks with others, an at-rule it skips whole,
 * a `subgrid` or a dynamic viewport unit (`dvh`) with no value of the same
 * property before it, and a `color-mix()` outside an `@supports` that asks
 * for it (`colorMixFallbacks` puts it there).
 */
export function scanStyles(css: string): Finding[] {
	const found: Finding[] = [];
	const root = postcss.parse(css);
	root.walkAtRules((rule) => {
		const version = NEWER_AT_RULES.get(rule.name.toLowerCase());
		if (version !== undefined) {
			found.push({
				what: `@${rule.name} (Safari ${version})`,
				near: rule.toString().slice(0, 100)
			});
		}
	});
	root.walkRules((rule) => {
		const newer = rule.selectors.filter((selector) => NEWER_PSEUDO.test(selector));
		if (rule.selector.includes(':has(')) {
			found.push({ what: ':has() (Safari 15.4)', near: rule.selector.slice(0, 100) });
		} else if (newer.length > 0 && newer.length < rule.selectors.length) {
			found.push({
				what: 'a selector list with a pseudo-class Safari 15.0 lacks, which drops it whole',
				near: rule.selector.slice(0, 100)
			});
		}
		const before = new Set<string>();
		rule.each((node) => {
			if (node.type !== 'decl') return;
			const prop = node.prop.toLowerCase();
			const shown = `${node.prop}: ${node.value}`.slice(0, 100);
			if (/\bsubgrid\b/i.test(node.value) && !before.has(prop)) {
				found.push({ what: 'subgrid (Safari 16) with no value before it', near: shown });
			}
			if (DYNAMIC_VIEWPORT.test(node.value) && !before.has(prop)) {
				found.push({
					what: 'a dynamic viewport unit (Safari 15.4) with no value before it',
					near: shown
				});
			}
			if (COLOR_MIX.test(node.value) && !insideAtRule(node, /^supports$/i, COLOR_MIX)) {
				found.push({ what: 'color-mix() (Safari 16.2) outside @supports', near: shown });
			}
			before.add(prop);
		});
	});
	return found;
}

/** A colour, its channels 0 to 255 and its alpha 0 to 1. */
interface Colour {
	r: number;
	g: number;
	b: number;
	a: number;
}

const NAMED: ReadonlyMap<string, Colour> = new Map([
	['white', { r: 255, g: 255, b: 255, a: 1 }],
	['black', { r: 0, g: 0, b: 0, a: 1 }],
	['transparent', { r: 0, g: 0, b: 0, a: 0 }]
]);

/**
 * The palette's colours as a build knows them: each custom property set once
 * in the stylesheet, at the top of `:root` (`styles.css`), and nowhere else.
 */
export function paletteOf(css: string): Map<string, string> {
	const palette = new Map<string, string>();
	const twice = new Set<string>();
	postcss.parse(css).walkDecls(/^--/, (decl) => {
		const rule = decl.parent;
		const atRoot =
			rule?.type === 'rule' && (rule as unknown as { selector: string }).selector === ':root';
		if (palette.has(decl.prop) || !atRoot || rule.parent?.type !== 'root') twice.add(decl.prop);
		palette.set(decl.prop, decl.value.trim());
	});
	for (const name of twice) palette.delete(name);
	return palette;
}

/** A colour from its CSS: a palette token, a hex, `rgb()`/`rgba()`, white, black or transparent. */
function colourOf(text: string, palette: ReadonlyMap<string, string>, depth = 0): Colour | null {
	const value = text.trim().toLowerCase();
	const token = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
	if (token) {
		const set = palette.get(token[1] ?? '');
		return set !== undefined && depth < 4 ? colourOf(set, palette, depth + 1) : null;
	}
	const named = NAMED.get(value);
	if (named) return named;
	const hex = /^#([0-9a-f]{3,8})$/.exec(value)?.[1];
	if (hex !== undefined && [3, 4, 6, 8].includes(hex.length)) {
		const full = hex.length <= 4 ? [...hex].map((d) => d + d).join('') : hex;
		const byte = (i: number) => parseInt(full.slice(i * 2, i * 2 + 2), 16);
		return { r: byte(0), g: byte(1), b: byte(2), a: full.length === 8 ? byte(3) / 255 : 1 };
	}
	const rgb = /^rgba?\(([^)]*)\)$/.exec(value)?.[1];
	if (rgb !== undefined) {
		const parts = rgb.split(/[\s,/]+/).filter((part) => part !== '');
		const read = (part: string | undefined, whole: number) =>
			part === undefined
				? 1
				: part.endsWith('%')
					? (parseFloat(part) / 100) * whole
					: parseFloat(part);
		if (parts.length !== 3 && parts.length !== 4) return null;
		const [r, g, b] = parts.slice(0, 3).map((part) => read(part, 255));
		const a = read(parts[3], 1);
		if ([r, g, b, a].some((n) => n === undefined || !Number.isFinite(n))) return null;
		return { r: r as number, g: g as number, b: b as number, a };
	}
	return null;
}

/** One colour of a mix, and its share: `var(--accent) 40%`, `white`. */
interface Operand {
	colour: string;
	share: number | undefined;
}

function operandOf(text: string): Operand {
	const trimmed = text.trim();
	const after = /^(.*\S)\s+([\d.]+)%$/.exec(trimmed);
	if (after) return { colour: after[1] ?? '', share: parseFloat(after[2] ?? '') };
	const first = /^([\d.]+)%\s+(.*)$/.exec(trimmed);
	if (first) return { colour: first[2] ?? '', share: parseFloat(first[1] ?? '') };
	return { colour: trimmed, share: undefined };
}

/** The arguments of a function call at the top level of its parentheses. */
function argumentsOf(inside: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let from = 0;
	for (let i = 0; i < inside.length; i++) {
		const c = inside[i];
		if (c === '(') depth++;
		else if (c === ')') depth--;
		else if (c === ',' && depth === 0) {
			parts.push(inside.slice(from, i));
			from = i + 1;
		}
	}
	parts.push(inside.slice(from));
	return parts;
}

/** Where the parenthesis opened at `open` closes. */
function closing(text: string, open: number): number {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		if (text[i] === '(') depth++;
		else if (text[i] === ')' && --depth === 0) return i;
	}
	return -1;
}

function cssOf(colour: Colour, alpha = colour.a): string {
	const [r, g, b] = [colour.r, colour.g, colour.b].map((n) =>
		Math.round(Math.min(255, Math.max(0, n)))
	) as [number, number, number];
	const a = Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000;
	if (a === 1) return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
	return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * `color-mix(in srgb, …)` as CSS Color 5 mixes it: shares that do not say
 * are the rest of 100%, shares are scaled to add up to 100%, and to less than
 * 100% they fade the mix; colours mix with their alpha premultiplied.
 */
export function mixColours(
	first: Colour,
	firstShare: number | undefined,
	second: Colour,
	secondShare: number | undefined
): Colour | null {
	const p1 = firstShare ?? (secondShare === undefined ? 50 : 100 - secondShare);
	const p2 = secondShare ?? 100 - p1;
	const sum = p1 + p2;
	if (p1 < 0 || p2 < 0 || sum <= 0) return null;
	const [w1, w2] = [p1 / sum, p2 / sum];
	const a = first.a * w1 + second.a * w2;
	const channel = (k: 'r' | 'g' | 'b') =>
		a === 0 ? 0 : (first[k] * first.a * w1 + second[k] * second.a * w2) / a;
	return { r: channel('r'), g: channel('g'), b: channel('b'), a: a * Math.min(1, sum / 100) };
}

/**
 * A declaration's value for a browser without `color-mix()`: each mix worked
 * out from the palette. A background that mixes a colour set on the element
 * (`--band`) with one of the palette's is that colour under a layer of the
 * palette's at its share: for an opaque colour, the same mix.
 */
function withoutColorMix(decl: Declaration, palette: ReadonlyMap<string, string>): string {
	const value = decl.value;
	let out = '';
	let from = 0;
	for (let at = value.search(COLOR_MIX); at >= 0; at = value.slice(from).search(COLOR_MIX)) {
		at += from;
		const open = at + 'color-mix'.length;
		const end = closing(value, open);
		const [space, ...rest] = argumentsOf(value.slice(open + 1, end));
		const operands = rest.map(operandOf);
		const known = operands.map((operand) => colourOf(operand.colour, palette));
		let colour: string | null = null;
		if (end > 0 && space?.trim().toLowerCase() === 'in srgb' && operands.length === 2) {
			const [first, second] = operands as [Operand, Operand];
			const [firstKnown, secondKnown] = known as [Colour | null, Colour | null];
			if (firstKnown && secondKnown) {
				const mixed = mixColours(firstKnown, first.share, secondKnown, second.share);
				colour = mixed ? cssOf(mixed) : null;
			} else if (decl.prop === 'background' && at === 0 && end === value.length - 1) {
				const ours = firstKnown ? first : secondKnown ? second : null;
				const theirs = ours === first ? second : first;
				const oursKnown = firstKnown ?? secondKnown;
				const share =
					ours && (ours.share ?? (theirs.share === undefined ? 50 : 100 - theirs.share));
				const theirShare = theirs.share ?? 100 - (share ?? 0);
				if (oursKnown && oursKnown.a === 1 && share !== null && share + theirShare === 100) {
					const layer = cssOf(oursKnown, share / 100);
					colour = `linear-gradient(${layer}, ${layer}), ${theirs.colour}`;
				}
			}
		}
		if (colour === null) {
			throw decl.error(
				`${value.slice(at, end + 1)}: a browser without color-mix() (Safari before 16.2) needs its colour worked out as the game builds, from colours styles.css sets once at the root (browsers.ts)`
			);
		}
		out += value.slice(from, at) + colour;
		from = end + 1;
	}
	return out + value.slice(from);
}

const SUPPORTS = '(color: color-mix(in srgb, red, red))';

function mixesColours(container: Container): boolean {
	let found = false;
	container.walkDecls((decl) => {
		if (COLOR_MIX.test(decl.value)) found = true;
	});
	return found;
}

/** `root`'s mixes given their colours, and kept as written inside `@supports` (`colorMixFallbacks`). */
function withColorMixFallbacks(root: Root, palette: ReadonlyMap<string, string>): void {
	const asked = /^supports$/i;
	root.walkAtRules(/keyframes$/i, (keyframes) => {
		if (!mixesColours(keyframes) || insideAtRule(keyframes, asked, COLOR_MIX)) return;
		const original = keyframes.clone();
		keyframes.walkDecls((decl) => {
			if (COLOR_MIX.test(decl.value)) decl.value = withoutColorMix(decl, palette);
		});
		keyframes.after(postcss.atRule({ name: 'supports', params: SUPPORTS }).append(original));
	});
	root.walkRules((rule) => {
		if (insideAtRule(rule, asked, COLOR_MIX) || insideAtRule(rule, /keyframes$/i)) return;
		const mixed = rule.nodes.filter(
			(node): node is Declaration => node.type === 'decl' && COLOR_MIX.test(node.value)
		);
		if (mixed.length === 0) return;
		const original = rule.clone();
		original.removeAll();
		for (const decl of mixed) {
			original.append(decl.clone());
			decl.value = withoutColorMix(decl, palette);
		}
		rule.after(postcss.atRule({ name: 'supports', params: SUPPORTS }).append(original));
	});
}

/**
 * Gives every `color-mix()` its colour for a browser without it (Safari
 * before 16.2), where a declaration that holds one and a `var()` counts as
 * never set, and a card's background goes clear. The rule keeps the colour
 * worked out as the game builds (`withoutColorMix`), and the declaration as
 * written moves to a copy of the rule right after it, inside `@supports`, so
 * a browser with `color-mix()` mixes as before; a `@keyframes` is copied
 * whole. The colours are the palette's (`paletteOf`: `styles.css`'s, read
 * for every stylesheet, so a colour added while the dev server runs is
 * known), less any a stylesheet sets itself below the root.
 */
export function colorMixFallbacks(palette: () => ReadonlyMap<string, string>): StylePlugin {
	return {
		postcssPlugin: 'animath:color-mix-fallbacks',
		Once(root) {
			const known = new Map(palette());
			root.walkDecls(/^--/, (decl) => {
				const rule = decl.parent as Container | undefined;
				const atRoot =
					rule?.type === 'rule' &&
					(rule as unknown as { selector: string }).selector === ':root' &&
					rule.parent?.type === 'root';
				if (!atRoot) known.delete(decl.prop);
			});
			withColorMixFallbacks(root, known);
		}
	};
}

/**
 * Fails the build over anything in it Safari 15.0 cannot read or run
 * (`scanScript`, `scanStyles`): every chunk, the error reports' to ES2017
 * (`es2017`, the module it is built from), every stylesheet, and the page's
 * inline scripts, to ES5. It runs after every other plugin, on the files as
 * they are written.
 */
export function oldBrowsers(options: { es2017: string }): Plugin {
	return {
		name: 'animath:old-browsers',
		apply: 'build',
		enforce: 'post',
		generateBundle(_options, bundle) {
			const report: string[] = [];
			const add = (file: string, findings: Finding[]) => {
				for (const finding of findings)
					report.push(`${file}: ${finding.what}\n    ${finding.near}`);
			};
			let pages = 0;
			for (const file of Object.values(bundle)) {
				if (file.type === 'chunk') {
					const reports = file.facadeModuleId?.endsWith(options.es2017) === true;
					add(file.fileName, scanScript(file.code, reports ? 2017 : 2022));
					continue;
				}
				const text =
					typeof file.source === 'string' ? file.source : new TextDecoder().decode(file.source);
				if (file.fileName.endsWith('.css')) add(file.fileName, scanStyles(text));
				if (file.fileName.endsWith('.html')) {
					pages++;
					for (const script of inlineScripts(text))
						add(file.fileName, scanScript(script, 5, 'script'));
				}
			}
			if (pages === 0) report.push('no page in the build to check');
			if (report.length > 0) {
				this.error(
					`The build holds what Safari 15, the oldest browser the game is for, cannot run (browsers.ts):\n${report.join('\n')}`
				);
			}
		}
	};
}
