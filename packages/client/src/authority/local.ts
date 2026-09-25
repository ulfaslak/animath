import {
	ANIMALS,
	MAX_PARTY,
	Rng,
	applyBattleIntent,
	applyPartyIntent,
	getAnimal,
	hashInts,
	hashString,
	isWalkable,
	normalizeNickname,
	rollEncounter,
	spawnPoint,
	startBattle,
	step,
	tileAtWorld,
	type AnimalInstance,
	type Authority,
	type BattleEvent,
	type BattleIntent,
	type BattleState,
	type Direction,
	type GameEvent,
	type GridPos,
	type Intent,
	type PartyIntent,
	type PlayerActivity
} from '@mathgame/engine';

import { nameOf } from '../names';

/** The message bar's lines about choosing who goes first, in one place for translation. */
const LEAD_WORDS = {
	chosen: (name: string) => `${name} goes first!`,
	tired: (name: string) => `${name} is tired. Visit the doctor!`,
	already: (name: string) => `${name} already goes first!`
};

export interface LocalAuthorityOptions {
	/** Start with this party instead of the one squirrel: the `?party=` debug hook (`partyFromParam`). */
	party?: readonly AnimalInstance[];
}

/**
 * Salts keep the per-step encounter roll and the battle seed apart from each
 * other and from world generation, which also hashes the world seed.
 */
const ENCOUNTER_SALT = hashString('encounter');
const BATTLE_SALT = hashString('battle');

/**
 * Single-player authority: applies the rules in-process and emits events.
 *
 * This is the seam multiplayer will replace. A `RemoteAuthority` with the same
 * interface will forward intents over a WebSocket and relay the server's
 * events; nothing above this class needs to know which one it is talking to.
 * So: keep game rules in the engine, keep this class thin, and never let the
 * renderer or UI reach past it.
 *
 * Everything random here is seeded from the world seed and the number of
 * completed steps, so a session replays from `(seed, intents)` and a server
 * running the same code would agree with it. The one exception is the id an
 * animal gets when it is caught, which must be unique across sessions and is
 * therefore minted, not derived.
 */
export class LocalAuthority implements Authority {
	private listeners = new Set<(e: GameEvent) => void>();
	private readonly playerId = 'local';
	private readonly seed = hashString('prototype');
	private spawn: GridPos = { x: 0, y: 0 };
	private pos: GridPos = { x: 0, y: 0 };
	private party: AnimalInstance[] = [];
	/** Completed steps this session. Keys the encounter roll and the battle seed. */
	private steps = 0;
	/** The battle in progress, with the seed every intent of it is applied with. */
	private battle: { state: BattleState; seed: number } | null = null;

	constructor(private readonly options: LocalAuthorityOptions = {}) {}

	start(): void {
		this.spawn = spawnPoint(this.seed);
		this.pos = this.spawn;
		this.party = this.options.party?.length
			? this.options.party.map((a) => ({ ...a }))
			: [{ id: 'starter', speciesId: 'squirrel', hp: 20 }];
		this.emit({
			type: 'welcome',
			playerId: this.playerId,
			seed: this.seed,
			pos: this.pos,
			party: this.partyCopy()
		});
	}

	dispatch(intent: Intent): void {
		if (intent.type === 'party') {
			// In any mode: the engine is told what the player is doing and refuses
			// an edit outside explore itself.
			this.editParty(intent.intent);
			return;
		}
		if (this.battle) {
			// Mid-battle there is no walking and no talking; only battle intents count.
			if (intent.type === 'battle') this.applyBattle(intent.intent);
			return;
		}
		switch (intent.type) {
			case 'move':
				this.move(intent.dir);
				break;
			case 'interact':
				this.emit({ type: 'message', text: 'Nothing here yet.' });
				break;
			case 'battle':
				// No battle to act in; the client is showing a result card or is stale.
				break;
		}
	}

