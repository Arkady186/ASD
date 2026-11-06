/* ASD · интерьер квартиры в ЖК «Октябрь Парк».
   Пустая квартира (бетон) → отделка → кухня ASD собирается по модулям → примерка фасадов и столешниц.
   Используется из kvartal3d.js: тот же WebGL-рендерер, своя сцена, камера и постобработка. */
import * as THREE from 'three';
import { RoomEnvironment } from './vendor/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from './vendor/jsm/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from './vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from './vendor/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from './vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/jsm/postprocessing/OutputPass.js';

const V3 = THREE.Vector3;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeBack = t => { t = clamp(t, 0, 1); const c = 1.4; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const easeIO = t => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
let seed = 77;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/* ---------- Каталог: те же материалы, что в «Гиде по материалам» ASD ---------- */
export const FACADES = [
  { id: 'ldsp', name: 'ЛДСП', price: '₽', note: 'Ламинированная плита: самый доступный вариант, много древесных декоров.',
    colors: [['Дуб натуральный', 'wood', '#C2A27E'], ['Орех', 'wood', '#6F5440'], ['Белый', 'solid', '#EDEBE6'], ['Графит', 'solid', '#4A4B4D']], rough: 0.62, cc: 0 },
  { id: 'plenka', name: 'Плёнка ПВХ', price: '₽₽', note: 'МДФ в плёнке: фрезеровка и рамки, матовые и древесные цвета.',
    colors: [['Белый матовый', 'frame', '#EEECE7'], ['Капучино', 'frame', '#C9B49A'], ['Шалфей', 'frame', '#9DAA92']], rough: 0.55, cc: 0.1 },
  { id: 'hpl', name: 'Пластик HPL', price: '₽₽', note: 'Очень прочный слоистый пластик с тёмным торцом.',
    colors: [['Бетон', 'concrete', '#A9A6A0'], ['Белый камень', 'stone', '#E7E4DE'], ['Антрацит', 'solid', '#36383B']], rough: 0.5, cc: 0.15, edge: '#1A1A1A' },
  { id: 'agt', name: 'AGT панели', price: '₽₽', note: 'МДФ с акриловым покрытием: глубокий глянец или бархатный мат.',
    colors: [['Белый глянец', 'gloss', '#F2F1EE'], ['Графит глянец', 'gloss', '#3C3E42'], ['Шампань', 'gloss', '#D9C7AE'], ['Серый мат', 'solid', '#8D9094']], rough: 0.06, cc: 1 },
  { id: 'emal', name: 'Эмаль', price: '₽₽₽', note: 'Окрашенный МДФ: любой цвет по каталогу, шёлковый блеск.',
    colors: [['Шалфей', 'paint', '#8E9B87'], ['Терракота', 'paint', '#B36A4C'], ['Глубокий синий', 'paint', '#2F4058'], ['Молочный', 'paint', '#ECE6DA']], rough: 0.32, cc: 0.35 },
  { id: 'massiv', name: 'Массив', price: '₽₽₽', note: 'Цельная древесина: тёплая фактура и классические рамки.',
    colors: [['Дуб', 'woodframe', '#B5946E'], ['Орех', 'woodframe', '#6A4F3B']], rough: 0.5, cc: 0.15 }
];
export const TOPS = [
  { id: 'stone', name: 'Белый камень', kind: 'marble', color: '#EEEBE6' },
  { id: 'dark', name: 'Тёмный камень', kind: 'speck', color: '#2E2F31' },
  { id: 'oak', name: 'Дуб', kind: 'wood', color: '#B79572' }
];

/* ---------- Текстуры ---------- */
function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function grain(g, w, h, n, a, s = 2) {
  for (let i = 0; i < n; i++) { g.fillStyle = rnd() > 0.5 ? `rgba(255,255,255,${a * rnd()})` : `rgba(0,0,0,${a * rnd()})`; g.fillRect(rnd() * w, rnd() * h, s, s); }
}
function T(c, { srgb = true, rep = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; return t;
}
export function woodCanvas(base, S = 1024, vertical = true) {
  const [c, g] = cv(S, S); g.fillStyle = base; g.fillRect(0, 0, S, S);
  const col = new THREE.Color(base);
  for (let i = 0; i < 28; i++) { // широкие мягкие полосы годовых слоёв
    const x = rnd() * S, w = 20 + rnd() * 70, cc = col.clone().offsetHSL(0, -0.02, (rnd() - 0.5) * 0.05);
    g.fillStyle = `rgba(${cc.r * 255 | 0},${cc.g * 255 | 0},${cc.b * 255 | 0},.28)`; g.fillRect(x, 0, w, S);
  }
  for (let i = 0; i < 170; i++) {
    const x = rnd() * S, w = 0.8 + rnd() * 2.2, cc = col.clone().offsetHSL(0, -0.04, -0.03 - rnd() * 0.08);
    g.strokeStyle = `rgba(${cc.r * 255 | 0},${cc.g * 255 | 0},${cc.b * 255 | 0},${0.12 + rnd() * 0.22})`; g.lineWidth = w;
    g.beginPath(); let y = 0, xx = x; g.moveTo(xx, 0);
    while (y < S) { y += 24; xx += Math.sin(y * 0.008 + i) * 1.2 + (rnd() - 0.5) * 0.8; g.lineTo(xx, y); }
    g.stroke();
  }
  for (let k = 0; k < 4; k++) { // сучки и «соборы»
    const x = rnd() * S, y = rnd() * S; g.strokeStyle = 'rgba(60,35,15,.18)';
    for (let r = 4; r < 60; r += 5) { g.lineWidth = 1.5; g.beginPath(); g.ellipse(x, y, r * 0.35, r * 1.6, 0, 0, 7); g.stroke(); }
  }
  grain(g, S, S, 30000, 0.06);
  if (!vertical) { const [c2, g2] = cv(S, S); g2.translate(S, 0); g2.rotate(Math.PI / 2); g2.drawImage(c, 0, 0); return c2; }
  return c;
}
export function marbleCanvas(base, vein = '90,90,95', S = 1024) {
  const [c, g] = cv(S, S); g.fillStyle = base; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9; i++) {
    g.strokeStyle = `rgba(${vein},${0.12 + rnd() * 0.25})`; g.lineWidth = 0.6 + rnd() * 2.4;
    let x = rnd() * S, y = 0; g.beginPath(); g.moveTo(x, y);
    while (y < S) { y += 8; x += (rnd() - 0.5) * 14 + Math.sin(y * 0.02 + i) * 3; g.lineTo(x, y); }
    g.stroke();
  }
  grain(g, S, S, 40000, 0.04);
  return c;
}
export function speckCanvas(base, S = 1024) {
  const [c, g] = cv(S, S); g.fillStyle = base; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 26000; i++) { const v = rnd(); g.fillStyle = v > 0.92 ? 'rgba(235,235,230,.55)' : v > 0.6 ? 'rgba(90,90,92,.4)' : 'rgba(10,10,10,.35)'; g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2.5, 1 + rnd() * 2.5); }
  return c;
}
export function concreteCanvas(base = '#9C9A95', S = 1024) {
  const [c, g] = cv(S, S); g.fillStyle = base; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 700; i++) { const r = 10 + rnd() * 70; g.fillStyle = `rgba(${rnd() > 0.5 ? '255,255,255' : '40,40,40'},${0.01 + rnd() * 0.025})`; g.beginPath(); g.arc(rnd() * S, rnd() * S, r, 0, 7); g.fill(); }
  for (let i = 0; i < 160; i++) { g.fillStyle = 'rgba(40,40,40,.25)'; g.beginPath(); g.arc(rnd() * S, rnd() * S, 1 + rnd() * 2.5, 0, 7); g.fill(); } // поры
  grain(g, S, S, 60000, 0.07);
  return c;
}
function plasterCanvas(base = '#F1EEE8', S = 512) { const [c, g] = cv(S, S); g.fillStyle = base; g.fillRect(0, 0, S, S); grain(g, S, S, 30000, 0.025, 3); return c; }
function parquetCanvas(S = 2048) { // доска 1.2 × 0.15 м, текстура = 2.4 × 2.4 м
  const [c, g] = cv(S, S), ppm = S / 2.4, cols = ['#D6C2A2', '#CFBA98', '#DBC9AA', '#C9B190', '#D3BF9E'];
  for (let row = 0; row < 16; row++) {
    const y = row * 0.15 * ppm, off = (row % 3) * 0.4 * ppm;
    for (let x = -off; x < S; x += 1.2 * ppm) {
      const w = 1.2 * ppm, col = cols[Math.floor(rnd() * cols.length)];
      const wood = woodCanvas(col, 256, false);
      g.drawImage(wood, 0, rnd() * 200, 256, 40, x, y, w, 0.15 * ppm);
      g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x, y, 2, 0.15 * ppm); g.fillRect(x, y, w, 1.5);
    }
  }
  return c;
}
export function frameCanvas(base, wood) { // фасад с фрезерованной рамкой (UV 0..1 на одну дверь)
  const S = 512, [c, g] = cv(S, S);
  if (wood) g.drawImage(woodCanvas(base, S), 0, 0); else { g.fillStyle = base; g.fillRect(0, 0, S, S); grain(g, S, S, 4000, 0.03); }
  const m = 46, k = 14;
  const line = (a, col) => { g.strokeStyle = col; g.lineWidth = 3; g.strokeRect(a, a, S - 2 * a, S - 2 * a); };
  line(m, 'rgba(0,0,0,.32)'); line(m + 4, 'rgba(255,255,255,.35)'); line(m + k, 'rgba(0,0,0,.18)'); line(m + k + 4, 'rgba(255,255,255,.22)');
  return c;
}
function cooktopCanvas() {
  const S = 512, [c, g] = cv(S, S); g.fillStyle = '#0B0B0C'; g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(200,200,200,.35)'; g.lineWidth = 3;
  [[150, 160, 95], [370, 150, 70], [150, 380, 70], [370, 370, 95]].forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke(); g.beginPath(); g.arc(x, y, r * 0.55, 0, 7); g.stroke(); });
  g.fillStyle = 'rgba(220,220,220,.5)'; for (let i = 0; i < 6; i++) g.fillRect(170 + i * 30, 485, 14, 4);
  return c;
}
function viewCanvas(img) { // вид из окна: верх фото квартала + небо
  const W = 2048, H = 1024, [c, g] = cv(W, H);
  const sky = g.createLinearGradient(0, 0, 0, H * 0.5); sky.addColorStop(0, '#8EB2D6'); sky.addColorStop(1, '#F1DDBE');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  if (img && img.naturalWidth) {
    const sw = img.naturalWidth, sh = img.naturalHeight;
    g.globalAlpha = 1; g.drawImage(img, sw * 0.02, sh * 0.0, sw * 0.96, sh * 0.62, 0, H * 0.36, W, H * 0.64);
    const fog = g.createLinearGradient(0, H * 0.36, 0, H * 0.6); fog.addColorStop(0, 'rgba(241,221,190,.85)'); fog.addColorStop(1, 'rgba(241,221,190,0)');
    g.fillStyle = fog; g.fillRect(0, H * 0.36, W, H * 0.24);
  }
  return c;
}

