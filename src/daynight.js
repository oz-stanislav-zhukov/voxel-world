// Day/night cycle math. Pure functions, node-testable.
// time is in [0,1): 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset.

export const DAY_LENGTH = 600; // seconds for a full day

// Sun elevation: -1 (straight down) .. 1 (straight up).
export function sunElevation(time) {
  return Math.sin((time - 0.25) * Math.PI * 2);
}

// Light factor 0..1 with a smooth twilight band around the horizon.
export function daylight(time) {
  const e = sunElevation(time);
  if (e > 0.15) return 1;
  if (e < -0.15) return 0;
  return (e + 0.15) / 0.3;
}

function lerp(a, b, t) { return a + (b - a) * t; }
function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// Sky color [r,g,b] in 0..1.
export function skyColor(time) {
  const d = daylight(time);
  const day = [0.62, 0.82, 0.96];
  const night = [0.02, 0.03, 0.08];
  const dusk = [0.95, 0.5, 0.3];
  let c = mix(night, day, d);
  // Dusk tint near the horizon crossings
  const e = sunElevation(time);
  const duskAmt = Math.max(0, 1 - Math.abs(e) / 0.3) * 0.55;
  c = mix(c, dusk, duskAmt);
  return c;
}

// Sun / moon direction (unit vector, y up).
export function sunDirection(time) {
  const a = (time - 0.25) * Math.PI * 2;
  return { x: Math.cos(a), y: Math.sin(a), z: 0.35 };
}

export function moonDirection(time) {
  const s = sunDirection(time);
  return { x: -s.x, y: -s.y, z: -s.z };
}

// Is it night (for zombie spawning etc.)?
export function isNight(time) {
  return daylight(time) < 0.25;
}

// Clock label like 12:34. time 0 = midnight, 0.5 = noon.
export function clockLabel(time) {
  const mins = Math.floor((time * 24 * 60) % 1440);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
