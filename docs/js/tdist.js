// Student-t CDF table, same grid as dan-readout rules.TTable: u in linspace(-1, 1, 8193), x = c u / (1 - |u|), c = 4,
// one row per degrees of freedom, values rounded to float32 (the reference table is float32).

function lgamma(x) {   // Lanczos (g = 7, n = 9), |rel err| ~ 1e-15 for x > 0
  const p = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let a = p[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += p[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function betacf(a, b, x) {
  const MAXIT = 400, EPS = 1e-16, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function ibeta(a, b, x) {   // regularized incomplete beta I_x(a, b)
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbt = lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log1p(-x);
  const bt = Math.exp(lbt);
  if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
  return 1 - bt * betacf(b, a, 1 - x) / b;
}

export function tCdf(x, nu) {
  if (x === Infinity) return 1;
  if (x === -Infinity) return 0;
  const z = nu / (nu + x * x);
  const tail = 0.5 * ibeta(nu / 2, 0.5, z);
  return x > 0 ? 1 - tail : tail;
}

export function buildTable(nus, grid = 8193, c = 4.0) {
  const tab = new Float32Array(nus.length * grid);
  const xs = new Float64Array(grid);
  for (let i = 0; i < grid; i++) {
    const u = -1 + 2 * i / (grid - 1);   // np.linspace(-1, 1, grid)
    xs[i] = c * u / (1 - Math.abs(u));
  }
  xs[0] = -Infinity; xs[grid - 1] = Infinity;
  for (let r = 0; r < nus.length; r++) {
    const o = r * grid;
    for (let i = 0; i < grid; i++) tab[o + i] = tCdf(xs[i], nus[r]);
    tab[o] = 0; tab[o + grid - 1] = 1;
  }
  return tab;
}
