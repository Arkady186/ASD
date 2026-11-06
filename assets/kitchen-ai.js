/* ASD · автоматическая замена кухни на фото.
   Две бесплатные открытые нейросети работают прямо в браузере (onnxruntime-web, WASM):
   • SegFormer-B2 (ADE20K) — находит шкафы, столешницу, мойку, плиту, технику;
   • LaMa — стирает старую кухню и дорисовывает стену и пол за ней.
   Фото никуда не отправляется. Модели скачиваются один раз и хранятся в кэше браузера.
   По найденным границам строится геометрия новой кухни: столешница, фасады, верхние шкафы. */
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
const SEG = { url: 'https://huggingface.co/Xenova/segformer-b2-finetuned-ade-512-512/resolve/main/onnx/model_quantized.onnx', size: 28939869 };
const LAMA = { url: 'https://huggingface.co/opencv/inpainting_lama/resolve/main/inpainting_lama_2025jan.onnx', size: 92591623 };
export const MODELS_MB = Math.round((SEG.size + LAMA.size) / 1e6);

/* классы ADE20K */
const ID = { curtain: 18, blind: 63, wall: 0, floor: 3, windowpane: 8, cabinet: 10, plant: 17, shelf: 24, wardrobe: 35, box: 41, chest: 44, counter: 45, sink: 47, fridge: 50, flower: 66, countertop: 70, stove: 71, island: 73, towel: 81, tv: 89, bottle: 98, buffet: 99, washer: 107, basket: 112, oven: 118, microwave: 124, pot: 125, dishwasher: 129, hood: 133, vase: 135, tray: 137, plate: 142, glass: 147 };
const KITCHEN = ['cabinet', 'chest', 'counter', 'sink', 'fridge', 'countertop', 'stove', 'island', 'buffet', 'washer', 'oven', 'microwave', 'dishwasher', 'hood', 'shelf', 'wardrobe'].map(k => ID[k]);
const CLUTTER = ['bottle', 'pot', 'vase', 'plate', 'tray', 'glass', 'basket', 'box', 'towel', 'flower', 'plant', 'tv'].map(k => ID[k]);
const LOWER = ['cabinet', 'chest', 'counter', 'countertop', 'sink', 'stove', 'island', 'oven', 'dishwasher', 'washer', 'buffet'].map(k => ID[k]);
const TOP = ['countertop', 'counter', 'sink', 'stove'].map(k => ID[k]);
const NC = 150, G = 128;

/* ---------- загрузка ---------- */
let ortP = null, segP = null, lamaP = null;
function getOrt() {
  if (!ortP) ortP = import(ORT + 'ort.wasm.min.mjs').then(ort => {
    ort.env.wasm.wasmPaths = ORT;
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
    return ort;
  });
  return ortP;
}
async function fetchModel(m, onBytes) {
  let cache = null;
  try { cache = await caches.open('asd-ai-v1'); const hit = await cache.match(m.url); if (hit) { const b = new Uint8Array(await hit.arrayBuffer()); onBytes(m.size); return b; } } catch (e) { cache = null; }
  const r = await fetch(m.url);
  if (!r.ok) throw new Error('model ' + r.status);
  const total = +r.headers.get('content-length') || m.size, buf = new Uint8Array(total);
  let got = 0; const rd = r.body.getReader(), extra = [];
  for (;;) {
    const { done, value } = await rd.read(); if (done) break;
    if (got + value.length <= total) buf.set(value, got); else extra.push(value);
    got += value.length; onBytes(Math.min(got, m.size));
  }
  const out = extra.length ? (() => { const b = new Uint8Array(got); b.set(buf.subarray(0, total)); let o = total; extra.forEach(e => { b.set(e, o); o += e.length; }); return b; })() : buf.subarray(0, got);
  if (cache) cache.put(m.url, new Response(out.slice())).catch(() => {});
  onBytes(m.size);
  return out;
}
/** Загружает обе модели; onProgress(0..1). */
export function loadModels(onProgress = () => {}) {
  const got = { s: 0, l: 0 }, tick = () => onProgress((got.s + got.l) / (SEG.size + LAMA.size));
  const mk = (m, key) => getOrt().then(async ort => {
    const bytes = await fetchModel(m, n => { got[key] = n; tick(); });
    return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  });
  if (!segP) segP = mk(SEG, 's').catch(e => { segP = null; throw e; }); else got.s = SEG.size;
  if (!lamaP) lamaP = mk(LAMA, 'l').catch(e => { lamaP = null; throw e; }); else got.l = LAMA.size;
  tick();
  return Promise.all([segP, lamaP]);
}
const yieldUI = () => new Promise(r => { let done = false; const go = () => { if (!done) { done = true; setTimeout(r, 30); } }; requestAnimationFrame(go); setTimeout(go, 120); });

