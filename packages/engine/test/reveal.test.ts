import { describe, expect, it } from 'vitest';
import { ANIMALS, canFightIn, getAnimal } from '../src/animals/catalog.js';
import type { AnimalInstance, Biome, Realm, Tier } from '../src/animals/types.js';
import { bestLead, meetingPlaces } from '../src/doctor/reveal.js';
import { LAND_IDS, landSeed, type LandId } from '../src/lands/ids.js';
import { getLand } from '../src/lands/lands.js';
import { WILD_RADIUS, encounterTable } from '../src/world/encounters.js';
import { holeTable } from '../src/world/fishing.js';
import { tileAtWorld } from '../src/world/generate.js';
import { spawnPoint } from '../src/world/spawn.js';
import { CHUNK_SIZE, encounterRealm } from '../src/world/types.js';
import { turn } from './turn.js';

type Ground = 'land' | 'water' | 'hole';

/**
 * Which biomes of `land` grow which encounter tile within 8 chunks of World 1's
 * spawn, read off the generated world: tall grass or deep snow (land), deep
 * water (water), a fishing hole (hole). Every biome has a sky.
 */
async function groundsOf(land: LandId): Promise<Map<Biome, Set<Ground>>> {
	const seed = landSeed(land, 1);
	const spawn = spawnPoint(seed);
	const grounds = new Map<Biome, Set<Ground>>();
	const r = 8 * CHUNK_SIZE;
	for (let y = spawn.y - r; y <= spawn.y + r; y += 1) {
		if (y % 32 === 0) await turn();
		for (let x = spawn.x - r; x <= spawn.x + r; x += 2) {
			const tile = tileAtWorld(seed, x, y);
			const ground = tile.kind === 'hole' ? 'hole' : encounterRealm(tile.kind);
			if (ground === null || ground === 'air') continue;
			let set = grounds.get(tile.biome);
			if (!set) grounds.set(tile.biome, (set = new Set()));
			set.add(ground);
		}
	}
	return grounds;
}

const lists = (table: readonly { species: { id: string } }[], id: string) =>
	table.some((e) => e.species.id === id);

describe('meetingPlaces', () => {
	it('names exactly the places the encounter rules meet each animal in, where the map grows them', async () => {
		// Far out, where no visitor comes, and with a lead of its own size, so its bell is whole:
		// a table lists it exactly where it lives.
		const bad: string[] = [];
		for (const land of LAND_IDS) {
			const grounds = await groundsOf(land);
			const biomes = [...grounds.keys()];
			for (const id of getLand(land).species) {
				const spec = ANIMALS.find((a) => a.id === id)!;
				const has = (b: Biome, g: Ground) => grounds.get(b)!.has(g);
				const want = {
					grass: biomes.filter(
						(b) =>
							has(b, 'land') && lists(encounterTable(b, WILD_RADIUS, spec.tier, 'land', land), id)
					),
					sea: biomes.filter(
						(b) =>
							has(b, 'water') && lists(encounterTable(b, WILD_RADIUS, spec.tier, 'water', land), id)
					),
					ice: biomes.filter(
						(b) => has(b, 'hole') && lists(holeTable(b, WILD_RADIUS, spec.tier), id)
					),
					sky: biomes.filter((b) =>
						lists(encounterTable(b, WILD_RADIUS, spec.tier, 'air', land), id)
					)
				};
				const got = meetingPlaces(id);
				for (const key of ['grass', 'sea', 'ice', 'sky'] as const) {
					if ([...got[key]].sort().join() !== want[key].sort().join()) {
						bad.push(`${id} ${key}: says ${got[key]}, met in ${want[key]}`);
					}
				}
				if (Object.values(got).every((places) => places.length === 0)) {
					bad.push(`${id}: met nowhere`);
				}
			}
		}
		expect(bad).toEqual([]);
	}, 120_000);
});

const team = (...ids: string[]): AnimalInstance[] =>
	ids.map((speciesId, i) => ({ id: `t${i}`, speciesId, hp: getAnimal(speciesId).maxHp }));

