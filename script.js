/* ==========================================================================
   عجلة الفخامة — script.js
   منطق العجلة والرسم والحركة والأصوات والتخزين. بدون أي مكتبات خارجية.
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------------------------------------------------
     Constants
     ------------------------------------------------------------------------ */
  const MAX_ENTRIES = 100;
  const DEFAULT_SPEED = 6;
  const TAU = Math.PI * 2;

  const DEFAULT_ENTRIES = [
    "أحمد",
    "سارة",
    "محمد",
    "ليلى",
    "عمر",
    "نور",
    "خالد",
    "مريم",
    "يوسف",
    "هدى",
    "علي",
    "رنا",
  ];

  const STORAGE_KEYS = {
    entries: "wheel.entries.v1",
    saved: "wheel.saved.v1",
    theme: "wheel.theme.v2",
    sound: "wheel.sound",
    speed: "wheel.speed.v1",
  };

  const PALETTE = [
    "#ef476f",
    "#ffb703",
    "#06d6a0",
    "#118ab2",
    "#f15bb5",
    "#8ac926",
    "#ff7b00",
    "#5f6cff",
    "#00bbf9",
    "#ff4d6d",
    "#9b5de5",
    "#2ec4b6",
    "#ffbe0b",
    "#4d96ff",
    "#e76f51",
    "#7ac74f",
  ];

  const MOTION_QUERY = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

  /* ------------------------------------------------------------------------
     DOM
     ------------------------------------------------------------------------ */
  const $ = (id) => document.getElementById(id);

  const els = {
    root: document.documentElement,
    body: document.body,
    metaTheme: $("themeColorMeta"),

    themeToggle: $("themeToggle"),
    soundToggle: $("soundToggle"),

    wheelStage: $("wheelStage"),
    canvas: $("wheel"),
    pointer: $("pointer"),
    hub: $("hub"),
    hubLabel: document.querySelector("#hub .hub__label"),
    hubCount: $("hubCount"),
    emptyState: $("emptyState"),
    emptyAddBtn: $("emptyAddBtn"),

    spinBtn: $("spinBtn"),
    spinLabel: document.querySelector("#spinBtn .btn__label"),

    lastResult: $("lastResult"),
    lastResultDot: $("lastResultDot"),
    lastResultName: $("lastResultName"),
    lastResultEmoji: $("lastResultEmoji"),

    entries: $("entries"),
    entriesList: $("entriesList"),
    countBadge: $("countBadge"),
    shuffleBtn: $("shuffleBtn"),
    sortBtn: $("sortBtn"),
    clearBtn: $("clearBtn"),
    clearLabel: document.querySelector("#clearBtn .btn__label"),
    saveNamesBtn: $("saveNamesBtn"),
    restoreNamesBtn: $("restoreNamesBtn"),
    speedBtn: $("speedBtn"),
    speedModal: $("speedModal"),
    speedRange: $("speedRange"),
    speedValue: $("speedValue"),

    modal: $("winnerModal"),
    modalCard: $("winnerCard"),
    winnerName: $("winnerName"),
    closeModalBtn: $("closeModalBtn"),
    confettiLayer: $("confettiLayer"),

    toast: $("toast"),
  };

  const ctx = els.canvas ? els.canvas.getContext("2d") : null;

  /* ------------------------------------------------------------------------
     State
     ------------------------------------------------------------------------ */
  const state = {
    entries: [],
    rotation: 0,
    spinning: false,
    soundOn: true,
    speed: DEFAULT_SPEED,
    currentWinner: null,
    currentWinnerIndex: -1,
    winnerBag: [],
    lastWinnerIndex: -1,
    lastFocused: null,
    speedLastFocused: null,
    clearArmed: false,
    clearTimer: 0,
    toastTimer: 0,
    confettiTimer: 0,
    pointerAnim: null,
    resizeRaf: 0,
  };

  /* ------------------------------------------------------------------------
     Helpers
     ------------------------------------------------------------------------ */
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeDeg(value) {
    return ((value % 360) + 360) % 360;
  }

  function cleanLabel(value) {
    return String(value == null ? "" : value)
      .replace(/\s+/g, " ")
      .trim();
  }

  function sanitizeEntries(list) {
    if (!Array.isArray(list)) return [];
    const cleaned = [];
    for (let i = 0; i < list.length && cleaned.length < MAX_ENTRIES; i += 1) {
      const label = cleanLabel(list[i]);
      if (label) cleaned.push(label);
    }
    return cleaned;
  }

  function parseEntriesText(text) {
    return String(text)
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map(cleanLabel)
      .filter(Boolean);
  }

  function formatCount(count) {
    if (count === 0) return "لا عناصر";
    if (count === 1) return "عنصر واحد";
    if (count === 2) return "عنصران";
    if (count <= 10) return count + " عناصر";
    return count + " عنصراً";
  }

  function randomInt(max) {
    if (!Number.isFinite(max) || max <= 0) return 0;
    const limit = Math.floor(4294967296 / max) * max;
    const buffer = new Uint32Array(1);
    try {
      if (window.crypto && window.crypto.getRandomValues) {
        let value = 0;
        do {
          window.crypto.getRandomValues(buffer);
          value = buffer[0];
        } while (value >= limit);
        return value % max;
      }
    } catch (error) {
      /* Fall back to Math.random in restricted contexts. */
    }
    return Math.floor(Math.random() * max);
  }

  /*
     Winner selection: every cycle is a freshly shuffled bag of all indices.
     Each index wins at most once per cycle, so every name gets its turn,
     while the order stays fully random. The pool shrinks after each win,
     which gives different odds on every spin, and a new cycle never starts
     with the previous winner.
  */
  function shuffleIndexes(count) {
    const list = [];
    for (let i = 0; i < count; i += 1) list.push(i);

    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1);
      const temp = list[i];
      list[i] = list[j];
      list[j] = temp;
    }
    return list;
  }

  function pickWinnerIndex(count) {
    if (count <= 0) return -1;
    if (count === 1) {
      state.winnerBag = [];
      return 0;
    }

    let bag = state.winnerBag.filter(function (index) {
      return index >= 0 && index < count;
    });

    if (!bag.length) {
      bag = shuffleIndexes(count);

      if (
        state.lastWinnerIndex >= 0 &&
        bag[bag.length - 1] === state.lastWinnerIndex
      ) {
        const swapAt = randomInt(bag.length - 1);
        const temp = bag[swapAt];
        bag[swapAt] = bag[bag.length - 1];
        bag[bag.length - 1] = temp;
      }
    }

    const chosen = bag.pop();
    state.winnerBag = bag;
    return chosen;
  }

  function truncateLabel(text, maxChars) {
    const chars = Array.from(text);
    if (chars.length <= maxChars) return text;
    return chars.slice(0, maxChars - 1).join("") + "…";
  }

  /* ------------------------------------------------------------------------
     Storage
     ------------------------------------------------------------------------ */
  function readStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      /* Storage can be unavailable in sandboxed contexts. */
    }
  }

  function loadEntries() {
    const raw = readStorage(STORAGE_KEYS.entries);
    if (raw === null) return DEFAULT_ENTRIES.slice();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return sanitizeEntries(parsed);
    } catch (error) {
      /* Invalid data falls back to defaults. */
    }
    return DEFAULT_ENTRIES.slice();
  }

  function saveEntries() {
    writeStorage(STORAGE_KEYS.entries, JSON.stringify(state.entries));
  }

  function loadSnapshot() {
    const raw = readStorage(STORAGE_KEYS.saved);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.entries)) {
        const entries = sanitizeEntries(parsed.entries);
        if (entries.length) return entries;
      }
    } catch (error) {
      /* Invalid snapshots are ignored. */
    }
    return null;
  }

  /* ------------------------------------------------------------------------
     Color
     ------------------------------------------------------------------------ */
  function hslToHex(hue, saturation, lightness) {
    const h = ((hue % 360) + 360) % 360;
    const s = clamp(saturation, 0, 100) / 100;
    const l = clamp(lightness, 0, 100) / 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(255 * color)
        .toString(16)
        .padStart(2, "0");
    };
    return "#" + f(0) + f(8) + f(4);
  }

  function colorAt(index) {
    if (index < PALETTE.length) return PALETTE[index];
    const hue = (index * 137.508 + 32) % 360;
    const lightness = 52 + (index % 3) * 4;
    return hslToHex(hue, 67, lightness);
  }

  function hexToRgb(hex) {
    const normalized = String(hex).replace("#", "");
    const full =
      normalized.length === 3
        ? normalized
            .split("")
            .map((c) => c + c)
            .join("")
        : normalized;
    const value = parseInt(full, 16);
    if (Number.isNaN(value)) return { r: 0, g: 0, b: 0 };
    return {
      r: (value >> 16) & 255,
      g: (value >> 8) & 255,
      b: value & 255,
    };
  }

  function relativeLuminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    const channel = (value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return (
      0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    );
  }

  function contrastColor(background) {
    const backgroundLuminance = relativeLuminance(background);
    const darkLuminance = relativeLuminance("#09090b");

    const whiteContrast = 1.05 / (backgroundLuminance + 0.05);
    const darkContrast =
      (Math.max(backgroundLuminance, darkLuminance) + 0.05) /
      (Math.min(backgroundLuminance, darkLuminance) + 0.05);

    return darkContrast >= whiteContrast ? "#09090b" : "#ffffff";
  }

  function cssVar(name, fallback) {
    const value = getComputedStyle(els.root).getPropertyValue(name).trim();
    return value || fallback;
  }

  /* ------------------------------------------------------------------------
     Web Audio — generated ticks and a short victory phrase
     ------------------------------------------------------------------------ */
  let audioContext = null;
  let audioBus = null;
  let noiseBuffer = null;

  function getAudioContext() {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;

    if (!audioContext) {
      try {
        audioContext = new AudioCtor();
      } catch (error) {
        return null;
      }
    }

    if (!audioBus) {
      audioBus = audioContext.createGain();
      audioBus.gain.value = 0.9;
      audioBus.connect(audioContext.destination);
    }

    if (audioContext.state === "suspended") {
      audioContext.resume().catch(function () {});
    }

    return audioContext;
  }

  function getNoiseBuffer(ac) {
    if (noiseBuffer) return noiseBuffer;
    const length = Math.max(1, Math.floor(ac.sampleRate * 0.06));
    noiseBuffer = ac.createBuffer(1, length, ac.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    return noiseBuffer;
  }

  function playTick(strength) {
    if (!state.soundOn) return;
    const ac = getAudioContext();
    if (!ac || !audioBus) return;

    const level = typeof strength === "number" ? strength : 1;
    const now = ac.currentTime;

    try {
      const source = ac.createBufferSource();
      source.buffer = getNoiseBuffer(ac);

      const filter = ac.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(1250 + Math.random() * 650, now);
      filter.Q.value = 1.1;

      const gain = ac.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.06 * level, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);

      source.connect(filter);
      filter.connect(gain);
      gain.connect(audioBus);
      source.start(now);
      source.stop(now + 0.06);

      const osc = ac.createOscillator();
      const oscGain = ac.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(980 + Math.random() * 220, now);
      osc.frequency.exponentialRampToValueAtTime(520, now + 0.035);
      oscGain.gain.setValueAtTime(0.0001, now);
      oscGain.gain.exponentialRampToValueAtTime(0.02 * level, now + 0.004);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
      osc.connect(oscGain);
      oscGain.connect(audioBus);
      osc.start(now);
      osc.stop(now + 0.05);
    } catch (error) {
      /* Audio is a progressive enhancement. */
    }
  }

  function playVictory() {
    if (!state.soundOn) return;
    const ac = getAudioContext();
    if (!ac || !audioBus) return;

    const start = ac.currentTime + 0.03;
    const notes = [523.25, 659.25, 783.99, 1046.5];

    try {
      notes.forEach(function (frequency, index) {
        const at = start + index * 0.13;
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(frequency, at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.1, at + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
        osc.connect(gain);
        gain.connect(audioBus);
        osc.start(at);
        osc.stop(at + 0.54);
      });

      const chordAt = start + 0.52;
      [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach(function (frequency) {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(frequency, chordAt);
        gain.gain.setValueAtTime(0.0001, chordAt);
        gain.gain.exponentialRampToValueAtTime(0.045, chordAt + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, chordAt + 0.95);
        osc.connect(gain);
        gain.connect(audioBus);
        osc.start(chordAt);
        osc.stop(chordAt + 1);
      });
    } catch (error) {
      /* Ignore unsupported audio operations. */
    }
  }

  function playTestSound() {
    if (!state.soundOn) return;
    getAudioContext();
    playTick(0.8);
    window.setTimeout(function () {
      playTick(0.55);
    }, 95);
  }

  /* ------------------------------------------------------------------------
     Geometry and wheel drawing
     ------------------------------------------------------------------------ */
  function pointerIndex(rotationDeg, count) {
    if (count <= 0) return -1;
    const segment = 360 / count;
    const offset = -90 - segment / 2;
    const localAtPointer = normalizeDeg(-90 - rotationDeg);
    const relative = normalizeDeg(localAtPointer - offset);
    return Math.floor(relative / segment) % count;
  }

  function resizeCanvas() {
    if (!ctx || !els.canvas) return;
    const width = els.canvas.clientWidth;
    if (!width) return;

    const scale = Math.min(window.devicePixelRatio || 1, 2.5);
    const pixels = Math.max(1, Math.round(width * scale));

    if (els.canvas.width !== pixels || els.canvas.height !== pixels) {
      els.canvas.width = pixels;
      els.canvas.height = pixels;
    }

    drawWheel();
  }

  function scheduleResize() {
    window.cancelAnimationFrame(state.resizeRaf);
    state.resizeRaf = window.requestAnimationFrame(resizeCanvas);
  }

  function drawEmptyWheel(size) {
    const center = size / 2;
    const radius = size / 2 - 3;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(center, center);

    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    ctx.fillStyle = cssVar("--surface-2", "#f6f8fe");
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, radius - 1, 0, TAU);
    ctx.setLineDash([5, 9]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = cssVar("--border-strong", "#d2dbea");
    ctx.stroke();
    ctx.setLineDash([]);

    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * TAU - Math.PI / 2;
      const x = Math.cos(angle) * radius * 0.8;
      const y = Math.sin(angle) * radius * 0.8;
      ctx.beginPath();
      ctx.arc(x, y, i % 3 === 0 ? 3.4 : 2.2, 0, TAU);
      ctx.fillStyle =
        i % 3 === 0
          ? cssVar("--accent", "#6d4aff")
          : cssVar("--border-strong", "#d2dbea");
      ctx.fill();
    }

    ctx.restore();
  }

  function drawWheel() {
    if (!ctx || !els.canvas) return;

    const size = els.canvas.clientWidth;
    if (size < 10) return;

    const pixelRatio = els.canvas.width / size || 1;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const entries = state.entries;
    if (!entries.length) {
      drawEmptyWheel(size);
      return;
    }

    const count = entries.length;
    const segment = TAU / count;
    const offset = -Math.PI / 2 - segment / 2;
    const center = size / 2;
    const radius = size / 2 - 3;
    const fontFamily = getComputedStyle(els.body).fontFamily;
    const ringColor = cssVar("--canvas-ring", "rgba(255,255,255,.9)");
    const lineColor = cssVar("--canvas-line", "rgba(255,255,255,.52)");

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(center, center);

    // Slices
    for (let i = 0; i < count; i += 1) {
      const start = offset + i * segment;
      const end = start + segment;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, start, end);
      ctx.closePath();
      ctx.fillStyle = colorAt(i);
      ctx.fill();
    }

    // Soft top-light gloss for depth.
    const gloss = ctx.createRadialGradient(
      -radius * 0.35,
      -radius * 0.42,
      radius * 0.04,
      0,
      0,
      radius * 1.12
    );
    gloss.addColorStop(0, "rgba(255,255,255,0.18)");
    gloss.addColorStop(0.48, "rgba(255,255,255,0.03)");
    gloss.addColorStop(1, "rgba(8,14,28,0.08)");
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    ctx.fillStyle = gloss;
    ctx.fill();

    // Slice separators
    if (count > 1) {
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = count > 56 ? 0.55 : 1;
      for (let i = 0; i < count; i += 1) {
        const angle = offset + i * segment;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        ctx.stroke();
      }
    }

    // Radial labels
    if (count <= 52) {
      const arcWidth = 2 * radius * Math.sin(segment / 2);
      let fontSize = Math.min(30, size * 0.062, Math.max(8, arcWidth * 0.52));

      const labels = entries.map(function (entry) {
        return truncateLabel(entry, 24);
      });

      ctx.font = "700 " + fontSize + "px " + fontFamily;
      let widest = 0;
      labels.forEach(function (label) {
        widest = Math.max(widest, ctx.measureText(label).width);
      });

      const available = radius * 0.71;
      if (widest > available) {
        fontSize = Math.max(7, fontSize * (available / widest));
        ctx.font = "700 " + fontSize + "px " + fontFamily;
      }

      ctx.textBaseline = "middle";
      ctx.direction = "rtl";
      const textRadius = radius - Math.max(10, size * 0.022);

      labels.forEach(function (label, i) {
        const angle = offset + (i + 0.5) * segment;
        const color = colorAt(i);
        const fill = contrastColor(color);

        ctx.save();
        ctx.rotate(angle);
        ctx.fillStyle = fill;
        ctx.shadowColor =
          fill === "#ffffff" ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.24)";
        ctx.shadowBlur = 2;
        ctx.shadowOffsetY = 1;

        if (Math.cos(angle) < 0) {
          ctx.rotate(Math.PI);
          ctx.textAlign = "left";
          ctx.fillText(label, -textRadius, 0);
        } else {
          ctx.textAlign = "right";
          ctx.fillText(label, textRadius, 0);
        }

        ctx.restore();
      });
    }

    // Outer rim
    ctx.beginPath();
    ctx.arc(0, 0, radius - 1, 0, TAU);
    ctx.lineWidth = Math.max(3, size * 0.01);
    ctx.strokeStyle = ringColor;
    ctx.stroke();

    ctx.restore();
  }

  function pulsePointer() {
    if (!els.pointer || !els.pointer.animate) return;
    if (MOTION_QUERY && MOTION_QUERY.matches) return;

    if (state.pointerAnim) {
      try {
        state.pointerAnim.cancel();
      } catch (error) {
        /* Ignore cancelled animations. */
      }
    }

    state.pointerAnim = els.pointer.animate(
      [
        { transform: "translateX(-50%) translateY(0)" },
        { transform: "translateX(-50%) translateY(3px)" },
        { transform: "translateX(-50%) translateY(0)" },
      ],
      { duration: 100, easing: "ease-out" }
    );
  }


  /* ------------------------------------------------------------------------
     Theme and sound
     ------------------------------------------------------------------------ */
  function syncThemeButton() {
    const isDark = els.root.dataset.theme === "dark";
    const label = isDark ? "التبديل إلى الوضع الفاتح" : "التبديل إلى الوضع الداكن";

    els.themeToggle.setAttribute("aria-label", label);
    els.themeToggle.setAttribute("title", label);
    els.themeToggle.setAttribute("aria-pressed", isDark ? "true" : "false");

    if (els.metaTheme) {
      els.metaTheme.setAttribute("content", isDark ? "#080c17" : "#eef2fb");
    }
  }

  function setTheme(theme, persist) {
    const next = theme === "dark" ? "dark" : "light";
    els.root.dataset.theme = next;
    if (persist) writeStorage(STORAGE_KEYS.theme, next);
    syncThemeButton();
    scheduleResize();
  }

  /* ------------------------------------------------------------------------
     Speed settings
     ------------------------------------------------------------------------ */
  function loadSpeed() {
    const raw = readStorage(STORAGE_KEYS.speed);
    if (raw === null) return DEFAULT_SPEED;

    const value = parseInt(raw, 10);
    if (!Number.isFinite(value)) return DEFAULT_SPEED;
    return clamp(value, 0, 10);
  }

  function syncSpeedUI() {
    if (!els.speedRange) return;

    const speed = state.speed;
    const percent = (speed / 10) * 100;

    els.speedRange.value = String(speed);
    els.speedRange.setAttribute("aria-valuetext", speed + " من 10");
    els.speedRange.style.setProperty("--speed-pct", percent + "%");

    if (els.speedValue) els.speedValue.textContent = String(speed);
    if (els.speedBtn) {
      els.speedBtn.setAttribute("title", "سرعة الدوران: " + speed + " من 10");
    }
  }

  function setSpeed(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;

    state.speed = clamp(Math.round(numeric), 0, 10);
    writeStorage(STORAGE_KEYS.speed, String(state.speed));
    syncSpeedUI();
  }

  function openSpeedModal() {
    if (!els.speedModal || !els.speedModal.hidden || state.spinning) return;

    state.speedLastFocused =
      document.activeElement && document.activeElement !== els.body
        ? document.activeElement
        : els.speedBtn;

    syncSpeedUI();
    els.speedModal.hidden = false;
    els.body.classList.add("modal-open");

    window.requestAnimationFrame(function () {
      if (!els.speedModal.hidden && els.speedRange) {
        try {
          els.speedRange.focus({ preventScroll: true });
        } catch (error) {
          els.speedRange.focus();
        }
      }
    });
  }

  function closeSpeedModal() {
    if (!els.speedModal || els.speedModal.hidden) return;

    els.speedModal.hidden = true;
    els.body.classList.remove("modal-open");

    const target = state.speedLastFocused;
    state.speedLastFocused = null;

    if (target && document.contains(target) && !target.disabled) {
      try {
        target.focus({ preventScroll: true });
      } catch (error) {
        target.focus();
      }
    } else if (els.speedBtn) {
      try {
        els.speedBtn.focus({ preventScroll: true });
      } catch (error) {
        els.speedBtn.focus();
      }
    }
  }

  function syncSoundButton() {
    els.soundToggle.dataset.sound = state.soundOn ? "on" : "off";
    els.soundToggle.setAttribute("aria-pressed", state.soundOn ? "true" : "false");
    const label = state.soundOn ? "إيقاف الصوت" : "تشغيل الصوت";
    els.soundToggle.setAttribute("aria-label", label);
    els.soundToggle.setAttribute("title", label);
  }

  function toggleSound() {
    state.soundOn = !state.soundOn;
    writeStorage(STORAGE_KEYS.sound, state.soundOn ? "on" : "off");
    syncSoundButton();

    if (state.soundOn) {
      getAudioContext();
      playTestSound();
      showToast("تم تشغيل الأصوات");
    } else {
      showToast("تم إيقاف الأصوات");
    }
  }

  /* ------------------------------------------------------------------------
     Toast and last result
     ------------------------------------------------------------------------ */
  function showToast(message) {
    window.clearTimeout(state.toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");

    state.toastTimer = window.setTimeout(function () {
      els.toast.classList.remove("is-visible");
    }, 2400);
  }

  function clearLastResult() {
    els.lastResult.hidden = true;
    els.lastResultName.textContent = "";
    if (els.lastResultDot) els.lastResultDot.style.removeProperty("background");

    if (els.lastResultEmoji) {
      els.lastResultEmoji.pause();
      try {
        els.lastResultEmoji.currentTime = 0;
      } catch (error) {
        /* Ignore seek errors before metadata is ready. */
      }
    }
  }

  function setLastResult(name, index) {
    els.lastResultName.textContent = name;
    if (els.lastResultDot) {
      els.lastResultDot.style.background =
        typeof index === "number" ? colorAt(index) : "";
    }
    els.lastResult.hidden = false;

    if (els.lastResultEmoji) {
      try {
        els.lastResultEmoji.currentTime = 0;
      } catch (error) {
        /* Ignore seek errors before metadata is ready. */
      }

      const playback = els.lastResultEmoji.play();
      if (playback && typeof playback.catch === "function") {
        playback.catch(function () {
          /* Autoplay can be blocked; the static first frame still shows. */
        });
      }
    }
  }

  /* ------------------------------------------------------------------------
     List and counters
     ------------------------------------------------------------------------ */
  function renderList() {
    const fragment = document.createDocumentFragment();
    const entries = state.entries;

    if (!entries.length) {
      const empty = document.createElement("li");
      empty.className = "entries-list__empty";
      empty.textContent = "لا توجد عناصر بعد.";
      fragment.appendChild(empty);
      els.entriesList.replaceChildren(fragment);
      return;
    }

    entries.forEach(function (entry, index) {
      const item = document.createElement("li");
      item.className = "entry-item";
      item.dataset.index = String(index);

      const swatch = document.createElement("span");
      swatch.className = "entry-item__swatch";
      swatch.style.setProperty("--swatch", colorAt(index));
      swatch.setAttribute("aria-hidden", "true");

      const label = document.createElement("span");
      label.className = "entry-item__label";
      label.textContent = entry;
      label.setAttribute("title", entry);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "entry-item__remove";
      remove.disabled = state.spinning;
      remove.setAttribute("aria-label", "حذف " + entry);
      remove.setAttribute("title", "حذف " + entry);
      remove.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';

      item.appendChild(swatch);
      item.appendChild(label);
      item.appendChild(remove);
      fragment.appendChild(item);
    });

    els.entriesList.replaceChildren(fragment);
  }

  function updateMeta() {
    const count = state.entries.length;
    const isEmpty = count === 0;

    els.countBadge.textContent = formatCount(count);
    els.countBadge.setAttribute("title", formatCount(count));
    els.countBadge.setAttribute("aria-label", formatCount(count));

    if (els.hubCount) els.hubCount.textContent = String(count);

    els.emptyState.hidden = !isEmpty;
    els.wheelStage.classList.toggle("is-empty", isEmpty);

    els.canvas.setAttribute(
      "aria-label",
      isEmpty
        ? "عجلة فارغة. أضف عناصر للبدء."
        : "عجلة تحتوي على " + formatCount(count) + ". اضغط للتدوير."
    );
  }

  function syncControls() {
    const count = state.entries.length;
    const busy = state.spinning;

    els.body.classList.toggle("is-spinning", busy);
    els.wheelStage.classList.toggle("is-spinning", busy);
    els.wheelStage.setAttribute("aria-busy", busy ? "true" : "false");

    els.entries.disabled = busy;
    els.hub.disabled = busy || count === 0;
    els.shuffleBtn.disabled = busy || count < 2;
    els.sortBtn.disabled = busy || count < 2;
    els.clearBtn.disabled = busy || count === 0;
    els.saveNamesBtn.disabled = busy || count === 0;
    els.restoreNamesBtn.disabled = busy;
    if (els.speedBtn) els.speedBtn.disabled = busy;

    if (els.spinBtn) {
      els.spinBtn.disabled = busy || count === 0;
      els.spinBtn.setAttribute(
        "aria-label",
        busy ? "جاري تدوير العجلة" : "تدوير العجلة"
      );
    }

    if (els.spinLabel) {
      els.spinLabel.textContent = busy ? "جاري التدوير…" : "تدوير العجلة";
    }

    els.hub.setAttribute(
      "aria-label",
      busy ? "جاري تدوير العجلة" : "تدوير العجلة"
    );

    els.entriesList
      .querySelectorAll(".entry-item__remove")
      .forEach(function (button) {
        button.disabled = busy;
      });
  }

  function resetClearArm() {
    window.clearTimeout(state.clearTimer);
    state.clearArmed = false;
    els.clearBtn.classList.remove("is-armed");
    if (els.clearLabel) els.clearLabel.textContent = "مسح";
  }

  function applyEntries(nextEntries, options) {
    const settings = options || {};
    const next = sanitizeEntries(nextEntries);
    const changed =
      next.length !== state.entries.length ||
      next.some(function (entry, index) {
        return entry !== state.entries[index];
      });

    state.entries = next;

    if (changed) {
      state.winnerBag = [];
      state.lastWinnerIndex = -1;
    }

    if (settings.syncText !== false) {
      els.entries.value = state.entries.join("\n");
    }

    if (settings.persist !== false) saveEntries();
    if (state.clearArmed) resetClearArm();
    if (!state.entries.length) clearLastResult();

    renderList();
    updateMeta();
    drawWheel();
    syncControls();
  }

  /* ------------------------------------------------------------------------
     Winner modal
     ------------------------------------------------------------------------ */
  function openModal(name, index) {
    if (els.modal.hidden === false) return;

    state.lastFocused =
      document.activeElement && document.activeElement !== els.body
        ? document.activeElement
        : null;
    state.currentWinner = name;
    state.currentWinnerIndex = index;

    els.winnerName.textContent = name;

    if (els.modalCard) {
      els.modalCard.style.setProperty(
        "--winner-color",
        typeof index === "number" ? colorAt(index) : ""
      );
    }

    els.modal.hidden = false;
    els.body.classList.add("modal-open");

    playVictory();
    burstConfetti(index);

    window.requestAnimationFrame(function () {
      if (!els.modal.hidden) {
        try {
          els.closeModalBtn.focus({ preventScroll: true });
        } catch (error) {
          els.closeModalBtn.focus();
        }
      }
    });
  }

  function burstConfetti(index) {
    const layer = els.confettiLayer;
    if (!layer) return;

    window.clearTimeout(state.confettiTimer);
    layer.replaceChildren();

    if (MOTION_QUERY && MOTION_QUERY.matches) return;

    const palette = PALETTE.slice();
    const baseColor = typeof index === "number" ? colorAt(index) : null;
    const total = 34;

    for (let i = 0; i < total; i += 1) {
      const piece = document.createElement("span");
      piece.className = "confetti-piece";

      const angle = (i / total) * Math.PI * 2 + Math.random() * 0.4;
      const distance = 110 + Math.random() * 210;
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance * 0.72 + 260 + Math.random() * 180;
      const size = 6 + Math.random() * 7;

      piece.style.setProperty(
        "--color",
        baseColor && i % 3 === 0
          ? baseColor
          : palette[Math.floor(Math.random() * palette.length)]
      );
      piece.style.setProperty("--size", size.toFixed(1) + "px");
      piece.style.setProperty("--dx", dx.toFixed(1) + "px");
      piece.style.setProperty("--dy", dy.toFixed(1) + "px");
      piece.style.setProperty("--midx", (dx * 0.55).toFixed(1) + "px");
      piece.style.setProperty("--midy", (dy * 0.18 - 90).toFixed(1) + "px");
      piece.style.setProperty("--midrot", Math.round(60 + Math.random() * 120) + "deg");
      piece.style.setProperty("--rot", Math.round(240 + Math.random() * 520) + "deg");
      piece.style.setProperty("--duration", (1.5 + Math.random() * 1.1).toFixed(2) + "s");
      piece.style.setProperty("--delay", (Math.random() * 0.16).toFixed(2) + "s");

      layer.appendChild(piece);
    }

    state.confettiTimer = window.setTimeout(function () {
      layer.replaceChildren();
    }, 3200);
  }

  function closeModal() {
    if (els.modal.hidden) return;

    els.modal.hidden = true;
    els.body.classList.remove("modal-open");

    if (els.confettiLayer) {
      window.clearTimeout(state.confettiTimer);
      els.confettiLayer.replaceChildren();
    }

    state.currentWinner = null;
    state.currentWinnerIndex = -1;

    const target = state.lastFocused;
    state.lastFocused = null;

    if (target && document.contains(target) && !target.disabled) {
      try {
        target.focus({ preventScroll: true });
      } catch (error) {
        target.focus();
      }
    } else {
      try {
        els.hub.focus({ preventScroll: true });
      } catch (error) {
        els.hub.focus();
      }
    }
  }


  const AR_COLLATOR = new Intl.Collator("ar", {
    numeric: true,
    sensitivity: "base",
  });

  /* ------------------------------------------------------------------------
     Spin
     ------------------------------------------------------------------------ */
  function spin() {
    if (
      state.spinning ||
      !els.modal.hidden ||
      (els.speedModal && !els.speedModal.hidden)
    ) {
      return;
    }

    const count = state.entries.length;
    if (!count) {
      showToast("أضف عنصراً واحداً على الأقل.");
      focusEditor();
      return;
    }

    resetClearArm();
    if (state.soundOn) getAudioContext();

    const winnerIndex = pickWinnerIndex(count);
    const segmentDeg = 360 / count;
    const targetNormalized = normalizeDeg(-winnerIndex * segmentDeg);
    const currentNormalized = normalizeDeg(state.rotation);
    const delta = normalizeDeg(targetNormalized - currentNormalized);
    const reduced = MOTION_QUERY && MOTION_QUERY.matches;
    const turns = reduced ? 2 : 6 + randomInt(3);
    const speed = clamp(state.speed, 0, 10);
    const duration = reduced
      ? 1200
      : 2400 + (10 - speed) * 800 + randomInt(350);
    const finalRotation = state.rotation + turns * 360 + delta;
    const startRotation = state.rotation;
    const startTime = performance.now();

    state.spinning = true;
    syncControls();

    let lastIndex = pointerIndex(startRotation, count);
    let lastTickAt = 0;

    function easeOut(t) {
      return 1 - Math.pow(1 - t, 4);
    }

    function frame(now) {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const rotation =
        startRotation + (finalRotation - startRotation) * easeOut(progress);

      state.rotation = rotation;
      els.canvas.style.transform = "rotate(" + rotation + "deg)";

      const nextIndex = pointerIndex(rotation, count);
      if (nextIndex !== lastIndex) {
        lastIndex = nextIndex;
        const tickNow = performance.now();
        if (tickNow - lastTickAt >= 26) {
          lastTickAt = tickNow;
          playTick(1);
          pulsePointer();
        }
      }

      if (progress < 1 && state.spinning) {
        window.requestAnimationFrame(frame);
      } else {
        finishSpin(finalRotation);
      }
    }

    window.requestAnimationFrame(frame);
  }

  function finishSpin(finalRotation) {
    state.spinning = false;
    state.rotation = normalizeDeg(finalRotation);
    els.canvas.style.transform = "rotate(" + state.rotation + "deg)";
    syncControls();

    const count = state.entries.length;
    if (!count) return;

    const actualIndex = pointerIndex(state.rotation, count);
    const winner = state.entries[actualIndex];
    if (winner == null) return;

    state.lastWinnerIndex = actualIndex;
    setLastResult(winner, actualIndex);
    openModal(winner, actualIndex);
  }

  /* ------------------------------------------------------------------------
     Editing
     ------------------------------------------------------------------------ */
  function focusEditor() {
    const reduced = MOTION_QUERY && MOTION_QUERY.matches;
    try {
      els.entries.focus({ preventScroll: true });
    } catch (error) {
      els.entries.focus();
    }
    els.entries.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "center",
    });
  }

  function handleInput() {
    if (state.clearArmed) resetClearArm();

    const parsed = parseEntriesText(els.entries.value);
    const overflow = parsed.length > MAX_ENTRIES;
    const next = overflow ? parsed.slice(0, MAX_ENTRIES) : parsed;

    if (overflow) {
      showToast(
        "الحد الأقصى " +
          MAX_ENTRIES +
          " عنصراً — تم الاحتفاظ بأول " +
          MAX_ENTRIES +
          " عنصر."
      );
    }

    applyEntries(next, {
      syncText: overflow,
      persist: true,
    });
  }

  function removeEntry(index) {
    if (state.spinning) return;
    if (!Number.isInteger(index) || index < 0) return;

    const next = state.entries.slice();
    const removed = next[index];
    if (removed == null) return;

    next.splice(index, 1);
    applyEntries(next, { syncText: true, persist: true });
    showToast("تمت إزالة «" + removed + "».");

    window.requestAnimationFrame(function () {
      if (!next.length) {
        els.emptyAddBtn.focus();
      } else {
        els.hub.focus();
      }
    });
  }

  function shuffleEntries() {
    if (state.spinning || state.entries.length < 2) return;

    const next = state.entries.slice();
    for (let i = next.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1);
      const temp = next[i];
      next[i] = next[j];
      next[j] = temp;
    }

    applyEntries(next, { syncText: true, persist: true });
    showToast("تم خلط العناصر.");
  }

  function sortEntries() {
    if (state.spinning || state.entries.length < 2) return;

    const next = state.entries.slice().sort(AR_COLLATOR.compare);
    applyEntries(next, { syncText: true, persist: true });
    showToast("تم ترتيب العناصر.");
  }

  function clearAll() {
    if (state.spinning || !state.entries.length) return;

    if (!state.clearArmed) {
      state.clearArmed = true;
      els.clearBtn.classList.add("is-armed");
      if (els.clearLabel) els.clearLabel.textContent = "تأكيد؟";
      showToast("اضغط «تأكيد؟» مرة أخرى خلال 3 ثوانٍ.");

      state.clearTimer = window.setTimeout(function () {
        resetClearArm();
      }, 3200);
      return;
    }

    resetClearArm();
    applyEntries([], { syncText: true, persist: true });
    showToast("تم مسح القائمة.");
  }

  function saveNames() {
    if (state.spinning) return;

    if (!state.entries.length) {
      showToast("أضف أسماء أولاً ثم احفظها.");
      return;
    }

    const payload = JSON.stringify({
      entries: state.entries.slice(),
      at: Date.now(),
    });

    writeStorage(STORAGE_KEYS.saved, payload);

    if (readStorage(STORAGE_KEYS.saved) !== payload) {
      showToast("تعذّر حفظ الأسماء في هذا المتصفح.");
      return;
    }

    showToast("تم حفظ الأسماء في هذا المتصفح.");
  }

  function restoreNames() {
    if (state.spinning) return;

    const saved = loadSnapshot();
    if (!saved) {
      showToast("لا توجد أسماء محفوظة بعد.");
      return;
    }

    applyEntries(saved, { syncText: true, persist: true });
    showToast("تمت استعادة الأسماء المحفوظة.");
  }

  /* ------------------------------------------------------------------------
     Modal focus trap
     ------------------------------------------------------------------------ */
  function trapModalFocus(event, container) {
    const root = container || els.modal;
    const focusable = Array.from(
      root.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(function (element) {
      return element.offsetParent !== null;
    });

    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (!root.contains(active)) {
      event.preventDefault();
      first.focus();
      return;
    }

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /* ------------------------------------------------------------------------
     Events
     ------------------------------------------------------------------------ */
  function bindEvents() {
    els.themeToggle.addEventListener("click", function () {
      const next = els.root.dataset.theme === "dark" ? "light" : "dark";
      setTheme(next, true);
    });

    els.soundToggle.addEventListener("click", toggleSound);

    els.hub.addEventListener("click", spin);
    els.canvas.addEventListener("click", spin);
    if (els.spinBtn) els.spinBtn.addEventListener("click", spin);

    els.entries.addEventListener("input", handleInput);

    els.entriesList.addEventListener("click", function (event) {
      const button = event.target.closest
        ? event.target.closest(".entry-item__remove")
        : null;
      if (!button) return;

      const item = button.closest(".entry-item");
      if (!item) return;

      removeEntry(Number(item.dataset.index));
    });

    els.shuffleBtn.addEventListener("click", shuffleEntries);
    els.sortBtn.addEventListener("click", sortEntries);
    els.clearBtn.addEventListener("click", clearAll);
    if (els.saveNamesBtn) els.saveNamesBtn.addEventListener("click", saveNames);
    if (els.restoreNamesBtn) {
      els.restoreNamesBtn.addEventListener("click", restoreNames);
    }
    if (els.speedBtn) els.speedBtn.addEventListener("click", openSpeedModal);
    if (els.speedRange) {
      els.speedRange.addEventListener("input", function () {
        setSpeed(els.speedRange.value);
      });
    }
    document.querySelectorAll("[data-close-speed]").forEach(function (element) {
      element.addEventListener("click", closeSpeedModal);
    });
    els.emptyAddBtn.addEventListener("click", focusEditor);

    els.closeModalBtn.addEventListener("click", closeModal);

    document.querySelectorAll("[data-close-modal]").forEach(function (element) {
      element.addEventListener("click", closeModal);
    });

    document.addEventListener("keydown", function (event) {
      if (els.speedModal && !els.speedModal.hidden) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeSpeedModal();
          return;
        }
        if (event.key === "Tab") {
          trapModalFocus(event, els.speedModal);
        }
        return;
      }

      if (!els.modal.hidden) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeModal();
          return;
        }
        if (event.key === "Tab") {
          trapModalFocus(event, els.modal);
        }
        return;
      }

      if (
        event.defaultPrevented ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        return;
      }

      const isSpace = event.code === "Space" || event.key === " ";
      if (!isSpace) return;

      const target = event.target;
      const isInteractive =
        target instanceof Element &&
        target.closest(
          "textarea, input, select, button, a, [contenteditable='true'], [role='button']"
        );

      if (isInteractive) return;

      event.preventDefault();
      spin();
    });

    window.addEventListener("resize", scheduleResize);

    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver(scheduleResize);
      observer.observe(els.wheelStage);
    }

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) scheduleResize();
    });
  }

  /* ------------------------------------------------------------------------
     Init
     ------------------------------------------------------------------------ */
  function init() {
    state.entries = loadEntries();
    state.soundOn = readStorage(STORAGE_KEYS.sound) !== "off";
    state.speed = loadSpeed();

    const savedTheme = readStorage(STORAGE_KEYS.theme);
    els.root.dataset.theme = savedTheme === "dark" ? "dark" : "light";

    syncThemeButton();
    syncSoundButton();
    syncSpeedUI();

    els.entries.value = state.entries.join("\n");
    renderList();
    updateMeta();
    syncControls();

    els.canvas.style.transform = "rotate(0deg)";

    bindEvents();
    scheduleResize();

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(scheduleResize).catch(function () {});
    }
  }

  init();
})();
