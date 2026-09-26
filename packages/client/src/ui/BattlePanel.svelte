<script lang="ts">
	import {
		ATTACK_LEVELS,
		MAX_PARTY,
		attackDamage,
		catchProbability,
		getAnimal,
		puzzleDifficulty,
		puzzleTopics,
		type AttackLevel,
		type PuzzleTopic
	} from '@mathgame/engine';
	import { actionAt, attackRows, levelWord, rowOf } from '../battle/menu';
	import { t } from '../copy';
	import { levelKey, press, rowKey, unfocusable } from '../input/press';
	import { touch } from '../input/touch.svelte';
	import { kindList } from '../kinds';
	import { messageWords, words } from '../lines';
	import { animalWords, nameOf } from '../names';
	import { battle } from '../state/battle.svelte';
	import HpBar from './HpBar.svelte';
	import PuzzlePanel from './PuzzlePanel.svelte';

	/**
	 * The battle screen's overlay: status boxes over the scene, a narration
	 * line, the two-column bottom panel (actions or the party list | puzzle)
	 * and the result card. Everything it shows comes from `battle` (the
	 * presentation view) and every word from the copy files; keys are handled
	 * by `BattleController`, so nothing here dispatches. A click or a tap is a
	 * key press (`input/press.ts`): a row is its `row:<i>` key and a level
	 * button its `level:<n>`, which only highlight and set, since a pick spends
	 * the turn; Go is Enter, which does the highlighted row; Back is Escape;
	 * and the result card, all of it, is Enter.
	 */
	const front = $derived(battle.party[battle.front] ?? null);
	const spec = $derived(front ? getAnimal(front.speciesId) : null);
	const opponent = $derived(battle.opponent);
	const opponentSpec = $derived(opponent ? getAnimal(opponent.speciesId) : null);
	/** Each attack with its own level and that level's word. */
	const rows = $derived(spec ? attackRows(spec, battle.levels) : []);
	/** Someone could step in; with nobody, the Switch row is greyed and says why. */
	const canSwitch = $derived(battle.pickable.some(Boolean));
	/**
	 * No room for a caught animal: the team already has `MAX_PARTY`, so a catch
	 * goes home. The Leash row says so in words, in place of the odds.
	 */
	const teamFull = $derived(battle.party.length >= MAX_PARTY);
	/** Go on the highlighted row would do nothing: a greyed Switch, or an animal that can't step in. */
	const goIdle = $derived(
		battle.screen === 'party'
			? !battle.pickable[battle.partyCursor]
			: !!spec && battle.cursor === rowOf('switch', spec.attacks.length) && !canSwitch
	);

	/** A tap on attack row `i`: on one of its level buttons, that level; anywhere else, the row. */
	function tapAttack(i: number) {
		return (e: MouseEvent) => {
			const level = (e.target as HTMLElement).closest<HTMLElement>('[data-level]')?.dataset.level;
			press(level ? levelKey(Number(level) as AttackLevel) : rowKey(i));
		};
	}

	/** "adding, taking away, or missing numbers": the language's own "or" list. */
	function kindWords(topics: readonly PuzzleTopic[]): string {
		return kindList(topics, 'disjunction');
	}

	/** What the highlighted row of the action menu does: an attack, the leash, a switch or running. */
	const action = $derived(spec ? actionAt(battle.cursor, spec.attacks.length) : null);
	/** The highlighted row can't be done (a greyed Switch): Enter and Go do nothing there. */
	const greyed = $derived(action?.kind === 'switch' && !canSwitch);

	/** What the highlighted row will do, in words a kid can read. */
	const detail = $derived.by(() => {
		if (!spec || !action || !opponent) return '';
		if (action.kind === 'attack') {
			const row = rows[action.index - 1]!;
			const damage = attackDamage(spec, row.index, row.level, true);
			// What the puzzles at this level can actually be, from the engine: a hard
			// missing number can sit in a times table, and then it says so.
			const difficulty = puzzleDifficulty(spec.tier, row.index, row.level);
			const kinds = kindWords(puzzleTopics(spec.attacks[row.index - 1]!.kinds, difficulty));
			return t('battle.attackDetail', {
				attack: row.name,
				level: row.word,
				kinds,
				damage,
				animal: animalWords(opponent)
			});
		}
		if (action.kind === 'leash') {
			return teamFull
				? t('battle.leash.teamFullDetail')
				: t('battle.leash.detail', { animal: animalWords(opponent) });
		}
		if (action.kind === 'switch') {
			if (canSwitch) return t('battle.switch.detail');
			return battle.party.length < 2 ? t('battle.switch.alone') : t('battle.switch.allTired');
		}
		return t('battle.run.detail', { animal: animalWords(opponent) });
	});

	/** The puzzle area's title for the highlighted row: what picking it does. */
	const rowTitle = $derived.by(() => {
		switch (action?.kind) {
			case 'leash':
				return t('battle.menu.leash');
			case 'switch':
				return t('battle.menu.switch');
			case 'run':
				return t('battle.menu.run');
			default:
				return t('battle.menu.attack');
		}
	});

	/**
	 * The key reminder for the highlighted row: left and right only on an
	 * attack row (the only one with a level), and no Enter where it does
	 * nothing. With the touch controls on, a tap hint instead; on a greyed
	 * row, where Go does nothing, the way to an attack.
	 */
	const rowKeys = $derived.by(() => {
		if (touch.on) {
			return action?.kind === 'attack' || greyed
				? t('battle.menu.touchAttack')
				: t('battle.menu.touch');
		}
		if (action?.kind === 'attack') return t('battle.menu.keysAttack');
		return greyed ? t('battle.menu.keysGreyed') : t('battle.menu.keys');
	});

	/** What picking the highlighted animal of the party list would do. */
	const partyDetail = $derived.by(() => {
		const animal = battle.party[battle.partyCursor];
		if (!animal || !opponent) return '';
		const params = { animal: animalWords(animal) };
		if (battle.pickable[battle.partyCursor]) {
			return battle.mustPick
				? t('battle.switch.sendInFree', params)
				: t('battle.switch.sendIn', params);
		}
		return animal.hp === 0 ? t('battle.switch.tired', params) : t('battle.switch.inBattle', params);
	});

	/**
	 * The leash row hints at the real odds — the engine's `catchProbability`
	 * for this animal at the HP on screen, with this leash — never as a number
	 * (UI_SPEC): at least one in two is a good chance, at least one in five is
	 * a maybe, anything less is hard. The word says what the colour says.
	 */
	const leashBand = $derived.by(() => {
		if (!opponent || !opponentSpec) return 'bad';
		const hp = opponent.hp / opponentSpec.maxHp;
		const chance = catchProbability(hp, opponentSpec.catchRate, battle.leashQuality);
		return chance >= 0.5 ? 'good' : chance >= 0.2 ? 'warn' : 'bad';
	});

	const headline = $derived.by(() => {
		switch (battle.outcome) {
			case 'won':
				return t('battle.result.won');
			case 'caught':
				// Caught, but the team was full and it went home: a good throw, not a new friend.
				if (battle.letGo) return t('battle.result.letGo');
				return opponent
					? t('battle.result.caught', { animal: animalWords(opponent) })
					: t('battle.leash.caught');
			case 'lost':
				return t('battle.result.lost');
			case 'fled':
				return t('battle.result.fled');
			default:
				return '';
		}
	});