/* ---------- сегментация ---------- */
function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d', { willReadFrequently: true })]; }
async function segment(src) {
  const ort = await getOrt(), sess = await segP, S = 512;
  const [, g] = canvasOf(S, S); g.drawImage(src, 0, 0, S, S);
  const px = g.getImageData(0, 0, S, S).data, N = S * S, x = new Float32Array(3 * N);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) x[c * N + i] = (px[i * 4 + c] / 255 - mean[c]) / std[c];
  const out = await sess.run({ pixel_values: new ort.Tensor('float32', x, [1, 3, S, S]) });
  const L = out.logits.data, M = G * G;
  // вероятности групп классов на сетке 128×128
  const grp = { K: new Float32Array(M), C: new Float32Array(M), L: new Float32Array(M), T: new Float32Array(M), W: new Float32Array(M), cab: new Float32Array(M), sink: new Float32Array(M), stove: new Float32Array(M) };
  const isK = new Uint8Array(NC), isC = new Uint8Array(NC), isL = new Uint8Array(NC), isT = new Uint8Array(NC);
  KITCHEN.forEach(i => isK[i] = 1); CLUTTER.forEach(i => isC[i] = 1); LOWER.forEach(i => isL[i] = 1); TOP.forEach(i => isT[i] = 1);
  for (let p = 0; p < M; p++) {
    let mx = -1e9; for (let c = 0; c < NC; c++) { const v = L[c * M + p]; if (v > mx) mx = v; }
    let s = 0, k = 0, cl = 0, lo = 0, t = 0;
    for (let c = 0; c < NC; c++) { const e = Math.exp(L[c * M + p] - mx); s += e; if (isK[c]) k += e; if (isC[c]) cl += e; if (isL[c]) lo += e; if (isT[c]) t += e; }
    grp.K[p] = k / s; grp.C[p] = cl / s; grp.L[p] = lo / s; grp.T[p] = t / s;
    grp.W[p] = (Math.exp(L[ID.windowpane * M + p] - mx) + Math.exp(L[ID.curtain * M + p] - mx) + Math.exp(L[ID.blind * M + p] - mx)) / s;
    grp.cab[p] = Math.exp(L[ID.cabinet * M + p] - mx) / s;
    grp.sink[p] = Math.exp(L[ID.sink * M + p] - mx) / s;
    grp.stove[p] = (Math.exp(L[ID.stove * M + p] - mx) + Math.exp(L[ID.oven * M + p] - mx)) / s;
  }
  return grp;
}
/** билинейная выборка сетки 128×128 в координатах рабочего кадра W×H */
function sampler(arr, W, H) {
  return (x, y) => {
    const gx = Math.min(G - 1.001, Math.max(0, x / W * G - 0.5)), gy = Math.min(G - 1.001, Math.max(0, y / H * G - 0.5));
    const x0 = gx | 0, y0 = gy | 0, fx = gx - x0, fy = gy - y0, i = y0 * G + x0;
    return (arr[i] * (1 - fx) + arr[i + 1] * fx) * (1 - fy) + (arr[i + G] * (1 - fx) + arr[i + G + 1] * fx) * fy;
  };
}
function raster(arr, W, H, thr = 0.5) { const f = sampler(arr, W, H), m = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m[y * W + x] = f(x + 0.5, y + 0.5) > thr ? 1 : 0; return m; }

