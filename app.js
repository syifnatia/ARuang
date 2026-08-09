/* =================================================================
   ARuang — WebXR Markerless (hit-test) + tap-to-spawn + gestur jari
   ================================================================= */

const MODEL_SCALE = 0.02;   // 1 cm (slider) -> 0.02 m di dunia AR (ukuran meja)
const PI = Math.PI;
const $ = (id) => document.getElementById(id);

/* -----------------------------------------------------------------
   KOMPONEN 1: gesture-handler
   Mengubah usapan SATU jari di layar menjadi rotasi/kemiringan model.
   ----------------------------------------------------------------- */
AFRAME.registerComponent('gesture-handler', {
  init: function () {
    this.target = null;
    this.active = false;
    this.rotX = 0;
    this.rotY = 0;
    this.dragging = false;
    this.lastX = 0;
    this.lastY = 0;
    this.SENS = 0.4;

    this._start = this.onStart.bind(this);
    this._move  = this.onMove.bind(this);
    this._end   = this.onEnd.bind(this);

    window.addEventListener('touchstart', this._start, { passive: false });
    window.addEventListener('touchmove',  this._move,  { passive: false });
    window.addEventListener('touchend',   this._end);
    window.addEventListener('mousedown', this._start);
    window.addEventListener('mousemove', this._move);
    window.addEventListener('mouseup',   this._end);
  },

  fromUI: function (e) {
    const t = e.target;
    return t && t.closest && t.closest('button, input, .dock, .spawn-bar, #intro, .place-hint, .status');
  },

  point: function (e) {
    if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  },

  onStart: function (e) {
    if (!this.active || !this.target) return;
    if (this.fromUI(e)) return;
    const p = this.point(e);
    this.dragging = true;
    this.lastX = p.x;
    this.lastY = p.y;
  },

  onMove: function (e) {
    if (!this.dragging || !this.active || !this.target) return;
    if (e.cancelable) e.preventDefault();
    const p = this.point(e);
    const dx = p.x - this.lastX;
    const dy = p.y - this.lastY;
    this.lastX = p.x;
    this.lastY = p.y;

    this.rotY += dx * this.SENS;
    this.rotX += dy * this.SENS;
    this.rotX = Math.max(-90, Math.min(90, this.rotX));

    this.target.setAttribute('rotation', { x: this.rotX, y: this.rotY, z: 0 });
  },

  onEnd: function () { this.dragging = false; },

  setTarget: function (el) { this.target = el; this.active = !!el; },

  reset: function () {
    this.rotX = 0; this.rotY = 0;
    if (this.target) this.target.setAttribute('rotation', { x: 0, y: 0, z: 0 });
  }
});

/* -----------------------------------------------------------------
   KOMPONEN 2: surface-placement (WebXR hit-test)
   ----------------------------------------------------------------- */
AFRAME.registerComponent('surface-placement', {
  init: function () {
    this.hitTestSource = null;
    this.lastHit = null;
    this.placed = false;
    this.reticle = $('reticle');
    this.anchor  = $('ar-anchor');
    this._tmpV = new THREE.Vector3();

    const sceneEl = this.el.sceneEl;
    sceneEl.addEventListener('enter-vr', () => this.onEnter());
    sceneEl.addEventListener('exit-vr',  () => this.onExit());
  },

  onEnter: async function () {
    const sceneEl = this.el.sceneEl;
    if (!sceneEl.is('ar-mode')) return;
    const session = sceneEl.renderer.xr.getSession();
    if (!session || !session.requestHitTestSource) return;
    try {
      const viewerSpace = await session.requestReferenceSpace('viewer');
      this.hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
      session.addEventListener('end', () => { this.hitTestSource = null; this.lastHit = null; this.placed = false; });
    } catch (err) {
      console.warn('hit-test tidak tersedia:', err);
    }
  },

  onExit: function () {
    this.hitTestSource = null;
    if (this.reticle) this.reticle.setAttribute('visible', false);
  },

  tick: function () {
    const sceneEl = this.el.sceneEl;
    const frame = sceneEl.frame;
    if (!frame || !this.hitTestSource) return;

    const refSpace = sceneEl.renderer.xr.getReferenceSpace();
    const results = frame.getHitTestResults(this.hitTestSource);
    if (results.length > 0) {
      const pose = results[0].getPose(refSpace);
      if (pose) {
        const p = pose.transform.position;
        this.lastHit = { x: p.x, y: p.y, z: p.z };
        if (this.reticle && !this.placed) {
          this.reticle.object3D.visible = true;
          this.reticle.object3D.position.set(p.x, p.y, p.z);
        }
        if (typeof window.onSurfaceReady === 'function') window.onSurfaceReady();
      }
    }
  },

  ensurePlaced: function () {
    if (this.lastHit) {
      this.anchor.object3D.position.set(this.lastHit.x, this.lastHit.y, this.lastHit.z);
    } else {
      const cam = this.el.sceneEl.camera;
      const dir = this._tmpV.set(0, 0, -1).applyQuaternion(cam.quaternion);
      const pos = cam.getWorldPosition(new THREE.Vector3()).add(dir.multiplyScalar(0.8));
      pos.y -= 0.10;
      this.anchor.object3D.position.copy(pos);
    }
    this.placed = true;
    if (this.reticle) this.reticle.setAttribute('visible', false);
  }
});

