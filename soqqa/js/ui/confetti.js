/* ============================================================================
   SOQQA — confetti celebrations (canvas, no dependencies)
   A short gold/neon particle burst fired the moment a spin pays. Two particle
   shapes: paper ribbons that tumble under gravity, and additive sparks that
   read as light. `fan` spreads the burst across the viewport instead of
   popping from one point, which is what a jackpot uses.
   Silently disabled when the player prefers reduced motion (or without a
   canvas).
   ========================================================================= */

const COLORS = Object.freeze(['#e8c46a', '#f9eec1', '#39e6d0', '#8b5cf6', '#ff4d9d', '#d4a83a']);
/** Sparks skew golden-white and cyan, so they read as glints rather than paper. */
const SPARK_COLORS = Object.freeze(['#fff6d8', '#f9eec1', '#e8c46a', '#39e6d0']);

const GRAVITY = 0.14;
const DRAG = 0.995;
/** Chance a particle is a glint instead of a ribbon. */
const SPARK_CHANCE = 0.34;

export function createConfetti(canvas = null) {
  const element = canvas ?? (typeof document !== 'undefined' ? document.querySelector('#confetti-canvas') : null);
  const context = element?.getContext ? element.getContext('2d') : null;

  let particles = [];
  let frame = 0;
  let width = 0;
  let height = 0;
  let dpr = 1;

  const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function resize() {
    if (!element || !context || typeof window === 'undefined') return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    width = element.clientWidth || window.innerWidth;
    height = element.clientHeight || window.innerHeight;
    element.width = Math.floor(width * dpr);
    element.height = Math.floor(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * @param {number} count — particles to add
   * @param {number} [originX] — centre of the burst, in px (defaults to the middle)
   * @param {number} [spread] — horizontal scatter width, in px
   */
  function spawn(count, originX, spread) {
    const centre = originX === undefined ? width / 2 : originX;

    for (let i = 0; i < count; i += 1) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
      const speed = 6 + Math.random() * 9;
      const spark = Math.random() < SPARK_CHANCE;
      const palette = spark ? SPARK_COLORS : COLORS;

      particles.push({
        x: centre + (Math.random() - 0.5) * spread,
        y: height * 0.42,
        vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 3,
        vy: Math.sin(angle) * speed,
        size: 5 + Math.random() * 7,
        color: palette[Math.floor(Math.random() * palette.length)],
        shape: spark ? 'spark' : 'ribbon',
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.3,
        life: spark ? 55 + Math.random() * 45 : 90 + Math.random() * 60,
        age: 0,
      });
    }
  }

  function tick() {
    if (!context) return;
    frame = 0;
    context.clearRect(0, 0, width, height);

    particles = particles.filter((p) => p.age < p.life && p.y < height + 60);

    for (const particle of particles) {
      particle.age += 1;
      particle.vy += GRAVITY;
      particle.vx *= DRAG;
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.rotation += particle.spin;

      const alpha = Math.max(0, 1 - particle.age / particle.life);
      context.save();
      context.globalAlpha = alpha;
      context.translate(particle.x, particle.y);
      context.rotate(particle.rotation);
      context.fillStyle = particle.color;

      if (particle.shape === 'spark') {
        // Additive, so a glint brightens what is behind it instead of covering it.
        context.globalCompositeOperation = 'lighter';
        context.beginPath();
        context.moveTo(0, -particle.size);
        context.lineTo(particle.size * 0.26, 0);
        context.lineTo(0, particle.size);
        context.lineTo(-particle.size * 0.26, 0);
        context.closePath();
        context.fill();
      } else {
        context.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size * 0.62);
      }

      context.restore();
    }

    if (particles.length > 0) {
      frame = requestAnimationFrame(tick);
    } else {
      context.clearRect(0, 0, width, height);
    }
  }

  function ensureLoop() {
    if (frame) return;
    if (typeof requestAnimationFrame !== 'function') return;
    frame = requestAnimationFrame(tick);
  }

  if (element && context && typeof window !== 'undefined') {
    resize();
    window.addEventListener('resize', resize);
  }

  return {
    /**
     * Fire a celebration.
     * @param {{
     *   intensity?: number, — burst size multiplier (1 ≈ a plain win)
     *   originX?: number, — centre of the burst, in px
     *   fan?: number, — number of burst origins across the viewport (1–4)
     * }} [options]
     * @returns {boolean} whether anything was fired
     */
    celebrate({ intensity = 1, originX, fan = 1 } = {}) {
      if (!element || !context || prefersReducedMotion()) return false;

      const total = Math.round(90 * intensity);
      const waves = Math.max(1, Math.min(4, Math.round(fan)));

      if (waves === 1) {
        spawn(total, originX, width * 0.5);
      } else {
        // A fan of bursts, so the biggest win fills the viewport rather than
        // popping from a single point. One call — the screen just gets louder.
        const perWave = Math.max(1, Math.round(total / waves));
        for (let i = 0; i < waves; i += 1) {
          const x = originX ?? width * (0.16 + (0.68 * i) / (waves - 1));
          spawn(perWave, x, width * 0.22);
        }
      }

      ensureLoop();
      return true;
    },

    stop() {
      particles = [];
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      frame = 0;
      if (context) context.clearRect(0, 0, width, height);
    },

    destroy() {
      this.stop();
      if (typeof window !== 'undefined') window.removeEventListener('resize', resize);
    },

    get active() {
      return particles.length;
    },
  };
}
