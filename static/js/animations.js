/* animations.js — Bold, diabetes-themed visual effects v2
   Glucose particles · Heartbeat EKG · DNA helix · Risk glow orbs
   Morphing blob · Particle trails · Odometer numbers
   ------------------------------------------------------------------ */

(() => {
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (REDUCED) return;

  /* ================================================================
     1. FLOATING GLUCOSE / HEALTH PARTICLES — hero background canvas
     ================================================================ */
  function initParticles() {
    const pageHead = document.querySelector('.page-head');
    if (!pageHead) return;

    const canvas = document.createElement('canvas');
    canvas.id = 'hero-particles';
    canvas.setAttribute('aria-hidden', 'true');
    pageHead.style.position = 'relative';
    pageHead.style.overflow = 'hidden';
    pageHead.insertBefore(canvas, pageHead.firstChild);

    const SHAPES = ['circle', 'hexagon', 'drop', 'cross', 'triangle'];
    const particles = [];
    const N = window.innerWidth < 640 ? 22 : 44;

    function resize() {
      canvas.width  = pageHead.offsetWidth;
      canvas.height = pageHead.offsetHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    const ctx = canvas.getContext('2d');

    function hexPath(cx, cy, r) {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        i === 0 ? ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
                : ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
      }
      ctx.closePath();
    }

    function triPath(cx, cy, r) {
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = (Math.PI * 2 / 3) * i - Math.PI / 2;
        i === 0 ? ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
                : ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
      }
      ctx.closePath();
    }

    function crossPath(cx, cy, r) {
      const t = r * 0.3;
      ctx.beginPath();
      ctx.rect(cx - t, cy - r, t * 2, r * 2);
      ctx.rect(cx - r, cy - t, r * 2, t * 2);
    }

    function makeParticle() {
      return {
        x: Math.random() * (canvas.width  || 800),
        y: Math.random() * (canvas.height || 200),
        r: 2 + Math.random() * 10,
        shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
        speed: 0.15 + Math.random() * 0.38,
        angle: Math.random() * Math.PI * 2,
        spin:  (Math.random() - 0.5) * 0.014,
        alpha: 0.05 + Math.random() * 0.14,
        rot:   0,
        hue:   170 + Math.floor(Math.random() * 80),
        pulse: Math.random() * Math.PI * 2,
        pulseSpeed: 0.02 + Math.random() * 0.03,
      };
    }

    for (let i = 0; i < N; i++) particles.push(makeParticle());

    let raf;
    function tick() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const p of particles) {
        p.x += Math.cos(p.angle) * p.speed;
        p.y += Math.sin(p.angle) * p.speed * 0.42;
        p.angle += (Math.random() - 0.5) * 0.025;
        p.rot += p.spin;
        p.pulse += p.pulseSpeed;
        const pulseAlpha = p.alpha * (0.7 + 0.3 * Math.sin(p.pulse));

        if (p.x < -20) p.x = canvas.width  + 20;
        if (p.x > canvas.width  + 20) p.x = -20;
        if (p.y < -20) p.y = canvas.height + 20;
        if (p.y > canvas.height + 20) p.y = -20;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = pulseAlpha;
        ctx.fillStyle = `hsl(${p.hue}, 60%, 55%)`;
        ctx.strokeStyle = `hsl(${p.hue}, 70%, 65%)`;
        ctx.lineWidth = 1;

        switch (p.shape) {
          case 'hexagon':  hexPath(0, 0, p.r); ctx.fill(); break;
          case 'triangle': triPath(0, 0, p.r); ctx.fill(); break;
          case 'drop':
            ctx.beginPath();
            ctx.arc(0, 0, p.r * 0.7, 0, Math.PI * 2);
            ctx.fill();
            break;
          case 'cross':  crossPath(0, 0, p.r); ctx.fill(); break;
          default:
            ctx.beginPath();
            ctx.arc(0, 0, p.r, 0, Math.PI * 2);
            ctx.fill();
            break;
        }
        ctx.restore();
      }
      raf = requestAnimationFrame(tick);
    }
    tick();

    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) raf = requestAnimationFrame(tick);
      else cancelAnimationFrame(raf);
    });
    obs.observe(canvas);
  }

  /* ================================================================
     2. EKG HEARTBEAT LINE — animated SVG across the readout panel
     ================================================================ */
  function initEKGLine() {
    const readout = document.querySelector('.readout');
    if (!readout) return;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ekg-line');
    svg.setAttribute('viewBox', '0 0 340 40');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = `
      <polyline class="ekg-path" points="
        0,20 20,20 28,20 32,8 36,32 40,4 44,36 48,20 56,20
        76,20 84,20 88,8 92,32 96,4 100,36 104,20 112,20
        132,20 140,20 144,8 148,32 152,4 156,36 160,20 168,20
        188,20 196,20 200,8 204,32 208,4 212,36 216,20 224,20
        244,20 252,20 256,8 260,32 264,4 268,36 272,20 280,20
        300,20 308,20 312,8 316,32 320,4 324,36 328,20 340,20"
        fill="none" stroke="rgba(95,216,170,0.3)" stroke-width="1.5"
        stroke-linecap="round" stroke-linejoin="round"/>
      <polyline class="ekg-path ekg-bright" points="
        0,20 20,20 28,20 32,8 36,32 40,4 44,36 48,20 56,20"
        fill="none" stroke="rgba(95,216,170,0.9)" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round"/>
    `;
    readout.insertBefore(svg, readout.firstChild);
  }

  /* ================================================================
     3. MORPHING BLOB — ambient background element
     ================================================================ */
  function initMorphBlob() {
    const body = document.body;
    const blob = document.createElement('div');
    blob.className = 'morph-blob';
    blob.setAttribute('aria-hidden', 'true');
    body.prepend(blob);
  }

  /* ================================================================
     4. RIPPLE on button click
     ================================================================ */
  function initRipple() {
    document.querySelectorAll('.btn').forEach((btn) => {
      btn.style.position = 'relative';
      btn.style.overflow = 'hidden';

      btn.addEventListener('click', (e) => {
        const rect = btn.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const r = document.createElement('span');
        r.className = 'btn-ripple';
        r.style.cssText = `left:${x}px;top:${y}px`;
        btn.appendChild(r);
        setTimeout(() => r.remove(), 700);
      });
    });
  }

  /* ================================================================
     5. ODOMETER / SLOT-MACHINE counter for stat numbers
     ================================================================ */
  function odometerIn(el) {
    const text = el.textContent.trim();
    const match = text.match(/^([+\-]?)(\d+\.?\d*)(.*)$/);
    if (!match) return;
    const [, sign, numStr, suffix] = match;
    const to = parseFloat(numStr);
    if (isNaN(to)) return;
    const decimals = (numStr.includes('.') ? numStr.split('.')[1].length : 0);

    el.innerHTML = '';
    const digits = numStr.split('');
    const spans = digits.map((d) => {
      const s = document.createElement('span');
      s.className = 'odometer-digit';
      s.textContent = d === '.' ? '.' : '0';
      s.dataset.target = d;
      el.appendChild(s);
      return s;
    });
    if (sign) el.prepend(Object.assign(document.createElement('span'), { textContent: sign }));
    if (suffix) el.appendChild(Object.assign(document.createElement('span'), { textContent: suffix }));

    spans.forEach((s, i) => {
      if (s.dataset.target === '.') { s.textContent = '.'; return; }
      const target = parseInt(s.dataset.target, 10);
      let cur = 0;
      const delay = i * 80;
      const steps = 10 + Math.floor(Math.random() * 6);
      let step = 0;

      setTimeout(() => {
        const iv = setInterval(() => {
          cur = step < steps - 1 ? Math.floor(Math.random() * 10) : target;
          s.textContent = cur;
          s.classList.toggle('odometer-flash', step < steps - 1);
          step++;
          if (step >= steps) clearInterval(iv);
        }, 60);
      }, delay);
    });
  }

  function initStatCounters() {
    document.querySelectorAll('.stats dd').forEach((dd) => {
      const observer = new IntersectionObserver(([e]) => {
        if (!e.isIntersecting) return;
        observer.disconnect();
        odometerIn(dd);
      }, { threshold: 0.5 });
      observer.observe(dd);
    });
  }

  /* ================================================================
     6. SCROLL-TRIGGERED REVEAL with direction variants
     ================================================================ */
  function initScrollReveal() {
    const targets = [
      ...document.querySelectorAll('.section'),
      ...document.querySelectorAll('.details-col'),
      ...document.querySelectorAll('.cmp-group'),
      ...document.querySelectorAll('.model-bar-row'),
      ...document.querySelectorAll('.stats > div'),
      ...document.querySelectorAll('.convert-panel'),
      ...document.querySelectorAll('.info-banner'),
      ...document.querySelectorAll('.gender-notice'),
    ];
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('revealed');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.10, rootMargin: '0px 0px -30px 0px' });
    targets.forEach((el, i) => {
      el.classList.add('reveal-target');
      el.style.transitionDelay = `${(i % 4) * 60}ms`;
      io.observe(el);
    });
  }

  /* ================================================================
     7. SLIDER BURST + VALUE POP (already in main.js, reinforce here)
     ================================================================ */
  function initSliderBursts() {
    document.querySelectorAll('input[type="range"]').forEach((slider) => {
      slider.addEventListener('input', () => {
        slider.classList.remove('burst');
        void slider.offsetWidth;
        slider.classList.add('burst');
        setTimeout(() => slider.classList.remove('burst'), 450);
      });
    });
  }

  /* ================================================================
     8. GLOW ORBS — ambient background spheres
     ================================================================ */
  function initGlowOrbs() {
    [
      { color: 'rgba(36, 54, 199, 0.07)', size: 500, top: '2%',  left: '-15%', dur: 16 },
      { color: 'rgba(95, 216, 170, 0.09)', size: 380, top: '38%', left: '78%',  dur: 20 },
      { color: 'rgba(193, 58, 58, 0.06)',  size: 300, top: '72%', left: '8%',   dur: 24 },
      { color: 'rgba(243, 188, 85, 0.05)', size: 250, top: '15%', left: '55%',  dur: 12 },
    ].forEach(({ color, size, top, left, dur }, i) => {
      const orb = document.createElement('div');
      orb.className = 'glow-orb';
      orb.style.cssText = `
        width:${size}px; height:${size}px;
        background: radial-gradient(circle, ${color} 0%, transparent 70%);
        top:${top}; left:${left};
        animation: orbFloat ${dur}s ease-in-out infinite alternate;
        animation-delay: ${i * 3}s;
      `;
      document.body.prepend(orb);
    });
  }

  /* ================================================================
     9. GAUGE HEARTBEAT PULSE OBSERVER
     ================================================================ */
  function initGaugePulse() {
    const gauge = document.getElementById('gauge');
    if (!gauge) return;

    const observer = new MutationObserver(() => {
      const level = gauge.dataset.level;
      if (!level || level === 'none') return;
      gauge.classList.remove('pulse-low', 'pulse-moderate', 'pulse-high');
      void gauge.offsetWidth;
      gauge.classList.add(`pulse-${level}`);
    });
    observer.observe(gauge, { attributes: true, attributeFilter: ['data-level'] });
  }

  /* ================================================================
     10. RISK LABEL TYPEWRITER
     ================================================================ */
  function initRiskTypewriter() {
    const riskLabel = document.getElementById('riskLabel');
    if (!riskLabel) return;
    let timer = null;

    const observer = new MutationObserver(() => {
      const text = riskLabel.dataset._target || riskLabel.textContent;
      if (!text || text === 'Not checked yet') return;
      riskLabel.dataset._target = text;

      clearInterval(timer);
      riskLabel.textContent = '';
      let i = 0;
      timer = setInterval(() => {
        riskLabel.textContent += text[i++];
        if (i >= text.length) clearInterval(timer);
      }, 45);
    });
    observer.observe(riskLabel, { childList: true });
  }

  /* ================================================================
     11. GLUCOSE DROP SVG — bobbing decoration on readout
     ================================================================ */
  function initGlucoseDrop() {
    const readout = document.querySelector('.readout');
    if (!readout) return;

    const drop = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    drop.setAttribute('class', 'deco-drop');
    drop.setAttribute('viewBox', '0 0 60 80');
    drop.setAttribute('aria-hidden', 'true');
    drop.innerHTML = `
      <path class="drop-shape"
        d="M30 4 C30 4 6 36 6 52 a24 24 0 0 0 48 0 C54 36 30 4 30 4Z"
        fill="none" stroke="rgba(95,216,170,0.25)" stroke-width="2"/>
      <path class="drop-inner"
        d="M30 22 C30 22 16 44 16 52 a14 14 0 0 0 28 0 C44 44 30 22 30 22Z"
        fill="rgba(95,216,170,0.08)"/>
      <line class="drop-shine" x1="22" y1="40" x2="18" y2="52"
        stroke="rgba(255,255,255,0.2)" stroke-width="2" stroke-linecap="round"/>
    `;
    readout.prepend(drop);
  }

  /* ================================================================
     12. STAGGER TABLE ROWS in history table
     ================================================================ */
  function initTableStagger() {
    const tbody = document.getElementById('historyBody');
    if (!tbody) return;

    const observer = new MutationObserver(() => {
      tbody.querySelectorAll('tr:not(.row-animated)').forEach((tr, i) => {
        tr.classList.add('row-animated');
        tr.style.animationDelay = `${i * 55}ms`;
        tr.classList.add('table-row-in');
      });
    });
    observer.observe(tbody, { childList: true });
  }

  /* ================================================================
     13. CONVERTER PANEL SLIDE ANIMATION
     ================================================================ */
  function initConverterAnim() {
    const btnFt = document.getElementById('btnFt');
    const btnLbs = document.getElementById('btnLbs');
    const ftPanel = document.getElementById('ftInPanel');
    const lbsWrap = document.getElementById('lbsInputWrap');

    btnFt?.addEventListener('click', () => {
      if (ftPanel) {
        ftPanel.classList.add('panel-opening');
        setTimeout(() => ftPanel.classList.remove('panel-opening'), 400);
      }
    });
    btnLbs?.addEventListener('click', () => {
      if (lbsWrap) {
        lbsWrap.classList.add('panel-opening');
        setTimeout(() => lbsWrap.classList.remove('panel-opening'), 400);
      }
    });
  }

  /* ================================================================
     14. SECTION BORDER GLOW on focus-within
     ================================================================ */
  function initSectionGlow() {
    document.querySelectorAll('.section').forEach((sec) => {
      sec.addEventListener('focusin', () => sec.classList.add('section-glow'));
      sec.addEventListener('focusout', () => {
        if (!sec.contains(document.activeElement)) sec.classList.remove('section-glow');
      });
    });
  }

  /* ================================================================
     INIT ALL
     ================================================================ */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  function boot() {
    initParticles();
    initEKGLine();
    initMorphBlob();
    initRipple();
    initStatCounters();
    initScrollReveal();
    initSliderBursts();
    initGlowOrbs();
    initGaugePulse();
    initRiskTypewriter();
    initGlucoseDrop();
    initTableStagger();
    initConverterAnim();
    initSectionGlow();
  }

})();
