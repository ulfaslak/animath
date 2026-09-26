<script lang="ts">
	import {
		getAnimal,
		getItem,
		homeTokens,
		keepsATeam,
		mustStay,
		needsHealing,
		tokensForTier,
		type ItemId
	} from '@mathgame/engine';
	import { t } from '../copy';
	import { doctorWords, NAMES_LISTED, namesOf } from '../doctor/lines';
	import { optionKey, rowKey, tabKey, unfocusable } from '../input/press';
	import { touch } from '../input/touch.svelte';
	import { itemName, itemUse, itemWords } from '../items';
	import { animalWords, nameOf, speciesName } from '../names';
	import {
		DOCTOR_TABS,
		cannotBuy,
		doctor,
		hurtIndexes,
		kindGoing,
		kindPicked,
		tabRows,
		type DoctorRow,
		type DoctorTab
	} from '../state/doctor.svelte';
	import Coin from './Coin.svelte';
	import HpBar from './HpBar.svelte';
	import ItemIcon from './ItemIcon.svelte';
	import PuzzlePanel from './PuzzlePanel.svelte';

	/**
	 * The doctor's card, over the world at the bottom of the screen (UI_SPEC §
	 * Doctor): the doctor's line and the player's tokens across the top; on the
	 * left the tabs (heal, help home, shop) over the tab's list, which scrolls,
	 * with Help home's button and Bye under it; on the right what the
	 * highlighted row does, the confirm before a hand-over, or the puzzle in
	 * the same `PuzzlePanel` as battle. Everything comes from `doctor` (the
	 * presentation view) and every word from the copy files (`doctor.*`,
	 * `items.*`); keys are handled by `DoctorController`, so nothing here
	 * dispatches. A click or a tap is a key press (`data-press`,
	 * `input/taps.ts`): a row is its `row:<i>` key, a tab its `tab:<id>`, a
	 * choice of the confirm its `option:<i>`, and Back is Escape. With the
	 * touch controls on, the doctor's line sits over the puzzle, so the list
	 * has the card's height for rows a finger tall.
	 */
	const rows = $derived(tabRows(doctor.tab, doctor.party, doctor.shop));
	/**
	 * The rows that scroll: the animals (and on help home each bundle's row)
	 * or the items. Help home's button and Bye stay put under them.
	 */
	const listed = $derived(
		rows.flatMap((row, k) =>
			row.kind === 'animal' || row.kind === 'bundle' || row.kind === 'item' ? [{ row, k }] : []
		)
	);
	const footer = $derived(
		rows.flatMap((row, k) => (row.kind === 'send' || row.kind === 'bye' ? [{ row, k }] : []))
	);
	const highlighted = $derived(rows[doctor.cursor]);
	const hurt = $derived(hurtIndexes(doctor.party));
	const marked = $derived(new Set(doctor.marked));
	const markedAnimals = $derived(doctor.party.filter((a) => marked.has(a.id)));
	/** What the animals picked bring together: the running total, before the sum is asked. */
	const reward = $derived(homeTokens(markedAnimals));
	/**
	 * Animals not picked who have to stay: picking one more would leave no
	 * friend who can walk on with the kid (the engine's `keepsATeam`).
	 */
	const staying = $derived(new Set(mustStay(doctor.party, doctor.marked)));
	/** Nobody at all can walk on with the kid (only tired or sea animals standing): nobody may go yet. */
	const noWalker = $derived(!keepsATeam(doctor.party));
	const leaving = $derived(new Set(doctor.leaving ?? []));
	/** While a heal is open: the species it helps, whose rows light up together. */
	const patientSpecies = $derived(
		doctor.patient === null ? null : (doctor.party[doctor.patient]?.speciesId ?? null)
	);
	/** Other species that need the doctor, besides the patient's: what up and down swap to. */
	const otherHurtSpecies = $derived(
		new Set(hurt.map((i) => doctor.party[i]!.speciesId).filter((s) => s !== patientSpecies)).size
	);
	/** The confirm is up: the list and the tabs wait under it. */
	const asking = $derived(doctor.screen === 'confirm');

	function tabName(tab: DoctorTab): string {
		switch (tab) {
			case 'heal':
				return t('doctor.tabs.heal');
			case 'home':
				return t('doctor.tabs.home');
			case 'shop':
				return t('doctor.tabs.shop');
		}
	}

	/** The animals of a kind, in party order: a bundle row's. */
	function kindOf(speciesId: string) {
		return doctor.party.filter((a) => a.speciesId === speciesId);
	}

	/** The highlighted kind's row leaves one of its kind behind when picked: the one who stays, and why. */
	const kindKeepsOne = $derived(
		highlighted?.kind === 'bundle' &&
			kindGoing(highlighted.speciesId, doctor).length < kindOf(highlighted.speciesId).length
	);

	/** A bundle row goes with its animals when fewer than two of them stay: it is gone after the goodbye. */
	function kindLeaves(speciesId: string): boolean {
		return leaving.size > 0 && kindOf(speciesId).filter((a) => !leaving.has(a.id)).length < 2;
	}

	/** The key a row is drawn by: an animal's id, a bundle's kind, an item's id. */
	function rowId(row: DoctorRow): string {
		switch (row.kind) {
			case 'animal':
				return doctor.party[row.partyIndex]!.id;
			case 'bundle':
				return `bundle:${row.speciesId}`;
			case 'item':
				return row.itemId;
			default:
				return row.kind;
		}
	}

	/** Other hurt animals of the same species as `i`: one puzzle heals them too. */
	function hurtBeside(i: number): number {
		const species = doctor.party[i]?.speciesId;
		return hurt.filter((j) => j !== i && doctor.party[j]!.speciesId === species).length;
	}

	function price(itemId: ItemId): string {
		return t('doctor.shop.price', { count: getItem(itemId).price });
	}

	/** Why a highlighted item can't be bought, in words, or null. */
	function whyNot(itemId: ItemId): string | null {
		switch (cannotBuy(itemId, doctor)) {
			case 'owned':
				return t('doctor.shop.owned', { item: itemWords(itemId) });
			case 'short':
				return t('doctor.shop.short', { count: getItem(itemId).price - doctor.tokens });
			case null:
				return null;
		}
	}

	/** The question the confirm asks: the animals by name, or how many when there are more. */
	const sureTitle = $derived(
		markedAnimals.length <= NAMES_LISTED
			? t('doctor.home.sureTitle', { names: namesOf(markedAnimals) })
			: t('doctor.home.sureTitleMany', { many: markedAnimals.length })
	);

	/**
	 * The heal's sparkles: little stars that pop up along a healed animal's
	 * HP bar as it fills. `x` is where along the bar (%), `dx`/`dy` how far each
	 * flies (px), `d` its delay (s). With reduced motion they twinkle in place.
	 * None flies further left than the gap before the bar: a long name ends
	 * there.
	 */
	const SPARKS = [
		{ x: 8, dx: -6, dy: -26, d: 0, c: 'gold' },
		{ x: 16, dx: 8, dy: 22, d: 0.12, c: 'green' },
		{ x: 28, dx: -6, dy: -32, d: 0.05, c: 'white' },
		{ x: 40, dx: 10, dy: 20, d: 0.18, c: 'gold' },
		{ x: 52, dx: -8, dy: -28, d: 0.08, c: 'green' },
		{ x: 64, dx: 6, dy: 24, d: 0.22, c: 'white' },
		{ x: 76, dx: -10, dy: -24, d: 0.02, c: 'gold' },
		{ x: 88, dx: 8, dy: 26, d: 0.15, c: 'green' },
		{ x: 98, dx: 12, dy: -30, d: 0.25, c: 'white' }
	];

	/**
	 * The list scrolls: the highlighted row stays in view, and an edge with
	 * more rows past it fades out, so a kid sees there are more.
	 */
	let list: HTMLElement | undefined = $state();
	let moreAbove = $state(false);
	let moreBelow = $state(false);
	function measure(): void {
		if (!list) return;
		moreAbove = list.scrollTop > 1;
		moreBelow = list.scrollTop + list.clientHeight < list.scrollHeight - 1;
	}
	$effect(() => {
		void doctor.cursor;
		void doctor.tab;
		void doctor.party.length;
		// While the confirm asks and the goodbye plays, the animals it is about are in view.
		const about =
			doctor.screen === 'confirm' || doctor.leaving !== null
				? list?.querySelector('.marked, .leaving')
				: null;
		(about ?? list?.querySelector('.selected'))?.scrollIntoView({ block: 'nearest' });
		measure();
	});
