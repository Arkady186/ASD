/* ЖК «Октябрь Парк» · интерактивный 3D-генплан квартала.
   Камера откалибрована по фото генплана (assets/img/kvartal.webp), поэтому 3D
   совпадает с фото: после спуска с облаков «шторка» справа налево открывает 3D,
   кнопка «Фото-план» задвигает шторку обратно.
   Сданы 5 домов (детально), остальные 17 показаны как прозрачные макеты «в проекте». */
import * as THREE from 'three';
import { mergeGeometries as mergeRaw, mergeVertices } from './vendor/jsm/utils/BufferGeometryUtils.js';
// Слияние геометрий: приводим к общему набору атрибутов и неиндексированному виду
function mergeGeometries(list) {
  const keys = list.map(g => Object.keys(g.attributes).sort().join());
  const common = Object.keys(list[0].attributes).filter(k => list.every(g => g.attributes[k]));
  const mixedIdx = list.some(g => g.index) && list.some(g => !g.index);
  const prep = list.map(g => {
    let q = g;
    if (mixedIdx && q.index) q = q.toNonIndexed();
    for (const k of Object.keys(q.attributes)) if (!common.includes(k)) q.deleteAttribute(k);
    return q;
  });
  const out = mergeRaw(prep, false);
  if (!out) throw new Error('merge failed: ' + keys.join(' | '));
  return out;
}
import { DATA } from './k3d-data.js';
import { createApartment } from './apartment3d.js';

const section = document.getElementById('kvartal');
const media = section && section.querySelector('.media');
const plate = section && section.querySelector('.plate');
const phoneMQ = matchMedia('(max-width: 899px)');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const LITE = phoneMQ.matches || MOBILE || (navigator.hardwareConcurrency || 8) <= 4;

const V3 = THREE.Vector3;
let seed = 20261106;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = a => a[Math.floor(rnd() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/* ---------- Плоская геометрия: полигоны и расстояния (x, z) ---------- */
function pip(x, z, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function segDist(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz || 1;
  const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / L, 0, 1);
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
}
function bbox(poly, pad = 0) {
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  poly.forEach(([x, z]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); });
  return [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
}
// Сглаженная ломаная (Catmull-Rom) с шагом ~step метров
function smooth(pts, step = 4) {
  if (pts.length < 3) return densify(pts, step);
  const c = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new V3(x, 0, z)), false, 'centripetal');
  const n = Math.max(2, Math.round(c.getLength() / step));
  return c.getSpacedPoints(n).map(v => [v.x, v.z]);
}
function densify(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 0; k < n; k++) out.push([lerp(ax, bx, k / n), lerp(az, bz, k / n)]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
function polyline(pts) {
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = acc[acc.length - 1];
  const at = s => {
    s = clamp(s, 0, total);
    let lo = 0, hi = acc.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (acc[m] <= s) lo = m; else hi = m; }
    const t = (s - acc[lo]) / ((acc[hi] - acc[lo]) || 1), a = pts[lo], b = pts[hi];
    return { x: lerp(a[0], b[0], t), z: lerp(a[1], b[1], t), dx: (b[0] - a[0]) / ((acc[hi] - acc[lo]) || 1), dz: (b[1] - a[1]) / ((acc[hi] - acc[lo]) || 1) };
  };
  return { pts, total, at };
}
// Лента вдоль ломаной: дороги, тротуары, дорожки. UV: u — метры вдоль, v — 0..1 поперёк
function ribbonGeo(pts, width, y, offset = 0) {
  const pos = [], uv = [], idx = [];
  let s = 0;
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    if (i) s += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    const nx = -dz, nz = dx, l = offset - width / 2, r = offset + width / 2;
    pos.push(p[0] + nx * l, y, p[1] + nz * l, p[0] + nx * r, y, p[1] + nz * r);
    uv.push(s, 0, s, 1);
    if (i) { const o = (i - 1) * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// Плоский полигон на высоте y (UV в метрах / period)
function flatPoly(poly, y, period = 10) {
  const sh = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(sh);
  g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / period, p.getZ(i) / period);
  return g;
}
// Призма по полигону: стены и крыша (UV стен в метрах)
function prismGeo(poly, h, y0 = 0) {
  const sh = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); g.translate(0, y0, 0);
  return g;
}

/* ---------- Текстуры (рисуются в canvas) ---------- */
function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function grain(g, w, h, n, a, size = 2) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = rnd() > 0.5 ? `rgba(255,255,255,${a * rnd()})` : `rgba(0,0,0,${a * rnd()})`;
    g.fillRect(rnd() * w, rnd() * h, size, size);
  }
}
function tex(c, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

// Фасад сданного дома (по фото): белые простенки, терракотовые и тёмно-коричневые полосы с лоджиями
const FH = 2.95, FLOORS = 25, PLINTH = 4.4, MOD = 38;
const COL = { white: '#ECE9E3', terra: '#9C6449', dark: '#4A3428', frame: '#E4E0D8', glassTop: '#9DB1C2', glassBot: '#2B3742' };
const BANDS = [
  [2.4, 'W1'], [4.6, 'DL'], [1.6, 'W0'], [5.2, 'WP'], [3.6, 'TL'], [2.2, 'W1'],
  [1.4, 'W0'], [4.4, 'DL'], [1.4, 'W0'], [5.2, 'WP'], [3.6, 'TP'], [2.4, 'W1']
];
function glass(g, r, x, y, w, h, ppm) {
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, COL.glassTop); gr.addColorStop(0.45, '#4A5B69'); gr.addColorStop(1, COL.glassBot);
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.fillStyle = COL.frame;
  const fw = Math.max(1, 0.07 * ppm);
  g.fillRect(x, y, w, fw); g.fillRect(x, y + h - fw, w, fw); g.fillRect(x, y, fw, h); g.fillRect(x + w - fw, y, fw, h);
  r.fillStyle = '#2a2a2a'; r.fillRect(x, y, w, h);
}
function facadeTextures(ppm, bands, width, floors, accent) {
  const W = Math.round(width * ppm), H = Math.round(floors * FH * ppm);
  const [c, g] = cv(W, H), [cr, r] = cv(W, H);
  r.fillStyle = '#e0e0e0'; r.fillRect(0, 0, W, H);
  let x = 0;
  bands.forEach(([bw, type]) => {
    const X = x * ppm, BW = bw * ppm;
    const base = type[0] === 'W' ? COL.white : type[0] === 'T' ? COL.terra : COL.dark;
    g.fillStyle = base; g.fillRect(X, 0, BW, H);
    if (type[0] !== 'W') { // кирпич: лёгкие горизонтальные швы
      g.fillStyle = 'rgba(0,0,0,.07)';
      for (let yy = 0; yy < H; yy += Math.max(2, 0.3 * ppm)) g.fillRect(X, yy, BW, 1);
    }
    for (let f = 0; f < floors; f++) {
      const y0 = H - (f + 1) * FH * ppm;
      const win = (cxm, wm, hm = 1.55, sill = 0.85) => glass(g, r, X + (cxm - wm / 2) * ppm, y0 + (FH - sill - hm) * ppm, wm * ppm, hm * ppm, ppm);
      if (type === 'W1') win(bw / 2, 1.2);
      else if (type === 'WP') { win(bw * 0.27, 1.35); win(bw * 0.73, 1.35); }
      else if (type === 'TP') {
        win(bw * 0.3, 1.1); win(bw * 0.72, 1.1);
        g.fillStyle = 'rgba(40,30,25,.85)'; // корзины кондиционеров
        g.fillRect(X + (bw * 0.5 - 0.3) * ppm, y0 + (FH - 0.95) * ppm, 0.6 * ppm, 0.45 * ppm);
      } else if (type === 'TL' || type === 'DL') {
        const gx = X + 0.3 * ppm, gw = BW - 0.6 * ppm, gy = y0 + 0.28 * ppm, gh = (FH - 1.15) * ppm;
        glass(g, r, gx, gy, gw, gh, ppm);
        g.fillStyle = COL.frame; const n = Math.max(2, Math.round(bw / 1.2));
        for (let k = 1; k < n; k++) g.fillRect(gx + gw * k / n - 0.5, gy, Math.max(1, 0.05 * ppm), gh);
        g.fillStyle = type === 'DL' ? '#4A3226' : '#A5633F'; g.fillRect(gx, gy + gh, gw, 0.85 * ppm);
        g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(gx, gy + gh + 0.85 * ppm - 2, gw, 2);
        if (type === 'DL' && accent && f % 7 === 6) { g.fillStyle = COL.white; g.fillRect(X, y0 + FH * ppm - 0.55 * ppm, BW, 0.55 * ppm); }
      }
      g.fillStyle = 'rgba(0,0,0,.06)'; g.fillRect(X, y0 + FH * ppm - 1, BW, 1); // межэтажный шов
    }
    // тень на стыке полос даёт объём
    g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(X, 0, Math.max(1, 0.08 * ppm), H);
    x += bw;
  });
  grain(g, W, H, W * H / 90, 0.05);
  return { map: tex(c), rough: tex(cr, { srgb: false }) };
}
function plinthTexture(ppm) {
  const W = Math.round(MOD * ppm), H = Math.round(PLINTH * ppm), [c, g] = cv(W, H), [cr, r] = cv(W, H);
  g.fillStyle = '#4C3529'; g.fillRect(0, 0, W, H); r.fillStyle = '#dcdcdc'; r.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,.05)'; for (let y = 0; y < H; y += Math.max(2, 0.25 * ppm)) g.fillRect(0, y, W, 1);
  // витрины и входная группа
  for (let x = 1.2; x < MOD - 2; x += 3.6) glass(g, r, x * ppm, 0.6 * ppm, 2.6 * ppm, 2.9 * ppm, ppm);
  g.fillStyle = '#2B201A'; g.fillRect((MOD / 2 - 1.6) * ppm, 0.4 * ppm, 3.2 * ppm, 3.4 * ppm);
  glass(g, r, (MOD / 2 - 1.3) * ppm, 0.9 * ppm, 2.6 * ppm, 3.5 * ppm, ppm);
  grain(g, W, H, W * H / 60, 0.06);
  return { map: tex(c), rough: tex(cr, { srgb: false }) };
}
function solidTexture(base, size = 256, a = 0.06, n = 3000) {
  const [c, g] = cv(size, size); g.fillStyle = base; g.fillRect(0, 0, size, size); grain(g, size, size, n, a); return tex(c);
}
function stripTex(base, win, floorH, period = 24) { // фасады школы, садов и др.: ленты окон
  const ppm = 12, S = period * ppm, [c, g] = cv(S, S), [cr, r] = cv(S, S);
  g.fillStyle = base; g.fillRect(0, 0, S, S); r.fillStyle = '#d8d8d8'; r.fillRect(0, 0, S, S);
  for (let y = 0; y < period; y += floorH) {
    const yy = S - (y + floorH) * ppm;
    for (let x = 0.6; x < period - 1; x += 2.4) glass(g, r, x * ppm, yy + 0.9 * ppm, 1.8 * ppm, (floorH - 1.7) * ppm, ppm);
  }
  grain(g, S, S, 4000, 0.05);
  return { map: tex(c), rough: tex(cr, { srgb: false }) };
}
function grassTexture() {
  const S = 1024, [c, g] = cv(S, S);
  g.fillStyle = '#4C6A35'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 3500; i++) {
    const rr = 8 + rnd() * 60; g.fillStyle = `rgba(${pick(['112,142,70', '74,102,48', '96,124,58', '128,140,74'])},${0.06 + rnd() * 0.1})`;
    g.beginPath(); g.arc(rnd() * S, rnd() * S, rr, 0, 7); g.fill();
  }
  grain(g, S, S, 60000, 0.09, 2);
  return tex(c);
}
function sandTexture() {
  const S = 1024, [c, g] = cv(S, S);
  g.fillStyle = '#E4DED2'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2500; i++) {
    const rr = 10 + rnd() * 80; g.fillStyle = `rgba(${pick(['214,206,190', '236,232,224', '200,196,184', '190,192,184'])},${0.08 + rnd() * 0.12})`;
    g.beginPath(); g.arc(rnd() * S, rnd() * S, rr, 0, 7); g.fill();
  }
  grain(g, S, S, 50000, 0.08);
  return tex(c);
}
function asphaltTexture() { // вдоль u — 10 м, поперёк v — ширина дороги
  const [c, g] = cv(256, 128);
  g.fillStyle = '#55575B'; g.fillRect(0, 0, 256, 128); grain(g, 256, 128, 6000, 0.1);
  g.fillStyle = 'rgba(240,240,235,.85)';
  g.fillRect(0, 61, 140, 6);       // прерывистая осевая
  g.fillRect(0, 6, 256, 3); g.fillRect(0, 119, 256, 3); // кромки
  return tex(c);
}
function parkingTexture() { // u — 2.6 м (место), v — глубина ряда
  const [c, g] = cv(64, 128);
  g.fillStyle = '#5A5C60'; g.fillRect(0, 0, 64, 128); grain(g, 64, 128, 900, 0.1);
  g.fillStyle = 'rgba(245,245,240,.9)'; g.fillRect(0, 0, 3, 52); g.fillRect(0, 76, 3, 52);
  return tex(c);
}
function fieldTexture() {
  const [c, g] = cv(512, 792);
  for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? '#4E8A3A' : '#5B9744'; g.fillRect(0, i * 66, 512, 66); }
  g.strokeStyle = 'rgba(255,255,255,.92)'; g.lineWidth = 4;
  g.strokeRect(12, 12, 488, 768); g.beginPath(); g.moveTo(12, 396); g.lineTo(500, 396); g.stroke();
  g.beginPath(); g.arc(256, 396, 64, 0, 7); g.stroke();
  g.strokeRect(136, 12, 240, 120); g.strokeRect(136, 660, 240, 120);
  g.strokeRect(206, 12, 100, 40); g.strokeRect(206, 740, 100, 40);
  return tex(c, { repeat: false });
}
function trackTexture(col) { // беговые дорожки: полосы поперёк ленты
  const [c, g] = cv(64, 128);
  g.fillStyle = col; g.fillRect(0, 0, 64, 128); grain(g, 64, 128, 800, 0.08);
  g.fillStyle = 'rgba(255,255,255,.75)'; for (let i = 0; i <= 8; i++) g.fillRect(0, Math.round(i * 127 / 8), 64, 2);
  return tex(c);
}
function rubberTexture(col) {
  const [c, g] = cv(128, 128); g.fillStyle = col; g.fillRect(0, 0, 128, 128); grain(g, 128, 128, 2000, 0.1);
  g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 3; g.strokeRect(8, 8, 112, 112); g.beginPath(); g.arc(64, 64, 18, 0, 7); g.stroke();
  return tex(c, { repeat: false });
}

