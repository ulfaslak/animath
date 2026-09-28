import {
	PROTOCOL_VERSION,
	applyMatchIntent,
	getAnimal,
	matchView,
	newGame,
	spawnPoint,
	startMatch,
	worldSeed,
	type AnimalInstance,
	type ClientMessage,
	type HiMessage,
	type MatchIntent,
	type MatchMessage,
	type MatchSide,
	type MatchState,
	type PeerMessage,
	type SavedGame,
	type WireAnimal,
	type WireMatchEvent
} from '@mathgame/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalAuthority } from '../src/authority/local';
import { PICK_QUIET_SECONDS } from '../src/input/pick-guard';
import { optionKey } from '../src/input/press';
import { words } from '../src/lines';
import { MatchController, wentBackKey } from '../src/match/controller';
import type { GameRenderer } from '../src/render/renderer';
import type { KeyValueStore } from '../src/save/storage';
import { battle } from '../src/state/battle.svelte';
import { game } from '../src/state/game.svelte';
import { hud } from '../src/state/hud.svelte';
import { match } from '../src/state/match.svelte';

/**
 * Friendly matches on the page, driven by keys against the real authority
 * (the player's own game) and a stand-in for the server that runs the
 * engine's real match reducer: the Challenge button and who it asks, the
 * invite and its quiet moment, a whole match played back beat by beat, the
 * other's turn with their puzzle and no answer, the result, the rematch, the
 * update card, and the one thing a match may change in the game: the count
 * of puzzles solved.
 */

let now = 0;

function key(name: string, repeat = false): KeyboardEvent {
	return {
		key: name,
		repeat,
		timeStamp: now * 1000,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		preventDefault() {}
	} as unknown as KeyboardEvent;
}

const SPAWN = spawnPoint(worldSeed(1));
const PARTY: AnimalInstance[] = [
	{ id: 'starter', speciesId: 'squirrel', nickname: 'Nini', hp: 20 },
	{ id: 'r1', speciesId: 'rabbit', hp: 3 },
	{ id: 'c1', speciesId: 'crab', hp: 10 },
	{ id: 'f1', speciesId: 'frog', hp: 0 }
];

/** A player's public id, as the server makes one: 12 characters. */
function pidOf(name: string): string {
	return `pid${name}`.padEnd(12, '0');
}

/** The server's hi to this page (Ada), with the match it knows her in. */
function hi(match: string | null) {
	return { t: 'hi', v: PROTOCOL_VERSION, pid: pidOf('Ada'), name: 'Ada', match } as const;
}

/** What the message line says now, as the HUD shows it. */
function said(): string {
	hud.tick(0);
	return hud.message;
}

function peer(name: string, dx: number, dy = 0, patch: Partial<PeerMessage> = {}): PeerMessage {
	return {
		t: 'peer',
		pid: pidOf(name),
		name,
		x: SPAWN.x + dx,
		y: SPAWN.y + dy,
		facing: 'down',
		lead: 'fox',
		boat: false,
		busy: 'explore',
		...patch
	};
}

/**
 * The server's part, for one match: the engine's real reducer, side `a` the
 * page under test (Ada, who asked), side `b` Bo, whose choices the test makes.
 */
class Referee {
	state: MatchState;
	readonly id: string;
	constructor(
		a: readonly WireAnimal[],
		b: readonly AnimalInstance[],
		readonly seed: number,
		n = 1
	) {
		this.id = `match0000${n}`;
		this.state = startMatch({ a, b }, seed);
	}
	message(side: MatchSide, events: WireMatchEvent[] = []): MatchMessage {
		return {
			t: 'match',
			id: this.id,
			pids: { a: pidOf('Ada'), b: pidOf('Bo') },
			names: { a: 'Ada', b: 'Bo' },
			view: matchView(this.state, side),
			events,
			away: null,
			timeout: null
		};
	}
	apply(side: MatchSide, intent: MatchIntent): WireMatchEvent[] {
		const step = applyMatchIntent(this.state, side, intent, this.seed);
		this.state = step.state;
		return step.events.filter((e): e is WireMatchEvent => e.type !== 'rejected');
	}
	/** The open puzzle's answer: the server's to know, never the page's. */
	answer(): string {
		const phase = this.state.phase;
		if (phase.kind !== 'solving') throw new Error('no puzzle');
		return String(phase.puzzle.answer);
	}
}

let stop: (() => void) | undefined;
afterEach(() => {
	stop?.();
	battle.reset();
	match.reset();
});

/** The browser's localStorage, in memory: every tab of it, and every load. Full, it writes nothing. */
function memoryStore(): KeyValueStore & { map: Map<string, string>; full: boolean } {
	const map = new Map<string, string>();
	const store = {
		map,
		full: false,
		get: (k: string) => map.get(k) ?? null,
		set: (k: string, v: string) => !store.full && (map.set(k, v), true),
		remove: (k: string) => void map.delete(k)
	};
	return store;
}

/**
 * This page (Ada's) with its game under way, the socket on. `store` is the
 * browser's localStorage, and the server's first hi is `hi`, naming no match
 * unless it says otherwise.
 */
