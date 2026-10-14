export const DAN_REFERENCE_NOTE = '只比较本模型的谱面读数，不代表能通过对应段位；题型不同，手感也可能不同。';
export const LN_REFERENCE_NOTE = 'LN 课程的计分口径与当前 96% ScoreV1 不同，只作谱面读数对照；模型中部分相邻段位有倒挂。';
export const DAN_REFERENCE_WARNING = '当前谱面读数不可靠，附近参考也请谨慎看待。';

export function validateDanReferences(data) {
  if (!data || data.version !== 'P1h' || data.modelVersion !== '树星数 v1 (P1h)' || data.frozen !== '2026-10-14' || !Array.isArray(data.groups) || data.groups.length !== 2) {
    throw new Error('段位参考版本或格式不正确');
  }
  const identifiers = new Set();
  const expectedGroups = ['reform', 'ln'];
  for (const [index, group] of data.groups.entries()) {
    if (!group || group.id !== expectedGroups[index] || typeof group.label !== 'string' || !group.label.trim() || !Array.isArray(group.entries) || group.entries.length !== [20, 15][index]) {
      throw new Error('段位参考分组不正确');
    }
    for (const entry of group.entries) {
      if (!entry || typeof entry.id !== 'string' || !entry.id.startsWith(group.id + '-') || identifiers.has(entry.id) || typeof entry.label !== 'string' || !entry.label.trim() || !Number.isFinite(entry.star) || entry.star < 0 || typeof entry.reliable !== 'boolean' || (entry.url !== undefined && !/^https:\/\/osu\.ppy\.sh\/beatmaps\/[1-9]\d*$/.test(entry.url))) {
        throw new Error('段位参考条目不正确');
      }
      identifiers.add(entry.id);
    }
  }
  return data;
}

export function referencesForModel(data, model) {
  return data && model && data.modelVersion === model.version && data.frozen === model.frozen ? data : null;
}

export function selectDanReferences(result, data) {
  if (!result || result.ok !== true || !Number.isFinite(result.star) || result.star < 0) return null;
  if (!data) return { available: false, resultUnreliable: result.reliable === false, groups: [] };
  return {
    available: true,
    resultUnreliable: result.reliable === false,
    groups: data.groups.map((group) => ({
      id: group.id,
      label: group.label,
      note: group.id === 'ln' ? LN_REFERENCE_NOTE : '',
      matches: group.entries
        .filter((entry) => Math.abs(entry.star - result.star) <= 0.5)
        .sort((first, second) => Math.abs(first.star - result.star) - Math.abs(second.star - result.star) || first.star - second.star || first.id.localeCompare(second.id))
        .slice(0, 2)
        .sort((first, second) => first.star - second.star || first.id.localeCompare(second.id)),
    })),
  };
}

export function danReferenceCopyLines(view) {
  if (!view) return [];
  if (!view.available) return ['附近段位参考谱：暂不可用'];
  const lines = ['附近段位参考谱（本模型读数，不代表通过能力）：'];
  if (view.resultUnreliable) lines.push(DAN_REFERENCE_WARNING);
  for (const group of view.groups) {
    const matches = group.matches.map((entry) => `${entry.label} ★ ${entry.star.toFixed(2)}${entry.reliable ? '' : '（读数不可靠）'}`);
    lines.push(`${group.label}：${matches.length ? matches.join('；') : '暂无接近的参考谱'}`);
    if (group.note) lines.push(group.note);
  }
  return lines;
}
