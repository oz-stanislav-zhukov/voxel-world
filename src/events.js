// Tiny event bus: modules talk via signals, not direct calls.
// Events: damage {n}, death, respawn, pickup {id,n}, place {id}, craft {id,n},
//          swing, blockChanged {x,y,z,id}, modalOpen, modalClosed, langChanged
const listeners = new Map();

export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => off(evt, fn);
}

export function off(evt, fn) {
  const s = listeners.get(evt);
  if (s) s.delete(fn);
}

export function emit(evt, data) {
  const s = listeners.get(evt);
  if (!s) return;
  for (const fn of [...s]) fn(data);
}
