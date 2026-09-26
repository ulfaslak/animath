<script lang="ts">
	import { MAX_NICKNAME_LENGTH, STARTERS, leadIndex, normalizeNickname } from '@mathgame/engine';
	import { sfx } from '../audio/sfx.svelte';
	import { LANGUAGES, language, languageName, t } from '../copy';
	import { languageKey, rowKey, unfocusable } from '../input/press';
	import { touch } from '../input/touch.svelte';
	import { kindList, speciesTopics } from '../kinds';
	import { animalWords, nameOf, speciesName } from '../names';
	import { CONFIRM_CHOICES, title, type ConfirmChoice } from '../state/title.svelte';
	import Switch from './Switch.svelte';

	/**
	 * The title ([[UI_SPEC]] § Title): the name of the game, the menu over the
	 * world where the game stands, the confirm before a new game puts a saved
	 * one away, then the starters (drawn by the 3D stage behind this overlay,
	 * named here at the spots it reports) and the name box. It reads `title`;
	 * keys are `TitleController`'s, so nothing here dispatches. The name box
	 * binds `title.draft` and keeps the focus while it is open. Every word
	 * comes from the copy files.
	 *
	 * A click or a tap is a key press (`data-press`, `input/taps.ts`, which
	 * draws what the tap did before the tap is over, so the name box can bring
	 * up a tablet's keyboard): a menu or confirm
	 * row is its `row:<i>` key (the menu is inert under the confirm, so the two
	 * never answer one key), a language its `language:<code>`, a starter's
	 * tag (and the space over its figure) its `row:<i>`, which lights it; the
	 * card's buttons are Enter and Escape. With the touch controls on, the key
	 * reminders go, and the name box moves to the top, clear of a tablet's
	 * own keyboard.
	 */
	const letters = $derived(Array.from(t('title.name')));
	const saved = $derived(title.saved);
	/** The saved team's first animal that is standing, the one Continue names. */
	const lead = $derived(
		saved ? (saved.party[leadIndex(saved.party)] ?? saved.party[0] ?? null) : null
	);
	const rows = $derived(title.rows);
	const litRow = $derived(title.screen === 'menu' ? rows[title.cursor] : undefined);
	const species = $derived(STARTERS[title.starter] ?? STARTERS[0]!);
	/** The lit starter's forms, for sentences: "your Rabbit", "kaninen". */
	const starter = $derived(animalWords({ speciesId: species }));

	/** What the typed name will turn into, when that is not just what the box shows. */
	const preview = $derived.by(() => {
		// An empty box has its own line: no name, just the species'.
		if (title.screen !== 'naming' || title.draft.trim() === '') return '';
		const clean = normalizeNickname(title.draft) ?? speciesName(species);
		return clean === title.draft.trim().replace(/\s+/g, ' ') ? '' : clean;
	});

	function choiceLabel(choice: ConfirmChoice): string {
		switch (choice) {
			case 'back':
				return t('title.confirm.back');
			case 'yes':
				return t('title.confirm.yes');
		}
	}

	/** Focus the name box (typing lands in it), and keep the focus there while it is open. */
	function nameBox(input: HTMLInputElement) {
		input.focus();
		const refocus = () =>
			requestAnimationFrame(() => {
				if (title.screen === 'naming' && input.isConnected) input.focus();
			});
		input.addEventListener('blur', refocus);
		return () => {
			input.removeEventListener('blur', refocus);
			// A tablet's keyboard may have slid the page up to show the box; put it back.
			window.scrollTo(0, 0);
		};
	}
</script>

