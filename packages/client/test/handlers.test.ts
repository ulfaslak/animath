import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { tsSources } from './source';

/**
 * The client's handlers of the authority's events, read from the source
 * ([[AGENT_MISTAKES]] § Patterns, "A sibling missed"). Two mistakes kept coming
 * back: a screen that took the world from `welcome` and was never told of
 * `travelled` (PR #92: the battle controller kept the old world's seed, and
 * every battle after a trip drew the old world's ground), and a new event or
 * intent taught to some of its handlers and not the others.
 */

const protocol = Object.values(
	import.meta.glob('../../engine/src/protocol.ts', {
		query: '?raw',
		import: 'default',
		eager: true
	})
)[0] as string;

/** The fields of `welcome` that `travelled` changes too: a copy taken at `welcome` goes stale on a trip. */
const WORLD_FIELDS = new Set(['seed', 'spawn', 'world', 'land', 'edits']);

/**
 * Copies of the world taken at `welcome` that are right not to follow a trip,
 * each with why. Anything added here is a claim: say what makes it true.
 */
const STAYS_PUT: Record<string, string> = {
	'src/main.ts':
		"`zoo?.welcome`: a `?zoo` page's line-up is put up once for the page, by the first game's spawn (`render/zoo.ts`), and a trip does not move it"
};

function parse(path: string, text: string): ts.SourceFile {
	return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
}

/** `x.type`: the name `x`, else null. */
function typeOf(node: ts.Expression): string | null {
	return ts.isPropertyAccessExpression(node) &&
		node.name.text === 'type' &&
		ts.isIdentifier(node.expression)
		? node.expression.text
		: null;
}

function literal(node: ts.Expression | undefined): string | null {
	return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
		? node.text
		: null;
}

interface Branch {
	/** The event's name in the code (`event`, `e`). */
	name: string;
	/** The event type the branch is for. */
	type: string;
	/** What runs for it. */
	body: ts.Node[];
	line: number;
}

