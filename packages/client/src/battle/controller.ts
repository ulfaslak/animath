import {
	canSwitchTo,
	getAnimal,
	tileAtWorld,
	type AnimalInstance,
	type Authority,
	type BattleEvent,
	type BattleIntent,
	type BattleSide,
	type BattleState,
	type GameEvent,
	type GridPos,
	type Line as MessageLine
} from '@mathgame/engine';
import { answerKey } from '../input/answer';
import { line, type Line } from '../lines';
import { BattleScene } from '../render/battle-scene';
import type { GameRenderer } from '../render/renderer';
import { battle } from '../state/battle.svelte';
import { actionCount, firstPickable, listKey, menuKey, rowOf } from './menu';

/**
 * Battle mode: owns the battle screen from `battle-started` until the player
 * leaves the result card. It turns keys into battle intents, and plays the
 * authority's events back one *beat* at a time — a line of narration, an HP
 * change, a lunge or a shake — with a hold after each, so a turn reads like a
 * Game Boy battle instead of resolving in one frame. Only when every beat has
 * played does the view show the authority's latest state (the menu, the
 * party list, the puzzle or the result card) and take input again. What a
 * key means on the menu and the list is `menu.ts`'s to say.
 *
 * The authority answers every intent synchronously; the beats are purely
 * presentation and nothing here decides an outcome. Lines are kept as data
 * (`lines.ts`) and worded by the panel when drawn.
 */

/** One beat: change something and maybe say a line, then hold for `hold` seconds. */
interface Beat {
	run: () => Line | undefined;
	hold: number;
}

/**
 * Seconds the result card ignores keys after it appears, so an Enter mashed
 * through the last beats cannot dismiss it unread.
 */
const RESULT_GUARD_SECONDS = 0.8;

/**
 * Seconds the "who goes next?" list ignores a pick after a knock-out brings it
 * up, so an Enter mashed through the narration cannot choose for the kid.
 */
const PICK_GUARD_SECONDS = 0.8;

/**
 * Seconds the world stays on screen after `battle-started`, so the step into
 * the grass lands before the battle appears (a step takes 0.18 s).
 */
const ENTER_SECONDS = 0.3;

export class BattleController {
	/** Built on the first battle and reused for every one after it. */
	private scene: BattleScene | null = null;
	/** The authority's latest state; shown once the beats have played. */
	private latest: BattleState | null = null;
	private beats: Beat[] = [];
	private wait = 0;
	/** The authority's closing `message`, kept for the result card. */
	private closing: MessageLine | null = null;
	/** Seconds the result card has been up. */
	private resultAge = 0;
	/** Seconds the party list has been up. */
	private listAge = 0;
	/** Seconds left before the battle screen replaces the world. */
	private enterIn = 0;
	/** Where the player stands, to pick the battle's backdrop. */
	private playerId = '';
	private seed = 0;
	private pos: GridPos = { x: 0, y: 0 };
	private hits = 0;

	constructor(
		private authority: Authority,
		private renderer: GameRenderer
	) {}

	handle(event: GameEvent): void {
		switch (event.type) {
			case 'welcome':
				this.playerId = event.playerId;
				this.seed = event.seed;
				this.pos = event.pos;
				break;
			case 'player-moved':
			case 'player-placed':
			case 'taken-to-doctor':
				// Where the next battle is fought, for its backdrop. A lost battle's
				// trip to the tent sends no `message`: its card shows only "Good try!",
				// and the doctor's line waits on the message line in the world.
				if (event.playerId === this.playerId) this.pos = event.pos;
				break;
			case 'battle-started':
				this.begin(event.state);
				break;
			case 'battle-updated': {
				// Only the battle on screen: the wild animal's id is minted per encounter,
				// so an update for an earlier battle (late, or replayed) never matches.
				if (!battle.active || event.state.opponent.id !== this.latest?.opponent.id) return;
				// A switch out of `choose-animal` replaces a tired animal: nobody is called back.
				const replacing = this.latest.phase.kind === 'choose-animal';
				this.latest = event.state;
				battle.screen = 'busy';
				for (const e of event.events) this.beats.push(...this.narrate(e, replacing));
				break;
			}
			case 'message':
				if (!battle.active || this.latest?.phase.kind !== 'ended') return;
				this.closing = event.line;
				if (battle.screen === 'result') battle.closing = event.line;
				break;
		}
	}

