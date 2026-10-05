/* ============================================================================
   SKINO — Math Challenge mini-game
   A 30-second arithmetic sprint. Each correct answer banks Crystals; a wrong
   answer costs time. Operands grow with your streak so it stays interesting.
   ========================================================================= */

import { addCrystals, formatCrystals } from './crystals.js';
import { showToast } from './toast.js';

export const ROUND_SECONDS = 30;
export const REWARD_PER_CORRECT = 15;
export const WRONG_PENALTY_SECONDS = 3;

let els = null;
let running = false;
let tickId = null;
let endAt = 0;
let remainingMs = ROUND_SECONDS * 1000;
let score = 0;
let streak = 0;
let earned = 0;
let current = null;

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Build a problem whose difficulty scales with the current score. */
function makeProblem() {
  const level = Math.min(2, Math.floor(score / 5));
  const roll = Math.random();

  let op;
  if (level === 0) op = roll < 0.5 ? '+' : '-';
  else if (level === 1) op = roll < 0.45 ? '+' : roll < 0.8 ? '-' : '×';
  else op = roll < 0.35 ? '+' : roll < 0.65 ? '-' : '×';

  let a;
  let b;
  if (op === '×') {
    a = randInt(3, 12 + level * 4);
    b = randInt(3, 8 + level * 2);
  } else if (op === '+') {
    a = randInt(5, 40 + level * 30);
    b = randInt(5, 40 + level * 30);
  } else {
    a = randInt(20, 60 + level * 40);
    b = randInt(5, Math.max(5, a - 1));
  }

  const answer = op === '×' ? a * b : op === '+' ? a + b : a - b;
  return { text: `${a} ${op} ${b}`, answer };
}

function renderStats() {
  if (!els) return;
  els.time.textContent = `${(Math.max(0, remainingMs) / 1000).toFixed(1)}s`;
  els.score.textContent = String(score);
  els.streak.textContent = String(streak);
}

function feedback(text, kind = '') {
  els.feedback.textContent = text;
  els.feedback.className = `math-feedback${kind ? ` is-${kind}` : ''}`;
}

function nextProblem() {
  current = makeProblem();
  els.problem.textContent = `${current.text} = ?`;
  els.answer.value = '';
  els.answer.focus();
}

function tick() {
  remainingMs = endAt - performance.now();
  if (remainingMs <= 0) {
    remainingMs = 0;
    renderStats();
    end();
    return;
  }
  renderStats();
}

function start() {
  if (running || !els) return;
  running = true;
  score = 0;
  streak = 0;
  earned = 0;
  remainingMs = ROUND_SECONDS * 1000;
  endAt = performance.now() + remainingMs;

  els.start.disabled = true;
  els.answer.disabled = false;
  els.submit.disabled = false;
  els.start.textContent = 'In progress…';
  els.result.dataset.state = 'spin';
  els.result.textContent = 'Round in progress…';
  feedback('');

  nextProblem();
  renderStats();
  tickId = window.setInterval(tick, 100);
}

function end() {
  running = false;
  if (tickId !== null) {
    window.clearInterval(tickId);
    tickId = null;
  }

  els.answer.disabled = true;
  els.submit.disabled = true;
  els.start.disabled = false;
  els.start.textContent = 'Play again';
  els.problem.textContent = '—';
  els.result.dataset.state = earned > 0 ? 'win' : 'lose';
  els.result.textContent =
    score > 0
      ? `Time! ${score} correct — earned ${formatCrystals(earned)} Crystals.`
      : 'Time! No correct answers this round.';

  if (earned > 0) {
    showToast(`Math Challenge: +${formatCrystals(earned)} Crystals`, 'success');
  }
}

function submit(event) {
  event.preventDefault();
  if (!running || !current) return;

  const raw = els.answer.value.trim();
  if (raw === '') return;
  const value = Number(raw);

  if (Number.isFinite(value) && value === current.answer) {
    score += 1;
    streak += 1;
    earned += REWARD_PER_CORRECT;
    addCrystals(REWARD_PER_CORRECT);
    feedback(`Correct  +${REWARD_PER_CORRECT} ◆`, 'right');
  } else {
    streak = 0;
    endAt -= WRONG_PENALTY_SECONDS * 1000;
    feedback(`Wrong — it was ${current.answer}  −${WRONG_PENALTY_SECONDS}s`, 'wrong');
  }

  remainingMs = endAt - performance.now();
  renderStats();

  if (remainingMs > 0) {
    nextProblem();
  } else {
    remainingMs = 0;
    renderStats();
    end();
  }
}

export function initMathGame() {
  const panel = document.querySelector('[data-math-panel]');
  if (!panel) return;

  els = {
    problem: panel.querySelector('[data-math-problem]'),
    answer: panel.querySelector('[data-math-answer]'),
    form: panel.querySelector('[data-math-form]'),
    submit: panel.querySelector('[data-math-submit]'),
    start: panel.querySelector('[data-math-start]'),
    time: panel.querySelector('[data-math-time]'),
    score: panel.querySelector('[data-math-score]'),
    streak: panel.querySelector('[data-math-streak]'),
    feedback: panel.querySelector('[data-math-feedback]'),
    result: panel.querySelector('[data-math-result]'),
  };

  els.form.addEventListener('submit', submit);
  els.start.addEventListener('click', start);
}