function setup(
	party: AnimalInstance[] = PARTY,
	{ store = null, first = hi(null) }: { store?: KeyValueStore | null; first?: HiMessage } = {}
) {
	const authority = new LocalAuthority();
	const sent: ClientMessage[] = [];
	let online = true;
	const shown: unknown[] = [];
	const renderer = {
		setBattle: (scene: unknown) => shown.push(scene),
		playerScreenPoint: () => ({ x: 640, y: 380 })
	} as unknown as GameRenderer;
	let counted = 0;
	const controller = new MatchController({
		send: (m) => {
			if (!online) return false;
			sent.push(m);
			return true;
		},
		renderer,
		clock: () => now,
		count: (events, side) => {
			counted += events.filter(
				(e) => e.type === 'answer-judged' && e.correct && e.side === side
			).length;
			authority.countMatchAnswers(events, side);
		},
		store
	});
	authority.subscribe((e) => {
		game.apply(e);
		controller.handle(e);
	});
	// The book this party makes: its kinds caught (the authority records them as it starts).
	const saved: SavedGame = {
		...newGame(1, undefined, 'Ada'),
		party: party.map((a) => ({ ...a })),
		seen: [],
		caught: []
	};
	authority.start({ game: saved });
	stop = () => authority.dispatch({ type: 'leave-game' });
	controller.status('on');
	controller.receive(first);
	const frame = (dt = 1 / 30) => {
		now += dt;
		controller.update(dt);
	};
	const run = (seconds: number) => {
		for (let t = 0; t < seconds; t += 1 / 30) frame();
	};
	const runUntil = (done: () => boolean, max = 30) => {
		for (let t = 0; !done(); t += 1 / 30) {
			if (t > max) throw new Error(`timed out on ${battle.screen}, ${match.stage}`);
			frame();
		}
	};
	/** Keys on the explore screen (the invite, C), as main.ts hands them first to the match. */
	const exploreKey = (...names: string[]) => names.map((n) => controller.exploreKey(key(n)));
	/** Keys while the match has the screen, a quiet moment before each pick. */
	const press = (...names: string[]) => {
		for (const n of names) {
			controller.onKey(key(n));
			frame();
		}
	};
	const pick = (...names: string[]) => {
		for (const n of names) {
			run(PICK_QUIET_SECONDS + 0.1);
			controller.onKey(key(n));
			frame();
		}
	};
	const sentOf = <T extends ClientMessage['t']>(t: T) =>
		sent.filter((m): m is Extract<ClientMessage, { t: T }> => m.t === t);
	return {
		authority,
		controller,
		sent,
		sentOf,
		frame,
		run,
		runUntil,
		exploreKey,
		press,
		pick,
		counted: () => counted,
		setOnline: (on: boolean) => (online = on),
		shown
	};
}

/** Ada (this page) asked Bo and he said yes: the match starts, and its opening lines play. */
function started(t: ReturnType<typeof setup>, seed = 5) {
	const bo: AnimalInstance[] = [
		{ id: 'starter', speciesId: 'squirrel', hp: 20 },
		{ id: 'b2', speciesId: 'frog', nickname: 'Hoppy', hp: 1 }
	];
	t.controller.peer(peer('Bo', 1));
	t.frame();
	t.exploreKey('c');
	const challenge = t.sentOf('challenge').at(-1)!;
	const ref = new Referee(challenge.team, bo, seed);
	t.controller.receive(ref.message('a'));
	t.runUntil(() => battle.screen !== 'busy');
	return ref;
}

/**
 * The match played to its end, Bo's animals on 1 HP, Ada right every time and
 * Bo never: Ada wins, and her page shows the result, Rematch? still to be had.
 */
function playedOut(t: ReturnType<typeof setup>, ref: Referee): void {
	ref.state = {
		...ref.state,
		teams: { a: ref.state.teams.a, b: ref.state.teams.b.map((a) => ({ ...a, hp: 1 })) }
	};
	for (let turns = 0; ref.state.phase.kind !== 'ended'; turns++) {
		if (turns > 40) throw new Error('never ended');
		const phase = ref.state.phase;
		const intent: MatchIntent =
			phase.kind === 'choose-animal'
				? { type: 'pick-next', teamIndex: 1 }
				: phase.kind === 'choose-action'
					? { type: 'attack', attackIndex: 1, level: 1 }
					: { type: 'answer', input: phase.side === 'a' ? ref.answer() : '-1' };
		t.controller.receive(ref.message('a', ref.apply(phase.side, intent)));
	}
	t.runUntil(() => battle.screen === 'result');
	expect(match.result).toMatchObject({ won: true, reason: 'all-tired' });
}

beforeEach(() => {
	now = 1000;
});

describe('the Challenge button', () => {
	it('asks the nearest player within two tiles, and only them', () => {
		const t = setup();
		t.controller.peer(peer('Far', 3));
		t.frame();
		expect(match.button).toBeNull();
		t.controller.peer(peer('Bo', 2, 2));
		t.controller.peer(peer('Cy', 1));
		t.frame();
		expect(match.button).toEqual({ pid: pidOf('Cy'), name: 'Cy', refusal: null });
		t.exploreKey('c');
		expect(t.sentOf('challenge')).toEqual([
			{
				t: 'challenge',
				pid: pidOf('Cy'),
				// The team a match brings: the first three that fight on land, tired ones too.
				team: [
					{ id: 'starter', speciesId: 'squirrel', nickname: 'Nini' },
					{ id: 'r1', speciesId: 'rabbit' },
					{ id: 'f1', speciesId: 'frog' }
				]
			}
		]);
		expect(match.stage).toBe('asking');
		// Walking waits: the match has the keys, and the button is gone.
		expect(t.controller.onScreen).toBe(true);
		t.frame();
		expect(match.button).toBeNull();
		t.controller.onKey(key('Escape'));
		expect(t.sentOf('withdraw')).toHaveLength(1);
		expect(match.stage).toBe('none');
	});

	it('is not there up in the air: C asks nobody while the player glides', () => {
		const t = setup();
		// Ada owns the glider, and takes off from the start, down over the meadow.
		(t.authority as unknown as { items: string[] }).items = ['glider'];
		t.authority.dispatch({ type: 'take-off' });
		expect(game.flying).toBe(true);
		t.controller.peer(peer('Cy', 1));
		t.frame();
		expect(match.button).toBeNull();
		t.exploreKey('c');
		expect(t.sentOf('challenge')).toEqual([]);
		// Down again, Cy can be asked.
		t.authority.dispatch({ type: 'land' });
		t.frame();
		expect(match.button?.name).toBe('Cy');
	});

	it('greys with why: they are busy or on the water, or said no a moment ago', () => {
		const t = setup();
		t.controller.peer(peer('Bo', 1, 0, { busy: 'battle' }));
		t.frame();
		expect(match.button?.refusal).toBe('they-busy');
		t.exploreKey('c');
		expect(t.sentOf('challenge')).toEqual([]);
		t.controller.peer(peer('Bo', 1));
		t.frame();
		t.exploreKey('c');
		t.controller.receive({ t: 'uninvite', pid: pidOf('Bo'), reason: 'no' });
		expect(said()).toBe('Bo said no this time.');
		t.frame();
		expect(match.button?.refusal).toBe('wait');
		t.run(30);
		expect(match.button?.refusal).toBeNull();
	});

	it('greys for a player with no animal that can fight on land', () => {
		const t = setup([{ id: 'c1', speciesId: 'crab', hp: 10 }]);
		t.controller.peer(peer('Bo', 1));
		t.frame();
		expect(match.button?.refusal).toBe('no-team');
	});
});

