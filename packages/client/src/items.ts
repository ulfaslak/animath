import type { ItemId } from '@mathgame/engine';
import { t, type ParamValue } from './copy';

/**
 * What the screen calls the shop's items, in the language on screen. The
 * engine knows them by id only (`ITEMS`); the words are the copy files'
 * (`items.<id>.*`), written out per language like a species' forms, since a
 * Danish article follows the noun.
 */

/**
 * The forms every item has, for sentences to pick from with `{item.form}`:
 * its name as a label ("Axe", "Økse"), with "the" ("the axe", "øksen"), and
 * with "your" ("your axe", "din økse").
 */
export const ITEM_FORMS = ['name', 'the', 'your'] as const;

/** An item's name, as a label. */
export function itemName(id: ItemId): string {
	return t(`items.${id}.name`);
}

/** What an item does, in a few words: "Chops down trees." */
export function itemUse(id: ItemId): string {
	return t(`items.${id}.use`);
}

/** An item as a line's `{item.form}` param. */
export function itemWords(id: ItemId): ParamValue {
	const forms: Record<string, string> = {};
	for (const form of ITEM_FORMS) forms[form] = t(`items.${id}.${form}`);
	return forms;
}
