import {
	bundles,
	hasItem,
	isWater,
	leadIndex,
	tileAtWorld,
	type AnimalInstance,
	type Authority,
	type Direction,
	type GameEvent,
	type GridPos,
	type PartyIntent
} from '@mathgame/engine';
import type { Keyboard, TeamPick } from '../input/keyboard';
import { motion } from '../motion';
import { BOAT_SWING_SECONDS } from '../render/boat';
import type { Follower } from '../render/follower';
import type { GameRenderer } from '../render/renderer';
import { doctor } from '../state/doctor.svelte';
import { game } from '../state/game.svelte';
import { team } from '../state/team.svelte';

const STEP_SECONDS = 0.18; // one tile per step; Game Boy pace is ~0.25

/**
 * Explore mode: turns held keys into `move` intents, one per tile, and
 * animates the player mesh between tiles as `player-moved` events arrive.
 * Enter is sent as `interact` (after the keyboard's quiet moment); what came
 * of it is the authority's to say. The party column's picks become party
 * intents: a number key, or a click or tap on a card, `lead-species` for that
 * card's species (its first animal standing goes first); an animal on an
 * open card, `select-lead`; a card dropped at another place, `move-species`.
 * A tap on a card of several animals on a touch screen opens it (`team`),
 * and a step closes it.
 *
 * The lead walks behind the trainer (`render/follower.ts`): it steps onto
 * the tile each step leaves, is put beside the trainer whenever the trainer
 * is put somewhere without walking, and shows whoever leads the party the
 * screen shows (the doctor's card's while it is open, which heals on its
 * beat) where the trainer is: out on the water the first animal that swims,
 * swimming behind the boat, or with none standing, the lead on land riding in
 * the boat once the trainer is in it. Nothing it does goes to the authority.
 *
 * With the boat (`renderer.setBoat`), a step onto the water or back onto land
 * takes `BOAT_SWING_SECONDS` instead of a step's usual time, while the boat
 * swings under the trainer or back onto their back (the usual time with
 * reduced motion, when it snaps).
 */
export class ExploreController {
	private pos: GridPos = { x: 0, y: 0 };
	private from: GridPos = { x: 0, y: 0 };
	private progress = 1; // 0..1 along from → pos
	/** How long the step under way takes: longer onto the water or off it, while the boat swings. */
	private stepSeconds = STEP_SECONDS;
	private facing: Direction = 'down';
	private seed = 0;
	private playerId = '';

	constructor(
		private authority: Authority,
		private renderer: GameRenderer,
		private keyboard: Keyboard,
		private follower: Follower | null = null
	) {}

	handle(event: GameEvent): void {
		switch (event.type) {
			case 'welcome':
				// `welcome` carries the authority's facing (down in a new game, the
				// saved one in a restored game), so after any `welcome` both sides
				// agree about which way the player looks.
				this.playerId = event.playerId;
				this.seed = event.seed;
				this.pos = this.from = event.pos;
				this.progress = 1;
				this.facing = event.facing;
				this.renderer.setWorld(this.seed);
				this.renderer.setBoat(hasItem(event, 'boat'));
				this.renderer.setPlayer(event.pos, event.pos, 1, this.facing);
				this.follower?.place(this.seed, event.pos, this.facing);
				break;
			case 'belongings-changed':
				// Bought at the doctor: it grows onto the trainer's back.
				this.renderer.setBoat(hasItem(event, 'boat'), true);
				break;
			case 'player-moved':
				if (event.playerId !== this.playerId) break;
				// Walking on puts an open card away.
				team.close();
				this.from = this.pos;
				this.pos = event.pos;
				this.progress = 0;
				this.facing = event.dir;
				// Into the boat or out of it: the boat takes its time to swing.
				this.stepSeconds =
					this.onWater(this.from) !== this.onWater(this.pos) && !motion.reduced
						? BOAT_SWING_SECONDS
						: STEP_SECONDS;
				this.follower?.follow(this.from, this.pos);
				break;
			case 'player-blocked':
				if (event.playerId === this.playerId) this.facing = event.dir;
				break;
			case 'player-placed':
				// Put down, not walked: no tween, and the figure keeps its facing.
				if (event.playerId !== this.playerId) break;
				this.pos = this.from = event.pos;
				this.progress = 1;
				this.follower?.place(this.seed, event.pos, this.facing);
				break;
			case 'taken-to-doctor':
				// After a lost battle: beside a tent that can be far away, so no
				// tween; the figure turns to the tent (or down, if a doctor came).
				if (event.playerId !== this.playerId) break;
				this.pos = this.from = event.pos;
				this.progress = 1;
				this.facing = event.dir;
				this.follower?.place(this.seed, event.pos, this.facing);
				break;
			case 'game-left':
				// Quit to the title, which gathers the team round the trainer itself.
				this.follower?.hide();
				break;
		}
	}

