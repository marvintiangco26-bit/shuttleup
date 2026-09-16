// ShuttleUp end-to-end engine smoke test — run: node test/smoke.mjs
import * as E from '../js/engine.js';
import assert from 'node:assert/strict';

// 1) Singles, groups, 8 entries, 2 courts, 3h (forced K=2) -> SF + Final
const base = { mode: 'singles', games: 3, format: 'groups', skillMode: 'off', hours: 3, startMinutes: 600, courts: 2, matchMinutes: 25, changeoverMinutes: 5, groupsOverride: null };
const entries = Array.from({ length: 8 }, (_, i) => ({ id: 'p' + i, mode: 'singles', name: 'Player ' + i, rating: 5, yearsIdx: 1 }));
const gen = E.buildTournament({ ...base, groupsOverride: 2 }, entries);
assert.equal(gen.groups.length, 2);
const gm = gen.matches.filter(m => m.type === 'group');
assert.equal(gm.length, 12);
// play all group matches: winner = a
for (const m of gm) { m.sets = [[21, 10], [21, 12]]; m.winnerId = m.aId; }
E.rebuildMaps(gen);
// SF participants should now be known (top 2 of each group)
const sf = gen.ko.rounds[0];
for (const m of sf) {
  for (const side of ['a', 'b']) {
    const p = E.participantInfo(gen, m, side);
    assert.ok(p.known && p.id, `SF ${m.koNo} side ${side} should resolve`);
  }
}
// play SFs
for (const m of sf) { m.sets = [[21, 15], [21, 15]]; m.winnerId = m.aId; }
const fin = gen.ko.rounds[1][0];
for (const side of ['a', 'b']) {
  const p = E.participantInfo(gen, fin, side);
  assert.ok(p.known && p.id, `Final side ${side} should resolve`);
}
fin.sets = [[21, 18], [19, 21], [21, 16]];
fin.winnerId = E.matchResult(fin, 3).winnerId;
assert.ok(fin.winnerId, 'final has a winner');

// 2) Doubles random, balanced, 16 players -> 8 teams -> 2 groups of 4
const dEntries = Array.from({ length: 16 }, (_, i) => ({ id: 'd' + i, mode: 'doubles-random', name: 'D' + i, rating: i + 1, yearsIdx: 0 }));
const gen2 = E.buildTournament({ ...base, mode: 'doubles-random', skillMode: 'balanced', courts: 4 }, dEntries);
assert.equal(gen2.units.length, 8);
assert.ok(gen2.units.every(u => u.members.length === 2 && u.name.includes('/')));
// balanced pairing: strongest players should be mixed with weakest (top-band
// player paired with a bottom-band player), not necessarily the exact same
// pairing every time now that redraw shuffles within skill bands.
const [n1, n2] = gen2.units[0].name.split(' / ').map(s => Number(s.slice(1)));
const idxs = [n1, n2].sort((a, b) => a - b);
assert.ok(idxs[0] <= 1 && idxs[1] >= 14, `balanced pairing should mix a top and bottom player, got ${gen2.units[0].name}`);
// 8 teams -> 2 groups of 4
assert.equal(gen2.groups.length, 2);
assert.ok(gen2.groups.every(g => g.entryIds.length === 4));

// 2b) Doubles random, 8 players -> 4 teams -> single group of 4 + final (no groups of 2)
const dEntries8 = dEntries.slice(0, 8);
const gen2b = E.buildTournament({ ...base, mode: 'doubles-random', courts: 4 }, dEntries8);
assert.equal(gen2b.groups.length, 1);
assert.equal(gen2b.groups[0].entryIds.length, 4);
assert.equal(gen2b.ko.names.length, 1); // just a Final

// 3) Straight knockout, matched skill, 6 entries, 2 courts, 3h
const sEntries = Array.from({ length: 6 }, (_, i) => ({ id: 's' + i, mode: 'singles', name: 'S' + i, rating: i + 1, yearsIdx: 0 }));
const gen3 = E.buildTournament({ ...base, format: 'knockout', skillMode: 'matched' }, sEntries);
assert.equal(gen3.ko.rounds.length, 3); // QF SF F
const r0 = gen3.ko.rounds[0];
assert.equal(r0.filter(m => m.byed).length, 2);
// byes go to top skills: S6 (rating 6) and S5
const byedWinners = r0.filter(m => m.byed).map(m => m.winnerId).sort();
assert.deepEqual(byedWinners, ['s4', 's5']);

// 4) Plan: 8 teams -> 2 groups of 4 when it fits
let p = E.computePlan({ ...base, courts: 4 }, 8);
assert.equal(p.groups.k, 2);
assert.deepEqual(p.groups.sizes, [4, 4]);
assert.ok(p.ok);
p = E.computePlan({ ...base, format: 'knockout' }, 13);
assert.equal(p.bracket.size, 16);
assert.equal(p.bracket.byes, 3);

// 5) Schedule integrity: courts within range, no overlap per player per slot
for (const g of [gen, gen2, gen2b, gen3]) {
  const seen = {};
  for (const m of g.matches) {
    assert.ok(m.slot >= 0 && m.court >= 1 && m.court <= g.settings.courts);
    if (m.type === 'group') for (const id of [m.aId, m.bId]) {
      const k = m.slot + ':' + id;
      assert.ok(!seen[k], 'double booked');
      seen[k] = 1;
    }
  }
  const finish = E.projectedFinishMin(g);
  assert.ok(finish >= g.settings.startMin);
}

console.log('Smoke test passed ✅');
console.log('Sample schedule (gen):');
const maxSlot = Math.max(...gen.matches.map(m => m.slot));
for (let s = 0; s <= maxSlot; s++) {
  if (gen.bufferSlot === s) { console.log(`  [break]`); continue; }
  const ms = gen.matches.filter(m => m.slot === s).sort((a, b) => a.court - b.court);
  if (!ms.length) continue;
  const t = E.fmtTime(gen.settings.startMin + s * gen.settings.slotLen);
  console.log(`  ${t}  ${ms.map(m => `C${m.court}: ${m.type === 'group' ? m.groupId : m.stage + m.koNo}`).join('  |  ')}`);
}
