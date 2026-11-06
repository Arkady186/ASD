/* ASD · «Примерка кухни на своё фото».
   Без нейросети и без сервера: фото не покидает браузер. Пользователь отмечает 4 угла
   нижних (и при желании верхних) шкафов, а мы в WebGL накладываем фасады ASD в перспективе,
   сохраняя свет и тени исходного снимка. Сравнение «было / стало», скачивание результата. */
import * as THREE from 'three';
import { FACADES, TOPS, woodCanvas, marbleCanvas, speckCanvas, concreteCanvas, frameCanvas } from './apartment3d.js';

const CONTACTS = {
  phone: '+79185513330', phoneText: '+7 918 551-33-30',
  wa: 'https://wa.me/qr/CUXN5RGDK4NJH1', tg: 'https://t.me/Lud_milo_chka',
  max: 'https://max.ru/u/f9LHodD0cOKu8Lmf9UZ8HfUI0ai50OGQHe9nSD17VQqKK6NJkg2ElEu_T6E',
  quiz: 'https://asd-mebel.ru/quiz.html'
};
const DEMO = { src: 'assets/img/primerka-demo.jpg', lower: [[0, 580], [690, 552], [678, 838], [0, 970]], len: 3.0 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- Гомография: единичный квадрат → четырёхугольник ---------- */
function homography(q) { // q: TL, TR, BR, BL
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
  const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
  return [a, b, c, d, e, f, g, h, 1];
}
function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1e-12;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
const mapQ = (H, u, v) => { const w = H[6] * u + H[7] * v + H[8]; return [(H[0] * u + H[1] * v + H[2]) / w, (H[3] * u + H[4] * v + H[5]) / w]; };

/* ---------- «Развёртка» кухни: фасады, зазоры, столешница, цоколь ---------- */
function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
const facadeCache = new Map();
function facadeSource(f, ci) {
  const [, kind, hex] = f.colors[ci] || f.colors[0], key = f.id + ci;
  if (facadeCache.has(key)) return facadeCache.get(key);
  let c = null;
  if (kind === 'wood') c = woodCanvas(hex, 512); else if (kind === 'frame') c = frameCanvas(hex, false); else if (kind === 'woodframe') c = frameCanvas(hex, true);
  else if (kind === 'concrete') c = concreteCanvas(hex, 512); else if (kind === 'stone') c = marbleCanvas(hex, '150,145,140', 512);
  const r = { canvas: c, color: hex, kind }; facadeCache.set(key, r); return r;
}
function topSource(id) {
  const t = TOPS.find(x => x.id === id) || TOPS[0], key = 'top' + t.id;
  if (!facadeCache.has(key)) facadeCache.set(key, t.kind === 'marble' ? marbleCanvas(t.color, '120,120,125', 512) : t.kind === 'speck' ? speckCanvas(t.color, 512) : woodCanvas(t.color, 512, false));
  return facadeCache.get(key);
}
function drawFront(g, x, y, w, h, src, handles) {
  if (src.canvas) g.drawImage(src.canvas, 0, 0, src.canvas.width, src.canvas.height, x, y, w, h); else { g.fillStyle = src.color; g.fillRect(x, y, w, h); }
  // фаска: светлая кромка сверху, тень снизу
  const e = Math.max(1, h * 0.012);
  g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x, y, w, e);
  g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(x, y + h - e * 1.5, w, e * 1.5); g.fillRect(x + w - e, y, e, h);
  if (handles) { const hw = Math.min(w * 0.45, h * 1.2, 160), hh = Math.max(3, h * 0.035); g.fillStyle = '#2B2B2D'; g.fillRect(x + (w - hw) / 2, y + h * 0.1, hw, hh); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x + (w - hw) / 2, y + h * 0.1, hw, hh * 0.35); }
}
function elevation(kind, o) {
  const len = o.len, Hm = kind === 'lower' ? 0.9 : 0.72;
  const W = 2048, ppm = W / len, Hpx = Math.round(Hm * ppm), [c, g] = cv(W, Hpx);
  const src = facadeSource(FACADES.find(x => x.id === o.facade) || FACADES[0], o.color), gap = Math.max(2, 0.003 * ppm);
  const n = Math.max(2, Math.round(len / (kind === 'lower' ? 0.6 : 0.5))), mw = W / n;
  g.fillStyle = '#18181A'; g.fillRect(0, 0, W, Hpx);
  if (kind === 'lower') {
    const top = 0.04 * ppm, gola = o.handles ? 0 : 0.035 * ppm, plinth = 0.1 * ppm, y0 = top + gola, y1 = Hpx - plinth;
    const ts = topSource(o.top); g.drawImage(ts, 0, 0, ts.width, ts.height * 0.08, 0, 0, W, top);
    g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(0, 0, W, Math.max(1, top * 0.12));
    g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(0, top - 2, W, 2);
    if (gola) { g.fillStyle = '#2A2A2C'; g.fillRect(0, top, W, gola); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(0, top + gola * 0.7, W, 2); }
    for (let i = 0; i < n; i++) {
      const x = i * mw + gap / 2, w = mw - gap, H = y1 - y0, pat = i % 3;
      const rows = pat === 0 ? [0.25, 0.35, 0.4] : pat === 2 ? [0.3, 0.7] : [1];
      let y = y0;
      rows.forEach(r => { const h = H * r; drawFront(g, x, y + gap / 2, w, h - gap, src, o.handles); y += h; });
    }
    const pg = g.createLinearGradient(0, y1, 0, Hpx); pg.addColorStop(0, '#141415'); pg.addColorStop(1, '#2A2A2B');
    g.fillStyle = pg; g.fillRect(0, y1, W, plinth);
    const ao = g.createLinearGradient(0, y0, 0, y0 + 0.12 * ppm); ao.addColorStop(0, 'rgba(0,0,0,.22)'); ao.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = ao; g.fillRect(0, y0, W, 0.12 * ppm);
  } else {
    for (let i = 0; i < n; i++) drawFront(g, i * mw + gap / 2, gap / 2, mw - gap, Hpx - gap, src, o.handles);
    const ao = g.createLinearGradient(0, 0, 0, 0.1 * ppm); ao.addColorStop(0, 'rgba(0,0,0,.18)'); ao.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = ao; g.fillRect(0, 0, W, 0.1 * ppm);
  }
  return c;
}

