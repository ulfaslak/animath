import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { svelteSources, tsSources } from './source';

/**
 * The client's handlers of the authority's events, read from the source
 * ([[AGENT_MISTAKES]] § Patterns, "A sibling missed"). Two mistakes kept coming
 * back: a screen that took the world from `welcome` and was never told of
 * `travelled` (PR #92: the battle controller kept the old world's seed, and
 * every battle after a trip drew the old world's ground), and a new event
 * taught to some of its handlers and not the others.
 */

const protocol = Object.values(
	import.meta.glob('../../engine/src/protocol.ts', {
		query: '?raw',
		import: 'default',
		eager: true
	})
)[0] as string;

/** What `welcome` and `travelled` both carry about where the player is: a copy taken at `welcome` goes stale on a trip. */
const WORLD_FIELDS = ['seed', 'world', 'land', 'edits', 'pos', 'facing'];
/** The game's own view (`state/game.svelte.ts`), which takes every event first: a copy of it at `welcome` is a copy of the event. */
const VIEWS = new Set(['game']);

/**
 * Copies of the world taken at `welcome` that are right not to follow a trip:
 * the file, the start of the call that takes them, and why. Anything added here
 * is a claim: say what makes it true.
 */
const STAYS_PUT: { file: string; call: string; why: string }[] = [
	{
		file: 'src/main.ts',
		call: 'zoo?.welcome(',
		why: "a `?zoo` page's line-up is put up once for the page, by the first game's spawn (`render/zoo.ts`), and a trip does not move it"
	}
];

/** `x.type` or `a.b.type`: the text of what holds the type, else null. */
function holderOf(node: ts.Expression): string | null {
	if (!ts.isPropertyAccessExpression(node) || node.name.text !== 'type') return null;
	const e = node.expression;
	return ts.isIdentifier(e) || ts.isPropertyAccessExpression(e) ? e.getText() : null;
}

function literal(node: ts.Expression | undefined): string | null {
	return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
		? node.text
		: null;
}

interface Branch {
	/** What holds the event in the code (`event`, `e`, `msg.event`). */
	holder: string;
	/** The event type the branch is for. */
	type: string;
	/** What runs for it. */
	body: ts.Node[];
	line: number;
}

