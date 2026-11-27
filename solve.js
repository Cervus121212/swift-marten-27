// A fast drop-in for makefun-diff 1.0.0: the same patch, the same tie-breaks,
// computed on interned line ids with typed arrays and no per-step allocation.
//
// The rule (from the competition brief and the reference header): a text is cut
// after every "\n" (a "\r" is part of its line) and a last line with no "\n" is
// a line too; two lines are equal only when they are the same code units,
// newline or its absence included. The common prefix of lines is kept, then
// the common suffix of the lines left; between them Myers's greedy search
// runs from the first lines, keeping on each diagonal the path reaching
// furthest into the old text and, when a deletion and an insertion reach the
// same point, the deletion's; it never moves past either text's end, prunes
// no edge diagonal, and follows every run of lines equal in both as far as
// it goes; the first path to reach both ends is the script. The patch is a
// header line, then hunks with up to 3 kept lines of context around each
// change run, runs at most 6 kept lines apart sharing a hunk, deletions
// before insertions in each run, and a "%" line after a line that ends its
// text with no newline.
//
// Speed comes from representation only, never from a different result:
// lines are interned to small integers (one Map lookup per line, then
// integer compares everywhere), the search runs on Int32Array diagonals
// with no allocation per step, its whole trace lives in one flat packed
// buffer that the backtrack reads back, and the snakes run against
// sentinel-terminated id arrays so the inner loop is a single compare.

const CONTEXT = 3;
// Ids at or above this are bare last lines (no trailing "\n"); below it
// they are lines that end with "\n". The two namespaces never collide, so
// a bare last line never shares an id with a line that ends in "\n".
const BARE_BASE = 0x40000000;

/** Scratch trace buffer, reused across cases (every slot a run reads is written by that run first). */
let traceBuf = new Int32Array(1 << 20);
let traceCap = 1 << 20;

/** Grow the trace buffer so index `need - 1` fits; the new region reads "no path". */
function ensureTrace(need) {
  if (need <= traceCap) return traceBuf;
  let next = traceCap;
  while (next < need) next *= 2;
  const grown = new Int32Array(next);
  grown.set(traceBuf);
  grown.fill(-2, traceCap);
  traceBuf = grown;
  traceCap = next;
  return traceBuf;
}

/**
 * A text's lines as integer ids. `mid` interns lines that end with "\n"
 * (keyed by the line without its "\n"); `bare` interns a bare last line
 * under its own namespace. `table` holds the mid lines' text (without
 * "\n"), `bareTable` the bare lines' text.
 */
function tokenize(text, mid, bare, table, bareTable) {
  const parts = text.split('\n');
  const last = parts.length - 1;
  const count = last + (parts[last] !== '' ? 1 : 0);
  const ids = new Int32Array(count + 1);
  for (let i = 0; i < last; i++) {
    const key = parts[i];
    let id = mid.get(key);
    if (id === undefined) {
      id = table.length;
      mid.set(key, id);
      table.push(key);
    }
    ids[i] = id;
  }
  if (parts[last] !== '') {
    const key = parts[last];
    let id = bare.get(key);
    if (id === undefined) {
      id = BARE_BASE + bareTable.length;
      bare.set(key, id);
      bareTable.push(key);
    }
    ids[last] = id;
  }
  return ids;
}

/**
 * The edit runs of the trimmed middle: an array of [kind, count] in order,
 * kind 0 kept, 1 deleted, 2 inserted. `a` and `b` are the middle's id
 * arrays, sentinel-terminated (a[n] = -1, b[m] = -2, so the snake loop needs
 * no bounds checks). Positions are last-consumed line indexes (-1 for
 * none), exactly as the reference's search states them.
 */