</script>

{#if opponent && opponentSpec}
	<div class="status opponent">
		<div class="name">{t('battle.wildName', { animal: animalWords(opponent) })}</div>
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
		<!-- A fresh bar per animal: the one that left must not slide into the newcomer's. -->
		{#key front.id}
			<HpBar hp={front.hp} max={spec.maxHp} />
		{/key}
		{#if battle.hit?.side === 'player'}
			{#key battle.hit.n}
				<div class="damage">−{battle.hit.damage}</div>
			{/key}
		{/if}
	</div>
{/if}

{#if battle.line}
	<div class="battle-line">{words(battle.line)}</div>
{/if}

<div class="panel" class:listing={battle.screen === 'party'}>
	{#if battle.screen === 'party'}
		<div class="card actions party">
			{#key battle.refused}
				{#each battle.party as animal, i (animal.id)}
					{@const selected = battle.partyCursor === i}
					<button
						type="button"
						class="row"
						class:selected
						class:off={!battle.pickable[i]}
						class:nudge={selected && battle.refused > 0}
						onclick={() => press(rowKey(i))}
						{@attach unfocusable}
					>
						<span class="caret">▸</span>
						<span class="label">{nameOf(animal)}</span>
						<span class="hp-cell"
							><HpBar hp={animal.hp} max={getAnimal(animal.speciesId).maxHp} /></span
						>
						<span class="how">
							{#if animal.hp === 0}
								{t('battle.switch.tiredTag')}
							{:else if i === battle.front}
								{t('battle.switch.inBattleTag')}
							{/if}
						</span>
					</button>
				{/each}
			{/key}
		</div>
	{:else}
		<div class="card actions" class:dim={battle.screen !== 'actions'}>
			{#if spec}
				{#each rows as row, i (row.index)}
					<button
						type="button"
						class="row"
						class:selected={battle.cursor === i}
						onclick={tapAttack(i)}
						{@attach unfocusable}
					>
						<span class="caret">▸</span>
						<span class="label">{row.name}</span>
						{#if battle.cursor === i}
							<!-- Each level button's box runs the row's height and meets the next, so a
							     finger that lands near one presses it, not the row. -->
							<span class="levels">
								{#each ATTACK_LEVELS as level (level)}
									<span class="pill" class:on={row.level === level} data-level={level}
										><span class="face">{levelWord(level)}</span></span
									>
								{/each}
							</span>
						{:else}
							<span class="how">{row.word}</span>
						{/if}
					</button>
				{/each}
				<button
					type="button"
					class="row"
					class:selected={battle.cursor === spec.attacks.length}
					onclick={() => press(rowKey(spec.attacks.length))}
					{@attach unfocusable}
				>
					<span class="caret">▸</span>
					<span class="label">{t('battle.leash.row')}</span>
					<span class="how">
						{#if teamFull}
							{t('battle.leash.teamFull')}
						{:else if leashBand === 'good'}
							{t('battle.leash.good')}
						{:else if leashBand === 'warn'}
							{t('battle.leash.maybe')}
						{:else}
							{t('battle.leash.hard')}
						{/if}
					</span>
					<!-- The dot is the odds; with the team full the odds don't matter, so no dot. -->
					{#if !teamFull}
						<span class="dot {leashBand}"></span>
					{/if}
				</button>
				<button
					type="button"
					class="row"
					class:selected={battle.cursor === rowOf('switch', spec.attacks.length)}
					class:off={!canSwitch}
					onclick={() => press(rowKey(rowOf('switch', spec.attacks.length)))}
					{@attach unfocusable}
				>
					<span class="caret">▸</span>
					<span class="label">{t('battle.switch.row')}</span>
				</button>
				<button
					type="button"
					class="row"
					class:selected={battle.cursor === rowOf('run', spec.attacks.length)}
					onclick={() => press(rowKey(rowOf('run', spec.attacks.length)))}
					{@attach unfocusable}
				>
					<span class="caret">▸</span>
					<span class="label">{t('battle.run.row')}</span>
				</button>
			{/if}
		</div>
	{/if}

	<div class="card puzzle" class:correct={battle.judged?.correct === true}>
		{#if battle.puzzle}
			<PuzzlePanel
				puzzle={battle.puzzle}
				input={battle.input}
				judged={battle.judged}
				typing={battle.screen === 'puzzle'}
			/>
		{:else if battle.screen === 'party'}
			<div class="soft">{t('battle.switch.title')}</div>
			<div class="detail">{partyDetail}</div>
			<div class="footer">
				<div class="keys">
					{touch.on
						? t('battle.switch.touch')
						: battle.mustPick
							? t('battle.switch.mustPickKeys')
							: t('battle.switch.keys')}
				</div>
				<div class="buttons">
					{#if !battle.mustPick}
						<button
							type="button"
							class="pill-button"
							onclick={() => press('Escape')}
							{@attach unfocusable}
						>
							{t('battle.backButton')}
							{#if !touch.on}<kbd>{t('keys.esc')}</kbd>{/if}
						</button>
					{/if}
					<button
						type="button"
						class="pill-button go"
						class:idle={goIdle}
						onclick={() => press('Enter')}
						{@attach unfocusable}
					>
						{t('battle.goButton')}
						{#if !touch.on}<kbd>{t('keys.enter')}</kbd>{/if}
					</button>
				</div>
			</div>
		{:else}
			<div class="soft">{rowTitle}</div>
			<div class="detail">{detail}</div>
			<div class="footer">
				<div class="keys">{rowKeys}</div>
				<div class="buttons">
					<button
						type="button"
						class="pill-button go"
						class:idle={goIdle || battle.screen !== 'actions'}
						onclick={() => press('Enter')}
						{@attach unfocusable}
					>
						{t('battle.goButton')}
						{#if !touch.on}<kbd>{t('keys.enter')}</kbd>{/if}
					</button>
				</div>
			</div>
		{/if}
	</div>
</div>

{#if battle.screen === 'result'}
	<!-- All of it is the button: a tap anywhere goes on, as Enter does (and waits as Enter waits). -->
	<button type="button" class="result" onclick={() => press('Enter')} {@attach unfocusable}>
		<span class="card result-card">
			<span class="result-title">{headline}</span>
			{#if battle.closing}
				<span class="result-text">{messageWords(battle.closing)}</span>
			{/if}
			<span class="button">
				{t('battle.result.button')}
				{#if !touch.on}<kbd>{t('keys.enter')}</kbd>{/if}
			</span>
		</span>
	</button>
{/if}

<style>
	/* Wide enough for a twelve-letter nickname of the widest letters (WWWWWWWWWWWW is 242 px). */
	.status {
		position: absolute;
		width: 280px;
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
	/*
	 * The party list takes the wider side: each row holds a name of up to
	 * twelve letters, an HP bar and a tag, and the card beside it only a
	 * sentence and two buttons.
	 */
	.panel.listing {
		grid-template-columns: 3fr minmax(300px, 2fr);
	}
	/* Below the supported sizes, give the attack names the room before the puzzle. */
	@media (max-width: 900px) {
		.panel,
		.panel.listing {
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
		width: 100%;
		box-sizing: border-box;
		min-height: 32px;
		padding: 0 10px;
		border-radius: 12px;
		font-weight: 800;
		font-size: 18px;
	}
	.row.selected {
		background: rgba(255, 159, 67, 0.22);
	}
	/* Touch: every row a finger tall, seven of them in the taller panel (styles.css). */
	:global(.touch) .actions {
		gap: 0;
		padding: 6px 12px;
	}
	:global(.touch) .row {
		flex: 0 0 var(--tap);
		min-height: var(--tap);
	}
	/* A mouse over a row it can press. Never on touch, where hover sticks after a tap. */
	@media (hover: hover) and (pointer: fine) {
		.actions:not(.dim) .row:not(.selected):hover {
			background: rgba(255, 159, 67, 0.1);
		}
		.pill:hover .face {
			box-shadow: inset 0 0 0 2px var(--accent);
		}
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
		align-self: stretch;
	}
	/* The button's box (what a finger hits) runs the row's height; its face is the pill drawn. */
	.pill {
		display: grid;
		place-items: center;
		padding: 0 2px;
	}
	.face {
		display: grid;
		place-items: center;
		height: 28px;
		padding: 0 7px;
		border-radius: 14px;
		background: rgba(0, 0, 0, 0.08);
		font-size: 16px;
	}
	:global(.touch) .face {
		height: 36px;
		min-width: 48px;
		box-sizing: border-box;
		border-radius: 18px;
	}
	.row.selected .pill.on .face {
		background: var(--accent);
		color: white;
	}
	/* Nobody to switch to, or an animal that can't step in: still readable, clearly out. */
	.row.off > :not(.caret) {
		opacity: 0.45;
	}
	.hp-cell {
		flex: 0 1 150px;
		min-width: 100px;
	}
	/*
	 * The party list lines its rows up in shared columns — caret, name, HP bar,
	 * tag — sized by the longest name there, so every name shows whole (up to
	 * twelve letters of the widest, at 1024 px) and the bars start together.
	 * A row is a subgrid of the list; a browser without subgrid lays each row
	 * out on its own, in the same columns.
	 */
	.party {
		display: grid;
		grid-template-columns: 16px minmax(0, max-content) minmax(100px, 1fr) auto;
		grid-auto-rows: minmax(32px, 40px);
		align-content: center;
		gap: 2px 8px;
	}
	:global(.touch) .party {
		grid-auto-rows: var(--tap);
		row-gap: 0;
	}
	.party .row {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: 16px minmax(0, max-content) minmax(100px, 1fr) auto;
		grid-template-columns: subgrid;
		min-height: 0;
	}
	.party .how {
		min-width: 4.6em;
		text-align: right;
	}
	.row.nudge {
		animation: nudge 0.35s ease-out;
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
	/*
	 * Go (and Back on the party list), the highlighted row's Enter and the
	 * list's Escape, above the key reminder; with the touch controls on, beside
	 * the reminder at the card's right edge, under the right thumb.
	 */
	.footer {
		display: flex;
		flex-direction: column-reverse;
		align-items: center;
		gap: 10px;
	}
	:global(.touch) .footer {
		flex-direction: row;
		justify-content: space-between;
		align-self: stretch;
		margin-top: 6px;
		text-align: left;
	}
	.buttons {
		display: flex;
		flex: none;
		gap: 12px;
	}
	.pill-button {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		min-height: var(--tap);
		padding: 0 24px;
		border-radius: 24px;
		background: rgba(0, 0, 0, 0.08);
		font-weight: 800;
		font-size: 18px;
	}
	.pill-button kbd {
		background: rgba(0, 0, 0, 0.08);
	}
	.pill-button.go {
		min-width: 120px;
		justify-content: center;
		background: var(--accent);
		color: white;
	}
	.pill-button.go kbd {
		background: rgba(255, 255, 255, 0.3);
	}
	/* Pressing it now would do nothing (a greyed Switch, a turn playing), as Enter would. */
	.pill-button.idle {
		opacity: 0.45;
	}
	.pill-button:active {
		transform: scale(0.97);
	}
	.result {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		width: 100%;
		background: rgba(45, 42, 50, 0.25);
	}
	.result-card {
		display: block;
		padding: 28px 40px 32px;
		max-width: min(calc(100vw - 32px), 520px);
		text-align: center;
	}
	.result-title {
		display: block;
		font-weight: 800;
		font-size: 40px;
		line-height: 1.1;
	}
	.result-text {
		display: block;
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

	@keyframes nudge {
		20% {
			transform: translateX(-6px);
		}
		40% {
			transform: translateX(6px);
		}
		60% {
			transform: translateX(-4px);
		}
		80% {
			transform: translateX(3px);
		}
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

	/* Less motion: the damage fades in and out where it is; a refused pick barely nudges. */
	@keyframes pop-still {
		0%,
		100% {
			opacity: 0;
		}
		15%,
		70% {
			opacity: 1;
		}
	}
	@keyframes nudge-small {
		30% {
			transform: translateX(-2px);
		}
		60% {
			transform: translateX(2px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.damage {
			animation-name: pop-still;
		}
		.row.nudge {
			animation-name: nudge-small;
		}
	}
</style>