/* ---------- морфология ---------- */
function dilate(a, W, H, R) {
  if (R < 1) return a.slice();
  const b = new Uint8Array(W * H), c = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) { let last = -1e9; for (let x = 0; x < W; x++) { if (a[y * W + x]) last = x; if (x - last <= R) b[y * W + x] = 1; } last = 1e9; for (let x = W - 1; x >= 0; x--) { if (a[y * W + x]) last = x; if (last - x <= R) b[y * W + x] = 1; } }
  for (let x = 0; x < W; x++) { let last = -1e9; for (let y = 0; y < H; y++) { if (b[y * W + x]) last = y; if (y - last <= R) c[y * W + x] = 1; } last = 1e9; for (let y = H - 1; y >= 0; y--) { if (b[y * W + x]) last = y; if (last - y <= R) c[y * W + x] = 1; } }
  return c;
}
const erode = (a, W, H, R) => dilate(a.map(v => 1 - v), W, H, R).map(v => 1 - v);
function fillHoles(m, W, H) {
  const vis = new Uint8Array(W * H), st = [];
  for (let x = 0; x < W; x++) st.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) st.push(y * W, y * W + W - 1);
  while (st.length) { const i = st.pop(); if (vis[i] || m[i]) continue; vis[i] = 1; const x = i % W; if (x > 0) st.push(i - 1); if (x < W - 1) st.push(i + 1); if (i >= W) st.push(i - W); if (i < W * (H - 1)) st.push(i + W); }
  const o = m.slice(); for (let i = 0; i < W * H; i++) if (!vis[i]) o[i] = 1; return o;
}

/* ---------- прямые ---------- */
function fit(pts) { // устойчивая прямая y = a·x + b
  let P = pts.slice(), a = 0, b = 0;
  for (let it = 0; it < 3; it++) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0; const n = P.length;
    for (const [x, y] of P) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const d = n * sxx - sx * sx; a = Math.abs(d) < 1e-9 ? 0 : (n * sxy - sx * sy) / d; b = (sy - a * sx) / n;
    if (it < 2 && P.length > 10) { P = P.map(p => [p, Math.abs(p[1] - a * p[0] - b)]).sort((m, k) => m[1] - k[1]).slice(0, Math.ceil(P.length * 0.8)).map(p => p[0]); }
  }
  let e = 0; for (const [x, y] of P) e += (y - a * x - b) ** 2;
  return { a, b, rms: Math.sqrt(e / Math.max(1, P.length)), at: x => a * x + b };
}
function fitCols(cols) { return { back: fit(cols.map(c => [c.x, c.back])), front: fit(cols.map(c => [c.x, c.front])), floor: fit(cols.map(c => [c.x, c.floor])) }; }
const errOf = f => f.back.rms + f.floor.rms + 0.5 * f.front.rms;

/* ---------- главный анализ ---------- */
/**
 * Находит кухню на фото. Возвращает маску для стирания и геометрию новой кухни в координатах рабочего кадра.
 * @param {HTMLCanvasElement} img фото
 */
