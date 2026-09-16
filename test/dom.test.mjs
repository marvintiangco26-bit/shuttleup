// Round 5 — manager-only E2E: manager registers everyone, reusable roster,
// tournament history, public no-login live view, blank editable set boxes.
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import assert from 'node:assert';
import { makeFirebaseMock } from './mock-utils.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
const doc = window.document;
const mock = makeFirebaseMock();
window.confirm = () => true;
window.__FIREBASE_MODULES__ = { app: {}, appM: {}, auth: {}, db: {}, authM: mock.authM, fsM: mock.fsM };
window.FIREBASE_CONFIG = { apiKey: 'k', projectId: 'p' };
global.window = window;
global.document = doc;
global.localStorage = window.localStorage;
global.confirm = window.confirm;
process.on('unhandledRejection', e => { console.error('UNHANDLED REJECTION:', e); process.exitCode = 1; });
window.addEventListener('error', e => { console.error('WINDOW ERROR:', e.message); process.exitCode = 1; });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = s => doc.querySelector(s);
const $$ = s => Array.from(doc.querySelectorAll(s));
const fire = (el, t) => el.dispatchEvent(new window.Event(t, { bubbles: true, cancelable: true }));

await import(path.join(ROOT, 'js', 'app.js'));
await sleep(80);

// ---------- Marvin (the tournament manager) signs up ----------
assert.ok(!$('#screen-auth').hidden, 'auth screen first');
$('#authName').value = 'Marvin';
$('#authEmail').value = 'marvin@example.com';
$('#authPass').value = 'secret123';
fire($('#authForm'), 'submit');
await sleep(80);
assert.ok(!$('#screen-home').hidden, 'home after sign-up');
assert.ok($('#chip-user').textContent.includes('Marvin'), 'chip shows name');
assert.match($('#myTournaments').textContent, /No tournaments yet/);
assert.match($('#rosterList').textContent, /No players yet/);

// ---------- create a tournament ----------
$('#newName').value = 'Friday Night Smash';
$('#btn-create').click();
await sleep(80);
assert.ok(window.location.hash.startsWith('#/t/'), 'navigated to tournament');
const tid1 = window.location.hash.slice('#/t/'.length);
assert.ok(!$('#orgView').hidden, 'organizer view');
assert.ok(!$$('#orgTabs .tab').find(b => b.dataset.tab === 'players').hidden, 'players tab visible');
assert.ok(!$('#tab-setup').hidden, 'setup is the default landing tab');
$$('#orgTabs .tab').find(b => b.dataset.tab === 'players').click();
await sleep(20);
assert.match($('#inviteLink').value, new RegExp('#/t/' + tid1), 'live link');

// ---------- manager registers 4 players ----------
for (const n of ['Player 1', 'Player 2', 'Player 3', 'Player 4']) {
  $('#reg-name').value = n;
  fire($('#regForm'), 'submit');
  await sleep(30);
}
assert.equal($$('#entryList .entry-row').length, 4, '4 entries listed');

// roster picked them up
window.location.hash = '#/home';
await sleep(60);
$('#homeTabs .tab[data-tab="players"]').click();
await sleep(20);
assert.equal($$('#rosterList .entry-row').length, 4, 'roster has 4 players');
assert.match($('#rosterList').textContent, /Player 1/);

// ---------- second tournament: add an EXISTING player via suggestion ----------
window.location.hash = '#/t/' + tid1; // back (also proves history nav)
await sleep(60);
$('#newName'); // noop
window.location.hash = '#/home';
await sleep(60);
$('#newName').value = 'Weekend Doubles';
$('#btn-create').click();
await sleep(80);
const tid2 = window.location.hash.slice('#/t/'.length);
assert.notEqual(tid1, tid2, 'second tournament created');
$$('#orgTabs .tab').find(b => b.dataset.tab === 'players').click();
await sleep(20);

$('#reg-name').value = 'Player';
fire($('#reg-name'), 'input');
await sleep(20);
const opts = $$('#regSuggest [data-pname]');
assert.ok(opts.length >= 4, 'roster suggestions shown while typing');
opts.find(b => b.dataset.pname === 'Player 2').click();
assert.equal($('#reg-name').value, 'Player 2', 'suggestion filled the name');
fire($('#regForm'), 'submit');
await sleep(40);
assert.equal($$('#entryList .entry-row').length, 1, 'existing player added to tournament 2');

// roster unchanged (no duplicate created)
window.location.hash = '#/home';
await sleep(60);
$('#homeTabs .tab[data-tab="players"]').click();
await sleep(20);
assert.equal($$('#rosterList .entry-row').length, 4, 'roster still 4 (no duplicate)');

