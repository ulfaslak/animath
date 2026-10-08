import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { getAnimal, isWalkable, landSeed, saveDocument, step, tileAtWorld, type Direction } from '@mathgame/engine';
import { LocalAuthority } from '../src/authority/local';
const TARGETS = (process.env.TARGETS ?? 'reindeer,snowy-owl,great-grey-owl,glaucous-gull,giant-petrel,king-penguin,arctic-wolf,gyrfalcon,emperor-penguin,albatross,polar-bear,musk-ox').split(',');
const DIRS: Direction[] = ['up', 'down', 'left', 'right'];
const back: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };
it('find', () => {
	const seed = landSeed('arctic', 1);
	const base = (() => { const a = new LocalAuthority({ land: 'arctic', party: [{ id: 'p0', speciesId: 'arctic-fox', hp: 48 }] }); a.start(); return a.snapshot(); })();
	for (const t of TARGETS) {
		const spec = getAnimal(t);
		const lead = process.env.LEAD ?? t;
		const party = [{ id: 'p1', speciesId: lead, hp: getAnimal(lead).maxHp }];
		let found = false;
		const cand: { x: number; y: number; d: number }[] = [];
		for (let y = -120; y <= 120 && cand.length < 400; y++) for (let x = -120; x <= 120; x++) {
			const tile = tileAtWorld(seed, x, y);
			if (tile.kind === 'deepsnow' && spec.habitats.includes(tile.biome)) cand.push({ x, y, d: Math.abs(x - 5) + Math.abs(y - 9) });
		}
		cand.sort((a, b) => a.d - b.d);
		for (const c of cand.slice(0, 40)) {
			for (const dir of DIRS) {
				const from = step(c, back[dir]);
				const ft = tileAtWorld(seed, from.x, from.y);
				if (!isWalkable(ft.kind) || ft.kind === 'deepsnow' || ft.kind === 'ice') continue;
				for (let steps = 0; steps < 400 && !found; steps++) {
					const game = { ...base, party, seen: [lead], caught: [lead], pos: from, facing: dir, steps };
					const a = new LocalAuthority({});
					a.start({ game });
					let wild: string | null = null;
					a.subscribe((e) => { if (e.type === 'battle-started') wild = e.state.opponent.speciesId; });
					a.dispatch({ type: 'move', dir });
					if (wild === t) {
						found = true;
						const doc = saveDocument(game, { lineage: 'zz', seq: 1 });
						writeFileSync('/private/tmp/claude-501/-Users-cookie-git-mathgame/224411d4-2b89-49cb-865f-345365700d41/scratchpad/save-' + t + '.json', JSON.stringify({ 'animath.save': doc }));
						console.log('FOUND', t, 'lead', lead, 'at', JSON.stringify(from), dir, 'steps', steps, ft.kind, tileAtWorld(seed, c.x, c.y).biome);
					}
				}
				if (found) break;
			}
			if (found) break;
		}
		if (!found) console.log('NOTFOUND', t);
	}
}, 600000);