/** `a && b` as `[a, b]`, and `a || b` as `[a, b]` too: each side names a type the branch runs for. */
function operands(node: ts.Expression): ts.Expression[] {
	if (ts.isParenthesizedExpression(node)) return operands(node.expression);
	if (
		ts.isBinaryExpression(node) &&
		(node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
			node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
	) {
		return [...operands(node.left), ...operands(node.right)];
	}
	return [node];
}

/** `x.type === 'a'` (or `!==`, `==`, `!=`): the holder, the type and whether it is an equality. */
function comparison(node: ts.Expression): { holder: string; type: string; equal: boolean } | null {
	if (!ts.isBinaryExpression(node)) return null;
	const k = node.operatorToken.kind;
	const equal =
		k === ts.SyntaxKind.EqualsEqualsEqualsToken || k === ts.SyntaxKind.EqualsEqualsToken;
	const unequal =
		k === ts.SyntaxKind.ExclamationEqualsEqualsToken || k === ts.SyntaxKind.ExclamationEqualsToken;
	if (!equal && !unequal) return null;
	const holder = holderOf(node.left);
	const type = literal(node.right);
	return holder !== null && type !== null ? { holder, type, equal } : null;
}

/** Does a statement always leave its block (`return`, `break`, `continue`, `throw`)? */
function leaves(node: ts.Statement): boolean {
	if (
		ts.isReturnStatement(node) ||
		ts.isBreakStatement(node) ||
		ts.isContinueStatement(node) ||
		ts.isThrowStatement(node)
	)
		return true;
	return (
		ts.isBlock(node) &&
		node.statements.length > 0 &&
		leaves(node.statements[node.statements.length - 1]!)
	);
}

/**
 * Every branch on an event's type: `case '<type>':` under `switch (x.type)`;
 * `if (x.type === '<type>' …)`, either side of `&&` or `||`; and
 * `if (x.type !== '<type>') return;`, whose branch is the rest of its block.
 */
function branches(file: ts.SourceFile): Branch[] {
	const out: Branch[] = [];
	const line = (n: ts.Node) => file.getLineAndCharacterOfPosition(n.getStart()).line + 1;
	const visit = (node: ts.Node): void => {
		if (ts.isSwitchStatement(node)) {
			const holder = holderOf(node.expression);
			if (holder !== null) {
				const clauses = node.caseBlock.clauses;
				clauses.forEach((clause, at) => {
					if (!ts.isCaseClause(clause)) return;
					const type = literal(clause.expression);
					if (type === null) return;
					// Fall-through: the case runs the statements of the next case that has any.
					const body = clauses.slice(at).find((c) => c.statements.length > 0)?.statements;
					out.push({ holder, type, body: body ? [...body] : [], line: line(clause) });
				});
			}
		}
		if (ts.isIfStatement(node)) {
			for (const test of operands(node.expression)) {
				const c = comparison(test);
				if (c?.equal)
					out.push({
						holder: c.holder,
						type: c.type,
						body: [node.thenStatement],
						line: line(node)
					});
			}
			const only = comparison(node.expression);
			const block = node.parent;
			if (
				only &&
				!only.equal &&
				!node.elseStatement &&
				leaves(node.thenStatement) &&
				(ts.isBlock(block) || ts.isSourceFile(block))
			) {
				const rest = block.statements.slice(block.statements.indexOf(node) + 1);
				out.push({ holder: only.holder, type: only.type, body: [...rest], line: line(node) });
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return out;
}

/** The world fields a branch reads off its event (or the game's view): `'*'` when it hands the event on whole. */
function worldReads(branch: Branch, path: string): { fields: Set<string>; exempt: boolean } {
	const sources = new Set([branch.holder, ...VIEWS]);
	const fields = new Set<string>();
	const stays = STAYS_PUT.filter((s) => s.file === path).map((s) => s.call);
	const exempted = (node: ts.Node): boolean => {
		for (let p: ts.Node | undefined = node; p; p = p.parent) {
			if (ts.isCallExpression(p) && stays.some((c) => p.getText().startsWith(c))) return true;
		}
		return false;
	};
	let exempt = false;
	const take = (field: string, node: ts.Node) => {
		if (exempted(node)) exempt = true;
		else fields.add(field);
	};
	const visit = (node: ts.Node): void => {
		// An alias, `const w = event`, or a destructuring, `const { seed } = event`.
		if (
			ts.isVariableDeclaration(node) &&
			node.initializer &&
			sources.has(node.initializer.getText())
		) {
			if (ts.isIdentifier(node.name)) sources.add(node.name.text);
			else if (ts.isObjectBindingPattern(node.name)) {
				for (const el of node.name.elements) {
					const key = el.propertyName ?? el.name;
					if (ts.isIdentifier(key) && WORLD_FIELDS.includes(key.text)) take(key.text, el);
				}
			}
		}
		// `x.seed`, `msg.event.pos`, `game.seed`.
		if (
			ts.isPropertyAccessExpression(node) &&
			sources.has(node.expression.getText()) &&
			WORLD_FIELDS.includes(node.name.text)
		) {
			take(node.name.text, node);
		}
		// `({ seed: this.seed } = event)`.
		if (
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
			ts.isObjectLiteralExpression(node.left) &&
			sources.has(node.right.getText())
		) {
			for (const p of node.left.properties) {
				const key =
					ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) ? p.name.getText() : '';
				if (WORLD_FIELDS.includes(key)) take(key, p);
			}
		}
		// The event handed on whole: whatever takes it may copy any of it.
		if (ts.isCallExpression(node) && node.arguments.some((a) => a.getText() === branch.holder))
			take('*', node);
		ts.forEachChild(node, visit);
	};
	for (const node of branch.body) visit(node);
	return { fields, exempt };
}

/** The `type` of each member of a union type alias in `protocol.ts`. */
function unionTypes(name: string): string[] {
	const file = ts.createSourceFile('protocol.ts', protocol, ts.ScriptTarget.Latest, true);
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

/** A component's `<script>`s, as TypeScript. */
function scriptsOf(svelte: string): string {
	return [...svelte.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
}

const sources: [string, string][] = [
	...tsSources,
	...[...svelteSources].map(([path, text]): [string, string] => [path, scriptsOf(text)])
];
const files = sources.map(([path, text]) => ({
	path,
	branches: branches(ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true))
}));

/** What a file reads of the world at one event type, over all its branches for it. */
function readsOf(path: string, all: Branch[], type: string) {
	const fields = new Set<string>();
	let exempt = false;
	for (const b of all.filter((b) => b.type === type)) {
		const r = worldReads(b, path);
		r.fields.forEach((f) => fields.add(f));
		exempt ||= r.exempt;
	}
	return { fields, exempt };
}

describe('the handlers of the authority’s events', () => {
	it('finds the branches it reads (the check is not vacuous)', () => {
		const copying = files
			.filter((f) => readsOf(f.path, f.branches, 'welcome').fields.size > 0)
			.map((f) => f.path);
		expect(copying).toEqual(
			expect.arrayContaining([
				'src/battle/controller.ts',
				'src/explore/controller.ts',
				'src/state/game.svelte.ts',
				'src/presence/controller.ts'
			])
		);
	});

	it('what a handler takes of the world at `welcome`, it takes again at `travelled`', () => {
		const missing: string[] = [];
		for (const { path, branches: all } of files) {
			const welcome = readsOf(path, all, 'welcome').fields;
			if (welcome.size === 0) continue;
			const travelled = readsOf(path, all, 'travelled').fields;
			if (travelled.has('*')) continue;
			const stale = [...welcome].filter(
				(f) => !travelled.has(f) && (f !== '*' || travelled.size === 0)
			);
			if (stale.length > 0) {
				const at = all.find((b) => b.type === 'welcome')!.line;
				missing.push(`${path}:${at} takes ${stale.join(', ')} at welcome, not at travelled`);
			}
		}
		expect(
			missing,
			'a trip changes these too: take them again at `travelled`, or say in STAYS_PUT why the copy is right to stay'
		).toEqual([]);
	});

	it('every STAYS_PUT entry still names a copy taken at `welcome`', () => {
		for (const s of STAYS_PUT) {
			const file = files.find((f) => f.path === s.file);
			expect(file, s.file).toBeDefined();
			expect(readsOf(s.file, file!.branches, 'welcome').exempt, `${s.file}: ${s.call}`).toBe(true);
		}
	});

	/**
	 * Every event the protocol has, pinned. A new one fails here on purpose,
	 * with the list of every file that branches on an event's type: decide in
	 * each whether it must handle the new one, then add it to the list. A
	 * `never` default (the autosave's, the presence controller's) makes the
	 * compiler ask instead.
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
		'puzzles-changed',
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