function myersRuns(a, n, b, m) {
  if (n === 0 && m === 0) return [];
  if (n === 0) return [[2, m]];
  if (m === 0) return [[1, n]];
  let trace = traceBuf;
  // d = 0: the snake from before both texts' first lines.
  let x = -1;
  let y = -1;
  while (a[x + 1] === b[y + 1]) {
    x++;
    y++;
  }
  trace[0] = x;
  let D = 0;
  let done = x + 1 >= n && y + 1 >= m;
  for (let d = 1; !done && d <= n + m; d++) {
    // Row d of the packed triangle holds d + 1 entries at base d*(d+1)/2.
    const base = (d * (d + 1)) >> 1;
    const prevBase = ((d - 1) * d) >> 1;
    trace = ensureTrace(base + d + 1);
    let rIdx = prevBase - 1;
    let aIdx = prevBase;
    let wIdx = base;
    for (let k = -d, j = 0; k <= d; k += 2, j++, rIdx++, aIdx++, wIdx++) {
      // The two candidate paths: a deletion from diagonal k - 1 (absent at
      // the left edge) and an insertion from diagonal k + 1 (absent at the
      // right edge). A move past either text's end is no candidate.
      const remX = k === -d ? -2 : trace[rIdx];
      const addX = k === d ? -2 : trace[aIdx];
      const canRemove = remX !== -2 && remX + 1 < n;
      const canAdd = addX !== -2 && addX - k < m;
      if (!canRemove && !canAdd) {
        trace[wIdx] = -2;
        continue;
      }
      // The candidate further into the old text, the deletion on a tie.
      const byDel = canRemove ? remX + 1 : -2;
      const byIns = canAdd ? addX : -2;
      let nx;
      if (byDel >= byIns) {
        nx = remX + 1;
      } else {
        nx = addX;
      }
      let ny = nx - k;
      while (a[nx + 1] === b[ny + 1]) {
        nx++;
        ny++;
      }
      trace[wIdx] = nx;
      if (nx + 1 >= n && ny + 1 >= m) {
        D = d;
        done = true;
        break;
      }
    }
  }
  if (!done) throw new Error('diff: the search ended without reaching both ends');

  // Backtrack from the ends, recomputing each step's choice from the
  // stored diagonals with the same tie-break, so the path is the one the
  // forward search found.
  const rev = [];
  x = n - 1;
  y = m - 1;
  for (let d = D; d >= 1; d--) {
    const k = x - y;
    const prevBase = ((d - 1) * d) >> 1;
    const j = (k + d) >> 1;
    const remX = k === -d ? -2 : trace[prevBase + j - 1];
    const addX = k === d ? -2 : trace[prevBase + j];
    const canRemove = remX !== -2 && remX + 1 < n;
    const canAdd = addX !== -2 && addX - k < m;
    const byDel = canRemove ? remX + 1 : -2;
    const byIns = canAdd ? addX : -2;
    let prevX;
    let prevY;
    let isDel;
    let stepX;
    if (byDel >= byIns) {
      isDel = true;
      prevX = remX;
      prevY = remX - (k - 1);
      stepX = remX + 1;
    } else {
      isDel = false;
      prevX = addX;
      prevY = addX - (k + 1);
      stepX = addX;
    }
    const kept = x - stepX;
    if (kept > 0) rev.push([0, kept]);
    rev.push([isDel ? 1 : 2, 1]);
    x = prevX;
    y = prevY;
  }
  if (x >= 0) rev.push([0, x + 1]);
  rev.reverse();
  const runs = [];
  for (let i = 0; i < rev.length; i++) {
    const kind = rev[i][0];
    const count = rev[i][1];
    const lastRun = runs[runs.length - 1];
    if (lastRun !== undefined && lastRun[0] === kind) lastRun[1] += count;
    else runs.push([kind, count]);
  }
  return runs;
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a line of its own when it had none. */
function written(op, id, table, bareTable) {
  if (id >= BARE_BASE) return `${op}${bareTable[id - BARE_BASE]}\n%\n`;
  return `${op}${table[id]}\n`;
}

/** The patch of the runs, laid out exactly as the reference lays it out. */
function formatPatch(runs, A, B, table, bareTable, n, m) {
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (let i = 0; i < runs.length; i++) {
    const kind = runs[i][0];
    const count = runs[i][1];
    if (kind === 0) {
      o += count;
      p += count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (kind === 1) {
      c.dels += count;
      o += count;
      deleted += count;
    } else {
      c.ins += count;
      p += count;
      inserted += count;
    }
  }
  const hunks = [];
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (let hi = 0; hi < hunks.length; hi++) {
    const h = hunks[hi];
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (let ci = 0; ci < h.length; ci++) {
      const c = h[ci];
      for (; at < c.o; at++) out.push(written('=', A[at], table, bareTable));
      for (let i = 0; i < c.dels; i++) out.push(written('-', A[c.o + i], table, bareTable));
      for (let i = 0; i < c.ins; i++) out.push(written('+', B[c.p + i], table, bareTable));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', A[at], table, bareTable));
  }
  return out.join('');
}

/** makefun-diff 1.0.0's answer for one case's input. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const mid = new Map();
  const bare = new Map();
  const table = [];
  const bareTable = [];
  const A = tokenize(input.old, mid, bare, table, bareTable);
  const B = tokenize(input.new, mid, bare, table, bareTable);
  const n = A.length - 1;
  const m = B.length - 1;
  let prefix = 0;
  while (prefix < n && prefix < m && A[prefix] === B[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && A[n - 1 - suffix] === B[m - 1 - suffix]) suffix++;
  // Sentinel-terminate the middle slices so the snakes need no bounds checks.
  const nMid = n - suffix - prefix;
  const mMid = m - suffix - prefix;
  const aMid = new Int32Array(nMid + 1);
  const bMid = new Int32Array(mMid + 1);
  aMid.set(A.subarray(prefix, prefix + nMid));
  bMid.set(B.subarray(prefix, prefix + mMid));
  aMid[nMid] = -1;
  bMid[mMid] = -2;
  const runs = [];
  const push = (kind, count) => {
    if (count <= 0) return;
    const lastRun = runs[runs.length - 1];
    if (lastRun !== undefined && lastRun[0] === kind) lastRun[1] += count;
    else runs.push([kind, count]);
  };
  push(0, prefix);
  const midRuns = myersRuns(aMid, nMid, bMid, mMid);
  for (let i = 0; i < midRuns.length; i++) push(midRuns[i][0], midRuns[i][1]);
  push(0, suffix);
  return formatPatch(runs, A, B, table, bareTable, n, m);
}
