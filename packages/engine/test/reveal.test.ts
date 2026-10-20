import { describe, expect, it } from 'vitest';
import { ANIMALS } from '../src/animals/catalog.js';
import type { Biome } from '../src/animals/types.js';
import { meetingPlaces } from '../src/doctor/reveal.js';
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
