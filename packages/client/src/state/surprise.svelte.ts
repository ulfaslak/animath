import { availableLands, type GameEvent, type LandId } from '@mathgame/engine';
import { game } from './game.svelte';

/**
 * The witch doctor's surprise ([[UI_SPEC]] § Explore mode, "The surprise"):
 * the catch that completes a land (one of each of its animals) opens the next
 * one (`unlocked-changed`), and once the kid is back in the world a party
 * plays over it (`party`) saying the witch doctor has a surprise; from then
 * on, the way to the nearest tent shows (`land`, read by `DoctorWay`) until
 * the kid talks to a witch doctor, who offers the trip (the engine's
 * `surpriseLand`). The party is for the moment it happens: a reload, or a
 * land opened by a save, finds the offer waiting at any tent, with no party
 * and no arrow.
 */

/** Seconds the party stays on screen. */
export const PARTY_SECONDS = 5;

export interface SurpriseParty {
	/** The land caught open. */
	land: LandId;
	/** The land whose every animal was caught: where the kid stands. */
	from: LandId;
}

class SurpriseView {
	/** The land whose trip waits at a tent, while the way there shows; else null. */
	land = $state<LandId | null>(null);
	/** The party on screen; else null. */
	party = $state.raw<SurpriseParty | null>(null);
	/** A party that waits for the world to be on screen: the catch is in a battle. */
	private due: SurpriseParty | null = null;
	private left = 0;

	/** Hear an event before `game.apply`, while `game` still holds the lands unlocked before it. */
	apply(event: GameEvent): void {
		const here = game.land;
		switch (event.type) {
			case 'unlocked-changed': {
				const land = availableLands().find(
					(l) => l !== here && event.unlocked.includes(l) && !game.unlocked.includes(l)
				);
				if (!land) break;
				this.due = { land, from: here };
				this.land = land;
				break;
			}
			case 'doctor-visit-started':
				// At a tent: the witch doctor offers the trip; the way to him is done.
				this.land = null;
				break;
			case 'welcome':
				this.reset();
				break;
			case 'travelled':
				// Another land: the trip was taken (or another way there found). Another world of
				// this land keeps the surprise waiting.
				if (event.playerId === game.playerId && event.land !== here) this.reset();
				break;
		}
	}

	/**
	 * Every frame: `showing` is whether the world is on screen with nothing
	 * over it. Says true the frame the party starts.
	 */
	tick(dt: number, showing: boolean): boolean {
		if (this.party) {
			this.left -= dt;
			if (this.left <= 0) this.party = null;
		}
		if (!this.due || !showing) return false;
		this.party = this.due;
		this.due = null;
		this.left = PARTY_SECONDS;
		return true;
	}

	reset(): void {
		this.land = null;
		this.party = null;
		this.due = null;
		this.left = 0;
	}
}

export const surprise = new SurpriseView();
