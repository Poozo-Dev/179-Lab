// geometry.js — pure maths for the photo viewer and the level overlay. No DOM, unit-tested.

// ---------------- viewer: screen <-> saved-image pixels ----------------
// The image is shown "contained" in a stage of size (sw, sh), centred, then scaled by `scale` and shifted by
// (tx, ty) around the stage centre. view = { sw, sh, nw, nh, scale, tx, ty } (nw, nh = image pixel size).
export const fitScale = (v) => Math.min(v.sw / v.nw, v.sh / v.nh) || 1;

/** Stage-relative screen point (px from the stage's top-left) -> image pixel (may lie outside the image). */
export function screenToImage(v, sx, sy) {
  const k = v.scale * fitScale(v);
  return { x: (sx - v.sw / 2 - v.tx) / k + v.nw / 2, y: (sy - v.sh / 2 - v.ty) / k + v.nh / 2 };
}
export function imageToScreen(v, ix, iy) {
  const k = v.scale * fitScale(v);
  return { x: v.sw / 2 + v.tx + k * (ix - v.nw / 2), y: v.sh / 2 + v.ty + k * (iy - v.nh / 2) };
}

// ---------------- level: physical vertical projected into the picture ----------------
/**
 * From DeviceOrientation angles (degrees) and the screen rotation (0/90/180/270), the angle in degrees by
 * which physical UP leans to the RIGHT of the screen's (= the live picture's) up direction, or null when
 * the phone is too close to flat for the projection to mean anything (camera pointing up or down).
 *
 * W3C device frame: x right, y up (towards the top of the phone), z out of the screen.
 * With R = Rz(alpha)·Rx(beta)·Ry(gamma), gravity ("down") in device coordinates is
 *   ( cos(beta)·sin(gamma),  -sin(beta),  -cos(beta)·cos(gamma) ).
 * Only its component in the screen plane is used; alpha (compass heading) does not enter.
 */
export function tiltFromOrientation(betaDeg, gammaDeg, screenAngleDeg = 0, minInPlane = 0.5) {
  if (!Number.isFinite(betaDeg) || !Number.isFinite(gammaDeg)) return null;
  const r = Math.PI / 180, b = betaDeg * r, g = gammaDeg * r;
  let ux = -Math.cos(b) * Math.sin(g), uy = Math.sin(b);   // physical up in device x/y
  if (Math.hypot(ux, uy) < minInPlane) return null;          // phone nearly flat: unreliable
  const a = (screenAngleDeg || 0) * r;                        // device -> screen: rotate by +a
  const sx = ux * Math.cos(a) - uy * Math.sin(a), sy = ux * Math.sin(a) + uy * Math.cos(a);
  return Math.atan2(sx, sy) / r;
}

/** Smooth angles (degrees) without the jump at ±180°. */
export class AngleSmoother {
  constructor(k = 0.2) { this.k = k; this.c = null; this.s = null; }
  push(deg) {
    if (deg === null) { this.c = this.s = null; return null; }
    const r = deg * Math.PI / 180;
    if (this.c === null) { this.c = Math.cos(r); this.s = Math.sin(r); }
    else { this.c += this.k * (Math.cos(r) - this.c); this.s += this.k * (Math.sin(r) - this.s); }
    return Math.atan2(this.s, this.c) * 180 / Math.PI;
  }
}
