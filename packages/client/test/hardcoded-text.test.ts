import { describe, expect, it } from 'vitest';
import baselineFile from './hardcoded-text.baseline.yaml';
import { lineOf, parseSvelte, printedStrings, svelteSources, type AstNode } from './source';

/**
 * No player-facing words are written straight into a Svelte template: they
 * live in `src/copy/<language>.yaml` and are shown with `t()`, so the
 * Language setting reaches them (DECISIONS § Copy and languages). Text that
 * predates the copy files is listed in `hardcoded-text.baseline.yaml` until
 * the extraction empties it. Script blocks and `.ts` files are not checked
 * here: a word in a variable is out of this test's reach.
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
export function hardcodedText(file: string, source: string): Offender[] {
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

/** The baseline as `file → texts`, one entry per occurrence. */
function readBaseline(data: unknown): Map<string, string[]> {
	const entries = Object.entries((data ?? {}) as Record<string, unknown>);
	return new Map(
		entries.map(([file, texts]) => [file, Array.isArray(texts) ? texts.map(String) : []])
	);
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

	it('every template shows its words through t(), apart from the baseline', () => {
		const baseline = readBaseline(baselineFile);
		const left = new Map([...baseline].map(([file, texts]) => [file, [...texts]]));
		const added: Offender[] = [];
		for (const [file, source] of svelteSources) {
			for (const offender of hardcodedText(file, source)) {
				const allowed = left.get(file);
				const i = allowed?.indexOf(offender.text) ?? -1;
				if (i >= 0) allowed!.splice(i, 1);
				else added.push(offender);
			}
		}
		const stale = [...left].flatMap(([file, texts]) => texts.map((text) => `${file}: ${text}`));

		expect(svelteSources.size).toBeGreaterThan(3);
		// Soft, so a reworded line reports both halves at once: the new words and the stale entry.
		expect
			.soft(
				added.map((o) => `${o.file}:${o.line} ${JSON.stringify(o.text)}`),
				'Words written straight into a template. Put them in src/copy/en.yaml and da.yaml and show them ' +
					"with t('group.key') (DEVELOPMENT § Copy and languages). Until the copy extraction lands, words " +
					'in a file you are changing anyway may instead be listed in test/hardcoded-text.baseline.yaml.'
			)
			.toEqual([]);
		expect
			.soft(
				stale,
				'These baseline entries are no longer in their template (moved to the copy files, or reworded): ' +
					'delete them from test/hardcoded-text.baseline.yaml.'
			)
			.toEqual([]);
	});
});