/* ---------- Рендер ---------- */
const FRAG = `
precision highp float;
uniform sampler2D photo, elevL, elevU, lightL, lightU;
uniform vec2 res;
uniform mat3 hinvL, hinvU;
uniform float onL, onU, expL, expU, glossL, glossU, lod;
varying vec2 vUv;
vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }
vec3 toSrgb(vec3 c){ return pow(max(c, 0.0), vec3(1.0/2.2)); }
float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec4 region(sampler2D el, sampler2D lt, mat3 hi, float ex, float gl, vec2 px, vec3 base){
  vec3 q = hi * vec3(px, 1.0); vec2 uv = q.xy / q.z;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  vec2 puv = vec2(px.x / res.x, 1.0 - px.y / res.y);
  // освещение снимка: сетка медиан по области (ручки и рисунок старых фасадов не просвечивают)
  float L2 = lum(toLin(textureLod(photo, puv, lod).rgb));
  float shade = clamp(texture2D(lt, uv).r * ex, 0.15, 2.4);
  vec3 alb = toLin(texture2D(el, vec2(uv.x, 1.0 - uv.y)).rgb);
  vec3 c = alb * shade;
  // глянец: мягкий блик сверху и отражение светлых зон снимка
  c += gl * (0.06 * (1.0 - uv.y) + 0.5 * smoothstep(0.55, 1.0, L2)) * vec3(1.0);
  float edge = smoothstep(0.0, 0.004, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
  return vec4(c, edge);
}
void main(){
  vec2 px = vec2(vUv.x * res.x, (1.0 - vUv.y) * res.y);
  vec3 base = toLin(texture2D(photo, vUv).rgb);
  vec3 col = base;
  if (onU > 0.5) { vec4 r = region(elevU, lightU, hinvU, expU, glossU, px, base); col = mix(col, r.rgb, r.a); }
  if (onL > 0.5) { vec4 r = region(elevL, lightL, hinvL, expL, glossL, px, base); col = mix(col, r.rgb, r.a); }
  gl_FragColor = vec4(toSrgb(col), 1.0);
}`;

let root = null;
export function openTryon() {
  if (!root) build();
  root.hidden = false; document.documentElement.classList.add('tryon-open');
  requestAnimationFrame(() => root.classList.add('is-in'));
}
function close() {
  root.classList.remove('is-in'); document.documentElement.classList.remove('tryon-open');
  setTimeout(() => { root.hidden = true; }, 300);
}

