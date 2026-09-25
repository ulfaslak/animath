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
		div: 'sharing out',
		missing: 'missing numbers',
		sequence: 'number patterns',
		sqrt: 'square roots'
	};

	function nameOf(animal: AnimalInstance): string {
		return animal.nickname ?? getAnimal(animal.speciesId).name;
	}

	function difficultyWord(d: number): string {
		return d <= 3 ? 'An easy' : d <= 6 ? 'A medium' : d <= 8 ? 'A hard' : 'A very hard';
	}

	function kindWords(kinds: readonly PuzzleKind[]): string {
		const words = kinds.map((k) => KIND_WORDS[k]);
		if (words.length <= 1) return words.join('');
		return `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`;
	}

	/** What the highlighted row will do, in words a kid can read. */
	const hint = $derived.by(() => {
		if (!spec) return '';
		const action = actionAt(battle.cursor, spec.attacks.length);
		if (action.kind === 'attack') {
			const attack = spec.attacks[action.index - 1]!;
			const damage = attackDamage(spec, action.index, battle.level, true);
			const difficulty = puzzleDifficulty(spec.tier, action.index, battle.level);
			return `${attack.name} at level ${battle.level} hits for ${damage}. ${difficultyWord(difficulty)} puzzle: ${kindWords(attack.kinds)}.`;
		}
		if (action.kind === 'leash') {
			return 'Throw the leash to catch it. It works best when the wild animal is tired.';
		}
		return 'Run away. The wild animal stays in the grass.';
	});

	/** The leash button's colour hints at the odds by HP thirds; never a number. */
	const leashBand = $derived.by(() => {
		if (!opponent || !opponentSpec) return 'bad';
		const fraction = opponent.hp / opponentSpec.maxHp;
		return fraction <= 1 / 3 ? 'good' : fraction <= 2 / 3 ? 'warn' : 'bad';
	});

	const headline = $derived.by(() => {
		switch (battle.outcome) {
			case 'won':
				return 'You won!';
			case 'caught':
				return opponent ? `You caught a ${nameOf(opponent)}!` : 'Caught!';
			case 'lost':
				return 'Everyone is tired.';
			case 'fled':
				return 'You got away!';
			default:
				return '';
		}
	});
</script>

{#if opponent && opponentSpec}
	<div class="status opponent">
		<div class="name">{nameOf(opponent)}</div>
		<HpBar hp={opponent.hp} max={opponentSpec.maxHp} />
	</div>
{/if}

{#if front && spec}
	<div class="status player">
		<div class="name">{nameOf(front)}</div>
		<HpBar hp={front.hp} max={spec.maxHp} />
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
				<span class="dot {leashBand}"></span>
			</div>
			<div class="row" class:selected={battle.cursor === spec.attacks.length + 1}>
				<span class="caret">▸</span>
				<span class="label">Run</span>
			</div>
		{/if}
	</div>

	<div class="card puzzle">
		{#if battle.puzzle}
			<div class="puzzle-prompt">{battle.puzzle.prompt}</div>
			<div
				class="answer"
				class:correct={battle.judged?.correct === true}
				class:wrong={battle.judged?.correct === false}
			>
				{battle.input}<span class="cursor" class:blink={battle.screen === 'puzzle'}></span>
			</div>
			{#if battle.judged}
				<div class="judgement" class:good={battle.judged.correct} class:bad={!battle.judged.correct}>
					{battle.judged.correct ? 'Correct!' : `Not quite! It was ${battle.judged.answer}.`}
				</div>
			{:else}
				<div class="hint">Type the answer, then press Enter</div>
			{/if}
		{:else}
			<div class="soft">Pick an attack</div>
			<div class="hint">{hint}</div>
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
		right: 24px;
		bottom: calc(var(--battle-panel) + 68px);
	}
	.status .name {
		font-weight: 800;
		font-size: 18px;
		margin-bottom: 6px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.battle-line {
		position: absolute;
		bottom: calc(var(--battle-panel) + 12px);
		left: 50%;
		transform: translateX(-50%);
		max-width: min(60vw, 640px);
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
		grid-template-columns: minmax(240px, 2fr) 3fr;
		gap: 12px;
		padding: 0 16px 16px;
		box-sizing: border-box;
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
	.actions.dim {
		opacity: 0.6;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 40px;
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
		overflow: hidden;
		text-overflow: ellipsis;
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
		font-size: 15px;
	}
	.row.selected .pill.on {
		background: var(--accent);
		color: white;
	}
	.dot {
		width: 14px;
		height: 14px;
		border-radius: 7px;
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
	}
	.soft {
		font-weight: 800;
		font-size: 32px;
		opacity: 0.45;
	}
	.hint {
		font-weight: 600;
		font-size: 16px;
		max-width: 34em;
		opacity: 0.85;
	}
	.puzzle-prompt {
		font-weight: 800;
		font-size: clamp(40px, 5.5vh, 60px);
		line-height: 1.1;
		overflow-wrap: anywhere;
	}
	.answer {
		min-width: 5em;
		min-height: 1.3em;
		padding: 2px 16px;
		border-radius: 12px;
		border: 3px solid rgba(0, 0, 0, 0.15);
		background: white;
		font-weight: 800;
		font-size: clamp(32px, 4.5vh, 44px);
		font-variant-numeric: tabular-nums;
		line-height: 1.3;
	}
	.answer.correct {
		border-color: var(--good);
	}
	.answer.wrong {
		border-color: var(--bad);
		animation: shake 0.4s ease-out;
	}
	.cursor {
		display: inline-block;
		width: 3px;
		height: 0.9em;
		margin-left: 2px;
		vertical-align: -0.1em;
		background: transparent;
	}
	.cursor.blink {
		background: var(--panel-ink);
		animation: blink 1s steps(2) infinite;
	}
	.judgement {
		font-weight: 800;
		font-size: 22px;
	}
	.judgement.good {
		color: var(--good);
	}
	.judgement.bad {
		color: var(--bad);
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
		max-width: min(80vw, 520px);
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
		font-size: 14px;
		padding: 2px 8px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.3);
	}

	@keyframes shake {
		0%,
		100% {
			transform: translateX(0);
		}
		25% {
			transform: translateX(-8px);
		}
		75% {
			transform: translateX(8px);
		}
	}
	@keyframes blink {
		to {
			visibility: hidden;
		}
	}
</style>