/* =================================================================
   LABEL RUMUS 3D — Kualitas HD Bebas Pecah
   ================================================================= */
const SRGB = ('SRGBColorSpace' in THREE) ? THREE.SRGBColorSpace : undefined;

function drawLabel(canvas, lines) {
  const ctx = canvas.getContext('2d');
  const scaleFactor = 2; // Menggandakan resolusi internal kanvas agar HD
  const pad = 36 * scaleFactor;
  const gap = 14 * scaleFactor;
  const fontStack = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  
  let maxW = 0;
  let totalH = pad * 2;

  const sizes = lines.map((l) => {
    const currentSize = (l.size || 48) * scaleFactor;
    ctx.font = `${l.weight || '700'} ${currentSize}px ${fontStack}`;
    maxW = Math.max(maxW, ctx.measureText(l.text).width);
    return currentSize;
  });

  sizes.forEach((s) => { totalH += s + gap; });
  totalH -= gap;

  canvas.width  = Math.ceil(maxW + pad * 2);
  canvas.height = Math.ceil(totalH);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Efek Bayangan Belakang Papan Teks (Drop Shadow Effect)
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = 12 * scaleFactor;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 4 * scaleFactor;

  // Menggambar Background Papan Transparan Bulat (Glassmorphism effect)
  ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, 16 * scaleFactor);
  ctx.fill();

  // Reset shadow agar tidak merusak ketajaman text stroke
  ctx.shadowColor = 'transparent';

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  
  let y = pad;
  lines.forEach((l, i) => {
    const currentSize = sizes[i];
    ctx.font = `${l.weight || '700'} ${currentSize}px ${fontStack}`;
    
    // Outline Teks Tebal (Stroke) agar kontras tinggi di outdoor
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4 * scaleFactor;
    ctx.strokeStyle = '#0f172a';
    ctx.strokeText(l.text, canvas.width / 2, y);
    
    // Warna isi teks utama
    ctx.fillStyle = l.color || '#F8FAFC';
    ctx.fillText(l.text, canvas.width / 2, y);
    y += currentSize + gap;
  });
}

function setLabel(el, lines) {
  if (!el._canvas) el._canvas = document.createElement('canvas');
  const canvas = el._canvas;
  
  // Gambar teks baru ke kanvas
  drawLabel(canvas, lines);

  // --- PERBAIKAN MULAI DI SINI ---
  // Jika tekstur lama sudah ada, hapus dari memori GPU terlebih dahulu
  if (el._tex) {
    el._tex.dispose();
  }
  
  // Selalu buat objek CanvasTexture baru karena dimensi canvas (width/height) 
  // berubah-ubah saat animasi urai rumus berjalan.
  el._tex = new THREE.CanvasTexture(canvas); 
  if (SRGB) el._tex.colorSpace = SRGB;
  el._tex.minFilter = THREE.LinearFilter;
  // --- PERBAIKAN SELESAI ---

  const apply = () => {
    const mesh = el.getObject3D('mesh');
    if (!mesh) return false;
    mesh.material.map = el._tex;
    mesh.material.transparent = true;
    mesh.material.side = THREE.DoubleSide;
    // Gunakan depthWrite false agar papan teks tidak saling menutupi (z-fighting)
    mesh.material.depthWrite = false; 
    mesh.material.needsUpdate = true;
    return true;
  };
  
  if (!apply()) el.addEventListener('loaded', apply, { once: true });

  // Update ukuran papan/kotak 3D di dunia AR sesuai proporsi teks yang baru
  const worldH = 0.045 * lines.length + 0.03;
  const worldW = worldH * (canvas.width / canvas.height);
  el.object3D.scale.set(worldW, worldH, 1);
}

/* =================================================================
   LOGIKA UTAMA & SINKRONISASI BENTUK
   ================================================================= */
const sceneEl = document.querySelector('a-scene');
const introBox = $('intro');
const introNote = $('intro-note');
const btnStart = $('btn-start');
const placeHint = $('place-hint');

const radiusSlider = $('radius'), heightSlider = $('height');
const radiusVal = $('radius-val'), heightVal = $('height-val');
const cylVolEl = $('cyl-vol'), cylAreaEl = $('cyl-area');
const coneVolEl = $('cone-vol'), coneAreaEl = $('cone-area');
const statusEl = $('status');
const btnClear = $('btn-clear');
const arAnchor = $('ar-anchor');

