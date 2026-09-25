import { describe, expect, it } from 'vitest';
import { ANIMALS } from '../src/animals/catalog.js';
import { makeParty, makeWild, playBattle, type PlayerModel } from './battle-sim.js';

/**
 * Balance: species × species battles with a scripted player. The assertions
 * pin the claims [[PRODUCT]] §4 makes in prose ("don't face a bear with a
 * squirrel"). Run with `SIM=1` to print the full win-rate tables:
 *
 *   SIM=1 pnpm -F @mathgame/engine exec vitest run test/balance.test.ts
 */
const SEEDS = 200;
const PRINT = Boolean(process.env.SIM);

interface Outcome {
	win: number;
	rounds: number;
}

function simulate(playerId: string, wildId: string, model: PlayerModel): Outcome {
	let wins = 0;
	let rounds = 0;
	for (let seed = 0; seed < SEEDS; seed++) {
		const { state } = playBattle(seed, makeParty([playerId]), makeWild(wildId), model);
		if (state.phase.kind !== 'ended') throw new Error('battle did not end');
		if (state.phase.outcome === 'won') wins++;
		rounds += state.turn;
	}
	return { win: wins / SEEDS, rounds: rounds / SEEDS };
}

const MODELS: Record<string, PlayerModel> = {
	'always right, strongest attack at level 3': { accuracy: 1, policy: 'max' },
	'right 70%, strongest attack at level 3': { accuracy: 0.7, policy: 'max' },
	'always right, weakest attack at level 1': { accuracy: 1, policy: 'min' },
	'right 70%, weakest attack at level 1': { accuracy: 0.7, policy: 'min' }
};

const ids = ANIMALS.map((a) => a.id);
const grids = new Map<string, Map<string, Outcome>>();
for (const [name, model] of Object.entries(MODELS)) {
	const grid = new Map<string, Outcome>();
	for (const p of ids) for (const w of ids) grid.set(`${p}>${w}`, simulate(p, w, model));
	grids.set(name, grid);
}

function cell(name: string, p: string, w: string): Outcome {
	return grids.get(name)!.get(`${p}>${w}`)!;
}

function table(name: string): string {
	const head = `| player \\ wild | ${ids.join(' | ')} |`;
	const sep = `| --- | ${ids.map(() => '---').join(' | ')} |`;
	const rows = ids.map((p) => {
		const cells = ids.map((w) => {
			const { win, rounds } = cell(name, p, w);
			return `${Math.round(win * 100)}% (${rounds.toFixed(1)})`;
		});
		return `| **${p}** | ${cells.join(' | ')} |`;
	});
	return [`**${name}** — win rate (mean rounds)`, '', head, sep, ...rows].join('\n');
}

describe('balance simulation', () => {
	if (PRINT) {
		it('prints the tables', () => {
			console.log('\n' + [...grids.keys()].map(table).join('\n\n') + '\n');
		});
	}

	it("a squirrel almost never beats a bear, even when it's always right", () => {
		const best = 'always right, strongest attack at level 3';
		expect(cell(best, 'squirrel', 'bear').win).toBeLessThan(0.05);
		expect(cell(best, 'rabbit', 'bear').win).toBeLessThan(0.05);
	});

	it('a bear beats a squirrel almost always, even at 70% accuracy', () => {
		expect(cell('right 70%, strongest attack at level 3', 'bear', 'squirrel').win).toBeGreaterThan(
			0.95
		);
	});

	it('an always-right player beats their own species with its strongest attack', () => {
		for (const id of ids) {
			expect(
				cell('always right, strongest attack at level 3', id, id).win,
				`${id} mirror`
			).toBeGreaterThanOrEqual(0.9);
		}
	});

	it('being right more often never hurts', () => {
		for (const policy of ['strongest attack at level 3', 'weakest attack at level 1']) {
			for (const p of ids) {
				for (const w of ids) {
					const sure = cell(`always right, ${policy}`, p, w).win;
					const shaky = cell(`right 70%, ${policy}`, p, w).win;
					expect(sure, `${p} vs ${w}, ${policy}`).toBeGreaterThanOrEqual(shaky - 0.05);
				}
			}
		}
	});

	it('a stronger attack at a higher level never hurts an always-right player', () => {
		for (const p of ids) {
			for (const w of ids) {
				const strong = cell('always right, strongest attack at level 3', p, w).win;
				const weak = cell('always right, weakest attack at level 1', p, w).win;
				expect(strong, `${p} vs ${w}`).toBeGreaterThanOrEqual(weak - 0.05);
			}
		}
	});
});
