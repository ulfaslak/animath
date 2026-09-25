import {
	ATTACK_LEVELS,
	attackDamage,
	getAnimal,
	isEncounterTile,
	readSave,
	restoreGame,
	saveDocument,
	tileAtWorld,
	type AnimalInstance,
	type BattleState,
	type GameEvent,
	type GridPos,
	type Intent,
	type SavedGame
} from '@mathgame/engine';
import { describe, expect, it } from 'vitest';
import { LocalAuthority } from '../src/authority/local';

/**
 * The single-player authority's own rules — the ones around the engine, not
 * in it: one encounter roll per completed step, keyed so a walk replays; the
 * battle's result written back into the world; the lost-battle rest. The
 * battle itself is the engine's (see the engine's `battle-reducer.test.ts`).
 *
 * The prototype world's spawn tile, (-2, 6), has a river reed (tall grass)
 * straight to its left, so walking left and right from it meets animals
 * (with the starter squirrel in front: squirrels and rabbits near home, now
 * and then an otter).
 */
type Session = { authority: LocalAuthority; events: GameEvent[] };

function session(): Session {
	const authority = new LocalAuthority();
	const events: GameEvent[] = [];
	authority.subscribe((e) => events.push(e));
	authority.start();
	return { authority, events };
}

/** Index of the last event of `type`, or -1. (ES2022 has no `findLastIndex`.) */
function lastIndexOf(s: Session, type: GameEvent['type']): number {
	for (let i = s.events.length - 1; i >= 0; i--) if (s.events[i]!.type === type) return i;
	return -1;
}

function welcome(s: Session): Extract<GameEvent, { type: 'welcome' }> {
	const w = s.events.find((e) => e.type === 'welcome');
	if (w?.type !== 'welcome') throw new Error('no welcome');
	return w;
}

/**
 * Hand the authority a party before any battle, as a loaded save would.
 * `LocalAuthority` has no way to take one yet, so this sets the field itself.
 */
function giveParty(s: Session, party: AnimalInstance[]): void {
	(s.authority as unknown as { party: AnimalInstance[] }).party = party.map((a) => ({ ...a }));
}

const animal = (speciesId: string, hp = getAnimal(speciesId).maxHp): AnimalInstance => ({
	id: `${speciesId}-${hp}`,
	speciesId,
	hp
});

/**
 * Press Left, Right, Left, … from the spawn tile for `steps` steps, running
 * from every battle: every Left lands on the reed. Which animal came out on
 * which step, and which of the player's animals stepped in against it.
 */
function reedWalk(s: Session, steps: number): { step: number; wild: string; lead: string }[] {
	const met: { step: number; wild: string; lead: string }[] = [];
	for (let step = 1; step <= steps; step++) {
		const from = s.events.length;
		s.authority.dispatch({ type: 'move', dir: step % 2 === 1 ? 'left' : 'right' });
		const fresh = s.events.slice(from);
		if (!fresh.some((e) => e.type === 'player-moved')) throw new Error(`step ${step} was blocked`);
		const started = fresh.find((e) => e.type === 'battle-started');
		if (started?.type !== 'battle-started') continue;
		const { opponent, party, active } = started.state;
		met.push({ step, wild: opponent.speciesId, lead: party[active]!.speciesId });
		s.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
	}
	return met;
}

/** Walk left/right past the reed until a battle starts; the state it started with. */
function walkIntoBattle(s: Session, maxSteps = 400): BattleState {
	for (let i = 0; i < maxSteps; i++) {
		const from = s.events.length;
		s.authority.dispatch({ type: 'move', dir: i % 2 === 0 ? 'left' : 'right' });
		const started = s.events.slice(from).find((e) => e.type === 'battle-started');
		if (started?.type === 'battle-started') return started.state;
	}
	throw new Error(`no encounter in ${maxSteps} steps`);
}

function latestBattle(s: Session): BattleState {
	for (let i = s.events.length - 1; i >= 0; i--) {
		const e = s.events[i]!;
		if (e.type === 'battle-updated' || e.type === 'battle-started') return e.state;
	}
	throw new Error('no battle yet');
}