const SOLIDS = {
  cyl: {
    group: $('cyl-model'),
    shape: $('cyl'), sweep: $('cyl-sweep'), base: $('cyl-base'), baseTop: $('cyl-base-top'),
    rRuler: $('cyl-rruler'), rLabel: $('cyl-rlabel'),
    hRuler: $('cyl-hruler'), hLabel: $('cyl-hlabel'),
    label: $('cyl-formula'),
    radiusAttr: 'radius', accent: '#38BDF8', title: 'TABUNG',
  },
  cone: {
    group: $('cone-model'),
    shape: $('cone'), sweep: $('cone-sweep'), base: $('cone-base'),
    rRuler: $('cone-rruler'), rLabel: $('cone-rlabel'),
    hRuler: $('cone-hruler'), hLabel: $('cone-hlabel'),
    label: $('cone-formula'),
    radiusAttr: 'radius-bottom', accent: '#f97316', title: 'KERUCUT',
  },
};

/* Referensi entitas untuk fitur "Jaring-jaring" — statis, tanpa animasi/garis/rumus */
const NET = {
  cyl: {
    group: $('cyl-net'),
    rect: $('net-rect'), rectLabel: $('net-rect-label'),
    circleTop: $('net-circle-top'), circleTopLabel: $('net-circle-top-label'),
    circleBottom: $('net-circle-bottom'), circleBottomLabel: $('net-circle-bottom-label'),
  },
  cone: {
    group: $('cone-net'),
    sector: $('cone-net-sector'), sectorLabel: $('cone-net-sector-label'),
    circle: $('cone-net-circle'), circleLabel: $('cone-net-circle-label'),
  },
};

/* Tabung: 2 lingkaran (alas & tutup) + 1 persegi panjang (selimut, lebar = keliling alas). */
function updateCylNetGeometry(r, h) {
  const mr = r * MODEL_SCALE, mh = h * MODEL_SCALE;
  const keliling = 2 * PI * mr;
  const n = NET.cyl;

  n.rect.setAttribute('width', keliling);
  n.rect.setAttribute('height', mh);
  n.rect.setAttribute('position', `0 ${mh / 2} 0`);
  n.rectLabel.setAttribute('position', `0 ${mh / 2} 0.002`);
  n.rectLabel.setAttribute('width', Math.min(keliling * 4, mh * 5));

  n.circleTop.setAttribute('radius', mr);
  n.circleTop.setAttribute('position', `0 ${mh + mr} 0`);
  n.circleTopLabel.setAttribute('position', `0 ${mh + mr} 0.002`);
  n.circleTopLabel.setAttribute('width', Math.max(0.4, mr * 7))

  n.circleBottom.setAttribute('radius', mr);
  n.circleBottom.setAttribute('position', `0 ${-mr} 0`);
  n.circleBottomLabel.setAttribute('position', `0 ${-mr} 0.002`);
  n.circleBottomLabel.setAttribute('width', Math.max(0.4, mr * 7));

  return { mr, mh, keliling };
}

/* Kerucut: 1 juring/sektor (selimut, jari-jari = garis pelukis s) + 1 lingkaran (alas saja). */
function updateConeNetGeometry(r, h) {
  const mr = r * MODEL_SCALE, mh = h * MODEL_SCALE;
  const s = Math.hypot(mr, mh); // garis pelukis (slant height)
  const thetaDeg = 360 * (mr / s); // sudut juring agar panjang busur = keliling alas
  const n = NET.cone;

  n.sector.setAttribute('radius', s);
  n.sector.setAttribute('theta-length', thetaDeg);
  n.sector.setAttribute('theta-start', 270 - thetaDeg / 2);
  n.sector.setAttribute('position', `0 ${s} 0`); // titik puncak juring di atas
  n.sectorLabel.setAttribute('position', `0 ${s - s * 0.45} 0.002`);
  n.sectorLabel.setAttribute('width', Math.max(0.6, s * 1.5));

  n.circle.setAttribute('radius', mr);
  n.circle.setAttribute('position', `0 ${-mr} 0`);
  n.circleLabel.setAttribute('position', `0 ${-mr} 0.002`);
  n.circleLabel.setAttribute('width', Math.max(0.4, mr * 7));

  return { mr, mh, s, thetaDeg };
}

function updateNetGeometry(r, h) {
  updateCylNetGeometry(r, h);
  return updateConeNetGeometry(r, h);
}

function defaultLabelLines(key) {
  const s = SOLIDS[key];
  const isCone = key === 'cone';
  return [
    { text: s.title, size: 54, color: s.accent, weight: '800' },
    { text: isCone ? 'V = ⅓ · π · r² · t' : 'V = π · r² · t', size: 44, color: '#F8FAFC' },
    { text: isCone ? 'Lp = π · r · (r + s)' : 'Lp = 2 · π · r · (r + t)', size: 44, color: '#F8FAFC' },
  ];
}
function setDefaultLabel(key) { setLabel(SOLIDS[key].label, defaultLabelLines(key)); }

