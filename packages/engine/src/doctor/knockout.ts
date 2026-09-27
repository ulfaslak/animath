import { canFightIn, getAnimal } from '../animals/catalog.js';
import { REALMS, type AnimalInstance, type Realm } from '../animals/types.js';
import { WorldEdits } from '../world/edits.js';
import { TENT_SEARCH_STEPS, nearestTent } from '../world/tents.js';
import { NO_GEAR, type Gear, type GridPos } from '../world/types.js';
import { needsDoctor, validateParty } from './party.js';

/**
 * The knock-out rule: what a battle that ends `lost` leaves.
 *
 * Nobody is healed and nobody is moved. The player is back exploring on the
 * tile the battle was fought on, every animal with the HP the battle left it,
 * and walks (or sails) to a doctor, who heals as always, one puzzle a kind.
 * Until then the team needs the doctor (`needsDoctor`): nothing challenges it
 * where nobody can fight (`rollEncounterFor`), and the way to the nearest
 * tent is `nearestTent`'s.
 *
 * One exception keeps a kid from being stranded with a team that can't
 * battle: when no tent is within `TENT_SEARCH_STEPS` of the player, the way
 * they get about (walled in, or simply no tent that close), a doctor comes to
 * them and looks after the whole party where they stand (`doctorComes`). A
 * loaded save asks the same (`restoreGame`).
 */
export interface KnockOut {
	/**
	 * The whole party, in the same order: as the battle left it, or every
	 * animal at full HP when a doctor came. What is said about it is the
	 * client's to word, from `doctorCame`.
	 */
	party: AnimalInstance[];
	/** No tent was within reach, so a doctor came to the player and looked after everyone. */
	doctorCame: boolean;
}

export interface KnockOutOptions {
	/** What the player carries: with the boat the way to a tent may cross water. */
	gear?: Gear;
	/**
	 * Where the battle was fought, land by default. Out on the water a battle
	 * is lost once every animal that swims is tired: animals that can't swim
	 * may still be standing, in the boat, and then the team can still battle
	 * on land and no doctor comes.
	 */
	realm?: Realm;
}

/**
 * Call on `ended { outcome: 'lost' }` with the world seed, the tile the battle
 * was fought on and the battle's final party: every animal that could fight
 * there knocked out; and the tiles the player has cleared, so a path they
 * chopped counts as a path.
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
	const doctorCame = doctorComes(seed, pos, party, edits, options);
	return {
		party: party.map((a) => (doctorCame ? { ...a, hp: getAnimal(a.speciesId).maxHp } : { ...a })),
		doctorCame
	};
}

/**
 * Whether a doctor comes to the player standing on `pos` in `realm` (land by
 * default): the team needs the doctor there (`needsDoctor`), and no tent is
 * within `TENT_SEARCH_STEPS` of them, the way they get about (on foot, or
 * with the boat over the water too, in the world as `edits` leave it). A
 * team that can still battle here, or a tent a kid can walk to, and nobody
 * comes: a lost battle heals nobody.
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
	if (!needsDoctor(party, realm)) return false;
	return nearestTent(seed, pos, TENT_SEARCH_STEPS, edits, options.gear ?? NO_GEAR) === null;
}