/** Pick an attack and answer it, right or wrong on purpose. */
function attack(s: Session, attackIndex: number, level: 1 | 2 | 3, correct: boolean): void {
	s.authority.dispatch({ type: 'battle', intent: { type: 'attack', attackIndex, level } });
	const phase = latestBattle(s).phase;
	if (phase.kind !== 'solving') throw new Error(`expected a puzzle, got ${phase.kind}`);
	const input = String(correct ? phase.puzzle.answer : phase.puzzle.answer + 1);
	s.authority.dispatch({ type: 'battle', intent: { type: 'answer', input } });
}

function party(s: Session): AnimalInstance[] {
	for (let i = s.events.length - 1; i >= 0; i--) {
		const e = s.events[i]!;
		if (e.type === 'party-changed' || e.type === 'welcome') return e.party;
	}
	throw new Error('no party');
}

function lastMessage(s: Session): string {
	const m = s.events.filter((e) => e.type === 'message').at(-1);
	return m?.type === 'message' ? m.text : '';
}

/** Where the player stands, from the events. */
function position(s: Session): GridPos {
	for (let i = s.events.length - 1; i >= 0; i--) {
		const e = s.events[i]!;
		if (e.type === 'player-moved' || e.type === 'player-placed' || e.type === 'welcome') {
			return e.pos;
		}
	}
	throw new Error('no position');
}

/** Win the current battle: the strongest attack at level 3, always right. */
function win(s: Session): void {
	while (latestBattle(s).phase.kind !== 'ended') {
		const state = latestBattle(s);
		attack(s, getAnimal(state.party[state.active]!.speciesId).attacks.length, 3, true);
	}
}

/** Lose the current battle: every answer wrong. */
function lose(s: Session): void {
	while (latestBattle(s).phase.kind !== 'ended') attack(s, 1, 1, false);
}

/**
 * Weaken the wild animal to a third of its HP with the hardest hits that
 * leave it standing, then throw the leash until the battle ends.
 */
function tryToCatch(s: Session): void {
	for (let turn = 0; turn < 80 && latestBattle(s).phase.kind !== 'ended'; turn++) {
		const state = latestBattle(s);
		const wild = state.opponent;
		const mine = getAnimal(state.party[state.active]!.speciesId);
		let best: { n: number; level: 1 | 2 | 3; damage: number } | null = null;
		for (let n = 1; n <= mine.attacks.length; n++) {
			for (const level of ATTACK_LEVELS) {
				const damage = attackDamage(mine, n, level, true);
				if (damage < wild.hp && (!best || damage > best.damage)) best = { n, level, damage };
			}
		}
		if (wild.hp * 3 > getAnimal(wild.speciesId).maxHp && best) {
			attack(s, best.n, best.level, true);
		} else {
			s.authority.dispatch({ type: 'battle', intent: { type: 'throw-leash' } });
		}
	}
}

/** The events a finished battle's last intent produced, from its `battle-updated` on. */
function closingEvents(s: Session): GameEvent[] {
	return s.events.slice(lastIndexOf(s, 'battle-updated'));
}

describe('LocalAuthority: encounters', () => {
	it('a walk meets the same animals and puzzles at the same steps, each with a fresh id', () => {
		const a = session();
		const b = session();
		for (let n = 0; n < 4; n++) {
			const fromA = a.events.length;
			const fromB = b.events.length;
			const first = walkIntoBattle(a);
			const second = walkIntoBattle(b);
			expect(a.events.length - fromA).toBe(b.events.length - fromB);
			expect(second.opponent.speciesId).toBe(first.opponent.speciesId);
			expect(second.opponent.id).not.toBe(first.opponent.id);
			for (const s of [a, b]) {
				s.authority.dispatch({
					type: 'battle',
					intent: { type: 'attack', attackIndex: 1, level: n % 3 === 0 ? 1 : 2 }
				});
			}
			expect(latestBattle(b).phase).toEqual(latestBattle(a).phase);
			for (const s of [a, b]) {
				s.authority.dispatch({ type: 'battle', intent: { type: 'answer', input: '1' } });
				if (latestBattle(s).phase.kind !== 'ended') {
					s.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
				}
			}
			expect(party(b)).toEqual(party(a));
		}
	});

	it('starts a battle only right after a step onto an encounter tile, at full HP', () => {
		const s = session();
		const { seed } = welcome(s);
		for (let n = 0; n < 6; n++) {
			const state = walkIntoBattle(s);
			const i = lastIndexOf(s, 'battle-started');
			const step = s.events[i - 1];
			if (step?.type !== 'player-moved') throw new Error(`battle after ${step?.type}`);
			expect(isEncounterTile(tileAtWorld(seed, step.pos.x, step.pos.y).kind)).toBe(true);
			expect(state.opponent.hp).toBe(getAnimal(state.opponent.speciesId).maxHp);
			s.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
		}
	});

	it('mid-battle, walking and talking do nothing; outside one, battle intents do nothing', () => {
		const s = session();
		const idle = s.events.length;
		s.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
		expect(s.events.length).toBe(idle);

		walkIntoBattle(s);
		const before = s.events.length;
		const pos = position(s);
		s.authority.dispatch({ type: 'move', dir: 'right' });
		s.authority.dispatch({ type: 'interact' });
		expect(s.events.length).toBe(before);
		s.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
		expect(position(s)).toEqual(pos);
	});
});

