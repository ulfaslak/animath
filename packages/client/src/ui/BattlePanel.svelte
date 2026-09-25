<script lang="ts">
	import {
		ATTACK_LEVELS,
		attackDamage,
		getAnimal,
		puzzleDifficulty,
		type AnimalInstance,
		type PuzzleKind
	} from '@mathgame/engine';
	import { actionAt, battle } from '../state/battle.svelte';
	import HpBar from './HpBar.svelte';
	import PuzzlePanel from './PuzzlePanel.svelte';

	/**
	 * The battle screen's overlay: status boxes over the scene, a narration
	 * line, the two-column bottom panel (actions | puzzle) and the result
	 * card. Everything it shows comes from `battle` (the presentation view);
	 * keys are handled by `BattleController`, so nothing here dispatches.
	 */
	const front = $derived(battle.party[battle.front] ?? null);
	const spec = $derived(front ? getAnimal(front.speciesId) : null);
	const opponent = $derived(battle.opponent);
	const opponentSpec = $derived(opponent ? getAnimal(opponent.speciesId) : null);

	const KIND_WORDS: Record<PuzzleKind, string> = {
		add: 'adding',
		sub: 'taking away',
		mul: 'times tables',
		div: 'sharing',
		missing: 'missing numbers',
		sequence: 'number patterns',
		sqrt: 'square roots'
	};

	function nameOf(animal: AnimalInstance): string {
		return animal.nickname ?? getAnimal(animal.speciesId).name;
	}

	/** "a Fox", "an Otter". */
	function withArticle(name: string): string {
		return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`;
	}

	/** How hard a puzzle at engine difficulty `d` (1..10) is, in a word a kid can read. */
	function difficultyWord(d: number): string {
		return d <= 3 ? 'easy' : d <= 6 ? 'medium' : d <= 8 ? 'hard' : 'super hard';
	}

	function kindWords(kinds: readonly PuzzleKind[]): string {
		const words = kinds.map((k) => KIND_WORDS[k]);
		if (words.length <= 1) return words.join('');
		return `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`;
	}

	/** What the highlighted row will do, in words a kid can read. */
	const detail = $derived.by(() => {
		if (!spec) return '';
		const action = actionAt(battle.cursor, spec.attacks.length);
		if (action.kind === 'attack') {
			const attack = spec.attacks[action.index - 1]!;
			const damage = attackDamage(spec, action.index, battle.level, true);
			const word = difficultyWord(puzzleDifficulty(spec.tier, action.index, battle.level));
			return `${attack.name}, level ${battle.level}: ${withArticle(word)} puzzle with ${kindWords(attack.kinds)}. It hits for ${damage}.`;
		}
		if (action.kind === 'leash') {
			return 'Throw the leash to catch it! It works best when its HP is low.';
		}
		return 'Run away. The wild animal stays in the grass.';
	});

	/**
	 * The leash row hints at the odds by the wild animal's HP in thirds
	 * (UI_SPEC), never with a number. The word says what the colour says —
	 * how strong the animal still is — and promises nothing more.
	 */
	const leashBand = $derived.by(() => {
		if (!opponent || !opponentSpec) return 'bad';
		const fraction = opponent.hp / opponentSpec.maxHp;
		return fraction <= 1 / 3 ? 'good' : fraction <= 2 / 3 ? 'warn' : 'bad';
	});
	const LEASH_WORDS = { good: 'weak', warn: 'weaker', bad: 'strong' } as const;

	const headline = $derived.by(() => {
		switch (battle.outcome) {
			case 'won':
				return 'You won!';
			case 'caught':
				return opponent ? `You caught ${withArticle(nameOf(opponent))}!` : 'Caught!';
			case 'lost':
				return 'Good try!';
			case 'fled':
				return 'You got away!';
			default:
				return '';
		}
	});
</script>

{#if opponent && opponentSpec}
	<div class="status opponent">
		<div class="name">Wild {nameOf(opponent)}</div>
		<HpBar hp={opponent.hp} max={opponentSpec.maxHp} />
		{#if battle.hit?.side === 'opponent'}
			{#key battle.hit.n}
				<div class="damage">−{battle.hit.damage}</div>
			{/key}
		{/if}
	</div>
{/if}

{#if front && spec}
	<div class="status player">
		<div class="name">{nameOf(front)}</div>
		<HpBar hp={front.hp} max={spec.maxHp} />
		{#if battle.hit?.side === 'player'}
			{#key battle.hit.n}
				<div class="damage">−{battle.hit.damage}</div>
			{/key}
		{/if}
	</div>
{/if}

{#if battle.line}
	<div class="battle-line">{battle.line}</div>
{/if}

<div class="panel">
	<div class="card actions" class:dim={battle.screen !== 'actions'}>
		{#if spec}
			{#each spec.attacks as attack, i (attack.id)}
				<div class="row" class:selected={battle.cursor === i}>
					<span class="caret">▸</span>
					<span class="label">{attack.name}</span>
					<span class="how">
						{difficultyWord(puzzleDifficulty(spec.tier, i + 1, battle.level))}
					</span>
					<span class="levels">
						{#each ATTACK_LEVELS as level (level)}
							<span class="pill" class:on={battle.level === level}>{level}</span>
						{/each}
					</span>
				</div>
			{/each}
			<div class="row" class:selected={battle.cursor === spec.attacks.length}>
				<span class="caret">▸</span>
				<span class="label">Leash</span>
				<span class="how">{LEASH_WORDS[leashBand]}</span>
				<span class="dot {leashBand}"></span>
			</div>
			<div class="row" class:selected={battle.cursor === spec.attacks.length + 1}>
				<span class="caret">▸</span>
				<span class="label">Run</span>
			</div>
		{/if}
	</div>

	<div class="card puzzle" class:correct={battle.judged?.correct === true}>
		{#if battle.puzzle}
			<PuzzlePanel
				puzzle={battle.puzzle}
				input={battle.input}
				judged={battle.judged}
				typing={battle.screen === 'puzzle'}
			/>
		{:else}
			<div class="soft">Pick an attack</div>
			<div class="detail">{detail}</div>
			<div class="keys">↑ ↓ choose · ← → level · Enter go</div>
		{/if}
	</div>
</div>

{#if battle.screen === 'result'}
	<div class="result">
		<div class="card result-card">
			<div class="result-title">{headline}</div>
			{#if battle.closing}
				<div class="result-text">{battle.closing}</div>
			{/if}
			<div class="button">Keep exploring <kbd>Enter</kbd></div>
		</div>
	</div>
{/if}

<style>
	.status {
		position: absolute;
		width: 240px;
		max-width: calc(50vw - 24px);
		box-sizing: border-box;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		padding: 10px 16px 12px;
	}
	.status.opponent {
		top: 16px;
		left: 16px;
	}
	.status.player {
		right: 16px;
		bottom: calc(var(--battle-panel) + 72px);
	}
	.status .name {
		font-weight: 800;
		font-size: 18px;
		margin-bottom: 6px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.damage {
		position: absolute;
		right: 14px;
		top: -6px;
		font-weight: 800;
		font-size: 28px;
		color: var(--bad);
		text-shadow:
			0 2px 0 white,
			0 0 6px white;
		pointer-events: none;
		animation: pop 1.1s ease-out forwards;
	}

	.battle-line {
		position: absolute;
		bottom: calc(var(--battle-panel) + 12px);
		left: 50%;
		transform: translateX(-50%);
		width: max-content;
		max-width: min(calc(100vw - 32px), 640px);
		box-sizing: border-box;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		padding: 10px 20px;
		font-weight: 800;
		font-size: 18px;
		text-align: center;
	}

	.panel {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: var(--battle-panel);
		display: grid;
		grid-template-columns: minmax(300px, 2fr) 3fr;
		gap: 12px;
		padding: 0 16px 16px;
		box-sizing: border-box;
	}
	/* Below the supported sizes, give the attack names the room before the puzzle. */
	@media (max-width: 900px) {
		.panel {
			grid-template-columns: 1fr 1fr;
		}
	}
	.card {
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		box-sizing: border-box;
		min-height: 0;
	}

	.actions {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 2px;
		padding: 10px 12px;
		overflow: hidden;
	}
	.actions.dim .row {
		opacity: 0.55;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 0 1 40px;
		min-height: 32px;
		padding: 0 10px;
		border-radius: 12px;
		font-weight: 800;
		font-size: 18px;
	}
	.row.selected {
		background: rgba(255, 159, 67, 0.22);
	}
	.caret {
		width: 16px;
		visibility: hidden;
		color: var(--accent);
	}
	.row.selected .caret {
		visibility: visible;
	}
	.label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.how {
		font-weight: 600;
		font-size: 16px;
		opacity: 0.75;
		white-space: nowrap;
	}
	.levels {
		display: flex;
		gap: 4px;
	}
	.pill {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border-radius: 14px;
		background: rgba(0, 0, 0, 0.08);
		font-size: 16px;
	}
	.row.selected .pill.on {
		background: var(--accent);
		color: white;
	}
	.dot {
		width: 16px;
		height: 16px;
		margin: 0 6px;
		border-radius: 8px;
	}
	.dot.good {
		background: var(--good);
	}
	.dot.warn {
		background: var(--warn);
	}
	.dot.bad {
		background: var(--bad);
	}

	.puzzle {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 12px 20px;
		text-align: center;
		overflow: hidden;
		transition: background-color 0.3s;
	}
	.puzzle.correct {
		background: color-mix(in srgb, var(--good) 22%, var(--panel-bg));
	}
	.soft {
		font-weight: 800;
		font-size: 32px;
		opacity: 0.45;
	}
	.detail {
		font-weight: 600;
		font-size: 18px;
		max-width: 30em;
	}
	.keys {
		font-weight: 600;
		font-size: 16px;
		opacity: 0.7;
	}
	.result {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgba(45, 42, 50, 0.25);
	}
	.result-card {
		padding: 28px 40px 32px;
		max-width: min(calc(100vw - 32px), 520px);
		text-align: center;
	}
	.result-title {
		font-weight: 800;
		font-size: 40px;
		line-height: 1.1;
	}
	.result-text {
		margin-top: 10px;
		font-weight: 600;
		font-size: 18px;
	}
	.button {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		margin-top: 22px;
		min-height: 48px;
		padding: 0 26px;
		border-radius: 24px;
		background: var(--accent);
		color: white;
		font-weight: 800;
		font-size: 18px;
	}
	kbd {
		font-family: inherit;
		font-size: 16px;
		padding: 2px 8px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.3);
	}

	@keyframes pop {
		0% {
			opacity: 0;
			transform: translateY(8px) scale(0.8);
		}
		15% {
			opacity: 1;
			transform: translateY(0) scale(1.15);
		}
		70% {
			opacity: 1;
			transform: translateY(-10px) scale(1);
		}
		100% {
			opacity: 0;
			transform: translateY(-22px) scale(1);
		}
	}
</style>
