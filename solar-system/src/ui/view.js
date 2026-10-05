// =============================================================================
// view.js — landscape lock for phones.
//
// Websites can't lock the screen orientation on iPhone, so when a touch
// device shows the page in portrait (for example with the iPhone's Portrait
// Orientation Lock on while lying down) the whole page is turned 90° with a
// CSS transform and the game keeps playing in landscape. Everything that
// sizes or places things on screen asks viewSize(), and touch input converts
// screen points with toView().
// =============================================================================

// Phones and tablets (`?touch=1` / `?touch=0` force it on or off).
const params = new URLSearchParams(globalThis.location?.search || '');
export const IS_TOUCH = params.get('touch') === '1' ||
  (params.get('touch') !== '0' && !!globalThis.matchMedia?.('(pointer: coarse)').matches);

const KEY = 'solv-landscape-side';
let side = 'right'; // which phone edge is "up" for the game when turned
try { if (localStorage.getItem(KEY) === 'left') side = 'left'; } catch (e) { /* default */ }

const view = { rot: 0, w: 0, h: 0 };

/** Recompute the rotation from the window size; call on every resize. */
export function updateView() {
  const W = window.innerWidth, H = window.innerHeight;
  const body = document.body;
  view.rot = IS_TOUCH && H > W ? (side === 'right' ? 90 : -90) : 0;
  if (!body) { view.w = W; view.h = H; return view; }
  body.classList.toggle('rot', view.rot !== 0);
  body.classList.toggle('rot-left', view.rot === -90);
  if (view.rot) {
    view.w = H;
    view.h = W;
    Object.assign(body.style, {
      width: `${H}px`,
      height: `${W}px`,
      transformOrigin: '0 0',
      transform: view.rot === 90 ? `translateX(${W}px) rotate(90deg)` : `translateY(${H}px) rotate(-90deg)`,
    });
  } else {
    view.w = W;
    view.h = H;
    Object.assign(body.style, { width: '', height: '', transformOrigin: '', transform: '' });
  }
  return view;
}

/** The game's screen size (landscape when turned). */
export function viewSize() {
  return view.w ? view : updateView();
}

/** Convert a screen point (clientX, clientY) into game coordinates. */
export function toView(x, y) {
  if (view.rot === 90) return { x: y, y: window.innerWidth - x };
  if (view.rot === -90) return { x: window.innerHeight - y, y: x };
  return { x, y };
}

/** Swap which side of the phone the top of the game faces. */
export function flipView() {
  side = side === 'right' ? 'left' : 'right';
  try { localStorage.setItem(KEY, side); } catch (e) { /* not saved */ }
  window.dispatchEvent(new Event('resize'));
}