const cylinderVolume = (r, h) => PI * r * r * h;
const coneVolume     = (r, h) => (1 / 3) * PI * r * r * h;
const cylinderArea   = (r, h) => 2 * PI * r * r + 2 * PI * r * h;
const coneArea       = (r, h) => PI * r * r + PI * r * Math.hypot(r, h);
const fmt            = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

const state = { wire: false, quiz: false, net: false, current: null };
let lastSeen = 'cyl';
const visible = new Set();

const cardEmpty = $('card-empty');
const cards = { cyl: $('card-cyl'), cone: $('card-cone') };

function updateGeometry(r, h) {
  const mr = r * MODEL_SCALE, mh = h * MODEL_SCALE;

  for (const key of Object.keys(SOLIDS)) {
    const s = SOLIDS[key];
    s.shape.setAttribute(s.radiusAttr, mr);
    s.shape.setAttribute('height', mh);
    s.shape.setAttribute('position', `0 ${mh / 2} 0`);

    s.rRuler.setAttribute('width', mr);
    s.rRuler.setAttribute('position', `${mr / 2} -0.018 0`);
    s.rLabel.setAttribute('position', `${mr / 2} -0.045 0`);

    s.hRuler.setAttribute('height', mh);
    s.hRuler.setAttribute('position', `${-(mr + 0.025)} ${mh / 2} 0`);
    s.hLabel.setAttribute('position', `${-(mr + 0.05)} ${mh / 2} 0`);

    s.label.setAttribute('position', `0 ${mh + 0.14} 0`);
  }

  updateNetGeometry(r, h);

  if (!state.quiz) {
    cylVolEl.textContent   = fmt(cylinderVolume(r, h));
    cylAreaEl.textContent  = fmt(cylinderArea(r, h));
    coneVolEl.textContent  = fmt(coneVolume(r, h));
    coneAreaEl.textContent = fmt(coneArea(r, h));
  }
}

function readSliders() {
  const r = parseFloat(radiusSlider.value);
  const h = parseFloat(heightSlider.value);
  radiusVal.textContent = r.toFixed(1) + ' cm';
  heightVal.textContent = h.toFixed(1) + ' cm';
  return { r, h };
}
function refresh() { const { r, h } = readSliders(); updateGeometry(r, h); }

radiusSlider.addEventListener('input', () => { if (!state.net) cancelBreakdown(); refresh(); });
heightSlider.addEventListener('input', () => { if (!state.net) cancelBreakdown(); refresh(); });

function showOnly(key) {
  SOLIDS.cyl.group.setAttribute('visible', key === 'cyl');
  SOLIDS.cone.group.setAttribute('visible', key === 'cone');
}

function spawnShape(key) {
  if (!SOLIDS[key]) return;

  const sp = sceneEl.components['surface-placement'];
  if (sp) sp.ensurePlaced();
  arAnchor.setAttribute('visible', true);

  const gh = sceneEl.components['gesture-handler'];

  if (state.net) {
    // Tetap di mode jaring-jaring, cukup pindahkan tampilan ke bentuk yang baru dipilih
    if (netKey && netKey !== key) hideNet(netKey);
    showOnly(key);
    state.current = key;
    lastSeen = key;
    netKey = key;
    showNet(key);
    if (gh) { gh.setTarget(SOLIDS[key].group); gh.reset(); }
    visible.clear(); visible.add(key);
    btnClear.hidden = false;
    hidePlaceHint();
    renderCards();
    return;
  }

  refresh();
  if (!state.quiz) setDefaultLabel(key);
  SOLIDS[key].label.setAttribute('visible', true);
  showOnly(key);

  if (gh) { gh.setTarget(SOLIDS[key].group); gh.reset(); }

  state.current = key;
  lastSeen = key;
  visible.clear(); visible.add(key);
  btnClear.hidden = false;
  hidePlaceHint();
  renderCards();
}
window.spawnShape = spawnShape;

$('btn-spawn-cyl').addEventListener('click', () => spawnShape('cyl'));
$('btn-spawn-cone').addEventListener('click', () => spawnShape('cone'));

function renderCards() {
  if (state.quiz) {
    cardEmpty.hidden = true;
    cards.cyl.hidden = true;
    cards.cone.hidden = true;
    return;
  }

  const any = visible.size > 0;
  cardEmpty.hidden = any;
  cards.cyl.hidden  = !visible.has('cyl');
  cards.cone.hidden = !visible.has('cone');

  if (!any) return;
  const name = state.current === 'cyl' ? 'Tabung' : 'Kerucut';
  statusEl.textContent = name + ' aktif — usap layar untuk memutar';
  statusEl.classList.add('found');
}

function clearModel() {
  if (state.net) exitNet();
  cancelBreakdown();
  showOnly(null);
  arAnchor.setAttribute('visible', false);
  const gh = sceneEl.components['gesture-handler'];
  if (gh) { gh.setTarget(null); gh.reset(); }
  const sp = sceneEl.components['surface-placement'];
  if (sp) { sp.placed = false; }
  state.current = null;
  btnClear.hidden = true;
  visible.clear();
  statusEl.textContent = 'Cari permukaan datar…';
  statusEl.classList.remove('found');
  showPlaceHint();
  renderCards();
}
btnClear.addEventListener('click', clearModel);