/** Teams to ask about, with every size and both ways of going there in them somewhere. */
const TEAMS: Record<LandId, string[][]> = {
	nordland: [
		['squirrel'],
		['squirrel', 'fox', 'deer', 'frog'],
		['squirrel', 'wolf', 'bear', 'otter'],
		['crab', 'squirrel', 'mute-swan', 'whale'],
		['rabbit', 'fox', 'deer', 'wolf', 'bear']
	],
	arctic: [
		['arctic-fox'],
		['arctic-fox', 'reindeer', 'puffin'],
		['musk-ox', 'arctic-wolf', 'king-eider', 'emperor-penguin', 'polar-cod']
	]
};

describe('bestLead', () => {
	it('names an animal of the team that can go where the animal is met, whose size meets it most', () => {
		const bad: string[] = [];
		for (const land of LAND_IDS) {
			const biomes = [...new Set(getLand(land).species.flatMap((id) => getAnimal(id).habitats))];
			for (const ids of TEAMS[land]) {
				const party = team(...ids);
				for (const id of getLand(land).species) {
					const spec = getAnimal(id);
					// Read off the tables of every biome, not off `meetingPlaces`: on land in the
					// tall grass for an animal that walks, else in the water, the holes too.
					const realm: Realm = spec.realms.includes('land') ? 'land' : 'water';
					const meets = (lead: Tier) =>
						[0, WILD_RADIUS].reduce(
							(sum, d) =>
								sum +
								biomes.reduce((s, b) => {
									const tables =
										realm === 'land'
											? [encounterTable(b, d, lead, 'land', land)]
											: [encounterTable(b, d, lead, 'water', land), holeTable(b, d, lead)];
									const ok = realm === 'land' ? meetingPlaces(id).grass.includes(b) : true;
									return (
										s +
										(ok
											? tables.reduce(
													(t, table) => t + (table.find((e) => e.species.id === id)?.weight ?? 0),
													0
												)
											: 0)
									);
								}, 0),
							0
						);
					const can = party.filter((a) => canFightIn(a.speciesId, realm));
					const got = bestLead(party, id);
					if (can.length === 0) {
						if (got !== null) bad.push(`${ids} → ${id}: names ${got.index}, nobody can go`);
						continue;
					}
					if (got === null) {
						bad.push(`${ids} → ${id}: names nobody`);
						continue;
					}
					const lead = party[got.index]!;
					if (!canFightIn(lead.speciesId, realm))
						bad.push(`${ids} → ${id}: ${lead.speciesId} can't go`);
					const tier = getAnimal(lead.speciesId).tier;
					for (const other of can) {
						const t = getAnimal(other.speciesId).tier;
						if (meets(t) > meets(tier) + 1e-9) {
							bad.push(`${ids} → ${id}: ${lead.speciesId} meets it less than ${other.speciesId}`);
						}
					}
					if (got.far !== spec.tier > tier) bad.push(`${ids} → ${id}: far is ${got.far}`);
				}
			}
		}
		expect(bad).toEqual([]);
	});

	it('names the first of the best size standing: the lead, when the lead is of that size', () => {
		const party = team('squirrel', 'rabbit', 'fox');
		expect(bestLead(party, 'shrew')).toEqual({ index: 0, leads: true, far: false });
		expect(bestLead([party[2]!, party[1]!], 'shrew')).toEqual({
			index: 1,
			leads: false,
			far: false
		});
		const tired = [{ ...party[0]!, hp: 0 }, party[2]!, party[1]!];
		// The fox leads now; of the small ones the rabbit stands.
		expect(bestLead(tired, 'shrew')).toEqual({ index: 2, leads: false, far: false });
		expect(bestLead([{ ...party[0]!, hp: 0 }], 'shrew')).toEqual({
			index: 0,
			leads: false,
			far: false
		});
	});

	it('sends a small team far out for a big animal, and a team that cannot swim nowhere for a sea one', () => {
		expect(bestLead(team('squirrel'), 'bear')).toEqual({ index: 0, leads: true, far: true });
		expect(bestLead(team('squirrel', 'fox'), 'whale')).toBeNull();
		// Out on the water the frog leads, the first that swims.
		expect(bestLead(team('squirrel', 'frog'), 'whale')).toEqual({
			index: 1,
			leads: true,
			far: true
		});
		// The meadow holds nothing bigger than red deer, so a bear meets them more than a wolf does.
		expect(bestLead(team('wolf', 'bear'), 'deer')).toEqual({ index: 1, leads: false, far: false });
	});
});
