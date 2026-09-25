import { describe, expect, it } from 'vitest';
import {
	lineOf,
	parseSvelte,
	printedStrings,
	svelteSources,
	tsSources,
	wordedLiterals,
	type AstNode
} from './source';

/**
 * No player-facing words are written into code: they live in
 * `src/copy/<language>.yaml` and are shown with `t()` or `words(line)`, so
 * the Language setting reaches them (DECISIONS § Copy and languages). Two
 * checks: Svelte templates print no words of their own, and no TypeScript —
 * modules or `<script>` blocks — holds a literal that reads as a sentence.
 * The second is a heuristic (see `wordedLiterals`); the types do the rest:
 * what the screen says is kept as a `Line` or a copy key, never a string.
 */

/** Attributes whose words a player reads, or hears from a screen reader. */
const WORDED_ATTRIBUTES = new Set([
	'alt',
	'aria-description',
	'aria-label',
	'aria-placeholder',
	'aria-roledescription',
	'aria-valuetext',
	'label',
	'placeholder',
	'title'
]);

/** Where a template's children are, by block kind: elements, if/else, each, await, key, snippet. */
const FRAGMENTS = [
	'fragment',
	'consequent',
	'alternate',
	'body',
	'fallback',
	'pending',
	'then',
	'catch'
];

interface Offender {
	file: string;
	line: number;
	text: string;
}

/**
 * Words a template prints on its own: text between tags, the words of the
 * attributes above, and string literals an expression prints
 * (`{ok ? 'Yes!' : 'No'}`). Anything with a letter in it counts; numbers,
 * symbols and `{t('key')}` do not.
 */
function hardcodedText(file: string, source: string): Offender[] {
	const found: Offender[] = [];
	const report = (text: string, start: number) => {
		const words = text.replace(/\s+/g, ' ').trim();
		if (/\p{L}/u.test(words)) found.push({ file, line: lineOf(source, start), text: words });
	};
	const visit = (node: AstNode): void => {
		if (node.type === 'Text') report(String(node.data), node.start);
		if (node.type === 'ExpressionTag' || node.type === 'HtmlTag') {
			for (const s of printedStrings(node.expression)) report(s.text, s.start);
		}
		for (const attribute of (node.attributes ?? []) as AstNode[]) {
			if (attribute.type !== 'Attribute') continue;
			if (!WORDED_ATTRIBUTES.has(String(attribute.name).toLowerCase())) continue;
			const value = attribute.value;
			const parts =
				value === true ? [] : Array.isArray(value) ? (value as AstNode[]) : [value as AstNode];
			for (const part of parts) {
				if (part.type === 'Text') report(String(part.data), part.start);
				else for (const s of printedStrings(part.expression)) report(s.text, s.start);
			}
		}
		for (const key of FRAGMENTS) {
			const fragment = node[key] as AstNode | null | undefined;
			if (fragment?.type === 'Fragment')
				for (const child of fragment.nodes as AstNode[]) visit(child);
		}
	};
	visit(parseSvelte(source));
	return found;
}

describe('hardcoded text in Svelte templates', () => {
	it('finds text, worded attributes and printed literals, and nothing else', () => {
		const source = `<script lang="ts">
	const word: string = 'Not in the template';
</script>

<p>Hello {name}</p>
<input placeholder="Your name" class="big words" />
<img alt={ok ? 'A fox' : 'A bear'} src="fox.png" />
<span>{flag ? \`Well done, \${name}!\` : count}</span>
<span>{t('some.key')} {WORDS[kind]} {a === 'compared' ? 1 : 2}</span>
{#if x}<b>12 × 3 = ?</b>{:else}<i>−{damage}</i>{/if}
{#each list as item (item.id)}<Card title="Go" variant="primary" />{/each}
<!-- a comment -->
<style>
	p::after { content: 'Not in the template'; }
</style>`;
		const found = hardcodedText('fixture.svelte', source);
		expect(found.map((o) => o.text)).toEqual([
			'Hello',
			'Your name',
			'A fox',
			'A bear',
			'Well done,',
			'Go'
		]);
		expect(found.map((o) => o.line)).toEqual([5, 6, 7, 7, 8, 11]);
	});

	it('every template shows its words through t()', () => {
		const found = [...svelteSources].flatMap(([file, source]) => hardcodedText(file, source));
		expect(svelteSources.size).toBeGreaterThan(3);
		expect(
			found.map((o) => `${o.file}:${o.line} ${JSON.stringify(o.text)}`),
			'Words written straight into a template. Put them in src/copy/en.yaml and da.yaml and show ' +
				"them with t('group.key') (DEVELOPMENT § Copy and languages)."
		).toEqual([]);
	});
});

describe('worded literals in TypeScript', () => {
	it('finds sentences, and skips errors, console lines, keys and sums', () => {
		const source = `
			// A comment with words in it. Fine.
			const a = 'Go, Pip!';
			const b = \`\${x} + \${y} = ?\`;
			const c = e.key === 'Enter' ? 'battle.go' : 'choose-action';
			const d = 'Caught!';
			throw new Error(\`startBattle: the party is empty\`);
			console.warn(\`battle intent rejected: \${reason}\`);
			const e = \`Wild \${name} used it\`;
		`;
		expect(wordedLiterals('fixture.ts', source)).toEqual([
			'fixture.ts:3 Go, Pip!',
			'fixture.ts:6 Caught!',
			'fixture.ts:9 Wild x used it'
		]);
	});

	it('no module or script block holds a sentence', () => {
		const scripts = [...svelteSources].flatMap(([file, source]) =>
			[...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(
				(m) =>
					[
						file,
						source.slice(0, m.index + m[0].indexOf('>') + 1).replace(/[^\n]/g, '') + m[1]!
					] as const
			)
		);
		// The copy engine handles text by trade; its only literals are for developers.
		const modules = [...tsSources].filter(([file]) => !file.startsWith('src/copy/'));
		expect(modules.length).toBeGreaterThan(10);
		const found = [...modules, ...scripts].flatMap(([file, source]) =>
			wordedLiterals(file, source)
		);
		expect(
			found,
			'A sentence in code. Put it in src/copy/en.yaml and da.yaml, and keep what the screen says as ' +
				'a Line or a copy key (DEVELOPMENT § Copy and languages).'
		).toEqual([]);
	});
});
