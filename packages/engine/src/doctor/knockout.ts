import { canFightIn, getAnimal } from '../animals/catalog.js';
import { REALMS, type AnimalInstance, type Realm } from '../animals/types.js';
import { WorldEdits, editedTileAt } from '../world/edits.js';
import { TENT_SEARCH_STEPS, nearestTent } from '../world/tents.js';
import { NO_GEAR, tileRealm, type Gear, type GridPos } from '../world/types.js';
import { needsDoctor, validateParty } from './party.js';

/**
 * The knock-out rule: what a battle that ends `lost` leaves.
 *
 * Nobody is healed and nobody is moved. The player is back exploring on the
 * tile the battle was fought on (after a battle in the air, the one the
 * glider came down on), every animal with the HP the battle left it, and
 * walks (or sails) to a doctor, who heals as always, one puzzle a kind.
 * Until then the team needs the doctor (`needsDoctor`): nothing challenges it
 * where nobody can fight (`rollEncounterFor`), and the way to the nearest
 * tent is `nearestTent`'s.
 *
 * One exception keeps a kid from being stranded with a team that can't
 * battle: when no tent is within `TENT_SEARCH_STEPS` of the player, the way
 * they walk or sail (walled in, or simply no tent that close), and they have
 * no paraglider to fly out on, a doctor comes to them and looks after the
 * whole party where they stand (`careFor`). The live game asks it wherever a
 * player is put without walking or flying there: a lost battle, a go-to, a
 * trip to another world. A walk never leaves the ground a tent is reached
 * over, and a glide can always be flown back the way it came, so nothing
 * else asks. It never comes to a kid with the glider (`glider`): a spot no
 * tent is walked to from is reached by gliding in, so a doctor there would
 * make a trip out and back, or a battle lost there on purpose, a full heal
 * for free (the adversarial review of #116), and the glider flies them out.
 * A loaded save never asks, since it holds what the live game left, and
 * asking again there would heal a team the live game kept tired.
 */
export interface KnockOut {
	/**
	 * The whole party, in the same order: as it was (after a battle, as the
	 * battle left it), or every animal at full HP when a doctor came. What is
	 * said about it is the client's to word, from `doctorCame`.
	 */
	party: AnimalInstance[];
	/** No tent was within reach, so a doctor came to the player and looked after everyone. */
	doctorCame: boolean;
}

export interface KnockOutOptions {
	/** What the player carries: with the boat the way to a tent may cross water. */
	gear?: Gear;
	/**
	 * For `knockOut`, where the battle was fought, land by default. Out on the
	 * water a battle is lost once every animal that swims is tired: animals
	 * that can't swim may still be standing, in the boat, and then the team can
	 * still battle on land and no doctor comes. Up in the air, once every
	 * animal that flies is tired, whoever still stands on the ground: the
	 * player is on the tile the glider came down on, and the team is looked at
	 * there, on the ground (or on the water, in the boat), never in the air.
	 * For `careFor` and `doctorComes`, where the player stands. The way to a
	 * tent never flies: it goes from where the player is, on foot, or with the
	 * boat over the water too.
	 */
	realm?: Realm;
	/**
	 * The kid owns the paraglider: wherever they are, they can fly out (a
	 * glide flown back the way it came lands where it took off), so no doctor
	 * comes to them; the way to a tent is theirs to find.
	 */
	glider?: boolean;
}

/**
 * Call on `ended { outcome: 'lost' }` with the world seed, the tile the battle
 * was fought on (a battle in the air: the tile the glider came down on) and
 * the battle's final party: every animal that could fight there knocked out;
 * and the tiles the player has cleared, so a path they chopped counts as a
 * path.
 */
export function knockOut(
	seed: number,
	pos: GridPos,
	party: readonly AnimalInstance[],
	edits: WorldEdits = WorldEdits.none,
	options: KnockOutOptions = {}
): KnockOut {
	const realm = options.realm ?? 'land';
	if (!REALMS.includes(realm)) throw new Error(`knockOut: unknown realm ${String(realm)}`);
	validateParty(party, 'knockOut');
	if (party.length === 0) throw new Error('knockOut: the party is empty');
	if (party.some((a) => a.hp > 0 && canFightIn(a.speciesId, realm))) {
		throw new Error(
			`knockOut: only a party with every animal that fights on ${realm} knocked out has lost`
		);
	}
	// Where the player stands now: where the battle was, but for one in the air, which ends
	// with the kid on the tile the glider came down on, the ground or the water.
	const standing =
		realm === 'air' ? tileRealm(editedTileAt(seed, edits, pos.x, pos.y).kind) : realm;
	return careFor(seed, pos, party, edits, { ...options, realm: standing });
}

/**
 * What a team gets where the player now stands, put there without walking or
 * flying (after a lost battle, a go-to, a trip to another world): every
 * animal at full HP when a doctor comes (`doctorComes`), else the party as it
 * is. Copies either way; the party given is never changed.
 */
export function careFor(
	seed: number,
	pos: GridPos,
	party: readonly AnimalInstance[],
	edits: WorldEdits = WorldEdits.none,
	options: KnockOutOptions = {}
): KnockOut {
	const doctorCame = doctorComes(seed, pos, party, edits, options);
	return {
		party: party.map((a) => (doctorCame ? { ...a, hp: getAnimal(a.speciesId).maxHp } : { ...a })),
		doctorCame
	};
}

/**
 * Whether a doctor comes to the player standing on `pos` in `realm` (land by
 * default): the team needs the doctor there (`needsDoctor`), the kid has no
 * paraglider (`glider`), and no tent is within `TENT_SEARCH_STEPS` of them,
 * the way they get about (on foot, or with the boat over the water too, in
 * the world as `edits` leave it). A team that can still battle here, a kid
 * who can fly out, or a tent a kid can walk to, and nobody comes: a lost
 * battle heals nobody.
 */
export function doctorComes(
	seed: number,
	pos: GridPos,
	party: readonly AnimalInstance[],
	edits: WorldEdits = WorldEdits.none,
	options: KnockOutOptions = {}
): boolean {
	const realm = options.realm ?? 'land';
	if (!REALMS.includes(realm)) throw new Error(`doctorComes: unknown realm ${String(realm)}`);
	if (!needsDoctor(party, realm) || options.glider) return false;
	return nearestTent(seed, pos, TENT_SEARCH_STEPS, edits, options.gear ?? NO_GEAR) === null;
}