	subscribe(listener: (e: GameEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	// --- explore -----------------------------------------------------------

	private move(dir: Direction): void {
		const next = step(this.pos, dir);
		const tile = tileAtWorld(this.seed, next.x, next.y);
		if (!isWalkable(tile.kind)) {
			this.emit({ type: 'player-blocked', playerId: this.playerId, dir });
			return;
		}
		this.pos = next;
		this.steps += 1;
		this.emit({ type: 'player-moved', playerId: this.playerId, pos: next, dir });

		// A party with nobody standing can't battle (`startBattle` refuses it).
		// Unreachable while losing heals everyone; the doctor's rules decide
		// what a tired party meets.
		if (!this.party.some((a) => a.hp > 0)) return;
		// One roll per completed step, keyed by the step count so a replayed
		// walk meets the same animals; the engine only draws on tall grass.
		const rng = new Rng(hashInts(this.seed, ENCOUNTER_SALT, this.steps));
		const wild = rollEncounter(rng, { tile, pos: next, spawn: this.spawn });
		if (wild) this.beginBattle({ ...wild, id: mintId() });
	}

	// --- battle ------------------------------------------------------------

	private beginBattle(wild: AnimalInstance): void {
		const state = startBattle(this.party, wild);
		this.battle = { state, seed: hashInts(this.seed, BATTLE_SALT, this.steps) };
		this.emit({ type: 'battle-started', state });
	}

	private applyBattle(intent: BattleIntent): void {
		const battle = this.battle!;
		const { state, events } = applyBattleIntent(battle.state, intent, battle.seed);
		battle.state = state;
		this.emit({ type: 'battle-updated', state, events });
		if (state.phase.kind !== 'ended') return;
		this.battle = null;
		this.endBattle(state, events);
	}

	/**
	 * Write the battle's result back into the world: HP lost stays lost, a
	 * caught animal joins the party if there is room, and a lost battle heals
	 * everyone and puts the player back on the spawn tile.
	 *
	 * That last one is a placeholder for the knock-out rule (the engine's
	 * `takeToDoctor`, with its `taken-to-doctor` event), which replaces it
	 * when the doctor comes to the client.
	 */
	private endBattle(state: BattleState, events: readonly BattleEvent[]): void {
		if (state.phase.kind !== 'ended') return;
		this.party = state.party.map((a) => ({ ...a }));
		const wildName = getAnimal(state.opponent.speciesId).name;
		let text: string;
		switch (state.phase.outcome) {
			case 'won':
				text = `The wild ${wildName} runs home to rest.`;
				break;
			case 'fled':
				text = `The wild ${wildName} stays in the grass.`;
				break;
			case 'caught': {
				// The reducer always reports the caught animal on `ended`.
				const ended = events.find((e) => e.type === 'ended');
				const caught = ended?.type === 'ended' ? ended.caught : undefined;
				if (caught && this.party.length >= MAX_PARTY) {
					text = `Your team is full, so ${wildName} goes back into the grass.`;
				} else {
					if (caught) this.party.push({ ...caught });
					text = `${wildName} joins your team!`;
				}
				break;
			}
			case 'lost':
				this.party = this.party.map((a) => ({ ...a, hp: getAnimal(a.speciesId).maxHp }));
				this.pos = this.spawn;
				text = 'Everyone is tired. You rest and feel better.';
				break;
		}
		this.emit({ type: 'battle-ended', state });
		this.emit({ type: 'party-changed', party: this.partyCopy() });
		if (state.phase.outcome === 'lost') {
			this.emit({ type: 'player-placed', playerId: this.playerId, pos: this.pos });
		}
		this.emit({ type: 'message', text });
	}

	// --- party ---------------------------------------------------------------

	private editParty(intent: PartyIntent): void {
		const { party, events } = applyPartyIntent(this.party, intent, this.activity());
		this.party = party.map((a) => ({ ...a }));
		this.emit({ type: 'party-edited', party: this.partyCopy(), events });
		// Choosing who goes first gets a line on the message bar, most of all
		// when it can't be done: nothing else on screen would say why.
		for (const e of events) {
			const animal = 'animalId' in e ? this.party.find((a) => a.id === e.animalId) : undefined;
			if (!animal) continue;
			const line =
				e.type === 'lead-selected'
					? LEAD_WORDS.chosen(nameOf(animal))
					: e.type === 'rejected' && e.reason === 'tired'
						? LEAD_WORDS.tired(nameOf(animal))
						: e.type === 'rejected' && e.reason === 'already-lead'
							? LEAD_WORDS.already(nameOf(animal))
							: undefined;
			if (line) this.emit({ type: 'message', text: line });
		}
	}

	/** What the player is doing, for the engine's rules that depend on it. */
	private activity(): PlayerActivity {
		return this.battle ? 'battle' : 'explore';
	}

	// --- helpers -----------------------------------------------------------

	private partyCopy(): AnimalInstance[] {
		return this.party.map((a) => ({ ...a }));
	}

	private emit(event: GameEvent): void {
		for (const l of this.listeners) l(event);
	}
}

/**
 * The `?party=` debug hook: a starting party written as comma-separated
 * `species[:hp[:name]]` entries, e.g. `?party=rabbit,fox:0,bear:40:Big Bear`.
 * Unknown species are skipped, HP is clamped to `0..maxHp` (full when left
 * out), the name is cleaned by the engine, and at most `MAX_PARTY` animals are
 * kept. For looking at the party screens without catching five animals first;
 * a normal start is one squirrel.
 */
export function partyFromParam(param: string): AnimalInstance[] {
	const party: AnimalInstance[] = [];
	for (const entry of param.split(',')) {
		const [speciesId = '', hpText = '', name] = entry.trim().split(':');
		const spec = ANIMALS.find((a) => a.id === speciesId.toLowerCase());
		if (!spec || party.length >= MAX_PARTY) continue;
		const wanted = Math.round(Number(hpText));
		const hp =
			hpText === '' || !Number.isFinite(wanted)
				? spec.maxHp
				: Math.max(0, Math.min(spec.maxHp, wanted));
		const animal: AnimalInstance = { id: `party-${party.length + 1}`, speciesId: spec.id, hp };
		const nickname = normalizeNickname(name);
		if (nickname !== null) animal.nickname = nickname;
		party.push(animal);
	}
	return party;
}

/**
 * A fresh instance id. `crypto.randomUUID` needs a secure context, which a
 * LAN address over plain http is not, so fall back to random bytes there.
 */
function mintId(): string {
	const c = globalThis.crypto;
	if (typeof c.randomUUID === 'function') return c.randomUUID();
	const bytes = c.getRandomValues(new Uint8Array(16));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