/* ---------- Геометрия ---------- */
function box(w, h, d, period = 0) { // UV в метрах / period (0 — UV 0..1 на грань)
  const g = new THREE.BoxGeometry(w, h, d);
  if (period) {
    const uv = g.attributes.uv, sz = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * sz[f][0] / period, uv.getY(i) * sz[f][1] / period); }
  }
  return g;
}

/* ---------- Квартира ---------- */
export function createApartment(renderer, opts = {}) {
  const lite = !!opts.lite;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#D9D4CB');
  const cam = new THREE.PerspectiveCamera(56, 1, 0.05, 200);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(renderer), 0.03).texture;
  const envInt = 0.55;

  // Свет: солнце через окно, небо, подвесы и подсветка
  const hemi = new THREE.HemisphereLight('#F4F1EA', '#8A8073', 0.55); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#FFE3BC', 3.2);
  sun.position.set(9, 6.5, 3.5); sun.target.position.set(-1, 0, -0.5);
  sun.castShadow = true; sun.shadow.mapSize.set(lite ? 1024 : 2048, lite ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 25 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 4;
  scene.add(sun, sun.target);
  const fill = new THREE.PointLight('#FFF1DE', 0, 9, 1.6); fill.position.set(0.5, 2.5, 0); scene.add(fill);

  const M = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.85, metalness: 0, envMapIntensity: envInt }, o));
  const P = (o) => new THREE.MeshPhysicalMaterial(Object.assign({ roughness: 0.4, metalness: 0, envMapIntensity: envInt }, o));
  const add = (geo, mat, x, y, z, parent = scene, cast = true, recv = true) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = recv; parent.add(m); return m;
  };

  /* Комната: 6.0 × 4.2 м, потолок 2.75 м. Окно — в правой стене (x = +3) */
  const RX = 3.0, RZ = 2.1, RH = 2.75, WT = 0.2;
  const WIN = { z0: -0.6, z1: 1.4, y0: 0.85, y1: 2.45 };
  const DOOR = { x0: -2.65, x1: -1.75, y1: 2.1 };
  const tx = (c, rep) => { const t = T(c); t.repeat.set(rep, rep); return t; };
  const concreteT = tx(concreteCanvas(), 1 / 2.2), plasterT = tx(plasterCanvas(), 1 / 1.5);
  const wallMat = M({ map: concreteT, color: '#FFFFFF', roughness: 0.95 });
  const floorConc = M({ map: tx(concreteCanvas('#8E8C88'), 1 / 2.4), roughness: 0.97 });
  const parquet = tx(parquetCanvas(), 1 / 2.4);
  const floorWood = P({ map: parquet, color: '#F2ECE4', roughness: 0.42, clearcoat: 0.25, clearcoatRoughness: 0.35, transparent: true, opacity: 0, depthWrite: false });
  const ceilMat = M({ map: tx(concreteCanvas('#B5B3AE'), 1 / 2.4), roughness: 0.95 });

  const room = new THREE.Group(); scene.add(room);
  const floorG = new THREE.PlaneGeometry(RX * 2 + WT, RZ * 2 + WT); floorG.rotateX(-Math.PI / 2);
  { const uv = floorG.attributes.uv, p = floorG.attributes.position; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getZ(i)); }
  add(floorG, floorConc, 0, 0, 0, room, false, true);
  const wood = add(floorG.clone(), floorWood, 0, 0.004, 0, room, false, true); wood.renderOrder = 1;
  const ceilG = floorG.clone(); ceilG.rotateX(Math.PI); add(ceilG, ceilMat, 0, RH, 0, room, false, true);
  const wallBox = (w, h, d, x, y, z) => { const g = box(w, h, d, 1); const m = add(g, wallMat, x, y, z, room, true, true); return m; };
  // задняя и левая стены
  wallBox(RX * 2 + WT * 2, RH, WT, 0, RH / 2, -RZ - WT / 2);
  wallBox(WT, RH, RZ * 2, -RX - WT / 2, RH / 2, 0);
  // передняя стена с дверным проёмом
  wallBox(DOOR.x0 + RX, RH, WT, (-RX + DOOR.x0) / 2, RH / 2, RZ + WT / 2);
  wallBox(RX - DOOR.x1, RH, WT, (DOOR.x1 + RX) / 2, RH / 2, RZ + WT / 2);
  wallBox(DOOR.x1 - DOOR.x0, RH - DOOR.y1, WT, (DOOR.x0 + DOOR.x1) / 2, (RH + DOOR.y1) / 2, RZ + WT / 2);
  // правая стена с окном
  wallBox(WT, RH, WIN.z0 + RZ, RX + WT / 2, RH / 2, (-RZ + WIN.z0) / 2);
  wallBox(WT, RH, RZ - WIN.z1, RX + WT / 2, RH / 2, (WIN.z1 + RZ) / 2);
  wallBox(WT, WIN.y0, WIN.z1 - WIN.z0, RX + WT / 2, WIN.y0 / 2, (WIN.z0 + WIN.z1) / 2);
  wallBox(WT, RH - WIN.y1, WIN.z1 - WIN.z0, RX + WT / 2, (RH + WIN.y1) / 2, (WIN.z0 + WIN.z1) / 2);
  // тёмный коридор за дверью
  add(box(1.6, RH, 1.5), M({ color: '#5B5751' }), (DOOR.x0 + DOOR.x1) / 2, RH / 2, RZ + WT + 0.75, room, false, true);
  // окно: ПВХ-рама, импост, стекло, подоконник, радиатор
  const pvc = M({ color: '#F4F3F0', roughness: 0.35 });
  const wz = (WIN.z0 + WIN.z1) / 2, wl = WIN.z1 - WIN.z0, wh = WIN.y1 - WIN.y0, fx = RX + 0.08;
  add(box(0.07, 0.07, wl), pvc, fx, WIN.y0 + 0.035, wz, room); add(box(0.07, 0.07, wl), pvc, fx, WIN.y1 - 0.035, wz, room);
  add(box(0.07, wh, 0.07), pvc, fx, (WIN.y0 + WIN.y1) / 2, WIN.z0 + 0.035, room); add(box(0.07, wh, 0.07), pvc, fx, (WIN.y0 + WIN.y1) / 2, WIN.z1 - 0.035, room);
  add(box(0.07, wh, 0.06), pvc, fx, (WIN.y0 + WIN.y1) / 2, 0.4, room);
  const glass = P({ color: '#FFFFFF', roughness: 0.02, transparent: true, opacity: 0.1, envMapIntensity: 1.2, depthWrite: false });
  const gl = add(box(0.012, wh - 0.1, wl - 0.1), glass, fx, (WIN.y0 + WIN.y1) / 2, wz, room, false, false); gl.renderOrder = 3;
  add(box(0.32, 0.03, wl + 0.2), pvc, RX - 0.1, WIN.y0 + 0.015, wz, room);
  const rad = new THREE.Group(); room.add(rad); rad.position.set(RX - 0.1, 0.18, wz);
  for (let i = 0; i < 14; i++) add(box(0.08, 0.55, 0.05), M({ color: '#F2F1EE', roughness: 0.4 }), 0, 0.275, -0.45 + i * 0.07, rad);
  // вид из окна
  const viewTex = T(viewCanvas(null), { rep: false });
  const viewMat = new THREE.MeshBasicMaterial({ map: viewTex, toneMapped: false, fog: false });
  const view = add(new THREE.PlaneGeometry(34, 17), viewMat, 14, 2.5, 0.4, scene, false, false); view.rotation.y = -Math.PI / 2;
  if (opts.viewImage) { const im = new Image(); im.onload = () => { viewMat.map = T(viewCanvas(im), { rep: false }); viewMat.needsUpdate = true; }; im.src = opts.viewImage; }
  // плинтусы (появляются после отделки)
  const finish = new THREE.Group(); scene.add(finish);
  const plinthM = M({ color: '#F3F1EC', roughness: 0.5 });
  add(box(RX * 2, 0.08, 0.015), plinthM, 0, 0.04, -RZ + 0.008, finish); add(box(0.015, 0.08, RZ * 2), plinthM, -RX + 0.008, 0.04, 0, finish);
  add(box(DOOR.x0 + RX, 0.08, 0.015), plinthM, (-RX + DOOR.x0) / 2, 0.04, RZ - 0.008, finish);
  add(box(RX - DOOR.x1, 0.08, 0.015), plinthM, (DOOR.x1 + RX) / 2, 0.04, RZ - 0.008, finish);
  // дверь
  const door = new THREE.Group(); door.position.set(DOOR.x0 + 0.02, 0, RZ - 0.02); finish.add(door);
  add(box(0.86, 2.05, 0.04), M({ color: '#E9E6E0', roughness: 0.45 }), 0.43, 1.025, 0, door);
  add(box(0.14, 0.02, 0.05), new THREE.MeshStandardMaterial({ color: '#2A2A2A', metalness: 0.9, roughness: 0.3 }), 0.76, 1.0, -0.04, door);
  finish.visible = false;

  /* ---------- Кухня ---------- */
  const facadeMat = P({ color: '#FFFFFF', roughness: 0.5 });
  const edgeMat = M({ color: '#EDEBE6', roughness: 0.6 });
  const carcMat = M({ color: '#ECEAE5', roughness: 0.6 });
  const topMat = P({ color: '#FFFFFF', roughness: 0.25, clearcoat: 0.3 });
  const steel = new THREE.MeshStandardMaterial({ color: '#C9CBCD', metalness: 1, roughness: 0.28, envMapIntensity: 1 });
  const black = P({ color: '#0E0E0F', roughness: 0.08, clearcoat: 1, envMapIntensity: 1 });
  const goLa = new THREE.MeshStandardMaterial({ color: '#2C2C2E', metalness: 0.8, roughness: 0.4, envMapIntensity: envInt });
  const led = new THREE.MeshBasicMaterial({ color: new THREE.Color('#FFD9A0').multiplyScalar(2.2), toneMapped: true });

  const parts = []; // { obj, t0, kind, from }
  const kitchen = new THREE.Group(); scene.add(kitchen);
  const piece = (obj, t0, kind, from = {}) => { parts.push({ obj, t0, kind, from, home: obj.position.clone(), rot: obj.rotation.clone() }); kitchen.add(obj); obj.visible = false; return obj; };

  const BH0 = 0.1, BH1 = 0.86, TOP = 0.9, BD = 0.56, UY0 = 1.45, UY1 = 2.35, UD = 0.33, TALL = 2.35, GAP = 0.003, FT = 0.018;
  // модуль: в локальных осях фронт смотрит в +z; root ставится к стене
  function module(w, y0, y1, d, fronts, opt = {}) {
    const g = new THREE.Group();
    const carc = new THREE.Mesh(box(w - 0.002, y1 - y0, d - FT), carcMat); carc.position.set(w / 2, (y0 + y1) / 2, -(d - FT) / 2 - FT); carc.castShadow = carc.receiveShadow = true; g.add(carc);
    const fr = [];
    fronts.forEach(f => { // f: {x0,x1,y0,y1,type:'door'|'drawer'|'appliance', hinge:'l'|'r'}
      const fw = f.x1 - f.x0 - GAP * 2, fh = f.y1 - f.y0 - GAP * 2;
      const mat = f.mat || facadeMat;
      const mesh = new THREE.Mesh(box(fw, fh, FT), [edgeMat, edgeMat, edgeMat, edgeMat, mat, edgeMat]);
      mesh.castShadow = mesh.receiveShadow = true;
      const pivot = new THREE.Group();
      if (f.type === 'door') {
        const hx = f.hinge === 'r' ? f.x1 - GAP : f.x0 + GAP;
        pivot.position.set(hx, f.y0 + GAP + fh / 2, -FT / 2);
        mesh.position.x = (f.hinge === 'r' ? -1 : 1) * fw / 2;
      } else pivot.position.set(f.x0 + GAP + fw / 2, f.y0 + GAP + fh / 2, -FT / 2);
      pivot.add(mesh); g.add(pivot);
      if (f.extra) f.extra(mesh, fw, fh);
      fr.push({ pivot, type: f.type, hinge: f.hinge, mesh });
    });
    if (opt.gola) { const s = new THREE.Mesh(box(w, 0.035, 0.03), goLa); s.position.set(w / 2, y1 - 0.0175, -0.02); g.add(s); }
    g.userData.fronts = fr;
    return g;
  }
  const drawers3 = (w) => [{ x0: 0, x1: w, y0: BH0, y1: 0.33, type: 'drawer' }, { x0: 0, x1: w, y0: 0.33, y1: 0.56, type: 'drawer' }, { x0: 0, x1: w, y0: 0.56, y1: BH1 - 0.04, type: 'drawer' }];
  const door1 = (w, y0, y1, h = 'l') => [{ x0: 0, x1: w, y0, y1, type: 'door', hinge: h }];
  const door2 = (w, y0, y1) => [{ x0: 0, x1: w / 2, y0, y1, type: 'door', hinge: 'l' }, { x0: w / 2, x1: w, y0, y1, type: 'door', hinge: 'r' }];

  const backZ = -RZ, sideX = -RX;
  let t = 0.6;
  const placeBack = (m, x) => { m.position.set(x, 0, backZ + BD); return m; };
  const placeSide = (m, z) => { m.rotation.y = Math.PI / 2; m.position.set(sideX + BD, 0, z); return m; };
  // нижние модули: задняя стена (x от -2.44 до 0.16) и левая (z от -1.54 до -0.3), угол — глухой
  const lower = [
    [placeBack(module(0.6, BH0, BH1, BD, door1(0.6, BH0, BH1 - 0.04, 'r'), { gola: true }), -2.44), 'dishwasher'],
    [placeBack(module(0.6, BH0, BH1, BD, drawers3(0.6), { gola: true }), -1.84), ''],
    [placeBack(module(0.8, BH0, BH1, BD, [{ x0: 0, x1: 0.8, y0: BH0, y1: 0.48, type: 'drawer' }, { x0: 0, x1: 0.8, y0: 0.48, y1: BH1 - 0.04, type: 'drawer' }], { gola: true }), -1.24), 'cooktop'],
    [placeBack(module(0.6, BH0, BH1, BD, drawers3(0.6), { gola: true }), -0.44), ''],
    [placeSide(module(0.6, BH0, BH1, BD, door1(0.6, BH0, BH1 - 0.04, 'l'), { gola: true }), -1.54 + 0.6), 'corner'],
    [placeSide(module(0.6, BH0, BH1, BD, door2(0.6, BH0, BH1 - 0.04), { gola: true }), -0.94 + 0.6), 'sink'],
    [placeSide(module(0.6, BH0, BH1, BD, drawers3(0.6), { gola: true }), -0.34 + 0.6), '']
  ];
  // цоколь (утоплен на 6 см)
  { const pM = M({ color: '#2B2B2C', roughness: 0.6 });
    const p1 = new THREE.Mesh(box(0.16 + RX, BH0, 0.02), pM); p1.position.set((-RX + 0.16) / 2, BH0 / 2, backZ + BD - 0.06); piece(p1, t, 'fade');
    const p2 = new THREE.Mesh(box(0.02, BH0, 1.8), pM); p2.position.set(sideX + BD - 0.06, BH0 / 2, -0.64); piece(p2, t, 'fade'); }
  // глухой угол
  const cornerBox = new THREE.Mesh(box(BD, BH1 - BH0, BD), carcMat); cornerBox.position.set(sideX + BD / 2, (BH0 + BH1) / 2, backZ + BD / 2); cornerBox.castShadow = true;
  piece(cornerBox, t, 'rise');
  lower.forEach(([m], i) => piece(m, t + 0.1 + i * 0.09, m.rotation.y ? 'slideX' : 'slideZ'));
  // высокие пеналы: духовой шкаф и холодильник
  const tallOven = placeBack(module(0.6, 0, TALL, 0.58, [
    { x0: 0, x1: 0.6, y0: BH0, y1: 0.7, type: 'drawer' },
    { x0: 0, x1: 0.6, y0: 0.7, y1: 1.3, type: 'appliance', mat: black },
    { x0: 0, x1: 0.6, y0: 1.3, y1: TALL, type: 'door', hinge: 'r' }]), 0.16);
  const fridge = placeBack(module(0.6, 0, TALL, 0.58, [
    { x0: 0, x1: 0.6, y0: BH0, y1: 0.9, type: 'door', hinge: 'r' }, { x0: 0, x1: 0.6, y0: 0.9, y1: TALL, type: 'door', hinge: 'r' }]), 0.76);
  [tallOven, fridge].forEach((m, i) => piece(m, t + 0.75 + i * 0.12, 'slideZ'));
  // ручка духовки
  { const h = new THREE.Mesh(box(0.5, 0.02, 0.03), steel); h.position.set(0.16 + 0.3, 1.24, backZ + 0.58 + 0.03); piece(h, t + 1.1, 'pop'); }
  // столешница + стеновая панель
  const top1 = new THREE.Mesh(box(0.16 + RX, 0.04, 0.6, 1), topMat); top1.position.set((-RX + 0.16) / 2, TOP - 0.02, backZ + 0.3); top1.castShadow = top1.receiveShadow = true;
  const top2 = new THREE.Mesh(box(0.6, 0.04, 1.76, 1), topMat); top2.position.set(sideX + 0.3, TOP - 0.02, -1.5 + 0.88); top2.castShadow = top2.receiveShadow = true;
  piece(top1, t + 1.15, 'drop'); piece(top2, t + 1.22, 'drop');
  const splashMat = topMat;
  const splash = new THREE.Mesh(box(0.16 + RX, UY0 - TOP, 0.012, 1), splashMat); splash.position.set((-RX + 0.16) / 2, (TOP + UY0) / 2, backZ + 0.006); splash.receiveShadow = true;
  piece(splash, t + 1.3, 'fade');
  // варочная панель, мойка, смеситель
  const ctop = new THREE.Mesh(box(0.58, 0.006, 0.5), [black, black, P({ map: T(cooktopCanvas(), { rep: false }), roughness: 0.05, clearcoat: 1 }), black, black, black]);
  ctop.position.set(-0.84, TOP + 0.003, backZ + 0.3); piece(ctop, t + 1.5, 'pop');
  const sinkG = new THREE.Group(); sinkG.position.set(sideX + 0.3, TOP, -0.64 + 0.0);
  add(box(0.44, 0.004, 0.4), M({ color: '#2A2A2A', roughness: 0.4 }), 0, 0.001, 0, sinkG, false, true);
  [[-0.225, 0, 0.012, 0.4], [0.225, 0, 0.012, 0.4]].forEach(([x, z, w, d]) => add(box(w, 0.012, d), steel, x, 0.004, z, sinkG));
  const tap = new THREE.Group(); tap.position.set(-0.25, 0, 0); sinkG.add(tap);
  add(new THREE.CylinderGeometry(0.022, 0.026, 0.3, 24), steel, 0, 0.15, 0, tap);
  const spout = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.014, 12, 32, Math.PI), steel); spout.position.set(0.12, 0.3, 0); spout.castShadow = true; tap.add(spout);
  add(box(0.03, 0.06, 0.012), steel, 0.24, 0.27, 0, tap);
  piece(sinkG, t + 1.55, 'pop');
  // верхние модули
  const upper = [];
  [[-2.44 + 0.0, 0.6], [-1.84, 0.6]].forEach(([x, w]) => upper.push(placeBack(module(w, UY0, UY1, UD, door1(w, UY0, UY1, 'l')), x)));
  upper.push(placeBack(module(0.8, 1.75, UY1, UD, [{ x0: 0, x1: 0.8, y0: 1.75, y1: UY1, type: 'door', hinge: 'l' }]), -1.24));
  upper.push(placeBack(module(0.6, UY0, UY1, UD, door1(0.6, UY0, UY1, 'r')), -0.44));
  upper.push(placeBack(module(0.56, UY0, UY1, UD, door1(0.56, UY0, UY1, 'l')), -RX));
  upper.forEach(m => { m.position.z = backZ + UD; });
  upper.push(placeSide(module(0.6, UY0, UY1, UD, door1(0.6, UY0, UY1, 'r')), -1.5 + 0.6)); upper[upper.length - 1].position.x = sideX + UD;
  upper.forEach((m, i) => piece(m, t + 1.7 + i * 0.08, 'dropUp'));
  // вытяжка (встроенная) и подсветка
  const hood = new THREE.Mesh(box(0.78, 0.08, 0.3), steel); hood.position.set(-0.84, 1.71, backZ + 0.16); piece(hood, t + 2.2, 'pop');
  const ledStrip = new THREE.Mesh(box(RX + 0.16 - 0.1, 0.008, 0.02), led); ledStrip.position.set((-RX + 0.16) / 2, UY0 - 0.006, backZ + UD - 0.04);
  piece(ledStrip, t + 2.6, 'light');
  const underLight = new THREE.PointLight('#FFD8A4', 0, 2.2, 2); underLight.position.set(-1.3, UY0 - 0.1, backZ + 0.25); scene.add(underLight);

  /* Обеденная зона, подвесы, диван, растение */
  const fabric = M({ color: '#CFC6B8', roughness: 0.95 });
  const dining = new THREE.Group(); dining.position.set(1.85, 0, -0.5); dining.rotation.y = Math.PI / 2;
  const tableTop = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.04, 0.85, 3, 0.01), P({ map: tx(woodCanvas('#B89878', 1024, false), 1), roughness: 0.38, clearcoat: 0.2 }));
  tableTop.position.y = 0.75; tableTop.castShadow = tableTop.receiveShadow = true; dining.add(tableTop);
  const legM = M({ color: '#1F1F20', roughness: 0.5, metalness: 0.6 });
  [[-0.68, -0.36], [0.68, -0.36], [-0.68, 0.36], [0.68, 0.36]].forEach(([x, z]) => add(box(0.04, 0.73, 0.04), legM, x, 0.365, z, dining));
  const chair = () => {
    const c = new THREE.Group();
    const seat = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.06, 0.46, 3, 0.02), fabric); seat.position.y = 0.46; seat.castShadow = true; c.add(seat);
    const back = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.4, 0.05, 3, 0.02), fabric); back.position.set(0, 0.7, -0.21); back.castShadow = true; c.add(back);
    [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]].forEach(([x, z]) => add(box(0.025, 0.44, 0.025), legM, x, 0.22, z, c));
    return c;
  };
  [[-0.38, -0.62, 0], [0.38, -0.62, 0], [-0.38, 0.62, Math.PI], [0.38, 0.62, Math.PI]].forEach(([x, z, r]) => { const c = chair(); c.position.set(x, 0, z); c.rotation.y = r; dining.add(c); });
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.8), M({ color: '#D8CFC0', roughness: 1 })); rug.rotation.x = -Math.PI / 2; rug.position.y = 0.008; rug.receiveShadow = true; dining.add(rug);
  piece(dining, t + 2.4, 'rise');
  const lamps = new THREE.Group(); lamps.position.set(1.85, 0, -0.5); lamps.rotation.y = Math.PI / 2;
  const lampLights = [];
  [-0.4, 0.4].forEach(x => {
    const shade = new THREE.Mesh(new THREE.SphereGeometry(0.17, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), M({ color: '#1E1E1F', roughness: 0.45, metalness: 0.3, side: THREE.DoubleSide }));
    shade.position.set(x, 1.62, 0); shade.castShadow = true; lamps.add(shade);
    const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.15, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color('#FFE2B0').multiplyScalar(1.6) })); bulb.rotation.x = Math.PI / 2; bulb.position.set(x, 1.621, 0); lamps.add(bulb);
    add(new THREE.CylinderGeometry(0.003, 0.003, RH - 1.79, 6), legM, x, (RH + 1.79) / 2, 0, lamps, false, false);
    const pl = new THREE.PointLight('#FFD7A0', 0, 4.5, 2); pl.position.set(x, 1.5, 0); lamps.add(pl); lampLights.push(pl);
  });
  piece(lamps, t + 2.8, 'dropUp');
  const sofa = new THREE.Group(); sofa.position.set(1.9, 0, RZ - 0.5);
  const sofaM = M({ color: '#8E9289', roughness: 0.98 });
  [[0, 0.22, 0, 2.0, 0.24, 0.9], [0, 0.45, 0.32, 2.0, 0.5, 0.26], [-0.9, 0.38, 0, 0.2, 0.36, 0.9], [0.9, 0.38, 0, 0.2, 0.36, 0.9], [-0.47, 0.38, -0.05, 0.86, 0.14, 0.72], [0.47, 0.38, -0.05, 0.86, 0.14, 0.72]]
    .forEach(([x, y, z, w, h, d]) => { const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, 0.05), sofaM); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; sofa.add(m); });
  sofa.rotation.y = Math.PI; piece(sofa, t + 2.55, 'rise');
  const plant = new THREE.Group(); plant.position.set(RX - 0.3, 0, -1.8);
  add(new THREE.CylinderGeometry(0.17, 0.13, 0.42, 24), M({ color: '#D9D3C8', roughness: 0.7 }), 0, 0.21, 0, plant);
  const leafM = M({ color: '#4E7A42', roughness: 0.7, side: THREE.DoubleSide });
  for (let i = 0; i < 16; i++) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 6), leafM); l.scale.set(1, 0.18, 0.45);
    const a = i / 16 * Math.PI * 2, r = 0.12 + rnd() * 0.1; l.position.set(Math.cos(a) * r, 0.62 + rnd() * 0.55, Math.sin(a) * r);
    l.rotation.set(rnd() * 0.8 - 0.4, -a, 0.5 + rnd() * 0.5); l.castShadow = true; plant.add(l);
  }
  piece(plant, t + 2.7, 'rise');
  kitchen.traverse(o => { if (o.isMesh && o.material !== led) { o.castShadow = o.castShadow !== false; o.receiveShadow = true; } });

  /* ---------- Материалы: переключение ---------- */
  const texCache = new Map();
  function facadeTex(kind, hex) {
    const key = kind + hex; if (texCache.has(key)) return texCache.get(key);
    let c = null;
    if (kind === 'wood') c = woodCanvas(hex);
    else if (kind === 'frame') c = frameCanvas(hex, false);
    else if (kind === 'woodframe') c = frameCanvas(hex, true);
    else if (kind === 'concrete') c = concreteCanvas(hex, 512);
    else if (kind === 'stone') c = marbleCanvas(hex, '150,145,140', 512);
    const tex = c ? T(c, { rep: false }) : null; texCache.set(key, tex); return tex;
  }
  const state = { facade: 'agt', color: 1, top: 'stone' };
  function setFacade(id, ci = 0) {
    const f = FACADES.find(x => x.id === id) || FACADES[0], [, kind, hex] = f.colors[ci] || f.colors[0];
    state.facade = f.id; state.color = ci;
    const map = facadeTex(kind, hex);
    facadeMat.map = map; facadeMat.color.set(map ? '#FFFFFF' : hex);
    facadeMat.roughness = kind === 'gloss' ? 0.04 : kind === 'paint' ? 0.32 : f.rough;
    facadeMat.clearcoat = kind === 'gloss' ? 1 : f.cc; facadeMat.clearcoatRoughness = kind === 'gloss' ? 0.02 : 0.3;
    facadeMat.envMapIntensity = kind === 'gloss' ? 1.1 : envInt;
    facadeMat.needsUpdate = true;
    edgeMat.color.set(f.edge || (map ? new THREE.Color(hex).offsetHSL(0, 0, -0.05) : hex));
    carcMat.color.set(kind === 'wood' || kind === 'woodframe' ? '#E8E3DA' : '#ECEAE5');
  }
  function setTop(id) {
    const tp = TOPS.find(x => x.id === id) || TOPS[0]; state.top = tp.id;
    const key = 'top' + tp.id;
    if (!texCache.has(key)) { const c = tp.kind === 'marble' ? marbleCanvas(tp.color) : tp.kind === 'speck' ? speckCanvas(tp.color) : woodCanvas(tp.color, 1024, false); const tt = T(c); tt.repeat.set(1 / 1.6, 1 / 1.6); texCache.set(key, tt); }
    topMat.map = texCache.get(key); topMat.roughness = tp.kind === 'wood' ? 0.45 : 0.18; topMat.clearcoat = tp.kind === 'wood' ? 0.15 : 0.5; topMat.needsUpdate = true;
  }
  setFacade('agt', 1); setTop('stone');

  /* ---------- 4 этапа работы ASD: замер → дизайн-проект → производство → монтаж ---------- */
  kitchen.updateMatrixWorld(true);
  const decor = new Set([dining, lamps, sofa, plant]);
  const kParts = parts.filter(p => !decor.has(p.obj)), dParts = parts.filter(p => decor.has(p.obj));
  const _b = new THREE.Box3(), _c = new V3();
  parts.forEach(p => { p.obj.visible = true; });
  kitchen.updateMatrixWorld(true);
  // направление «выноса» модуля в комнату (для производства) и чертёж по рёбрам
  const BLUE = new THREE.Color('#2F6FE4');
  const bpMat = () => new THREE.LineBasicMaterial({ color: BLUE, transparent: true, opacity: 0, depthWrite: false });
  const blueprint = new THREE.Group(); scene.add(blueprint);
  kParts.forEach(p => {
    _b.setFromObject(p.obj); _b.getCenter(_c);
    const side = _c.x < -2.3 && _c.z > -1.6;
    p.off = side ? new V3(0.7, 0.1, 0) : new V3(0, 0.1, 0.7);
    const segs = [];
    p.obj.traverse(o => {
      if (!o.isMesh || o.material === led) return;
      const e = new THREE.EdgesGeometry(o.geometry, 25); e.applyMatrix4(o.matrixWorld); segs.push(e);
    });
    if (segs.length) {
      const pos = []; segs.forEach(e => pos.push(...e.attributes.position.array));
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      p.bp = new THREE.LineSegments(g, bpMat()); p.bp.renderOrder = 6; blueprint.add(p.bp);
    }
  });
  parts.forEach(p => { p.obj.visible = false; });

  // размерные линии с подписями
  function label(text, color = '#C2410C') {
    const [c, g] = cv(512, 128);
    g.font = '600 58px Manrope, Arial, sans-serif'; const w = Math.min(500, g.measureText(text).width + 48);
    g.fillStyle = 'rgba(255,255,255,.94)'; g.beginPath(); g.roundRect((512 - w) / 2, 22, w, 84, 42); g.fill();
    g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 66);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: T(c, { rep: false }), depthTest: false, transparent: true, opacity: 0 }));
    sp.scale.set(0.9, 0.225, 1); sp.renderOrder = 9; return sp;
  }
  function dim(a, b, text, color, tick = new V3(0, 0.06, 0)) {
    const g = new THREE.Group(), A = new V3(...a), B = new V3(...b);
    const pts = [A, B, A.clone().add(tick), A.clone().sub(tick), B.clone().add(tick), B.clone().sub(tick)];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const ln = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthTest: false })); ln.renderOrder = 8; g.add(ln);
    const lb = label(text, color); lb.position.copy(A).lerp(B, 0.5).add(new V3(0, 0.1, 0)); g.add(lb);
    g.userData = { ln, lb, A, B }; scene.add(g); return g;
  }
  const RED = '#C2410C';
  const mDims = [
    dim([-RX + 0.02, 0.03, -RZ + 0.03], [RX - 0.02, 0.03, -RZ + 0.03], '6 000 мм', RED, new V3(0, 0.08, 0)),
    dim([-RX + 0.03, 0, -RZ + 0.03], [-RX + 0.03, RH, -RZ + 0.03], '2 750 мм', RED, new V3(0.08, 0, 0)),
    dim([-RX + 0.03, 0.03, -RZ + 0.03], [-RX + 0.03, 0.03, RZ - 0.03], '4 200 мм', RED, new V3(0, 0.08, 0)),
    dim([RX - 0.03, WIN.y0 - 0.05, WIN.z0], [RX - 0.03, WIN.y0 - 0.05, WIN.z1], 'окно 2 000', RED, new V3(0, 0.08, 0))
  ];
  const kDims = [
    dim([-RX, 2.52, -RZ + 0.4], [0.16, 2.52, -RZ + 0.4], '3 160 мм', '#2F6FE4', new V3(0, 0.07, 0)),
    dim([-RX + 0.4, 2.52, -RZ], [-RX + 0.4, 2.52, 0.26], '2 360 мм', '#2F6FE4', new V3(0, 0.07, 0)),
    dim([1.45, 0, -RZ + 0.62], [1.45, TALL, -RZ + 0.62], '2 350 мм', '#2F6FE4', new V3(0.07, 0, 0)),
    dim([-RX + 0.7, 0, -RZ + 0.62], [-RX + 0.7, TOP, -RZ + 0.62], '900 мм', '#2F6FE4', new V3(0.07, 0, 0))
  ];
  const showDim = (d, k) => { d.visible = k > 0.001; const { ln, lb } = d.userData; ln.material.opacity = k; lb.material.opacity = k; ln.scale.setScalar(1); };

  // люди: заказчик, замерщик ASD, два монтажника
  const skinM = M({ color: '#E2B894', roughness: 0.7 });
  function person({ shirt, pants, hair = '#3B2A20', cap = null }) {
    const g = new THREE.Group(), m = (c, r = 0.85) => M({ color: c, roughness: r });
    const shirtM = m(shirt), pantsM = m(pants), shoeM = m('#1E1E1E', 0.6);
    const leg = (x) => { const p = new THREE.Group(); p.position.set(x, 0.9, 0); const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.068, 0.72, 4, 10), pantsM); l.position.y = -0.43; p.add(l); const s = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.08, 0.26, 2, 0.03), shoeM); s.position.set(0, -0.86, 0.05); p.add(s); g.add(p); return p; };
    const arm = (x) => { const p = new THREE.Group(); p.position.set(x, 1.44, 0); const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.5, 4, 10), shirtM); a.position.y = -0.3; p.add(a); const h = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), skinM); h.position.y = -0.6; p.add(h); g.add(p); return p; };
    const legL = leg(-0.1), legR = leg(0.1);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.42, 6, 16), shirtM); torso.scale.set(1.12, 1, 0.72); torso.position.y = 1.2; g.add(torso);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 12), skinM); neck.position.y = 1.55; g.add(neck);
    const head = new THREE.Group(); head.position.y = 1.67; g.add(head);
    const hd = new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 16), skinM); hd.scale.set(0.95, 1.1, 1); head.add(hd);
    const hr = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), m(hair, 0.9)); hr.position.set(0, 0.02, -0.01); head.add(hr);
    if (cap) { const c = new THREE.Mesh(new THREE.SphereGeometry(0.115, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), m(cap, 0.7)); c.position.y = 0.03; head.add(c); const v = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.012, 20, 1, false, -Math.PI / 2, Math.PI), m(cap, 0.7)); v.position.set(0, 0.03, 0.06); head.add(v); }
    const armL = arm(-0.24), armR = arm(0.24);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.visible = false; scene.add(g);
    return { g, legL, legR, armL, armR, head, torso };
  }
  const client = person({ shirt: '#9DB4C8', pants: '#3A3F4A', hair: '#5A3B26' });
  const measurer = person({ shirt: '#2F3A33', pants: '#2A2C30', hair: '#2A2420', cap: '#8FA68E' });
  const inst1 = person({ shirt: '#8FA68E', pants: '#2A2C30', cap: '#2F3A33' }), inst2 = person({ shirt: '#8FA68E', pants: '#2A2C30', cap: '#2F3A33' });
  // планшет и лазерный дальномер замерщика
  const tablet = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.012, 0.27, 2, 0.006), M({ color: '#1C1C1E', roughness: 0.3 })); tablet.position.set(0.02, -0.6, 0.12); tablet.rotation.x = 0.5; measurer.armL.add(tablet);
  const meter = new THREE.Mesh(box(0.05, 0.03, 0.11), M({ color: '#D9A441', roughness: 0.5 })); meter.position.set(0, -0.62, 0.04); measurer.armR.add(meter);
  const laser = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new V3(), new V3(0, 0, 1)]), new THREE.LineBasicMaterial({ color: '#FF2A2A', transparent: true, opacity: 0.9 }));
  laser.visible = false; laser.renderOrder = 7; scene.add(laser);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), new THREE.MeshBasicMaterial({ color: '#FF3B3B' })); dot.visible = false; scene.add(dot);

  const walkTo = (P, from, to, k, t) => { // проход по прямой с шагом
    const x = lerp(from[0], to[0], easeIO(k)), z = lerp(from[1], to[1], easeIO(k));
    P.g.position.set(x, 0, z);
    if (k < 1) { P.g.rotation.y = Math.atan2(to[0] - from[0], to[1] - from[1]); const s = Math.sin(t * 7.5) * 0.45; P.legL.rotation.x = s; P.legR.rotation.x = -s; P.armL.rotation.x = -s * 0.7; P.armR.rotation.x = s * 0.7; }
    return k >= 1;
  };
  const still = P => { P.legL.rotation.x = P.legR.rotation.x = 0; };
  const face = (P, x, z) => { P.g.rotation.y = Math.atan2(x - P.g.position.x, z - P.g.position.z); };

  // речь и пожелания (HTML поверх 3D)
  const ov = opts.overlay || null;
  const bubbleC = ov && Object.assign(document.createElement('div'), { className: 'apt-say' });
  const bubbleM = ov && Object.assign(document.createElement('div'), { className: 'apt-say is-asd' });
  const notes = ov && Object.assign(document.createElement('div'), { className: 'apt-notes' });
  if (ov) ov.append(bubbleC, bubbleM, notes);
  const SAY = ['Хочу угловую кухню, чтобы было много места', 'Холодильник встроенный, в пенал', 'Фасады без ручек, современные', 'И подсветку над столешницей', 'Стол — у окна'];
  const WISH = ['Угловая кухня, мойка у стены', 'Пенал: духовой шкаф + холодильник', 'Фасады без ручек (профиль Gola)', 'Подсветка рабочей зоны', 'Обеденная зона у окна'];
  const _p = new V3();
  function bubble(el, P, text, show) {
    if (!el) return;
    el.style.opacity = show ? 1 : 0;
    if (!show) return;
    if (el.textContent !== text) el.textContent = text;
    _p.set(P.g.position.x, 2.05, P.g.position.z).project(cam);
    el.style.transform = `translate(${(_p.x + 1) / 2 * W}px, ${(1 - _p.y) / 2 * H}px) translate(-50%, -100%)`;
  }
  function setNotes(n, show) {
    if (!notes) return;
    notes.style.opacity = show ? 1 : 0;
    const html = '<b>Пожелания заказчика</b><ul>' + WISH.slice(0, n).map(w => `<li>${w}</li>`).join('') + '</ul>';
    if (notes.dataset.n !== String(n)) { notes.innerHTML = html; notes.dataset.n = n; }
  }

  let stage = 0, tS = 0, finishK = -1;
  const STAGE_LEN = [0, Infinity, 4.5, 4.2, 0];
  function setFinish(k) {
    if (k === finishK) return; finishK = k;
    floorWood.opacity = k; floorWood.transparent = k < 0.999; floorWood.depthWrite = k > 0.99; floorWood.needsUpdate = true;
    const plaster = k > 0.5;
    if ((wallMat.map === plasterT) !== plaster) { wallMat.map = plaster ? plasterT : concreteT; wallMat.needsUpdate = true; ceilMat.map = plaster ? null : ceilMat.userData.map; ceilMat.color.set(plaster ? '#F4F2EE' : '#FFFFFF'); ceilMat.needsUpdate = true; }
    finish.visible = plaster;
  }
  ceilMat.userData.map = ceilMat.map;
  function frontsAnim(obj, k) {
    const fr = obj.userData.fronts; if (!fr) return;
    fr.forEach((f, i) => {
      const kk = easeOut((k - 0.35 - i * 0.12) / 0.6);
      if (f.type === 'door') f.pivot.rotation.y = (f.hinge === 'r' ? 1 : -1) * (1 - kk) * 1.35;
      else if (f.type === 'drawer') f.pivot.position.z = -FT / 2 + (1 - kk) * 0.38;
    });
  }
  const placeHome = p => { p.obj.visible = true; p.obj.position.copy(p.home); p.obj.rotation.copy(p.rot); p.obj.scale.setScalar(1); frontsAnim(p.obj, 9); };

  // Состояние сцены целиком определяется (этап, время в этапе)
  function pose(dt) {
    const t = tS;
    // отделка
    setFinish(stage < 4 ? 0 : stage === 4 ? easeIO(t / 1.2) : 1);
    // люди
    [client, measurer, inst1, inst2].forEach(P => { P.g.visible = false; });
    laser.visible = dot.visible = false;
    let sayC = false, sayM = false, nNotes = 0;
    if (stage === 1) {
      client.g.visible = measurer.g.visible = true;
      const doneC = walkTo(client, [-2.2, 2.6], [0.0, -0.7], t / 2.4, t);
      const doneM = walkTo(measurer, [-2.2, 2.6], [-1.35, -0.15], (t - 0.5) / 2.4, t);
      if (doneC) { still(client); face(client, -1.2, -2); const g = t * 2.6; client.armR.rotation.set(-1.1 + Math.sin(g) * 0.35, 0, -0.25 + Math.sin(g * 0.7) * 0.15); client.armL.rotation.set(-0.3 + Math.sin(g + 1) * 0.15, 0, 0.1); client.head.rotation.y = Math.sin(t * 0.9) * 0.25; sayC = true; }
      if (doneM) {
        still(measurer);
        const cyc = (t - 3) % 9, targets = [[-1.5, 0.05, -RZ], [-RX, 1.2, -1.2], [RX, 1.3, 0.4], [-RX, 2.2, -RZ]];
        if (t > 3 && cyc < 4) { // замер дальномером
          const tg = new V3(...targets[Math.floor((t - 3) / 9 * 4 + cyc) % 4]);
          face(measurer, tg.x, tg.z); measurer.armR.rotation.set(-1.45, 0, 0); measurer.armL.rotation.set(-0.2, 0, 0); measurer.head.rotation.x = 0;
          measurer.g.updateMatrixWorld(true); const hand = new V3(0, -0.66, 0.08); measurer.armR.localToWorld(hand);
          laser.geometry.setFromPoints([hand, tg]); laser.visible = dot.visible = true; dot.position.copy(tg);
        } else { // записывает пожелания
          face(measurer, client.g.position.x, client.g.position.z);
          measurer.armL.rotation.set(-1.05, 0, 0.15); measurer.armR.rotation.set(-1.2 + Math.sin(t * 14) * 0.05, 0, -0.35 + Math.sin(t * 9) * 0.05); measurer.head.rotation.x = 0.35;
          sayM = cyc > 7.5;
        }
        nNotes = clamp(Math.floor((t - 3.5) / 1.8) + 1, 0, WISH.length);
      }
    }
    bubble(bubbleC, client, SAY[Math.floor(t / 3.2) % SAY.length], sayC);
    bubble(bubbleM, measurer, 'Записал. Всё учтём в проекте', sayM);
    setNotes(stage === 2 ? WISH.length : nNotes, stage === 1 && nNotes > 0 || stage === 2);
    // размеры помещения
    mDims.forEach((d, i) => showDim(d, stage === 1 ? easeOut((t - 4 - i * 2.2) / 0.6) : stage === 2 ? 0.35 * (1 - easeOut(t / 1.5)) : 0));
    kDims.forEach((d, i) => showDim(d, stage === 2 ? easeOut((t - 2.2 - i * 0.35) / 0.5) : stage === 3 ? 1 - easeOut(t / 1) : 0));
    // чертёж
    kParts.forEach((p, i) => { if (!p.bp) return;
      const k = stage === 2 ? easeOut((t - i * 0.1) / 0.6) * 0.95 : stage === 3 ? 0.4 : stage === 4 ? 0.4 * (1 - easeOut((t - 1.4 - i * 0.16 - 0.6) / 0.5)) : 0;
      p.bp.material.opacity = k; p.bp.visible = k > 0.01; });
    // модули кухни
    if (stage < 3) kParts.forEach(p => { p.obj.visible = false; });
    else if (stage === 3) kParts.forEach((p, i) => {
      const k = (t - i * 0.13) / 0.8; const o = p.obj;
      if (k <= 0 || o === ledStrip) { o.visible = false; return; }
      o.visible = true; o.rotation.copy(p.rot); o.position.copy(p.home).add(p.off); o.scale.set(1, Math.max(0.001, easeOut(k)), 1); frontsAnim(o, 9);
    });
    else if (stage === 4) kParts.forEach((p, i) => {
      const o = p.obj, k = (t - 1.4 - i * 0.16) / 0.9;
      o.visible = true; o.rotation.copy(p.rot); o.scale.setScalar(1);
      o.position.copy(p.home).addScaledVector(p.off, 1 - easeIO(k));
      if (o === ledStrip) o.scale.set(Math.max(0.001, easeOut(k)), 1, 1);
      frontsAnim(o, k < 0 ? 9 : k);
    });
    else kParts.forEach(placeHome);
    // монтажники
    const tEnd = 1.4 + kParts.length * 0.16 + 1.2;
    if (stage === 4) {
      inst1.g.visible = inst2.g.visible = true;
      const inW = t / 1.6, outW = (t - tEnd) / 1.6;
      [[inst1, [-0.9, -0.2]], [inst2, [-1.3, 0.4]]].forEach(([P, pos], j) => {
        if (outW < 0) {
          if (walkTo(P, [-2.2, 2.6], pos, inW - j * 0.15, t)) { still(P); face(P, j ? -RX : -1.2, j ? -0.6 : -RZ); const s = Math.sin(t * 3 + j); P.armL.rotation.set(-1.25 + s * 0.25, 0, 0.15); P.armR.rotation.set(-1.25 - s * 0.25, 0, -0.15); P.head.rotation.x = 0.15; }
        } else if (walkTo(P, pos, [-2.2, 2.9], outW, t)) P.g.visible = false;
      });
    }
    // декор и свет
    const kd = stage === 4 ? (t - tEnd + 0.6) : stage === 5 ? 99 : -1;
    dParts.forEach((p, i) => { const k = (kd - i * 0.2) / 0.8; if (k <= 0) { p.obj.visible = false; return; } placeHome(p); const b = easeBack(k); p.obj.scale.setScalar(Math.max(0.001, Math.min(b, 1.08))); });
    const kl = stage === 5 ? 1 : stage === 4 ? easeOut((t - tEnd) / 1.2) : 0;
    lampLights.forEach(l => { l.intensity = kl * 2.2; }); underLight.intensity = kl * 1.4; fill.intensity = kl * 1.2;
    if (stage === 4 && t > tEnd + 2.4) { stage = 5; tS = 0; if (opts.onStage) opts.onStage(5); }
    if ((stage === 2 || stage === 3) && t > STAGE_LEN[stage] && !pose.notified) { pose.notified = true; if (opts.onStage) opts.onStage(stage, true); }
  }
  function resetParts() {
    parts.forEach(p => { p.obj.visible = false; p.obj.position.copy(p.home); p.obj.rotation.copy(p.rot); p.obj.scale.setScalar(1); });
    stage = 0; tS = 0; finishK = -1; setFinish(0); pose(0);
  }
  function next() { if (stage < 5) { stage = stage === 0 ? 1 : stage + 1; tS = 0; pose.notified = false; if (stage === 2 || stage === 3) Object.assign(goal, { yaw: 0.62, pitch: 0.2, dist: 4.6 }); if (stage === 4) Object.assign(goal, homeView); if (opts.onStage) opts.onStage(stage); } }
  function build() { if (stage === 0) next(); }
  function showBuilt() { stage = 5; tS = 0; pose(0); }


  /* ---------- Камера и управление ---------- */
  const target = new V3(-1.1, 1.0, -1.2);
  const homeView = { yaw: 0.78, pitch: 0.17, dist: 4.4 };
  const st = { ...homeView }, goal = { ...homeView };
  let fly = null; // вход через окно
  function camFromState() {
    const cp = Math.cos(st.pitch);
    const p = new V3(target.x + Math.sin(st.yaw) * cp * st.dist, target.y + Math.sin(st.pitch) * st.dist, target.z + Math.cos(st.yaw) * cp * st.dist);
    // камера остаётся внутри комнаты
    const lim = [[-RX + 0.25, RX - 0.25], [0.35, RH - 0.25], [-RZ + 0.25, RZ - 0.25]];
    const d = p.clone().sub(target); let s = 1;
    ['x', 'y', 'z'].forEach((k, i) => { const v = target[k] + d[k]; if (v < lim[i][0]) s = Math.min(s, (lim[i][0] - target[k]) / d[k]); if (v > lim[i][1]) s = Math.min(s, (lim[i][1] - target[k]) / d[k]); });
    p.copy(target).addScaledVector(d, clamp(s, 0.05, 1));
    return p;
  }
  function enterFly() {
    const end = camFromState();
    fly = { t: 0, from: new V3(RX + 1.8, 1.7, 0.95), to: end, dur: 2.2 };
  }
  const ctl = { drag: null, ptrs: new Map(), pinch: null };
  function bind(el) {
    el.addEventListener('pointerdown', e => {
      if (!api.active) return;
      ctl.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ctl.ptrs.size === 1) ctl.drag = { x: e.clientX, y: e.clientY };
      else { const [a, b] = [...ctl.ptrs.values()]; ctl.pinch = Math.hypot(a.x - b.x, a.y - b.y); ctl.drag = null; }
      fly = null;
    });
    el.addEventListener('pointermove', e => {
      if (!api.active) return;
      if (ctl.ptrs.has(e.pointerId)) ctl.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ctl.pinch && ctl.ptrs.size >= 2) { const [a, b] = [...ctl.ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y); goal.dist = clamp(goal.dist * ctl.pinch / d, 1.4, 4.6); ctl.pinch = d; return; }
      if (!ctl.drag) return;
      goal.yaw -= (e.clientX - ctl.drag.x) * 0.0045; goal.pitch = clamp(goal.pitch + (e.clientY - ctl.drag.y) * 0.003, -0.15, 0.75);
      goal.yaw = clamp(goal.yaw, -0.45, 2.75);
      ctl.drag = { x: e.clientX, y: e.clientY };
    });
    const up = e => { ctl.ptrs.delete(e.pointerId); if (ctl.ptrs.size < 2) ctl.pinch = null; if (!ctl.ptrs.size) ctl.drag = null; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', e => { if (!api.active) return; e.preventDefault(); e.stopPropagation(); goal.dist = clamp(goal.dist * Math.exp(clamp(e.deltaY, -100, 100) * 0.002), 1.4, 4.6); }, { passive: false });
  }

  /* ---------- Постобработка ---------- */
  let composer = null, gtao = null, bloom = null, W = 1, H = 1;
  const perf = { ema: 0.016, n: 0 };
  function makeComposer() {
    if (lite) return;
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt); composer.setPixelRatio(Math.min(renderer.getPixelRatio(), 1.5));
    composer.addPass(new RenderPass(scene, cam));
    gtao = new GTAOPass(scene, cam, W, H);
    gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.2, thickness: 1.2, scale: 1.1, samples: 12 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
    gtao.blendIntensity = 0.9;
    composer.addPass(gtao);
    bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.32, 0.5, 0.92);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }
  function resize(w, h) {
    W = w; H = h; cam.aspect = w / h; cam.updateProjectionMatrix();
    if (!composer && api.active) makeComposer();
    if (composer) { composer.setPixelRatio(Math.min(renderer.getPixelRatio(), 1.5)); composer.setSize(w, h); }
  }

  /* ---------- Кадр ---------- */
  function frame(dt) {
    tS += dt; pose(dt);
    let pos;
    if (fly) {
      fly.t += dt; const k = easeIO(fly.t / fly.dur);
      pos = fly.from.clone().lerp(fly.to, k);
      if (fly.t >= fly.dur) fly = null;
    } else {
      const k = 1 - Math.exp(-dt * 8);
      st.yaw += (goal.yaw - st.yaw) * k; st.pitch += (goal.pitch - st.pitch) * k; st.dist += (goal.dist - st.dist) * k;
      pos = camFromState();
    }
    cam.position.copy(pos); cam.lookAt(target);
    const exp = renderer.toneMappingExposure; renderer.toneMappingExposure = 1.0;
    renderer.setClearColor('#D9D4CB', 1);
    // адаптивное качество: если кадры тяжёлые — по очереди отключаем AO, свечение, снижаем разрешение
    perf.ema = perf.ema * 0.95 + dt * 0.05; perf.n++;
    if (composer && perf.n > 40 && perf.ema > 0.024) {
      perf.n = 0;
      if (gtao.enabled) gtao.enabled = false;
      else if (bloom.enabled) bloom.enabled = false;
      else if (renderer.getPixelRatio() > 1) { renderer.setPixelRatio(1); composer.setPixelRatio(1); composer.setSize(W, H); }
    }
    if (composer) composer.render(dt); else renderer.render(scene, cam);
    renderer.toneMappingExposure = exp;
  }

  const api = {
    active: false, scene, cam, state, FACADES, TOPS,
    get phase() { return stage === 0 ? 'empty' : stage === 5 ? 'built' : 'building'; }, get stage() { return stage; }, next,
    enter() { resetParts(); Object.assign(st, homeView); Object.assign(goal, homeView); enterFly(); api.active = true; resize(W, H); },
    exit() { api.active = false; fly = null; },
    build, showBuilt, reset: resetParts, setFacade, setTop, resize, frame, bind,
    home() { Object.assign(goal, homeView); },
    debugT(v) { fly = null; Object.assign(st, goal); tS = v; },
    skip() { fly = null; Object.assign(st, goal); tS += 30; pose(0); }
  };
  resetParts();
  return api;
}