export async function analyze(img) {
  const g = await segment(img);
  await yieldUI();
  const k = 640 / Math.max(img.width, img.height), W = Math.round(img.width * k), H = Math.round(img.height * k);
  const K = raster(g.K, W, H), C = raster(g.C, W, H, 0.45);
  let area = 0; for (let i = 0; i < W * H; i++) area += K[i];
  if (area < W * H * 0.03) return { ok: false, reason: 'nokitchen' };
  // мелочи на столешнице и рядом с кухней (бутылки, посуда, полотенца) тоже стираем
  const near = dilate(K, W, H, Math.round(Math.max(W, H) * 0.04));
  let m = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) m[i] = K[i] || (C[i] && near[i]) ? 1 : 0;
  const R = Math.round(Math.max(W, H) * 0.03);
  m = erode(dilate(m, W, H, R), W, H, R);
  m = dilate(fillHoles(m, W, H), W, H, Math.round(Math.max(W, H) * 0.014));

  // колонки нижнего ряда: верх столешницы (у стены), передний край, линия пола
  const pL = sampler(g.L, W, H), pT = sampler(g.T, W, H), step = Math.max(1, Math.round(W / 200)), cols = [];
  const gap = Math.max(2, H * 0.015), minRun = H * 0.05; let stacked = 0, scanned = 0;
  for (let x = step / 2; x < W; x += step) {
    const runs = []; let s = -1, lastOn = -1e9;
    for (let y = 0; y < H; y++) {
      if (pL(x, y) > 0.5) { if (s < 0 || y - lastOn > gap) { if (s >= 0) runs.push([s, lastOn]); s = y; } lastOn = y; }
    }
    if (s >= 0) runs.push([s, lastOn]);
    const ok = runs.filter(r => r[1] - r[0] > minRun);
    if (!ok.length) continue;
    scanned++;
    const hasT = r => { for (let y = r[0]; y <= r[1]; y += 2) if (pT(x, y) > 0.5) return true; return false; };
    const withT = ok.filter(hasT), run = (withT.length ? withT : ok.filter(r => r[1] > H * 0.45)).pop();
    if (!run) continue;
    const [ya, yb] = run; let t0 = -1, t1 = -1;
    for (let y = Math.max(0, ya - H * 0.03 | 0); y <= yb; y++) {
      if (pT(x, y) > 0.5) { if (t0 < 0) t0 = y; t1 = y; } else if (t0 >= 0 && y - t1 > gap) break;
    }
    let tRuns = 0, inT = false, lastT = -1e9;
    for (let y = 0; y < H; y += 2) { const on = pT(x, y) > 0.5; if (on && !inT && y - lastT > H * 0.06) tRuns++; if (on) lastT = y; inT = on; }
    if (tRuns > 1) stacked++;
    const cap = ya + (yb - ya) * 0.35;
    const back = t0 >= 0 ? Math.min(ya, t0) : ya, front = t0 >= 0 ? Math.min(t1, cap) : ya;
    if (yb - front < H * 0.06) continue;
    cols.push({ x, back, front, floor: yb });
  }
  if (cols.length < 12) return { ok: false, reason: 'nolower', mask: m, W, H };

  // разбиваем на участки: по большим разрывам и по углу (излом линий)
  const parts = []; let cur = [cols[0]];
  for (let i = 1; i < cols.length; i++) { if (cols[i].x - cols[i - 1].x > W * 0.12) { parts.push(cur); cur = []; } cur.push(cols[i]); }
  parts.push(cur);
  const segs = [];
  for (const p of parts) {
    if (p.length < 10 || p[p.length - 1].x - p[0].x < W * 0.12) continue;
    const one = fitCols(p), e1 = errOf(one); let best = null;
    for (let q = 0.2; q <= 0.8; q += 0.04) {
      const i = Math.round(p.length * q), A = p.slice(0, i), B = p.slice(i);
      if (A.length < 8 || B.length < 8) continue;
      const fa = fitCols(A), fb = fitCols(B), e = (errOf(fa) * A.length + errOf(fb) * B.length) / p.length;
      const kink = Math.abs(fa.floor.a - fb.floor.a) + Math.abs(fa.back.a - fb.back.a);
      if (kink > 0.08 && (!best || e < best.e)) best = { e, i, fa, fb };
    }
    if (best && best.e < e1 * 0.55) {
      const xc = (p[best.i - 1].x + p[best.i].x) / 2;
      segs.push({ xa: p[0].x - step / 2, xb: xc, f: best.fa }, { xa: xc, xb: p[p.length - 1].x + step / 2, f: best.fb });
    } else segs.push({ xa: p[0].x - step / 2, xb: p[p.length - 1].x + step / 2, f: one });
  }
  if (!segs.length) return { ok: false, reason: 'nolower', mask: m, W, H };

  // геометрия каждого участка
  const fpx = 0.85 * Math.max(W, H), cx = W / 2, pW = sampler(g.W, W, H), pCab = sampler(g.cab, W, H);
  const len3d = (xa, ha, xb, hb, hm) => { const za = fpx * hm / ha, zb = fpx * hm / hb; return Math.hypot((xb - cx) * zb / fpx - (xa - cx) * za / fpx, zb - za); };
  const centroid = arr => { let sx = 0, n = 0; const f = sampler(arr, W, H); for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) { const v = f(x, y); if (v > 0.5) { sx += x; n++; } } return n > 20 ? sx / n : null; };
  const sinkX = centroid(g.sink), stoveX = centroid(g.stove);
  let upperArea = 0, upperProbe = 0;
  const out = segs.map(({ xa, xb, f }) => {
    xa = Math.max(0, xa); xb = Math.min(W, xb);
    const back = x => f.back.at(x), floor = x => f.floor.at(x);
    const front = x => Math.min(Math.max(f.front.at(x), back(x)), floor(x) - H * 0.05);
    const ppm = x => (floor(x) - front(x)) / 0.86, edge = x => 0.04 * ppm(x);
    const L = Math.min(8, Math.max(0.6, len3d(xa, floor(xa) - front(xa), xb, floor(xb) - front(xb), 0.86)));
    const seg = { len: L, lower: [[xa, front(xa) - edge(xa)], [xb, front(xb) - edge(xb)], [xb, floor(xb)], [xa, floor(xa)]], top: null, uppers: [] };
    // верх столешницы + пристенный бортик 4 см (закрывает стык со стеной)
    const up = x => back(x) - 0.045 * ppm(x);
    seg.top = [[xa, up(xa)], [xb, up(xb)], [xb, front(xb) - edge(xb)], [xa, front(xa) - edge(xa)]];
    seg.topDepth = Math.max(0.02, Math.min(0.6, ((front(xa) - edge(xa) - back(xa)) / ppm(xa) + (front(xb) - edge(xb) - back(xb)) / ppm(xb)) / 2 * 1.6));
    // где стояли мойка и плита — туда же ставим новые (доля длины)
    const u = x => (x == null || x < xa || x > xb) ? null : (x - xa) / (xb - xa);
    seg.sinkU = u(sinkX); seg.hobU = u(stoveX);
    // верхние шкафы: на стене над столешницей, обходя окна
    const pw = x => ppm(x) * 0.93, ub = x => back(x) - 0.55 * pw(x), ut = x => back(x) - 1.27 * pw(x);
    const stepX = Math.max(2, (xb - xa) / 60), free = [];
    for (let x = xa + stepX / 2; x < xb; x += stepX) {
      let w = 0, n = 0;
      for (let y = Math.max(0, ut(x)); y < Math.min(H, ub(x)); y += 3) { w += pW(x, y) > 0.3 ? 1 : 0; n++; upperProbe++; if (pCab(x, y) > 0.5) upperArea++; }
      free.push([x, n === 0 || w / n < 0.05]);
    }
    const pad = Math.max(1, Math.round(W * 0.03 / stepX)), blocked = free.map(f => !f[1]);
    free.forEach((f, i) => { for (let j = Math.max(0, i - pad); j <= Math.min(free.length - 1, i + pad); j++) if (blocked[j]) f[1] = false; });
    let s = null;
    const flush = xe => { if (s != null && xe - s > Math.max(W * 0.06, (xb - xa) * 0.1)) seg.uppers.push({ q: [[s, ut(s)], [xe, ut(xe)], [xe, ub(xe)], [s, ub(s)]], len: Math.min(8, Math.max(0.4, len3d(s, 0.72 * pw(s), xe, 0.72 * pw(xe), 0.72))) }); s = null; };
    free.forEach(([x, ok], i) => { if (ok && s == null) s = Math.max(xa, x - stepX / 2); if (!ok) flush(x - stepX / 2); if (i === free.length - 1) flush(xb); });
    return seg;
  });
  const [qc, qg] = canvasOf(W, H); qg.fillStyle = '#fff';
  const poly = q => { qg.beginPath(); q.forEach(([x, y], i) => i ? qg.lineTo(x, y) : qg.moveTo(x, y)); qg.closePath(); qg.fill(); };
  out.forEach(sg => { poly(sg.lower); if (sg.top) poly(sg.top); });
  const qd = qg.getImageData(0, 0, W, H).data, near2 = dilate(m, W, H, Math.round(Math.max(W, H) * 0.02));
  let nL = 0, cov = 0, nQ = 0, spill = 0;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const i = y * W + x, inQ = qd[i * 4] > 127, low = pL(x, y) > 0.5;
    if (low) { nL++; if (inQ) cov++; }
    if (inQ) { nQ++; if (!near2[i]) spill++; }
  }
  const segH = out.map(sg => { const [, , br, bl] = sg.lower, [tl, tr] = sg.lower; return [bl[1] - tl[1], br[1] - tr[1]]; });
  const conf = { coverage: nL ? cov / nL : 0, spill: nQ ? spill / nQ : 1, stacked: scanned ? stacked / scanned : 0, segs: out.length,
    ratio: Math.max(...segH.map(([a, b]) => Math.max(a, b) / Math.max(1, Math.min(a, b)))) };
  const sure = conf.coverage > 0.6 && conf.spill < 0.22 && conf.stacked < 0.2 && conf.ratio < 2.6 && out.length <= 3;
  if (!sure) return { ok: false, reason: 'complex', conf, mask: m, W, H };
  const [, rg] = canvasOf(W, H); rg.drawImage(img, 0, 0, W, H); const rd = rg.getImageData(0, 0, W, H).data;
  const ring = dilate(m, W, H, Math.round(Math.max(W, H) * 0.06)), lums = [];
  for (let i = 0; i < W * H; i += 2) if (ring[i] && !m[i]) lums.push(0.2126 * (rd[i * 4] / 255) ** 2.2 + 0.7152 * (rd[i * 4 + 1] / 255) ** 2.2 + 0.0722 * (rd[i * 4 + 2] / 255) ** 2.2);
  lums.sort((a, b) => a - b);
  const ringLum = lums.length ? lums[Math.floor(lums.length * 0.55)] : 0.3;
  return { ok: true, conf, mask: m, W, H, segs: out, ringLum, hadUpper: upperProbe > 0 && upperArea / upperProbe > 0.25 };
}

