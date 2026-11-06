/* ЖК «Октябрь Парк» · 3D-модель квартала для сцены «Квартал».
   Своя WebGL-сцена на three.js: 22 корпуса, школа, сады, стадион, храм, парк.
   Если WebGL недоступен, остаётся фото генплана. */
import * as THREE from './vendor/three.module.min.js';

const section = document.getElementById('kvartal');
const media = section && section.querySelector('.media');
const phone = matchMedia('(max-width: 899px)');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

/* ---------- Генплан: координаты из фото 1920×1094 -> метры ---------- */
const P = (x, y) => [(x - 960) * 0.5, (y - 560) * 0.9];
const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

// Корпуса: центр на фото, угол длинной оси (рад, от оси X к Z), этажность
const HOUSES = [];
[[215, 210], [400, 120], [515, 150], [660, 165], [800, 180], [940, 205], [1040, 230], [1160, 255], [1265, 275], [1395, 300]]
  .forEach(p => HOUSES.push({ p, a: 1.71, f: 25 }));
[[150, 330], [300, 450], [380, 515], [470, 575], [540, 640], [640, 700], [770, 745]]
  .forEach(p => HOUSES.push({ p, a: -0.7, f: 25 }));
[[1190, 500], [1335, 570], [1495, 600], [1630, 665], [1810, 700]]
  .forEach(p => HOUSES.push({ p, a: 2.09, f: 20 }));
HOUSES.forEach((h, i) => { h.f = [25, 24, 25, 22, 25, 20][i % 6]; h.no = i + 1; h.pal = i % 3; });

const PLACES = {
  school: [655, 415], kindergarten: [875, 580], sport: [970, 420], park: [1215, 800],
  church: [1432, 458], playground: [650, 790], parking: [715, 715], cafe: [1190, 520]
};

