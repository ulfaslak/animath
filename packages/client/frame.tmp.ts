import * as THREE from 'three';
import { buildAnimalMesh } from './src/render/animals.ts';

const [px, pz, ox, oz, cx, cy, cz, lx, ly, lz, fov] = process.argv.slice(2).map(Number);
const P = new THREE.Vector3(px, 0, pz);
const O = new THREE.Vector3(ox, 0, oz);
const CAM = new THREE.Vector3(cx, cy, cz);
const LOOK = new THREE.Vector3(lx, ly, lz);

function panelPx(h: number) { return Math.min(360, Math.max(260, 0.4 * h)); }
function frame(w: number, h: number) {
	const panel = panelPx(h);
	const H = h + panel;
	const cam = new THREE.PerspectiveCamera(30, w / H, 0.1, 60);
	const sceneH = h - panel;
	const tanFull = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * (H / sceneH);
	cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tanFull));
	cam.setViewOffset(w, H, 0, panel, w, h);
	cam.position.copy(CAM);
	cam.lookAt(LOOK);
	cam.updateMatrixWorld();
	cam.updateProjectionMatrix();
	return { cam, panel };
}
function screenBox(cam: THREE.Camera, obj: THREE.Object3D, w: number, h: number) {
	obj.updateMatrixWorld(true);
	const b = new THREE.Box3().setFromObject(obj);
	let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
	for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
		const v = new THREE.Vector3(x, y, z).project(cam);
		const sx = (v.x + 1) / 2 * w, sy = (1 - v.y) / 2 * h;
		x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
	}
	return `x ${(x0 / w * 100).toFixed(0)}..${(x1 / w * 100).toFixed(0)}% y ${y0.toFixed(0)}..${y1.toFixed(0)}`;
}
for (const [w, h] of [[1280, 800], [1024, 768], [800, 600]]) {
	const { cam, panel } = frame(w, h);
	console.log(`== ${w}x${h} scene 0..${(h - panel).toFixed(0)}`);
	for (const id of ['otter', 'squirrel', 'deer', 'bear']) {
		const pl = buildAnimalMesh(id); pl.position.copy(P); pl.rotation.y = Math.atan2(O.x - P.x, O.z - P.z);
		const op = buildAnimalMesh(id); op.position.copy(O); op.rotation.y = Math.atan2(P.x - O.x, P.z - O.z);
		for (const g of [pl, op]) { const hh = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3()).y; g.scale.setScalar(Math.min(1.6, Math.max(0.8, Math.sqrt(1 / hh)))); }
		console.log(`  ${id.padEnd(9)} player ${screenBox(cam, pl, w, h)}   opp ${screenBox(cam, op, w, h)}`);
	}
}