</script>

<div class="doctor">
	<div class="card talk">
		<span class="who">{t('doctor.title')}</span>
		<span class="doctor-line">{doctor.line ? doctorWords(doctor.line) : ''}</span>
		<span class="purse">
			<Coin />
			<span class="tokens">{t('doctor.tokens', { count: doctor.tokens })}</span>
			{#if doctor.tokenPop}
				{#key doctor.tokenPop.n}
					<span class="token-pop" class:spend={doctor.tokenPop.amount < 0} aria-hidden="true">
						{doctor.tokenPop.amount > 0 ? '+' : '−'}{Math.abs(doctor.tokenPop.amount)}
					</span>
				{/key}
			{/if}
		</span>
	</div>

	<div class="card patients" class:asking inert={asking}>
		<div class="tabs">
			{#each DOCTOR_TABS as tab (tab)}
				<button
					type="button"
					class="tab"
					class:on={doctor.tab === tab}
					data-press={tabKey(tab)}
					{@attach unfocusable}
				>
					{tabName(tab)}
				</button>
			{/each}
		</div>

		<div
			class="list tab-{doctor.tab}"
			class:more-above={moreAbove}
			class:more-below={moreBelow}
			bind:this={list}
			onscroll={measure}
		>
			{#each listed as { row, k } (rowId(row))}
				{#if row.kind === 'bundle'}
					<!-- Several of one kind, as their card reads in the HUD: a pick here picks them all. -->
					{@const kind = kindOf(row.speciesId)}
					{@const picked = kindPicked(row.speciesId, doctor)}
					{@const going = kindGoing(row.speciesId, doctor)}
					<button
						type="button"
						class="row bundle"
						class:selected={doctor.cursor === k}
						class:marked={picked === 'all'}
						class:some={picked === 'some'}
						class:leaving={kindLeaves(row.speciesId)}
						class:group={row.groupStart}
						class:shake-a={doctor.shake?.row === k && doctor.shake.n % 2 === 0}
						class:shake-b={doctor.shake?.row === k && doctor.shake.n % 2 === 1}
						data-press={rowKey(k)}
						{@attach unfocusable}
					>
						<span class="caret">▸</span>
						<!-- Dashed, as its animals', when none of the kind may go (no one left to walk on with). -->
						<span class="check" class:stays={going.length === 0} aria-hidden="true"
							>{picked === 'all' ? '✓' : picked === 'some' ? '–' : ''}</span
						>
						<span class="label"
							>{speciesName(row.speciesId)}
							<span class="count">{t('team.count', { count: kind.length })}</span></span
						>
						<!-- What the pick brings: the one who stays, when one must, is not counted. -->
						{#if going.length > 0}
							<span class="worth">+{homeTokens(going)} <Coin size={16} /></span>
						{/if}
					</button>
				{:else if row.kind === 'animal'}
					{@const animal = doctor.party[row.partyIndex]!}
					{@const spec = getAnimal(animal.speciesId)}
					{@const healedBy = doctor.healed?.amounts[row.partyIndex]}
					{@const patient = patientSpecies === animal.speciesId && needsHealing(animal)}
					<button
						type="button"
						class="row"
						class:selected={doctor.cursor === k}
						class:patient={doctor.tab === 'heal' && patient && doctor.cursor !== k}
						class:cheer={healedBy !== undefined}
						class:healthy={doctor.tab === 'heal' && !needsHealing(animal) && healedBy === undefined}
						class:marked={doctor.tab === 'home' && marked.has(animal.id)}
						class:leaving={leaving.has(animal.id)}
						class:group={row.groupStart}
						class:shake-a={doctor.shake?.row === k && doctor.shake.n % 2 === 0}
						class:shake-b={doctor.shake?.row === k && doctor.shake.n % 2 === 1}
						data-press={rowKey(k)}
						{@attach unfocusable}
					>
						<span class="caret">▸</span>
						{#if doctor.tab === 'home'}
							<!-- Ticked when picked; dashed when this one has to stay, so the kid sees it before trying. -->
							<span class="check" class:stays={staying.has(animal.id)} aria-hidden="true"
								>{marked.has(animal.id) ? '✓' : ''}</span
							>
						{/if}
						<span class="label">{nameOf(animal)}</span>
						<!-- "tired" in the empty bar, so the name has the row; the heal's stars and "+N" over the bar. -->
						<span class="bar">
							<HpBar hp={animal.hp} max={spec.maxHp} emptyTag={t('party.tired')} />
							{#if healedBy !== undefined && doctor.healed}
								{#key doctor.healed.n}
									<span class="sparkles" aria-hidden="true">
										{#each SPARKS as s, j (j)}
											<i
												class="spark {s.c}"
												style="left: {s.x}%; --dx: {s.dx}px; --dy: {s.dy}px; animation-delay: {s.d}s"
											></i>
										{/each}
									</span>
									<span class="heal">+{healedBy}</span>
								{/key}
							{/if}
						</span>
					</button>
				{:else if row.kind === 'item'}
					{@const owned = doctor.items.includes(row.itemId)}
					<button
						type="button"
						class="row"
						class:selected={doctor.cursor === k}
						class:healthy={cannotBuy(row.itemId, doctor) !== null && doctor.bought !== row.itemId}
						class:cheer={doctor.bought === row.itemId}
						class:shake-a={doctor.shake?.row === k && doctor.shake.n % 2 === 0}
						class:shake-b={doctor.shake?.row === k && doctor.shake.n % 2 === 1}
						data-press={rowKey(k)}
						{@attach unfocusable}
					>
						<span class="caret">▸</span>
						<ItemIcon id={row.itemId} size={28} />
						<span class="label">{itemName(row.itemId)}</span>
						<span class="worth">
							{#if owned}✓{:else}{getItem(row.itemId).price} <Coin size={16} />{/if}
						</span>
					</button>
				{/if}
			{/each}
		</div>

		<div class="footer">
			{#each footer as { row, k } (row.kind)}
				<button
					type="button"
					class="row {row.kind}"
					class:selected={doctor.cursor === k}
					class:off={row.kind === 'send' && marked.size === 0}
					data-press={rowKey(k)}
					{@attach unfocusable}
				>
					<span class="caret">▸</span>
					{#if row.kind === 'send'}
						<span class="label">{t('doctor.home.send')}</span>
						{#if marked.size > 0}<span class="worth">+{reward} <Coin size={16} /></span>{/if}
					{:else}
						<span class="label">{t('doctor.bye')}</span>
						{#if !touch.on}<kbd>{t('doctor.byeKey')}</kbd>{/if}
					{/if}
				</button>
			{/each}
		</div>
	</div>

	<div class="card puzzle" class:correct={doctor.judged?.correct === true}>
		{#if doctor.puzzle && (doctor.screen === 'puzzle' || doctor.screen === 'busy')}
			{#if doctor.trade?.kind === 'home'}
				<PuzzlePanel
					puzzle={doctor.puzzle}
					input={doctor.input}
					judged={doctor.judged}
					typing={doctor.screen === 'puzzle'}
					story={t('doctor.home.story', { count: doctor.balance, amount: doctor.trade.reward })}
					back={t('doctor.back')}
				/>
			{:else if doctor.trade?.kind === 'buy'}
				<PuzzlePanel
					puzzle={doctor.puzzle}
					input={doctor.input}
					judged={doctor.judged}
					typing={doctor.screen === 'puzzle'}
					story={t('doctor.shop.story', {
						count: doctor.balance,
						item: itemWords(doctor.trade.itemId),
						price: doctor.trade.price
					})}
					back={t('doctor.back')}
				/>
			{:else}
				<!-- "Help another animal" under the puzzle's own reminder: beside the pad on touch,
				     where a doctor's line on three lines leaves the card no room for it below. -->
				<PuzzlePanel
					puzzle={doctor.puzzle}
					input={doctor.input}
					judged={doctor.judged}
					typing={doctor.screen === 'puzzle'}
					note={otherHurtSpecies > 0
						? touch.on
							? t('doctor.puzzleTouch')
							: t('doctor.puzzleKeys')
						: undefined}
					back={t('doctor.back')}
				/>
			{/if}
		{:else if doctor.screen === 'confirm'}
			<div class="question">{sureTitle}</div>
			<div class="detail">{t('doctor.home.sureDetail', { amount: reward })}</div>
			<div class="choices">
				<button
					type="button"
					class="choice"
					class:lit={doctor.confirm === 0}
					data-press={optionKey(0)}
					{@attach unfocusable}
				>
					{t('doctor.home.keep')}
				</button>
				<button
					type="button"
					class="choice yes"
					class:lit={doctor.confirm === 1}
					data-press={optionKey(1)}
					{@attach unfocusable}
				>
					{t('doctor.home.yes')}
				</button>
			</div>
			{#if !touch.on}<div class="keys">{t('doctor.home.sureKeys')}</div>{/if}
		{:else if doctor.tab === 'home'}
			<div class="soft">{t('doctor.home.title')}</div>
			<!-- Once something is picked, the running total takes the explanation's place. -->
			{#if marked.size > 0}
				<div class="tally">
					<Coin size={24} />
					{t('doctor.home.picked', { count: marked.size, amount: reward })}
				</div>
			{:else}
				<div class="detail">{t('doctor.home.how')}</div>
			{/if}
			{#if highlighted?.kind === 'bundle'}
				{@const kind = kindOf(highlighted.speciesId)}
				{@const going = kindGoing(highlighted.speciesId, doctor)}
				{#if going.length > 0}
					<div class="detail strong">
						{going.length === kind.length
							? t('doctor.home.kindWorth', { count: going.length, amount: homeTokens(going) })
							: t('doctor.home.kindWorthSome', { count: going.length, amount: homeTokens(going) })}
					</div>
				{/if}
			{:else if highlighted?.kind === 'animal' && doctor.party[highlighted.partyIndex]}
				{@const animal = doctor.party[highlighted.partyIndex]!}
				<!-- The one who has to stay walks on with the kid; with nobody who can, say what it brings. -->
				<div class="detail strong">
					{staying.has(animal.id) && !noWalker
						? t('doctor.home.stays', { animal: animalWords(animal) })
						: t('doctor.home.worth', {
								animal: animalWords(animal),
								count: tokensForTier(getAnimal(animal.speciesId).tier)
							})}
				</div>
			{/if}
			{#if staying.size > 0 || kindKeepsOne}
				<div class="detail">
					{noWalker ? t('doctor.home.noWalker') : t('doctor.home.keepOne')}
				</div>
			{/if}
			<div class="keys">{touch.on ? t('doctor.home.touch') : t('doctor.home.keys')}</div>
		{:else if doctor.tab === 'shop'}
			{#if doctor.shop.length === 0}
				<div class="soft">{t('doctor.shop.emptyTitle')}</div>
				<div class="detail">{t('doctor.shop.emptyDetail')}</div>
				<div class="keys">{touch.on ? t('doctor.allFitTouch') : t('doctor.allFitKeys')}</div>
			{:else if highlighted?.kind === 'item'}
				{@const itemId = highlighted.itemId}
				{@const why = whyNot(itemId)}
				<div class="ware">
					<ItemIcon id={itemId} size={64} />
					<div>
						<div class="ware-name">{itemName(itemId)}</div>
						<div class="detail">{itemUse(itemId)}</div>
					</div>
				</div>
				<div class="price"><Coin size={20} /> {price(itemId)}</div>
				{#if why}<div class="detail strong">{why}</div>{/if}
				<div class="keys">{touch.on ? t('doctor.shop.touch') : t('doctor.shop.keys')}</div>
			{:else}
				<div class="soft">{t('doctor.pick')}</div>
				<div class="detail">{t('doctor.byeDetail')}</div>
				<div class="keys">{touch.on ? t('doctor.shop.touch') : t('doctor.shop.keys')}</div>
			{/if}
		{:else if hurt.length === 0}
			<div class="soft">{t('doctor.allFit')}</div>
			<div class="keys">{touch.on ? t('doctor.allFitTouch') : t('doctor.allFitKeys')}</div>
		{:else}
			<div class="soft">{t('doctor.pick')}</div>
			<div class="detail">
				{#if highlighted?.kind === 'animal' && doctor.party[highlighted.partyIndex]}
					{@const i = highlighted.partyIndex}
					{hurtBeside(i) > 0
						? t('doctor.pickDetailMore', {
								animal: animalWords(doctor.party[i]!),
								others: hurtBeside(i)
							})
						: t('doctor.pickDetail', { animal: animalWords(doctor.party[i]!) })}
				{:else}
					{t('doctor.byeDetail')}
				{/if}
			</div>
			<div class="keys">{touch.on ? t('doctor.listTouch') : t('doctor.listKeys')}</div>
		{/if}
	</div>
</div>

<style>
	.doctor {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: var(--doctor-panel);
		display: grid;
		/*
		 * The list has its 2 of 5 of the card, or as much more as its longest
		 * name needs beside an HP bar (twelve of the widest letters at 1024 px);
		 * the right-hand side has the rest, and never less than
		 * `--puzzle-least`: the number pad beside the widest prompt on one line.
		 */
		--puzzle-least: 534px;
		grid-template-columns:
			minmax(min(calc((100% - 12px) * 0.4), calc(100% - 12px - var(--puzzle-least))), max-content)
			minmax(var(--puzzle-least), 1fr);
		grid-template-rows: auto minmax(0, 1fr);
		gap: 12px;
		padding: 0 16px 16px;
		box-sizing: border-box;
	}
	/* Below the supported sizes, give the names the room before the puzzle. */
	@media (max-width: 900px) {
		.doctor {
			grid-template-columns: 1fr 1fr;
		}
	}
	/* Touch: the doctor's line over the puzzle, the list the card's full height. */
	:global(.touch) .talk {
		grid-column: 2;
		grid-row: 1;
	}
	:global(.touch) .patients {
		grid-column: 1;
		grid-row: 1 / span 2;
		padding: 6px 12px;
	}
	:global(.touch) .list,
	:global(.touch) .footer {
		grid-auto-rows: var(--tap);
	}
	/* Beside the pad the prompt needs the width more than the card's edges do. */
	:global(.touch) .puzzle {
		grid-column: 2;
		grid-row: 2;
		padding: 12px 14px;
	}
	.card {
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		box-sizing: border-box;
		min-height: 0;
	}

	.talk {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 16px;
		min-width: 0;
	}
	.who {
		flex: none;
		padding: 2px 12px;
		border-radius: 14px;
		background: var(--accent);
		color: white;
		font-weight: 800;
		font-size: 16px;
	}
	.doctor-line {
		flex: 1;
		min-width: 0;
		font-weight: 800;
		font-size: 20px;
	}
	/* The player's tokens, at the right of the doctor's line. */
	.purse {
		position: relative;
		flex: none;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 12px 2px 6px;
		border-radius: 16px;
		background: rgba(245, 184, 61, 0.2);
		font-weight: 800;
		font-size: 18px;
		white-space: nowrap;
	}
	/* Tokens in or out: a "+N" or "−N" over the purse. */
	.token-pop {
		position: absolute;
		right: 8px;
		top: -18px;
		font-weight: 800;
		font-size: 24px;
		color: var(--good);
		text-shadow:
			0 2px 0 white,
			0 0 6px white;
		pointer-events: none;
		animation: pop 1.4s ease-out forwards;
	}
	.token-pop.spend {
		color: #d99a1e;
	}

	/*
	 * The tabs over the list; the list, which scrolls; Help home's button and
	 * Bye under it, always in view.
	 */
	.patients {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 8px 12px;
		min-width: 0;
		transition: opacity 0.2s;
	}
	/* Under the confirm: shown, but waiting. */
	.patients.asking > * {
		opacity: 0.55;
	}
	.tabs {
		flex: none;
		display: flex;
		gap: 4px;
		padding-bottom: 4px;
		border-bottom: 2px solid rgba(0, 0, 0, 0.06);
	}
	.tab {
		flex: 1;
		min-height: 32px;
		padding: 0 10px;
		border-radius: 12px;
		font-weight: 800;
		font-size: 16px;
		white-space: nowrap;
		opacity: 0.6;
	}
	:global(.touch) .tab {
		min-height: var(--tap);
	}
	.tab.on {
		opacity: 1;
		background: var(--accent);
		color: white;
	}
	@media (hover: hover) and (pointer: fine) {
		.tab:not(.on):hover {
			background: rgba(255, 159, 67, 0.12);
			opacity: 0.85;
		}
	}

	/*
	 * The rows line up in shared columns sized by the longest name there, so
	 * every name shows whole and the bars start together. On heal: name, HP
	 * bar (a tired animal's "tired" written in its empty bar). On help home:
	 * check, name, HP bar, a little closer together, so that "tired" and its
	 * numbers fit beside twelve of the widest letters at 1024 px (a bundle's
	 * row: its kind and how many, and what they all bring, in the bar's
	 * place). In the shop: picture, name, price. The caret sits in the row's
	 * left padding, outside the columns. A row is a subgrid of the list; a
	 * browser without subgrid lays each row out on its own, in the same
	 * columns. A subgrid's padding counts as a margin on the items at its
	 * edges, so the edge columns are sized by their content, never fixed: the
	 * first holds the row's 14 px beside what it shows, and the last one 10 px.
	 */
	.list {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: minmax(0, max-content) minmax(130px, 1fr);
		grid-auto-rows: minmax(30px, 36px);
		align-content: start;
		gap: 2px 8px;
		overflow-y: auto;
		/* The highlighted row keeps clear of a faded edge as the list scrolls to it. */
		scroll-padding-block: 24px;
		overscroll-behavior: contain;
		/* The one thing a finger may scroll here, when the list is longer than the card. */
		touch-action: pan-y;
		scrollbar-width: thin;
	}
	/* More rows past an edge: that edge fades out. */
	.list.more-below {
		mask-image: linear-gradient(to bottom, black calc(100% - 22px), transparent);
	}
	.list.more-above {
		mask-image: linear-gradient(to top, black calc(100% - 22px), transparent);
	}
	.list.more-above.more-below {
		mask-image: linear-gradient(
			to bottom,
			transparent,
			black 22px,
			black calc(100% - 22px),
			transparent
		);
	}
	.list.tab-home {
		grid-template-columns: auto minmax(0, max-content) minmax(100px, 1fr);
		column-gap: 6px;
	}
	.list.tab-shop {
		grid-template-columns: auto minmax(0, max-content) minmax(max-content, 1fr);
	}
	.list .row {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: subgrid;
	}
	.list.tab-home .row {
		column-gap: 6px;
	}
	.footer {
		flex: none;
		display: grid;
		grid-auto-rows: minmax(30px, 36px);
		gap: 2px;
	}
	.footer .row {
		display: flex;
		gap: 8px;
	}
	.row {
		position: relative;
		column-gap: 8px;
		align-items: center;
		padding: 0 10px 0 14px;
		border-radius: 12px;
		font-weight: 800;
		font-size: 18px;
		text-align: left;
	}
	/* A mouse over a row it can press. Never on touch, where hover sticks after a tap. */
	@media (hover: hover) and (pointer: fine) {
		.row:not(.selected):not(.healthy):not(.off):hover {
			background: rgba(255, 159, 67, 0.1);
		}
	}
	.row.selected {
		background: rgba(255, 159, 67, 0.22);
	}
	/* The rest of the species a heal is helping: lit with the one picked. */
	.row.patient {
		background: rgba(255, 159, 67, 0.12);
	}
	.row.healthy,
	.row.off {
		opacity: 0.55;
	}
	/* The first animal of the next species: a line between the groups. */
	.row.group::before {
		content: '';
		position: absolute;
		left: 10px;
		right: 10px;
		top: -2px;
		height: 1px;
		background: rgba(0, 0, 0, 0.1);
	}
	.row.marked {
		background: color-mix(in srgb, var(--good) 22%, transparent);
	}
	.row.marked.selected {
		background: color-mix(in srgb, var(--good) 34%, transparent);
	}
	/* Just healed, or just bought: lit up green and hopping once. */
	.row.cheer {
		background: color-mix(in srgb, var(--good) 30%, transparent);
		animation: cheer 0.5s ease-out;
	}
	/* Going home: off to the right, fading, with a little hop. */
	.row.leaving {
		animation: leave 1.4s ease-in forwards;
	}
	/* A row that can't be picked gives a little shake (two names, so each tap starts it again). */
	.row.shake-a {
		animation: nope-a 0.35s ease-out;
	}
	.row.shake-b {
		animation: nope-b 0.35s ease-out;
	}
	/* In the row's left padding, clear of what the row shows. */
	.caret {
		position: absolute;
		left: 3px;
		top: 0;
		bottom: 0;
		display: flex;
		align-items: center;
		visibility: hidden;
		color: var(--accent);
	}
	.row.selected .caret {
		visibility: visible;
	}
	.check {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		border: 2px solid rgba(0, 0, 0, 0.25);
		background: white;
		color: white;
		font-size: 15px;
		line-height: 1;
		box-sizing: border-box;
	}
	.row.marked .check {
		border-color: var(--good);
		background: var(--good);
	}
	/* Some of a kind picked, and more could be: a dash in a green ring. */
	.row.some .check {
		border-color: var(--good);
		color: var(--good);
		font-weight: 800;
	}
	/* The one who has to stay: an empty ring, dashed and faded, that no pick fills. */
	.check.stays {
		border-style: dashed;
		opacity: 0.45;
	}
	/* A bundle's row: over its animals, a shade darker, its kind's name and how many. */
	.row.bundle {
		background: rgba(45, 42, 50, 0.05);
	}
	.row.bundle.selected {
		background: rgba(255, 159, 67, 0.22);
	}
	.row.bundle.marked {
		background: color-mix(in srgb, var(--good) 22%, transparent);
	}
	.row.bundle.marked.selected {
		background: color-mix(in srgb, var(--good) 34%, transparent);
	}
	.count {
		margin-left: 4px;
		padding: 0 7px;
		border-radius: 8px;
		font-size: 15px;
		background: rgba(45, 42, 50, 0.08);
		font-variant-numeric: tabular-nums;
	}
	.label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* What an animal brings home, or what an item costs: at the right of the row. */
	.worth {
		justify-self: end;
		display: flex;
		align-items: center;
		gap: 4px;
		margin-left: auto;
		font-size: 16px;
		white-space: nowrap;
	}
	/* At the right of its column, at most 220 px long. */
	.bar {
		position: relative;
		justify-self: end;
		width: 100%;
		max-width: 220px;
	}
	.bye kbd {
		margin-left: auto;
	}
	/* The heal's "+N", over the bar's numbers. */
	.heal {
		position: absolute;
		right: 4px;
		top: -14px;
		font-weight: 800;
		font-size: 24px;
		color: var(--good);
		text-shadow:
			0 2px 0 white,
			0 0 6px white;
		pointer-events: none;
		animation: pop 1.2s ease-out forwards;
	}
	/* Along the HP bar, where it fills. */
	.sparkles {
		position: absolute;
		left: 0;
		right: 0;
		top: 50%;
		height: 0;
		pointer-events: none;
	}
	/* A chunky four-pointed star, big enough to read as one beside an 8 px bar. */
	.spark {
		position: absolute;
		top: -10px;
		width: 20px;
		height: 20px;
		margin-left: -10px;
		clip-path: polygon(50% 0, 64% 36%, 100% 50%, 64% 64%, 50% 100%, 36% 64%, 0 50%, 36% 36%);
		opacity: 0;
		animation: sparkle 0.9s ease-out forwards;
	}
	.spark.gold {
		background: var(--warn);
	}
	.spark.green {
		background: var(--good);
	}
	.spark.white {
		background: white;
	}
	kbd {
		font-family: inherit;
		font-size: 16px;
		padding: 0 8px;
		border-radius: 8px;
		background: rgba(0, 0, 0, 0.08);
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
		line-height: 1.15;
		opacity: 0.45;
	}
	.detail {
		font-weight: 600;
		font-size: 18px;
		max-width: 30em;
	}
	.detail.strong {
		font-weight: 800;
	}
	/* The running total of a hand-over: what the animals picked bring, before the sum. */
	.tally {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 14px 4px 8px;
		border-radius: 18px;
		background: rgba(245, 184, 61, 0.2);
		font-weight: 800;
		font-size: 20px;
	}
	.keys {
		font-weight: 600;
		font-size: 16px;
		opacity: 0.7;
	}
	/* The confirm before a hand-over: the question, what happens, and the two choices. */
	.question {
		font-weight: 800;
		font-size: 26px;
		line-height: 1.2;
		max-width: 22em;
	}
	.choices {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
	}
	.choice {
		min-height: 40px;
		padding: 0 22px;
		border-radius: 20px;
		font-weight: 800;
		font-size: 18px;
		background: rgba(0, 0, 0, 0.06);
	}
	:global(.touch) .choice {
		min-height: var(--tap);
	}
	.choice.lit {
		background: rgba(255, 159, 67, 0.3);
		box-shadow: inset 0 0 0 3px var(--accent);
	}
	.choice.yes.lit {
		background: var(--accent);
		color: white;
	}
	@media (hover: hover) and (pointer: fine) {
		.choice:not(.lit):hover {
			background: rgba(255, 159, 67, 0.14);
		}
	}
	/* The highlighted item: its picture, name and use, then its price. */
	.ware {
		display: flex;
		align-items: center;
		gap: 16px;
		text-align: left;
	}
	.ware-name {
		font-weight: 800;
		font-size: 28px;
		line-height: 1.1;
	}
	.price {
		display: flex;
		align-items: center;
		gap: 6px;
		font-weight: 800;
		font-size: 20px;
	}

	@keyframes cheer {
		0%,
		100% {
			transform: translateY(0);
		}
		40% {
			transform: translateY(-4px);
		}
	}
	@keyframes leave {
		0% {
			opacity: 1;
			transform: translate(0, 0);
		}
		20% {
			opacity: 1;
			transform: translate(0, -5px);
		}
		100% {
			opacity: 0;
			transform: translate(40px, -2px);
		}
	}
	@keyframes nope-a {
		0%,
		100% {
			transform: translateX(0);
		}
		30% {
			transform: translateX(-6px);
		}
		70% {
			transform: translateX(6px);
		}
	}
	@keyframes nope-b {
		0%,
		100% {
			transform: translateX(0);
		}
		30% {
			transform: translateX(-6px);
		}
		70% {
			transform: translateX(6px);
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
	@keyframes sparkle {
		0% {
			opacity: 0;
			transform: translate(0, 0) scale(0.2) rotate(0deg);
		}
		30% {
			opacity: 1;
			transform: translate(calc(var(--dx) * 0.5), calc(var(--dy) * 0.5)) scale(1.1) rotate(45deg);
		}
		100% {
			opacity: 0;
			transform: translate(var(--dx), var(--dy)) scale(0.4) rotate(90deg);
		}
	}
	/* Less motion: nothing hops or slides; the "+N" and the goodbye fade in place, the sparkles twinkle. */
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
	@keyframes twinkle {
		0%,
		100% {
			opacity: 0;
		}
		40% {
			opacity: 1;
		}
	}
	@keyframes fade-out {
		to {
			opacity: 0;
		}
	}
	@keyframes nope-small-a {
		0%,
		100% {
			transform: translateX(0);
		}
		30% {
			transform: translateX(-2px);
		}
		70% {
			transform: translateX(2px);
		}
	}
	@keyframes nope-small-b {
		0%,
		100% {
			transform: translateX(0);
		}
		30% {
			transform: translateX(-2px);
		}
		70% {
			transform: translateX(2px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.row.cheer {
			animation: none;
		}
		.row.leaving {
			animation-name: fade-out;
		}
		.row.shake-a {
			animation-name: nope-small-a;
		}
		.row.shake-b {
			animation-name: nope-small-b;
		}
		.heal,
		.token-pop {
			animation-name: pop-still;
		}
		.spark {
			animation-name: twinkle;
		}
	}
</style>