function showPlaceHint() { if (placeHint) placeHint.hidden = false; }
function hidePlaceHint() { if (placeHint) placeHint.hidden = true; }

let surfaceAnnounced = false;
window.onSurfaceReady = function () {
  if (surfaceAnnounced || state.current) return;
  surfaceAnnounced = true;
  statusEl.textContent = 'Permukaan siap — pilih bentuk';
  statusEl.classList.add('found');
};

const dock = $('dock');
const dockHandle = $('dock-handle');
function setExpanded(open) {
  dock.classList.toggle('expanded', open);
  dockHandle.setAttribute('aria-expanded', String(open));
}
dockHandle.addEventListener('click', () => setExpanded(!dock.classList.contains('expanded')));

const btnWire = $('btn-wire');
btnWire.addEventListener('click', () => {
  state.wire = !state.wire;
  btnWire.setAttribute('aria-pressed', String(state.wire));
  const wfVal = state.wire ? 'true' : 'false';
  for (const key of Object.keys(SOLIDS)) {
    SOLIDS[key].shape.setAttribute('material', `wireframe: ${wfVal}`);
    SOLIDS[key].sweep.setAttribute('material', `wireframe: ${wfVal}`);
  }
  NET.cyl.rect.setAttribute('material', `wireframe: ${wfVal}`);
  NET.cyl.circleTop.setAttribute('material', `wireframe: ${wfVal}`);
  NET.cyl.circleBottom.setAttribute('material', `wireframe: ${wfVal}`);
  NET.cone.sector.setAttribute('material', `wireframe: ${wfVal}`);
  NET.cone.circle.setAttribute('material', `wireframe: ${wfVal}`);
});

/* -----------------------------------------------------------------
   ANIMASI URAI RUMUS AKURAT & SINKRON
   ----------------------------------------------------------------- */
const btnBreak = $('btn-break');
let breakdownTimers = [];

function cancelBreakdown() {
  breakdownTimers.forEach(clearTimeout);
  breakdownTimers = [];
  for (const key of Object.keys(SOLIDS)) {
    const s = SOLIDS[key];
    s.base.setAttribute('visible', false);
    s.base.removeAttribute('animation__pulse');
    s.base.setAttribute('material', 'emissiveIntensity', 0.8);
    if (s.baseTop) {
      s.baseTop.setAttribute('visible', false);
      s.baseTop.removeAttribute('animation__pulse');
      s.baseTop.setAttribute('material', 'emissiveIntensity', 0.8);
    }
    s.sweep.removeAttribute('animation__grow');
    s.sweep.removeAttribute('animation__rise');
    s.sweep.setAttribute('visible', false);
    s.shape.setAttribute('visible', true); // Kembalikan bentuk utama
    
    // Reset posisi objek ssuai data slider semula
    const { h } = readSliders();
    s.sweep.object3D.scale.set(1, 1, 1);
    s.sweep.object3D.position.set(0, 0, 0);
    s.shape.object3D.position.set(0, (h * MODEL_SCALE) / 2, 0);
    
    if (!state.quiz && visible.has(key)) setDefaultLabel(key);
  }
}