/* ---------- стирание старой кухни (LaMa) ---------- */
/**
 * @param {HTMLCanvasElement} img фото
 * @param {Uint8Array} mask маска W×H (1 — стереть)
 * @returns {Promise<HTMLCanvasElement>} фото того же размера, где кухня стёрта
 */
export async function erase(img, mask, W, H) {
  const ort = await getOrt(), sess = await lamaP, S = 512, N = S * S;
  const [mc, mg] = canvasOf(W, H), md = mg.createImageData(W, H);
  for (let i = 0; i < W * H; i++) { const v = mask[i] ? 255 : 0; md.data[i * 4] = md.data[i * 4 + 1] = md.data[i * 4 + 2] = v; md.data[i * 4 + 3] = 255; }
  mg.putImageData(md, 0, 0);
  const [, g] = canvasOf(S, S); g.drawImage(img, 0, 0, S, S); const px = g.getImageData(0, 0, S, S).data;
  const [, g2] = canvasOf(S, S); g2.drawImage(mc, 0, 0, S, S); const mp = g2.getImageData(0, 0, S, S).data;
  const x = new Float32Array(3 * N), mk = new Float32Array(N);
  for (let i = 0; i < N; i++) { const h = mp[i * 4] > 10; mk[i] = h ? 1 : 0; x[i] = h ? 0 : px[i * 4 + 2] / 255; x[N + i] = h ? 0 : px[i * 4 + 1] / 255; x[2 * N + i] = h ? 0 : px[i * 4] / 255; }
  await yieldUI();
  const o = await sess.run({ image: new ort.Tensor('float32', x, [1, 3, S, S]), mask: new ort.Tensor('float32', mk, [1, 1, S, S]) });
  const d = o.output.data, id = g.createImageData(S, S), cl = v => v < 0 ? 0 : v > 255 ? 255 : v;
  for (let i = 0; i < N; i++) { id.data[i * 4] = cl(d[2 * N + i]); id.data[i * 4 + 1] = cl(d[N + i]); id.data[i * 4 + 2] = cl(d[i]); id.data[i * 4 + 3] = 255; }
  g.putImageData(id, 0, 0);
  // склейка: вне маски — исходное фото в полном качестве, внутри — дорисованное, с мягким краем
  const Wf = img.width, Hf = img.height, [res, rg] = canvasOf(Wf, Hf), [lay, lg] = canvasOf(Wf, Hf);
  rg.drawImage(img, 0, 0);
  const blur = Math.max(2, Math.round(Wf / 300));
  // маска как альфа-канал (яркость → прозрачность)
  const [am, ag] = canvasOf(Wf, Hf); ag.drawImage(mc, 0, 0, Wf, Hf);
  const ad = ag.getImageData(0, 0, Wf, Hf); for (let i = 0; i < ad.data.length; i += 4) ad.data[i + 3] = ad.data[i]; ag.putImageData(ad, 0, 0);
  lg.imageSmoothingQuality = 'high'; lg.drawImage(g.canvas, 0, 0, Wf, Hf);
  lg.globalCompositeOperation = 'destination-in';
  try { lg.filter = `blur(${blur}px)`; } catch (e) {}
  lg.drawImage(am, 0, 0); lg.filter = 'none';
  rg.drawImage(lay, 0, 0);
  return res;
}
