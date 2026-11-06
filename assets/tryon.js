/* ASD · «Примерка кухни на своё фото».
   Автоматически: бесплатные нейросети в браузере находят старую кухню, стирают её целиком
   и по её размерам ставят кухню ASD — столешницу, фасады, верхние шкафы, мойку и варочную панель.
   Фото не покидает устройство. Если нейросеть не справилась — запасной режим «4 точки вручную».
   Рендер — WebGL: каждая часть кухни натягивается в перспективе снимка и освещается его светом. */
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

/* ---------- «Развёртки» частей кухни ---------- */
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
  const e = Math.max(1, h * 0.012);
  g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x, y, w, e);
  g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(x, y + h - e * 1.5, w, e * 1.5); g.fillRect(x + w - e, y, e, h);
  if (handles) { const hw = Math.min(w * 0.45, h * 1.2, 160), hh = Math.max(3, h * 0.035); g.fillStyle = '#2B2B2D'; g.fillRect(x + (w - hw) / 2, y + h * 0.1, hw, hh); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x + (w - hw) / 2, y + h * 0.1, hw, hh * 0.35); }
}
/** Фасады: нижние (с кромкой столешницы и цоколем, 0,9 м) или верхние (0,72 м). */
function elevation(kind, o) {
  const len = o.len, Hm = kind === 'lower' ? 0.9 : 0.72;
  const W = 2048, ppm = W / len, Hpx = Math.round(Hm * ppm), [c, g] = cv(W, Hpx);
  const src = facadeSource(FACADES.find(x => x.id === o.facade) || FACADES[0], o.color), gap = Math.max(2, 0.003 * ppm);
  const n = Math.max(1, Math.round(len / (kind === 'lower' ? 0.6 : 0.5))), mw = W / n;
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
    const ao = g.createLinearGradient(0, Hpx * 0.75, 0, Hpx); ao.addColorStop(0, 'rgba(0,0,0,0)'); ao.addColorStop(1, 'rgba(0,0,0,.12)'); g.fillStyle = ao; g.fillRect(0, 0, W, Hpx);
  }
  return c;
}
function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
/** Верх столешницы (вид сверху, глубина 0,6 м) с мойкой и варочной панелью. Верх холста — у стены. */
function topSurface(o) {
  const len = o.len, W = 2048, ppm = W / len, H = Math.max(48, Math.round(0.6 * ppm)), [c, g] = cv(W, H);
  const ts = topSource(o.top), tile = Math.max(64, 0.9 * ppm);
  for (let x = 0; x < W; x += tile) for (let y = 0; y < H; y += tile) g.drawImage(ts, x, y, tile, tile);
  const d = o.depth || 0.6, ub = Math.round(H * clamp(0.045 / (0.045 + d), 0.04, 0.6)); // бортик у стены
  if (o.depth != null) {
    const bg = g.createLinearGradient(0, 0, 0, ub); bg.addColorStop(0, 'rgba(0,0,0,.06)'); bg.addColorStop(1, 'rgba(0,0,0,.22)');
    g.fillStyle = bg; g.fillRect(0, 0, W, ub); g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(0, 0, W, Math.max(1, ub * 0.12));
    g.save(); g.translate(0, ub); g.scale(1, (H - ub) / H);
  }
  const ao = g.createLinearGradient(0, 0, 0, H * 0.3); ao.addColorStop(0, 'rgba(0,0,0,.28)'); ao.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = ao; g.fillRect(0, 0, W, H * 0.3);
  g.fillStyle = 'rgba(255,255,255,.2)'; g.fillRect(0, H - Math.max(2, H * 0.025), W, Math.max(2, H * 0.025));
  const m = 0.08 * ppm;
  let sinkU = o.sinkU, hobU = o.hobU;
  if (sinkU == null && len >= 1.1) sinkU = 0.28;
  if (hobU == null && len >= 1.8) hobU = 0.72;
  const sw = Math.min(0.62, len * 0.32) * ppm, hw = Math.min(0.58, len * 0.3) * ppm;
  if (sinkU != null && hobU != null && Math.abs(sinkU - hobU) * W < (sw + hw) / 2 + 0.25 * ppm) hobU = sinkU < 0.5 ? Math.min(0.92, sinkU + ((sw + hw) / 2 + 0.3 * ppm) / W) : Math.max(0.08, sinkU - ((sw + hw) / 2 + 0.3 * ppm) / W);
  if (sinkU != null) { // мойка
    const sh = 0.44 * ppm, x = clamp(sinkU * W - sw / 2, m, W - sw - m), y = (H - sh) * 0.55;
    const sg = g.createLinearGradient(0, y, 0, y + sh); sg.addColorStop(0, '#C9CBCE'); sg.addColorStop(1, '#9EA1A5');
    g.fillStyle = sg; rrect(g, x, y, sw, sh, sh * 0.08); g.fill();
    const bx = x + sw * 0.08, by = y + sh * 0.12, bw = sw * 0.84, bh = sh * 0.76, bg = g.createLinearGradient(0, by, 0, by + bh);
    bg.addColorStop(0, '#6E7176'); bg.addColorStop(1, '#A7AAAE'); g.fillStyle = bg; rrect(g, bx, by, bw, bh, bh * 0.12); g.fill();
    g.fillStyle = '#4A4C50'; g.beginPath(); g.arc(bx + bw / 2, by + bh * 0.55, bh * 0.07, 0, 7); g.fill();
    g.fillStyle = '#3B3D40'; g.beginPath(); g.arc(x + sw / 2, y - sh * 0.02, sh * 0.06, 0, 7); g.fill();
  }
  if (hobU != null) { // варочная панель
    const hh = 0.5 * ppm, x = clamp(hobU * W - hw / 2, m, W - hw - m), y = (H - hh) * 0.5;
    g.fillStyle = '#121214'; rrect(g, x, y, hw, hh, hh * 0.03); g.fill();
    g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(x, y, hw, hh * 0.04);
    g.strokeStyle = 'rgba(200,200,205,.28)'; g.lineWidth = Math.max(1, hh * 0.012);
    [[0.28, 0.3, 0.13], [0.72, 0.3, 0.1], [0.28, 0.72, 0.1], [0.72, 0.72, 0.13]].forEach(([u, v, r]) => { g.beginPath(); g.arc(x + hw * u, y + hh * v, hh * r, 0, 7); g.stroke(); });
  }
  if (o.depth != null) g.restore();
  return c;
}

