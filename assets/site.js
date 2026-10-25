/* ЖК «Октябрь Парк»: сцены, видеопереходы, генплан и фасад с планировками */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const NS = 'http://www.w3.org/2000/svg';
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const once = (el, ev) => new Promise(r => el.addEventListener(ev, r, { once: true }));
  const within = (p, ms) => Promise.race([p, wait(ms)]);
  const fmt = n => n.toFixed(1).replace('.', ',');

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const phone = matchMedia('(max-width: 899px)');

  // Порядок сцен и видео между соседними; обратный путь: файл с суффиксом -back
  const SCENES = ['sky', 'kvartal', 'dom', 'holl'];
  const VIDEO = { 'sky>kvartal': 'sky-to-kvartal', 'kvartal>dom': 'kvartal-to-dom', 'dom>holl': 'dom-to-holl' };
  // Первый кадр перехода совпадает с кадром сцены, из которой он начинается
  const POSTER = {
    sky: 'assets/img/sky.jpg', kvartal: 'assets/img/kvartal.webp',
    dom: 'assets/img/dom.jpg', holl: 'assets/img/holl.jpg'
  };
  const CTA = {
    kvartal: ['Изучить дом поближе', '#dom', 'dom'],
    dom: ['Войти в холл', '#holl', 'holl'],
    holl: ['Записаться на экскурсию', 'tel:+78005550562', null]
  };

  const body = document.body;
  const scenes = Object.fromEntries(SCENES.map(id => [id, document.getElementById(id)]));
  const skyVideo = $('.sky-video');
  const transit = $('#transit');
  const dialog = $('#plan');
  let current = 'sky';
  let busy = false;

  /* ---------- Видео переходов ---------- */

  const videos = {};
  function videoFor(from, to) {
    const name = VIDEO[`${from}>${to}`] || `${VIDEO[`${to}>${from}`]}-back`;
    if (!videos[name]) {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.setAttribute('muted', '');
      v.setAttribute('playsinline', '');
      v.preload = 'none';
      v.poster = POSTER[from];
      v.src = `assets/video/${name}.mp4`;
      transit.appendChild(v);
      videos[name] = v;
    }
    return videos[name];
  }

  function warm(from, to) {
    const v = videoFor(from, to);
    if (v.preload !== 'auto') { v.preload = 'auto'; v.load(); }
    return v;
  }

  function warmAround(id) {
    const i = SCENES.indexOf(id);
    if (SCENES[i + 1]) warm(id, SCENES[i + 1]);
    if (SCENES[i - 1]) warm(id, SCENES[i - 1]);
  }

  const firstFrame = v => new Promise(r => {
    if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(() => r());
    else once(v, 'playing').then(() => setTimeout(r, 40));
    setTimeout(r, 900);
  });

  /* ---------- Фото-«пластины»: на весь экран или вписаны в область ---------- */

  const plates = Object.fromEntries($$('.plate').map(el => [el.closest('.view').id, {
    el, w: +el.dataset.w, h: +el.dataset.h, t: null
  }]));
  const css = t => `translate(${t.x}px, ${t.y}px) scale(${t.s})`;
  // Размер окна берём у слоя переходов: он всегда растянут на весь экран
  const vp = () => ({ w: transit.clientWidth || innerWidth, h: transit.clientHeight || innerHeight });

  function coverT(p) {
    const { w, h } = vp();
    const s = Math.max(w / p.w, h / p.h);
    return { s, x: (w - p.w * s) / 2, y: (h - p.h * s) / 2 };
  }

  // Дом целиком (в пикселях исходного фото) вписывается справа от панели,
  // а фото обрезается рамкой с равными полями
  const HOUSE_BOX = [200, 95, 2530, 1445];
  const domMedia = $('.view-dom .media');
  function domFrame(p) {
    const panelW = $('.view-dom .panel').offsetWidth;
    const m = 32, top = 88, air = 40;
    const { w: vw, h: vh } = vp();
    const rect = { x: panelW + m, y: top, w: vw - panelW - m * 2, h: vh - top - m };
    const [x0, y0, x1, y1] = HOUSE_BOX;
    const s = Math.min((rect.w - air * 2) / (x1 - x0), rect.h / (y1 - y0));
    const t = {
      s,
      x: rect.x + (rect.w - (x1 - x0) * s) / 2 - x0 * s,
      y: rect.y + (rect.h - (y1 - y0) * s) / 2 - y0 * s
    };
    const top0 = Math.max(rect.y, t.y), bottom0 = Math.min(rect.y + rect.h, t.y + p.h * s);
    const clip = `inset(${top0}px ${vw - rect.x - rect.w}px ${vh - bottom0}px ${rect.x}px)`;
    return { t, clip };
  }
  const domFitT = p => domFrame(p).t;
  function frameDom(open) {
    domMedia.style.clipPath = phone.matches ? '' : open ? domFrame(plates.dom).clip : 'inset(0px 0px 0px 0px)';
  }

  function setT(p, t) { p.t = t; p.el.style.transform = css(t); }

  function movePlate(p, to, dur) {
    if (phone.matches || !p.t) return Promise.resolve();
    const from = p.t;
    setT(p, to);
    if (reduced.matches) return Promise.resolve();
    return p.el.animate([{ transform: css(from) }, { transform: css(to) }],
      { duration: dur, easing: 'cubic-bezier(.65,0,.35,1)' }).finished.catch(() => {});
  }

  function layout() {
    Object.entries(plates).forEach(([id, p]) => {
      if (phone.matches) {
        p.el.style.transform = p.el.style.width = p.el.style.height = '';
        p.t = null;
        return;
      }
      p.el.style.width = `${p.w}px`;
      p.el.style.height = `${p.h}px`;
      const open = id === 'dom' && scenes.dom.classList.contains('is-open');
      setT(p, open ? domFitT(p) : coverT(p));
    });
    frameDom(scenes.dom.classList.contains('is-open'));
  }

  function centerMedia(id, frac) {
    const m = $('.media', scenes[id]);
    requestAnimationFrame(() => {
      m.scrollLeft = m.scrollWidth * frac - m.clientWidth / 2;
      if (reduced.matches) return;
      // Короткий сдвиг туда и обратно подсказывает, что фото листается вбок
      setTimeout(() => m.scrollBy({ left: 64, behavior: 'smooth' }), 900);
      setTimeout(() => m.scrollBy({ left: -64, behavior: 'smooth' }), 1400);
    });
  }

  /* ---------- Сцены ---------- */

  function setActive(id, cut) {
    SCENES.forEach(s => {
      const el = scenes[s];
      const on = s === id;
      el.classList.toggle('is-cut', !!cut);
      el.classList.toggle('is-active', on);
      el.inert = !on;
      el.setAttribute('aria-hidden', String(!on));
    });
    if (cut) requestAnimationFrame(() => requestAnimationFrame(() =>
      SCENES.forEach(s => scenes[s].classList.remove('is-cut'))));
    current = id;
    body.dataset.view = id;
    $$('.nav a[data-go]').forEach(a => a.setAttribute('aria-current', String(a.dataset.go === id)));
    const c = CTA[id];
    if (c) {
      const a = $('[data-bar-cta]');
      a.textContent = c[0];
      a.href = c[1];
      if (c[2]) a.dataset.go = c[2]; else delete a.dataset.go;
    }
    if (id === 'sky' && !reduced.matches) skyVideo.play().catch(() => {}); else skyVideo.pause();
    history.replaceState(null, '', id === 'sky' ? location.pathname + location.search : `#${id}`);
  }

  function arrive(id) {
    const el = scenes[id];
    el.classList.remove('is-leaving', 'is-in');
    void el.offsetWidth;
    el.classList.add('is-in');
    if (phone.matches) {
      el.scrollTop = 0;
      if (id === 'kvartal') centerMedia(id, 970 / 1920);
      if (id === 'dom') centerMedia(id, 0.5);
    }
    if (id === 'dom') {
      el.classList.add('is-open');
      frameDom(true);
      movePlate(plates.dom, domFitT(plates.dom), 1000);
    }
    warmAround(id);
  }

  async function leave(id) {
    hideSpot(true);
    clearFlat();
    scenes[id].classList.add('is-leaving');
    if (id === 'dom') {
      scenes.dom.classList.remove('is-open');
      frameDom(false);
      await Promise.all([movePlate(plates.dom, coverT(plates.dom), 900), wait(reduced.matches ? 0 : 950)]);
    } else {
      await wait(reduced.matches ? 0 : 300);
    }
  }

  async function play(from, to, rate, last) {
    if (reduced.matches) { setActive(to); return; }
    const v = warm(from, to);
    if (v.readyState < 2) await within(once(v, 'canplay'), 7000);
    let ok = v.readyState >= 2;
    if (ok) {
      v.currentTime = 0;
      v.playbackRate = rate;
      ok = await v.play().then(() => true, () => false);
    }
    if (!ok) { setActive(to); await wait(650); return; }   // нет видео: мягкая смена кадра

    await firstFrame(v);
    v.classList.remove('is-out');
    v.classList.add('is-on');
    await wait(320);
    $$('video.is-on', transit).forEach(o => { if (o !== v) { o.classList.remove('is-on'); o.pause(); } });
    setActive(to, true);
    await within(once(v, 'ended'), ((v.duration || 5.1) / rate) * 1000 + 1500);
    if (last) {
      v.classList.add('is-out');
      v.classList.remove('is-on');
      await wait(500);
    }
  }

  async function go(target) {
    if (target === 'next') target = SCENES[SCENES.indexOf(current) + 1];
    if (target === 'prev') target = SCENES[SCENES.indexOf(current) - 1];
    if (!target || !scenes[target] || target === current || busy) return;
    busy = true;
    body.classList.add('is-moving');
    try {
      const a = SCENES.indexOf(current), b = SCENES.indexOf(target), dir = Math.sign(b - a);
      const rate = Math.abs(b - a) > 1 ? 1.9 : 1;
      await leave(current);
      for (let i = a; i !== b; i += dir) await play(SCENES[i], SCENES[i + dir], rate, i + dir === b);
      arrive(target);
    } finally {
      busy = false;
      body.classList.remove('is-moving');
    }
  }

  /* ---------- Генплан: объекты квартала ---------- */

  // Координаты в пикселях фото квартала 1920×1094
  const PLACES = {
    school: {
      name: 'Школа на 2 500 мест', img: 'school.webp',
      text: 'Своя школа с бассейном и оборудованными классами внутри квартала.',
      polys: ['545,385 600,350 640,330 700,345 760,383 772,420 735,470 690,500 640,478 590,440 548,410']
    },
    kindergarten: {
      name: 'Три детских сада', img: 'kindergarten.webp',
      text: '765 мест в трёх детских садах на территории ЖК.',
      polys: ['806,553 830,543 890,550 945,578 946,610 900,614 850,600 806,588',
        '1200,392 1222,380 1290,388 1330,402 1326,430 1270,432 1205,412']
    },
    sport: {
      name: 'Стадион и спорт', img: 'sport.webp',
      text: 'Стадион, спортивные площадки с тренажёрами и спортивно-оздоровительный комплекс.',
      polys: ['880,440 893,385 935,352 1000,345 1048,362 1058,395 1040,450 1000,488 950,497 900,485',
        '748,330 772,312 840,307 905,325 910,352 885,368 820,370 758,350',
        '842,490 878,473 988,497 988,545 953,562 842,532']
    },
    park: {
      name: 'Парк на 1 гектар', img: 'park.webp', dot: [1215, 800],
      text: 'Аллеи, велодорожки и тенистые скверы в нескольких шагах от подъезда.',
      polys: ['930,745 990,640 1060,610 1160,640 1300,690 1450,760 1600,830 1700,885 1660,960 1450,935 1250,905 1050,885 960,830']
    },
    church: {
      name: 'Храм', crop: [1432, 458],
      text: 'В квартале запланирован храм.',
      polys: ['1380,450 1405,428 1432,420 1458,432 1482,457 1478,492 1430,492 1386,475']
    },
    playground: {
      name: 'Детские площадки', img: 'playground.webp',
      text: 'Детские и спортивные площадки во дворах.',
      polys: ['612,785 640,768 690,775 688,805 655,815 615,805']
    },
    parking: {
      name: 'Паркинг на 672 места', img: 'parking.webp',
      text: 'Подземный паркинг на 672 машино-места и наземные парковки.',
      polys: ['668,690 710,664 768,688 758,745 720,770 676,748']
    },
    cafe: {
      name: 'Кафе и магазины', img: 'cafe.webp',
      text: 'Помещения для кафе, магазинов и аптек на первых этажах домов.',
      polys: ['1110,600 1120,520 1230,380 1265,395 1255,470 1150,610']
    }
  };

  function centroid(points) {
    const p = points.split(' ').map(s => s.split(',').map(Number));
    return [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length];
  }

  function buildSpots() {
    const g = $('#spots');
    Object.entries(PLACES).forEach(([id, p]) => {
      const sg = document.createElementNS(NS, 'g');
      sg.setAttribute('class', 'spot');
      sg.setAttribute('tabindex', '0');
      sg.setAttribute('role', 'button');
      sg.setAttribute('aria-label', p.name);
      sg.dataset.id = id;
      p.polys.forEach(pts => {
        const pg = document.createElementNS(NS, 'polygon');
        pg.setAttribute('points', pts);
        sg.appendChild(pg);
      });
      const [cx, cy] = p.dot || centroid(p.polys[0]);
      ['pulse', 'dot'].forEach(cls => {
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('class', cls);
        c.setAttribute('cx', cx);
        c.setAttribute('cy', cy);
        c.setAttribute('r', 11);
        sg.appendChild(c);
      });
      g.appendChild(sg);

      sg.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') showSpot(id); });
      sg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hideSpotSoon(); });
      sg.addEventListener('focus', () => showSpot(id));
      sg.addEventListener('blur', () => hideSpotSoon());
      sg.addEventListener('click', () => showSpot(id));
      sg.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showSpot(id); }
      });
    });

    $$('.places button').forEach(b => {
      const id = b.dataset.spot;
      b.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') showSpot(id); });
      b.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hideSpotSoon(); });
      b.addEventListener('focus', () => showSpot(id));
      b.addEventListener('blur', () => hideSpotSoon());
      b.addEventListener('click', () => {
        if (phone.matches) {
          const m = $('.media', scenes.kvartal);
          const [cx] = PLACES[id].dot || centroid(PLACES[id].polys[0]);
          const k = plates.kvartal.el.clientHeight / 1094;
          m.scrollTo({ left: cx * k - m.clientWidth / 2, behavior: reduced.matches ? 'auto' : 'smooth' });
          m.scrollIntoView({ block: 'start', behavior: reduced.matches ? 'auto' : 'smooth' });
        }
        showSpot(id);
      });
    });

    document.addEventListener('pointerdown', e => {
      if (phone.matches && !e.target.closest('.spot, .places, .pop')) hideSpot();
    });
  }

  const pop = $('#pop');
  let spotTimer = 0;

  function showSpot(id) {
    clearTimeout(spotTimer);
    const p = PLACES[id];
    $('.map').classList.add('has-spot');
    $('#spot-holes').innerHTML = p.polys.map(pt => `<polygon points="${pt}"/>`).join('');
    $$('.spot').forEach(s => s.classList.toggle('is-on', s.dataset.id === id));
    $$('.places button').forEach(b => b.classList.toggle('is-on', b.dataset.spot === id));

    $('.pop-title', pop).textContent = p.name;
    $('.pop-text', pop).textContent = p.text;
    pop.hidden = false;
    const img = $('.pop-img', pop);
    if (p.img) {
      img.style.backgroundImage = `url("assets/img/places/${p.img}")`;
      img.style.backgroundSize = 'cover';
      img.style.backgroundPosition = 'center';
    } else {
      // Нет отдельного рендера: показываем этот участок генплана крупно
      const k = 2.2, bw = img.clientWidth, bh = bw * 9 / 16;
      img.style.backgroundImage = 'url("assets/img/kvartal.webp")';
      img.style.backgroundSize = `${1920 * k}px auto`;
      img.style.backgroundPosition = `${-(p.crop[0] * k - bw / 2)}px ${-(p.crop[1] * k - bh / 2)}px`;
    }

    if (!phone.matches) {
      const r = $(`.spot[data-id="${id}"]`).getBoundingClientRect();
      const L = $('.view-kvartal .side-left').getBoundingClientRect().right + 16;
      const R = $('.view-kvartal .side-right').getBoundingClientRect().left - 16;
      // Сбоку от объекта, иначе над или под ним — так, чтобы не закрыть сам объект
      const pw = pop.offsetWidth, ph = pop.offsetHeight, gap = 24, top = 88, bottom = innerHeight - 24;
      const clampY = y => Math.max(top, Math.min(bottom - ph, y));
      const clampX = x => Math.max(L, Math.min(R - pw, x));
      let x, y;
      if (r.right + gap + pw <= R) { x = r.right + gap; y = clampY(r.top + r.height / 2 - ph / 2); }
      else if (r.left - gap - pw >= L) { x = r.left - gap - pw; y = clampY(r.top + r.height / 2 - ph / 2); }
      else if (r.bottom + gap + ph <= bottom) { x = clampX(r.left + r.width / 2 - pw / 2); y = r.bottom + gap; }
      else { x = clampX(r.left + r.width / 2 - pw / 2); y = clampY(r.top - gap - ph); }
      pop.style.left = `${x}px`;
      pop.style.top = `${y}px`;
    }
    requestAnimationFrame(() => pop.classList.add('is-shown'));
  }

  function hideSpot(now) {
    clearTimeout(spotTimer);
    $('.map').classList.remove('has-spot');
    $$('.spot.is-on, .places button.is-on').forEach(s => s.classList.remove('is-on'));
    pop.classList.remove('is-shown');
    spotTimer = setTimeout(() => { pop.hidden = true; }, now ? 0 : 260);
  }

  function hideSpotSoon() {
    clearTimeout(spotTimer);
    spotTimer = setTimeout(() => {
      if (document.activeElement?.closest?.('.spot, .places')) return;
      hideSpot();
    }, 140);
  }

  /* ---------- Фасад и планировки ---------- */

  // Квартиры по вертикальным секциям фасада (x в пикселях фото 2752×1536)
  const COLS = [
    [217, 518, 'k3'], [518, 682, 'k1'], [682, 837, 's'], [837, 1011, 'k2'],
    [1011, 1151, 'k1'], [1151, 1372, 'e2'], [1372, 1587, 'e2'], [1587, 1723, 'k1'],
    [1723, 1912, 'k2'], [1912, 2052, 's'], [2052, 2220, 'k1'], [2220, 2514, 'k3']
  ];
  const TOP_FLOOR = 18, LOW_FLOOR = 2, FLOOR_TOP = 169, FLOOR_H = 69.9;
  const floorY = f => FLOOR_TOP + (TOP_FLOOR - f) * FLOOR_H;

  // Ориентировочные планировки: комнаты [название, x, y, ширина, глубина, окно на фасад] в метрах
  const TYPES = {
    s: {
      rooms: 0, title: 'Студия', from: 'от 2,9 млн ₽', W: 4.2, D: 6.0, loggia: [0, 6.0, 4.2, 1.0],
      list: [['Санузел', 0, 0, 1.7, 2.0], ['Прихожая', 1.7, 0, 2.5, 2.0], ['Кухня-гостиная', 0, 2.0, 4.2, 4.0, 1]]
    },
    k1: {
      rooms: 1, title: '1-комнатная', from: 'от 4,4 млн ₽', W: 6.0, D: 6.4, loggia: [2.3, 6.4, 3.7, 1.0],
      list: [['Санузел', 0, 0, 2.0, 2.0], ['Прихожая', 2.0, 0, 4.0, 1.6], ['Кухня', 0, 2.0, 2.3, 4.4, 1],
        ['Комната', 2.3, 1.6, 3.7, 4.8, 1]]
    },
    e2: {
      rooms: 2, title: '2-комнатная, евро', from: 'от 5,5 млн ₽', W: 7.0, D: 6.6, loggia: [0, 6.6, 4.2, 1.0],
      list: [['Санузел', 0, 0, 2.0, 2.1], ['Прихожая', 2.0, 0, 2.6, 2.1], ['Гардеробная', 4.6, 0, 2.4, 2.1],
        ['Кухня-гостиная', 0, 2.1, 4.2, 4.5, 1], ['Спальня', 4.2, 2.1, 2.8, 4.5, 1]]
    },
    k2: {
      rooms: 2, title: '2-комнатная', from: 'от 5,5 млн ₽', W: 8.6, D: 6.6, loggia: [2.8, 6.6, 3.4, 1.0],
      list: [['Санузел', 0, 0, 2.0, 2.2], ['Прихожая', 2.0, 0, 4.2, 2.2], ['Гардеробная', 6.2, 0, 2.4, 2.2],
        ['Кухня', 0, 2.2, 2.8, 4.4, 1], ['Гостиная', 2.8, 2.2, 3.4, 4.4, 1], ['Спальня', 6.2, 2.2, 2.4, 4.4, 1]]
    },
    k3: {
      rooms: 3, title: '3-комнатная', from: 'от 7,7 млн ₽', W: 12.0, D: 6.8, loggia: [2.8, 6.8, 3.6, 1.0],
      list: [['Санузел', 0, 0, 1.8, 2.2], ['Ванная', 1.8, 0, 1.8, 2.2], ['Прихожая', 3.6, 0, 5.2, 2.2],
        ['Гардеробная', 8.8, 0, 3.2, 2.2], ['Кухня', 0, 2.2, 2.8, 4.6, 1], ['Гостиная', 2.8, 2.2, 3.6, 4.6, 1],
        ['Спальня', 6.4, 2.2, 2.8, 4.6, 1], ['Детская', 9.2, 2.2, 2.8, 4.6, 1]]
    }
  };
  const area = r => Math.round(r[3] * r[4] * 10) / 10;
  const total = t => Math.round(t.list.reduce((a, r) => a + area(r), 0) * 10) / 10;

  // Чертёж во всю доступную площадь; масштабная линейка показывает реальный размер
  function planSVG(t, mirror, bw, bh) {
    const depth = t.D + (t.loggia ? t.loggia[3] : 0);
    const S = Math.min(95, (bw - 24) / t.W, (bh - 84) / depth);
    const ox = (bw - t.W * S) / 2, oy = Math.max(8, (bh - 84 - depth * S) / 2);
    const X = (x, w) => ox + (mirror ? t.W - x - w : x) * S;
    const big = S > 52;
    let out = `<svg viewBox="0 0 ${bw} ${bh}" role="img" aria-label="Планировка: ${t.title}, ${fmt(total(t))} м²">`;
    if (t.loggia) {
      const [lx, ly, lw, lh] = t.loggia;
      out += `<rect x="${X(lx, lw)}" y="${oy + ly * S}" width="${lw * S}" height="${lh * S}" fill="#dcd8cc" stroke="#1c1c1c" stroke-width="3"/>`;
      out += `<text x="${X(lx, lw) + lw * S / 2}" y="${oy + (ly + lh / 2) * S + 5}" text-anchor="middle" font-size="14" fill="#1c1c1c">Лоджия</text>`;
    }
    t.list.forEach(r => {
      const [, x, y, w, h] = r;
      out += `<rect x="${X(x, w)}" y="${oy + y * S}" width="${w * S}" height="${h * S}" fill="#ece9e1" stroke="#1c1c1c" stroke-width="4"/>`;
    });
    out += `<rect x="${ox}" y="${oy}" width="${t.W * S}" height="${t.D * S}" fill="none" stroke="#1c1c1c" stroke-width="10"/>`;
    t.list.forEach(r => {
      const [name, x, y, w, h, win] = r;
      const cx = X(x, w) + w * S / 2, cy = oy + (y + h / 2) * S;
      const fs = big && w >= 2.1 ? 16 : 13;
      if (win) out += `<rect x="${X(x, w) + w * S * 0.22}" y="${oy + t.D * S - 6}" width="${w * S * 0.56}" height="12" fill="#8fa68e"/>`;
      out += `<text x="${cx}" y="${cy - 3}" text-anchor="middle" font-size="${fs}" fill="#1c1c1c">${name}</text>`;
      out += `<text x="${cx}" y="${cy + fs + 5}" text-anchor="middle" font-size="${fs + 4}" font-weight="600" fill="#1c1c1c">${fmt(area(r))}</text>`;
    });
    const by = oy + depth * S + 44;
    out += `<rect x="${ox}" y="${by - 12}" width="${S}" height="6" fill="#1c1c1c"/>`;
    out += `<text x="${ox + S + 10}" y="${by - 5}" font-size="14" fill="#1c1c1c">1 м</text>`;
    out += `<rect x="${ox}" y="${by + 10}" width="22" height="10" fill="#8fa68e"/>`;
    out += `<text x="${ox + 32}" y="${by + 20}" font-size="14" fill="#1c1c1c">окна на этот фасад</text>`;
    return `${out}</svg>`;
  }

  const facade = $('#facade');
  const tip = $('#tip');
  const hole = $('#flat-hole');
  let sel = null;          // { c, f }: квартира под курсором или с клавиатуры
  let roomsFilter = null;

  function buildFlats() {
    let html = '';
    for (let f = TOP_FLOOR; f >= LOW_FLOOR; f--) {
      COLS.forEach(([x0, x1], c) => {
        html += `<rect class="flat" data-c="${c}" data-f="${f}" x="${x0}" y="${floorY(f).toFixed(1)}" width="${x1 - x0}" height="${FLOOR_H}"/>`;
      });
    }
    $('#flats').innerHTML = html;

    facade.addEventListener('pointermove', e => {
      const r = e.target.closest('.flat');
      if (!r) return clearFlat();
      setFlat(+r.dataset.c, +r.dataset.f, e);
    });
    facade.addEventListener('pointerleave', () => { if (document.activeElement !== facade) clearFlat(); });
    facade.addEventListener('click', e => {
      const r = e.target.closest('.flat');
      if (r) openPlan(+r.dataset.c, +r.dataset.f);
    });
    facade.addEventListener('focus', () => { if (!sel) setFlat(5, 10); });
    facade.addEventListener('blur', () => clearFlat());
    facade.addEventListener('keydown', e => {
      if (!sel) setFlat(5, 10);
      const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
      if (moves[e.key]) {
        e.preventDefault();
        const c = Math.max(0, Math.min(COLS.length - 1, sel.c + moves[e.key][0]));
        const f = Math.max(LOW_FLOOR, Math.min(TOP_FLOOR, sel.f + moves[e.key][1]));
        setFlat(c, f);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openPlan(sel.c, sel.f);
      }
    });

    $$('.rooms button').forEach(b => b.addEventListener('click', () => {
      const n = +b.dataset.rooms;
      roomsFilter = roomsFilter === n ? null : n;
      $$('.rooms button').forEach(x => x.setAttribute('aria-pressed', String(+x.dataset.rooms === roomsFilter)));
      $$('.flat').forEach(r => r.classList.toggle('is-match',
        roomsFilter !== null && TYPES[COLS[r.dataset.c][2]].rooms === roomsFilter));
    }));
  }

  function setFlat(c, f, e) {
    const changed = !sel || sel.c !== c || sel.f !== f;
    sel = { c, f };
    const r = $(`.flat[data-c="${c}"][data-f="${f}"]`);
    if (changed) {
      $$('.flat.is-on').forEach(x => x.classList.remove('is-on'));
      r.classList.add('is-on');
      ['x', 'y', 'width', 'height'].forEach(a => hole.setAttribute(a, r.getAttribute(a)));
      facade.classList.add('has-flat');
      const t = TYPES[COLS[c][2]];
      tip.innerHTML = `<strong>${t.title}</strong> · ${fmt(total(t))} м² · ${f} этаж`;
    }
    if (phone.matches) return;
    tip.hidden = false;
    const box = r.getBoundingClientRect();
    const px = e ? e.clientX : box.right;
    const py = e ? e.clientY : box.top;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = px + 18, y = py - th - 14;
    if (x + tw > innerWidth - 16) x = px - tw - 18;
    if (y < 80) y = py + 22;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }

  function clearFlat() {
    if (dialog.open) return;
    sel = null;
    $$('.flat.is-on').forEach(x => x.classList.remove('is-on'));
    facade.classList.remove('has-flat');
    tip.hidden = true;
  }

  function openPlan(c, f) {
    sel = { c, f };
    tip.hidden = true;
    if (!dialog.open) dialog.showModal();
    renderPlan();
  }

  function renderPlan() {
    const { c, f } = sel;
    const t = TYPES[COLS[c][2]];
    $('#plan-title').textContent = t.title;
    $('#plan-floor').textContent = `${fmt(total(t))} м² · ${f} этаж из ${TOP_FLOOR}`;
    $('#plan-price').textContent = t.from;
    let rows = t.list.map(r => `<tr><td>${r[0]}</td><td>${fmt(area(r))} м²</td></tr>`).join('');
    if (t.loggia) rows += `<tr><td>Лоджия, вне общей площади</td><td>${fmt(t.loggia[2] * t.loggia[3])} м²</td></tr>`;
    rows += `<tr class="total"><td>Общая площадь</td><td>${fmt(total(t))} м²</td></tr>`;
    $('#plan-rooms').innerHTML = rows;
    const draw = $('#plan-draw');
    draw.innerHTML = '';
    const cs = getComputedStyle(draw);
    const bw = draw.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const bh = draw.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    draw.innerHTML = planSVG(t, c >= COLS.length / 2, Math.max(260, bw), Math.max(260, bh));
    dialog.querySelector('[data-step="left"]').disabled = c === 0;
    dialog.querySelector('[data-step="right"]').disabled = c === COLS.length - 1;
    dialog.querySelector('[data-step="up"]').disabled = f === TOP_FLOOR;
    dialog.querySelector('[data-step="down"]').disabled = f === LOW_FLOOR;
    setFlat(c, f);
    tip.hidden = true;
  }

  $$('.plan-nav button').forEach(b => b.addEventListener('click', () => {
    const d = { left: [-1, 0], right: [1, 0], up: [0, 1], down: [0, -1] }[b.dataset.step];
    sel = {
      c: Math.max(0, Math.min(COLS.length - 1, sel.c + d[0])),
      f: Math.max(LOW_FLOOR, Math.min(TOP_FLOOR, sel.f + d[1]))
    };
    renderPlan();
  }));
  $('#plan-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { clearFlat(); if (!phone.matches) facade.focus({ preventScroll: true }); });

  /* ---------- Управление: ссылки, колесо, клавиши ---------- */

  document.addEventListener('click', e => {
    const a = e.target.closest('[data-go]');
    if (!a) return;
    e.preventDefault();
    go(a.dataset.go);
  });

  function canScroll(el, dy) {
    for (; el && el !== document.body; el = el.parentElement) {
      if (el.scrollHeight <= el.clientHeight + 2) continue;
      const oy = getComputedStyle(el).overflowY;
      if (oy !== 'auto' && oy !== 'scroll') continue;
      if (dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
      if (dy < 0 && el.scrollTop > 0) return true;
    }
    return false;
  }

  let acc = 0, accAt = 0, wentAt = 0;
  addEventListener('wheel', e => {
    if (phone.matches || busy || dialog.open || canScroll(e.target, e.deltaY)) return;
    const now = performance.now();
    if (now - accAt > 260) acc = 0;
    accAt = now;
    acc += e.deltaY;
    if (now - wentAt < 1400) return;
    if (Math.abs(acc) > 80) {
      wentAt = now;
      go(acc > 0 ? 'next' : 'prev');
      acc = 0;
    }
  }, { passive: true });

  addEventListener('keydown', e => {
    if (phone.matches || busy || dialog.open || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target.closest('input, textarea, select, .facade, .spot')) return;
    if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); go('next'); }
    if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); go('prev'); }
  });

  addEventListener('hashchange', () => {
    const id = location.hash.slice(1) || 'sky';
    if (SCENES.includes(id)) go(id);
  });

  let resizeT = 0, lastSize = '';
  function onResize() {
    const { w, h } = vp(), size = `${w}x${h}`;
    if (size === lastSize) return;
    lastSize = size;
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { hideSpot(true); clearFlat(); layout(); if (dialog.open) renderPlan(); }, 80);
  }
  addEventListener('resize', onResize);
  // Слой переходов всегда равен окну: ловит и те смены размера, о которых resize не сообщает
  new ResizeObserver(onResize).observe(transit);
  phone.addEventListener('change', layout);

  /* ---------- Старт ---------- */

  $$('.view').forEach(sc => $$('[data-in]', sc).forEach((el, i) => el.style.setProperty('--i', i)));
  buildSpots();
  buildFlats();
  const start = SCENES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'sky';
  if (start === 'dom') scenes.dom.classList.remove('is-open');
  lastSize = `${vp().w}x${vp().h}`;
  layout();
  setActive(start, true);
  arrive(start);
})();
