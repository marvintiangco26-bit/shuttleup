// ============================================================
// ShuttleUp — tournament engine (pure logic, no DOM)
// Run `node test/engine.test.mjs` to sanity-check.
// ============================================================

export function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Sorting purely by skill score is fully deterministic — hitting "Redraw"
// would produce the exact same pairs/groups every time. Shuffle within small
// windows of adjacent-skill players so a redraw gives real variety while
// still keeping players roughly grouped with others of similar skill.
export function shuffleWithinBands(sortedArr, bandSize = 4) {
  const out = sortedArr.slice();
  for (let i = 0; i < out.length; i += bandSize) {
    const band = shuffle(out.slice(i, i + bandSize));
    for (let j = 0; j < band.length; j++) out[i + j] = band[j];
  }
  return out;
}

export function nextPow2(n) {
  let p = 2;
  while (p < n) p *= 2;
  return p;
}

// Standard bracket seeding: seedOrder(8) -> [1,8,4,5,2,7,3,6]
export function seedOrder(size) {
  let arr = [1, 2];
  while (arr.length < size) {
    const s = arr.length * 2;
    const next = [];
    for (const a of arr) next.push(a, s + 1 - a);
    arr = next;
  }
  return arr;
}

// ---------- Skill ----------

export const YEARS = [
  { label: 'Less than 1 year', bonus: 0 },
  { label: '1–2 years', bonus: 0.5 },
  { label: '3–5 years', bonus: 1 },
  { label: 'More than 5 years', bonus: 1.5 },
];

export const RATING_LABELS = {
  1: 'Total beginner',
  2: 'New to badminton',
  3: 'Casual player',
  4: 'Getting comfortable',
  5: 'Regular club player',
  6: 'Intermediate',
  7: 'Strong intermediate',
  8: 'Advanced / competitive',
  9: 'Tournament regular',
  10: 'State / national level',
};

export function skillScore(rating, yearsIdx) {
  return (Number(rating) || 1) + (YEARS[yearsIdx] ? YEARS[yearsIdx].bonus : 0);
}

export function skillLabel(score) {
  return String(Math.round(score * 2) / 2);
}

// ---------- Structure helpers ----------

export function roundNames(size) {
  if (size >= 16) return ['Round of 16', 'Quarter-final', 'Semi-final', 'Final'];
  if (size === 8) return ['Quarter-final', 'Semi-final', 'Final'];
  if (size === 4) return ['Semi-final', 'Final'];
  return ['Final'];
}

export const MAX_GROUP_SIZE = 7;
export const MIN_GROUP_SIZE = 3; // minimum group size for multi-group stages (a "group" of 2 is just one game)
export const MIN_ENTRIES = { knockout: 2, groups: 3 };

export function splitEven(n, k) {
  const base = Math.floor(n / k);
  const rem = n % k;
  const sizes = [];
  for (let i = 0; i < k; i++) sizes.push(base + (i < rem ? 1 : 0));
  return sizes;
}

// Round-robin rounds for a group of s players (circle method).
export function groupRoundsForSize(s) {
  return s < 2 ? 0 : s % 2 === 0 ? s - 1 : s;
}

// Actual rounds played for a group of size s, given an optional cap on
// matches per team (null/0 = full round-robin).
export function effectiveGroupRounds(s, roundsOverride) {
  const full = groupRoundsForSize(s);
  return roundsOverride ? Math.min(Number(roundsOverride), full) : full;
}

// Matches a group of size s actually plays — every round-robin round has
// exactly floor(s/2) matches (one player sits out per round when s is odd),
// so this holds whether or not the round count is capped.
export function groupMatchesForSize(s, roundsOverride) {
  return effectiveGroupRounds(s, roundsOverride) * Math.floor(s / 2);
}

// Slots needed to run every group round-robin, `courts` games per slot,
// one round across all groups per "wave" (no player plays twice per wave).
// A group of s players plays floor(s/2) games in each of its rounds.
export function groupSlotsNeeded(sizes, courts, roundsOverride) {
  const maxR = Math.max(0, ...sizes.map(s => effectiveGroupRounds(s, roundsOverride)));
  let slots = 0;
  for (let r = 0; r < maxR; r++) {
    const m = sizes.filter(s => r < effectiveGroupRounds(s, roundsOverride)).reduce((acc, s) => acc + Math.floor(s / 2), 0);
    if (m > 0) slots += Math.ceil(m / courts);
  }
  return slots;
}

