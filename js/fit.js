// fit.js — least-squares parabola  y = a·x² + b·x + c  through manually marked points. Pure maths, no DOM.
//
// The x values are centred and scaled to [-1, 1] before solving the 3×3 normal equations (keeps the
// numbers well-conditioned even for pixel coordinates in the thousands), then converted back so the
// returned a, b, c are in the original units.

function solve3(M, v) {                 // Gaussian elimination with partial pivoting; null if singular
  const A = M.map((row, i) => [...row, v[i]]);
  for (let col = 0; col < 3; col++) {
    let p = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(A[r][col]) > Math.abs(A[p][col])) p = r;
    if (Math.abs(A[p][col]) < 1e-12) return null;
    [A[col], A[p]] = [A[p], A[col]];
    for (let r = col + 1; r < 3; r++) {
      const f = A[r][col] / A[col][col];
      for (let k = col; k < 4; k++) A[r][k] -= f * A[col][k];
    }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let s = A[r][3];
    for (let k = r + 1; k < 3; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x;
}

/**
 * @returns {null | {a,b,c,r2,rmse,n,exact,at(x)}}  null when a parabola cannot be determined
 *          (fewer than 3 points, or fewer than 3 distinct x values).
 * `exact` is true for exactly 3 points: the parabola then passes through all of them by construction,
 * so R² = 1 says nothing about quality.
 */
export function fitParabola(xs, ys) {
  const n = xs.length;
  if (n < 3 || ys.length !== n) return null;
  const m = xs.reduce((s, x) => s + x, 0) / n;
  const sc = Math.max(...xs.map((x) => Math.abs(x - m)));
  if (!(sc > 1e-9)) return null;
  const u = xs.map((x) => (x - m) / sc);
  if (new Set(u.map((q) => Math.round(q * 1e6))).size < 3) return null;

  let s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
  for (let i = 0; i < n; i++) {
    const q = u[i], y = ys[i];
    s1 += q; s2 += q * q; s3 += q ** 3; s4 += q ** 4;
    t0 += y; t1 += q * y; t2 += q * q * y;
  }
  const sol = solve3([[s4, s3, s2], [s3, s2, s1], [s2, s1, n]], [t2, t1, t0]);
  if (!sol) return null;
  const [A, B, C] = sol;
  const a = A / (sc * sc);
  const b = B / sc - 2 * A * m / (sc * sc);
  const c = C - B * m / sc + A * m * m / (sc * sc);

  const at = (x) => (a * x + b) * x + c;
  const ybar = ys.reduce((s, y) => s + y, 0) / n;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) { ssRes += (ys[i] - at(xs[i])) ** 2; ssTot += (ys[i] - ybar) ** 2; }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;
  return { a, b, c, r2, rmse: Math.sqrt(ssRes / n), n, exact: n === 3, at };
}