/* ---------- Шейдеры ---------- */
const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const BG_FRAG = 'uniform sampler2D map; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(map, vUv).rgb, 1.0); }';
const REG_FRAG = `
precision highp float;
uniform sampler2D elev, light;
uniform vec2 res;
uniform mat3 hinv;
uniform float ex, gloss, shLen, shA;
varying vec2 vUv;
vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }
vec3 toSrgb(vec3 c){ return pow(max(c, 0.0), vec3(1.0/2.2)); }
void main(){
  vec2 px = vec2(vUv.x * res.x, (1.0 - vUv.y) * res.y);
  vec3 q = hinv * vec3(px, 1.0);
  if (q.z <= 0.0) discard;
  vec2 uv = q.xy / q.z;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0) discard;
  if (uv.y > 1.0) { // мягкая тень под шкафами
    float d = (uv.y - 1.0) / max(shLen, 1e-4);
    if (d >= 1.0 || shA <= 0.0) discard;
    float s = min(min(uv.x, 1.0 - uv.x) * 30.0, 1.0);
    gl_FragColor = vec4(0.0, 0.0, 0.0, shA * (1.0 - d) * (1.0 - d) * s);
    return;
  }
  float shade = clamp(texture2D(light, uv).r * ex, 0.12, 2.2);
  vec3 alb = toLin(texture2D(elev, vec2(uv.x, 1.0 - uv.y)).rgb);
  vec3 c = alb * shade + gloss * (0.05 + 0.07 * (1.0 - uv.y)) * vec3(1.0);
  float edge = smoothstep(0.0, 0.0025, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
  gl_FragColor = vec4(toSrgb(c), edge);
}`;