	/** Play beats as their holds expire; `dt` is seconds. */
	update(dt: number): void {
		if (!battle.active) return;
		if (battle.entering) {
			this.enterIn -= dt;
			if (this.enterIn > 0) return;
			battle.entering = false;
			this.renderer.setBattle(this.scene);
		}
		if (battle.screen === 'result') this.resultAge += dt;
		if (battle.screen === 'party') this.listAge += dt;
		this.wait -= dt;
		while (this.wait <= 0 && this.beats.length > 0) {
			const beat = this.beats.shift()!;
			const line = beat.run();
			if (line !== undefined) battle.line = line;
			this.wait = beat.hold;
		}
		if (this.wait <= 0 && this.beats.length === 0 && battle.screen === 'busy') this.settle();
	}

	/** Keyboard input while the battle screen is up. */
	onKey(e: KeyboardEvent): void {
		if (!battle.active) return;
		// Leave browser shortcuts alone, and never act on auto-repeat: a key held
		// down when the battle began (a walking arrow) must not scroll the menu.
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		if (e.repeat) {
			e.preventDefault();
			return;
		}
		let handled: boolean;
		switch (battle.screen) {
			case 'busy':
				handled = true; // swallow mashing while events play
				break;
			case 'actions':
				handled = this.menuKey(e.key);
				break;
			case 'party':
				handled = this.partyKey(e.key);
				break;
			case 'puzzle':
				handled = this.puzzleKey(e.key);
				break;
			case 'result':
				handled = e.key === 'Enter' || e.key === ' ';
				if (handled && this.resultAge >= RESULT_GUARD_SECONDS) this.leave();
				break;
		}
		if (handled) e.preventDefault();
	}

	// --- screens -------------------------------------------------------------

	private begin(state: BattleState): void {
		battle.reset();
		battle.active = true;
		battle.entering = true;
		this.enterIn = ENTER_SECONDS;
		battle.party = state.party.map((a) => ({ ...a }));
		battle.front = state.active;
		battle.opponent = { ...state.opponent };
		battle.leashQuality = state.leashQuality;
		// Known from the start, so the Switch row doesn't show greyed through the opening lines.
		battle.pickable = state.party.map((_, i) => canSwitchTo(state, i));
		this.latest = state;
		this.closing = null;
		this.beats = [];
		this.wait = 0;

		const biome = tileAtWorld(this.seed, this.pos.x, this.pos.y).biome;
		this.scene ??= new BattleScene();
		this.scene.begin(biome, this.front().speciesId, state.opponent.speciesId);

		const wild = state.opponent;
		const mine = this.front();
		this.beats.push({ run: () => line('battle.appears', { animal: wild }), hold: 1.4 });
		// A battle picked up where the animal in front is already tired (a
		// restored one, waiting for the player to pick) shows it lying down.
		if (mine.hp > 0) {
			this.beats.push({ run: () => line('battle.go', { animal: mine }), hold: 1.0 });
		} else {
			this.scene.faint('player');
		}
	}

