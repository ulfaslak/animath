/**
 * Whether the game runs as a web app on the Home Screen rather than in a
 * browser tab: Safari's own flag (`navigator.standalone`), or the standard
 * display mode. Such an app keeps its own storage, apart from the browser's
 * (#90), so a game played in the browser is not there: an account is how it
 * comes over.
 */
export function runsAsWebApp(): boolean {
	try {
		const safari = (navigator as Navigator & { standalone?: boolean }).standalone === true;
		return safari || window.matchMedia('(display-mode: standalone)').matches;
	} catch {
		return false;
	}
}
