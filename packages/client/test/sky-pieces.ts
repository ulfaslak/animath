import * as THREE from 'three';
import { Chaser } from '../src/render/chaser';
import type { FigureHost } from '../src/render/follower';

/**
 * What a stand-in renderer needs for the birds in the air (#91): where the
 * trainer is (`trainerPoint`, the origin unless a test moves it) and a real
 * `Chaser`, whose figure goes to `host` (nowhere by default). Built without
 * WebGL, as every figure is.
 */
export function skyPieces(host: FigureHost = { addFigure() {}, removeFigure() {} }) {
	const trainer = new THREE.Vector3();
	return {
		trainer,
		trainerPoint: () => trainer.clone(),
		chaser: new Chaser(host, new THREE.Scene(), () => new THREE.PerspectiveCamera())
	};
}