/** Every branch on an event's type: `case '<type>':` under `switch (x.type)`, and `if (x.type === '<type>')`. */
function branches(file: ts.SourceFile): Branch[] {
	const out: Branch[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isSwitchStatement(node)) {
			const name = typeOf(node.expression);
			if (name !== null) {
				for (const clause of node.caseBlock.clauses) {
					if (!ts.isCaseClause(clause)) continue;
					const type = literal(clause.expression);
					if (type === null) continue;
					// Fall-through: the case runs the statements of the next case that has any.
					const at = node.caseBlock.clauses.indexOf(clause);
					const body = node.caseBlock.clauses
						.slice(at)
						.find((c) => c.statements.length > 0)?.statements;
					out.push({
						name,
						type,
						body: body ? [...body] : [],
						line: file.getLineAndCharacterOfPosition(clause.getStart()).line + 1
					});
				}
			}
		}
		if (ts.isIfStatement(node)) {
			for (const test of conjuncts(node.expression)) {
				if (
					ts.isBinaryExpression(test) &&
					(test.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
						test.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken)
				) {
					const name = typeOf(test.left);
					const type = literal(test.right);
					if (name !== null && type !== null) {
						out.push({
							name,
							type,
							body: [node.thenStatement],
							line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1
						});
					}
				}
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return out;
}

/** `a && b && c` as `[a, b, c]`. */
function conjuncts(node: ts.Expression): ts.Expression[] {
	if (ts.isParenthesizedExpression(node)) return conjuncts(node.expression);
	if (
		ts.isBinaryExpression(node) &&
		node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
	) {
		return [...conjuncts(node.left), ...conjuncts(node.right)];
	}
	return [node];
}

/** The world fields a branch reads off its event: `event.seed`, and `{ seed } = event`. */
function worldReads(branch: Branch): string[] {
	const found = new Set<string>();
	const visit = (node: ts.Node): void => {
		if (
			ts.isPropertyAccessExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === branch.name &&
			WORLD_FIELDS.has(node.name.text)
		) {
			found.add(node.name.text);
		}
		if (
			ts.isVariableDeclaration(node) &&
			ts.isObjectBindingPattern(node.name) &&
			node.initializer &&
			ts.isIdentifier(node.initializer) &&
			node.initializer.text === branch.name
		) {
			for (const element of node.name.elements) {
				const key = element.propertyName ?? element.name;
				if (ts.isIdentifier(key) && WORLD_FIELDS.has(key.text)) found.add(key.text);
			}
		}
		ts.forEachChild(node, visit);
	};
	for (const node of branch.body) visit(node);
	return [...found].sort();
}

/** The `type` of each member of a union type alias in `protocol.ts`. */
function unionTypes(name: string): string[] {
	const file = parse('protocol.ts', protocol);
	const alias = file.statements.find(
		(s): s is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(s) && s.name.text === name
	);
	if (!alias) throw new Error(`no type ${name} in protocol.ts`);
	const members = ts.isUnionTypeNode(alias.type) ? alias.type.types : [alias.type];
	return members.flatMap((member) => {
		if (!ts.isTypeLiteralNode(member)) return [];
		const type = member.members.find(
			(m): m is ts.PropertySignature =>
				ts.isPropertySignature(m) && ts.isIdentifier(m.name) && m.name.text === 'type'
		)?.type;
		return type && ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)
			? [type.literal.text]
			: [];
	});
}

const files = [...tsSources].map(([path, text]) => ({
	path,
	branches: branches(parse(path, text))
}));

describe('the handlers of the authority’s events', () => {
	it('finds the branches it reads (the check is not vacuous)', () => {
		const welcomes = files.filter((f) => f.branches.some((b) => b.type === 'welcome'));
		expect(welcomes.length).toBeGreaterThanOrEqual(8);
		const copying = files.filter((f) =>
			f.branches.some((b) => b.type === 'welcome' && worldReads(b).length > 0)
		);
		// The battle controller, explore, the game's view, travel, presence, the plane, the zoo's line-up…
		expect(copying.map((f) => f.path)).toEqual(
			expect.arrayContaining([
				'src/battle/controller.ts',
				'src/explore/controller.ts',
				'src/state/game.svelte.ts',
				'src/main.ts'
			])
		);
	});

	it('a handler that takes the world from `welcome` hears `travelled` too', () => {
		const missing: string[] = [];
		for (const { path, branches: all } of files) {
			if (all.some((b) => b.type === 'travelled')) continue;
			if (path in STAYS_PUT) continue;
			for (const b of all) {
				const reads = b.type === 'welcome' ? worldReads(b) : [];
				if (reads.length > 0) {
					missing.push(`${path}:${b.line} reads ${reads.map((f) => `${b.name}.${f}`).join(', ')}`);
				}
			}
		}
		expect(
			missing,
			'a trip changes these too: handle `travelled` beside `welcome`, or say in STAYS_PUT why the copy is right to stay'
		).toEqual([]);
	});

	it('STAYS_PUT names only files that copy the world at `welcome` and never hear `travelled`', () => {
		for (const path of Object.keys(STAYS_PUT)) {
			const file = files.find((f) => f.path === path);
			expect(file, path).toBeDefined();
			expect(
				file!.branches.some((b) => b.type === 'travelled'),
				path
			).toBe(false);
			expect(
				file!.branches.some((b) => b.type === 'welcome' && worldReads(b).length > 0),
				path
			).toBe(true);
		}
	});

	/**
	 * Every event the protocol has, pinned. A new one fails here on
	 * purpose, with the list of every file that branches on an event's or an
	 * intent's type: decide in each whether it must handle the new one, then
	 * add it to the list. A `never` default (the autosave's, the presence
	 * controller's) makes the compiler ask instead.
	 */
	const EVENTS = [
		'welcome',
		'game-left',
		'new-game-refused',
		'player-moved',
		'player-blocked',
		'player-placed',
		'go-to-refused',
		'battle-started',
		'battle-updated',
		'battle-ended',
		'party-changed',
		'party-edited',
		'belongings-changed',
		'solved-changed',
		'book-changed',
		'unlocked-changed',
		'doctor-visit-started',
		'doctor-visit-updated',
		'doctor-visit-ended',
		'tile-cleared',
		'tool-needed',
		'nothing-to-interact',
		'message',
		'name-chosen',
		'name-refused',
		'travelled',
		'travel-refused',
		'took-off',
		'take-off-refused',
		'glided',
		'bird-follows',
		'landed',
		'line-cast',
		'starter-wanted',
		'starter-refused'
	];

	it('the protocol’s events are the ones every handler was checked against', () => {
		const handlers = files
			.filter((f) => f.branches.some((b) => EVENTS.includes(b.type)))
			.map((f) => f.path);
		const now = unionTypes('GameEvent');
		const added = now.filter((t) => !EVENTS.includes(t));
		const gone = EVENTS.filter((t) => !now.includes(t));
		expect(
			{ added, gone },
			`an event came or went: check each of these, then update EVENTS:\n  ${handlers.join('\n  ')}`
		).toEqual({ added: [], gone: [] });
	});
});