describe('LocalAuthority: the lead decides who comes out', () => {
	it('with the starter in front, the reed meets a Rabbit on step 11, a Squirrel on step 15 and the first Otter on step 97', () => {
		const met = reedWalk(session(), 97);
		expect(met[0]).toEqual({ step: 11, wild: 'rabbit', lead: 'squirrel' });
		expect(met[1]).toEqual({ step: 15, wild: 'squirrel', lead: 'squirrel' });
		expect(met.find((m) => m.wild === 'otter')?.step).toBe(97);
		expect(met.every((m) => ['squirrel', 'rabbit', 'otter'].includes(m.wild))).toBe(true);
	});

	it('the first animal that is not tired leads: with a fox in front the reed has only otters, on the same steps', () => {
		const starter = reedWalk(session(), 200);
		for (const party of [
			[animal('fox'), animal('squirrel')],
			[animal('squirrel', 0), animal('fox')]
		]) {
			const s = session();
			giveParty(s, party);
			const met = reedWalk(s, 200);
			expect(met.map((m) => m.step)).toEqual(starter.map((m) => m.step));
			expect(new Set(met.map((m) => m.wild))).toEqual(new Set(['otter']));
			expect(new Set(met.map((m) => m.lead))).toEqual(new Set(['fox']));
		}
		// Behind a standing squirrel, a fox changes nothing.
		const s = session();
		giveParty(s, [animal('squirrel'), animal('fox')]);
		expect(reedWalk(s, 200)).toEqual(starter);
	});

	it('with a bear in front, nothing at the river is big enough to come out', () => {
		for (const party of [[animal('bear')], [animal('squirrel', 0), animal('bear')]]) {
			const s = session();
			giveParty(s, party);
			expect(reedWalk(s, 400)).toEqual([]);
		}
	});
});