{#if title.screen === 'menu' || title.screen === 'confirm'}
	<div class="title-screen">
		<h1 class="logo" aria-label={t('title.name')}>
			{#each letters as letter, i (i)}
				<span class="letter" style="--i: {i}" aria-hidden="true">{letter}</span>
			{/each}
		</h1>

		<!-- Under the confirm the menu is out of reach, a screen reader's click too: its
		     rows' keys are the confirm's (New game's `row:1` is Yes). -->
		<div class="card menu-card" inert={title.screen === 'confirm'}>
			{#each rows as row, i (row)}
				<button
					type="button"
					class="row"
					class:lit={title.screen === 'menu' && title.cursor === i}
					class:continue={row === 'continue'}
					data-press={rowKey(i)}
					{@attach unfocusable}
				>
					<span class="caret">▸</span>
					{#if row === 'continue'}
						<span class="label">{t('title.continue')}</span>
						{#if saved && lead}
							<span class="team">
								<span class="who">{nameOf(lead)}</span>
								<span class="count">{t('title.animals', { count: saved.party.length })}</span>
							</span>
						{/if}
					{:else if row === 'new'}
						<span class="label">{t('title.newGame')}</span>
					{:else if row === 'sound'}
						<span class="label">{t('title.sound')}</span>
						<span class="setting">
							<Switch on={sfx.on} />
							<span class="setting-state">{sfx.on ? t('pause.soundOn') : t('pause.soundOff')}</span>
						</span>
					{:else}
						<span class="label">{t('title.language')}</span>
						<!-- Each language in its own words, so a kid finds theirs in any language;
						     a tap on one is that language, anywhere else on the row the row. -->
						<span class="choices">
							{#each LANGUAGES as code (code)}
								<span
									class="choice"
									class:on={language.current === code}
									lang={code}
									data-press={languageKey(code)}
								>
									{languageName(code)}
								</span>
							{/each}
						</span>
					{/if}
				</button>
			{/each}
			{#if title.notice}
				<div class="note">{t(title.notice)}</div>
			{/if}
			<!-- The keys; with the touch controls on, every row is its own button. -->
			{#if !touch.on}
				<div class="keys">
					{litRow === 'language' || litRow === 'sound' ? t('title.keysSetting') : t('title.keys')}
				</div>
			{/if}
		</div>

		{#if title.screen === 'confirm' && lead}
			<div class="shade">
				<div class="card confirm">
					<div class="heading">{t('title.confirm.title')}</div>
					<p>
						{#if title.keeps}
							{t('title.confirm.away', { animal: animalWords(lead) })}
						{:else}
							{t('title.confirm.notKept', { animal: animalWords(lead) })}
						{/if}
					</p>
					<p>{t('title.confirm.fresh')}</p>
					{#each CONFIRM_CHOICES as choice, i (choice)}
						<button
							type="button"
							class="row confirm-row"
							class:lit={title.confirm === i}
							data-press={rowKey(i)}
							{@attach unfocusable}
						>
							<span class="caret">▸</span>
							<span class="label">{choiceLabel(choice)}</span>
						</button>
					{/each}
					{#if !touch.on}
						<div class="keys">{t('title.confirm.keys')}</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>
{:else}
	<div class="starter-screen">
		{#if title.screen === 'starter'}
			<h2 class="pick-title">{t('title.starter.title')}</h2>
		{/if}
		{#each STARTERS as id, i (id)}
			{@const spot = title.spots[i]}
			{#if spot}
				<!-- The animal itself takes a tap too: a box over its figure, above its tag. -->
				<button
					type="button"
					class="figure-hit"
					aria-hidden="true"
					tabindex="-1"
					style="left: {spot.x * 100}%; top: {spot.y * 100}%"
					data-press={rowKey(i)}
					{@attach unfocusable}
				></button>
				<button
					type="button"
					class="tag"
					class:lit={title.starter === i}
					style="left: {spot.x * 100}%; top: {spot.y * 100}%"
					data-press={rowKey(i)}
					{@attach unfocusable}
				>
					{speciesName(id)}
				</button>
			{/if}
		{/each}

		<div class="card starter-card" class:typing={touch.on && title.screen === 'naming'}>
			{#if title.screen === 'starter'}
				<div class="heading">{speciesName(species)}</div>
				<div class="loves">
					{t('title.starter.loves', {
						animal: starter,
						kinds: kindList(speciesTopics(species), 'conjunction')
					})}
				</div>
				<!-- Enter and Escape, for a finger or a mouse: picking starts the game, so a tap on a tag only lights it. -->
				<div class="card-buttons">
					<button type="button" class="pill" data-press="Escape" {@attach unfocusable}>
						{t('title.back')}
					</button>
					<button type="button" class="pill go" data-press="Enter" {@attach unfocusable}>
						{t('title.starter.pick', { animal: starter })}
					</button>
				</div>
				{#if !touch.on}
					<div class="keys">{t('title.starter.keys')}</div>
				{/if}
			{:else}
				<div class="heading">{t('title.naming.title', { animal: starter })}</div>
				<input
					class="name-box"
					type="text"
					bind:value={title.draft}
					maxlength={MAX_NICKNAME_LENGTH}
					placeholder={speciesName(species)}
					autocomplete="off"
					autocapitalize="words"
					autocorrect="off"
					spellcheck="false"
					enterkeyhint="go"
					aria-label={t('title.naming.title', { animal: starter })}
					{@attach nameBox}
				/>
				<div class="note">{t('pause.nameRule', { max: MAX_NICKNAME_LENGTH })}</div>
				{#if preview}
					<div class="note preview">{t('pause.willBe', { name: preview })}</div>
				{:else}
					<div class="note">{t('title.naming.empty', { animal: starter })}</div>
				{/if}
				<div class="card-buttons">
					<button type="button" class="pill" data-press="Escape" {@attach unfocusable}>
						{t('title.back')}
					</button>
					<button type="button" class="pill go" data-press="Enter" {@attach unfocusable}>
						{t('title.naming.start')}
					</button>
				</div>
				{#if !touch.on}
					<div class="keys">{t('title.naming.keys')}</div>
				{/if}
			{/if}
		</div>
	</div>
{/if}

<style>
	.title-screen,
	.starter-screen {
		position: absolute;
		inset: 0;
		overflow: hidden;
	}
	.title-screen {
		display: grid;
		grid-template-rows: auto 1fr;
		padding: 16px 32px 24px;
		box-sizing: border-box;
	}

	/* The name of the game: chunky letters in the palette's warm colours, a cream rim, a gentle bob. */
	.logo {
		margin: 0;
		text-align: center;
		font-weight: 800;
		font-size: clamp(64px, 11vh, 112px);
		line-height: 1.15;
		letter-spacing: 0.02em;
		user-select: none;
	}
	.letter {
		display: inline-block;
		color: var(--logo-color);
		-webkit-text-stroke: 10px var(--panel-cream);
		paint-order: stroke fill;
		text-shadow: 0 7px 0 rgba(45, 42, 50, 0.18);
		animation: bob 2.6s ease-in-out infinite;
		animation-delay: calc(var(--i) * -0.33s);
	}
	.letter:nth-child(5n + 1) {
		--logo-color: var(--coral);
	}
	.letter:nth-child(5n + 2) {
		--logo-color: var(--accent);
	}
	.letter:nth-child(5n + 3) {
		--logo-color: var(--good);
	}
	.letter:nth-child(5n + 4) {
		--logo-color: var(--blue);
	}
	.letter:nth-child(5n) {
		--logo-color: var(--warn);
	}
	@keyframes bob {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-7px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.letter {
			animation: none;
		}
	}

	.card {
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		box-sizing: border-box;
	}
	.menu-card {
		align-self: center;
		justify-self: start;
		width: min(420px, 42vw);
		padding: 14px 14px 12px;
	}
	/* A row's right side that doesn't fit beside its label goes under it (Continue's long name). */
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 2px 10px;
		width: 100%;
		box-sizing: border-box;
		min-height: 52px;
		padding: 0 12px 0 6px;
		border-radius: 12px;
		font-weight: 800;
		font-size: 22px;
	}
	/* Room round Continue's two lines when the name goes under it; every other row keeps its height. */
	.row.continue {
		padding-block: 4px;
	}
	/* A mouse over a row it can press. Never on touch, where hover sticks after a tap. */
	@media (hover: hover) and (pointer: fine) {
		.row:not(.lit):hover {
			background: rgba(255, 159, 67, 0.1);
		}
	}
	.row.lit {
		background: rgba(255, 159, 67, 0.22);
	}
	.caret {
		width: 16px;
		flex: none;
		visibility: hidden;
		color: var(--accent);
	}
	.row.lit .caret {
		visibility: visible;
	}
	.label {
		flex: none;
	}
	/* As long as the name and the count need, so a long name wraps the pair under Continue whole. */
	.team {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		justify-content: flex-end;
		align-items: baseline;
		gap: 8px;
		font-size: 16px;
	}
	.who {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.count {
		flex: none;
		font-weight: 600;
		opacity: 0.7;
	}
	.choices {
		flex: 1;
		display: flex;
		justify-content: flex-end;
		gap: 6px;
	}
	.choice {
		display: grid;
		place-items: center;
		height: 32px;
		padding: 0 12px;
		border-radius: 16px;
		background: rgba(0, 0, 0, 0.08);
		font-size: 16px;
	}
	.choice.on {
		background: var(--accent);
		color: white;
	}
	/* Touch: each language a finger's height, so a tap near one lands on it, not on the row. */
	:global(.touch) .choice {
		height: var(--tap);
		min-width: 64px;
		box-sizing: border-box;
		border-radius: 24px;
	}
	/* The Sound row: the switch and its state in words, at the right. */
	.setting {
		flex: 1;
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 10px;
		font-size: 16px;
	}
	.setting-state {
		min-width: 2.5em;
	}
	.note {
		font-weight: 600;
		font-size: 16px;
		margin: 10px 8px 0;
	}
	.preview {
		font-weight: 800;
	}
	.keys {
		margin-top: 12px;
		font-weight: 600;
		font-size: 16px;
		opacity: 0.7;
		text-align: center;
	}

	.shade {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgba(45, 42, 50, 0.3);
		padding: 16px;
	}
	.confirm {
		width: min(520px, 100%);
		padding: 18px 22px 14px;
	}
	.heading {
		font-weight: 800;
		font-size: 28px;
		line-height: 1.2;
		margin: 0 0 8px 2px;
	}
	.confirm p {
		margin: 0 0 8px 2px;
		font-weight: 600;
		font-size: 18px;
	}
	.confirm-row {
		margin-top: 6px;
	}

	.pick-title {
		position: absolute;
		top: 20px;
		left: 0;
		right: 0;
		margin: 0;
		text-align: center;
		font-weight: 800;
		font-size: clamp(32px, 5.5vh, 48px);
		color: var(--panel-ink);
		-webkit-text-stroke: 8px var(--panel-cream);
		paint-order: stroke fill;
	}
	/* A starter's name under its feet, at the spot the 3D stage reports. */
	.tag {
		position: absolute;
		transform: translate(-50%, 14px);
		padding: 4px 16px;
		border-radius: 18px;
		background: var(--panel-bg);
		box-shadow: var(--hud-shadow);
		font-weight: 800;
		font-size: 20px;
		white-space: nowrap;
	}
	.tag.lit {
		background: var(--accent);
		color: white;
	}
	:global(.touch) .tag {
		min-height: var(--tap);
		padding: 0 22px;
		border-radius: 24px;
	}
	/* Over a starter's figure, from its feet up: invisible, a tap on the animal lights it. */
	.figure-hit {
		position: absolute;
		width: min(18vw, 200px);
		height: 30vh;
		transform: translate(-50%, -100%);
	}
	/* The card's Back and Pick (or Let's go): Escape and Enter. */
	.card-buttons {
		display: flex;
		justify-content: center;
		gap: 12px;
		margin-top: 12px;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
		padding: 0 22px;
		border-radius: 24px;
		background: rgba(0, 0, 0, 0.08);
		font-weight: 800;
		font-size: 18px;
	}
	.pill.go {
		background: var(--accent);
		color: white;
	}
	.pill:active {
		transform: scale(0.97);
	}
	.starter-card {
		position: absolute;
		left: 50%;
		bottom: 24px;
		transform: translateX(-50%);
		width: min(640px, calc(100vw - 32px));
		padding: 14px 22px 12px;
		text-align: center;
	}
	/* Naming on a touch screen: at the top, so the tablet's keyboard, which rises from the bottom, leaves the name box in view. */
	.starter-card.typing {
		top: 16px;
		bottom: auto;
	}
	.starter-card .heading {
		margin: 0 0 4px;
	}
	.loves {
		font-weight: 600;
		font-size: 18px;
	}
	.name-box {
		width: 100%;
		box-sizing: border-box;
		margin-top: 4px;
		font: inherit;
		font-weight: 800;
		font-size: 28px;
		text-align: center;
		color: var(--panel-ink);
		padding: 8px 14px;
		border: 3px solid var(--accent);
		border-radius: 12px;
		background: white;
		outline: none;
	}
	.name-box::placeholder {
		color: var(--panel-ink);
		opacity: 0.35;
	}
</style>