	update(dt: number): void {
		this.keyboard.tick(dt);
		// A number key chooses who goes first, at once, even mid-step — and before
		// any step this frame sends: that step can start a battle, and the animal
		// chosen on the same frame must be the one that fights.
		for (let pick = this.keyboard.takeTeamPick(); pick; pick = this.keyboard.takeTeamPick()) {
			this.teamPick(pick);
		}
		if (this.progress < 1) {
			this.progress = Math.min(1, this.progress + dt / this.stepSeconds);
		} else {
			const dir = this.keyboard.takeTap() ?? this.keyboard.heldDirection();
			if (dir) this.authority.dispatch({ type: 'move', dir });
			if (this.keyboard.takeInteract()) this.authority.dispatch({ type: 'interact' });
		}
		this.renderer.setPlayer(this.from, this.pos, this.progress, this.facing);
		this.renderer.ensureChunksAround(this.pos);
		if (this.follower) {
			// The party on screen: the doctor's card heals on its beat, after the authority has.
			const party = doctor.active ? doctor.party : game.party;
			this.leadFollower(this.follower, party);
			this.follower.update(this.progress, dt);
		}
	}

	/**
	 * Who follows where the trainer is: on land the lead; out on the water the
	 * first animal standing that swims, or with none, the lead on land, riding
	 * in the boat once the trainer has stepped into it.
	 */
	private leadFollower(follower: Follower, party: readonly AnimalInstance[]): void {
		const onLand = party[leadIndex(party, 'land')]?.speciesId ?? null;
		if (!this.onWater(this.pos)) {
			follower.lead(onLand);
			return;
		}
		const swimmer = party[leadIndex(party, 'water')];
		if (swimmer) {
			follower.lead(swimmer.speciesId);
			return;
		}
		const boarding = this.progress < 1 && !this.onWater(this.from);
		follower.lead(onLand, !boarding);
	}

	/** Water, shallow or deep, at a tile: where the trainer is in the boat. */
	private onWater(pos: GridPos): boolean {
		return isWater(tileAtWorld(this.seed, pos.x, pos.y).kind);
	}

	/** What the party column asked for, as the authority's party intent or an open card. */
	private teamPick(pick: TeamPick): void {
		switch (pick.kind) {
			case 'place': {
				// The card in that place, as the column shows it (the party is in bundles).
				const bundle = bundles(game.party)[pick.index];
				if (bundle) this.party({ type: 'lead-species', speciesId: bundle.speciesId });
				break;
			}
			case 'bundle':
				this.party({ type: 'lead-species', speciesId: pick.speciesId });
				break;
			case 'animal':
				// Chosen from an open card: the card has done its job.
				team.close();
				this.party({ type: 'select-lead', animalId: pick.animalId });
				break;
			case 'open':
				team.toggle(pick.speciesId);
				break;
			case 'move':
				this.party({ type: 'move-species', speciesId: pick.speciesId, to: pick.to });
				break;
		}
	}

	private party(intent: PartyIntent): void {
		this.authority.dispatch({ type: 'party', intent });
	}
}