describe('LocalAuthority: outcomes', () => {
	it('won: HP lost in the battle stays lost, into the next battle too', () => {
		const s = session();
		// Wild animals sometimes miss, so win until a battle has cost some HP.
		let final: BattleState | null = null;
		for (let n = 0; n < 20 && !final; n++) {
			walkIntoBattle(s);
			win(s);
			const end = latestBattle(s);
			if (end.party[0]!.hp < getAnimal('squirrel').maxHp) final = end;
		}
		if (!final) throw new Error('twenty wins without losing any HP');
		expect(final.phase).toEqual({ kind: 'ended', outcome: 'won' });
		expect(party(s)).toEqual(final.party);
		expect(closingEvents(s).map((e) => e.type)).toEqual([
			'battle-updated',
			'battle-ended',
			'party-changed',
			'message'
		]);
		// The next walk goes on from where the battle was, and the next battle
		// starts with the HP this one left.
		const from = position(s);
		s.authority.dispatch({ type: 'move', dir: 'right' });
		expect(position(s)).toEqual({ x: from.x + 1, y: from.y });
		expect(walkIntoBattle(s).party).toEqual(final.party);
	});

	it('fled: nothing changes but a message', () => {
		const s = session();
		walkIntoBattle(s);
		const before = party(s);
		s.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
		expect(latestBattle(s).phase).toEqual({ kind: 'ended', outcome: 'fled' });
		expect(party(s)).toEqual(before);
		expect(lastMessage(s)).toMatch(/stays in the grass/);
	});

	it('lost: everyone is healed and put back on the spawn tile (placeholder for the tent)', () => {
		const s = session();
		const spawn = welcome(s).pos;
		walkIntoBattle(s);
		lose(s);
		expect(latestBattle(s).phase).toEqual({ kind: 'ended', outcome: 'lost' });
		expect(closingEvents(s).map((e) => e.type)).toEqual([
			'battle-updated',
			'battle-ended',
			'party-changed',
			'player-placed',
			'message'
		]);
		for (const a of party(s)) expect(a.hp).toBe(getAnimal(a.speciesId).maxHp);
		expect(position(s)).toEqual(spawn);
		expect(lastMessage(s)).toBe('Everyone is tired. You rest and feel better.');
		// The authority walks on from the spawn tile, not from the battle.
		s.authority.dispatch({ type: 'move', dir: 'right' });
		expect(position(s)).toEqual({ x: spawn.x + 1, y: spawn.y });
	});

	it('caught: joins the party with the HP it had; a seventh animal is let go', () => {
		const s = session();
		let caught = 0;
		for (let battles = 0; battles < 200 && party(s).length < 7; battles++) {
			const before = party(s).length;
			walkIntoBattle(s);
			tryToCatch(s);
			const end = latestBattle(s);
			if (end.phase.kind !== 'ended' || end.phase.outcome !== 'caught') continue;
			caught++;
			const ended = closingEvents(s).find((e) => e.type === 'battle-updated');
			const event =
				ended?.type === 'battle-updated' ? ended.events.find((e) => e.type === 'ended') : null;
			const animal = event?.type === 'ended' ? event.caught : undefined;
			expect(animal).toBeDefined();
			if (before < 6) {
				expect(party(s)).toHaveLength(before + 1);
				expect(party(s).at(-1)).toEqual(animal);
				expect(lastMessage(s)).toMatch(/joins your team/);
			} else {
				expect(party(s)).toHaveLength(6);
				expect(party(s).map((a) => a.id)).not.toContain(animal!.id);
				expect(lastMessage(s)).toMatch(/team is full/);
				return;
			}
		}
		throw new Error(`the party never filled up (${caught} caught)`);
	});
});