// ---------- tournament history on home ----------
$('#homeTabs .tab[data-tab="tournaments"]').click();
await sleep(20);
const cards = $$('#myTournaments .t-card');
assert.equal(cards.length, 2, 'history shows both tournaments');
assert.match($('#myTournaments').textContent, /Friday Night Smash/);
assert.match($('#myTournaments').textContent, /Weekend Doubles/);

// roster search
$('#homeTabs .tab[data-tab="players"]').click();
await sleep(20);
$('#rosterSearch').value = 'zzz';
fire($('#rosterSearch'), 'input');
await sleep(20);
assert.equal($$('#rosterList .entry-row').length, 0, 'search filters out non-matches');
$('#rosterSearch').value = 'Player';
fire($('#rosterSearch'), 'input');
await sleep(20);
assert.equal($$('#rosterList .entry-row').length, 4, 'search finds all four');

// ---------- generate tournament 1 ----------
window.location.hash = '#/t/' + tid1;
await sleep(60);
$$('#orgTabs .tab').find(b => b.dataset.tab === 'setup').click();
await sleep(20);
assert.ok($('#plan-body').textContent.includes('Groups: 1'), '4 entries -> 1 group');
$('#btn-generate').click();
await sleep(50);
assert.ok(!$('#tab-groups').hidden, 'groups tab after generate');
assert.equal($$('#groups-body .group-card').length, 1, 'one group');
assert.equal($$('#groups-body .g-member').length, 4, 'group of 4');
await sleep(550); // let the debounced save reach the (mock) database

// ---------- set length option (11/15/21, win by 2) ----------
$$('#orgTabs .tab').find(b => b.dataset.tab === 'setup').click();
await sleep(20);
assert.ok($('#set-pts'), 'set length option exists');
assert.ok($('#plan-body').textContent.includes('sets to 21'), 'plan shows default set length');
$('#set-pts').value = '11';
fire($('#set-pts'), 'change');
await sleep(20);
assert.ok($('#plan-body').textContent.includes('sets to 11 (win by 2)'), 'plan reflects set length change');
$('#set-pts').value = '21';
fire($('#set-pts'), 'change');
await sleep(20);

// win-by-2 warning: 11–9 is not a valid 21-point finish
$$('#orgTabs .tab').find(b => b.dataset.tab === 'schedule').click();
await sleep(20);
const warnMid = $('#tab-schedule .match').dataset.mid;
let inp = doc.querySelector(`input[data-match="${warnMid}"][data-set="0"][data-side="a"]`);
inp.value = '11';
fire(inp, 'change');
await sleep(20);
inp = doc.querySelector(`input[data-match="${warnMid}"][data-set="0"][data-side="b"]`);
inp.value = '9';
fire(inp, 'change');
await sleep(20);
assert.ok(doc.querySelector(`.match[data-mid="${warnMid}"] .set-warn`), '⚠ shown for an invalid finish (11–9 vs target 21)');
// a valid finish has no warning: 21–19 (reached target, win by 2)
inp = doc.querySelector(`input[data-match="${warnMid}"][data-set="0"][data-side="a"]`);
inp.value = '21';
fire(inp, 'change');
await sleep(20);
inp = doc.querySelector(`input[data-match="${warnMid}"][data-set="0"][data-side="b"]`);
inp.value = '19';
fire(inp, 'change');
await sleep(20);
assert.ok(!doc.querySelector(`.match[data-mid="${warnMid}"] .set-warn`), 'no ⚠ for a valid finish (21–19)');
// clear the set back to blank (both boxes empty)
inp = doc.querySelector(`input[data-match="${warnMid}"][data-set="0"][data-side="a"]`);
inp.value = '';
fire(inp, 'change');
await sleep(20);
inp = doc.querySelector(`input[data-match="${warnMid}"][data-set="0"][data-side="b"]`);
inp.value = '';
fire(inp, 'change');
await sleep(20);
assert.equal(doc.querySelector(`input[data-match="${warnMid}"][data-set="0"][data-side="a"]`).value, '', 'set cleared back to blank');