/* ---------- Текстуры ---------- */
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function noise(g, w, h, n, a) {
  for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${rnd() > .5 ? '255,255,255' : '0,0,0'},${a * rnd()})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
}
const PALETTES = [
  { white: '#ECE8E1', brick: '#B9714A', dark: '#5A3B2C' },
  { white: '#EDE9E3', brick: '#C08257', dark: '#6B4532' },
  { white: '#E8E3DA', brick: '#A9663F', dark: '#4E342A' }
];
// Фасад: 24 м по ширине и 8 этажей по высоте, повторяется
function facadeTex(pal, aniso) {
  const S = 1024, m = S / 24, [c, g] = canvas(S, S);
  const bands = [[3.5, 'white'], [4, 'brick'], [2.5, 'white'], [2.5, 'dark'], [3.5, 'white'], [4, 'brick'], [2, 'white'], [2, 'brick']];
  let x = 0;
  bands.forEach(([w, k]) => {
    g.fillStyle = pal[k]; g.fillRect(x * m, 0, w * m, S);
    // окна: на каждом этаже
    for (let f = 0; f < 8; f++) {
      const y0 = S - (f + 1) * 3 * m;
      if (k === 'white') {
        const cx = x + w / 2;
        g.fillStyle = '#2B3540'; g.fillRect((cx - 0.65) * m, y0 + 0.85 * m, 1.3 * m, 1.55 * m);
        g.fillStyle = 'rgba(160,190,215,.35)'; g.fillRect((cx - 0.65) * m, y0 + 0.85 * m, 1.3 * m, 0.5 * m);
        g.fillStyle = '#F7F5F1'; g.fillRect((cx - 0.7) * m, y0 + 2.38 * m, 1.4 * m, 0.1 * m);
      } else {
        // остеклённые лоджии
        g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect((x + 0.3) * m, y0 + 0.2 * m, (w - 0.6) * m, 0.12 * m);
        g.fillStyle = '#34414C'; g.fillRect((x + 0.45) * m, y0 + 0.75 * m, (w - 0.9) * m, 1.75 * m);
        g.fillStyle = 'rgba(190,210,225,.28)'; g.fillRect((x + 0.45) * m, y0 + 0.75 * m, (w - 0.9) * m, 0.6 * m);
        g.fillStyle = 'rgba(255,255,255,.55)';
        for (let k2 = 1; k2 < 4; k2++) g.fillRect((x + 0.45 + (w - 0.9) * k2 / 4) * m - 1, y0 + 0.75 * m, 2, 1.75 * m);
        g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect((x + 0.45) * m, y0 + 2.5 * m, (w - 0.9) * m, 0.08 * m);
      }
    }
    x += w;
  });
  noise(g, S, S, 9000, 0.06);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  return t;
}
function plainTex(base, rows, win, aniso, floorH = 3.6) {
  const S = 512, m = S / 24, [c, g] = canvas(S, S);
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  for (let f = 0; f < rows; f++) {
    const y0 = S - (f + 1) * floorH * m;
    g.fillStyle = win; g.fillRect(0, y0 + 1 * m, S, 1.6 * m);
    g.fillStyle = base; for (let x = 0; x < 24; x += 2.4) g.fillRect(x * m, y0 + 1 * m, 0.35 * m, 1.6 * m);
  }
  noise(g, S, S, 3000, 0.05);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  return t;
}
function groundTex(aniso) {
  const S = 1024, [c, g] = canvas(S, S);
  g.fillStyle = '#6E8A4E'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const r = 6 + rnd() * 40; g.fillStyle = `rgba(${rnd() > .5 ? '120,150,80' : '80,105,55'},${0.08 + rnd() * 0.12})`;
    g.beginPath(); g.arc(rnd() * S, rnd() * S, r, 0, 7); g.fill();
  }
  noise(g, S, S, 20000, 0.08);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 10);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t;
}
function fieldTex() {
  const [c, g] = canvas(512, 768);
  for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? '#4F8A3A' : '#5A9642'; g.fillRect(0, i * 64, 512, 64); }
  g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 5;
  g.strokeRect(20, 20, 472, 728); g.beginPath(); g.moveTo(20, 384); g.lineTo(492, 384); g.stroke();
  g.beginPath(); g.arc(256, 384, 70, 0, 7); g.stroke();
  g.strokeRect(146, 20, 220, 110); g.strokeRect(146, 638, 220, 110);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function parkingTex() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#55575A'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(255,255,255,.75)'; for (let x = 0; x <= 256; x += 32) g.fillRect(x, 0, 3, 96), g.fillRect(x, 160, 3, 96);
  noise(g, 256, 256, 2000, 0.08);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* ---------- Геометрия ---------- */