describe('the invite', () => {
	it('takes Yes only after a quiet moment, never from a mash, and says No at once', () => {
		const t = setup();
		t.controller.receive({ t: 'invite', pid: pidOf('Bo'), name: 'Bo', ms: 20_000 });
		expect(match.stage).toBe('invited');
		// Walking goes on: the invite does not take the screen.
		expect(t.controller.onScreen).toBe(false);
		for (let i = 0; i < 8; i++) {
			expect(t.exploreKey('Enter')).toEqual([true]);
			t.run(0.3);
		}
		expect(t.sentOf('accept')).toEqual([]);
		t.run(PICK_QUIET_SECONDS + 0.1);
		t.exploreKey('Enter');
		expect(t.sentOf('accept')).toHaveLength(1);
		expect(match.stage).toBe('starting');

		const u = setup();
		u.controller.receive({ t: 'invite', pid: pidOf('Bo'), name: 'Bo', ms: 20_000 });
		u.exploreKey('Escape');
		expect(u.sentOf('decline')).toEqual([{ t: 'decline', pid: pidOf('Bo') }]);
		expect(match.stage).toBe('none');
	});

	it('shows the time left, and lets go when nobody says anything', () => {
		const t = setup();
		t.controller.receive({ t: 'invite', pid: pidOf('Bo'), name: 'Bo', ms: 20_000 });
		t.run(5);
		expect(match.left).toBeCloseTo(15, 0);
		t.controller.receive({ t: 'uninvite', pid: pidOf('Bo'), reason: 'withdrawn' });
		expect(match.stage).toBe('none');
		expect(said()).toBe('Bo changed their mind.');
	});
});

