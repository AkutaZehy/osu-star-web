// HistGradientBoostingRegressor (squared error) prediction from the exported node arrays (tree.json).
// Same rule as sklearn's predictor: numeric split goes left iff x <= threshold; NaN follows missing_go_to_left.
export function predictTree(T, row) {
  let s = T.baseline;
  for (const t of T.trees) {
    let i = 0;
    while (!t.leaf[i]) {
      const x = row[t.f[i]];
      const left = Number.isNaN(x) ? t.ml[i] === 1 : x <= t.t[i];
      i = left ? t.l[i] : t.r[i];
    }
    s += t.v[i];
  }
  return s;
}