	/** Every beat has played: show the authority's latest state and take input. */
	private settle(): void {
		const state = this.latest;
		if (!state) return;
		battle.party = state.party.map((a) => ({ ...a }));
		battle.front = state.active;
		battle.opponent = { ...state.opponent };
		battle.pickable = state.party.map((_, i) => canSwitchTo(state, i));
		battle.hit = null;
		const front = this.front();
		switch (state.phase.kind) {
			case 'choose-action': {
				const rows = actionCount(getAnimal(front.speciesId).attacks.length);
				battle.cursor = Math.min(battle.cursor, rows - 1);
				battle.puzzle = null;
				battle.judged = null;
				battle.input = '';
				battle.line = line('battle.whatNow', { animal: front });
				battle.screen = 'actions';
				break;
			}
			case 'choose-animal':
				// The animal in front is tired: the party list, with no way back.
				battle.puzzle = null;
				battle.judged = null;
				battle.input = '';
				this.openParty(true);
				battle.line = line('battle.switch.whoIsNext', { animal: front });
				break;
			case 'solving':
				battle.puzzle = state.phase.puzzle;
				battle.input = '';
				battle.judged = null;
				battle.line = line('battle.tries', {
					animal: front,
					attack: { speciesId: front.speciesId, attackIndex: state.phase.attackIndex }
				});
				battle.screen = 'puzzle';
				break;
			case 'ended':
				if (state.phase.outcome === 'won') this.scene?.hop('player');
				battle.outcome = state.phase.outcome;
				battle.closing = this.closing;
				battle.line = null;
				this.resultAge = 0;
				battle.screen = 'result';
				break;
		}
	}

	private leave(): void {
		this.renderer.setBattle(null);
		this.latest = null;
		this.beats = [];
		this.wait = 0;
		battle.reset();
	}

	private send(intent: BattleIntent): void {
		battle.screen = 'busy';
		this.authority.dispatch({ type: 'battle', intent });
	}

	// --- keys ----------------------------------------------------------------

	private menuKey(key: string): boolean {
		const spec = getAnimal(this.front().speciesId);
		const { menu, handled, choice } = menuKey(
			{ cursor: battle.cursor, levels: battle.levels },
			key,
			spec
		);
		battle.cursor = menu.cursor;
		if (menu.levels !== battle.levels) battle.levels = menu.levels;
		switch (choice?.kind) {
			case 'attack':
				this.send({ type: 'attack', attackIndex: choice.attackIndex, level: choice.level });
				break;
			case 'leash':
				this.send({ type: 'throw-leash' });
				break;
			case 'switch':
				// With nobody to send in, the row stays put; its text says why.
				if (battle.pickable.some(Boolean)) this.openParty(false);
				break;
			case 'run':
				this.send({ type: 'flee' });
				break;
		}
		return handled;
	}

	/** Show the party list: after a knock-out (`mustPick`, no way back) or from the Switch row. */
	private openParty(mustPick: boolean): void {
		battle.mustPick = mustPick;
		battle.partyCursor = firstPickable(battle.pickable);
		battle.refused = 0;
		this.listAge = 0;
		battle.screen = 'party';
	}

	private partyKey(key: string): boolean {
		const { cursor, handled, choice } = listKey(battle.partyCursor, key, battle.party.length);
		if (cursor !== battle.partyCursor) battle.refused = 0;
		battle.partyCursor = cursor;
		// A list that came up by itself waits a moment before taking a pick.
		if (choice === 'pick' && battle.mustPick && this.listAge < PICK_GUARD_SECONDS) return handled;
		if (choice === 'pick') {
			// The engine would refuse a tired or current animal; say no here instead.
			if (battle.pickable[cursor]) this.send({ type: 'switch', partyIndex: cursor });
			else battle.refused += 1;
		} else if (choice === 'back' && !battle.mustPick) {
			battle.cursor = rowOf('switch', getAnimal(this.front().speciesId).attacks.length);
			battle.screen = 'actions';
		}
		return handled;
	}

	private puzzleKey(key: string): boolean {
		const typed = answerKey(battle.input, key);
		battle.input = typed.input;
		if (typed.submit) this.send({ type: 'answer', input: typed.input });
		return typed.handled;
	}

	// --- narration -----------------------------------------------------------