describe('a match', () => {
	it('plays to the end, beat by beat, and changes nothing in the game but the puzzles solved', () => {
		const t = setup();
		const before = t.authority.snapshot();
		const ref = started(t);
		expect(t.controller.busy).toBe(true);
		expect(battle.vs).toEqual({ name: 'Bo', me: 'Ada' });
		const said: string[] = [];
		let mine = 0;
		for (let turns = 0; ref.state.phase.kind !== 'ended'; turns++) {
			if (turns > 200) throw new Error('never ended');
			const phase = ref.state.phase;
			if (phase.side === 'a') {
				// This page's turn: keys, then the server's answer, then its beats.
				if (phase.kind === 'choose-animal') {
					expect(battle.screen).toBe('party');
					t.pick('Enter');
				} else if (phase.kind === 'choose-action') {
					expect(battle.screen).toBe('actions');
					t.pick('3');
				} else {
					expect(battle.screen).toBe('puzzle');
					const right = mine++ % 3 !== 2;
					const answer = right ? ref.answer() : `${ref.answer()}1`;
					t.press(...answer, 'Enter');
				}
				const sent = t.sent.at(-1)!;
				if (sent.t !== 'play') throw new Error(`sent ${sent.t}`);
				t.controller.receive(ref.message('a', ref.apply('a', sent.intent)));
			} else {
				// Bo's turn: this page watches.
				if (phase.kind === 'solving') {
					expect(battle.screen).toBe('waiting');
					expect(Object.keys(battle.puzzle!).sort()).toEqual(['difficulty', 'kind', 'prompt']);
					// Keys wait while the other thinks: nothing is sent.
					const count = t.sent.length;
					t.press('1', 'Enter');
					expect(t.sent.length).toBe(count);
				}
				const intent: MatchIntent =
					phase.kind === 'choose-animal'
						? { type: 'pick-next', teamIndex: 1 }
						: phase.kind === 'choose-action'
							? { type: 'attack', attackIndex: 1, level: 1 }
							: { type: 'answer', input: ref.answer() };
				t.controller.receive(ref.message('a', ref.apply('b', intent)));
			}
			t.runUntil(() => battle.screen !== 'busy');
			if (battle.line) said.push(words(battle.line));
		}
		expect(battle.screen).toBe('result');
		expect(match.stage).toBe('over');
		expect(match.result?.reason).toBe('all-tired');
		// The other's animal goes by its owner's name, and whose turn it is is said.
		expect(said.join('\n')).toMatch(/Bo's (Squirrel|Hoppy)/);
		expect(said).toContain('Bo is thinking…');
		// Only the puzzles solved changed, by this page's own right answers.
		const after = t.authority.snapshot();
		expect(t.counted()).toBeGreaterThan(0);
		expect(after.solved).toBe(before.solved + t.counted());
		expect({ ...after, solved: before.solved }).toStrictEqual(before);
		// Back to exploring: the screen goes, and the others see the player exploring again.
		t.pick('ArrowRight', 'Enter');
		expect(match.stage).toBe('none');
		expect(battle.active).toBe(false);
		expect(t.controller.busy).toBe(false);
	});

	it("leaves the animal book alone: the other's animals out in front are not the kid's to keep", () => {
		// A kid with only a rabbit, against Bo's squirrel and frog: kinds their book has never had.
		const t = setup([{ id: 'r1', speciesId: 'rabbit', hp: 22 }]);
		const before = t.authority.snapshot();
		expect([before.seen, before.caught]).toEqual([['rabbit'], ['rabbit']]);
		const ref = started(t);
		// This page's turn first, if the coin says so: a wrong answer passes the turn.
		if (ref.state.phase.kind === 'choose-action' && ref.state.phase.side === 'a') {
			t.controller.receive(
				ref.message('a', ref.apply('a', { type: 'attack', attackIndex: 1, level: 1 }))
			);
			t.controller.receive(
				ref.message('a', ref.apply('a', { type: 'answer', input: `${ref.answer()}1` }))
			);
		}
		// Bo sends the frog in: out in front of the kid's rabbit too.
		t.controller.receive(ref.message('a', ref.apply('b', { type: 'switch', teamIndex: 1 })));
		t.runUntil(() => battle.screen !== 'busy');
		// A match changes nothing but the puzzles solved ([[DECISIONS]] § Multiplayer).
		expect(t.authority.snapshot()).toStrictEqual(before);
	});

	it('says who starts, from the coin both see', () => {
		for (const seed of [1, 2, 3, 4]) {
			const t = setup();
			const lines: string[] = [];
			t.controller.peer(peer('Bo', 1));
			t.frame();
			t.exploreKey('c');
			const ref = new Referee(
				t.sentOf('challenge')[0]!.team,
				[{ id: 's', speciesId: 'fox', hp: 1 }],
				seed
			);
			t.controller.receive(ref.message('a'));
			t.runUntil(() => {
				if (battle.line) lines.push(words(battle.line));
				return battle.screen !== 'busy';
			});
			const starts = ref.state.phase.kind !== 'ended' && ref.state.phase.side === 'a';
			expect(lines).toContain(starts ? 'You start!' : 'Bo starts!');
			stop?.();
			battle.reset();
			match.reset();
		}
	});

	it('leaves at once for the one who leaves, and the other wins', () => {
		const t = setup();
		const ref = started(t);
		if (ref.state.phase.kind !== 'ended' && ref.state.phase.side !== 'a') {
			t.controller.receive(
				ref.message('a', ref.apply('b', { type: 'attack', attackIndex: 1, level: 1 }))
			);
			t.controller.receive(ref.message('a', ref.apply('b', { type: 'answer', input: '-1' })));
			t.runUntil(() => battle.screen === 'actions');
		}
		// Down the menu to Leave: the attacks, then Switch, then Leave.
		const attacks = getAnimal('squirrel').attacks.length;
		t.press(...Array.from({ length: attacks + 1 }, () => 'ArrowDown'));
		t.pick('Enter');
		expect(t.sent.at(-1)).toEqual({ t: 'play', id: ref.id, intent: { type: 'leave' } });
		t.controller.receive(ref.message('a', ref.apply('a', { type: 'leave' })));
		t.runUntil(() => match.stage === 'none');
		expect(battle.active).toBe(false);
		expect(said()).toBe('You left the match.');
	});

	it('asks before leaving on Escape while the other thinks: Stay is lit, and only Leave leaves', () => {
		const t = setup();
		const ref = started(t);
		if (ref.state.phase.kind !== 'ended' && ref.state.phase.side === 'a') {
			// Ada's turn first: it passes to Bo (a wrong answer), as her page would have played it.
			t.controller.receive(
				ref.message('a', ref.apply('a', { type: 'attack', attackIndex: 1, level: 1 }))
			);
			t.controller.receive(ref.message('a', ref.apply('a', { type: 'answer', input: '-1' })));
		}
		t.runUntil(() => battle.screen === 'waiting');
		t.press('Escape');
		expect(match.leaving).toBe(true);
		expect(match.option).toBe(0);
		// A second Escape stays; so does Enter on Stay, and a mash of it never picks anything.
		t.press('Escape');
		expect(match.leaving).toBe(false);
		t.press('Escape', ...Array.from({ length: 12 }, () => 'Enter'));
		expect(match.leaving).toBe(true);
		t.pick('Enter');
		expect(match.leaving).toBe(false);
		// Right to Leave: a mashed Enter never leaves; one after the quiet moment does.
		t.press('Escape', 'ArrowRight', ...Array.from({ length: 12 }, () => 'Enter'));
		expect(match.option).toBe(1);
		expect(t.sentOf('play')).toEqual([]);
		t.pick('Enter');
		expect(t.sentOf('play')).toEqual([{ t: 'play', id: ref.id, intent: { type: 'leave' } }]);
		expect(match.leaving).toBe(false);
		t.controller.receive(ref.message('a', ref.apply('a', { type: 'leave' })));
		t.runUntil(() => match.stage === 'none');
		expect(said()).toBe('You left the match.');
	});

	it("asks on the kid's own turn too, where Escape was nothing, and a tap on Leave leaves", () => {
		const t = setup();
		const ref = started(t);
		if (ref.state.phase.kind !== 'ended' && ref.state.phase.side !== 'a') {
			t.controller.receive(
				ref.message('a', ref.apply('b', { type: 'attack', attackIndex: 1, level: 1 }))
			);
			t.controller.receive(ref.message('a', ref.apply('b', { type: 'answer', input: '-1' })));
		}
		t.runUntil(() => battle.screen === 'actions');
		t.press('Escape');
		expect(match.leaving).toBe(true);
		// A tap on Stay: the menu, as it was.
		t.pick(optionKey(0));
		expect(match.leaving).toBe(false);
		expect(battle.screen).toBe('actions');
		// A tap on Leave too soon picks nothing; after the quiet moment it leaves.
		t.press('Escape', optionKey(1));
		expect(match.option).toBe(1);
		expect(t.sentOf('play')).toEqual([]);
		t.pick(optionKey(1));
		expect(t.sentOf('play')).toEqual([{ t: 'play', id: ref.id, intent: { type: 'leave' } }]);
	});

	it('lets the question go when the match ends under it', () => {
		const t = setup();
		const ref = started(t);
		t.runUntil(() => battle.screen === 'waiting' || battle.screen === 'actions');
		t.press('Escape');
		expect(match.leaving).toBe(true);
		t.controller.receive(ref.message('a', ref.apply('b', { type: 'leave' })));
		t.runUntil(() => battle.screen === 'result');
		expect(match.leaving).toBe(false);
		expect(match.result).toMatchObject({ won: true, reason: 'left' });
	});

	it('shows the other leaving as a win, with no rematch to ask for', () => {
		const t = setup();
		const ref = started(t);
		t.controller.receive(ref.message('a', ref.apply('b', { type: 'leave' })));
		t.runUntil(() => battle.screen === 'result');
		expect(match.result).toMatchObject({ won: true, reason: 'left' });
		expect(match.rematch.theirs).toBe(false);
		t.pick('Enter');
		// The highlight starts on Back to exploring: Rematch can't be had.
		expect(t.sentOf('rematch')).toEqual([]);
		expect(match.stage).toBe('none');
	});

	it('asks for a rematch, and plays the next match when both said yes', () => {
		const t = setup();
		const ref = started(t);
		playedOut(t, ref);
		t.pick('ArrowLeft', 'Enter');
		expect(t.sentOf('rematch')).toHaveLength(1);
		t.controller.receive({ t: 'rematch-wish', id: ref.id, side: 'a', yes: true });
		expect(match.rematch.mine).toBe(true);
		const next = new Referee(
			t.sentOf('rematch')[0]!.team,
			[{ id: 's', speciesId: 'fox', hp: 1 }],
			9,
			2
		);
		t.controller.receive(next.message('a'));
		expect(match.stage).toBe('playing');
		expect(match.id).toBe(next.id);
		t.runUntil(() => battle.screen !== 'busy');
		expect(battle.opponent?.speciesId).toBe('fox');
	});

	it('says out loud that it went back to exploring, and greys Rematch? when the server can no longer take it', () => {
		const t = setup();
		const ref = started(t);
		t.controller.receive(ref.message('a', ref.apply('b', { type: 'leave' })));
		t.runUntil(() => battle.screen === 'result');
		// The other left: Rematch? is out, and the server said nothing yet.
		match.rematch = { mine: false, theirs: null };
		match.option = 0;
		t.controller.receive({ t: 'rejected', id: ref.id, reason: 'match-over' });
		expect(match.rematch.theirs).toBe(false);
		// The highlight moves to the one button that still does something.
		expect(match.option).toBe(1);
		t.pick('Enter');
		expect(t.sentOf('done')).toEqual([{ t: 'done', id: ref.id }]);
		expect(match.stage).toBe('none');
	});

	it('keeps Back to exploring pressed while the connection was away: the server hears it once it is back, and the result never comes back (#146)', () => {
		const t = setup();
		const ref = started(t);
		playedOut(t, ref);
		// The connection drops on the result, and the kid goes back to exploring meanwhile.
		t.setOnline(false);
		t.controller.status('waiting');
		expect(match.offline).toBe(true);
		t.pick('ArrowRight', 'Enter');
		expect(match.stage).toBe('none');
		expect(t.sentOf('done')).toEqual([]);
		// The socket is back within the 30 s the server waits: it still has Ada on the result.
		t.setOnline(true);
		t.controller.status('on');
		t.controller.receive(hi(ref.id));
		expect(t.sentOf('done')).toEqual([{ t: 'done', id: ref.id }]);
		// It sends her the match, as to any page back in one: no iris, no "Back in the match", no result.
		const scenes = t.shown.length;
		t.controller.receive(ref.message('a'));
		t.run(3);
		expect(match.stage).toBe('none');
		expect(match.id).toBeNull();
		expect(battle.active).toBe(false);
		expect(battle.transition).toBeNull();
		expect(battle.line).toBeNull();
		expect(t.shown).toHaveLength(scenes);
		// She is out exploring: Bo, beside her, can be asked.
		t.controller.peer(peer('Bo', 1));
		t.frame();
		expect(match.button).toMatchObject({ name: 'Bo', refusal: null });
		// Lost again (the socket went as it was sent): the next hi that names the match says it again.
		t.controller.status('waiting');
		t.controller.status('on');
		t.controller.receive(hi(ref.id));
		expect(t.sentOf('done')).toHaveLength(2);
		// Once the server has let go of her, there is nothing more to say.
		t.controller.status('waiting');
		t.controller.status('on');
		t.controller.receive(hi(null));
		expect(t.sentOf('done')).toHaveLength(2);
		expect(match.stage).toBe('none');
	});

	it('never puts back up a result the kid went back from, even one the server sent before it heard', () => {
		const t = setup();
		const ref = started(t);
		playedOut(t, ref);
		t.pick('ArrowRight', 'Enter');
		expect(t.sentOf('done')).toEqual([{ t: 'done', id: ref.id }]);
		// Bo's page dropped out as Ada pressed Back: the server's word of it was on its way to her.
		t.controller.receive({ ...ref.message('a'), away: { side: 'b', ms: 30_000 } });
		t.run(3);
		expect(match.stage).toBe('none');
		expect(battle.active).toBe(false);
		expect(t.sentOf('done')).toHaveLength(1);
	});

	it("keeps the kid's Back for every page of theirs in the browser, a reload or another tab, and nobody else's", () => {
		const store = memoryStore();
		const t = setup(PARTY, { store });
		const ref = started(t);
		playedOut(t, ref);
		t.setOnline(false);
		t.controller.status('waiting');
		t.pick('ArrowRight', 'Enter');
		expect(store.map.get(wentBackKey(pidOf('Ada')))).toBe(ref.id);
		const newPage = (first: HiMessage) => {
			stop?.();
			battle.reset();
			match.reset();
			return setup(PARTY, { store, first });
		};
		// Bo plays on this browser too (another game of it): his page shows his result, and says nothing.
		const bo = newPage({ ...hi(ref.id), pid: pidOf('Bo'), name: 'Bo' });
		bo.controller.receive(ref.message('b'));
		bo.runUntil(() => battle.screen === 'result');
		expect(match.stage).toBe('over');
		expect(bo.sentOf('done')).toEqual([]);
		expect(store.map.get(wentBackKey(pidOf('Ada')))).toBe(ref.id);
		// Ada's tab reloads (or she opens another) before her connection is back: a new page of hers.
		const u = newPage(hi(ref.id));
		expect(u.sentOf('done')).toEqual([{ t: 'done', id: ref.id }]);
		u.controller.receive(ref.message('a'));
		u.run(3);
		expect(match.stage).toBe('none');
		expect(battle.active).toBe(false);
		// Once a hi of hers no longer names it, the browser forgets it.
		u.controller.status('waiting');
		u.controller.status('on');
		u.controller.receive(hi(null));
		expect(store.map.size).toBe(0);
	});

	it("keeps this page's Back when the browser is full, over an older one it still holds", () => {
		const store = memoryStore();
		const t = setup(PARTY, { store });
		// A Back from an earlier match got through, and no hi has come since to forget it; then the
		// browser's storage fills up.
		store.map.set(wentBackKey(pidOf('Ada')), 'match00009');
		store.full = true;
		const ref = started(t);
		playedOut(t, ref);
		t.setOnline(false);
		t.controller.status('waiting');
		t.pick('ArrowRight', 'Enter');
		expect(store.map.get(wentBackKey(pidOf('Ada')))).toBe('match00009');
		t.setOnline(true);
		t.controller.status('on');
		t.controller.receive(hi(ref.id));
		expect(t.sentOf('done')).toEqual([{ t: 'done', id: ref.id }]);
		t.controller.receive(ref.message('a'));
		t.run(3);
		expect(match.stage).toBe('none');
		expect(battle.active).toBe(false);
	});

	it('brings the result back to a page that never chose to leave it: after a drop, or after another window took over', () => {
		const t = setup();
		const ref = started(t);
		playedOut(t, ref);
		// Still on the result as the socket comes back: it stays, and the server hears nothing.
		t.controller.status('waiting');
		t.controller.status('on');
		t.controller.receive(hi(ref.id));
		t.controller.receive(ref.message('a'));
		expect(match.stage).toBe('over');
		expect(match.id).toBe(ref.id);
		// Another window of Ada's takes over: this page lets the result go, but she did not.
		t.setOnline(false);
		t.controller.status('elsewhere');
		expect(match.stage).toBe('none');
		// Back at this window, the result follows her here.
		t.setOnline(true);
		t.controller.status('on');
		t.controller.receive(hi(ref.id));
		t.controller.receive(ref.message('a'));
		t.runUntil(() => battle.screen === 'result');
		expect(match.stage).toBe('over');
		expect(match.result).toMatchObject({ won: true, reason: 'all-tired' });
		expect(t.sentOf('done')).toEqual([]);
	});

	/** The rematch of `ref`, Bo bringing a fox: the server's messages about it name `ref`. */
	function rematchOf(t: ReturnType<typeof setup>, ref: Referee) {
		const team = t.sentOf('rematch')[0]?.team ?? t.sentOf('challenge')[0]!.team;
		const next = new Referee(team, [{ id: 's', speciesId: 'fox', hp: 1 }], 9, 2);
		return {
			next,
			message: (events: WireMatchEvent[] = [], calledOff = false): MatchMessage => ({
				...next.message('a', events),
				rematchOf: ref.id,
				...(calledOff ? { calledOff: true as const } : {})
			})
		};
	}

	it('never puts up a rematch that crossed the Back to exploring, and says the Back again (#147)', () => {
		const t = setup();
		const ref = started(t);
		playedOut(t, ref);
		// Ada asks for a rematch, then goes back to exploring after all.
		t.pick('ArrowLeft', 'Enter');
		t.controller.receive({ t: 'rematch-wish', id: ref.id, side: 'a', yes: true });
		t.pick('ArrowRight', 'Enter');
		expect(t.sentOf('done')).toEqual([{ t: 'done', id: ref.id }]);
		expect(match.stage).toBe('none');
		// Bo's Rematch? got to the server just before her Back: the rematch reaches her exploring.
		const { next, message } = rematchOf(t, ref);
		const scenes = t.shown.length;
		t.controller.receive(message());
		t.run(3);
		expect(match.stage).toBe('none');
		expect(match.id).toBeNull();
		expect(battle.active).toBe(false);
		expect(battle.transition).toBeNull();
		expect(battle.line).toBeNull();
		expect(t.shown).toHaveLength(scenes);
		// Her Back goes again, about the match she went back from: the server calls the rematch off.
		expect(t.sentOf('done')).toEqual([
			{ t: 'done', id: ref.id },
			{ t: 'done', id: ref.id }
		]);
		t.controller.receive(message(next.apply('a', { type: 'leave' }), true));
		t.run(3);
		expect(match.stage).toBe('none');
		expect(t.sentOf('done')).toHaveLength(2);
		expect(t.sentOf('play')).toEqual([]);
		// She is out exploring: Bo, beside her, can be asked.
		t.controller.peer(peer('Bo', 1));
		t.frame();
		expect(match.button).toMatchObject({ name: 'Bo', refusal: null });
	});

	it('keeps the Back for a rematch a page of the kid comes back to, its first Back lost on the way (#147)', () => {
		const store = memoryStore();
		const t = setup(PARTY, { store });
		const ref = started(t);
		playedOut(t, ref);
		t.pick('ArrowLeft', 'Enter');
		t.pick('ArrowRight', 'Enter');
		expect(t.sentOf('done')).toHaveLength(1);
		// The socket died with the `done` on it, and the rematch Bo's Rematch? started went nowhere:
		// back, the server has her in the rematch.
		const { message } = rematchOf(t, ref);
		t.controller.status('waiting');
		t.controller.status('on');
		t.controller.receive(hi(message().id));
		t.controller.receive(message());
		t.run(3);
		expect(match.stage).toBe('none');
		expect(battle.active).toBe(false);
		expect(t.sentOf('done')).toEqual([
			{ t: 'done', id: ref.id },
			{ t: 'done', id: ref.id }
		]);
		// A new page of hers (a reload, before the server heard) knows it from the browser.
		stop?.();
		battle.reset();
		match.reset();
		const u = setup(PARTY, { store, first: hi(message().id) });
		u.controller.receive(message());
		u.run(3);
		expect(match.stage).toBe('none');
		expect(battle.active).toBe(false);
		expect(u.sentOf('done')).toEqual([{ t: 'done', id: ref.id }]);
		// Once a hi of hers names no match, the browser forgets it.
		u.controller.status('waiting');
		u.controller.status('on');
		u.controller.receive(hi(null));
		expect(store.map.size).toBe(0);
	});

	it('puts the result back when the rematch it began is called off: the friend went back to exploring (#147)', () => {
		const t = setup();
		const ref = started(t);
		playedOut(t, ref);
		const solved = t.counted();
		// Bo asked for a rematch, and Ada says yes: the rematch starts, on the result's screen.
		t.controller.receive({ t: 'rematch-wish', id: ref.id, side: 'b', yes: true });
		t.pick('ArrowLeft', 'Enter');
		const { next, message } = rematchOf(t, ref);
		t.controller.receive(message());
		expect(match.stage).toBe('playing');
		expect(match.id).toBe(next.id);
		const scenes = t.shown.length;
		t.run(0.3);
		// But Bo had pressed Back to exploring as her yes went: the server calls it off.
		t.controller.receive(message(next.apply('b', { type: 'leave' }), true));
		t.frame();
		expect(match.stage).toBe('over');
		expect(match.id).toBe(ref.id);
		expect(match.result).toMatchObject({ won: true, reason: 'all-tired' });
		// Rematch? greyed with "Bo went back to exploring.", and the highlight on Back to exploring.
		expect(match.rematch).toEqual({ mine: false, theirs: false });
		expect(match.option).toBe(1);
		expect(battle.screen).toBe('result');
		expect(battle.line).toBeNull();
		// The match as it ended: Bo's animal tired, on the same screen, no iris.
		expect(battle.opponent?.hp).toBe(0);
		expect(battle.transition).toBeNull();
		expect(t.shown).toHaveLength(scenes);
		t.run(3);
		expect(match.stage).toBe('over');
		expect(t.counted()).toBe(solved);
		// Back to exploring says so about the match whose result it is.
		t.pick('Enter');
		expect(t.sentOf('done')).toEqual([{ t: 'done', id: ref.id }]);
		expect(match.stage).toBe('none');
	});

	it('says the Back again for a crossing rematch that ended while its page was away', () => {
		const t = setup();
		const ref = started(t);
		playedOut(t, ref);
		t.pick('ArrowLeft', 'Enter');
		t.pick('ArrowRight', 'Enter');
		// The `done` went with a socket that died; the rematch started, and Bo left it meanwhile.
		const { next, message } = rematchOf(t, ref);
		const events = next.apply('b', { type: 'leave' });
		t.controller.status('waiting');
		t.controller.status('on');
		t.controller.receive(hi(next.id));
		t.controller.receive(message(events));
		t.run(3);
		// Not put up, and the Back goes again, so the server lets her go of it.
		expect(match.stage).toBe('none');
		expect(battle.active).toBe(false);
		expect(t.sentOf('done')).toEqual([
			{ t: 'done', id: ref.id },
			{ t: 'done', id: ref.id }
		]);
	});

	it('plays a rematch that starts while the result it follows is still coming back up after a reload', () => {
		const t = setup();
		const ref = started(t);
		playedOut(t, ref);
		t.pick('ArrowLeft', 'Enter');
		// Ada's page reloads on the result, her Rematch? standing on the server: the new page puts the
		// match back up ("Back in the match with Bo!"), and Bo's yes starts the rematch meanwhile.
		stop?.();
		battle.reset();
		match.reset();
		const u = setup(PARTY, { first: hi(ref.id) });
		u.controller.receive(ref.message('a'));
		u.run(0.3);
		expect(match.stage).toBe('playing');
		expect(match.id).toBe(ref.id);
		const { next, message } = rematchOf(t, ref);
		u.controller.receive(message());
		// The rematch goes up; nothing leaves it.
		expect(match.stage).toBe('playing');
		expect(match.id).toBe(next.id);
		expect(u.sentOf('play')).toEqual([]);
		u.runUntil(() => battle.screen !== 'busy');
		expect(battle.opponent?.speciesId).toBe('fox');
		expect(u.sentOf('play')).toEqual([]);
	});

	it('shows a called-off rematch it picked up after a reload as the friend leaving, and one it never had not at all', () => {
		// A reload as the rematch started: this page picks it up, with no result to go back to.
		const first = new Referee(
			[{ id: 'starter', speciesId: 'squirrel' }],
			[{ id: 's', speciesId: 'fox', hp: 1 }],
			9,
			2
		);
		const message = (events: WireMatchEvent[] = [], calledOff = false): MatchMessage => ({
			...first.message('a', events),
			rematchOf: 'match00001',
			...(calledOff ? { calledOff: true as const } : {})
		});
		const t = setup(PARTY, { first: hi(first.id) });
		t.controller.receive(message());
		t.runUntil(() => battle.screen !== 'busy');
		t.controller.receive(message(first.apply('b', { type: 'leave' }), true));
		t.runUntil(() => battle.screen === 'result');
		expect(match.result).toMatchObject({ won: true, reason: 'left' });
		expect(match.rematch.theirs).toBe(false);
		t.pick('Enter');
		expect(match.stage).toBe('none');
		// A call-off of a rematch this page never began (of a match it never went back from) brings
		// nothing up.
		const other = new Referee(
			[{ id: 'starter', speciesId: 'squirrel' }],
			[{ id: 's', speciesId: 'fox', hp: 1 }],
			9,
			3
		);
		const scenes = t.shown.length;
		t.controller.receive({
			...other.message('a', other.apply('b', { type: 'leave' })),
			rematchOf: 'match00008',
			calledOff: true
		});
		t.run(3);
		expect(match.stage).toBe('none');
		expect(battle.active).toBe(false);
		expect(t.shown).toHaveLength(scenes);
	});

	it('says the match is over to a page that came back to find it gone', () => {
		// From a server that says which run it is, and from one before `boot`, which does not.
		for (const [i, boot] of ['run0001', undefined].entries()) {
			if (i > 0) {
				stop?.();
				battle.reset();
				match.reset();
			}
			const t = setup();
			t.controller.receive({ ...hi(null), ...(boot ? { boot } : {}) });
			started(t);
			t.controller.status('waiting');
			expect(match.offline).toBe(true);
			t.controller.status('on');
			t.controller.receive({ ...hi(null), ...(boot ? { boot } : {}) });
			expect(match.stage).toBe('over');
			expect(match.result?.missed).toBe(true);
		}
	});

	it('says the game restarted to a page back to a new run of the server, and Play again asks the same friend', () => {
		const t = setup();
		t.controller.receive({ ...hi(null), boot: 'run0001' });
		started(t);
		// The server stopped without a word (a crash): no bye, the socket just went.
		t.controller.status('waiting');
		t.controller.status('on');
		t.controller.receive({ ...hi(null), boot: 'run0002' });
		expect(match.stage).toBe('updating');
		expect(match.restarted).toBe(true);
		expect(match.result).toBeNull();
		expect(t.controller.busy).toBe(false);
		expect(match.friendBack).toBe(false);
		t.controller.peer(peer('Bo', 1));
		expect(match.friendBack).toBe(true);
		t.pick('Enter');
		expect(t.sentOf('challenge')).toHaveLength(2);
		expect(t.sentOf('challenge')[1]!.pid).toBe(pidOf('Bo'));
		expect(match.stage).toBe('asking');
		expect(match.restarted).toBe(false);
	});

	it('says the game restarted on a result whose rematch could still be had, and leaves one that could not', () => {
		// A match played to its end: Ada on the result, Rematch? still to be had.
		const t = setup();
		t.controller.receive({ ...hi(null), boot: 'run0001' });
		playedOut(t, started(t));
		t.controller.status('waiting');
		t.controller.status('on');
		t.controller.receive({ ...hi(null), boot: 'run0002' });
		expect(match.stage).toBe('updating');
		expect(match.restarted).toBe(true);

		// Bo left: the result says so, and a restart asks nobody back who chose to go.
		stop?.();
		battle.reset();
		match.reset();
		const u = setup();
		u.controller.receive({ ...hi(null), boot: 'run0001' });
		const left = started(u);
		u.controller.receive(left.message('a', left.apply('b', { type: 'leave' })));
		u.runUntil(() => battle.screen === 'result');
		u.controller.status('waiting');
		u.controller.status('on');
		u.controller.receive({ ...hi(null), boot: 'run0002' });
		expect(match.stage).toBe('over');
		expect(match.result).toMatchObject({ won: true, reason: 'left' });
		u.controller.peer(peer('Bo', 1));
		u.pick('Enter');
		expect(u.sentOf('challenge')).toHaveLength(1);
		expect(match.stage).toBe('none');
	});

	it('ends kindly when the server updates, and Play again asks the same friend once both are back', () => {
		const t = setup();
		started(t);
		t.controller.receive({ t: 'bye', reason: 'restart' });
		expect(match.stage).toBe('updating');
		// Nobody sees a match any more: the next server can hand an invite either way.
		expect(t.controller.busy).toBe(false);
		t.controller.status('waiting');
		t.pick('ArrowLeft', 'Enter');
		expect(t.sentOf('challenge')).toHaveLength(1);
		t.controller.status('on');
		t.controller.receive({
			t: 'hi',
			v: PROTOCOL_VERSION,
			pid: pidOf('Ada'),
			name: 'Ada',
			match: null
		});
		expect(match.friendBack).toBe(false);
		t.controller.peer(peer('Bo', 1));
		expect(match.friendBack).toBe(true);
		t.pick('ArrowLeft', 'Enter');
		expect(t.sentOf('challenge')).toHaveLength(2);
		expect(t.sentOf('challenge')[1]!.pid).toBe(pidOf('Bo'));
		expect(match.stage).toBe('asking');
	});

	it('says yes with Play again when the friend asked first', () => {
		const t = setup();
		started(t);
		t.controller.receive({ t: 'bye', reason: 'restart' });
		t.controller.peer(peer('Bo', 1));
		t.controller.receive({ t: 'invite', pid: pidOf('Bo'), name: 'Bo', ms: 20_000 });
		expect(match.friendAsked).toBe(true);
		t.pick('ArrowLeft', optionKey(0));
		expect(t.sentOf('accept')).toHaveLength(1);
		expect(match.stage).toBe('starting');
	});
});
