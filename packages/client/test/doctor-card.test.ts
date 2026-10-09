import { describe, expect, it } from 'vitest';
import { parseSvelte, svelteSources, walk, type AstNode } from './source';

/**
 * The druid's card, read from its template (`DoctorCard.svelte`): on
 * Set free and on the Shop, the right-hand side's title is the tab's own
 * line, never another tab's. The Shop once said the Heal tab's "Pick an
 * animal" while Bye was lit, where a kid can only buy tools (#163).
 */

const source = svelteSources.get('src/ui/DoctorCard.svelte') ?? '';
const template = parseSvelte(source);

/** The copy keys the right-hand side's titles (`class="soft"`) print while `doctor.tab` is `tab`. */
function titles(tab: string): string[] {
	const keys: string[] = [];
	for (const block of walk(template)) {
		const test = block.test as AstNode | undefined;
		if (block.type !== 'IfBlock' || !test) continue;
		if (source.slice(test.start, test.end as number) !== `doctor.tab === '${tab}'`) continue;
		for (const element of walk(block.consequent)) {
			if (element.type !== 'RegularElement' || !isTitle(element)) continue;
			for (const call of walk(element)) {
				const callee = call.callee as AstNode | undefined;
				const [key] = (call.arguments ?? []) as AstNode[];
				if (call.type !== 'CallExpression' || callee?.name !== 't') continue;
				keys.push(key?.type === 'Literal' ? String(key.value) : '(a key worked out as it runs)');
			}
		}
	}
	return keys;
}

function isTitle(element: AstNode): boolean {
	return (element.attributes as AstNode[]).some(
		(a) =>
			a.type === 'Attribute' &&
			a.name === 'class' &&
			Array.isArray(a.value) &&
			(a.value as AstNode[]).some(
				(v) => v.type === 'Text' && String(v.data).split(' ').includes('soft')
			)
	);
}

describe("the druid's card", () => {
	it('titles Set free and the Shop with their own lines', () => {
		for (const tab of ['home', 'shop']) {
			const keys = titles(tab);
			expect(keys.length, `the ${tab} tab's titles`).toBeGreaterThan(0);
			expect(keys.filter((key) => !key.startsWith(`doctor.${tab}.`))).toEqual([]);
		}
	});
});