let root = null;
export function openTryon() {
  if (!root) build();
  root.hidden = false; document.documentElement.classList.add('tryon-open');
  requestAnimationFrame(() => root.classList.add('is-in')); setTimeout(() => root.classList.add('is-in'), 120);
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
      <div><p class="tr-kick">ASD · примерка</p><h2>Новая кухня на фото вашей кухни</h2></div>
      <button type="button" class="tr-x" aria-label="Закрыть">×</button>
    </div>
    <div class="tr-intro">
      <div class="tr-drop">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>
        <h3>Сфотографируйте свою кухню</h3>
        <p>Нейросеть сама найдёт старую кухню, уберёт её и поставит на её место кухню ASD. Встаньте так, чтобы нижние шкафы целиком попали в кадр. Фото никуда не отправляется — всё считается прямо на вашем устройстве.</p>
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
          <div class="tr-ai" hidden>
            <div class="tr-scan"></div>
            <div class="tr-ai-card" role="status" aria-live="polite">
              <ol>
                <li data-s="load">Загружаю нейросети<b></b></li>
                <li data-s="seg">Ищу старую кухню</li>
                <li data-s="erase">Убираю старую кухню</li>
                <li data-s="build">Ставлю кухню ASD</li>
              </ol>
              <p class="tr-ai-note"></p>
            </div>
          </div>
        </div>
      </div>
      <aside class="tr-panel">
        <section class="tr-step tr-s1">
          <div class="tr-auto">
            <h4><b>1</b> Нейросеть заменила кухню</h4>
            <p>Старая кухня убрана целиком, на её месте — кухня ASD по размерам вашей: столешница, фасады, мойка и варочная панель.</p>
            <div class="tr-toggles"><label><input type="checkbox" data-r="upper"> Верхние шкафы</label></div>
            <button type="button" class="tr-ghost tr-manual">Отметить шкафы вручную</button>
          </div>
          <div class="tr-man" hidden>
            <h4><b>1</b> Отметьте углы шкафов</h4>
            <p class="tr-warn" hidden></p>
            <p>Перетащите 4 точки на углы нижних шкафов: верхние — по краю столешницы, нижние — по полу.</p>
            <div class="tr-toggles">
              <label><input type="checkbox" data-r="lower" checked> Нижние шкафы</label>
              <label><input type="checkbox" data-r="upper"> Верхние шкафы</label>
            </div>
            <label class="tr-len">Длина кухни: <b>3,0 м</b><input type="range" min="1.2" max="6" step="0.1" value="3"></label>
            <button type="button" class="tr-ghost tr-retry" hidden>Заменить автоматически</button>
          </div>
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
  const $ = s => root.querySelector(s), $$ = s => [...root.querySelectorAll(s)];
  $('.tr-x').addEventListener('click', close);
  addEventListener('keydown', e => { if (e.key === 'Escape' && !root.hidden) close(); });

  /* состояние */
  const S = { facade: 'agt', color: 0, top: 'stone', handles: false, len: 3, on: { lower: true, upper: false }, q: { lower: null, upper: null },
    img: null, clean: null, W: 1, H: 1, edit: false, cmp: 0.5, mode: 'idle', geo: null, run: 0, preset: null };
  const out = $('.tr-out'), before = $('.tr-before'), svg = $('.tr-svg'), hbox = $('.tr-handles'), frame = $('.tr-frame');
  let renderer = null, scene, cam, bgMat = null, cleanTex = null, regions = [];

  function initGL() {
    if (renderer) return true;
    try { renderer = new THREE.WebGLRenderer({ canvas: out, antialias: true, preserveDrawingBuffer: true }); } catch (e) { return false; }
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
    scene = new THREE.Scene(); cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    bgMat = new THREE.ShaderMaterial({ uniforms: { map: { value: null } }, vertexShader: VERT, fragmentShader: BG_FRAG, depthTest: false, depthWrite: false });
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat); bg.renderOrder = 0; bg.frustumCulled = false; scene.add(bg);
    return true;
  }
  function setClean(c) {
    S.clean = c; S.cleanCtx = c.getContext('2d', { willReadFrequently: true }); S.cleanData = null;
    if (cleanTex) cleanTex.dispose();
    cleanTex = new THREE.CanvasTexture(c); cleanTex.colorSpace = THREE.NoColorSpace; cleanTex.minFilter = THREE.LinearFilter; cleanTex.generateMipmaps = false;
    bgMat.uniforms.map.value = cleanTex;
    Object.values(lightCache).forEach(l => l.tex.dispose()); for (const k in lightCache) delete lightCache[k];
  }

  /* загрузка фото */
  function loadImage(src, preset) {
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, 1800 / Math.max(im.naturalWidth, im.naturalHeight));
      S.W = Math.round(im.naturalWidth * k); S.H = Math.round(im.naturalHeight * k);
      const c = document.createElement('canvas'); c.width = S.W; c.height = S.H; c.getContext('2d').drawImage(im, 0, 0, S.W, S.H); S.img = c;
      before.width = S.W; before.height = S.H; before.getContext('2d').drawImage(c, 0, 0);
      if (!initGL()) { alert('Ваш браузер не поддерживает WebGL — примерка недоступна.'); return; }
      out.width = S.W; out.height = S.H; renderer.setPixelRatio(1); renderer.setSize(S.W, S.H, false);
      const copy = document.createElement('canvas'); copy.width = S.W; copy.height = S.H; copy.getContext('2d').drawImage(c, 0, 0); setClean(copy);
      const sc = S.W / (preset ? 710 : S.W); S.preset = preset;
      S.q.lower = preset ? preset.lower.map(([x, y]) => [x * sc, y * sc]) : [[S.W * 0.08, S.H * 0.55], [S.W * 0.92, S.H * 0.55], [S.W * 0.92, S.H * 0.84], [S.W * 0.08, S.H * 0.84]];
      S.q.upper = [[S.W * 0.08, S.H * 0.12], [S.W * 0.92, S.H * 0.12], [S.W * 0.92, S.H * 0.36], [S.W * 0.08, S.H * 0.36]];
      if (preset) { S.len = preset.len; lenIn.value = S.len; setLenLabel(); }
      $('.tr-intro').hidden = true; $('.tr-work').hidden = false;
      layout(); runAuto();
    };
    im.src = src;
  }
  $('.tr-file input').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; loadImage(URL.createObjectURL(f)); e.target.value = ''; });
  $('.tr-demo').addEventListener('click', () => loadImage(DEMO.src, DEMO));

  /* ---------- автоматический режим ---------- */
  const ai = $('.tr-ai'), aiNote = $('.tr-ai-note');
  function step(s, p) {
    const order = ['load', 'seg', 'erase', 'build'], i = order.indexOf(s);
    $$('.tr-ai li').forEach((li, j) => { li.classList.toggle('is-done', j < i); li.classList.toggle('is-on', j === i); });
    const b = $('.tr-ai li[data-s=load] b'); b.textContent = s === 'load' && p != null ? Math.round(p * 100) + '%' : '';
  }
  const paint = () => new Promise(r => { let done = false; const go = () => { if (!done) { done = true; setTimeout(r, 40); } }; requestAnimationFrame(go); setTimeout(go, 150); });
  async function runAuto() {
    const tok = ++S.run;
    S.mode = 'busy'; S.geo = null; setMode(); clearRegions(); render();
    ai.hidden = false; step('load', 0);
    aiNote.textContent = 'Две бесплатные нейросети работают прямо на вашем устройстве. Первый запуск скачивает модели (~120 МБ), дальше — мгновенно из кэша. Обработка 20–60 секунд.';
    try {
      const AI = await import('./kitchen-ai.js');
      await AI.loadModels(p => { if (tok === S.run) step('load', p); });
      if (tok !== S.run) return;
      step('seg'); await paint();
      const geo = await AI.analyze(S.img);
      if (tok !== S.run) return;
      S.conf = geo.conf || null;
      if (!geo.ok && geo.reason === 'complex') return manual('На фото сложная планировка — остров, несколько рядов или кухня видна сбоку, и автоматически поставить кухню ровно не получилось. Сфотографируйте один ряд шкафов спереди — или отметьте 4 точки вручную.');
      if (!geo.ok) return manual(geo.reason === 'nokitchen' ? 'Нейросеть не нашла на этом фото кухню. Попробуйте другое фото или отметьте шкафы вручную — 4 точки.' : 'Нейросеть нашла кухню, но не смогла уверенно определить нижние шкафы. Отметьте их вручную — 4 точки.');
      step('erase'); await paint();
      const clean = await AI.erase(S.img, geo.mask, geo.W, geo.H);
      if (tok !== S.run) return;
      step('build'); await paint();
      const k = S.W / geo.W, sq = q => q.map(([x, y]) => [x * k, y * k]);
      S.geo = { ring: geo.ringLum, segs: geo.segs.map(s => ({ len: s.len, sinkU: s.sinkU, hobU: s.hobU, topDepth: s.topDepth, top: s.top && sq(s.top), lower: sq(s.lower), uppers: s.uppers.map(u => ({ len: u.len, q: sq(u.q) })) })) };
      S.on.upper = S.geo.segs.some(s => s.uppers.length);
      setClean(clean); S.mode = 'auto'; setMode(); rebuild();
      ai.hidden = true; S.edit = false; showCmp(true);
    } catch (e) {
      console.error(e);
      if (tok === S.run) manual('Нейросеть не запустилась на этом устройстве — так бывает на старых телефонах. Отметьте шкафы вручную — 4 точки, или попробуйте с компьютера.');
    }
  }
  function manual(msg) {
    S.run++; ai.hidden = true;
    const copy = document.createElement('canvas'); copy.width = S.W; copy.height = S.H; copy.getContext('2d').drawImage(S.img, 0, 0); setClean(copy);
    S.mode = 'manual'; S.on.lower = true; S.on.upper = false;
    const w = $('.tr-warn'); w.hidden = !msg; w.textContent = msg || '';
    setMode(); setEdit(true); rebuild();
  }
  $('.tr-manual').addEventListener('click', () => manual(''));
  $('.tr-retry').addEventListener('click', () => runAuto());
  function setMode() {
    const auto = S.mode === 'auto', man = S.mode === 'manual';
    $('.tr-auto').hidden = !auto && S.mode !== 'busy'; $('.tr-man').hidden = !man;
    $('.tr-retry').hidden = !man;
    $$('.tr-toggles input[data-r]').forEach(i => { i.checked = !!S.on[i.dataset.r]; i.disabled = S.mode === 'busy'; });
    $('.tr-compare').hidden = !man || !S.edit; $('.tr-edit').hidden = !man || S.edit;
    root.classList.toggle('is-busy', S.mode === 'busy');
  }

  /* ручки-точки (ручной режим) */
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
    const show = S.mode === 'manual' && S.edit;
    let poly = '';
    ['lower', 'upper'].forEach(r => {
      handles[r].forEach((h, i) => { const [x, y] = S.q[r] ? S.q[r][i] : [0, 0]; h.style.transform = `translate(${ox + x * k}px, ${oy + y * k}px)`; h.hidden = !S.on[r] || !show; });
      if (S.on[r] && show && S.q[r]) poly += `<polygon class="tr-poly ${r}" points="${S.q[r].map(([x, y]) => `${ox + x * k},${oy + y * k}`).join(' ')}"/>`;
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

  /* ---------- освещение: сетка медиан яркости снимка (без старой кухни) ---------- */
  const GX = 10, GY = 5, lightCache = {};
  function lightMap(q) {
    const key = S.mode + q.map(p => p.map(Math.round).join()).join();
    if (lightCache[key]) return lightCache[key];
    if (!S.cleanData) S.cleanData = S.cleanCtx.getImageData(0, 0, S.W, S.H).data;
    const H = homography(q), img = S.cleanData, data = new Float32Array(GX * GY * 4), all = [];
    const lumAt = (x, y) => { x = clamp(x | 0, 0, S.W - 1); y = clamp(y | 0, 0, S.H - 1); const i = (y * S.W + x) * 4; return 0.2126 * Math.pow(img[i] / 255, 2.2) + 0.7152 * Math.pow(img[i + 1] / 255, 2.2) + 0.0722 * Math.pow(img[i + 2] / 255, 2.2); };
    for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
      const v = [];
      for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) { const [x, y] = mapQ(H, (gx + (a + 0.5) / 6) / GX, (gy + (b + 0.5) / 6) / GY); v.push(lumAt(x, y)); }
      v.sort((m, n) => m - n); const med = v[Math.floor(v.length * 0.6)];
      data.set([med, med, med, 1], (gy * GX + gx) * 4); all.push(med);
    }
    all.sort((m, n) => m - n);
    if (S.mode === 'auto' && S.geo) { // дорисованный фон бывает темнее реальной стены — берём только мягкий перепад
      const ring = S.geo.ring, k = clamp(ring / 0.42, 0.45, 1.6), m0 = Math.max(0.02, all[all.length >> 1]);
      for (let i = 0; i < GX * GY; i++) { const v = clamp(data[i * 4] / m0, 0.8, 1.2) * k * 0.42; data.set([v, v, v, 1], i * 4); }
    }
    const t = new THREE.DataTexture(data, GX, GY, THREE.RGBAFormat, THREE.FloatType);
    t.magFilter = t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
    return (lightCache[key] = { tex: t, med: Math.max(0.02, all[all.length >> 1]) });
  }

  /* ---------- части кухни ---------- */
  function specs() {
    const o = [];
    if (S.mode === 'auto' && S.geo) {
      S.geo.segs.forEach(s => {
        if (s.top) o.push({ kind: 'top', q: s.top, len: s.len, sinkU: s.sinkU, hobU: s.hobU, depth: s.topDepth });
        o.push({ kind: 'lower', q: s.lower, len: s.len });
        if (S.on.upper) s.uppers.forEach(u => o.push({ kind: 'upper', q: u.q, len: u.len }));
      });
    } else if (S.mode === 'manual') {
      if (S.on.upper) o.push({ kind: 'upper', man: 'upper', len: S.len });
      if (S.on.lower) o.push({ kind: 'lower', man: 'lower', len: S.len });
    }
    return o;
  }
  const texCache = new Map();
  function texFor(sp) {
    const key = [sp.kind, sp.len.toFixed(2), S.facade, S.color, S.top, S.handles, sp.sinkU, sp.hobU, sp.depth].join('|');
    if (texCache.has(key)) return texCache.get(key);
    const o = { facade: S.facade, color: S.color, top: S.top, handles: S.handles, len: sp.len, sinkU: sp.sinkU, hobU: sp.hobU, depth: sp.depth };
    const t = new THREE.CanvasTexture(sp.kind === 'top' ? topSurface(o) : elevation(sp.kind, o));
    t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; t.minFilter = THREE.LinearMipmapLinearFilter;
    if (texCache.size > 24) { const [k0, t0] = texCache.entries().next().value; t0.dispose(); texCache.delete(k0); }
    texCache.set(key, t); return t;
  }
  function clearRegions() { regions.forEach(r => { scene && scene.remove(r.mesh); r.mat.dispose(); }); regions = []; }
  const ORDER = { top: 1, lower: 2, upper: 3 };
  function rebuild() {
    if (!renderer) return;
    clearRegions();
    specs().forEach(sp => {
      const mat = new THREE.ShaderMaterial({
        uniforms: { elev: { value: texFor(sp) }, light: { value: null }, res: { value: new THREE.Vector2(S.W, S.H) }, hinv: { value: new THREE.Matrix3() }, ex: { value: 1 }, gloss: { value: 0 },
          shLen: { value: sp.kind === 'lower' ? 0.07 : sp.kind === 'upper' ? 0.3 : 0 }, shA: { value: sp.kind === 'lower' ? 0.5 : sp.kind === 'upper' ? 0.2 : 0 } },
        vertexShader: VERT, fragmentShader: REG_FRAG, transparent: true, depthTest: false, depthWrite: false
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); mesh.renderOrder = ORDER[sp.kind]; mesh.frustumCulled = false;
      scene.add(mesh); regions.push({ sp, mat, mesh });
    });
    render();
  }
  let pend = 0;
  function schedule() { if (!pend) pend = requestAnimationFrame(() => { pend = 0; render(); }); }
  function render() {
    if (!renderer || !S.img) return;
    const f = FACADES.find(x => x.id === S.facade), kind = f.colors[S.color][1];
    const gloss = kind === 'gloss' ? 1 : kind === 'paint' ? 0.35 : f.id === 'hpl' ? 0.2 : 0.08;
    regions.forEach(({ sp, mat }) => {
      const q = sp.man ? S.q[sp.man] : sp.q, U = mat.uniforms, L = lightMap(q);
      U.hinv.value.set(...invert3(homography(q))); U.light.value = L.tex;
      // авто: свет берём с «чистой» стены и пола (≈ альбедо 0,42); вручную — нормируем по старым фасадам
      U.ex.value = S.mode === 'auto' ? (sp.kind === 'top' ? 1.15 : 1) / 0.42 : 0.5 / L.med;
      U.gloss.value = sp.kind === 'top' ? 0.12 : gloss * 0.35;
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
    else if (b.dataset.h) { S.handles = b.dataset.h === '1'; $$('[data-h]').forEach(x => x.classList.toggle('is-on', x === b)); rebuild(); }
  });
  $$('.tr-toggles input').forEach(i => i.addEventListener('change', () => { S.on[i.dataset.r] = i.checked; setMode(); place(); rebuild(); }));
  const lenIn = $('.tr-len input');
  const setLenLabel = () => { $('.tr-len b').textContent = S.len.toFixed(1).replace('.', ',') + ' м'; };
  lenIn.addEventListener('input', () => { S.len = +lenIn.value; setLenLabel(); rebuild(); });

  /* было / стало */
  const cmpBox = $('.tr-cmp');
  function cmp() { before.style.clipPath = S.mode === 'busy' ? 'inset(0)' : S.edit ? 'inset(0 100% 0 0)' : `inset(0 ${(1 - S.cmp) * 100}% 0 0)`; cmpBox.style.setProperty('--x', S.cmp * 100 + '%'); }
  function showCmp(anim) { cmpBox.hidden = S.edit || S.mode === 'busy'; root.classList.toggle('is-cmp', !cmpBox.hidden); S.cmp = 0.5; cmp(); place(); if (anim && !cmpBox.hidden) animateCmp(); }
  function setEdit(on) { S.edit = on; setMode(); showCmp(!on); }
  function animateCmp() { // подсказка: шторка сама проезжает туда-обратно
    const t0 = performance.now();
    const st = now => { const t = (now - t0) / 2200; if (t > 1 || S.edit || S.drag) return; S.cmp = 0.5 + Math.sin(t * Math.PI * 2) * 0.35; cmp(); requestAnimationFrame(st); };
    requestAnimationFrame(st);
  }
  $('.tr-compare').addEventListener('click', () => setEdit(false));
  $('.tr-edit').addEventListener('click', () => setEdit(true));
  frame.addEventListener('pointerdown', e => {
    if (S.edit || S.mode === 'busy' || e.target.closest('.tr-h')) return;
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
  window.ASDTryon = { S, render, rebuild, setEdit, loadImage, runAuto, manual, DEMO };
}
