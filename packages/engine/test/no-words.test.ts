import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The engine holds no player-facing words ([[DECISIONS]] § Copy and
 * languages): names, lines and refusals are ids and codes, and the client
 * picks the words from its copy files. This reads every source file with
 * TypeScript's parser — comments are not literals, so prose never counts —
 * and fails on a string literal that reads as words: a letter, a space and a
 * letter, or two letters in a row and a closing `.`, `!`, `?` or `…`. In a
 * template literal each `${…}` counts as a one-letter word, so a sentence
 * around a name is caught and a sum like `${a} × ${b} = ?` is not. A message
 * thrown with `new Error(…)` is for developers and is allowed.
 */
function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const p = join(dir, name);
		return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
	});
}

const WORDED = (text: string) => /\p{L}\s+\p{L}/u.test(text) || /\p{L}{2}.*[.!?…]$/u.test(text);

/** Worded literals in one file, as `line: text`. */
export function wordedLiterals(file: string, source: string): string[] {
	const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
	const found: string[] = [];
	const insideError = (node: ts.Node): boolean => {
		for (let p = node.parent; p; p = p.parent) {
			if (ts.isNewExpression(p) && p.expression.getText(sf) === 'Error') return true;
		}
		return false;
	};
	const visit = (node: ts.Node): void => {
		let text: string | null = null;
		if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
		if (ts.isTemplateExpression(node)) {
			text = node.head.text + node.templateSpans.map((s) => 'x' + s.literal.text).join('');
		}
		if (text !== null && WORDED(text.trim()) && !insideError(node)) {
			const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
			found.push(`${line}: ${text.trim()}`);
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);
	return found;
}

const root = join(import.meta.dirname, '..', 'src');
const files = walk(root);

describe('the engine holds no words', () => {
	it('finds worded literals, and skips errors, prompts and comments', () => {
		const source = `
			// A comment with words in it. Fine.
			const a = 'Go, Pip!';
			const b = \`\${x} + \${y} = ?\`;
			const c = 'choose-action';
			const d = 'Caught!';
			throw new Error(\`startBattle: the party is empty\`);
			const e = \`Wild \${name} used it\`;
		`;
		expect(wordedLiterals('fixture.ts', source)).toEqual([
			'3: Go, Pip!',
			'6: Caught!',
			'8: Wild x used it'
		]);
	});

	it('has source files', () => expect(files.length).toBeGreaterThan(10));

	for (const file of files) {
		const rel = file.slice(root.length + 1);
		it(`${rel} has no worded string literals`, () => {
			expect(wordedLiterals(rel, readFileSync(file, 'utf8'))).toEqual([]);
		});
	}
});
