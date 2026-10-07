import * as THREE from 'three';
import { buildAnimalMesh, disposeFigure } from './animals';
import { SUN_FROM, WORLD_LIGHT } from './campfire';

/**
 * The animal book's pictures ([[UI_SPEC]] § Pause menu, "The animal book"):
 * each species' own figure (`buildAnimalMesh`), standing, drawn once into an
 * offscreen target with the game's renderer and kept as a picture the page
 * shows as an image. The figure is freed as soon as it is drawn, so the book
 * holds pictures, never meshes, however many kinds it shows.
 *
 * The camera looks at the figure's face from a little to its right and a
 * little above, lower than the world's, and each figure fills its frame: a
 * shrew is as big as a bear here, so every kind reads on a small card. The
 * light is the world's: the sky's fill and the warm sun from the upper right.
 */

/** Pixels a side a picture is drawn at: twice what is kept, so halving it smooths the edges. */
const DRAWN = 384;
/** Pixels a side of the picture kept: sharp on a card of up to 96 px at twice the pixel density. */
export const PORTRAIT_SIZE = 192;

/** Where the camera stands round the figure: turned from its front towards its right, and up. */
const YAW = (28 * Math.PI) / 180;
const PITCH = (16 * Math.PI) / 180;
/** Room round the figure, as a share of the frame. */
const MARGIN = 1.1;

/** What drawing a picture needs of a `THREE.WebGLRenderer`. */
export type PortraitRenderer = Pick<
	THREE.WebGLRenderer,
	| 'getContext'
	| 'getRenderTarget'
	| 'setRenderTarget'
	| 'getClearColor'
	| 'getClearAlpha'
	| 'setClearColor'
	| 'render'
	| 'readRenderTargetPixels'
>;

/** Turns the drawn pixels, RGBA rows bottom up, `DRAWN` a side, into the picture the page shows. */
export type PortraitEncoder = (pixels: Uint8Array, size: number) => string;

export class PortraitStudio {
	private readonly scene = new THREE.Scene();
	private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
	private target: THREE.WebGLRenderTarget | null = null;
	private readonly pixels = new Uint8Array(DRAWN * DRAWN * 4);

	constructor(
		private readonly renderer: PortraitRenderer,
		private readonly encode: PortraitEncoder = encodePng
	) {
		this.scene.add(new THREE.HemisphereLight(WORLD_LIGHT.sky, WORLD_LIGHT.bounce, WORLD_LIGHT.fill));
		const sun = new THREE.DirectionalLight(WORLD_LIGHT.sun, WORLD_LIGHT.sunIntensity);
		sun.position.set(...SUN_FROM);
		this.scene.add(sun);
	}

	/**
	 * A picture of `speciesId`'s figure, transparent round it: a PNG data URL
	 * of `PORTRAIT_SIZE` pixels a side. The renderer is left as it was found:
	 * drawing to the screen, clearing to the colour it cleared to. Null while
	 * the renderer's WebGL context is lost (a GPU reset, a tablet taking the
	 * memory back), when nothing can be drawn: ask again once it is back.
	 */
	draw(speciesId: string): string | null {
		if (this.renderer.getContext().isContextLost()) return null;
		// Read into a cleared buffer, so a read that draws nothing can never pass off the last picture.
		this.pixels.fill(0);
		const figure = buildAnimalMesh(speciesId);
		this.scene.add(figure);
		try {
			this.aimAt(figure);
			// Stored as sRGB, so the pixels read back are the colours the screen would show.
			this.target ??= new THREE.WebGLRenderTarget(DRAWN, DRAWN, {
				colorSpace: THREE.SRGBColorSpace
			});
			const renderer = this.renderer;
			const screen = renderer.getRenderTarget();
			const clear = renderer.getClearColor(new THREE.Color());
			const clearAlpha = renderer.getClearAlpha();
			renderer.setRenderTarget(this.target);
			renderer.setClearColor(0x000000, 0);
			renderer.render(this.scene, this.camera);
			renderer.readRenderTargetPixels(this.target, 0, 0, DRAWN, DRAWN, this.pixels);
			renderer.setRenderTarget(screen);
			renderer.setClearColor(clear, clearAlpha);
			return this.encode(this.pixels, DRAWN);
		} finally {
			this.scene.remove(figure);
			disposeFigure(figure);
		}
	}

	/** Frees the offscreen target. The studio draws again after, making a new one. */
	dispose(): void {
		this.target?.dispose();
		this.target = null;
	}

	/** The camera on `figure`, its frame fitted round the figure's box as the camera sees it. */
	private aimAt(figure: THREE.Group): void {
		figure.updateMatrixWorld(true);
		const box = new THREE.Box3().setFromObject(figure);
		const centre = box.getCenter(new THREE.Vector3());
		const from = new THREE.Vector3(
			Math.sin(YAW) * Math.cos(PITCH),
			Math.sin(PITCH),
			Math.cos(YAW) * Math.cos(PITCH)
		);
		this.camera.position.copy(centre).addScaledVector(from, 20);
		this.camera.lookAt(centre);
		this.camera.updateMatrixWorld();
		const view = this.camera.matrixWorldInverse;
		let [left, right, bottom, top] = [Infinity, -Infinity, Infinity, -Infinity];
		const corner = new THREE.Vector3();
		for (const x of [box.min.x, box.max.x]) {
			for (const y of [box.min.y, box.max.y]) {
				for (const z of [box.min.z, box.max.z]) {
					corner.set(x, y, z).applyMatrix4(view);
					left = Math.min(left, corner.x);
					right = Math.max(right, corner.x);
					bottom = Math.min(bottom, corner.y);
					top = Math.max(top, corner.y);
				}
			}
		}
		// Square, round the middle of what the camera sees of the box.
		const half = (Math.max(right - left, top - bottom) / 2) * MARGIN;
		const [cx, cy] = [(left + right) / 2, (bottom + top) / 2];
		this.camera.left = cx - half;
		this.camera.right = cx + half;
		this.camera.bottom = cy - half;
		this.camera.top = cy + half;
		this.camera.updateProjectionMatrix();
	}
}

/** Canvases reused from one picture to the next. */
let canvases: { drawn: HTMLCanvasElement; kept: HTMLCanvasElement } | null = null;

/**
 * The pixels as a PNG data URL, halved to `PORTRAIT_SIZE` on the way: the
 * canvas's smoothing averages each 2 × 2 into one, which is what makes the
 * edges soft, since the target itself draws them with no antialiasing.
 */
function encodePng(pixels: Uint8Array, size: number): string {
	canvases ??= { drawn: document.createElement('canvas'), kept: document.createElement('canvas') };
	const { drawn, kept } = canvases;
	drawn.width = drawn.height = size;
	kept.width = kept.height = PORTRAIT_SIZE;
	const image = new ImageData(size, size);
	const row = size * 4;
	// The target's rows run bottom up; an image's top down.
	for (let y = 0; y < size; y++) {
		image.data.set(pixels.subarray((size - 1 - y) * row, (size - y) * row), y * row);
	}
	drawn.getContext('2d')!.putImageData(image, 0, 0);
	const context = kept.getContext('2d')!;
	context.clearRect(0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE);
	context.imageSmoothingQuality = 'high';
	context.drawImage(drawn, 0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE);
	return kept.toDataURL('image/png');
}
