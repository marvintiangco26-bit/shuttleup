// ShuttleUp engine sanity checks — run: node test/engine.test.mjs
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';

// ---------- seedOrder ----------
assert.deepEqual(E.seedOrder(4), [1, 4, 2, 3]);
assert.deepEqual(E.seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
const s16 = E.seedOrder(16);
assert.equal(s16.length, 16);
assert.equal(s16[0], 1);
assert.equal(new Set(s16).size, 16);

// ---------- round robin ----------
function checkRR(ids) {
  const rounds = E.roundRobin(ids);
  const seen = new Set();
  let count = 0;
  for (const r of rounds) {
    const players = [];
    for (const [a, b] of r) {
      const key = [a, b].sort().join('|');
      assert.ok(!seen.has(key), `duplicate pair ${key}`);
      seen.add(key);
      count++;
      players.push(a, b);
    }
    assert.equal(new Set(players).size, players.length, 'player scheduled twice in one round');
  }
  const expected = (ids.length * (ids.length - 1)) / 2;
  assert.equal(count, expected, `expected ${expected} pairs, got ${count}`);
}
for (let n = 2; n <= 8; n++) {
  checkRR(Array.from({ length: n }, (_, i) => 'P' + i));
}

// ---------- computePlan ----------
const base = {
  mode: 'singles', games: 3, format: 'groups', skillMode: 'off',
  hours: 3, startMinutes: 600, courts: 2, matchMinutes: 25, changeoverMinutes: 5, groupsOverride: null,
};

// 8 teams, 2 courts, 3h (6 slots) -> groups of 2 are not allowed; K=2 (4,4) needs 9 slots -> closest fit reported, not ok, with suggestions
let p = E.computePlan(base, 8);
assert.equal(p.groups.k, 2);
assert.deepEqual(p.groups.sizes, [4, 4]);
assert.ok(!p.ok);
assert.ok(p.suggestions.length > 0);

// 8 teams, 4 courts, 3h -> the classic case: 2 groups of 4
p = E.computePlan({ ...base, courts: 4 }, 8);
assert.equal(p.groups.k, 2);
assert.deepEqual(p.groups.sizes, [4, 4]);
assert.ok(p.ok);

// 12 entries, 4 courts, 4h -> 4 groups of 3 (QF/SF/F)
p = E.computePlan({ ...base, courts: 4, hours: 4 }, 12);
assert.equal(p.groups.k, 4);
assert.deepEqual(p.groups.sizes, [3, 3, 3, 3]);
assert.ok(p.ok);

// 16 entries, 4 courts, 5h (10 slots) -> 4 groups of 4 fits
p = E.computePlan({ ...base, courts: 4, hours: 5 }, 16);
assert.equal(p.groups.k, 4);
assert.deepEqual(p.groups.sizes, [4, 4, 4, 4]);
assert.ok(p.ok);

// 16 entries, 4 courts, 4h -> same structure needs 10 slots > 8 -> not ok
p = E.computePlan({ ...base, courts: 4, hours: 4 }, 16);
assert.equal(p.groups.k, 4);
assert.ok(!p.ok);

// small tournament: 4 entries -> single group of 4 + final
p = E.computePlan(base, 4);
assert.equal(p.groups.k, 1);
assert.deepEqual(p.groups.sizes, [4]);
assert.ok(p.ok);

// doubles-random: planning is done on TEAMS (16 players -> 8 teams -> 2 groups of 4)
const rnd = { mode: 'doubles-random' };
assert.equal(E.effectiveEntries(rnd, 16), 8);
assert.equal(E.effectiveEntries(rnd, 17), 8);
assert.equal(E.effectiveEntries({ mode: 'singles' }, 16), 16);
p = E.computePlan({ ...base, ...rnd, courts: 4 }, E.effectiveEntries(rnd, 16));
assert.equal(p.groups.k, 2);
assert.deepEqual(p.groups.sizes, [4, 4]);
assert.ok(p.ok);

// infeasible -> suggestions, no crash
p = E.computePlan({ ...base, courts: 1, hours: 1 }, 12);
assert.ok(!p.ok);
assert.ok(p.suggestions.length > 0);

// override validation: 4 groups need 12+ entries (min 3 per group)
p = E.computePlan({ ...base, groupsOverride: 4 }, 8);
assert.ok(p.reason);
p = E.computePlan({ ...base, groupsOverride: 8 }, 8);
assert.ok(p.reason);
// valid override
p = E.computePlan({ ...base, courts: 4, groupsOverride: 2 }, 8);
assert.equal(p.groups.k, 2);
assert.ok(p.ok);

// knockout plan
p = E.computePlan({ ...base, format: 'knockout' }, 5);
assert.equal(p.bracket.size, 8);
assert.equal(p.bracket.byes, 3);
assert.ok(p.ok);

// ---------- buildTournament: groups ----------
const entries8 = Array.from({ length: 8 }, (_, i) => ({
  id: 'e' + i, mode: 'singles', name: 'P' + i, rating: 3 + (i % 5), yearsIdx: i % 4,
}));

let gen = E.buildTournament({ ...base, courts: 2, groupsOverride: 2 }, entries8);
assert.equal(gen.groups.length, 2);
assert.equal(gen.matches.length, 12 + 3); // 2 groups of 4 (12 rr) + 3 ko
assert.ok(gen.bufferSlot != null);
// no player double-booked in the same slot (group matches)
const seen = {};
for (const m of gen.matches) {
  if (m.type !== 'group') continue;
  for (const id of [m.aId, m.bId]) {
    const key = m.slot + ':' + id;
    assert.ok(!seen[key], `double booked ${id} in slot ${m.slot}`);
    seen[key] = 1;
  }
}
// every unit appears in the right number of group matches (3 for a group of 4)
const per = {};
for (const m of gen.matches.filter(m => m.type === 'group')) {
  per[m.aId] = (per[m.aId] || 0) + 1;
  per[m.bId] = (per[m.bId] || 0) + 1;
}
assert.equal(new Set(Object.values(per)).size, 1, 'uneven group stage play');

// participants resolve: group complete -> seeds resolve
for (const m of gen.matches.filter(m => m.type === 'group')) {
  m.sets = [[21, 10], [21, 12]];
  m.winnerId = m.aId;
}
E.rebuildMaps(gen);
const qf = gen.ko.rounds[0][0];
const a = E.participantInfo(gen, qf, 'a');
assert.ok(a.known && a.id, 'seed should resolve after group stage');

// ---------- buildTournament: straight knockout with byes ----------
gen = E.buildTournament({ ...base, format: 'knockout' }, entries8.slice(0, 5));
assert.equal(gen.ko.rounds.length, 3);
const r0 = gen.ko.rounds[0];
assert.equal(r0.length, 4);
const byedCount = r0.filter(m => m.byed).length;
assert.equal(byedCount, 3);
const pending = r0.filter(m => !m.winnerId);
assert.equal(pending.length, 1, 'exactly one real first-round match remains');

// ---------- balanced grouping ----------
const units = [9, 8, 7, 6, 5, 4, 3, 2, 1].map((s, i) => ({ id: 'u' + i, name: 'U' + i, members: ['U' + i], skill: s }));
const g = E.assignGroups(units, 3, 'balanced');
const skillOf = gi => g[gi].entryIds.map(id => units.find(u => u.id === id).skill).sort((a, b) => b - a);
// snake: g0 = [9,4,3], g1 = [8,5,2], g2 = [7,6,1]
assert.ok(skillOf(0)[0] > skillOf(2)[0], 'strongest group has the top player');
assert.ok(Math.min(...skillOf(0)) < Math.max(...skillOf(2)), 'strongest group also contains a weak player (mixed)');
const g2 = E.assignGroups(units, 2, 'matched');
const topSkills = g2[0].entryIds.map(id => units.find(u => u.id === id).skill).sort((a, b) => b - a);
assert.deepEqual(topSkills, [9, 8, 7, 6, 5]);

// ---------- random partners ----------
const players = [
  { id: 'a', name: 'A', rating: 9, yearsIdx: 3 },
  { id: 'b', name: 'B', rating: 7, yearsIdx: 2 },
  { id: 'c', name: 'C', rating: 5, yearsIdx: 1 },
  { id: 'd', name: 'D', rating: 3, yearsIdx: 0 },
];
let pr = E.pairPlayers(players, 'balanced');
assert.equal(pr.pairs.length, 2);
// Redraw a bunch of times: pairing should always be valid (everyone paired
// exactly once, no self-pairing) and, since 'balanced' mixes strong with
// weak, should sometimes differ between redraws (not deterministic).
const seenPairings = new Set();
for (let i = 0; i < 20; i++) {
  const p = E.pairPlayers(players, 'balanced');
  const ids = p.pairs.flatMap(x => [x.a.id, x.b.id]).sort();
  assert.deepEqual(ids, ['a', 'b', 'c', 'd'], 'every player paired exactly once');
  p.pairs.forEach(x => assert.notEqual(x.a.id, x.b.id, 'no self-pairing'));
  seenPairings.add(p.pairs.map(x => [x.a.id, x.b.id].sort().join('')).sort().join('|'));
}
assert.ok(seenPairings.size > 1, 'redraw produces more than one possible pairing');
pr = E.pairPlayers(players, 'off');
assert.equal(pr.pairs.length, 2);
// odd player is byed
const odd = [players[0], players[1], players[2]];
pr = E.pairPlayers(odd, 'off');
assert.equal(pr.pairs.length, 1);
assert.ok(pr.byed);

// ---------- standings: 3-way tie, ranked among the tied group ----------
const e4 = [
  { id: 'A', mode: 'singles', name: 'A', rating: 5, yearsIdx: 1 },
  { id: 'B', mode: 'singles', name: 'B', rating: 5, yearsIdx: 1 },
  { id: 'C', mode: 'singles', name: 'C', rating: 5, yearsIdx: 1 },
  { id: 'D', mode: 'singles', name: 'D', rating: 5, yearsIdx: 1 },
];
gen = E.buildTournament({ ...base, courts: 4, format: 'groups', groupsOverride: 1 }, e4);
assert.equal(gen.groups.length, 1);
const gm = gen.matches.filter(m => m.type === 'group');
assert.equal(gm.length, 6);
// A beats B, B beats C, C beats A, and all three beat D -> 2-1 for A,B,C
const result = { 'A|B': 'A', 'B|C': 'B', 'A|C': 'C', 'A|D': 'A', 'B|D': 'B', 'C|D': 'C' };
for (const m of gm) {
  const key = [m.aId, m.bId].sort().join('|');
  const w = result[key];
  m.winnerId = w;
  m.sets = [[21, 15], [21, 15]];
}
const st = E.groupStandings(gen, gen.groups[0].id);
assert.equal(st[3].id, 'D');
assert.ok(['A', 'B', 'C'].includes(st[0].id));

// ---------- standings: tied wins -> ranked by total points, NOT sets ----------
// X beat Y head-to-head, but across the whole group stage Y scored more total
// points (101) than X did (81). With wins tied 1-1-1 across X/Y/Z, Y should
// rank above X: total points decide ties, not head-to-head, not sets won/lost.
const fakeGen = {
  groups: [{ id: 'g1', entryIds: ['X', 'Y', 'Z'] }],
  matches: [
    { type: 'group', groupId: 'g1', aId: 'X', bId: 'Y', winnerId: 'X', sets: [[21, 19], [19, 21], [21, 19]] },
    { type: 'group', groupId: 'g1', aId: 'Y', bId: 'Z', winnerId: 'Y', sets: [[21, 5], [21, 5]] },
    { type: 'group', groupId: 'g1', aId: 'X', bId: 'Z', winnerId: 'Z', sets: [[10, 21], [10, 21]] },
  ],
};
const st2 = E.groupStandings(fakeGen, 'g1');
assert.equal(st2[0].id, 'Y', 'more total points outranks a head-to-head win');
assert.equal(st2[1].id, 'X', 'X ranks below Y despite beating Y head-to-head');

// ---------- standings: tied wins AND tied points -> head-to-head is the final tiebreak ----------
// X and Y are both 1-1 with identical total points (99 each). X beat Y
// head-to-head, so X should rank above Y despite Y being listed first.
const fakeGen2 = {
  groups: [{ id: 'g1', entryIds: ['Y', 'X', 'Z'] }],
  matches: [
    { type: 'group', groupId: 'g1', aId: 'X', bId: 'Y', winnerId: 'X', sets: [[21, 19], [15, 21], [21, 17]] }, // X 57, Y 57
    { type: 'group', groupId: 'g1', aId: 'Y', bId: 'Z', winnerId: 'Y', sets: [[21, 15], [21, 15]] }, // Y +42, Z +30
    { type: 'group', groupId: 'g1', aId: 'X', bId: 'Z', winnerId: 'Z', sets: [[19, 21], [23, 25]] }, // X +42, Z +46
  ],
};
const st3 = E.groupStandings(fakeGen2, 'g1');
assert.equal(st3[0].id, 'X', 'equal points -> head-to-head decides, X beat Y directly');
assert.equal(st3[1].id, 'Y');

// ---------- set target (11/15/21) + win by 2 ----------
assert.equal(E.setCapFor(21), 30);
assert.equal(E.setCapFor(15), 20);
assert.equal(E.setCapFor(11), 15);
// valid finishes
assert.equal(E.setWinnerOf(21, 19, 21), 'a');
assert.equal(E.setWinnerOf(19, 21, 21), 'b');
assert.equal(E.setWinnerOf(22, 20, 21), 'a');
assert.equal(E.setWinnerOf(30, 29, 21), 'a'); // cap
assert.equal(E.setWinnerOf(11, 9, 11), 'a');
assert.equal(E.setWinnerOf(11, 10, 11), null); // win by 2 -> set continues
assert.equal(E.setWinnerOf(15, 13, 15), 'a');
assert.equal(E.setWinnerOf(19, 20, 15), 'b'); // only 1 pt ahead, but b hit the cap (20)
assert.equal(E.setWinnerOf(15, 14, 11), 'a'); // past the target, win by 2
assert.equal(E.setWinnerOf(21, 20, 21), null); // not over
assert.equal(E.setWinnerOf(10, 10, 11), null); // no one near target
// matchResult honours the set target
// set 2 (11–10) is only a win-by-1 -> not a finished set, so the match isn't
// complete yet even though 2 "sets" have been entered
assert.equal(E.matchResult({ sets: [[11, 9], [11, 10]], aId: 'x', bId: 'y' }, 3, 11).winnerId, null);
assert.equal(E.matchResult({ sets: [[9, 11], [8, 11]], aId: 'x', bId: 'y' }, 3, 11).winnerId, 'y');
assert.equal(E.matchResult({ sets: [[11, 9]], aId: 'x', bId: 'y' }, 3, 11).winnerId, null);
// default (21) is unchanged for existing callers
assert.equal(E.matchResult({ sets: [[21, 19], [19, 21], [21, 15]], aId: 'x', bId: 'y' }, 3).winnerId, 'x');

// ---------- matchResult ----------
const m3 = { sets: [[21, 15], [19, 21], [21, 11]], aId: 'x', bId: 'y' };
assert.equal(E.matchResult(m3, 3).winnerId, 'x');
const m5 = { sets: [[21, 15], [21, 11], [15, 21]], aId: 'x', bId: 'y' };
assert.equal(E.matchResult(m5, 5).winnerId, null);
assert.equal(E.matchResult({ sets: [[21, 15], [21, 11], [15, 21], [21, 19], [15, 21]], aId: 'x', bId: 'y' }, 5).winnerId, 'x');
assert.equal(E.matchResult({ sets: [[15, 21], [11, 21], [21, 15], [19, 21], [15, 21]], aId: 'x', bId: 'y' }, 5).winnerId, 'y');

// ---------- custom matches-per-team within group ----------
// A group of 6 plays a full round-robin of 5 matches per team by default.
assert.equal(E.groupRoundsForSize(6), 5);
assert.equal(E.effectiveGroupRounds(6, null), 5);
assert.equal(E.effectiveGroupRounds(6, 3), 3, 'capped to the requested 3 matches each');
assert.equal(E.effectiveGroupRounds(6, 99), 5, 'cap can\'t exceed a full round-robin');
assert.equal(E.groupMatchesForSize(6, null), 15); // 6*5/2
assert.equal(E.groupMatchesForSize(6, 3), 9); // 3 rounds * 3 matches/round

// buildTournament actually honours the cap: every team gets exactly the
// capped number of matches, and semis + final still follow the group stage.
const entries6 = Array.from({ length: 6 }, (_, i) => ({ id: 'gr' + i, mode: 'singles', name: 'GR' + i, rating: 5, yearsIdx: 1 }));
const genCustom = E.buildTournament({ ...base, courts: 3, format: 'groups', groupsOverride: 1, groupRounds: 3 }, entries6);
assert.equal(genCustom.groups.length, 1);
assert.equal(genCustom.settings.groupRounds, 3);
const groupMatchesCustom = genCustom.matches.filter(m => m.type === 'group');
assert.equal(groupMatchesCustom.length, E.groupMatchesForSize(6, 3), 'total matches match the capped round count');
for (const id of genCustom.groups[0].entryIds) {
  const played = groupMatchesCustom.filter(m => m.aId === id || m.bId === id).length;
  assert.equal(played, 3, `each team plays exactly 3 matches, got ${played} for ${id}`);
}
assert.ok(genCustom.ko && genCustom.ko.names.length > 0, 'knockout (semis/final) still follows the custom group stage');

console.log('All engine tests passed ✅');