function build() {
  root = document.createElement('div'); root.className = 'tryon'; root.hidden = true;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Примерка кухни ASD на своё фото');
  root.innerHTML = `
    <div class="tr-head">
      <div><p class="tr-kick">ASD · примерка</p><h2>Примерьте новую кухню на своё фото</h2></div>
      <button type="button" class="tr-x" aria-label="Закрыть">×</button>
    </div>
    <div class="tr-intro">
      <div class="tr-drop">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>
        <h3>Сфотографируйте свою кухню</h3>
        <p>Встаньте напротив нижних шкафов, чтобы они целиком попали в кадр. Фото никуда не отправляется — примерка считается прямо в вашем браузере.</p>
        <label class="btn tr-file">Сфотографировать или загрузить<input type="file" accept="image/*" capture="environment" hidden></label>
        <button type="button" class="tr-demo">Попробовать на примере</button>
      </div>
    </div>
    <div class="tr-work" hidden>
      <div class="tr-stage">
        <div class="tr-frame">
          <canvas class="tr-out"></canvas>
          <canvas class="tr-before"></canvas>
          <svg class="tr-svg"></svg>
          <div class="tr-handles"></div>
          <div class="tr-cmp" hidden><span class="tr-lab l">Было</span><span class="tr-lab r">Стало с ASD</span><div class="tr-bar"><i></i></div></div>
        </div>
      </div>
      <aside class="tr-panel">
        <section class="tr-step tr-s1">
          <h4><b>1</b> Отметьте углы шкафов</h4>
          <p>Перетащите 4 точки на углы нижних шкафов: верхние — по краю столешницы, нижние — по полу.</p>
          <div class="tr-toggles">
            <label><input type="checkbox" data-r="lower" checked> Нижние шкафы</label>
            <label><input type="checkbox" data-r="upper"> Верхние шкафы</label>
          </div>
          <label class="tr-len">Длина кухни: <b>3,0 м</b><input type="range" min="1.2" max="6" step="0.1" value="3"></label>
        </section>
        <section class="tr-step">
          <h4><b>2</b> Выберите кухню ASD</h4>
          <div class="tr-chips tr-fac"></div>
          <div class="tr-sws"></div>
          <p class="tr-sub">Столешница</p><div class="tr-chips tr-top"></div>
          <p class="tr-sub">Ручки</p><div class="tr-chips tr-hnd"><button type="button" data-h="0" class="is-on">Без ручек</button><button type="button" data-h="1">Ручки-скобы</button></div>
        </section>
        <section class="tr-step tr-go">
          <button type="button" class="btn tr-compare">Сравнить: было / стало</button>
          <div class="tr-row"><button type="button" class="tr-ghost tr-edit">Поправить точки</button><button type="button" class="tr-ghost tr-save">Скачать картинку</button></div>
          <p class="tr-note">Это примерка, а не точный проект. Точные размеры и цену дизайнер ASD посчитает после бесплатного замера.</p>
          <a class="btn tr-cta" href="${CONTACTS.quiz}" target="_blank" rel="noopener">Хочу такую кухню</a>
          <p class="tr-sub">Отправьте картинку дизайнеру:</p>
          <div class="tr-row tr-msg">
            <a href="${CONTACTS.wa}" target="_blank" rel="noopener">WhatsApp</a><a href="${CONTACTS.tg}" target="_blank" rel="noopener">Telegram</a><a href="${CONTACTS.max}" target="_blank" rel="noopener">MAX</a><a href="tel:${CONTACTS.phone}">${CONTACTS.phoneText}</a>
          </div>
        </section>
      </aside>
    </div>`;
  document.body.appendChild(root);
  const $ = s => root.querySelector(s);
  $('.tr-x').addEventListener('click', close);
  addEventListener('keydown', e => { if (e.key === 'Escape' && !root.hidden) close(); });

  /* состояние */
  const S = { facade: 'agt', color: 0, top: 'stone', handles: false, len: 3, on: { lower: true, upper: false }, q: { lower: null, upper: null }, img: null, W: 1, H: 1, edit: true, cmp: 0.5 };
  const out = $('.tr-out'), before = $('.tr-before'), svg = $('.tr-svg'), hbox = $('.tr-handles'), frame = $('.tr-frame');
  let renderer = null, mat = null, scene, cam, photoTex = null;
  const texL = new THREE.CanvasTexture(document.createElement('canvas')), texU = new THREE.CanvasTexture(document.createElement('canvas'));
  [texL, texU].forEach(t => { t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; t.minFilter = THREE.LinearMipmapLinearFilter; });

  function initGL() {
    if (renderer) return true;
    try { renderer = new THREE.WebGLRenderer({ canvas: out, antialias: true, preserveDrawingBuffer: true }); } catch (e) { return false; }
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
    scene = new THREE.Scene(); cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    mat = new THREE.ShaderMaterial({
      uniforms: { photo: { value: null }, elevL: { value: texL }, elevU: { value: texU }, lightL: { value: null }, lightU: { value: null }, res: { value: new THREE.Vector2() }, hinvL: { value: new THREE.Matrix3() }, hinvU: { value: new THREE.Matrix3() },
        onL: { value: 1 }, onU: { value: 0 }, expL: { value: 1 }, expU: { value: 1 }, glossL: { value: 0 }, glossU: { value: 0 }, lod: { value: 5 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: FRAG
    });
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    return true;
  }

  /* загрузка фото */
  function loadImage(src, preset) {
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, 1800 / Math.max(im.naturalWidth, im.naturalHeight));
      S.W = Math.round(im.naturalWidth * k); S.H = Math.round(im.naturalHeight * k);
      const c = document.createElement('canvas'); c.width = S.W; c.height = S.H; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, S.W, S.H); S.img = c; S.ctx = g;
      before.width = S.W; before.height = S.H; before.getContext('2d').drawImage(c, 0, 0);
      if (!initGL()) { alert('Ваш браузер не поддерживает WebGL — примерка недоступна.'); return; }
      out.width = S.W; out.height = S.H; renderer.setPixelRatio(1); renderer.setSize(S.W, S.H, false);
      if (photoTex) photoTex.dispose();
      lights.lower = lights.upper = null; photoTex = new THREE.CanvasTexture(c); photoTex.colorSpace = THREE.NoColorSpace; photoTex.generateMipmaps = true; photoTex.minFilter = THREE.LinearMipmapLinearFilter;
      mat.uniforms.photo.value = photoTex; mat.uniforms.res.value.set(S.W, S.H);
      mat.uniforms.lod.value = Math.max(2, Math.log2(Math.max(S.W, S.H) / 28));
      const sc = S.W / (preset ? 710 : S.W);
      S.q.lower = preset ? preset.lower.map(([x, y]) => [x * sc, y * sc]) : [[S.W * 0.08, S.H * 0.55], [S.W * 0.92, S.H * 0.55], [S.W * 0.92, S.H * 0.84], [S.W * 0.08, S.H * 0.84]];
      S.q.upper = [[S.W * 0.08, S.H * 0.12], [S.W * 0.92, S.H * 0.12], [S.W * 0.92, S.H * 0.36], [S.W * 0.08, S.H * 0.36]];
      if (preset) { S.len = preset.len; lenIn.value = S.len; }
      $('.tr-intro').hidden = true; $('.tr-work').hidden = false;
      setEdit(true); rebuild(); layout();
    };
    im.src = src;
  }
  $('.tr-file input').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; const url = URL.createObjectURL(f); loadImage(url); });
  $('.tr-demo').addEventListener('click', () => loadImage(DEMO.src, DEMO));

  /* ручки-точки */
  const handles = { lower: [], upper: [] };
  ['lower', 'upper'].forEach(r => { for (let i = 0; i < 4; i++) { const h = document.createElement('button'); h.type = 'button'; h.className = 'tr-h tr-h-' + r; h.setAttribute('aria-label', (r === 'lower' ? 'Нижние' : 'Верхние') + ' шкафы, угол ' + (i + 1)); hbox.appendChild(h); handles[r].push(h); bindDrag(h, r, i); } });
  function scale() { const r = out.getBoundingClientRect(); return { r, k: r.width / S.W }; }
  function bindDrag(h, r, i) {
    h.addEventListener('pointerdown', e => {
      e.preventDefault(); h.setPointerCapture(e.pointerId);
      const move = ev => { const { r: rc, k } = scale(); S.q[r][i] = [clamp((ev.clientX - rc.left) / k, 0, S.W), clamp((ev.clientY - rc.top) / k, 0, S.H)]; place(); schedule(); };
      const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); };
      h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
    });
    h.addEventListener('keydown', e => { const d = { ArrowLeft: [-4, 0], ArrowRight: [4, 0], ArrowUp: [0, -4], ArrowDown: [0, 4] }[e.key]; if (!d) return; e.preventDefault(); S.q[r][i][0] += d[0]; S.q[r][i][1] += d[1]; place(); schedule(); });
  }
  function place() {
    const { k } = scale(), fr = frame.getBoundingClientRect(), orr = out.getBoundingClientRect(), ox = orr.left - fr.left, oy = orr.top - fr.top;
    let poly = '';
    ['lower', 'upper'].forEach(r => {
      handles[r].forEach((h, i) => { const [x, y] = S.q[r] ? S.q[r][i] : [0, 0]; h.style.transform = `translate(${ox + x * k}px, ${oy + y * k}px)`; h.hidden = !S.on[r] || !S.edit; });
      if (S.on[r] && S.edit && S.q[r]) poly += `<polygon class="tr-poly ${r}" points="${S.q[r].map(([x, y]) => `${ox + x * k},${oy + y * k}`).join(' ')}"/>`;
    });
    svg.innerHTML = poly; svg.setAttribute('viewBox', `0 0 ${fr.width} ${fr.height}`);
  }
  function layout() {
    if (!S.img) return;
    const st = $('.tr-stage').getBoundingClientRect(), k = Math.min(st.width / S.W, st.height / S.H);
    frame.style.width = Math.floor(S.W * k) + 'px'; frame.style.height = Math.floor(S.H * k) + 'px';
    place(); cmp();
  }
  new ResizeObserver(layout).observe($('.tr-stage'));

  /* карта освещения области: сетка GX×GY медиан яркости снимка */
  const GX = 8, GY = 4;
  function lightMap(q) {
    const H = homography(q), data = new Float32Array(GX * GY * 4), d = S.ctx, img = d.getImageData(0, 0, S.W, S.H).data;
    const lumAt = (x, y) => { x = clamp(x | 0, 0, S.W - 1); y = clamp(y | 0, 0, S.H - 1); const i = (y * S.W + x) * 4; return 0.2126 * Math.pow(img[i] / 255, 2.2) + 0.7152 * Math.pow(img[i + 1] / 255, 2.2) + 0.0722 * Math.pow(img[i + 2] / 255, 2.2); };
    const all = [];
    for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
      const v = [];
      for (let a = 0; a < 7; a++) for (let b = 0; b < 7; b++) { const [x, y] = mapQ(H, (gx + (a + 0.5) / 7) / GX, 0.06 + 0.88 * (gy + (b + 0.5) / 7) / GY); v.push(lumAt(x, y)); }
      v.sort((m, n) => m - n); const med = v[Math.floor(v.length * 0.6)];
      data.set([med, med, med, 1], ((GY - 1 - gy) * GX + gx) * 4); all.push(med);
    }
    all.sort((m, n) => m - n);
    const t = new THREE.DataTexture(data, GX, GY, THREE.RGBAFormat, THREE.FloatType);
    t.magFilter = t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
    return { tex: t, med: Math.max(0.02, all[all.length >> 1]) };
  }
  const lights = { lower: null, upper: null }, lightKey = { lower: '', upper: '' };
  let pend = 0;
  function schedule() { if (!pend) pend = requestAnimationFrame(() => { pend = 0; render(); }); }
  function rebuild() {
    const o = { facade: S.facade, color: S.color, top: S.top, handles: S.handles, len: S.len };
    texL.image = elevation('lower', o); texL.needsUpdate = true;
    texU.image = elevation('upper', o); texU.needsUpdate = true;
    render();
  }
  function render() {
    if (!renderer || !S.img) return;
    const f = FACADES.find(x => x.id === S.facade), kind = f.colors[S.color][1];
    const gloss = kind === 'gloss' ? 1 : kind === 'paint' ? 0.35 : f.id === 'hpl' ? 0.2 : 0.08;
    const U = mat.uniforms;
    // экспозиция: свет на снимке ≈ яркость участка / средняя отражательная способность старых фасадов (≈0.45)
    ['lower', 'upper'].forEach(r => {
      const key = r === 'lower' ? 'L' : 'U', q = S.q[r]; U['on' + key].value = S.on[r] ? 1 : 0; if (!q) return;
      const Hi = invert3(homography(q)); U['hinv' + key].value.set(...Hi);
      const k = q.map(p => p.map(Math.round).join()).join();
      if (k !== lightKey[r] || !lights[r]) { if (lights[r]) lights[r].tex.dispose(); lights[r] = lightMap(q); lightKey[r] = k; }
      U['light' + key].value = lights[r].tex;
      U['exp' + key].value = 0.5 / lights[r].med;
      U['gloss' + key].value = gloss * 0.35;
    });
    renderer.render(scene, cam);
  }

  /* панель выбора */
  const fac = $('.tr-fac'), sws = $('.tr-sws'), tops = $('.tr-top');
  function ui() {
    fac.innerHTML = FACADES.map(x => `<button type="button" data-f="${x.id}" class="${x.id === S.facade ? 'is-on' : ''}">${x.name}<small>${x.price}</small></button>`).join('');
    const f = FACADES.find(x => x.id === S.facade);
    sws.innerHTML = f.colors.map((c, i) => `<button type="button" data-c="${i}" class="${i === S.color ? 'is-on' : ''}" style="--c:${c[2]}" title="${c[0]}" aria-label="${c[0]}"></button>`).join('') + `<span>${f.colors[S.color][0]}</span>`;
    tops.innerHTML = TOPS.map(t => `<button type="button" data-t="${t.id}" class="${t.id === S.top ? 'is-on' : ''}">${t.name}</button>`).join('');
  }
  ui();
  root.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !root.contains(b)) return;
    if (b.dataset.f) { S.facade = b.dataset.f; S.color = 0; ui(); rebuild(); }
    else if (b.dataset.c) { S.color = +b.dataset.c; ui(); rebuild(); }
    else if (b.dataset.t) { S.top = b.dataset.t; ui(); rebuild(); }
    else if (b.dataset.h) { S.handles = b.dataset.h === '1'; root.querySelectorAll('[data-h]').forEach(x => x.classList.toggle('is-on', x === b)); rebuild(); }
  });
  root.querySelectorAll('.tr-toggles input').forEach(i => i.addEventListener('change', () => { S.on[i.dataset.r] = i.checked; place(); render(); }));
  const lenIn = $('.tr-len input');
  lenIn.addEventListener('input', () => { S.len = +lenIn.value; $('.tr-len b').textContent = S.len.toFixed(1).replace('.', ',') + ' м'; rebuild(); });

  /* было / стало */
  const cmpBox = $('.tr-cmp');
  function cmp() { before.style.clipPath = S.edit ? 'inset(0 100% 0 0)' : `inset(0 ${(1 - S.cmp) * 100}% 0 0)`; cmpBox.style.setProperty('--x', S.cmp * 100 + '%'); }
  function setEdit(on) {
    S.edit = on; cmpBox.hidden = on; $('.tr-compare').hidden = !on; $('.tr-edit').hidden = on; root.classList.toggle('is-cmp', !on);
    if (!on) { S.cmp = 0.5; animateCmp(); }
    place(); cmp();
  }
  function animateCmp() { // подсказка: шторка сама проезжает туда-обратно
    const t0 = performance.now();
    const step = now => { const t = (now - t0) / 1800; if (t > 1 || S.edit || S.drag) return; S.cmp = 0.5 + Math.sin(t * Math.PI * 2) * 0.32; cmp(); requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  $('.tr-compare').addEventListener('click', () => setEdit(false));
  $('.tr-edit').addEventListener('click', () => setEdit(true));
  frame.addEventListener('pointerdown', e => {
    if (S.edit || e.target.closest('.tr-h')) return;
    S.drag = true; frame.setPointerCapture(e.pointerId);
    const mv = ev => { const r = out.getBoundingClientRect(); S.cmp = clamp((ev.clientX - r.left) / r.width, 0, 1); cmp(); };
    mv(e);
    const up = () => { S.drag = false; frame.removeEventListener('pointermove', mv); frame.removeEventListener('pointerup', up); };
    frame.addEventListener('pointermove', mv); frame.addEventListener('pointerup', up);
  });
  $('.tr-save').addEventListener('click', () => {
    render();
    out.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'kuhnya-asd-primerka.jpg'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, 'image/jpeg', 0.92);
  });
  window.ASDTryon = { S, render, setEdit, loadImage, DEMO };
}