/* ---------- Сцена ---------- */
function buildScene() {
  const renderer = new THREE.WebGLRenderer({ antialias: !LITE || devicePixelRatio < 2, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, LITE ? 1.6 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const aniso = Math.min(LITE ? 4 : 8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  const HAZE = new THREE.Color('#E8D9C3');
  scene.fog = new THREE.Fog(HAZE, 1500, 4600);
  const cam = new THREE.PerspectiveCamera(30, 1, 4, 9000);

  // Небо: градиент с тёплым свечением солнца
  const sunDir = new V3(0.42, 0.36, -0.83).normalize();
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color('#8FB0CF') }, mid: { value: new THREE.Color('#E9DCC8') }, bot: { value: new THREE.Color('#DCD3C3') }, sun: { value: sunDir.clone() }, sunCol: { value: new THREE.Color('#FFE2B0') } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top, mid, bot, sun, sunCol; varying vec3 vD;
      void main(){ float h = vD.y; vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h*1.6,0.0,1.0), 0.7)) : mix(mid, bot, clamp(-h*4.0,0.0,1.0));
      float s = max(dot(normalize(vD), normalize(sun)), 0.0); c += sunCol * (pow(s, 280.0) * 1.6 + pow(s, 9.0) * 0.32);
      gl_FragColor = vec4(c, 1.0); }`
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(8000, 32, 16), skyMat);
  scene.add(sky);
  // Отражения в стёклах: окружение из того же неба
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
  const env = { tex: pm.fromScene(envScene, 0.02).texture };

  const hemi = new THREE.HemisphereLight('#FFF3E2', '#7A7C68', 0.8);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#FFDDB0', 3.1);
  sun.castShadow = true;
  const SM = LITE ? 2048 : 4096;
  sun.shadow.mapSize.set(SM, SM);
  sun.shadow.bias = -0.00025; sun.shadow.normalBias = 0.35;
  scene.add(sun, sun.target);

  const envMats = [];
  const M = o => { const m = new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.92, metalness: 0 }, o)); if (o.envMapIntensity) { m.envMap = env.tex; envMats.push(m); } return m; };
  const add = (geo, mat, cast = true, recv = true, parent = scene) => {
    const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = recv; parent.add(m); return m;
  };
  const pickables = [];

  /* Земля: светлая округа и зелёный квартал */
  const sandT = sandTexture(); sandT.repeat.set(1, 1); sandT.anisotropy = aniso;
  const outer = new THREE.PlaneGeometry(14000, 14000); outer.rotateX(-Math.PI / 2);
  { const uv = outer.attributes.uv, p = outer.attributes.position; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 260, p.getZ(i) / 260); }
  add(outer, M({ map: sandT }), false, true);
  const grassT = grassTexture(); grassT.anisotropy = aniso;
  add(flatPoly(DATA.ground, 0.12, 140), M({ map: grassT }), false, true);

  /* Дороги, тротуары, дорожки */
  const asphalt = asphaltTexture(); asphalt.anisotropy = aniso;
  const roadGeos = [], walkGeos = [], pathGeos = [];
  const roads = DATA.roads.map(r => ({ w: r.w, line: polyline(smooth(r.p, 4)) }));
  roads.forEach(r => {
    const g = ribbonGeo(r.line.pts, r.w, 0.45);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) / 10);
    roadGeos.push(g);
    walkGeos.push(ribbonGeo(r.line.pts, r.w + 6, 0.3));
  });
  add(mergeGeometries(walkGeos), M({ color: '#B9B5AC', roughness: 0.95 }), false, true);
  add(mergeGeometries(roadGeos), M({ map: asphalt, roughness: 0.9 }), false, true);
  const paths = [...DATA.paths, ...(DATA.walks || [])].map(p => ({ w: p.w, line: polyline(smooth(p.p, 2.5)) }));
  paths.forEach(p => pathGeos.push(ribbonGeo(p.line.pts, p.w, 0.5)));
  DATA.loops.forEach(l => {
    const r = Math.hypot(l.r[0] - l.c[0], l.r[1] - l.c[1]), pts = [];
    for (let i = 0; i <= 64; i++) pts.push([l.c[0] + Math.cos(i / 64 * Math.PI * 2) * r, l.c[1] + Math.sin(i / 64 * Math.PI * 2) * r]);
    pathGeos.push(ribbonGeo(pts, 3.5, 0.5));
    paths.push({ w: 3.5, line: polyline(pts) });
    const disc = new THREE.CircleGeometry(r * 0.45, 32); disc.rotateX(-Math.PI / 2); disc.translate(l.c[0], 0.55, l.c[1]);
    pathGeos.push(disc);
  });
  add(mergeGeometries(pathGeos.map(g => { g.deleteAttribute('uv'); return g; })), M({ color: '#DCCFB6', roughness: 1 }), false, true);

  /* Парковки и машины */
  const lotT = parkingTexture();
  const lotGeos = [], parked = [];
  DATA.lots.forEach(q => {
    // ось — длинная сторона четырёхугольника
    const e1 = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]), e2 = Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]);
    const o = q[0], A = e1 >= e2 ? q[1] : q[3], B = e1 >= e2 ? q[3] : q[1];
    const ax = [(A[0] - o[0]), (A[1] - o[1])], La = Math.hypot(...ax); ax[0] /= La; ax[1] /= La;
    const bx = [(B[0] - o[0]), (B[1] - o[1])], Lb = Math.hypot(...bx); bx[0] /= Lb; bx[1] /= Lb;
    const g = flatPoly(q, 0.55);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const dx = p.getX(i) - o[0], dz = p.getZ(i) - o[1];
      uv.setXY(i, (dx * ax[0] + dz * ax[1]) / 2.6, (dx * bx[0] + dz * bx[1]) / Math.max(10, Lb / 2));
    }
    lotGeos.push(g);
    const rows = Math.max(1, Math.floor(Lb / 15));
    for (let rr = 0; rr < rows * 2; rr++) {
      const v = (Math.floor(rr / 2) * 2 + (rr % 2 ? 1.5 : 0.5)) / (rows * 2) * Lb;
      for (let s = 2; s < La - 2; s += 2.6) {
        if (rnd() < 0.3) continue;
        parked.push({ x: o[0] + ax[0] * s + bx[0] * v, z: o[1] + ax[1] * s + bx[1] * v, ry: Math.atan2(-bx[1], bx[0]) + (rr % 2 ? Math.PI : 0) });
      }
    }
  });
  add(mergeGeometries(lotGeos), M({ map: lotT, roughness: 0.9 }), false, true);

  // Модель машины: кузов + салон (стекло) + колёса; цвет кузова — через instanceColor
  function carGeometry() {
    const parts = [];
    const paint = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(c, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
    const b = new THREE.BoxGeometry(4.4, 0.7, 1.8); b.translate(0, 0.62, 0); parts.push(paint(b, [1, 1, 1]));
    const c = new THREE.BoxGeometry(2.4, 0.62, 1.62); c.translate(-0.25, 1.28, 0); parts.push(paint(c, [0.12, 0.14, 0.17]));
    const r = new THREE.BoxGeometry(2.2, 0.06, 1.5); r.translate(-0.25, 1.61, 0); parts.push(paint(r, [1, 1, 1]));
    [[-1.35, 0.85], [1.35, 0.85], [-1.35, -0.85], [1.35, -0.85]].forEach(([x, z]) => {
      const w = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 10); w.rotateX(Math.PI / 2); w.translate(x, 0.34, z); parts.push(paint(w, [0.05, 0.05, 0.05]));
    });
    return mergeGeometries(parts.map(g => { g.deleteAttribute('uv'); return g; }));
  }
  const CAR_COLS = ['#F4F4F2', '#F4F4F2', '#1C1D20', '#1C1D20', '#9CA2A8', '#B9BDC1', '#4F5F78', '#7E2B26', '#2E4A3A', '#C8C0AE', '#2F3F5C'];
  const carMat = M({ vertexColors: true, roughness: 0.35, metalness: 0.4, envMapIntensity: 0.9 });
  const carGeo = carGeometry();
  const nMove = LITE ? 18 : 40;
  const cars = new THREE.InstancedMesh(carGeo, carMat, parked.length + nMove);
  const dummy = new THREE.Object3D(), col = new THREE.Color();
  parked.forEach((c, i) => {
    dummy.position.set(c.x, 0.55, c.z); dummy.rotation.set(0, c.ry, 0); dummy.scale.setScalar(1); dummy.updateMatrix();
    cars.setMatrixAt(i, dummy.matrix); cars.setColorAt(i, col.set(pick(CAR_COLS)));
  });
  const movers = [];
  const carRoads = roads;
  for (let i = 0; i < nMove; i++) {
    const r = carRoads[i % carRoads.length], dir = rnd() > 0.5 ? 1 : -1;
    movers.push({ i: parked.length + i, r, s: rnd() * r.line.total, v: (8 + rnd() * 6) * dir, lane: dir * r.w * 0.24 });
    cars.setColorAt(parked.length + i, col.set(pick(CAR_COLS)));
  }
  cars.castShadow = true; cars.receiveShadow = true; cars.frustumCulled = false; scene.add(cars);

  /* Спортивные объекты */
  // Главный стадион: поле 105×68 в начале координат, беговая дорожка 400 м
  const field = new THREE.PlaneGeometry(68, 105); field.rotateX(-Math.PI / 2); field.translate(0, 0.7, 0);
  add(field, M({ map: fieldTexture(), roughness: 1 }), false, true);
  function stadiumLine(cx, cz, ang, straight, radius) {
    const pts = [], ca = Math.cos(ang), sa = Math.sin(ang), P = (u, v) => [cx + u * ca - v * sa, cz + u * sa + v * ca];
    const n = 24;
    for (let i = 0; i <= n; i++) pts.push(P(-straight / 2 + straight * i / n, -radius));
    for (let i = 1; i <= n; i++) { const t = -Math.PI / 2 + Math.PI * i / n; pts.push(P(straight / 2 + Math.cos(t) * radius, Math.sin(t) * radius)); }
    for (let i = 1; i <= n; i++) pts.push(P(straight / 2 - straight * i / n, radius));
    for (let i = 1; i <= n; i++) { const t = Math.PI / 2 + Math.PI * i / n; pts.push(P(-straight / 2 + Math.cos(t) * radius, Math.sin(t) * radius)); }
    return pts;
  }
  {
    const tg = ribbonGeo(stadiumLine(0, 0, Math.PI / 2, 84.4, 41.5), 10, 0.62);
    const uv = tg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) / 8);
    add(tg, M({ map: trackTexture('#B9B7B2'), roughness: 0.95 }), false, true);
    const apron = flatPoly(stadiumLine(0, 0, Math.PI / 2, 84.4, 36.5), 0.6); add(apron, M({ color: '#5A8F44' }), false, true);
  }
  // Малый стадион с красной дорожкой
  {
    const [L, R, T, B] = DATA.stadium2;
    const cx = (L[0] + R[0] + T[0] + B[0]) / 4, cz = (L[1] + R[1] + T[1] + B[1]) / 4;
    const len = Math.hypot(R[0] - L[0], R[1] - L[1]), wid = Math.hypot(B[0] - T[0], B[1] - T[1]);
    const ang = Math.atan2(R[1] - L[1], R[0] - L[0]), rad = wid / 2 - 4;
    const tg = ribbonGeo(stadiumLine(cx, cz, ang, Math.max(10, len - wid), rad), 7, 0.62);
    const uv = tg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) / 8);
    add(tg, M({ map: trackTexture('#B5503B'), roughness: 0.95 }), false, true);
    add(flatPoly(stadiumLine(cx, cz, ang, Math.max(10, len - wid), rad - 3.5), 0.6), M({ color: '#2E8C78' }), false, true);
    const f = new THREE.PlaneGeometry(Math.max(20, len - wid) * 0.95, rad * 1.5); f.rotateX(-Math.PI / 2); f.rotateY(-ang); f.translate(cx, 0.68, cz);
    add(f, M({ map: fieldTexture(), roughness: 1 }), false, true);
  }
  // Корты во дворах
  const courtCols = ['#B5503B', '#3E7FA8', '#C4683F'];
  DATA.courts.forEach((q, i) => {
    const g = flatPoly(q, 0.6, 1); const p = g.attributes.position, uv = g.attributes.uv;
    const [x0, z0, x1, z1] = bbox(q); for (let k = 0; k < p.count; k++) uv.setXY(k, (p.getX(k) - x0) / (x1 - x0), (p.getZ(k) - z0) / (z1 - z0));
    add(g, M({ map: rubberTexture(courtCols[i % 3]) }), false, true);
  });
  // Площадь у школы: «гальки» — светлое мощение
  {
    const gs = DATA.pebbles.map(([x, z], i) => { const g = new THREE.CircleGeometry(4.5 + (i % 3) * 1.2, 24); g.rotateX(-Math.PI / 2); g.scale(1.35, 1, 1); g.rotateY(rnd() * 3); g.translate(x, 0.55, z); return g; });
    add(mergeGeometries(gs), M({ color: '#CFC6B5', roughness: 1 }), false, true);
  }

  /* Общественные здания */
  const roofMat = M({ map: solidTexture('#9C9A96', 256, 0.08, 6000), roughness: 0.95 });
  const schoolTex = stripTex('#E6E0D6', '#3A4652', 3.9);
  const schoolMat = M({ map: schoolTex.map, roughnessMap: schoolTex.rough, envMapIntensity: 0.8 });
  schoolTex.map.repeat.set(1 / 24, 1 / 24); schoolTex.rough.repeat.set(1 / 24, 1 / 24);
  const named = (mesh, info) => { mesh.userData.place = info; pickables.push(mesh); return mesh; };
  DATA.school.forEach((q, i) => {
    const h = i >= 4 ? (i === 6 ? 19 : 13) : 16;
    named(add(prismGeo(q, h), [roofMat, schoolMat]), { name: 'Школа на 2 500 мест', spot: 'school' });
  });
  const kinderTex = stripTex('#EFE6D3', '#3E4954', 3.6); kinderTex.map.repeat.set(1 / 24, 1 / 24); kinderTex.rough.repeat.set(1 / 24, 1 / 24);
  const kinderMat = M({ map: kinderTex.map, roughnessMap: kinderTex.rough });
  DATA.kinder.forEach(q => named(add(prismGeo(q, 11), [M({ color: '#B88A6A' }), kinderMat]), { name: 'Детский сад', spot: 'kindergarten' }));
  const boxTex = stripTex('#D8D6D0', '#4B5560', 4.6); boxTex.map.repeat.set(1 / 24, 1 / 24);
  const boxMat = M({ map: boxTex.map });
  DATA.boxes.forEach((b, i) => {
    const m = add(prismGeo(b.p, b.h), [roofMat, boxMat]);
    if (i === 0) named(m, { name: 'Спортивно-оздоровительный комплекс', spot: 'sport' });
    if (i === 3) named(m, { name: 'Паркинг', spot: 'parking' });
  });
  // Храм: кирпич, белые карнизы, золотые купола
  {
    const g = new THREE.Group(), [x, z] = DATA.church; g.position.set(x, 0, z);
    g.rotation.y = -DATA.houses.find(h => h.id === 'E2').a + Math.PI / 2;
    const brick = M({ color: '#B4573E', roughness: 0.9 }), white = M({ color: '#F2ECE3' });
    const gold = M({ color: '#E0B04E', metalness: 1, roughness: 0.25, envMapIntensity: 1.4 });
    const part = (geo, mat, px, py, pz) => { const m = add(geo, mat, true, true, g); m.position.set(px, py, pz); return m; };
    part(new THREE.BoxGeometry(36, 15, 20), brick, 0, 7.5, 0);
    part(new THREE.BoxGeometry(20, 15, 34), brick, 2, 7.5, 0);
    part(new THREE.BoxGeometry(37, 1.2, 21), white, 0, 15.3, 0);
    part(new THREE.BoxGeometry(21, 1.2, 35), white, 2, 15.3, 0);
    part(new THREE.CylinderGeometry(9, 9, 6, 32, 1, true, 0, Math.PI), brick, 18, 7.5, 0).rotation.y = Math.PI / 2;
    part(new THREE.CylinderGeometry(6.4, 6.4, 10, 24), white, 2, 21, 0);
    part(new THREE.SphereGeometry(7.2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), gold, 2, 26, 0);
    part(new THREE.CylinderGeometry(0.25, 0.25, 6, 6), gold, 2, 35, 0);
    part(new THREE.BoxGeometry(9, 30, 9), brick, -21, 15, 0);
    part(new THREE.BoxGeometry(9.6, 1, 9.6), white, -21, 30.5, 0);
    part(new THREE.SphereGeometry(4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), gold, -21, 31, 0);
    for (const [px, pz] of [[-6, 10.3], [6, 10.3], [-6, -10.3], [6, -10.3]]) part(new THREE.BoxGeometry(2.4, 4.5, 0.3), M({ color: '#2B3540' }), px, 8, pz);
    scene.add(g);
    g.traverse(o => { if (o.isMesh) { o.userData.place = { name: 'Храм', spot: 'church' }; pickables.push(o); } });
  }

  /* Жилые дома */
  const ppm = LITE ? 10 : 16;
  const fac = facadeTextures(ppm, BANDS, MOD, FLOORS, true);
  const endBands = [[2.6, 'W1'], [4.2, 'TL'], [3.9, 'WP'], [4.2, 'DL'], [2.6, 'W1']];
  const endFac = facadeTextures(ppm, endBands, 17.5, FLOORS, false);
  const plinth = plinthTexture(ppm);
  const facMat = M({ map: fac.map, roughnessMap: fac.rough, envMapIntensity: 1.0 });
  const endMat = M({ map: endFac.map, roughnessMap: endFac.rough, envMapIntensity: 1.0 });
  const plinthMat = M({ map: plinth.map, roughnessMap: plinth.rough, envMapIntensity: 1.0 });
  const plinthEnd = M({ color: '#4C3529' });
  const whiteMat = M({ color: '#EFECE6' });
  const techMat = M({ color: '#D9D5CE' });
  const ghostMat = new THREE.MeshStandardMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.24, roughness: 0.35, metalness: 0, depthWrite: false });
  const ghostLines = [];
  const houses = [], ghosts = [];
  const HB = 78; // высота сданных домов по фото
  DATA.houses.forEach(h => {
    const g = new THREE.Group(); g.position.set(h.x, 0, h.z); g.rotation.y = -h.a;
    const L = h.L, D = h.D;
    h.sections = Math.max(1, Math.round(L / MOD));
    if (h.built) {
      const bodyH = FLOORS * FH;
      const geo = new THREE.BoxGeometry(L, bodyH, D);
      const uv = geo.attributes.uv; // длинные фасады (±z): повтор секции по длине
      for (let k = 16; k < 24; k++) uv.setX(k, uv.getX(k) * h.sections);
      const body = add(geo, [endMat, endMat, roofMat, roofMat, facMat, facMat], true, true, g);
      body.position.y = PLINTH + bodyH / 2;
      const pgeo = new THREE.BoxGeometry(L + 0.3, PLINTH, D + 0.3), puv = pgeo.attributes.uv;
      for (let k = 16; k < 24; k++) puv.setX(k, puv.getX(k) * h.sections);
      const pl = add(pgeo, [plinthEnd, plinthEnd, roofMat, roofMat, plinthMat, plinthMat], true, true, g); pl.position.y = PLINTH / 2;
      const top = PLINTH + bodyH;
      // парапет, технические надстройки, козырьки входов
      const par = [];
      [[L + 0.6, D / 2], [L + 0.6, -D / 2]].forEach(([w, z]) => { const b = new THREE.BoxGeometry(w, 1.4, 0.5); b.translate(0, top + 0.7, z); par.push(b); });
      [[L / 2], [-L / 2]].forEach(([x]) => { const b = new THREE.BoxGeometry(0.5, 1.4, D + 0.6); b.translate(x, top + 0.7, 0); par.push(b); });
      add(mergeGeometries(par), whiteMat, true, true, g);
      const tech = [];
      for (let s = 0; s < h.sections; s++) {
        const cx = -L / 2 + (s + 0.5) * L / h.sections;
        const b = new THREE.BoxGeometry(8, 3.6, 7.5); b.translate(cx, top + 1.8, 0); tech.push(b);
        const b2 = new THREE.BoxGeometry(3, 2.2, 3); b2.translate(cx + 6, top + 1.1, 2); tech.push(b2);
        const c = new THREE.BoxGeometry(5, 0.3, 2.2); c.translate(cx, 3.6, -D / 2 - 1.1); tech.push(c);
      }
      add(mergeGeometries(tech), techMat, true, true, g);
      body.userData.house = h; pickables.push(body);
      h.mesh = body; h.top = top; houses.push(h);
    } else {
      const geo = new THREE.BoxGeometry(L, h.H, D);
      const body = add(geo, ghostMat, false, false, g); body.position.y = h.H / 2; body.renderOrder = 2;
      body.userData.house = h; pickables.push(body);
      // контур и линии этажей — «архитектурный макет»
      const e = new THREE.EdgesGeometry(geo); e.translate(0, h.H / 2, 0);
      e.applyMatrix4(new THREE.Matrix4().makeRotationY(-h.a)); e.translate(h.x, 0, h.z); ghostLines.push(e);
      const ring = [];
      for (let y = 3 * FH; y < h.H - 1; y += 3 * FH) {
        const c = [[-L / 2, -D / 2], [L / 2, -D / 2], [L / 2, D / 2], [-L / 2, D / 2]];
        for (let k = 0; k < 4; k++) ring.push(c[k][0], y, c[k][1], c[(k + 1) % 4][0], y, c[(k + 1) % 4][1]);
      }
      const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(ring, 3));
      rg.applyMatrix4(new THREE.Matrix4().makeRotationY(-h.a)); rg.translate(h.x, 0, h.z); ghostLines.push(rg);
      h.mesh = body; h.top = h.H; ghosts.push(g);
    }
    scene.add(g);
  });
  const lines = new THREE.LineSegments(mergeGeometries(ghostLines), new THREE.LineBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.45, depthWrite: false }));
  lines.renderOrder = 3; scene.add(lines);
  ghosts.push(lines);

  /* Деревья */
  const blockers = [];
  DATA.houses.forEach(h => { const c = Math.cos(-h.a), s = Math.sin(-h.a); blockers.push({ kind: 'rect', x: h.x, z: h.z, c, s, hl: h.L / 2 + 7, hd: h.D / 2 + 9 }); });
  [...DATA.school, ...DATA.kinder, ...DATA.boxes.map(b => b.p), ...DATA.lots, ...DATA.courts].forEach(q => blockers.push({ kind: 'poly', q, bb: bbox(q, 4) }));
  blockers.push({ kind: 'circle', x: 0, z: 0, r: 82 });
  { const [L, R] = DATA.stadium2; blockers.push({ kind: 'circle', x: (L[0] + R[0]) / 2, z: (L[1] + R[1]) / 2, r: 60 }); }
  blockers.push({ kind: 'circle', x: DATA.church[0], z: DATA.church[1], r: 32 });
  DATA.pebbles.forEach(([x, z]) => blockers.push({ kind: 'circle', x, z, r: 10 }));
  const lines2 = [...roads.map(r => ({ pts: r.line.pts, r: r.w / 2 + 4.5 })), ...paths.map(p => ({ pts: p.line.pts, r: p.w / 2 + 1.5 }))]
    .map(l => ({ ...l, bb: bbox(l.pts, l.r) }));
  function blocked(x, z) {
    for (const b of blockers) {
      if (b.kind === 'rect') { const dx = x - b.x, dz = z - b.z, u = dx * b.c + dz * b.s, v = -dx * b.s + dz * b.c; if (Math.abs(u) < b.hl && Math.abs(v) < b.hd) return true; }
      else if (b.kind === 'circle') { if (Math.hypot(x - b.x, z - b.z) < b.r) return true; }
      else if (x > b.bb[0] && x < b.bb[2] && z > b.bb[1] && z < b.bb[3] && pip(x, z, b.q)) return true;
    }
    for (const l of lines2) {
      if (x < l.bb[0] || x > l.bb[2] || z < l.bb[1] || z > l.bb[3]) continue;
      for (let i = 0; i < l.pts.length - 1; i += 1) if (segDist(x, z, l.pts[i], l.pts[i + 1]) < l.r) return true;
    }
    return false;
  }
  const noise = (x, z) => {
    const s = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, u = fx * fx * (3 - 2 * fx), w = fz * fz * (3 - 2 * fz);
    return lerp(lerp(s(ix, iz), s(ix + 1, iz), u), lerp(s(ix, iz + 1), s(ix + 1, iz + 1), u), w);
  };
  const fbm = (x, z) => noise(x / 90, z / 90) * 0.6 + noise(x / 32, z / 32) * 0.3 + noise(x / 12, z / 12) * 0.1;
  const trees = [];
  const density = LITE ? 0.55 : 1;
  DATA.forests.forEach(fz => {
    const [x0, z0, x1, z1] = bbox(fz.p), step = 6.6 / Math.sqrt(fz.d * density);
    for (let x = x0; x < x1; x += step) for (let z = z0; z < z1; z += step) {
      const px = x + (rnd() - 0.5) * step, pz = z + (rnd() - 0.5) * step;
      if (!pip(px, pz, fz.p)) continue;
      if (fz.d < 0.3 && fbm(px, pz) < 0.5) continue;
      if (fz.d >= 0.3 && fz.d < 0.9 && fbm(px, pz) < 0.38) continue;
      if (fz.d >= 0.9 && fbm(px, pz) < 0.2) continue;
      if (blocked(px, pz)) continue;
      trees.push({ x: px, z: pz, s: 0.75 + rnd() * 0.6, k: rnd() < 0.15 ? 1 : 0, pale: false });
    }
  });
  // Леса за пределами квартала (светлая земля с серо-зелёными рощами, как на рендере)
  {
    const step = (LITE ? 17 : 12.5);
    for (let x = -1500; x < 1700; x += step) for (let z = -1300; z < 1200; z += step) {
      const px = x + (rnd() - 0.5) * step, pz = z + (rnd() - 0.5) * step;
      if (pip(px, pz, DATA.ground)) continue;
      const n = fbm(px + 900, pz - 400);
      if (n < 0.52) continue;
      trees.push({ x: px, z: pz, s: 0.8 + rnd() * 0.6, k: rnd() < 0.3 ? 1 : 0, pale: true });
    }
  }
  function treeGeos() {
    // Крона: сглаженная «облачная» сфера с неровностями и затенением снизу
    const blob = (r, det, x, y, z, sq = 0.9) => {
      let g = new THREE.IcosahedronGeometry(r, det); g.deleteAttribute('uv'); g.deleteAttribute('normal');
      g = mergeVertices(g);
      const p = g.attributes.position, c = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i), k = 0.86 + rnd() * 0.28;
        p.setXYZ(i, vx * k + x, vy * k * sq + y, vz * k + z);
        const sh = 0.62 + 0.5 * (vy / r + 1) / 2 + (rnd() - 0.5) * 0.12;
        c.set([sh, sh * (1 + (rnd() - 0.5) * 0.08), sh], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.computeVertexNormals();
      return g;
    };
    const paint = (g, col) => { g.deleteAttribute('uv'); const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(col, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
    const trunk = () => { const t = new THREE.CylinderGeometry(0.28, 0.42, 4.2, 6, 1, true); t.translate(0, 2.1, 0); return paint(t, [0.3, 0.23, 0.17]); };
    const decid = mergeGeometries([trunk(), blob(4.2, 1, 0, 7.6, 0), blob(3.1, 0, 2.1, 8.8, 0.9), blob(2.9, 0, -1.7, 9.3, -1.2)]);
    const cone = (r, h, y) => { const g = new THREE.ConeGeometry(r, h, 9, 2, true); g.translate(0, y, 0);
      const p = g.attributes.position, c = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) { const sh = 0.6 + 0.45 * ((p.getY(i) - y) / h + 0.5); c.set([sh, sh, sh], i * 3); }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.deleteAttribute('uv'); return g; };
    const conif = mergeGeometries([trunk(), cone(3.6, 6.5, 6.2), cone(2.7, 6, 9.6)]);
    const far = mergeGeometries([trunk(), blob(4.6, 0, 0, 7.2, 0, 0.95), blob(3.2, 0, 1.2, 9, 0.6)]);
    return [decid, conif, far];
  }
  const [decidG, conifG, farG] = treeGeos();
  const treeMat = M({ vertexColors: true, roughness: 1 });
  const GREENS = ['#5A8642', '#6A9449', '#4E7A3C', '#78A052', '#62904A', '#86A85A'];
  const PALES = ['#7C8A77', '#8B977F', '#6F7E6C', '#9AA38E', '#A6AC9C'];
  const CONIF = ['#3E6A40', '#4A7448', '#426B44'];
  trees.forEach(t => { if (t.pale) t.k = t.k ? 1 : 2; });
  [0, 1, 2].forEach(kind => {
    const list = trees.filter(t => t.k === kind); if (!list.length) return;
    const im = new THREE.InstancedMesh([decidG, conifG, farG][kind], treeMat, list.length);
    list.forEach((t, i) => {
      dummy.position.set(t.x, 0.1, t.z); dummy.rotation.set(0, rnd() * 6.28, 0);
      const sy = t.s * (0.9 + rnd() * 0.35); dummy.scale.set(t.s, sy, t.s); dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
      im.setColorAt(i, col.set(t.pale ? (kind === 1 ? pick(['#5F6E5E', '#6B7868']) : pick(PALES)) : kind ? pick(CONIF) : pick(GREENS)));
    });
    im.castShadow = !(LITE && kind === 2); im.receiveShadow = true; scene.add(im);
  });
  scene.userData.trees = trees.length;

  /* Фонари вдоль дорожек */
  {
    const lamp = mergeGeometries([
      (() => { const g = new THREE.CylinderGeometry(0.09, 0.12, 4.5, 6); g.translate(0, 2.25, 0); g.deleteAttribute('uv'); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.9, 0.18, 0.35); g.translate(0.3, 4.5, 0); g.deleteAttribute('uv'); return g; })()
    ]);
    const spots = [];
    paths.forEach(p => { for (let s = 6; s < p.line.total; s += 28) { const a = p.line.at(s); spots.push([a.x - a.dz * (p.w / 2 + 0.8), a.z + a.dx * (p.w / 2 + 0.8), Math.atan2(-a.dz, a.dx)]); } });
    const im = new THREE.InstancedMesh(lamp, M({ color: '#3A3B3D', roughness: 0.6, metalness: 0.4 }), spots.length);
    spots.forEach(([x, z, r], i) => { dummy.position.set(x, 0, z); dummy.rotation.set(0, r, 0); dummy.scale.setScalar(1); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
    im.castShadow = true; scene.add(im);
  }

  /* Люди на дорожках и тротуарах */
  const walkLines = [...paths.map(p => ({ line: p.line, off: 0, w: p.w * 0.6 })),
    ...roads.flatMap(r => [{ line: r.line, off: r.w / 2 + 2.4, w: 1.6 }, { line: r.line, off: -(r.w / 2 + 2.4), w: 1.6 }])];
  const weights = walkLines.map(l => l.line.total * (l.off ? 0.5 : 3)), wsum = weights.reduce((a, b) => a + b, 0);
  const pickLine = () => { let r = rnd() * wsum; for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return walkLines[i]; } return walkLines[0]; };
  const nPeople = LITE ? 110 : 280;
  const bodyG = (() => { // человек ~1.75 м: ноги, туловище, руки
    const paint = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(c, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv'); return g; };
    const legs = new THREE.BoxGeometry(0.34, 0.85, 0.22); legs.translate(0, 0.43, 0);
    const torso = new THREE.CylinderGeometry(0.21, 0.19, 0.68, 8); torso.translate(0, 1.2, 0);
    const arms = new THREE.BoxGeometry(0.62, 0.55, 0.14); arms.translate(0, 1.18, 0);
    return mergeGeometries([paint(legs, [0.22, 0.24, 0.3]), paint(torso, [1, 1, 1]), paint(arms, [0.95, 0.95, 0.95])]);
  })();
  const headG = (() => { const g = new THREE.SphereGeometry(0.13, 8, 6); g.translate(0, 1.67, 0); return g; })();
  const people = new THREE.InstancedMesh(bodyG, M({ vertexColors: true, roughness: 0.8 }), nPeople);
  const heads = new THREE.InstancedMesh(headG, M({ roughness: 0.7 }), nPeople);
  const CLOTH = ['#E9E4DA', '#2A2F3A', '#B5473A', '#3E6E9C', '#D9A441', '#6B8E5A', '#8A5A8C', '#F2F2F0', '#5C4A3F', '#C9C2B3'];
  const SKIN = ['#E8C4A0', '#D9AE88', '#C89A74', '#F0D2B4'];
  const walkers = [];
  for (let i = 0; i < nPeople; i++) {
    const l = pickLine();
    walkers.push({ l, s: rnd() * l.line.total, v: (1.0 + rnd() * 0.6) * (rnd() > 0.5 ? 1 : -1), side: (rnd() - 0.5) * l.w, ph: rnd() * 6, sc: 0.92 + rnd() * 0.16 });
    people.setColorAt(i, col.set(pick(CLOTH))); heads.setColorAt(i, col.set(pick(SKIN)));
  }
  people.castShadow = true; people.frustumCulled = heads.frustumCulled = false; scene.add(people, heads);

  function animate(dt, t) {
    for (const m of movers) {
      m.s += m.v * dt;
      if (m.s > m.r.line.total) m.s -= m.r.line.total; if (m.s < 0) m.s += m.r.line.total;
      const a = m.r.line.at(m.s), nx = -a.dz, nz = a.dx;
      dummy.position.set(a.x + nx * m.lane, 0.55, a.z + nz * m.lane);
      dummy.rotation.set(0, Math.atan2(-a.dz, a.dx) + (m.v < 0 ? Math.PI : 0), 0); dummy.scale.setScalar(1); dummy.updateMatrix();
      cars.setMatrixAt(m.i, dummy.matrix);
    }
    cars.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < walkers.length; i++) {
      const w = walkers[i];
      w.s += w.v * dt;
      if (w.s > w.l.line.total || w.s < 0) { w.v = -w.v; w.s = clamp(w.s, 0, w.l.line.total); }
      const a = w.l.line.at(w.s), nx = -a.dz, nz = a.dx, off = w.l.off + w.side;
      const bob = Math.abs(Math.sin(t * 5.2 * Math.abs(w.v) + w.ph)) * 0.06;
      dummy.position.set(a.x + nx * off, 0.55 + bob, a.z + nz * off);
      dummy.rotation.set(0, Math.atan2(-a.dz, a.dx) + (w.v < 0 ? Math.PI : 0) + Math.PI / 2, Math.sin(t * 5.2 + w.ph) * 0.04);
      dummy.scale.setScalar(w.sc); dummy.updateMatrix();
      people.setMatrixAt(i, dummy.matrix); heads.setMatrixAt(i, dummy.matrix);
    }
    people.instanceMatrix.needsUpdate = true; heads.instanceMatrix.needsUpdate = true;
  }

  /* Подсветка этажа и места на карте */
  const floorHL = new THREE.Mesh(new THREE.BoxGeometry(1, FH * 0.92, 1), new THREE.MeshBasicMaterial({ color: '#FFC27A', transparent: true, opacity: 0.55, depthWrite: false }));
  floorHL.visible = false; floorHL.renderOrder = 5; scene.add(floorHL);
  const ringHL = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 64), new THREE.MeshBasicMaterial({ color: '#8FA68E', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
  ringHL.rotation.x = -Math.PI / 2; ringHL.visible = false; ringHL.renderOrder = 4; scene.add(ringHL);

  function setTime(mode) {
    const day = mode === 'day';
    sunDir.set(day ? 0.35 : 0.42, day ? 0.78 : 0.36, day ? -0.52 : -0.83).normalize();
    skyMat.uniforms.sun.value.copy(sunDir);
    skyMat.uniforms.top.value.set(day ? '#6E9BD0' : '#8FB0CF');
    skyMat.uniforms.mid.value.set(day ? '#DCE6EE' : '#E9DCC8');
    skyMat.uniforms.sunCol.value.set(day ? '#FFF6E6' : '#FFE2B0');
    sun.color.set(day ? '#FFF8EE' : '#FFDDB0'); sun.intensity = day ? 3.3 : 3.1;
    hemi.color.set(day ? '#F4F8FF' : '#FFF3E2'); hemi.intensity = day ? 0.9 : 0.75;
    scene.fog.color.set(day ? '#DCE3E8' : '#E8D9C3');
    const t = pm.fromScene(envScene, 0.02).texture; envMats.forEach(m => { m.envMap = t; m.needsUpdate = true; });
  }

  return { renderer, scene, cam, sun, sunDir, pickables, houses, ghosts, animate, floorHL, ringHL, setTime };
}

/* ---------- Камера, шторка, управление ---------- */
function start() {
  if (!section || !media || !plate) return;
  const ui = {};
  let S = null;
  try { S = buildScene(); } catch (e) { console.warn('3D-генплан не запустился', e); return; }
  const { renderer, scene, cam, sun, sunDir, pickables, animate, floorHL, ringHL } = S;
  const aptOv = document.createElement('div'); aptOv.className = 'apt-ov';
  const apt = createApartment(renderer, { lite: LITE, viewImage: 'assets/img/kvartal.webp', overlay: aptOv, onStage: () => aptUI() });

  // Слой 3D поверх фото: canvas + край «шторки» + интерфейс
  const wrap = document.createElement('div'); wrap.className = 'k3d'; wrap.hidden = true;
  const canvas = renderer.domElement; canvas.className = 'k3d-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '3D-генплан ЖК «Октябрь Парк»: 5 сданных домов и 17 домов в проекте, школа, детские сады, стадион, храм и парк');
  const edge = document.createElement('div'); edge.className = 'k3d-edge';
  wrap.append(canvas, edge);
  media.appendChild(wrap);
  apt.bind(canvas);

  const bar = document.createElement('div'); bar.className = 'k3d-bar';
  bar.innerHTML = `
    <button type="button" data-k="photo" class="k3d-btn k3d-photo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg><span>Фото-план</span></button>
    <span class="k3d-sep"></span>
    <button type="button" data-k="out" class="k3d-btn k3d-ico" aria-label="Отдалить"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg></button>
    <button type="button" data-k="in" class="k3d-btn k3d-ico" aria-label="Приблизить"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12M12 6v12"/></svg></button>
    <button type="button" data-k="home" class="k3d-btn k3d-ico" aria-label="Исходный вид"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/></svg></button>
    <span class="k3d-sep"></span>
    <button type="button" data-k="future" class="k3d-btn k3d-tog is-on" aria-pressed="true"><i></i><span>Дома в проекте</span></button>
    <button type="button" data-k="time" class="k3d-btn k3d-tog" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><span>День</span></button>`;
  const legend = document.createElement('div'); legend.className = 'k3d-legend';
  legend.innerHTML = '<span><i class="lg-built"></i>Сданы — 5 домов</span><span><i class="lg-plan"></i>В проекте — 17 домов</span>';
  const hint = document.createElement('div'); hint.className = 'k3d-hint';
  hint.textContent = phoneMQ.matches ? 'Пальцем — повернуть, двумя — приблизить и сдвинуть' : 'Колесо — приблизить · тяните — повернуть · правая кнопка — сдвинуть';
  const open3d = document.createElement('button'); open3d.type = 'button'; open3d.className = 'k3d-open'; open3d.hidden = true;
  open3d.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z M12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg><span>3D-генплан</span>';
  const tip = document.createElement('div'); tip.className = 'k3d-tip'; tip.hidden = true;
  const card = document.createElement('div'); card.className = 'k3d-card'; card.hidden = true;
  const pins = document.createElement('div'); pins.className = 'k3d-pins';
  wrap.append(pins, bar, legend, hint, tip, card);
  section.appendChild(open3d);
  S.houses.forEach(h => {
    const p = document.createElement('button'); p.type = 'button'; p.className = 'k3d-pin';
    p.innerHTML = `<b>${h.no}</b><span>Сдан</span>`; p.setAttribute('aria-label', `Дом ${h.no}, сдан`);
    p.addEventListener('click', () => selectHouse(h)); pins.appendChild(p); h.pin = p;
  });

  /* Камера: исходный ракурс совпадает с фото */
  const C0 = new V3(...DATA.cam.pos), T0 = new V3(...DATA.cam.target);
  const home = {
    tx: T0.x, tz: T0.z, dist: C0.distanceTo(T0),
    yaw: Math.atan2(C0.x - T0.x, C0.z - T0.z), pitch: Math.asin((C0.y - T0.y) / C0.distanceTo(T0)), roll: DATA.cam.roll
  };
  const st = { ...home, sx: 0, sy: 0, fs: 1 }, goal = { ...st };
  let W = 1, H = 1, crop = { s: 1, px: 0, py: 0, fov: 30 };

  function measureCrop() {
    const pr = plate.getBoundingClientRect(), mr = media.getBoundingClientRect();
    const s = pr.width / DATA.cam.w || 1;
    const x0 = (mr.left - pr.left) / s, y0 = (mr.top - pr.top) / s;
    const fov = 2 * Math.atan((mr.height / s) / 2 / DATA.cam.f) * 180 / Math.PI;
    crop = { s, fov, px: (DATA.cam.w / 2 - x0) * s - mr.width / 2, py: (DATA.cam.h / 2 - y0) * s - mr.height / 2 };
  }
  function resize() {
    W = media.clientWidth; H = media.clientHeight; if (!W || !H) return;
    renderer.setSize(W, H, false); canvas.style.width = W + 'px'; canvas.style.height = H + 'px'; apt.resize(W, H);
    if (mode !== '3d') { measureCrop(); Object.assign(st, { sx: crop.px, sy: crop.py }); Object.assign(goal, { sx: crop.px, sy: crop.py }); }
    need = true;
  }
  function applyCam() {
    const cp = Math.cos(st.pitch);
    cam.position.set(st.tx + Math.sin(st.yaw) * cp * st.dist, Math.sin(st.pitch) * st.dist, st.tz + Math.cos(st.yaw) * cp * st.dist);
    cam.up.set(0, 1, 0); cam.lookAt(st.tx, 0, st.tz); cam.rotateZ(st.roll);
    cam.fov = crop.fov * st.fs; cam.aspect = W / H; cam.near = Math.max(2, st.dist * 0.01); cam.far = 9000;
    if (Math.abs(st.sx) > 0.5 || Math.abs(st.sy) > 0.5) cam.setViewOffset(W, H, -st.sx, -st.sy, W, H); else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    // тени следуют за взглядом: чем ближе камера, тем чётче
    const half = clamp(st.dist * 0.75, 140, 1100);
    sun.position.set(st.tx + sunDir.x * 1600, sunDir.y * 1600, st.tz + sunDir.z * 1600);
    sun.target.position.set(st.tx, 0, st.tz); sun.target.updateMatrixWorld();
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 200, far: 3600 });
    sun.shadow.camera.updateProjectionMatrix();
  }

  // На телефоне фото листается вбок: слой 3D ставим ровно в видимую часть
  function placeWrap() {
    if (phoneMQ.matches) { wrap.style.left = media.scrollLeft + 'px'; wrap.style.width = media.clientWidth + 'px'; wrap.style.right = 'auto'; }
    else { wrap.style.left = wrap.style.width = wrap.style.right = ''; }
  }
  media.addEventListener('scroll', () => { if (!wrap.hidden) placeWrap(); }, { passive: true });
  /* Режимы: photo → opening → 3d → closing → photo */
  let mode = 'photo', need = true, raf = 0, last = 0, tAnim = 0, interacted = false, futureOn = true, day = false;
  const wipe = p => { // p: 1 — 3D скрыт за правым краем, 0 — открыт целиком
    canvas.style.clipPath = `inset(0 0 0 ${p * 100}%)`;
    edge.style.left = `${p * 100}%`; edge.style.opacity = p > 0.001 && p < 0.999 ? 1 : 0;
  };
  function animateTo(dur, fn) {
    return new Promise(res => {
      if (reduced.matches) { fn(1); res(); return; }
      const t0 = performance.now();
      const step = now => { const k = clamp((now - t0) / dur, 0, 1); fn(ease(k)); if (k < 1) requestAnimationFrame(step); else res(); };
      requestAnimationFrame(step);
    });
  }
  let openTimer = 0;
  async function open(delay = 450) {
    if (mode !== 'photo') return;
    clearTimeout(openTimer);
    await new Promise(r => { openTimer = setTimeout(r, reduced.matches ? 0 : delay); });
    if (mode !== 'photo' || !section.classList.contains('is-active') || document.body.classList.contains('is-moving')) return;
    mode = 'opening';
    placeWrap(); resize(); measureCrop();
    Object.assign(st, home, { sx: crop.px, sy: crop.py, fs: 1 }); Object.assign(goal, st);
    wrap.hidden = false; open3d.hidden = true; wipe(1);
    section.classList.add('k3d-active');
    applyCam(); renderer.render(scene, cam); loop();
    await animateTo(1600, k => wipe(1 - k));
    wipe(0);
    mode = '3d'; section.classList.add('is-3d');
    if (phoneMQ.matches) { goal.sx = 0; goal.sy = 0; }
  }
  async function close(fast) {
    clearTimeout(openTimer);
    if (mode === 'photo' || mode === 'closing') return;
    if (mode === 'opening') { await new Promise(r => setTimeout(r, 1700)); }
    if (mode === 'int' || mode === 'diving') { await leaveApartment(true); }
    mode = 'closing';
    deselect(); tip.hidden = true; section.classList.remove('is-3d');
    measureCrop();
    Object.assign(goal, home, { sx: crop.px, sy: crop.py, fs: 1 });
    const far = Math.abs(st.dist - home.dist) / home.dist + Math.abs(st.yaw - home.yaw) + Math.abs(st.pitch - home.pitch) + Math.hypot(st.tx - home.tx, st.tz - home.tz) / 300;
    if (far > 0.01) await flyWait(fast ? 900 : 1300);
    Object.assign(st, goal); need = true;
    await animateTo(fast ? 900 : 1300, k => wipe(k));
    wrap.hidden = true; section.classList.remove('k3d-active');
    mode = 'photo';
    if (section.classList.contains('is-active')) open3d.hidden = false;
  }
  // Плавный перелёт камеры (с ожиданием)
  let flight = null;
  function flyWait(dur) {
    return new Promise(res => {
      const from = { ...st }, to = { ...goal };
      // кратчайший поворот по азимуту
      let dy = to.yaw - from.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2; to.yaw = from.yaw + dy;
      flight = { from, to, t0: performance.now(), dur: reduced.matches ? 1 : dur, res };
      loop();
    });
  }
  function flyTo(o, dur = 1400) { Object.assign(goal, o); return flyWait(dur); }

  /* Цикл отрисовки */
  function loop() { if (!raf) raf = requestAnimationFrame(frame); }
  let lastFrame = 0;
  function frame(now) {
    raf = 0;
    if (wrap.hidden) return;
    const dt = Math.min(0.1, (now - (last || now)) / 1000); last = now;
    tAnim += dt;
    if (LITE && now - lastFrame < 30) { loop(); return; }
    lastFrame = now;
    if (mode === 'int') { apt.frame(dt); if (vis && !frozen) loop(); return; }
    if (dive) {
      const k = clamp((now - dive.t0) / dive.dur, 0, 1), e = ease(k), u = 1 - e;
      const p = dive.p0.clone().multiplyScalar(u * u).addScaledVector(dive.p1, 2 * u * e).addScaledVector(dive.p2, e * e);
      cam.position.copy(p); cam.quaternion.copy(dive.q0).slerp(dive.q2, ease(clamp(k * 1.25, 0, 1)));
      cam.fov = lerp(dive.fov0, 40, e); cam.clearViewOffset(); cam.near = 0.5; cam.updateProjectionMatrix();
      animate(dt, tAnim); renderer.render(scene, cam);
      if (k >= 1) { const r = dive.res; dive = null; r(); }
      if (vis && !frozen) loop(); return;
    }
    if (flight) {
      const k = clamp((now - flight.t0) / flight.dur, 0, 1), e = ease(k);
      for (const key of ['tx', 'tz', 'dist', 'yaw', 'pitch', 'roll', 'sx', 'sy', 'fs']) st[key] = lerp(flight.from[key], flight.to[key], e);
      if (k >= 1) { const r = flight.res; flight = null; Object.assign(goal, st); r(); }
    } else {
      const k = 1 - Math.exp(-dt * 9);
      for (const key of ['tx', 'tz', 'dist', 'yaw', 'pitch', 'roll', 'sx', 'sy', 'fs']) st[key] += (goal[key] - st[key]) * k;
    }
    animate(dt, tAnim);
    applyCam();
    updatePins();
    if (S.ringHL.visible) { const s = 1 + (tAnim * 0.8 % 1) * 0.25; ringHL.scale.setScalar(ringHL.userData.r * s); ringHL.material.opacity = 0.9 * (1 - (tAnim * 0.8 % 1)); }
    renderer.render(scene, cam);
    if (vis && !frozen) loop();
  }
  let vis = true, frozen = false;
  new IntersectionObserver(es => { vis = es[0].isIntersecting; if (vis) loop(); }).observe(media);
  new ResizeObserver(() => { resize(); applyCam(); if (!wrap.hidden) renderer.render(scene, cam); }).observe(media);

  /* Подписи сданных домов */
  const pv = new V3();
  function updatePins() {
    const r = media.getBoundingClientRect();
    S.houses.forEach(h => {
      pv.set(h.x, h.top + 10, h.z).project(cam);
      const on = pv.z < 1 && Math.abs(pv.x) < 1.05 && Math.abs(pv.y) < 1.05 && mode === '3d';
      h.pin.style.opacity = on ? 1 : 0; h.pin.style.pointerEvents = on ? 'auto' : 'none';
      h.pin.style.transform = `translate(${(pv.x + 1) / 2 * r.width}px, ${(1 - pv.y) / 2 * r.height}px) translate(-50%, -100%)`;
    });
  }

  /* Управление мышью и пальцами */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new V3(0, 1, 0), 0);
  function toNdc(x, y) { const r = canvas.getBoundingClientRect(); ndc.set((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1); return ndc; }
  function groundAt(x, y) { ray.setFromCamera(toNdc(x, y), cam); const p = new V3(); return ray.ray.intersectPlane(ground, p) ? p : null; }
  function hitAt(x, y) { ray.setFromCamera(toNdc(x, y), cam); const hits = ray.intersectObjects(pickables, false); return hits.find(h => h.object.visible) || null; }
  const BOUNDS = [-900, -700, 900, 800];
  function clampGoal() {
    goal.dist = clamp(goal.dist, 70, 2600); goal.pitch = clamp(goal.pitch, 0.12, 1.5);
    goal.tx = clamp(goal.tx, BOUNDS[0], BOUNDS[2]); goal.tz = clamp(goal.tz, BOUNDS[1], BOUNDS[3]);
  }
  function touchFirst() {
    if (interacted) return; interacted = true;
    hint.classList.add('is-gone'); goal.sx = 0; goal.sy = 0; goal.roll = 0;
  }
  function zoomAt(x, y, factor) {
    touchFirst(); flight = null;
    const p = x != null ? groundAt(x, y) : null;
    const nd = clamp(goal.dist * factor, 70, 2600), k = 1 - nd / goal.dist;
    if (p && factor < 1) { goal.tx += (p.x - goal.tx) * k; goal.tz += (p.z - goal.tz) * k; }
    goal.dist = nd; clampGoal(); loop();
  }
  function pan(dx, dy) {
    const s = goal.dist * Math.tan(cam.fov * Math.PI / 360) * 2 / H;
    const fx = -Math.sin(goal.yaw), fz = -Math.cos(goal.yaw), rx = Math.cos(goal.yaw), rz = -Math.sin(goal.yaw);
    const k = 1 / Math.max(0.35, Math.sin(goal.pitch));
    goal.tx -= (rx * dx - fx * dy * k) * s; goal.tz -= (rz * dx - fz * dy * k) * s; clampGoal();
  }
  let drag = null;
  const ptrs = new Map();
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    if (mode !== '3d') return;
    canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    flight = null;
    if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, btn: e.button, shift: e.shiftKey, moved: false, t: performance.now() };
    else { drag = null; const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, ang: Math.atan2(b.y - a.y, b.x - a.x) }; }
  });
  let pinch = null;
  canvas.addEventListener('pointermove', e => {
    if (mode !== '3d') return;
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, ang = Math.atan2(b.y - a.y, b.x - a.x);
      touchFirst();
      goal.dist = clamp(goal.dist * pinch.d / Math.max(1, d), 70, 2600);
      pan(cx - pinch.cx, cy - pinch.cy);
      goal.yaw -= (ang - pinch.ang);
      pinch = { d, cx, cy, ang }; clampGoal(); loop(); return;
    }
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) > 4) { drag.moved = true; touchFirst(); hideTip(); }
      if (drag.btn === 2 || drag.shift) pan(dx, dy);
      else { goal.yaw -= dx * 0.0052; goal.pitch = clamp(goal.pitch + dy * 0.0042, 0.12, 1.5); }
      drag.x = e.clientX; drag.y = e.clientY; clampGoal(); loop();
      canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.pointerType === 'mouse') hover(e);
  });
  const up = e => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (drag && !drag.moved && performance.now() - drag.t < 600 && drag.btn === 0) click(e);
    drag = null; canvas.style.cursor = '';
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); drag = null; pinch = null; });
  canvas.addEventListener('pointerleave', () => { if (!drag) hideTip(); });
  canvas.addEventListener('wheel', e => {
    if (mode !== '3d') return;
    e.preventDefault(); e.stopPropagation();
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(e.clientX, e.clientY, Math.exp(clamp(d, -120, 120) * 0.0022));
  }, { passive: false });
  canvas.addEventListener('dblclick', e => {
    if (mode !== '3d') return;
    const p = groundAt(e.clientX, e.clientY); if (!p) return;
    touchFirst(); flyTo({ tx: p.x, tz: p.z, dist: Math.max(160, goal.dist * 0.45) }, 1100);
  });

  /* Наведение и выбор */
  let hovered = null, selected = null, floorHover = 0;
  const hl = new Map();
  function highlight(mesh, on) {
    if (!mesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (on) {
      if (!hl.has(mesh)) hl.set(mesh, mesh.material);
      mesh.material = mats.map(m => { const c = m.clone(); if (c.emissive) { c.emissive.set('#FFB063'); c.emissiveIntensity = m.transparent ? 0.5 : 0.22; } if (m.transparent) c.opacity = 0.5; return c; });
      if (!Array.isArray(hl.get(mesh))) mesh.material = mesh.material[0];
    } else if (hl.has(mesh)) { mesh.material = hl.get(mesh); hl.delete(mesh); }
  }
  function showTip(e, html) {
    const r = media.getBoundingClientRect();
    tip.innerHTML = html; tip.hidden = false;
    const x = clamp(e.clientX - r.left + 16, 8, r.width - tip.offsetWidth - 8), y = clamp(e.clientY - r.top + 18, 8, r.height - tip.offsetHeight - 8);
    tip.style.transform = `translate(${x}px, ${y}px)`;
  }
  function hideTip() {
    tip.hidden = true; floorHL.visible = false; floorHover = 0;
    if (hovered && hovered !== selected?.mesh) highlight(hovered, false);
    hovered = null; canvas.style.cursor = '';
  }
  function hover(e) {
    const hit = hitAt(e.clientX, e.clientY), obj = hit && hit.object;
    if (obj !== hovered) {
      if (hovered && hovered !== selected?.mesh) highlight(hovered, false);
      hovered = obj;
      if (obj && obj !== selected?.mesh && (obj.userData.house)) highlight(obj, true);
    }
    floorHL.visible = false; floorHover = 0;
    if (!obj) { tip.hidden = true; canvas.style.cursor = ''; return; }
    canvas.style.cursor = 'pointer';
    const h = obj.userData.house, pl = obj.userData.place;
    if (h && h.built && selected === h) {
      const f = clamp(Math.floor((hit.point.y - PLINTH) / FH) + 1, 1, FLOORS);
      if (hit.point.y > PLINTH) {
        floorHover = f;
        floorHL.visible = true; floorHL.position.set(h.x, PLINTH + (f - 0.5) * FH, h.z); floorHL.rotation.y = -h.a; floorHL.scale.set(h.L + 0.8, 1, h.D + 0.8);
        showTip(e, `<b>${f} этаж</b><span>Нажмите — влетим в квартиру</span>`); need = true; return;
      }
    }
    if (h) showTip(e, h.built ? `<b>Дом ${h.no}</b><span>Сдан · ${FLOORS} этажей · нажмите, чтобы рассмотреть</span>` : `<b>Дом ${h.no}</b><span>В проекте · ${Math.round(h.H / 3.1)} этажей</span>`);
    else if (pl) showTip(e, `<b>${pl.name}</b><span>Нажмите, чтобы подлететь</span>`);
  }
  function click(e) {
    const hit = hitAt(e.clientX, e.clientY), obj = hit && hit.object;
    if (!obj) { if (selected) deselect(); return; }
    const h = obj.userData.house, pl = obj.userData.place;
    if (h && h.built && selected === h && hit.point.y > PLINTH) { enterApartment(h, clamp(Math.floor((hit.point.y - PLINTH) / FH) + 1, 1, FLOORS), hit.point); return; }
    if (h) selectHouse(h);
    else if (pl && pl.spot) focusPlace(pl.spot, true);
  }
  function viewOf(h, dist) {
    // смотрим на длинный фасад, со стороны текущей камеры
    const nx = Math.sin(h.a), nz = -Math.cos(h.a);
    const side = (cam.position.x - h.x) * nx + (cam.position.z - h.z) * nz > 0 ? 1 : -1;
    return { tx: h.x, tz: h.z, dist, yaw: Math.atan2(nx * side, nz * side) - 0.55, pitch: 0.38, roll: 0, sx: 0, sy: 0 };
  }
  function selectHouse(h) {
    touchFirst();
    if (selected && selected !== h) highlight(selected.mesh, false);
    selected = h; highlight(h.mesh, true);
    flyTo(viewOf(h, h.built ? 420 : 460), 1500);
    card.innerHTML = h.built
      ? `<button type="button" class="k3d-x" aria-label="Закрыть">×</button>
         <p class="k3d-kick"><i class="lg-built"></i>Дом сдан</p><h3>Дом ${h.no}</h3>
         <dl><div><dt>Этажей</dt><dd>${FLOORS}</dd></div><div><dt>Подъездов</dt><dd>${h.sections}</dd></div><div><dt>Длина</dt><dd>${Math.round(h.L)} м</dd></div></dl>
         <p>Наведите на фасад и нажмите на этаж — камера влетит в окно, и вы увидите, как в этой квартире встанет кухня ASD.</p>
         <button type="button" class="btn k3d-enter">Заглянуть в квартиру</button>`
      : `<button type="button" class="k3d-x" aria-label="Закрыть">×</button>
         <p class="k3d-kick"><i class="lg-plan"></i>В проекте</p><h3>Дом ${h.no}</h3>
         <dl><div><dt>Этажей</dt><dd>${Math.round(h.H / 3.1)}</dd></div><div><dt>Статус</dt><dd>Строится позже</dd></div></dl>
         <p>Дом ещё не построен. Узнайте о старте продаж в офисе продаж.</p>
         <a class="btn" href="tel:+78005550562">Позвонить в офис</a>`;
    card.hidden = false; section.classList.add('k3d-card-on');
    const en = card.querySelector('.k3d-enter'); if (en) en.addEventListener('click', () => enterApartment(h, 12));
    card.querySelector('.k3d-x').addEventListener('click', () => { deselect(); flyTo({ ...goal, dist: Math.max(goal.dist, 700), pitch: 0.62 }, 1200); });
  }
  function deselect() {
    if (selected) highlight(selected.mesh, false);
    selected = null; card.hidden = true; floorHL.visible = false; section.classList.remove('k3d-card-on');
  }
  function goApartments() {
    const a = document.querySelector('.view-kvartal [data-go="dom"]'); if (a) a.click();
  }
  // «Что внутри квартала»: подлёт к объекту + пульсирующее кольцо
  function focusPlace(id, fromScene) {
    const p = DATA.places[id]; if (!p || mode !== '3d') return;
    touchFirst(); deselect();
    const far = id === 'park' ? 520 : id === 'parking' || id === 'cafe' ? 360 : 300;
    flyTo({ tx: p[0], tz: p[1], dist: far, pitch: 0.62, roll: 0, sx: 0, sy: 0 }, 1400);
    ringHL.position.set(p[0], 1, p[1]); ringHL.userData.r = id === 'park' ? 90 : id === 'sport' ? 75 : 45; ringHL.visible = true;
    clearTimeout(ringHL.userData.t); ringHL.userData.t = setTimeout(() => { ringHL.visible = false; }, 6000);
    if (fromScene) { const b = document.querySelector(`.view-kvartal .places button[data-spot="${id}"]`); if (b) b.click(); }
  }
  document.querySelectorAll('.view-kvartal .places button[data-spot]').forEach(b => {
    b.addEventListener('click', () => { if (mode === '3d') focusPlace(b.dataset.spot, false); });
  });

  /* ---------- Полёт в окно и квартира ---------- */
  let dive = null, savedView = null, aptHouse = null, aptFloor = 1;
  const flash = document.createElement('div'); flash.className = 'k3d-flash'; wrap.appendChild(flash);
  const fade = (on, ms = 380) => new Promise(r => { flash.style.transitionDuration = ms + 'ms'; flash.classList.toggle('is-on', on); setTimeout(r, reduced.matches ? 0 : ms); });
  const aui = document.createElement('div'); aui.className = 'apt-ui'; wrap.append(aptOv, aui);
  const STEPS = [
    ['Замер и пожелания', 'Приезжаем к вам, внимательно выслушиваем пожелания и снимаем точные размеры — так проект сразу получается точным.'],
    ['Дизайн-проект', 'Готовим чертёж с размерами и подбираем материалы ещё до производства. Попробуйте сами: выберите фасады и столешницу.'],
    ['Производство', 'Изготавливаем мебель точно под ваши размеры по утверждённому проекту.'],
    ['Доставка, подъём и монтаж', 'Привозим, бережно поднимаем в квартиру, собираем и аккуратно устанавливаем.']
  ];
  function aptUI() {
    if (!aui) return;
    const F = apt.FACADES, s = apt.state, f = F.find(x => x.id === s.facade), st = apt.stage;
    const dots = `<ol class="apt-steps">${STEPS.map((x, i) => `<li class="${i + 1 < st || st === 5 ? 'is-done' : i + 1 === st ? 'is-on' : ''}"><i>${i + 1}</i><span>${x[0]}</span></li>`).join('')}</ol>`;
    let info;
    if (st === 0) info = `<p class="k3d-kick">Дом ${aptHouse ? aptHouse.no : ''} · ${aptFloor} этаж</p><h3>Квартира после сдачи дома</h3>
      <p>Голые стены и бетонный пол — так квартиру получает новосёл. Посмотрите, как ASD проходит путь от замера до готовой кухни.</p>
      <button type="button" class="btn apt-build">Собрать кухню</button>`;
    else if (st <= 4) info = `${dots}<p class="k3d-kick">Этап ${st} из 4</p><h3>${STEPS[st - 1][0]}</h3><p>${STEPS[st - 1][1]}</p>
      ${st < 4 ? `<button type="button" class="btn apt-next">${st === 3 ? 'Дальше: монтаж' : 'Дальше'} →</button>` : '<p class="apt-wait">Монтажники ASD устанавливают кухню…</p>'}`;
    else info = `${dots}<p class="k3d-kick">Готово</p><h3>Кухня ASD в этой квартире</h3>
      <p>Покрутите комнату и примерьте материалы — как в «Гиде по материалам» ASD.</p>
      <button type="button" class="k3d-btn apt-reset">Посмотреть все этапы ещё раз</button>`;
    const mats = st === 2 || st === 5;
    aui.innerHTML = `
      <div class="apt-top">
        <button type="button" class="k3d-btn apt-back"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg><span>В квартал</span></button>
        <a class="k3d-btn apt-cta" href="https://asd-mebel.ru/quiz.html" target="_blank" rel="noopener">Хочу такую кухню</a>
        <a class="k3d-btn apt-call" href="tel:+79185513330"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/></svg><span>Позвонить в ASD</span></a>
      </div>
      <div class="apt-info">${info}</div>
      <div class="apt-mat"${mats ? '' : ' hidden'}>
        <div class="apt-row"><span class="apt-lab">Фасады</span>${F.map(x => `<button type="button" class="apt-chip${x.id === s.facade ? ' is-on' : ''}" data-f="${x.id}">${x.name}<small>${x.price}</small></button>`).join('')}</div>
        <div class="apt-row"><span class="apt-lab">Цвет</span>${f.colors.map((c, i) => `<button type="button" class="apt-sw${i === s.color ? ' is-on' : ''}" data-c="${i}" style="--c:${c[2]}" title="${c[0]}" aria-label="${c[0]}"></button>`).join('')}<span class="apt-cname">${f.colors[s.color][0]}</span></div>
        <div class="apt-row"><span class="apt-lab">Столешница</span>${apt.TOPS.map(x => `<button type="button" class="apt-chip${x.id === s.top ? ' is-on' : ''}" data-t="${x.id}">${x.name}</button>`).join('')}</div>
        <p class="apt-note">${f.note}</p>
      </div>`;
  }
  aui.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.classList.contains('apt-back')) leaveApartment(false);
    else if (b.classList.contains('apt-build')) apt.build();
    else if (b.classList.contains('apt-next')) apt.next();
    else if (b.classList.contains('apt-reset')) { apt.reset(); apt.build(); }
    else if (b.dataset.f) { apt.setFacade(b.dataset.f, 0); aptUI(); }
    else if (b.dataset.c) { apt.setFacade(apt.state.facade, +b.dataset.c); aptUI(); }
    else if (b.dataset.t) { apt.setTop(b.dataset.t); aptUI(); }
  });
  async function enterApartment(h, floor, point) {
    if (mode !== '3d' || !h.built) return;
    mode = 'diving'; aptHouse = h; aptFloor = floor;
    hideTip(); card.hidden = true; section.classList.remove('k3d-card-on'); section.classList.add('is-diving');
    savedView = { ...st };
    // точка на фасаде, обращённом к камере
    const nx = Math.sin(h.a), nz = -Math.cos(h.a), side = (cam.position.x - h.x) * nx + (cam.position.z - h.z) * nz > 0 ? 1 : -1;
    const ax = Math.cos(-h.a), az = -Math.sin(-h.a);
    let along = 0; if (point) along = clamp((point.x - h.x) * ax + (point.z - h.z) * az, -h.L / 2 + 6, h.L / 2 - 6);
    along = Math.round(along / 3.8) * 3.8;
    const wy = PLINTH + (floor - 0.45) * FH;
    const W0 = new V3(h.x + nx * side * h.D / 2 + ax * along, wy, h.z + nz * side * h.D / 2 + az * along);
    const n = new V3(nx * side, 0, nz * side);
    const p2 = W0.clone().addScaledVector(n, 2.2);
    const p0 = cam.position.clone();
    const p1 = W0.clone().addScaledVector(n, 70).add(new V3(0, 25, 0)).lerp(p0, 0.35);
    const look = new THREE.Object3D(); look.position.copy(p2); look.lookAt(W0.clone().addScaledVector(n, -5)); 
    dive = { p0, p1, p2, q0: cam.quaternion.clone(), q2: look.quaternion.clone(), fov0: cam.fov, t0: performance.now(), dur: reduced.matches ? 1 : 2600, res: null };
    loop();
    await new Promise(r => { dive.res = r; setTimeout(() => fade(true, 420), reduced.matches ? 0 : 2200); });
    await fade(true, 60);
    apt.resize(W, H); apt.enter(); aptUI();
    mode = 'int'; section.classList.remove('is-diving'); section.classList.add('is-int');
    loop();
    await new Promise(r => setTimeout(r, 120));
    fade(false, 700);
  }
  async function leaveApartment(fast) {
    if (mode !== 'int' && mode !== 'diving') return;
    if (mode === 'diving') { await new Promise(r => { const w = () => (mode === 'int' ? r() : setTimeout(w, 50)); w(); }); }
    await fade(true, fast ? 150 : 380);
    apt.exit(); section.classList.remove('is-int');
    if (savedView) { Object.assign(st, savedView); Object.assign(goal, savedView); }
    mode = '3d'; if (aptHouse) selectHouse(aptHouse);
    applyCam(); renderer.render(scene, cam); loop();
    await fade(false, fast ? 150 : 600);
  }

  /* Кнопки панели */
  bar.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const k = b.dataset.k;
    if (k === 'photo') close(false);
    if (k === 'in') zoomAt(null, null, 0.7);
    if (k === 'out') zoomAt(null, null, 1.4);
    if (k === 'home') { deselect(); flyTo({ ...home, sx: 0, sy: 0, roll: 0 }, 1400); }
    if (k === 'future') { futureOn = !futureOn; S.ghosts.forEach(g => { g.visible = futureOn; }); b.classList.toggle('is-on', futureOn); b.setAttribute('aria-pressed', futureOn); need = true; }
    if (k === 'time') { day = !day; S.setTime(day ? 'day' : 'sunset'); b.classList.toggle('is-on', day); b.setAttribute('aria-pressed', day); }
  });
  open3d.addEventListener('click', () => open(0));

  // Видимость кнопки «3D-генплан» на фото
  const sync = () => {
    const active = section.classList.contains('is-active') && !document.body.classList.contains('is-moving');
    if (mode === 'photo') open3d.hidden = !active;
  };
  new MutationObserver(sync).observe(section, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  window.OP3D = {
    open, close, flyTo,
    isOpen: () => mode === '3d' || mode === 'opening' || mode === 'int' || mode === 'diving', apt,
    freeze(v) { frozen = v; if (!v) loop(); },
    shot() { applyCam(); updatePins(); renderer.render(scene, cam); return renderer.info.render; },
    get mode() { return mode; }, scene, cam, renderer, state: st, goal, data: DATA
  };
  resize(); applyCam();
  // Если страницу открыли сразу на «Квартале» — открываем 3D после короткой паузы
  if (section.classList.contains('is-active') && !document.body.classList.contains('is-moving')) open(900);
  sync();
}

if (section) {
  const go = () => { try { start(); } catch (e) { console.warn('3D-генплан не запустился', e); } };
  if (document.readyState === 'complete') setTimeout(go, 50); else addEventListener('load', () => setTimeout(go, 50));
}