// ---------- Plan (capacity from timeframe + courts) ----------

// Tournament units: individuals for singles/doubles-fixed, but PAIRS for
// doubles-random (partners are drawn first, groups hold teams).
export function effectiveEntries(settings, n) {
  return settings.mode === 'doubles-random' ? Math.floor(n / 2) : n;
}

export function computePlan(settings, n, opts = {}) {
  const slotLen = (Number(settings.matchMinutes) || 25) + (Number(settings.changeoverMinutes) || 0);
  const courts = Math.max(1, Math.floor(Number(settings.courts) || 1));
  const hours = Number(settings.hours) || 0;
  const totalSlots = slotLen > 0 ? Math.max(0, Math.floor((hours * 60) / slotLen)) : 0;
  const plan = {
    slotLen, courts, hours, totalSlots, n,
    ok: false, warnings: [], suggestions: [], reason: null, mode: settings.format,
  };

  if (!n) {
    plan.reason = 'Register players or teams to see the tournament plan.';
    return plan;
  }
  const min = MIN_ENTRIES[settings.format] || 2;
  const unit = settings.mode === 'doubles-random' ? 'teams' : 'entries';
  if (n < min) {
    plan.reason = settings.format === 'groups'
      ? `Need at least 3 ${unit} for a group stage (or switch to straight knockout for 2).`
      : `Need at least 2 ${unit}.`;
    return plan;
  }

  if (settings.format === 'knockout') {
    const size = nextPow2(n);
    const rounds = roundNames(size);
    const slots = rounds.reduce((acc, _, i) => acc + Math.ceil(size / Math.pow(2, i + 1) / courts), 0);
    plan.bracket = { size, byes: size - n, matches: size - 1, rounds };
    plan.totalMatches = size - 1;
    plan.slotsUsed = slots;
    plan.ok = slots <= totalSlots;
    if (!plan.ok) {
      plan.warnings.push(`The timeframe holds ${totalSlots} slots, but this bracket needs ${slots}.`);
      if (opts.suggest !== false) plan.suggestions = fitSuggestions(settings, n, plan);
    }
    return plan;
  }

  // ---- Group stage + knockout ----
  const override = settings.groupsOverride ? Number(settings.groupsOverride) : null;
  let candidates;
  if (override) {
    const valid = override === 1
      ? n >= 3 && n <= MAX_GROUP_SIZE
      : n >= MIN_GROUP_SIZE * override && Math.ceil(n / override) <= MAX_GROUP_SIZE;
    if (!valid) {
      plan.reason = override === 1
        ? '1 group needs 3–7 entries.'
        : `${override} groups need ${MIN_GROUP_SIZE * override}–${MAX_GROUP_SIZE * override} entries (groups of ${MIN_GROUP_SIZE}–${MAX_GROUP_SIZE}). Try Auto or a different number.`;
      return plan;
    }
    candidates = [override];
  } else {
    candidates = [8, 4, 2, 1].filter(k =>
      k === 1 ? n >= 3 && n <= MAX_GROUP_SIZE
              : n >= MIN_GROUP_SIZE * k && Math.ceil(n / k) <= MAX_GROUP_SIZE);
  }
  if (!candidates.length) {
    plan.reason = `${n} entries doesn't fit a group stage (groups of ${MIN_GROUP_SIZE}–${MAX_GROUP_SIZE}). Use straight knockout, or adjust.`;
    return plan;
  }

  let best = null;
  for (const k of candidates) {
    const sizes = splitEven(n, k);
    const gSlots = groupSlotsNeeded(sizes, courts, settings.groupRounds);
    const koSize = 2 * k;
    const koRounds = roundNames(koSize);
    const koSlots = koRounds.reduce((acc, _, i) => acc + Math.ceil(koSize / Math.pow(2, i + 1) / courts), 0);
    const buffer = 1; // short break between group stage and knockout
    const slots = gSlots + buffer + koSlots;
    const groupMatches = sizes.reduce((a, s) => a + groupMatchesForSize(s, settings.groupRounds), 0);
    const koMatches = koSize - 1;
    const c = {
      k, sizes, groupMatches, koMatches, koSize, koRounds,
      gSlots, buffer, koSlots, slots, totalMatches: groupMatches + koMatches,
      feasible: slots <= totalSlots,
    };
    if (!best) best = c;
    if (c.feasible) { best = c; break; } // candidates are largest-first
  }

  plan.groups = best;
  plan.bracket = { size: best.koSize, byes: 0, matches: best.koMatches, rounds: best.koRounds };
  plan.totalMatches = best.totalMatches;
  plan.slotsUsed = best.slots;
  plan.ok = best.feasible;
  if (!best.feasible) {
    plan.warnings.push(`The timeframe holds ${totalSlots} slots, but this plan needs ${best.slots}.`);
    if (opts.suggest !== false) {
      const kn = nextPow2(n) - 1;
      if (Math.ceil(kn / courts) <= totalSlots) plan.suggestions.push('A straight knockout would fit in this timeframe.');
      const extra = best.slots - totalSlots;
      plan.suggestions.push(`Needs about ${fmtDur(extra * slotLen)} more of play time.`);
      for (let c2 = courts + 1; c2 <= 12; c2++) {
        const p2 = computePlan({ ...settings, courts: c2, groupsOverride: null }, n, { suggest: false });
        if (p2.ok) { plan.suggestions.push(`Or book ${c2} courts instead.`); break; }
      }
      if (override) plan.suggestions.push('Or switch groups back to Auto to find a fitting structure.');
    }
  }
  return plan;
}

