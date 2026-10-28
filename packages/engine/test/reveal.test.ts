import { describe, expect, it } from 'vitest';
import { ANIMALS, canFightIn, getAnimal } from '../src/animals/catalog.js';
import type { AnimalInstance, Biome, Realm, Tier } from '../src/animals/types.js';
import { bestLead, meetingPlaces } from '../src/doctor/reveal.js';
import { LAND_IDS, landSeed, type LandId } from '../src/lands/ids.js';
import { getLand } from '../src/lands/lands.js';
import { WILD_RADIUS, encounterTable, favourUncaught } from '../src/world/encounters.js';
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
					// Its share in each table it is met in (the places `meetingPlaces`, checked above
					// against the maps, names), for a lead of size `lead`, `d` tiles out.
					const places = meetingPlaces(id);
					const at = (lead: Tier, d: number): number[] =>
						biomes.flatMap((b) => {
							const tables =
								realm === 'land'
									? places.grass.includes(b)
										? [encounterTable(b, d, lead, 'land', land)]
										: []
									: [
											...(places.sea.includes(b)
												? [encounterTable(b, d, lead, 'water', land)]
												: []),
											...(places.ice.includes(b) ? [holeTable(b, d, lead)] : [])
										];
							// As the rolls weigh it once the druid has told about it: the team caught,
							// it the kind told last.
							return tables.map(
								(t) => favourUncaught(t, ids, id).find((e) => e.species.id === id)?.weight ?? 0
							);
						});
					const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
					const meets = (lead: Tier) => total(at(lead, 0)) + total(at(lead, WILD_RADIUS));
					const can = party.filter((a) => canFightIn(a.speciesId, realm));
					const got = bestLead(party, id, ids);
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
					// Far only where every place of it is better far out than near home.
					const near = at(tier, 0);
					const out = at(tier, WILD_RADIUS);
					const far = spec.tier > tier && near.every((n, k) => n < out[k]! - 1e-9);
					if (got.far !== far) bad.push(`${ids} → ${id}: far is ${got.far}`);
					const big = tier > spec.tier && meets(spec.tier) >= 2 * meets(tier);
					if (got.big !== big) bad.push(`${ids} → ${id}: big is ${got.big}`);
					const first = party.findIndex((a) => canFightIn(a.speciesId, realm));
					if (got.leads !== (first === got.index))
						bad.push(`${ids} → ${id}: leads is ${got.leads}`);
				}
			}
		}
		expect(bad).toEqual([]);
	});

	it('names the first of the best size, tired or not: the druid heals', () => {
		const party = team('squirrel', 'rabbit', 'fox');
		const small = { realm: 'land', far: false, big: false };
		expect(bestLead(party, 'shrew', [])).toEqual({ index: 0, leads: true, ...small });
		expect(bestLead([party[2]!, party[1]!], 'shrew', [])).toEqual({
			index: 1,
			leads: false,
			...small
		});
		// A tired squirrel in front is still the one: it leads again once it is well.
		const tired = [{ ...party[0]!, hp: 0 }, party[2]!, party[1]!];
		expect(bestLead(tired, 'shrew', [])).toEqual({ index: 0, leads: true, ...small });
		// Behind a tired bear the squirrel does not lead: the bear will, once healed.
		const bear = team('bear', 'squirrel');
		expect(bestLead([{ ...bear[0]!, hp: 0 }, bear[1]!], 'shrew', [])).toEqual({
			index: 1,
			leads: false,
			...small
		});
	});

	it('sends a small team far out for a big animal, a big team for a smaller one, and nobody to sea without a swimmer', () => {
		expect(bestLead(team('squirrel'), 'bear', [])).toEqual({
			index: 0,
			realm: 'land',
			leads: true,
			far: true,
			big: false
		});
		expect(bestLead(team('bear'), 'shrew', [])).toEqual({
			index: 0,
			realm: 'land',
			leads: true,
			far: false,
			big: true
		});
		expect(bestLead(team('squirrel', 'fox'), 'whale', [])).toBeNull();
		// Out on the water the frog leads, the first that swims.
		expect(bestLead(team('squirrel', 'frog'), 'whale', [])).toEqual({
			index: 1,
			realm: 'water',
			leads: true,
			far: true,
			big: false
		});
		// Under a frozen lake the char is alone, whoever leads: no need to go far for it.
		expect(bestLead(team('arctic-fox', 'puffin'), 'arctic-char', [])).toEqual({
			index: 1,
			realm: 'water',
			leads: true,
			far: false,
			big: false
		});
		// Caught already, red deer meet a bear most: the meadow holds nothing bigger than them.
		expect(bestLead(team('wolf', 'bear'), 'deer', ['deer'])).toEqual({
			index: 1,
			realm: 'land',
			leads: false,
			far: false,
			big: false
		});
		// Told about, the wolf: in the forest, where the red deer is now most of its size, a wolf
		// meets it four times as often as a bear, and in the meadow nearly as often.
		expect(bestLead(team('wolf', 'bear'), 'deer', [])).toEqual({
			index: 0,
			realm: 'land',
			leads: true,
			far: false,
			big: false
		});
	});

	it('weighs the places as the rolls do once the druid has told about the animal', () => {
		// Plain, a bear meets the sea eagle more by the river than a wolf; told about, it is the
		// wolf, of its size, that meets it most, so that is the one the tip names.
		const lead = (caught: string[]) => bestLead(team('wolf', 'bear'), 'white-tailed-eagle', caught);
		expect(lead(['wolf', 'bear'])).toMatchObject({ index: 0, leads: true, big: false });
	});
});
