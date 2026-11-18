// Settings modal: language, theme, reduced motion, sound/volume, keybinds.
// Wired by main.js via initSettings(ctx).
import { setLang, t, applyI18n } from './i18n.js';
import * as sfx from './sound.js';
import { getBinds, setRebindTarget } from './input.js';
import { emit } from './events.js';

let ctx = null; // { hotbarEl, helpGridEl, HELP, HOTBAR, BLOCK_INFO, renderKeyBinds }
const $ = (id) => document.getElementById(id);
const segLang = $('segLang');
const segTheme = $('segTheme');
const tglMotion = $('tglMotion');
const tglSound = $('tglSound');
const volSlider = $('volSlider');
const keyBindsEl = $('keyBinds');

const BIND_ROWS = [
  ['move', 0, 'key.move'], ['move', 1, 'key.move'], ['move', 2, 'key.move'], ['move', 3, 'key.move'],
  ['jump', 0, 'key.jump'], ['sprint', 0, 'key.sprint'],
  ['drop', 0, 'key.drop'], ['inv', 0, 'key.inv'], ['pause', 0, 'key.quit']
];

function syncSeg(seg, value) {
  [...seg.children].forEach((b) => b.classList.toggle('is-on', b.dataset.lang === value || b.dataset.theme === value));
}

function setTheme(th) {
  document.documentElement.setAttribute('data-theme', th);
  syncSeg(segTheme, th);
  localStorage.setItem('vw-theme', th);
}

function setReducedMotion(on) {
  document.documentElement.setAttribute('data-ui-motion', on ? 'reduced' : 'full');
  tglMotion.setAttribute('aria-pressed', String(on));
  localStorage.setItem('vw-motion', on ? '1' : '0');
}

function keyLabel(code) {
  if (!code) return '?';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5);
  return code;
}

function renderKeyBinds() {
  keyBindsEl.innerHTML = BIND_ROWS.map(([action, idx, key], row) =>
    '<div class="keybind"><span>' + t(key) + '</span>' +
    '<button class="keybind__key" data-action="' + action + '" data-idx="' + idx + '">' + keyLabel(getBinds()[action][idx]) + '</button></div>'
  ).join('');
}

function setSound(on) {
  sfx.setEnabled(on);
  tglSound.setAttribute('aria-pressed', String(on));
  localStorage.setItem('vw-sound', on ? '1' : '0');
}

function setVolume(v) {
  sfx.setVolume(v);
  volSlider.value = Math.round(v * 100);
  localStorage.setItem('vw-vol', String(v));
}

export function initSettings(c) {
  ctx = c;
  segLang.addEventListener('click', (e) => {
    const l = e.target.dataset.lang;
    if (!l) return;
    setLang(l);
    applyI18n();
    syncSeg(segLang, l);
    localStorage.setItem('vw-lang', l);
    // Rebuild hotbar names + help grid in the new language
    c.renderHotbarNames();
    c.renderHelpGrid();
    emit('langChanged', { lang: l });
  });
  segTheme.addEventListener('click', (e) => {
    const th = e.target.dataset.theme;
    if (th) setTheme(th);
  });
  tglMotion.addEventListener('click', () => {
    setReducedMotion(tglMotion.getAttribute('aria-pressed') !== 'true');
  });
  tglSound.addEventListener('click', () => {
    setSound(tglSound.getAttribute('aria-pressed') !== 'true');
    sfx.unlock();
    sfx.uiClick();
  });
  volSlider.addEventListener('input', () => setVolume(volSlider.value / 100));
  keyBindsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.keybind__key');
    if (!b) return;
    setRebindTarget({ action: b.dataset.action, index: +b.dataset.idx });
    [...keyBindsEl.querySelectorAll('.keybind__key')].forEach((x) => x.classList.toggle('is-listening', x === b));
  });
  renderKeyBinds();
  // Restore saved settings
  setSound(localStorage.getItem('vw-sound') !== '0');
  setVolume(parseFloat(localStorage.getItem('vw-vol') ?? '0.5'));
  setLang(localStorage.getItem('vw-lang') || 'ru');
  setTheme(localStorage.getItem('vw-theme') || 'dark');
  setReducedMotion(localStorage.getItem('vw-motion') === '1');
  applyI18n();
  syncSeg(segLang, localStorage.getItem('vw-lang') || 'ru');
}

export function renderKeyBindsPublic() { renderKeyBinds(); }