	/**
	 * Turn one battle event into beats. Names are resolved when the beat runs,
	 * against the view as it stands then, so a switch earlier in the same
	 * turn is reflected. `replacing` says the intent picked who replaces a
	 * tired animal, so a switch calls nobody back.
	 */
	private narrate(e: BattleEvent, replacing: boolean): Beat[] {
		const scene = this.scene!;
		switch (e.type) {
			case 'puzzle-shown':
				return []; // `settle` shows the puzzle once the beats have played
			case 'answer-judged':
				// The right answer is never shown (UI_SPEC): the kid meets the puzzle again.
				return [
					{
						run: () => {
							battle.judged = { correct: e.correct };
							return line(e.correct ? 'puzzle.correct' : 'puzzle.notQuite');
						},
						hold: 1.0
					}
				];
			case 'hit': {
				const target: BattleSide = e.attacker === 'player' ? 'opponent' : 'player';
				const wild = e.attacker === 'opponent';
				// Who attacked is read when the beat runs: a switch earlier in the turn counts.
				let who: AnimalInstance;
				return [
					{
						run: () => {
							scene.lunge(e.attacker);
							who = this.animalOn(e.attacker);
							const attack = { speciesId: who.speciesId, attackIndex: e.attackIndex };
							return line(wild ? 'battle.wildUsed' : 'battle.used', { animal: who, attack });
						},
						hold: 0.35
					},
					{
						run: () => {
							scene.shake(target);
							if (target === 'opponent') {
								battle.opponent = { ...battle.opponent!, hp: e.targetHp };
							} else {
								battle.party = battle.party.map((a, i) =>
									i === battle.front ? { ...a, hp: e.targetHp } : a
								);
							}
							battle.hit = { side: target, damage: e.damage, n: ++this.hits };
							const attack = { speciesId: who.speciesId, attackIndex: e.attackIndex };
							return line(wild ? 'battle.wildUsedDamage' : 'battle.usedDamage', {
								animal: who,
								attack,
								damage: e.damage
							});
						},
						hold: 1.2
					}
				];
			}
			case 'missed':
				if (e.attacker === 'player') {
					return [
						{
							run: () => {
								scene.lunge('player');
								scene.puff('opponent');
								return line('battle.youMissed', { animal: battle.opponent! });
							},
							hold: 1.3
						}
					];
				}
				{
					// A wild animal facing one its own size or bigger sometimes misses.
					const wild = battle.opponent!;
					const attack = { speciesId: wild.speciesId, attackIndex: e.attackIndex };
					return [
						{
							run: () => {
								scene.lunge('opponent');
								return line('battle.wildUsed', { animal: wild, attack });
							},
							hold: 0.35
						},
						{
							run: () => {
								scene.puff('player');
								return line('battle.wildMissed', { animal: wild, attack });
							},
							hold: 1.2
						}
					];
				}
			case 'fainted':
				return [
					{
						run: () => {
							scene.faint(e.side);
							return line(e.side === 'opponent' ? 'battle.wildTired' : 'battle.tired', {
								animal: e.animal
							});
						},
						hold: 1.2
					}
				];
			case 'switched': {
				const enter: Beat = {
					run: () => {
						battle.front = e.partyIndex;
						battle.cursor = 0; // a new animal's menu starts at its first attack
						scene.setFigure('player', e.animal.speciesId);
						scene.appear('player');
						return line('battle.go', { animal: e.animal });
					},
					hold: 1.0
				};
				if (replacing) return [enter];
				const leave: Beat = {
					run: () => {
						scene.recall('player');
						return line('battle.switch.comeBack', { animal: this.front() });
					},
					hold: 0.9
				};
				return [leave, enter];
			}
			case 'leash-thrown':
				return [
					{
						run: () => {
							scene.throwLeash();
							return line('battle.leash.throw');
						},
						hold: 1.8
					},
					{
						run: () => {
							scene.leashResult(e.success);
							return line(e.success ? 'battle.leash.caught' : 'battle.leash.brokeFree');
						},
						hold: 1.2
					}
				];
			case 'fled':
				return [{ run: () => line('battle.gotAway'), hold: 0.8 }];
			case 'ended':
				return []; // `settle` shows the result card
			case 'rejected':
				console.warn(`battle intent rejected: ${e.reason}`);
				return [];
		}
	}

	private front(): AnimalInstance {
		return battle.party[battle.front] ?? battle.party[0]!;
	}

	private animalOn(side: BattleSide): AnimalInstance {
		return side === 'player' ? this.front() : battle.opponent!;
	}
}