describe('LocalAuthority: saved games', () => {
	/** Whether a battle is in progress, from the events. */
	function inBattle(s: Session): boolean {
		return lastIndexOf(s, 'battle-started') > lastIndexOf(s, 'battle-ended');
	}

	/** What a scripted kid does next: walk the reed, fight, get one in four wrong, leash the weak. */
	function nextIntent(s: Session, i: number): Intent {
		if (!inBattle(s)) return { type: 'move', dir: i % 2 === 0 ? 'left' : 'right' };
		const state = latestBattle(s);
		if (state.phase.kind === 'solving') {
			const { answer } = state.phase.puzzle;
			const input = String(i % 4 === 0 ? answer + 1 : answer);
			return { type: 'battle', intent: { type: 'answer', input } };
		}
		const wild = state.opponent;
		if (wild.hp * 3 < getAnimal(wild.speciesId).maxHp) {
			return { type: 'battle', intent: { type: 'throw-leash' } };
		}
		return { type: 'battle', intent: { type: 'attack', attackIndex: 1, level: 1 } };
	}

	/** An event with minted ids left out: what must match between two runs of one game. */
	function fingerprint(e: GameEvent): unknown {
		const party = (p: readonly AnimalInstance[]) => p.map((a) => [a.speciesId, a.hp]);
		switch (e.type) {
			case 'battle-started':
			case 'battle-ended':
				return [
					e.type,
					e.state.opponent.speciesId,
					e.state.opponent.hp,
					party(e.state.party),
					e.state.phase
				];
			case 'battle-updated':
				return [
					e.type,
					e.state.step,
					party(e.state.party),
					e.state.phase,
					e.events.map((x) => x.type)
				];
			case 'party-changed':
				return [e.type, party(e.party)];
			default:
				return e;
		}
	}

	/** A save round trip, as the autosave and a reload do it: JSON through storage, then restore. */
	function throughSave(game: SavedGame): SavedGame {
		const doc = saveDocument(game, { lineage: 'test', seq: 1 });
		const read = readSave(JSON.parse(JSON.stringify(doc)));
		if (!read.ok) throw new Error(read.error);
		return restoreGame(read.save);
	}

	it('a restored game plays on exactly as the original does, cut anywhere, mid-puzzle included', () => {
		const cuts = { explore: 0, choose: 0, solving: 0 };
		for (const cut of [3, 11, 12, 13, 14, 20, 33, 47, 60, 75]) {
			const a = session();
			let i = 0;
			for (; i < cut; i++) a.authority.dispatch(nextIntent(a, i));
			const saved = throughSave(a.authority.snapshot());
			if (!saved.battle) cuts.explore++;
			else if (saved.battle.phase.kind === 'solving') cuts.solving++;
			else cuts.choose++;

			const b: Session = { authority: new LocalAuthority(), events: [] };
			b.authority.subscribe((e) => b.events.push(e));
			b.authority.start({ game: saved });
			expect(inBattle(b)).toBe(inBattle(a));
			const fromA = a.events.length;
			const fromB = b.events.length;
			for (; i < cut + 60; i++) {
				a.authority.dispatch(nextIntent(a, i));
				b.authority.dispatch(nextIntent(b, i));
			}
			expect(b.events.slice(fromB).map(fingerprint)).toEqual(
				a.events.slice(fromA).map(fingerprint)
			);
		}
		// The cuts land in explore, at the battle menu and in the middle of a puzzle.
		expect(cuts.explore).toBeGreaterThan(0);
		expect(cuts.choose).toBeGreaterThan(0);
		expect(cuts.solving).toBeGreaterThan(0);
	});

	it('start picks up a saved battle: welcome, then battle-started with the saved state, then the message', () => {
		const a = session();
		walkIntoBattle(a);
		a.authority.dispatch({ type: 'battle', intent: { type: 'attack', attackIndex: 1, level: 2 } });
		const saved = throughSave(a.authority.snapshot());
		expect(saved.battle?.phase.kind).toBe('solving');

		const b: Session = { authority: new LocalAuthority(), events: [] };
		b.authority.subscribe((e) => b.events.push(e));
		b.authority.start({ game: saved, message: 'Welcome back!' });
		expect(b.events.map((e) => e.type)).toEqual(['welcome', 'battle-started', 'message']);
		expect(welcome(b)).toMatchObject({ pos: saved.pos, facing: saved.facing, party: saved.party });
		expect(latestBattle(b)).toEqual(latestBattle(a));
		// Walking waits for the battle, as it would have before the reload.
		b.authority.dispatch({ type: 'move', dir: 'up' });
		expect(b.events.length).toBe(3);
	});

	it('mid-battle, the snapshot holds the battle and its party as they stand; in explore, no battle', () => {
		const s = session();
		expect(s.authority.snapshot().battle).toBeNull();
		walkIntoBattle(s);
		lose(s);
		walkIntoBattle(s);
		attack(s, 1, 1, false);
		const state = latestBattle(s);
		const snap = s.authority.snapshot();
		expect(snap.battle).toEqual(state);
		expect(snap.party).toEqual(state.party);
		expect(snap.pos).toEqual(position(s));
	});

	it('keeps the facing the client shows: down at first, then every move, walked or blocked', () => {
		const s = session();
		expect(welcome(s).facing).toBe('down');
		expect(s.authority.snapshot().facing).toBe('down');
		for (const dir of ['up', 'left', 'down', 'right'] as const) {
			s.authority.dispatch({ type: 'move', dir });
			expect(s.authority.snapshot().facing).toBe(dir);
		}
		// The spawn tile has water beside it: walk until something blocks, and the facing follows.
		const blockedAt = s.events.length;
		for (
			let n = 0;
			n < 40 && !s.events.slice(blockedAt).some((e) => e.type === 'player-blocked');
			n++
		) {
			if (inBattle(s)) s.authority.dispatch({ type: 'battle', intent: { type: 'flee' } });
			s.authority.dispatch({ type: 'move', dir: 'up' });
		}
		expect(s.events.slice(blockedAt).some((e) => e.type === 'player-blocked')).toBe(true);
		expect(s.authority.snapshot().facing).toBe('up');
	});

	it('ignores intents until it has started', () => {
		const authority = new LocalAuthority();
		const events: GameEvent[] = [];
		authority.subscribe((e) => events.push(e));
		authority.dispatch({ type: 'move', dir: 'left' });
		authority.dispatch({ type: 'interact' });
		expect(events).toEqual([]);
	});
});