function runBreakdown() {
  if (state.net) exitNet();
  cancelBreakdown();
  let key = state.current;
  if (!key) { spawnShape(lastSeen); key = lastSeen; }
  
  const s = SOLIDS[key];
  const { r, h } = readSliders();
  const mr = r * MODEL_SCALE;
  const mh = h * MODEL_SCALE;
  const isCone = key === 'cone';

  // Sinkronisasi bentuk animasi transparan dengan data slider asli
  s.sweep.setAttribute(s.radiusAttr, mr);
  s.sweep.setAttribute('height', mh);
  s.base.setAttribute('radius', mr);
  if (s.baseTop) s.baseTop.setAttribute('radius', mr);

  const DUR = 2400; // Durasi langkah transisi
  const at = (t, fn) => breakdownTimers.push(setTimeout(fn, t));

  // --- TAHAP 1: VISUALISASI ALAS (VOLUME) ---
  s.shape.setAttribute('visible', false); // Sembunyikan bodi utama agar fokus ke alas
  s.base.setAttribute('visible', true);
  s.base.setAttribute('position', `0 0.002 0`);
  
  setLabel(s.label, [
    { text: s.title, size: 54, color: s.accent, weight: '800' },
    { text: '1. LUAS ALAS', size: 46, color: '#eab308', weight: '800' },
    { text: 'Luas Lingkaran = π · r²', size: 42, color: '#F8FAFC' },
  ]);

  // --- TAHAP 2: PENINGGIAN RUANG (MENGISI VOLUME) ---
  at(DUR, () => {
    s.sweep.setAttribute('visible', true);
    s.sweep.object3D.scale.y = 0.001;
    // Animasi pembesaran skala Y dari dasar ke atas secara presisi
    s.sweep.setAttribute('animation__grow', `property: object3D.scale.y; from: 0.001; to: 1; dur: ${DUR}; easing: easeInOutQuad`);
    s.sweep.setAttribute('animation__rise', `property: object3D.position.y; from: 0; to: ${mh / 2}; dur: ${DUR}; easing: easeInOutQuad`);
    
    setLabel(s.label, [
      { text: '2. ISI RUANG (VOLUME)', size: 44, color: '#eab308', weight: '800' },
      { text: isCone ? 'Dikalikan Tinggi (t) lalu dibagi 3' : 'Dikalikan Tinggi Berurutan (t)', size: 40, color: '#F8FAFC' },
    ]);
  });

  // --- TAHAP 3: KESIMPULAN FORMULA VOLUME ---
  at(DUR * 2, () => {
    setLabel(s.label, [
      { text: 'RUMUS KESIMPULAN VOLUME', size: 42, color: '#eab308', weight: '800' },
      { text: isCone ? 'V = ⅓ · π · r² · t' : 'V = π · r² · t', size: 50, color: '#22c55e', weight: '800' },
    ]);
  });

  // --- TAHAP 4: VISUALISASI LUAS ALAS (LUAS PERMUKAAN) ---
  at(DUR * 3.2, () => {
    // Bersihkan sisa animasi volume
    s.sweep.removeAttribute('animation__grow');
    s.sweep.removeAttribute('animation__rise');
    s.sweep.setAttribute('visible', false);

    // Soroti lingkaran alas. Untuk TABUNG: alas bawah + tutup atas (2 sisi).
    const disks = isCone ? [s.base] : [s.base, s.baseTop];
    s.base.setAttribute('position', '0 0.002 0');
    if (s.baseTop) s.baseTop.setAttribute('position', `0 ${mh - 0.002} 0`);
    disks.forEach((d) => {
      d.setAttribute('visible', true);
      d.setAttribute('animation__pulse', 'property: material.emissiveIntensity; from: 0.25; to: 1.2; dir: alternate; loop: true; dur: 520; easing: easeInOutSine');
    });

    setLabel(s.label, [
      { text: '3. LUAS PERMUKAAN (KULIT)', size: 44, color: '#eab308', weight: '800' },
      { text: isCone ? 'Luas Sisi Alas = π · r²' : 'Luas 2 Sisi Saling Sejajar = 2 · π · r²', size: 40, color: '#F8FAFC' },
    ]);
  });

  // --- TAHAP 5: VISUALISASI SELIMUT BENTUK ---
  at(DUR * 4.4, () => {
    s.sweep.setAttribute('visible', true); 
    s.sweep.object3D.scale.set(1, 1, 1);
    s.sweep.object3D.position.set(0, mh / 2, 0);
    s.base.removeAttribute('animation__pulse');
    s.base.setAttribute('material', 'emissiveIntensity', 0.8);
    s.base.setAttribute('visible', false); // Fokus penuh ke kulit luar/selimut
    if (s.baseTop) {
      s.baseTop.removeAttribute('animation__pulse');
      s.baseTop.setAttribute('material', 'emissiveIntensity', 0.8);
      s.baseTop.setAttribute('visible', false);
    }
    
    setLabel(s.label, [
      { text: '4. LUAS SELIMUT LUAR', size: 44, color: '#eab308', weight: '800' },
      { text: isCone ? 'Luas Selimut Kerucut = π · r · s' : 'Luas Selimut Tabung = 2 · π · r · t', size: 40, color: '#F8FAFC' },
    ]);
  });

  // --- TAHAP 6: RANGKUMAN LUAS PERMUKAAN TOTAL ---
  at(DUR * 5.6, () => {
    s.shape.setAttribute('visible', true); // Tampilkan bodi solid asli kembali
    s.sweep.setAttribute('visible', false);
    s.base.setAttribute('visible', false);
    if (s.baseTop) s.baseTop.setAttribute('visible', false);
    
    setLabel(s.label, [
      { text: s.title, size: 50, color: s.accent, weight: '800' },
      { text: isCone ? 'Lp = π · r · (r + s)' : 'Lp = 2 · π · r · (r + t)', size: 48, color: '#22c55e', weight: '800' },
    ]);
  });

  // Kembali otomatis ke default interface setelah 8 detik selesai edukasi
  at(DUR * 7.0, cancelBreakdown);
}

btnBreak.addEventListener('click', () => { setExpanded(false); runBreakdown(); });

/* -----------------------------------------------------------------
   FITUR: JARING-JARING (statis, tanpa animasi/garis/kotak rumus)
   Tabung  -> 2 lingkaran (alas & tutup) + 1 persegi panjang (selimut).
   Kerucut -> 1 juring/sektor (selimut) + 1 lingkaran (alas saja).
   Berlaku untuk bentuk yang sedang aktif (tabung ATAU kerucut).
   ----------------------------------------------------------------- */
