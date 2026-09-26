import { parse } from 'svelte/compiler';
import ts from 'typescript';

/**
 * Helpers for the tests that read the client's own source: which words a
 * Svelte template prints (`hardcoded-text.test.ts`) and which copy keys the
 * code asks `t()` for (`copy-files.test.ts`). Both parse the source rather
 * than grep it, so comments and prose never count.
 */

/** Every Svelte component and TypeScript module under `src/`, as text, keyed `src/…`. */
export const svelteSources = bySrcPath(
	import.meta.glob('../src/**/*.svelte', { query: '?raw', import: 'default', eager: true })
);
export const tsSources = bySrcPath(
	import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true })
);

function bySrcPath(files: Record<string, unknown>): Map<string, string> {
	return new Map(
		Object.entries(files).map(([path, text]) => [path.replace(/^\.\.\//, ''), String(text)])
	);
}

export function lineOf(source: string, offset: number): number {
	return source.slice(0, offset).split('\n').length;
}

/** A node of Svelte's template AST or of the ESTree expressions inside it. */
export interface AstNode {
	type: string;
	start: number;
	[key: string]: unknown;
}

function isNode(value: unknown): value is AstNode {
	return typeof value === 'object' && value !== null && typeof (value as AstNode).type === 'string';
}

/** One piece of literal text in the source. */
export interface Found {
	text: string;
	start: number;
}

/**
 * The string literals an expression can evaluate to and print: the branches
 * of `?:`, both sides of `??`, `||`, `&&` and `+`, and the text of a template
 * literal. Not arguments, comparisons or lookups: `t('key')`, `a === 'x'` and
 * `WORDS[k]` print no literal of their own.
 */
export function printedStrings(expression: unknown): Found[] {
	const node = expression;
	if (!isNode(node)) return [];
	switch (node.type) {
		case 'Literal':
			return typeof node.value === 'string' ? [{ text: node.value, start: node.start }] : [];
		case 'TemplateLiteral':
			return [
				...(node.quasis as AstNode[]).map((q) => ({
					text: String((q.value as { cooked?: string; raw: string }).cooked ?? ''),
					start: q.start
				})),
				...(node.expressions as unknown[]).flatMap(printedStrings)
			];
		case 'ConditionalExpression':
			return [...printedStrings(node.consequent), ...printedStrings(node.alternate)];
		case 'LogicalExpression':
			return [...printedStrings(node.left), ...printedStrings(node.right)];
		case 'BinaryExpression':
			return node.operator === '+'
				? [...printedStrings(node.left), ...printedStrings(node.right)]
				: [];
		case 'SequenceExpression':
			return printedStrings((node.expressions as unknown[]).at(-1));
		case 'TSAsExpression':
		case 'TSSatisfiesExpression':
		case 'TSNonNullExpression':
			return printedStrings(node.expression);
		default:
			return [];
	}
}

/** Svelte's template AST, with the script blocks' ESTree inside it. */
export function parseSvelte(source: string): AstNode {
	return parse(source, { modern: true }) as unknown as AstNode;
}

/** Every node under `root`, depth first: template, scripts and expressions alike. */
export function* walk(root: unknown, seen = new WeakSet<object>()): Generator<AstNode> {
	if (typeof root !== 'object' || root === null || seen.has(root)) return;
	seen.add(root);
	if (isNode(root)) yield root;
	for (const [key, value] of Object.entries(root)) {
		if (key === 'metadata') continue;
		if (Array.isArray(value)) for (const item of value) yield* walk(item, seen);
		else if (typeof value === 'object' && value !== null) yield* walk(value, seen);
	}
}

/**
 * The functions whose first argument is a copy key: `t(key, params)`, and
 * `line(key, params)`, which keeps a line to be worded later.
 */
const COPY_FUNCTIONS = new Set(['t', 'line']);

/** A call to `t()` or `line()` with the keys its first argument can be, and the param names its second passes. */
export interface CopyCall {
	file: string;
	line: number;
	keys: string[];
	/** The property names of an object-literal second argument; `null` when it is not one (a variable, a spread). */
	params: string[] | null;
}

/** Every `t(…)` call in a component or module whose key is written out, so a test can check it. */
export function copyCalls(file: string, source: string): CopyCall[] {
	return file.endsWith('.svelte') ? svelteCopyCalls(file, source) : tsCopyCalls(file, source);
}

/** The keys an ESTree argument spells out: a string, or either branch of `?:`. A key built at run time spells none. */
function keysOf(node: unknown): string[] {
	if (!isNode(node)) return [];
	if (node.type === 'Literal') return typeof node.value === 'string' ? [node.value] : [];
	if (node.type === 'TemplateLiteral' && (node.expressions as unknown[]).length === 0) {
		const quasi = (node.quasis as AstNode[])[0]?.value as { cooked?: string } | undefined;
		return [quasi?.cooked ?? ''];
	}
	if (node.type === 'ConditionalExpression') {
		return [...keysOf(node.consequent), ...keysOf(node.alternate)];
	}
	if (node.type === 'TSAsExpression' || node.type === 'TSNonNullExpression') {
		return keysOf(node.expression);
	}
	return [];
}

function svelteCopyCalls(file: string, source: string): CopyCall[] {
	const calls: CopyCall[] = [];
	for (const node of walk(parseSvelte(source))) {
		const callee = node.callee as AstNode | undefined;
		if (node.type !== 'CallExpression' || callee?.type !== 'Identifier') continue;
		if (!COPY_FUNCTIONS.has(String(callee.name))) continue;
		const [key, params] = node.arguments as (AstNode | undefined)[];
		const keys = keysOf(key);
		if (keys.length === 0) continue;
		let names: string[] | null = [];
		if (params) {
			const props = params.type === 'ObjectExpression' ? (params.properties as AstNode[]) : null;
			names = props?.every((p) => p.type === 'Property')
				? props.map((p) => {
						const k = p.key as AstNode;
						return String(k.type === 'Identifier' ? k.name : k.value);
					})
				: null;
		}
		calls.push({ file, line: lineOf(source, node.start), keys, params: names });
	}
	return calls;
}

function tsCopyCalls(file: string, source: string): CopyCall[] {
	const calls: CopyCall[] = [];
	const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
	const tsKeysOf = (node: ts.Node | undefined): string[] => {
		if (!node) return [];
		if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
		if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node))
			return tsKeysOf(node.expression);
		if (ts.isConditionalExpression(node))
			return [...tsKeysOf(node.whenTrue), ...tsKeysOf(node.whenFalse)];
		return [];
	};
	const visit = (node: ts.Node): void => {
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			COPY_FUNCTIONS.has(node.expression.text)
		) {
			const [key, params] = node.arguments;
			const keys = tsKeysOf(key);
			if (keys.length > 0) {
				let names: string[] | null = [];
				if (params) {
					names =
						ts.isObjectLiteralExpression(params) &&
						params.properties.every(
							(p) => ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)
						)
							? params.properties.map((p) => p.name!.getText(sf).replace(/^['"]|['"]$/g, ''))
							: null;
				}
				calls.push({
					file,
					line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
					keys,
					params: names
				});
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);
	return calls;
}

/**
 * Whether a literal reads as words: a letter, a space and a letter, or two
 * letters in a row and a closing `.`, `!`, `?` or `…` ("Caught!"). Keys
 * (`battle.go`), ids (`choose-action`), key names (`Enter`) and sums do not.
 */
function worded(text: string): boolean {
	return /\p{L}\s+\p{L}/u.test(text) || /\p{L}{2}.*[.!?…]$/u.test(text);
}

/**
 * String literals in TypeScript that read as words, as `file:line text`. A
 * template literal's `${…}` counts as a one-letter word, so a sentence around
 * a name is caught and `${a} × ${b} = ?` is not. Messages for developers are
 * skipped: anything inside `new Error(…)` or `console.*(…)`.
 */
export function wordedLiterals(file: string, source: string): string[] {
	const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
	const found: string[] = [];
	const forDevelopers = (node: ts.Node): boolean => {
		for (let p = node.parent; p; p = p.parent) {
			if (ts.isNewExpression(p) && p.expression.getText(sf) === 'Error') return true;
			if (ts.isCallExpression(p) && /^console\./.test(p.expression.getText(sf))) return true;
		}
		return false;
	};
	const visit = (node: ts.Node): void => {
		let text: string | null = null;
		if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
		if (ts.isTemplateExpression(node)) {
			text = node.head.text + node.templateSpans.map((s) => 'x' + s.literal.text).join('');
		}
		if (text !== null && worded(text.trim()) && !forDevelopers(node)) {
			const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
			found.push(`${file}:${line} ${text.trim()}`);
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);
	return found;
}