function fitSuggestions(settings, n, plan) {
  const out = [];
  const extra = plan.slotsUsed - plan.totalSlots;
  if (extra > 0) out.push(`Needs about ${fmtDur(extra * plan.slotLen)} more of play time.`);
  for (let c2 = plan.courts + 1; c2 <= 12; c2++) {
    const p2 = computePlan({ ...settings, courts: c2 }, n, { suggest: false });
    if (p2.ok) { out.push(`Or book ${c2} courts instead.`); break; }
  }
  const mm = Number(settings.matchMinutes);
  if (mm > 15) {
    for (let m2 = mm - 5; m2 >= 10; m2 -= 5) {
      const p2 = computePlan({ ...settings, matchMinutes: m2 }, n, { suggest: false });
      if (p2.ok) { out.push(`Or use ~${m2}-minute matches.`); break; }
    }
  }
  if (!out.length) out.push('Add more time or courts to fit the bracket.');
  return out;
}

export function fmtDur(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h && m) return `${h} h ${m} m`;
  if (h) return `${h} h`;
  return `${m} m`;
}

export function fmtTime(min) {
  const h = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ---------- Grouping & pairing ----------

// Random partners. skill: 'off' | 'balanced' | 'matched'
export function pairPlayers(players, skill) {
  const withSkill = players.map(p => ({ ...p, s: skillScore(p.rating, p.yearsIdx) }));
  const arr = skill === 'off'
    ? shuffle(withSkill)
    : shuffleWithinBands(withSkill.slice().sort((a, b) => b.s - a.s), 2);
  let byed = null;
  if (arr.length % 2 === 1) byed = arr.pop(); // odd player sits out
  const pairs = [];
  const half = arr.length / 2;
  if (skill === 'balanced') {
    for (let i = 0; i < half; i++) pairs.push({ a: arr[i], b: arr[arr.length - 1 - i] });
  } else {
    for (let i = 0; i < half; i++) pairs.push({ a: arr[i], b: arr[i + 1] });
  }
  return { pairs, byed };
}

// skill: 'off' -> random, 'balanced' -> snake draft, 'matched' -> sort & chunk
export function assignGroups(units, k, skill) {
  let groups;
  const bySkill = units.slice().sort((a, b) => b.skill - a.skill);
  if (skill === 'matched') {
    const sizes = splitEven(units.length, k);
    groups = [];
    let idx = 0;
    for (let i = 0; i < k; i++) { groups.push(bySkill.slice(idx, idx + sizes[i])); idx += sizes[i]; }
  } else if (skill === 'balanced') {
    groups = Array.from({ length: k }, () => []);
    bySkill.forEach((u, i) => {
      const round = Math.floor(i / k);
      const pos = i % k;
      const gi = round % 2 === 0 ? pos : k - 1 - pos;
      groups[gi].push(u);
    });
  } else {
    const shuffled = shuffle(units);
    const sizes = splitEven(shuffled.length, k);
    groups = [];
    let idx = 0;
    for (let i = 0; i < k; i++) { groups.push(shuffled.slice(idx, idx + sizes[i])); idx += sizes[i]; }
  }
  return groups.map((members, i) => ({
    id: 'Group ' + (i + 1),
    name: 'Group ' + (i + 1),
    entryIds: members.map(u => u.id),
  }));
}

// Circle-method round robin. Returns array of rounds; round = array of [a,b] pairs.
export function roundRobin(ids) {
  const n = ids.length;
  if (n < 2) return [];
  const arr = ids.slice();
  if (n % 2 === 1) arr.push(null);
  const m = arr.length;
  const rounds = [];
  for (let r = 0; r < m - 1; r++) {
    const pairs = [];
    for (let i = 0; i < m / 2; i++) {
      const a = arr[i], b = arr[m - 1 - i];
      if (a !== null && b !== null) pairs.push([a, b]);
    }
    rounds.push(pairs);
    arr.splice(1, 0, arr.pop());
  }
  return rounds;
}

// ---------- Knockout scaffold ----------

export function buildKoRounds(size, seedResolver) {
  const names = roundNames(size);
  const order = seedOrder(size);
  const rounds = [];
  let count = size / 2;
  let r = 0;
  while (count >= 1) {
    const row = [];
    for (let i = 0; i < count; i++) {
      const m = {
        id: uid(), type: 'ko', koRound: r, koNo: i + 1, stage: names[r],
        aRef: null, bRef: null, aId: null, bId: null,
        sets: [], winnerId: null, byed: false, slot: 0, court: 0,
      };
      if (r === 0) {
        m.aRef = seedResolver(order[2 * i]);
        m.bRef = seedResolver(order[2 * i + 1]);
      } else {
        m.aRef = { kind: 'winner', matchId: rounds[r - 1][2 * i].id };
        m.bRef = { kind: 'winner', matchId: rounds[r - 1][2 * i + 1].id };
      }
      row.push(m);
    }
    rounds.push(row);
    count = Math.floor(count / 2);
    r++;
  }
  return { rounds, names };
}

// ---------- Build the whole tournament ----------

export function buildTournament(settings, entries) {
  const skill = settings.skillMode || 'off';
  const { units, notes } = resolveUnits(settings, entries, skill);
  // plan capacity is based on tournament units (teams, not raw players)
  const plan = computePlan(settings, units.length);
  const gen = {
    v: 1,
    createdAt: Date.now(),
    settings: {
      mode: settings.mode,
      games: Number(settings.games) || 3,
      format: settings.format,
      skillMode: skill,
      courts: Math.max(1, Number(settings.courts) || 1),
      slotLen: plan.slotLen,
      startMin: Number(settings.startMinutes) || 0,
      hours: Number(settings.hours) || 0,
      matchMinutes: Number(settings.matchMinutes) || 25,
      changeoverMinutes: Number(settings.changeoverMinutes) || 0,
      groupsOverride: settings.groupsOverride || null,
      groupRounds: settings.groupRounds ? Number(settings.groupRounds) : null,
      setPoints: Number(settings.setPoints) || 21,
    },
    units,
    notes,
    groups: null,
    matches: [],
    ko: null,
    bufferSlot: null,
    championId: null,
    plan,
  };
  const courts = gen.settings.courts;
  let slot = 0;
  const pushWave = list => {
    list.forEach((m, i) => { m.slot = slot + Math.floor(i / courts); m.court = (i % courts) + 1; });
    slot += Math.ceil(list.length / courts);
  };

  if (gen.settings.format === 'groups') {
    const k = plan.groups.k;
    gen.groups = assignGroups(units, k, skill);
    const perGroup = gen.groups.map(g => {
      const rr = roundRobin(g.entryIds);
      return gen.settings.groupRounds ? rr.slice(0, gen.settings.groupRounds) : rr;
    });
    const maxR = Math.max(0, ...perGroup.map(r => r.length));
    for (let r = 0; r < maxR; r++) {
      const wave = [];
      gen.groups.forEach((g, gi) => {
        (perGroup[gi][r] || []).forEach(pair => {
          wave.push({
            id: uid(), type: 'group', groupId: g.id, round: r + 1, stage: g.id,
            aRef: null, bRef: null, aId: pair[0], bId: pair[1],
            sets: [], winnerId: null, byed: false, slot: 0, court: 0,
          });
        });
      });
      if (wave.length) { gen.matches.push(...wave); pushWave(wave); }
    }
    // Knockout: top 2 of each group advance
    const koSize = 2 * k;
    const order = seedOrder(koSize);
    const seedRef = s => ({
      kind: 'seed',
      groupId: gen.groups[Math.ceil(s / 2) - 1].id,
      rank: (s % 2) === 1 ? 1 : 2,
    });
    gen.ko = buildKoRounds(koSize, s => seedRef(order[s - 1]));
    gen.bufferSlot = slot;
    slot += 1;
    gen.ko.rounds.forEach(row => { gen.matches.push(...row); pushWave(row); });
  } else {
    // Straight knockout
    const size = plan.bracket.size;
    const byes = plan.bracket.byes;
    let seeded = units.slice();
    if (skill !== 'off') seeded.sort((a, b) => b.skill - a.skill);
    else seeded = shuffle(seeded);
    gen.ko = buildKoRounds(size, s =>
      s <= seeded.length ? { kind: 'entry', id: seeded[s - 1].id } : { kind: 'bye' });
    if (byes > 0) {
      const order = seedOrder(size);
      const r0 = gen.ko.rounds[0];
      order.forEach((seedNum, pos) => {
        if (seedNum <= byes) {
          const m = r0[Math.floor(pos / 2)];
          if (!m.byed) {
            m.byed = true;
            m.winnerId = seeded[seedNum - 1].id;
          }
        }
      });
    }
    gen.ko.rounds.forEach(row => { gen.matches.push(...row); pushWave(row); });
  }

  rebuildMaps(gen);
  return gen;
}

function resolveUnits(settings, entries, skill) {
  const notes = [];
  if (settings.mode === 'singles') {
    return {
      units: entries.map(e => {
        const name = (e.name || 'Player').trim();
        return { id: e.id, name, members: [name], skill: skillScore(e.rating, e.yearsIdx) };
      }),
      notes,
    };
  }
  if (settings.mode === 'doubles-fixed') {
    return {
      units: entries.map(e => {
        const p1 = (e.p1 || 'A').trim();
        const p2 = (e.p2 || 'B').trim();
        const name = (e.teamName || '').trim() || `${p1} / ${p2}`;
        return { id: e.id, name, members: [p1, p2], skill: skillScore(e.rating, e.yearsIdx) };
      }),
      notes,
    };
  }
  // doubles-random
  const { pairs, byed } = pairPlayers(entries, skill);
  const units = pairs.map(p => ({
    id: p.a.id + '-' + p.b.id,
    name: `${p.a.name} / ${p.b.name}`,
    members: [p.a.name, p.b.name],
    skill: (skillScore(p.a.rating, p.a.yearsIdx) + skillScore(p.b.rating, p.b.yearsIdx)) / 2,
  }));
  if (byed) notes.push(`${byed.name} couldn't be paired (odd number of players) and will sit out.`);
  return { units, notes };
}

// ---------- Live state helpers ----------

export function rebuildMaps(gen) {
  gen._unitById = Object.fromEntries((gen.units || []).map(u => [u.id, u]));
  gen._matchById = Object.fromEntries((gen.matches || []).map(m => [m.id, m]));
  return gen;
}

// Set target -> max score for the "win by 2" rule (21 pts cap 30, 15 cap 20, 11 cap 15).
export function setCapFor(target) {
  const t = Number(target) || 21;
  return t === 21 ? 30 : t === 15 ? 20 : 15;
}

// Which side wins a set played to `target` (win by 2, up to the cap).
// Returns 'a' | 'b' | null (null = not a valid finished set yet, e.g. 21-20).
export function setWinnerOf(a, b, target = 21) {
  const t = Number(target) || 21;
  const cap = setCapFor(t);
  const aWins = (a >= t && a - b >= 2) || a >= cap;
  const bWins = (b >= t && b - a >= 2) || b >= cap;
  if (aWins && !bWins) return 'a';
  if (bWins && !aWins) return 'b';
  if (aWins && bWins) return a > b ? 'a' : b > a ? 'b' : null; // defensive (30-30)
  return null;
}

export function matchResult(m, games, setPoints = 21) {
  const need = Math.ceil(games / 2);
  let wa = 0, wb = 0;
  for (const [a, b] of m.sets) {
    // A set only counts once it's genuinely finished: reached the target with
    // a 2-point lead, or hit the cap. Anything short of that (e.g. a score
    // still being typed in) doesn't count toward either side yet.
    const w = setWinnerOf(a, b, setPoints);
    if (w === 'a') wa++;
    else if (w === 'b') wb++;
  }
  const winnerId = wa >= need ? m.aId : wb >= need ? m.bId : null;
  return { wa, wb, complete: !!winnerId, winnerId };
}

export function groupComplete(gen, groupId) {
  const ms = gen.matches.filter(m => m.type === 'group' && m.groupId === groupId);
  return ms.length > 0 && ms.every(m => m.winnerId);
}

export function stageShort(m) {
  if (!m) return '?';
  if (m.type === 'group') return m.groupId;
  return `${m.stage} ${m.koNo}`;
}

export function participantInfo(gen, m, side) {
  const ref = side === 'a' ? m.aRef : m.bRef;
  if (!ref) {
    // group match: participants are direct ids
    return side === 'a'
      ? { id: m.aId, name: (gen._unitById || {})[m.aId]?.name || '—', known: !!m.aId }
      : { id: m.bId, name: (gen._unitById || {})[m.bId]?.name || '—', known: !!m.bId };
  }
  const ub = gen._unitById || {};
  if (ref.kind === 'bye') return { id: null, name: 'Bye', known: false };
  if (ref.kind === 'entry') {
    const u = ub[ref.id];
    if (u) m[side === 'a' ? 'aId' : 'bId'] = ref.id; // keep match record resolvable
    return { id: ref.id, name: u ? u.name : '—', known: !!u };
  }
  if (ref.kind === 'seed') {
    const st = groupStandings(gen, ref.groupId);
    if (groupComplete(gen, ref.groupId) && st[ref.rank - 1]) {
      const u = ub[st[ref.rank - 1].id];
      if (u) m[side === 'a' ? 'aId' : 'bId'] = st[ref.rank - 1].id;
      return { id: st[ref.rank - 1].id, name: u ? u.name : '—', known: true, tag: `${ref.groupId} ${ref.rank}` };
    }
    return { id: null, name: `Top ${ref.rank} · ${ref.groupId}`, known: false };
  }
  // winner of another match
  const src = (gen._matchById || {})[ref.matchId];
  if (src && src.winnerId) {
    const u = ub[src.winnerId];
    if (u) m[side === 'a' ? 'aId' : 'bId'] = src.winnerId;
    return { id: src.winnerId, name: u ? u.name : '—', known: true, tag: stageShort(src) };
  }
  return { id: null, name: `Winner · ${stageShort(src)}`, known: false };
}

export function groupStandings(gen, groupId) {
  const g = gen.groups.find(x => x.id === groupId);
  if (!g) return [];
  const rows = g.entryIds.map(id => ({ id, played: 0, won: 0, sf: 0, sa: 0, pf: 0, pa: 0 }));
  const row = Object.fromEntries(rows.map(r => [r.id, r]));
  for (const m of gen.matches) {
    if (m.type !== 'group' || m.groupId !== groupId || !m.winnerId) continue;
    const a = row[m.aId], b = row[m.bId];
    if (!a || !b) continue;
    a.played++; b.played++;
    a.sf += m.sets.filter(([x, y]) => x > y).length;
    a.sa += m.sets.filter(([x, y]) => y > x).length;
    b.sf += m.sets.filter(([x, y]) => y > x).length;
    b.sa += m.sets.filter(([x, y]) => x > y).length;
    a.pf += m.sets.reduce((t, [x]) => t + x, 0);
    a.pa += m.sets.reduce((t, [, y]) => t + y, 0);
    b.pf += m.sets.reduce((t, [, y]) => t + y, 0);
    b.pa += m.sets.reduce((t, [x]) => t + x, 0);
    row[m.winnerId].won++;
  }
  const h2h = (x, y) => {
    const m = gen.matches.find(mm =>
      mm.type === 'group' && mm.groupId === groupId && mm.winnerId &&
      ((mm.aId === x && mm.bId === y) || (mm.aId === y && mm.bId === x)));
    return m ? m.winnerId : null;
  };
  // Ranking: matches won, then total points scored (most first), then
  // head-to-head result between the tied teams.
  rows.sort((a, b) => b.won - a.won || b.pf - a.pf);
  let changed = true, guard = 0;
  while (changed && guard++ < 100) {
    changed = false;
    for (let i = 0; i < rows.length - 1 && !changed; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        if (rows[i].won !== rows[j].won || rows[i].pf !== rows[j].pf) continue;
        const w = h2h(rows[i].id, rows[j].id);
        if (w === rows[j].id) {
          [rows[i], rows[j]] = [rows[j], rows[i]];
          changed = true;
          break;
        }
      }
    }
  }
  return rows;
}

export function projectedFinishMin(gen) {
  const maxSlot = Math.max(0, ...gen.matches.map(m => m.slot));
  return gen.settings.startMin + (maxSlot + 1) * gen.settings.slotLen;
}