// Коробка, у которой UV в метрах/период текстуры (фасады не растягиваются)
function boxM(w, h, d, period = 24) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  const sz = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k; uv.setXY(i, uv.getX(i) * sz[f][0] / period, uv.getY(i) * sz[f][1] / period);
  }
  return g;
}
function ribbon(points, width, y) {
  const pos = [], idx = [];
  points.forEach((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    let dx = b.x - a.x, dz = b.z - a.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    pos.push(p.x - dz * width / 2, y, p.z + dx * width / 2, p.x + dz * width / 2, y, p.z - dx * width / 2);
    if (i) { const o = (i - 1) * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/* ---------- Сцена ---------- */
function build() {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' }); }
  catch (e) { return null; }
  const lite = phone.matches || (navigator.hardwareConcurrency || 8) <= 4;
  renderer.setPixelRatio(Math.min(devicePixelRatio, lite ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  const SKY = new THREE.Color('#E9D9C2');
  scene.background = SKY; scene.fog = new THREE.Fog(SKY, 900, 2300);
  const cam = new THREE.PerspectiveCamera(32, 1, 5, 5000);

  scene.add(new THREE.HemisphereLight('#FFF1DC', '#5F6B4A', 1.15));
  const sun = new THREE.DirectionalLight('#FFD9A8', 2.6);
  sun.position.set(-520, 420, -260); sun.castShadow = true;
  const sm = lite ? 1024 : 2048; sun.shadow.mapSize.set(sm, sm);
  Object.assign(sun.shadow.camera, { left: -620, right: 620, top: 560, bottom: -560, near: 50, far: 1800 });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6;
  scene.add(sun);

  const mat = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.9, metalness: 0 }, o));
  const add = (geo, m, x, y, z, ry = 0, cast = true, recv = true) => {
    const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.y = ry; o.castShadow = cast; o.receiveShadow = recv; scene.add(o); return o;
  };

  // Земля: светлая округа и зелёный квартал
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), mat({ color: '#CFC6B4' }));
  outer.rotation.x = -Math.PI / 2; outer.receiveShadow = true; scene.add(outer);
  const shape = new THREE.Shape();
  [[40, 140], [300, 40], [900, 70], [1500, 210], [1900, 520], [1880, 830], [1700, 960], [1100, 1000], [520, 1000], [120, 700], [10, 420]]
    .map(q => P(q[0], q[1])).forEach(([x, z], i) => i ? shape.lineTo(x, -z) : shape.moveTo(x, -z));
  const grass = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat({ map: groundTex(aniso), color: '#ffffff' }));
  grass.geometry.attributes.uv.array.forEach((v, i, a) => { a[i] = v / 120; });
  grass.rotation.x = -Math.PI / 2; grass.position.y = 0.15; grass.receiveShadow = true; scene.add(grass);

  // Дороги: кольцо вокруг квартала и проезды
  const asphalt = mat({ color: '#54565A', roughness: 0.95, side: THREE.DoubleSide });
  const road = (pts, w) => {
    const c = new THREE.CatmullRomCurve3(pts.map(q => { const [x, z] = P(q[0], q[1]); return new THREE.Vector3(x, 0, z); }));
    const m = new THREE.Mesh(ribbon(c.getPoints(120), w, 0.4), asphalt); m.receiveShadow = true; scene.add(m);
  };
  road([[60, 150], [310, 55], [900, 85], [1500, 225], [1890, 525], [1870, 820]], 12);
  road([[30, 420], [130, 690], [520, 985], [1100, 990], [1690, 950]], 12);
  road([[230, 300], [560, 290], [1000, 300], [1450, 380]], 8);
  road([[260, 620], [600, 810], [900, 880]], 8);
  road([[1080, 360], [1160, 520], [1300, 650], [1560, 760], [1840, 790]], 8);
  road([[740, 300], [760, 560], [930, 700]], 7);

  // Парк: извилистые дорожки
  const pathM = mat({ color: '#E3D8C2', roughness: 1, side: THREE.DoubleSide });
  const path = (pts) => {
    const c = new THREE.CatmullRomCurve3(pts.map(q => { const [x, z] = P(q[0], q[1]); return new THREE.Vector3(x, 0, z); }));
    const m = new THREE.Mesh(ribbon(c.getPoints(160), 3.2, 0.5), pathM); m.receiveShadow = true; scene.add(m);
  };
  path([[960, 760], [1020, 640], [1100, 700], [1060, 760], [1150, 820], [1280, 760], [1360, 820], [1500, 850], [1660, 900]]);
  path([[1000, 880], [1130, 870], [1300, 900], [1450, 930], [1620, 940]]);
  path([[1060, 610], [1110, 700], [1150, 800], [1190, 900]]);
  path([[1300, 700], [1400, 790], [1500, 930]]);
  const ringC = new THREE.Mesh(new THREE.RingGeometry(9, 12, 48), pathM);
  ringC.rotation.x = -Math.PI / 2; { const [x, z] = P(1060, 760); ringC.position.set(x, 0.55, z); } scene.add(ringC);
  const ringC2 = ringC.clone(); { const [x, z] = P(1265, 760); ringC2.position.set(x, 0.55, z); } scene.add(ringC2);

  // Корпуса
  const roofM = mat({ color: '#A8A6A2' });
  const baseM = mat({ color: '#3F332C', roughness: 0.6 });
  const facM = PALETTES.map(p => mat({ map: facadeTex(p, aniso) }));
  const houses = [];
  HOUSES.forEach(h => {
    const L = 62, D = 17, H = h.f * 3 + 4, [x, z] = P(h.p[0], h.p[1]);
    const grp = new THREE.Group(); grp.position.set(x, 0, z); grp.rotation.y = -h.a;
    const body = new THREE.Mesh(boxM(L, H - 4.5, D), [facM[h.pal], facM[h.pal], roofM, roofM, facM[h.pal], facM[h.pal]]);
    body.position.y = 4.5 + (H - 4.5) / 2; body.castShadow = body.receiveShadow = true; grp.add(body);
    const base = new THREE.Mesh(new THREE.BoxGeometry(L + 0.6, 4.5, D + 0.6), baseM); base.position.y = 2.25; base.receiveShadow = true; grp.add(base);
    const top = new THREE.Mesh(new THREE.BoxGeometry(L + 0.4, 1.2, D + 0.4), mat({ color: '#EFECE6' })); top.position.y = H + 0.6; top.castShadow = true; grp.add(top);
    [-L / 4, L / 4].forEach(dx => { const t = new THREE.Mesh(new THREE.BoxGeometry(9, 4, 8), mat({ color: '#DEDAD2' })); t.position.set(dx, H + 2.5, 0); t.castShadow = true; grp.add(t); });
    grp.userData = h; body.userData = h; scene.add(grp); houses.push(body);
    h.top = new THREE.Vector3(x, H + 8, z);
  });

  // Школа: корпус «П» с внутренним двором
  {
    const [x, z] = P(655, 415), sch = mat({ map: plainTex('#E4DED3', 6, '#3A4652', aniso) });
    const grp = new THREE.Group(); grp.position.set(x, 0, z); grp.rotation.y = 0.55;
    [[0, -28, 100, 22], [-40, 6, 20, 70], [40, 6, 20, 70], [0, 34, 60, 16]].forEach(([bx, bz, w, d], i) => {
      const hh = i === 3 ? 10 : 15;
      const m = new THREE.Mesh(boxM(w, hh, d), [sch, sch, roofM, roofM, sch, sch]); m.position.set(bx, hh / 2, bz); m.castShadow = m.receiveShadow = true; grp.add(m);
    });
    scene.add(grp);
  }
  // Детские сады
  [[875, 580], [1265, 408], [505, 325]].forEach(([ix, iy], i) => {
    const [x, z] = P(ix, iy), w = mat({ map: plainTex('#EFE6D6', 3, '#3E4954', aniso) });
    const grp = new THREE.Group(); grp.position.set(x, 0, z); grp.rotation.y = [0.2, -0.3, 0.5][i];
    const m = new THREE.Mesh(boxM(48, 10, 22), [w, w, mat({ color: '#B97A55' }), roofM, w, w]); m.position.y = 5; m.castShadow = m.receiveShadow = true; grp.add(m);
    const m2 = new THREE.Mesh(boxM(18, 10, 30), [w, w, mat({ color: '#B97A55' }), roofM, w, w]); m2.position.set(-15, 5, 12); m2.castShadow = m2.receiveShadow = true; grp.add(m2);
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(40, 22), mat({ color: '#C9A26B' })); pl.rotation.x = -Math.PI / 2; pl.position.set(8, 0.5, 26); grp.add(pl);
    scene.add(grp);
  });
  // Стадион: беговая дорожка и поле
  const stadium = (ix, iy, sx, ry, run) => {
    const [x, z] = P(ix, iy), grp = new THREE.Group(); grp.position.set(x, 0, z); grp.rotation.y = ry;
    if (run) {
      const sh = new THREE.Shape(); sh.absellipse(0, 0, sx * 0.62, sx, 0, Math.PI * 2);
      const hole = new THREE.Path(); hole.absellipse(0, 0, sx * 0.62 - 9, sx - 9, 0, Math.PI * 2, true); sh.holes.push(hole);
      const tr = new THREE.Mesh(new THREE.ShapeGeometry(sh, 64), mat({ color: run === 'green' ? '#2F7F5A' : '#B4523C' }));
      tr.rotation.x = -Math.PI / 2; tr.position.y = 0.6; tr.receiveShadow = true; grp.add(tr);
      const inner = new THREE.Mesh(new THREE.CircleGeometry(1, 64), mat({ color: '#5E9446' }));
      inner.scale.set(sx * 0.62 - 9, sx - 9, 1); inner.rotation.x = -Math.PI / 2; inner.position.y = 0.55; grp.add(inner);
    }
    const f = new THREE.Mesh(new THREE.PlaneGeometry(sx * 0.62, sx * 1.15), mat({ map: fieldTex() }));
    f.rotation.x = -Math.PI / 2; f.position.y = 0.7; f.receiveShadow = true; grp.add(f);
    scene.add(grp);
  };
  stadium(965, 420, 62, 0.15, 'track');
  stadium(830, 338, 34, 1.35, 'green');
  { const [x, z] = P(915, 515); const s = mat({ map: plainTex('#D9D7D2', 2, '#4B5560', aniso, 6) });
    const m = new THREE.Mesh(boxM(70, 14, 40), [s, s, roofM, roofM, s, s]); m.position.set(x, 7, z); m.rotation.y = 0.15; m.castShadow = m.receiveShadow = true; scene.add(m); }

  // Храм
  {
    const [x, z] = P(1432, 458), grp = new THREE.Group(); grp.position.set(x, 0, z); grp.rotation.y = -0.4;
    const wall = mat({ color: '#C77C58' }), white = mat({ color: '#F1EBE2' }), gold = new THREE.MeshStandardMaterial({ color: '#D9A441', metalness: 0.85, roughness: 0.3 });
    const nave = new THREE.Mesh(new THREE.BoxGeometry(34, 14, 20), wall); nave.position.y = 7; grp.add(nave);
    const cross = new THREE.Mesh(new THREE.BoxGeometry(20, 14, 34), wall); cross.position.y = 7; grp.add(cross);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(35, 1, 21), white); roof.position.y = 14.5; grp.add(roof);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 9, 24), white); drum.position.y = 19; grp.add(drum);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(6.6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), gold); dome.position.y = 23.5; grp.add(dome);
    const bell = new THREE.Mesh(new THREE.BoxGeometry(8, 26, 8), wall); bell.position.set(-21, 13, 0); grp.add(bell);
    const bd = new THREE.Mesh(new THREE.SphereGeometry(3.6, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), gold); bd.position.set(-21, 26, 0); grp.add(bd);
    grp.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(grp);
  }

  // Парковки и машины
  const lots = [[715, 715, 0.6], [1380, 640, -0.5], [1560, 690, -0.5], [1720, 760, -0.5], [600, 250, 0.1], [1180, 300, 0.1], [330, 560, 0.6]];
  const pt = parkingTex();
  const carGeo = new THREE.BoxGeometry(4.4, 1.6, 1.9);
  const cars = new THREE.InstancedMesh(carGeo, mat({ roughness: 0.4, metalness: 0.3 }), lots.length * 40);
  let ci = 0; const dm = new THREE.Object3D(), col = new THREE.Color();
  const carCols = ['#F2F2F0', '#1E1F22', '#9DA3A8', '#5A6A80', '#8A2F2A', '#C9C4B8'];
  lots.forEach(([ix, iy, ry]) => {
    const [x, z] = P(ix, iy), lot = new THREE.Mesh(new THREE.PlaneGeometry(64, 26), mat({ map: pt.clone() }));
    lot.material.map.repeat.set(2, 1); lot.material.map.needsUpdate = true;
    lot.rotation.x = -Math.PI / 2; lot.rotation.z = ry; lot.position.set(x, 0.6, z); lot.receiveShadow = true; scene.add(lot);
    for (let r = 0; r < 2; r++) for (let k = 0; k < 16; k++) {
      if (rnd() < 0.3 || ci >= cars.count) continue;
      const lx = -30 + k * 4 + 2, lz = r ? 8 : -8, c = Math.cos(ry), s = Math.sin(ry);
      dm.position.set(x + lx * c + lz * s, 1.4, z - lx * s + lz * c); dm.rotation.set(0, ry + Math.PI / 2, 0); dm.updateMatrix();
      cars.setMatrixAt(ci, dm.matrix); cars.setColorAt(ci, col.set(carCols[Math.floor(rnd() * carCols.length)])); ci++;
    }
  });
  cars.count = ci; cars.castShadow = true; scene.add(cars);

  // Деревья
  const blocks = [];
  HOUSES.forEach(h => { const [x, z] = P(h.p[0], h.p[1]); blocks.push([x, z, 44]); });
  [[655, 415, 70], [965, 420, 70], [830, 338, 36], [915, 515, 45], [1432, 458, 30], [875, 580, 34], [1265, 408, 34], [505, 325, 34]]
    .forEach(([ix, iy, r]) => { const [x, z] = P(ix, iy); blocks.push([x, z, r]); });
  lots.forEach(([ix, iy]) => { const [x, z] = P(ix, iy); blocks.push([x, z, 36]); });
  const inside = (x, z) => {
    const pt2 = new THREE.Vector2(x, -z), pts = shape.getPoints(); let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > pt2.y) !== (b.y > pt2.y) && pt2.x < (b.x - a.x) * (pt2.y - a.y) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  };
  const free = (x, z) => blocks.every(([bx, bz, r]) => Math.hypot(x - bx, z - bz) > r);
  const NT = lite ? 1400 : 3000;
  const trees = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), mat({ roughness: 1, flatShading: true }), NT);
  let ti = 0;
  const parkPoly = PLACES.park;
  for (let tries = 0; ti < NT && tries < NT * 30; tries++) {
    const x = (rnd() - 0.5) * 1500, z = (rnd() - 0.5) * 1150;
    const inQ = inside(x, z);
    const [px, pz] = P(parkPoly[0], parkPoly[1]);
    const inPark = Math.hypot((x - px) / 1.6, z - pz) < 150;
    if (inQ && !inPark && rnd() > 0.55) continue;
    if (!free(x, z)) continue;
    const s = inQ ? 4 + rnd() * 3.5 : 5 + rnd() * 5;
    dm.position.set(x, s * 1.1, z); dm.scale.set(s, s * (1.1 + rnd() * 0.4), s); dm.rotation.set(0, rnd() * 6, 0); dm.updateMatrix();
    trees.setMatrixAt(ti, dm.matrix);
    trees.setColorAt(ti, col.set(inQ ? ['#3F6B34', '#4C7A3B', '#5D8A45', '#36602F'][Math.floor(rnd() * 4)] : ['#5E7058', '#6C7A63', '#7D876F', '#556650'][Math.floor(rnd() * 4)]));
    ti++;
  }
  trees.count = ti; trees.castShadow = true; trees.receiveShadow = true; scene.add(trees);

  return { renderer, scene, cam, houses, sun, lite };
}