// ---------- public live view: signed-out visitor opens the link ----------
await mock.authM.signOut(window.FIREBASE_CONFIG);
await sleep(80);
assert.ok(window.location.hash === '#/t/' + tid1, 'still on the tournament link');
assert.ok(!$('#screen-tournament').hidden, 'signed-out visitor sees the tournament');
assert.match($('#tHeader').textContent, /Live view/, 'live-view badge');
assert.ok($$('#orgTabs .tab').find(b => b.dataset.tab === 'players').hidden, 'players tab hidden for visitors');
assert.ok($$('#orgTabs .tab').find(b => b.dataset.tab === 'setup').hidden, 'setup tab hidden for visitors');
assert.ok(!$('#tab-schedule').hidden, 'visitor lands on the schedule');
assert.equal($$('#tab-schedule input[data-set]').length, 0, 'no editable score boxes for visitors');
assert.ok($$('#tab-schedule .match').length > 0, 'schedule visible to visitor');
assert.match($('#tab-schedule').textContent, /Player 1/, 'entries visible to visitor');
// viewer tab switching
$$('#orgTabs .tab').find(b => b.dataset.tab === 'bracket').click();
await sleep(20);
assert.ok(!$('#tab-bracket').hidden, 'visitor can open the bracket');

// ---------- back as manager: score everything via blank set boxes ----------
await mock.authM.signInWithEmailAndPassword(window.FIREBASE_CONFIG, 'marvin@example.com');
await sleep(80);
assert.ok(!$('#tab-setup').hidden, 'organizer tabs back');
$$('#orgTabs .tab').find(b => b.dataset.tab === 'schedule').click();
await sleep(20);

// every match shows best-of-3 blank boxes
const firstCard = $('#tab-schedule .match');
assert.equal($$('#tab-schedule input[data-set]').length, 7 * 3 * 2 - 6,
  'six group matches x 3 sets x 2 sides (final is TBC until its feeders finish)');
assert.ok(firstCard.querySelector('input[data-set]').value === '', 'set boxes start blank');

const setScore = async (mid, i, side, v) => {
  const inp = doc.querySelector(`input[data-match="${mid}"][data-set="${i}"][data-side="${side}"]`);
  assert.ok(inp, `score box ${mid} set ${i} side ${side}`);
  inp.value = v;
  fire(inp, 'change');
  await sleep(10);
};
const cardDone = mid => {
  const c = doc.querySelector(`.match[data-mid="${mid}"]`);
  return !c || c.classList.contains('done');
};
const SETS = [[21, 15], [18, 21], [21, 15], [21, 18], [21, 12]];

let guard = 0;
while (guard++ < 50) {
  const next = $$('#tab-schedule .match')
    .find(c => !c.classList.contains('done') && c.querySelector('input[data-set]'));
  if (!next) break;
  const mid = next.dataset.mid;
  for (let i = 0; i < SETS.length && !cardDone(mid); i++) {
    await setScore(mid, i, 'a', String(SETS[i][0]));
    if (cardDone(mid)) break;
    await setScore(mid, i, 'b', String(SETS[i][1]));
  }
}
assert.ok(guard < 50, 'all matches scored');
assert.equal($$('#tab-schedule .match:not(.done)').length, 0, 'all matches done');
assert.ok($$('#tab-schedule input[data-set]:not(:disabled)').length > 0, 'score boxes stay editable when done (can correct a mistake without undo)');

$$('#orgTabs .tab').find(b => b.dataset.tab === 'bracket').click();
await sleep(20);
const banner = $('#bracket-body .champion-banner');
assert.ok(banner.classList.contains('show'), 'champion banner shown');
assert.match(banner.textContent, /wins the tournament/, 'champion named');

// ---------- history now shows a finished tournament with its champion ----------
window.location.hash = '#/home';
await sleep(80);
const smashCard = $$('#myTournaments .t-card').find(c => c.textContent.includes('Friday Night Smash'));
assert.ok(smashCard, 'finished tournament in history');
assert.match(smashCard.textContent, /Finished/);
assert.match(smashCard.textContent, /🏆/, 'champion shown on the history card');
const wdCard = $$('#myTournaments .t-card').find(c => c.textContent.includes('Weekend Doubles'));
assert.match(wdCard.textContent, /Planning/);

// ---------- visitor sees the live results (champion) without an account ----------
await mock.authM.signOut(window.FIREBASE_CONFIG);
await sleep(80);
window.location.hash = '#/t/' + tid1;
await sleep(80);
assert.match($('#tHeader').textContent, /Live view/);
$$('#orgTabs .tab').find(b => b.dataset.tab === 'schedule').click();
await sleep(20);
assert.equal($$('#tab-schedule .match:not(.done)').length, 0, 'visitor sees all matches done');
assert.ok($$('#tab-schedule .set-chip').length > 0, 'visitor sees set scores');
assert.match($('#tab-schedule').textContent, /Winner:/, 'winners shown to visitor');

console.log('DOM manager-flow E2E test passed ✅');
