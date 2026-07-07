// Simple line-based diff (LCS) used to preview changes before they're approved.
export interface DiffLine {
  type: 'add' | 'del' | 'ctx';
  text: string;
}

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.length ? oldText.split('\n') : [];
  const b = newText.length ? newText.split('\n') : [];
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'ctx', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: a[i] });
      i++;
    } else {
      out.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] });
  while (j < m) out.push({ type: 'add', text: b[j++] });
  return out;
}

// Large file -> full LCS (O(n*m)) would be too slow/too much memory — fall back to a simplified diff.
export function safeDiffLines(oldText: string, newText: string, maxLines = 1200): DiffLine[] {
  const aCount = oldText ? oldText.split('\n').length : 0;
  const bCount = newText ? newText.split('\n').length : 0;
  if (aCount > maxLines || bCount > maxLines) {
    const out: DiffLine[] = [];
    for (const l of oldText ? oldText.split('\n') : []) out.push({ type: 'del', text: l });
    for (const l of newText ? newText.split('\n') : []) out.push({ type: 'add', text: l });
    return out.slice(0, maxLines);
  }
  return diffLines(oldText, newText);
}