/* ---------- Запуск, камера, управление ---------- */
function start() {
  if (!section || !media) return;
  const S = build(); if (!S) return;
  const { renderer, scene, cam, houses } = S;
  const cv = renderer.domElement; cv.className = 'k3d';
  cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', '3D-модель квартала «Октябрь Парк»: 22 дома, школа, детские сады, стадион, храм и парк');
  media.appendChild(cv);
  const tip = document.createElement('div'); tip.className = 'k3d-tip'; tip.hidden = true; media.appendChild(tip);
  const hint = document.createElement('div'); hint.className = 'k3d-hint';
  hint.textContent = phone.matches ? 'Ведите пальцем вбок, чтобы повернуть квартал' : 'Потяните, чтобы повернуть · нажмите на дом, чтобы выбрать квартиру';
  media.appendChild(hint);
  section.classList.add('has-3d');

  // Камера по сферическим координатам вокруг цели
  const base = { yaw: 0.05, pit: 0.62, dist: phone.matches ? 1350 : 1080, tx: 30, tz: 40 };
  const st = { ...base }, goal = { ...base };
  let idleAt = performance.now(), drag = null, need = true, visible = false, fly = null;

  function resize() {
    const w = media.clientWidth, h = media.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); cv.style.width = w + 'px'; cv.style.height = h + 'px';
    cam.aspect = w / h; cam.updateProjectionMatrix(); need = true;
  }
  new ResizeObserver(resize).observe(media); resize();

  function place() {
    const cp = Math.cos(st.pit);
    cam.position.set(st.tx + Math.sin(st.yaw) * cp * st.dist, Math.sin(st.pit) * st.dist, st.tz + Math.cos(st.yaw) * cp * st.dist);
    cam.lookAt(st.tx, 0, st.tz);
  }
  const ray = new THREE.Raycaster(), mv = new THREE.Vector2();
  function pick(ev) {
    const r = cv.getBoundingClientRect();
    mv.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mv, cam); const hit = ray.intersectObjects(houses, false)[0];
    return hit ? hit.object.userData : null;
  }
  let hover = null;
  const origMat = new Map(houses.map(m => [m, m.material]));
  const hlCache = new Map();
  const hl = m => {
    if (!hlCache.has(m)) { const c = m.clone(); c.emissive = new THREE.Color('#FFB46B'); c.emissiveIntensity = 0.3; hlCache.set(m, c); }
    return hlCache.get(m);
  };
  function setHover(h, ev) {
    if (h !== hover) {
      hover = h;
      houses.forEach(m => { const o = origMat.get(m); m.material = m.userData === h ? o.map((x, k) => [0, 1, 4, 5].includes(k) ? hl(x) : x) : o; });
      need = true;
    }
    if (h && ev) {
      const r = media.getBoundingClientRect();
      tip.innerHTML = `<b>Корпус ${h.no}</b><span>${h.f} этажей · нажмите, чтобы выбрать квартиру</span>`;
      tip.style.left = (ev.clientX - r.left + 16) + 'px'; tip.style.top = (ev.clientY - r.top + 16) + 'px'; tip.hidden = false;
    } else tip.hidden = true;
    cv.style.cursor = h ? 'pointer' : (drag ? 'grabbing' : 'grab');
  }

  cv.addEventListener('pointerdown', ev => {
    drag = { x: ev.clientX, y: ev.clientY, yaw: goal.yaw, pit: goal.pit, moved: false, type: ev.pointerType };
    if (ev.pointerType === 'mouse') cv.setPointerCapture(ev.pointerId);
    fly = null; idleAt = performance.now();
  });
  cv.addEventListener('pointermove', ev => {
    if (drag) {
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
      goal.yaw = drag.yaw - dx * 0.005;
      if (drag.type === 'mouse') goal.pit = Math.max(0.28, Math.min(1.35, drag.pit + dy * 0.004));
      idleAt = performance.now(); need = true; setHover(null); return;
    }
    if (ev.pointerType === 'mouse') setHover(pick(ev), ev);
  });
  const end = ev => {
    if (!drag) return;
    const click = !drag.moved; drag = null; idleAt = performance.now();
    if (click) { const h = pick(ev); if (h) openHouse(h); }
  };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', () => { drag = null; });
  cv.addEventListener('pointerleave', () => setHover(null));
  // Колесо листает сцены сайта; масштаб — щипком на тачпаде (ctrl+колесо) или двумя пальцами
  cv.addEventListener('wheel', ev => {
    if (!ev.ctrlKey) return;
    ev.preventDefault(); ev.stopPropagation();
    goal.dist = Math.max(320, Math.min(1500, goal.dist * (1 + ev.deltaY * 0.004))); idleAt = performance.now(); fly = null;
  }, { passive: false });
  const touches = new Map(); let pinch = 0;
  cv.addEventListener('touchstart', e => { [...e.changedTouches].forEach(t => touches.set(t.identifier, t)); if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); } }, { passive: true });
  cv.addEventListener('touchmove', e => {
    [...e.changedTouches].forEach(t => touches.set(t.identifier, t));
    if (touches.size === 2 && pinch) { e.preventDefault(); const [a, b] = [...touches.values()]; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); goal.dist = Math.max(320, Math.min(1600, goal.dist * pinch / d)); pinch = d; idleAt = performance.now(); }
  }, { passive: false });
  cv.addEventListener('touchend', e => { [...e.changedTouches].forEach(t => touches.delete(t.identifier)); if (touches.size < 2) pinch = 0; }, { passive: true });

  function flyTo(x, z, dist, pit) { fly = { tx: x, tz: z, dist, pit }; idleAt = performance.now() + 4000; }
  function openHouse(h) {
    flyTo(h.top.x, h.top.z, 330, 0.42);
    setHover(null);
    setTimeout(() => { const a = document.querySelector('.view-kvartal [data-go="dom"]'); if (a) a.click(); }, reduced.matches ? 0 : 1300);
  }
  // Кнопки «Что внутри квартала»: камера подлетает к объекту
  document.querySelectorAll('.view-kvartal .places button[data-spot]').forEach(b => {
    b.addEventListener('click', () => { const p = PLACES[b.dataset.spot]; if (p) { const [x, z] = P(p[0], p[1]); flyTo(x, z, b.dataset.spot === 'park' ? 640 : 480, 0.55); } });
  });

  function tick(t) {
    raf = 0;
    if (!visible) return;
    if (fly) { goal.tx = fly.tx; goal.tz = fly.tz; goal.dist = fly.dist; goal.pit = fly.pit; }
    else if (!drag && !reduced.matches && t - idleAt > 3500) {
      // лёгкое покачивание вокруг исходного ракурса
      goal.yaw = base.yaw + Math.sin((t - idleAt) * 0.00012) * 0.32;
      goal.tx += (base.tx - goal.tx) * 0.01; goal.tz += (base.tz - goal.tz) * 0.01;
      goal.dist += (base.dist - goal.dist) * 0.01; goal.pit += (base.pit - goal.pit) * 0.01;
    }
    const k = reduced.matches ? 1 : 0.06; let moving = false;
    for (const key of ['yaw', 'pit', 'dist', 'tx', 'tz']) { const d = goal[key] - st[key]; if (Math.abs(d) > 1e-4) moving = true; st[key] += d * k; }
    if (moving || need) { place(); renderer.render(scene, cam); need = false; }
    raf = requestAnimationFrame(tick);
  }
  let raf = 0;
  function setVisible(v) {
    visible = v;
    if (v) { resize(); need = true; if (!raf) raf = requestAnimationFrame(tick); }
  }
  // Показываем 3D только на активной сцене и не во время видеоперехода
  const sync = () => {
    const on = section.classList.contains('is-active') && !document.body.classList.contains('is-moving');
    section.classList.toggle('k3d-on', on);
    if (on) media.scrollLeft = 0;
    if (on && !visible) { Object.assign(st, base, { dist: base.dist * 0.9, pit: base.pit + 0.08 }); Object.assign(goal, base); fly = null; idleAt = performance.now(); }
    setVisible(on || section.classList.contains('is-active'));
  };
  new MutationObserver(sync).observe(section, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  place(); renderer.render(scene, cam); sync();
  window.OP3D = { flyTo, scene, cam, renderer };
}

try { start(); } catch (e) { console.warn('3D квартала не запустился', e); section && section.classList.remove('has-3d'); }
