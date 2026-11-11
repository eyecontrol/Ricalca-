/* Ricalca — overlay an image on the live camera to trace it. */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const stage = $("#stage"), video = $("#cam"), layer = $("#layer"), img = $("#overlay");
  const welcome = $("#welcome"), fileInput = $("#file-input");
  const hud = [$("#topbar"), $("#rail"), $("#zoom"), $("#dock")];
  const opacity = $("#opacity"), opVal = $("#op-val");
  const btnLock = $("#btn-lock"), btnEye = $("#btn-eye"), lockBadge = $("#lock-badge");
  const toastEl = $("#toast");

  const STORE = "ricalca:v1";
  const saved = load();

  // ---------- state ----------
  const t = { x: 0, y: 0, s: 1, r: 0, flip: false };
  let locked = false, visible = true, filter = saved.filter || "none";
  let stream = null, track = null, wakeLock = null;
  let srcURL = null, linesURL = null;
  let digitalZoom = 1;

  function load() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify({ opacity: +opacity.value, filter })); } catch {}
  }

  // ---------- toast ----------
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
  }

  // ---------- camera ----------
  async function startCamera() {
    $("#nocam").hidden = true;
    if (!navigator.mediaDevices?.getUserMedia) return camFail("Il browser non supporta la fotocamera. Apri la pagina in HTTPS con Chrome o Safari.");
    stopCamera();
    const tries = [
      { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
      { video: true, audio: false },
    ];
    for (const c of tries) {
      try { stream = await navigator.mediaDevices.getUserMedia(c); break; }
      catch (e) {
        if (e.name === "NotAllowedError" || e.name === "SecurityError")
          return camFail("Permesso fotocamera negato. Consentilo dalle impostazioni del browser e riprova.");
      }
    }
    if (!stream) return camFail("Nessuna fotocamera trovata su questo dispositivo.");
    video.srcObject = stream;
    try { await video.play(); } catch {}
    track = stream.getVideoTracks()[0];
    track.addEventListener("ended", () => { if (!document.hidden && welcome.hidden) startCamera(); });
    setupZoom();
    setupTorch();
    keepAwake();
  }
  function stopCamera() {
    if (stream) stream.getTracks().forEach((tr) => tr.stop());
    stream = null; track = null;
  }
  function camFail(msg) {
    $("#nocam-msg").textContent = msg;
    $("#nocam").hidden = false;
    $("#zoom").hidden = true;
  }
  $("#retry-cam").onclick = startCamera;

  function caps() { try { return track?.getCapabilities?.() || {}; } catch { return {}; } }

  function setupZoom() {
    const z = $("#zoom");
    z.innerHTML = "";
    const c = caps().zoom;
    let levels, apply;
    if (c && c.max > c.min) {
      const set = new Set([c.min, ...[0.5, 1, 2, 3, 5].filter((v) => v >= c.min && v <= c.max)]);
      levels = [...set].sort((a, b) => a - b).slice(0, 5);
      apply = (v) => track.applyConstraints({ advanced: [{ zoom: v }] }).catch(() => {});
      const cur = track.getSettings?.().zoom ?? 1;
      render(levels.reduce((a, b) => (Math.abs(b - cur) < Math.abs(a - cur) ? b : a)));
    } else {
      levels = [1, 1.5, 2];
      apply = (v) => { digitalZoom = v; video.style.transform = `scale(${v})`; };
      render(digitalZoom);
    }
    function render(active) {
      z.innerHTML = "";
      levels.slice().reverse().forEach((v) => {
        const b = document.createElement("button");
        b.textContent = (Math.round(v * 10) / 10) + "×";
        b.className = v === active ? "on" : "";
        b.setAttribute("aria-label", "Zoom " + v);
        b.onclick = () => { apply(v); render(v); };
        z.appendChild(b);
      });
    }
    z.hidden = !welcome.hidden ? true : false;
  }

  function setupTorch() {
    const b = $("#btn-torch");
    b.hidden = !caps().torch;
    b.classList.remove("on");
    b.onclick = async () => {
      const on = !b.classList.contains("on");
      try { await track.applyConstraints({ advanced: [{ torch: on }] }); b.classList.toggle("on", on); }
      catch { toast("Torcia non disponibile"); }
    };
  }

  async function keepAwake() {
    try { if ("wakeLock" in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => (wakeLock = null)); } } catch {}
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !welcome.hidden) return;
    if (!track || track.readyState === "ended") startCamera();
    keepAwake();
  });

  // ---------- image ----------
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (f) loadFile(f);
    fileInput.value = "";
  });

  function loadFile(f) {
    if (!f.type.startsWith("image/")) return toast("Il file non è un'immagine");
    if (srcURL) URL.revokeObjectURL(srcURL);
    if (linesURL) URL.revokeObjectURL(linesURL);
    linesURL = null;
    srcURL = URL.createObjectURL(f);
    const probe = new Image();
    probe.onload = () => {
      img.classList.add("has-img");
      applyFilter(filter, true);
      fitImage(probe.naturalWidth, probe.naturalHeight);
      enterStage();
      setLocked(false);
      toast("Trascina, pizzica e ruota con le dita");
    };
    probe.onerror = () => toast("Impossibile leggere l'immagine");
    probe.src = srcURL;
  }

  function fitImage(w, h) {
    img.style.width = w + "px";
    img.style.height = h + "px";
    const vw = innerWidth, vh = innerHeight;
    t.s = Math.min((vw * 0.8) / w, (vh * 0.6) / h);
    t.x = 0; t.y = 0; t.r = 0;
    render();
  }

  function render() {
    img.style.transform =
      `translate(-50%,-50%) translate(${t.x}px,${t.y}px) rotate(${t.r}rad) scale(${t.s * (t.flip ? -1 : 1)},${t.s})`;
  }

  // Edge-detected "line art" version for easier tracing
  function makeLines() {
    return new Promise((resolve) => {
      const src = new Image();
      src.onload = () => {
        const max = 1600, k = Math.min(1, max / Math.max(src.naturalWidth, src.naturalHeight));
        const w = Math.max(1, Math.round(src.naturalWidth * k)), h = Math.max(1, Math.round(src.naturalHeight * k));
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d", { willReadFrequently: true });
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(src, 0, 0, w, h);
        const id = ctx.getImageData(0, 0, w, h), d = id.data;
        const g = new Float32Array(w * h);
        for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114;
        // light blur to reduce noise
        const b = new Float32Array(w * h);
        for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          b[i] = (g[i] * 4 + g[i - 1] * 2 + g[i + 1] * 2 + g[i - w] * 2 + g[i + w] * 2 + g[i - w - 1] + g[i - w + 1] + g[i + w - 1] + g[i + w + 1]) / 16;
        }
        const mag = new Float32Array(w * h); let sum = 0, n = 0;
        for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          const gx = -b[i - w - 1] - 2 * b[i - 1] - b[i + w - 1] + b[i - w + 1] + 2 * b[i + 1] + b[i + w + 1];
          const gy = -b[i - w - 1] - 2 * b[i - w] - b[i - w + 1] + b[i + w - 1] + 2 * b[i + w] + b[i + w + 1];
          const m = Math.hypot(gx, gy); mag[i] = m; sum += m; n++;
        }
        const thr = Math.max(40, (sum / n) * 2.2);
        for (let i = 0, p = 0; i < mag.length; i++, p += 4) {
          const a = Math.min(255, Math.max(0, ((mag[i] - thr) / thr) * 255 + 120));
          const on = mag[i] > thr;
          d[p] = 20; d[p + 1] = 16; d[p + 2] = 28; d[p + 3] = on ? a : 0;
        }
        ctx.clearRect(0, 0, w, h);
        ctx.putImageData(id, 0, 0);
        cv.toBlob((bl) => resolve(bl ? URL.createObjectURL(bl) : srcURL), "image/png");
      };
      src.src = srcURL;
    });
  }

  async function applyFilter(f, silent) {
    filter = f;
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.filter === f));
    img.classList.remove("f-bw", "f-invert");
    if (f === "bw") img.classList.add("f-bw");
    if (f === "invert") img.classList.add("f-invert");
    if (!srcURL) return save();
    if (f === "lines") {
      if (!linesURL) { if (!silent) toast("Estraggo i contorni…"); linesURL = await makeLines(); }
      if (filter === "lines") img.src = linesURL;
    } else {
      img.src = srcURL;
    }
    save();
  }
  document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => applyFilter(b.dataset.filter)));

  // ---------- opacity ----------
  function setOpacity(v) {
    opacity.value = v;
    opVal.textContent = v + "%";
    opacity.style.setProperty("--p", v + "%");
    img.style.opacity = v / 100;
  }
  opacity.addEventListener("input", () => { setOpacity(+opacity.value); save(); });
  setOpacity(saved.opacity ?? 50);

  // ---------- buttons ----------
  function setLocked(v) {
    locked = v;
    btnLock.classList.toggle("on", v);
    btnLock.setAttribute("aria-pressed", v);
    btnLock.querySelector("small").textContent = v ? "Bloccata" : "Blocca";
    stage.classList.toggle("locked", v);
    lockBadge.hidden = !v || !img.classList.contains("has-img");
  }
  btnLock.onclick = () => { setLocked(!locked); toast(locked ? "Immagine bloccata: ora puoi disegnare" : "Immagine sbloccata"); };

  btnEye.onclick = () => {
    visible = !visible;
    img.classList.toggle("hide", !visible);
    btnEye.classList.toggle("off", !visible);
    btnEye.setAttribute("aria-pressed", visible);
    btnEye.querySelector("small").textContent = visible ? "Vedi" : "Nascosta";
  };
  $("#btn-flip").onclick = () => { t.flip = !t.flip; render(); };
  $("#btn-reset").onclick = () => {
    if (!img.classList.contains("has-img")) return;
    fitImage(parseFloat(img.style.width), parseFloat(img.style.height));
  };
  $("#btn-grid").onclick = (e) => { const g = $("#grid"); g.hidden = !g.hidden; e.currentTarget.classList.toggle("on", !g.hidden); };

  const fullBtn = $("#btn-full");
  const fsEl = document.documentElement;
  if (!(fsEl.requestFullscreen || fsEl.webkitRequestFullscreen)) fullBtn.hidden = true;
  fullBtn.onclick = () => {
    const isFs = document.fullscreenElement || document.webkitFullscreenElement;
    if (isFs) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else (fsEl.requestFullscreen || fsEl.webkitRequestFullscreen).call(fsEl).catch?.(() => {});
  };

  $("#btn-home").onclick = () => {
    stopCamera();
    welcome.hidden = false;
    hud.forEach((h) => (h.hidden = true));
    lockBadge.hidden = true;
    document.body.classList.remove("zen");
  };
  $("#start-empty").onclick = enterStage;

  function enterStage() {
    const wasHidden = !welcome.hidden;
    welcome.hidden = true;
    hud.forEach((h) => (h.hidden = false));
    if (wasHidden || !track || track.readyState === "ended") startCamera();
    else setupZoom();
    lockBadge.hidden = !locked || !img.classList.contains("has-img");
  }

  // ---------- gestures ----------
  const pts = new Map();
  let g0 = null, moved = false, downAt = 0;

  function snapshot() {
    const p = [...pts.values()];
    if (p.length >= 2) {
      const [a, b] = p;
      return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x), n: 2, t: { ...t } };
    }
    return { cx: p[0].x, cy: p[0].y, d: 0, ang: 0, n: 1, t: { ...t } };
  }

  layer.addEventListener("pointerdown", (e) => {
    layer.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { moved = false; downAt = performance.now(); }
    g0 = snapshot();
  });
  layer.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s = snapshot();
    if (Math.hypot(s.cx - g0.cx, s.cy - g0.cy) > 6 || s.n === 2) moved = true;
    if (locked || !img.classList.contains("has-img")) return;
    t.x = g0.t.x + (s.cx - g0.cx);
    t.y = g0.t.y + (s.cy - g0.cy);
    if (s.n === 2 && g0.n === 2 && g0.d > 0) {
      t.s = Math.min(40, Math.max(0.02, g0.t.s * (s.d / g0.d)));
      t.r = g0.t.r + (s.ang - g0.ang);
      // rotate/scale around the pinch centre, not the image centre
      const ox = g0.cx - innerWidth / 2 - g0.t.x, oy = g0.cy - innerHeight / 2 - g0.t.y;
      const k = t.s / g0.t.s, dr = t.r - g0.t.r, c = Math.cos(dr), sn = Math.sin(dr);
      t.x += ox - k * (ox * c - oy * sn);
      t.y += oy - k * (ox * sn + oy * c);
    }
    render();
  });
  function up(e) {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size === 0) {
      if (!moved && performance.now() - downAt < 300) document.body.classList.toggle("zen");
    } else g0 = snapshot();
  }
  layer.addEventListener("pointerup", up);
  layer.addEventListener("pointercancel", up);

  // mouse wheel: zoom (desktop) — shift+wheel rotates
  layer.addEventListener("wheel", (e) => {
    if (locked || !img.classList.contains("has-img")) return;
    e.preventDefault();
    if (e.shiftKey) t.r += e.deltaY * 0.002;
    else t.s = Math.min(40, Math.max(0.02, t.s * Math.exp(-e.deltaY * 0.0015)));
    render();
  }, { passive: false });

  // prevent iOS page pinch-zoom
  ["gesturestart", "gesturechange"].forEach((ev) => document.addEventListener(ev, (e) => e.preventDefault()));

  // paste / drop an image (desktop)
  addEventListener("paste", (e) => {
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/"));
    if (f) loadFile(f);
  });
  addEventListener("dragover", (e) => e.preventDefault());
  addEventListener("drop", (e) => {
    e.preventDefault();
    const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith("image/"));
    if (f) loadFile(f);
  });

  applyFilter(filter, true);

  // ---------- PWA ----------
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
