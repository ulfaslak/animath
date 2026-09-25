import { LocalAuthority, partyFromParam } from './src/authority/local';
import type { GameEvent, BattleIntent } from '@mathgame/engine';
const [partyParam, ...plan] = process.argv.slice(2);
const a = new LocalAuthority({ party: partyParam && partyParam !== '-' ? partyFromParam(partyParam) : undefined });
const events: GameEvent[] = [];
a.subscribe((e) => events.push(e));
a.start();
let steps = 0;
while (!events.some((e) => e.type === 'battle-started')) { a.dispatch({ type: 'move', dir: steps % 2 === 0 ? 'left' : 'right' }); steps++; }
const started = events.find((e) => e.type === 'battle-started')!;
if (started.type === 'battle-started') console.log(`battle at step ${steps}: ${started.state.opponent.speciesId} ${started.state.opponent.hp}hp vs ${started.state.party[started.state.active]!.speciesId}`);
for (const p of plan) {
  const [n, level] = p.split('@').map(Number);
  a.dispatch({ type: 'battle', intent: { type: 'attack', attackIndex: n!, level: level as 1 | 2 | 3 } as BattleIntent });
  const shown = [...events].reverse().find((e) => e.type === 'battle-updated')!;
  if (shown.type !== 'battle-updated') break;
  const ps = shown.events.find((e) => e.type === 'puzzle-shown');
  if (!ps || ps.type !== 'puzzle-shown') { console.log('no puzzle', JSON.stringify(shown.events)); break; }
  console.log(`attack ${n} level ${level}: ${ps.puzzle.prompt} = ${ps.puzzle.answer}`);
  a.dispatch({ type: 'battle', intent: { type: 'answer', input: String(ps.puzzle.answer) } });
  const after = [...events].reverse().find((e) => e.type === 'battle-updated')!;
  if (after.type === 'battle-updated') console.log(`  -> wild ${after.state.opponent.hp}hp, mine ${after.state.party[after.state.active]!.hp}hp, phase ${after.state.phase.kind}; ${after.events.map((e) => e.type).join(',')}`);
}