const btnNet = $('btn-net');
let netKey = null; // 'cyl' | 'cone' — bentuk mana yang sedang ditampilkan jaring-jaringnya

function showNet(key) {
  const s = SOLIDS[key];
  const { r, h } = readSliders();
  updateNetGeometry(r, h);

  // Sembunyikan bentuk solid & garis bantu r/t, tampilkan jaring-jaring statis
  s.shape.setAttribute('visible', false);
  s.rRuler.setAttribute('visible', false);
  s.rLabel.setAttribute('visible', false);
  s.hRuler.setAttribute('visible', false);
  s.hLabel.setAttribute('visible', false);
  s.label.setAttribute('visible', false);

  NET[key].group.setAttribute('visible', true);
  NET[key].group.setAttribute('position', '0 0.15 0');
}

function hideNet(key) {
  const s = SOLIDS[key];
  NET[key].group.setAttribute('visible', false);
  s.shape.setAttribute('visible', true);
  s.rRuler.setAttribute('visible', true);
  s.rLabel.setAttribute('visible', true);
  s.hRuler.setAttribute('visible', true);
  s.hLabel.setAttribute('visible', true);
  if (visible.has(key) && !state.quiz) { setDefaultLabel(key); s.label.setAttribute('visible', true); }
}

function enterNet() {
  if (state.quiz) exitQuiz();
  if (!state.current) spawnShape(lastSeen);
  cancelBreakdown();
  setExpanded(true);
  state.net = true;
  netKey = state.current;
  btnNet.setAttribute('aria-pressed', 'true');
  showNet(netKey);
}

function exitNet() {
  state.net = false;
  btnNet.setAttribute('aria-pressed', 'false');
  if (netKey) hideNet(netKey);
  netKey = null;
  refresh();
}

btnNet.addEventListener('click', () => (state.net ? exitNet() : enterNet()));

/* --- LOGIKA KUIS --- */
const btnQuiz = $('btn-quiz');
const controls = $('controls');
const quizPanel = $('quiz');
const quizPrompt = $('quiz-prompt');
const quizAnswer = $('quiz-answer');
const quizSubmit = $('quiz-submit');
const quizNext = $('quiz-next');
const quizFeedback = $('quiz-feedback');
const quizUnit = $('quiz-unit');
const quizTabs = Array.from(document.querySelectorAll('#quiz .quiz-tab'));
let current = null; // { key, r, t, stage: 'vol' | 'area' }

// Urutan soal per putaran: 2 soal Volume, lalu 2 soal Luas Permukaan
const QUIZ_STAGES = ['vol', 'vol', 'area', 'area'];
const QUIZ_TAB_LABELS = ['Vol 1', 'Vol 2', 'Luas 1', 'Luas 2'];
let quizIndex = 0;

function quizAnswerFor(key, r, t, stage) {
  if (stage === 'vol')  return key === 'cyl' ? cylinderVolume(r, t) : coneVolume(r, t);
  return key === 'cyl' ? cylinderArea(r, t) : coneArea(r, t);
}

function quizFormulaFor(key, r, t, stage) {
  if (key === 'cyl') {
    return stage === 'vol'
      ? `V = π · r² · t = π · ${r}² · ${t}`
      : `Lp = 2 · π · r · (r + t) = 2 · π · ${r} · (${r} + ${t})`;
  }
  const s = Math.round(Math.hypot(r, t) * 10) / 10;
  return stage === 'vol'
    ? `V = ⅓ · π · r² · t = ⅓ · π · ${r}² · ${t}`
    : `Lp = π · r · (r + s) = π · ${r} · (${r} + ${s})`;
}

function renderQuizStageUI(index) {
  const stage = QUIZ_STAGES[index];
  const isVol = stage === 'vol';
  quizTabs.forEach((tab, i) => {
    tab.textContent = QUIZ_TAB_LABELS[i];
    tab.classList.toggle('active', i === index);
    tab.classList.toggle('done', i < index);
  });
  quizUnit.textContent = isVol ? 'cm³' : 'cm²';
}

function newQuestion() {
  cancelBreakdown();
  const stage = QUIZ_STAGES[quizIndex];
  const key = Math.random() < 0.5 ? 'cyl' : 'cone';
  const r = Math.round(Math.random() * 5 + 2);   // bilangan bulat 2–7 cm
  const t = Math.round(Math.random() * 8 + 3);   // bilangan bulat 3–11 cm
  startQuestion(key, r, t, stage);
}

