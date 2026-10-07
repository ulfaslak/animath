/**
 * Freezes `value` and everything in it, so a reducer that writes to its input
 * throws in a test instead of quietly changing the caller's state.
 */
export function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
	}
	return value;
}