function startQuestion(key, r, t, stage) {
  const answer = quizAnswerFor(key, r, t, stage);
  current = { key, r, t, stage, answer };

  radiusSlider.value = r; heightSlider.value = t;
  updateGeometry(r, t); readSliders();

  spawnShape(key);
  renderQuizStageUI(quizIndex);

  const labelQuestion = stage === 'vol' ? 'Berapakah Volumenya?' : 'Berapakah Luas Permukaannya?';
  setLabel(SOLIDS[key].label, [
    { text: SOLIDS[key].title, size: 54, color: SOLIDS[key].accent, weight: '800' },
    { text: labelQuestion, size: 44, color: '#eab308', weight: '800' },
  ]);

  const task = stage === 'vol' ? 'Hitung volume' : 'Hitung luas permukaan';
  quizPrompt.innerHTML = `Soal ${quizIndex + 1} dari ${QUIZ_STAGES.length} — ${task} dimensi model 3D di atas meja:<br><b>Jari-jari (r) = ${r} cm</b>, <b>Tinggi (t) = ${t} cm</b>`;
  quizAnswer.value = ''; quizFeedback.textContent = ''; quizFeedback.className = 'quiz-feedback';
  quizNext.hidden = true; quizAnswer.focus();
}

function enterQuiz() {
  if (state.net) exitNet();
  state.quiz = true; setExpanded(true);
  btnQuiz.setAttribute('aria-pressed', 'true');
  controls.hidden = true; quizPanel.hidden = false;
  renderCards();
  quizIndex = 0;
  newQuestion();
}
function exitQuiz() {
  state.quiz = false;
  btnQuiz.setAttribute('aria-pressed', 'false');
  controls.hidden = false; quizPanel.hidden = true;
  for (const key of Object.keys(SOLIDS)) {
    if (visible.has(key)) setDefaultLabel(key);
  }
  refresh();
  renderCards();
}
btnQuiz.addEventListener('click', () => (state.quiz ? exitQuiz() : enterQuiz()));
quizNext.addEventListener('click', () => {
  quizIndex = (quizIndex + 1) % QUIZ_STAGES.length;
  newQuestion();
});

function checkAnswer() {
  if (!current) return;
  const guess = parseFloat(quizAnswer.value);
  if (Number.isNaN(guess)) { quizFeedback.className = 'quiz-feedback no'; quizFeedback.textContent = 'Silakan isi angka jawaban dahulu.'; return; }
  const { key, r, t, stage, answer } = current;
  const within = Math.abs(guess - answer) <= answer * 0.02 + 0.05;
  const formula = quizFormulaFor(key, r, t, stage);
  const unit = stage === 'vol' ? 'cm³' : 'cm²';

  if (visible.has(key)) setDefaultLabel(key);

  quizFeedback.className = 'quiz-feedback ' + (within ? 'ok' : 'no');
  quizFeedback.innerHTML = within
    ? `🎉 Benar! <br><small>${formula} ≈ <b>${fmt(answer)}</b> ${unit}</small>`
    : `❌ Kurang tepat. <br><small>${formula} ≈ <b>${fmt(answer)}</b> ${unit} (jawabanmu: ${fmt(guess)} ${unit})</small>`;

  const isLast = quizIndex === QUIZ_STAGES.length - 1;
  quizNext.textContent = isLast ? 'Putaran baru →' : `Lanjut: ${QUIZ_TAB_LABELS[quizIndex + 1]} →`;
  quizNext.hidden = false;
}
quizSubmit.addEventListener('click', checkAnswer);
quizAnswer.addEventListener('keydown', (e) => { if (e.key === 'Enter') checkAnswer(); });


function showIntroNote(msg) {
  if (!introNote) return;
  introNote.hidden = false;
  introNote.textContent = msg;
}

async function startAR() {
  const supported = navigator.xr && await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  if (supported) {
    introBox.classList.add('hidden');
    statusEl.textContent = 'Cari permukaan datar…';
    showPlaceHint();
    try {
      if (sceneEl.enterAR) sceneEl.enterAR();
      else sceneEl.enterVR(true);
    } catch (e) {
      console.warn(e);
      enterFallback('Tidak bisa memulai sesi AR. Beralih ke simulator 3D.');
    }
  } else {
    enterFallback('Perangkat belum mendukung AR kamera. Menampilkan mode simulator 3D (tombol & gestur putar tetap berfungsi aktif).');
  }
}

function enterFallback(msg) {
  introBox.classList.add('hidden');
  document.body.classList.add('fallback-bg');
  statusEl.textContent = 'Mode Pratinjau 3D';
  statusEl.classList.add('found');
  hidePlaceHint();
  if (msg) showStatusToast(msg);
}

function showStatusToast(msg) {
  const prev = statusEl.textContent;
  statusEl.textContent = msg;
  setTimeout(() => { if (!state.current) statusEl.textContent = prev; }, 5000);
}

btnStart.addEventListener('click', startAR);

(async () => {
  const ok = navigator.xr && await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  if (!ok) showIntroNote('Info: Perangkat PC/iPhone Safari akan masuk otomatis ke mode simulator 3D interaktif.');
})();

sceneEl.addEventListener('exit-vr', () => {
  if (sceneEl.is('vr-mode') || sceneEl.is('ar-mode')) return;
  introBox.classList.remove('hidden');
});

refresh();
renderCards();
showPlaceHint();