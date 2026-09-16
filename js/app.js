// ============================================================
// ShuttleUp — app (auth, routing, organizer view + public live view)
// Only the tournament manager has an account. Players follow the
// tournament through the shared link (read-only live view).
// ============================================================

import * as E from './engine.js';
import * as DB from './data.js';

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const DEFAULTS = {
  mode: 'singles',
  games: 3,
  setPoints: 21,
  format: 'groups',
  skillMode: 'off',
  hours: 3,
  startMinutes: 600, // 10:00
  courts: 2,
  matchMinutes: 25,
  changeoverMinutes: 5,
  groupsOverride: null,
  groupRounds: null,
};

let user = null;
let authMode = 'signup';
let myTournaments = [];
let players = [];             // the manager's reusable player roster
let unsubTournaments = null;
let unsubPlayers = null;
let cur = null;            // current tournament doc {id, name, settings, gen, ...}
let regs = [];             // registrations for the current tournament
let unsubTournament = null;
let unsubRegs = null;
let orgTab = 'setup';
let homeTab = 'tournaments';
let editingRegId = null;
let persistT = null;
let subToken = 0;
let deleting = false;

// ---------- utils ----------

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));
const setVal = (el, v) => { if (el && document.activeElement !== el) el.value = v; };

let toastT;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 2800);
}

function tStatus() {
  const g = cur && cur.gen;
  if (!g) return 'planning';
  return g.championId ? 'finished' : 'live';
}
const STATUS_LABEL = { planning: 'Planning', live: '● Live', finished: '🏆 Finished' };

function fmtDate(v) {
  const ms = v && v.toMillis ? v.toMillis() : (typeof v === 'number' ? v : null);
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function modeRegs() {
  return cur ? regs.filter(r => r.mode === cur.settings.mode) : [];
}
function hasAnyScore(g) {
  return !!(g && g.matches.some(m => m.sets.length > 0));
}
function inviteLink() {
  return window.location.origin + window.location.pathname + '#/t/' + cur.id;
}
function isOrganizer() {
  return !!(user && cur && cur.organizerId === user.uid);
}

function showScreen(name) {
  $('#screen-auth').hidden = name !== 'auth';
  $('#screen-home').hidden = name !== 'home';
  $('#screen-tournament').hidden = name !== 'tournament';
  $('#topbar').hidden = name === 'auth';
}

// ---------- persistence ----------

// Firestore rejects arrays nested directly inside arrays. Rather than special-
// casing every field that happens to be one (sets: [[a,b],...], ko.rounds:
// [[match,...],...], etc.), wrap any array-of-arrays into an array of plain
// objects at save time, and unwrap it again on load. Objects containing
// arrays are fine, so this keeps every array's direct elements as either
// primitives or objects, never a bare array.
function encodeArraysForSave(node) {
  if (Array.isArray(node)) {
    return node.map(item => {
      const enc = encodeArraysForSave(item);
      return Array.isArray(enc) ? { __arr: enc } : enc;
    });
  }
  if (node && typeof node === 'object') {
    const out = {};
    for (const k of Object.keys(node)) out[k] = encodeArraysForSave(node[k]);
    return out;
  }
  return node;
}
function decodeArraysForLoad(node) {
  if (Array.isArray(node)) {
    return node.map(item => {
      if (item && typeof item === 'object' && Array.isArray(item.__arr) && Object.keys(item).length === 1) {
        return decodeArraysForLoad(item.__arr);
      }
      return decodeArraysForLoad(item);
    });
  }
  if (node && typeof node === 'object') {
    const out = {};
    for (const k of Object.keys(node)) out[k] = decodeArraysForLoad(node[k]);
    return out;
  }
  return node;
}

function persistGen() {
  if (!cur || !cur.gen) return;
  const clone = JSON.parse(JSON.stringify(cur.gen));
  delete clone._unitById;
  delete clone._matchById;
  const safe = encodeArraysForSave(clone);
  clearTimeout(persistT);
  persistT = setTimeout(() => {
    DB.patchTournament(cur.id, { gen: safe })
      .catch(e => { console.warn('save failed', e); toast('⚠ Save failed — ' + (e.message || e)); });
  }, 400);
}

// ---------- routing ----------

function route() {
  const m = window.location.hash.match(/^#\/t\/([A-Za-z0-9_-]+)/);
  if (m) enterTournament(m[1]);
  else enterHome();
}

window.addEventListener('hashchange', route);

// ---------- home ----------

function enterHome() {
  showScreen('home');
  teardownTournament();
  if (!user) { showScreen('auth'); return; }
  if (unsubTournaments) { unsubTournaments(); unsubTournaments = null; }
  if (unsubPlayers) { unsubPlayers(); unsubPlayers = null; }
  DB.onMyOrganized(user.uid, list => {
    myTournaments = list;
    renderHome();
  }).then(un => { unsubTournaments = un; });
  DB.onPlayers(user.uid, list => {
    players = list;
    renderHome();
  }).then(un => { unsubPlayers = un; });
  renderHome();
}

function teardownTournament() {
  subToken++;
  if (unsubTournament) { unsubTournament(); unsubTournament = null; }
  if (unsubRegs) { unsubRegs(); unsubRegs = null; }
  cur = null;
  regs = [];
  editingRegId = null;
}

function renderHome() {
  $$('#homeTabs .tab').forEach(b => b.classList.toggle('active', b.dataset.tab === homeTab));
  $('#homeTab-tournaments').hidden = homeTab !== 'tournaments';
  $('#homeTab-players').hidden = homeTab !== 'players';
  $('#rosterCount').textContent = players.length ? `· ${players.length}` : '';
  renderHomeTournaments();
  renderRoster();
}

function renderHomeTournaments() {
  const card = t => {
    const st = tStatusOf(t);
    const g = t.gen;
    const champ = g && g.championId ? (g.units || []).find(u => u.id === g.championId) : null;
    const created = fmtDate(t.createdAt);
    return `<div class="t-card" data-tid="${t.id}">
      <div class="t-card-top">
        <span class="t-card-name">${esc(t.name)}</span>
        <span class="chip ${st === 'live' ? 'chip-on' : ''}">${STATUS_LABEL[st]}</span>
      </div>
      <div class="t-card-sub">
        ${modeIcon(t.settings && t.settings.mode)} ${esc(modeLabel(t.settings && t.settings.mode))}
        ${created ? ` · ${created}` : ''}
      </div>
      ${champ ? `<div class="t-card-sub">🏆 ${esc(champ.name)}</div>` : ''}
    </div>`;
  };
  $('#myTournaments').innerHTML = myTournaments.length
    ? `<div class="t-grid">${myTournaments.map(card).join('')}</div>`
    : `<p class="plan-note">No tournaments yet — create your first one above. 🏸</p>`;
  $$('#myTournaments .t-card').forEach(c => c.addEventListener('click', () => { window.location.hash = '#/t/' + c.dataset.tid; }));
}

function renderRoster() {
  const q = ($('#rosterSearch').value || '').trim().toLowerCase();
  const list = players.filter(p => !q || String(p.name || '').toLowerCase().includes(q));
  $('#rosterSub').textContent = players.length ? `· ${players.length} in your list` : '';
  if (!players.length) {
    $('#rosterList').innerHTML = `<p class="plan-note">No players yet — register players in a tournament and they'll appear here automatically.</p>`;
    return;
  }
  if (!list.length) {
    $('#rosterList').innerHTML = `<p class="plan-note">Nobody matches “${esc($('#rosterSearch').value.trim())}”.</p>`;
    return;
  }
  $('#rosterList').innerHTML = list.map(p => {
    const skill = p.rating != null
      ? `<span class="chip chip-skill">★ ${E.skillLabel(E.skillScore(p.rating, p.yearsIdx))}</span>` : '';
    const since = fmtDate(p.createdAt);
    return `<div class="entry-row">
      <span class="entry-name">${esc(p.name)}</span>${skill}
      ${since ? `<span class="muted" style="font-size:.75rem">· since ${since}</span>` : ''}
      <button class="btn ghost sm" data-roster-remove="${p.id}" title="Remove from your list">✕</button>
    </div>`;
  }).join('');
  $$('#rosterList [data-roster-remove]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Remove this player from your list? (Tournaments already registered are not affected.)')) return;
    try { await DB.removePlayer(user.uid, b.dataset.rosterRemove); }
    catch (e) { toast('Remove failed: ' + (e.message || e)); }
  }));
}

function tStatusOf(t) {
  if (!t.gen) return 'planning';
  return t.gen.championId ? 'finished' : 'live';
}
function modeIcon(m) { return m === 'singles' ? '🏸' : m === 'doubles-fixed' ? '👥' : '🎲'; }
function modeLabel(m) {
  return m === 'singles' ? 'Singles' : m === 'doubles-fixed' ? 'Doubles · teams known' : 'Doubles · random partners';
}

// ---------- tournament ----------

// The engine shares match objects between gen.matches and gen.ko.rounds, but
// any serialization round-trip (our persist clone, Firestore snapshots) breaks
// that shared identity — the knockout view would then render unscorable copies.
// Re-canonicalize the KO arrays onto gen.matches by id whenever a gen is adopted.
function adoptGen(gen) {
  Object.assign(gen, decodeArraysForLoad(gen));
  if (gen && Array.isArray(gen.matches)) {
    const byId = new Map(gen.matches.map(m => [m.id, m]));
    if (gen.ko && Array.isArray(gen.ko.rounds)) {
      for (const row of gen.ko.rounds) {
        for (let i = 0; i < row.length; i++) {
          const c = byId.get(row[i] && row[i].id);
          if (c) row[i] = c;
        }
      }
    }
  }
  E.rebuildMaps(gen);
  return gen;
}

function resetRegForm() {
  ['reg-name', 'reg-p1', 'reg-p2', 'reg-team'].forEach(id => { const el = $('#' + id); if (el) el.value = ''; });
  const r = $('#reg-rating'); if (r) r.value = '5';
  const y = $('#reg-years'); if (y) y.value = '1';
  const s = $('#regSubmit'); if (s) s.textContent = '＋ Add player';
  const c = $('#btn-cancel-edit'); if (c) c.style.display = 'none';
  hideRosterSuggest();
}

function enterTournament(tid) {
  showScreen('tournament');
  teardownTournament();
  resetRegForm();
  orgTab = 'setup';
  const token = subToken;
  $('#tHeader').innerHTML = '<p class="plan-note">Loading tournament…</p>';
  DB.onTournament(tid, t => {
    if (token !== subToken) return;
    if (!t) {
      if (!deleting) toast('Tournament not found — it may have been deleted.');
      window.location.hash = '#/home';
      return;
    }
    cur = t;
    if (cur.gen) adoptGen(cur.gen);
    renderTournament();
  }, err => {
    console.warn(err);
    if (token === subToken) toast('⚠ Connection problem — check your internet.');
  }).then(un => { if (token === subToken) unsubTournament = un; });
  DB.onRegistrations(tid, r => {
    if (token !== subToken) return;
    regs = r;
    if (cur) renderTournament();
  }).then(un => { if (token === subToken) unsubRegs = un; });
}

function renderTournament() {
  if (!cur) return;
  const isOrg = isOrganizer();
  $('#tHeader').innerHTML = `
    <div class="t-head">
      <div>
        <a class="back-link" href="#/home">← ${isOrg ? 'All tournaments' : 'ShuttleUp'}</a>
        <h2>${esc(cur.name)}</h2>
        <div class="t-head-sub">
          <span class="chip ${tStatus() === 'live' ? 'chip-on' : ''}">${STATUS_LABEL[tStatus()]}</span>
          ${isOrg ? '' : '<span class="chip">👁 Live view · read only</span>'}
          <span class="plan-note">${modeIcon(cur.settings.mode)} ${esc(modeLabel(cur.settings.mode))} · ${modeRegs().length} ${cur.settings.mode === 'doubles-random' ? 'players' : 'entries'} registered</span>
        </div>
      </div>
      ${isOrg ? `<button class="btn danger sm" id="btn-delete-t">Delete tournament</button>` : `<span class="plan-note">Organized by ${esc(cur.organizerName || '—')}</span>`}
    </div>`;
  const del = $('#btn-delete-t');
  if (del) del.addEventListener('click', async () => {
    if (!confirm('Delete this tournament, all registrations and results? This cannot be undone.')) return;
    deleting = true;
    try {
      await DB.deleteTournament(cur.id);
      window.location.hash = '#/home';
    } catch (e) { toast('Delete failed: ' + (e.message || e)); }
    finally { deleting = false; }
  });
  renderOrgView();
}

// ================= VIEWS (organizer + public live view share the tabs) =================

function renderOrgView() {
  const isOrg = isOrganizer();
  const hasGen = !!cur.gen;
  $$('#orgTabs .tab').forEach(b => {
    const t = b.dataset.tab;
    b.hidden = !isOrg && (t === 'players' || t === 'setup');
    if (b.hidden) return;
    b.classList.toggle('active', t === orgTab);
    if (t !== 'players' && t !== 'setup') b.disabled = !hasGen;
  });
  if (!isOrg && (orgTab === 'players' || orgTab === 'setup')) orgTab = 'schedule';
  if (!hasGen && (orgTab === 'groups' || orgTab === 'schedule' || orgTab === 'bracket')) {
    orgTab = isOrg ? 'setup' : 'schedule';
  }
  ['setup', 'players', 'groups', 'schedule', 'bracket'].forEach(t => {
    $('#tab-' + t).hidden = t !== orgTab;
  });
  $('#groupsFoot').hidden = !isOrg;
  if (orgTab === 'players') renderPlayersTab();
  else if (orgTab === 'setup') renderSetupTab();
  else if (!hasGen) {
    const note = `<p class="plan-note">The schedule will appear here once the organizer generates the tournament.</p>`;
    $('#groups-body').innerHTML = note;
    $('#schedule-body').innerHTML = note;
    $('#bracket-body').innerHTML = note;
  } else {
    E.rebuildMaps(cur.gen);
    renderGroupsTab();
    renderScheduleTab(!isOrg);
    renderBracketTab(!isOrg);
  }
}

function renderPlayersTab() {
  const st = cur.settings;
  // live-view invite
  const link = inviteLink();
  $('#inviteLink').value = link;
  const qr = $('#inviteQr');
  if (qr.dataset.tid !== cur.id) {
    qr.dataset.tid = cur.id;
    qr.src = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(link);
    qr.onerror = () => { qr.parentElement.style.display = 'none'; };
  }
  // form fields
  renderRegFields();
  hideRosterSuggest();
  // entries
  const list = $('#entryList');
  $('#players-count').textContent = regs.length ? `· ${regs.length} registered` : '';
  if (!regs.length) {
    list.innerHTML = `<p class="plan-note">Nobody registered yet — add your first player above. Start typing a name to pick someone from your player list.</p>`;
    return;
  }
  const sorted = regs.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  list.innerHTML = sorted.map(e => {
    const mismatch = e.mode !== st.mode;
    const name = e.mode === 'doubles-fixed'
      ? `${esc(e.teamName || '')} <span class="muted">(${esc(e.p1)} / ${esc(e.p2)})</span>`
      : esc(e.name);
    const skillChip = e.mode === 'doubles-random'
      ? `<span class="chip chip-skill" title="${E.RATING_LABELS[e.rating]} · ${E.YEARS[e.yearsIdx].label}">★ ${E.skillLabel(E.skillScore(e.rating, e.yearsIdx))}</span>`
      : '';
    const tag = mismatch ? `<span class="chip chip-dim">different mode</span>` : '';
    return `<div class="entry-row ${e.id === editingRegId ? 'editing' : ''}">
      <span class="entry-name">${name}</span>
      ${skillChip}${tag}
      <button class="btn ghost sm" data-edit="${e.id}" title="Edit">✎</button>
      <button class="btn ghost sm" data-remove="${e.id}" title="Remove">✕</button>
    </div>`;
  }).join('');
  $$('#entryList [data-edit]').forEach(b => b.addEventListener('click', () => startEdit(b.dataset.edit)));
  $$('#entryList [data-remove]').forEach(b => b.addEventListener('click', async () => {
    if (cur.gen && hasAnyScore(cur.gen)) { toast('Scores are recorded — use “Redraw” to restart.'); return; }
    const r = regs.find(x => x.id === b.dataset.remove);
    if (!confirm(`Remove ${r ? (r.name || r.p1) : 'this player'}?`)) return;
    try {
      await DB.removeRegistration(cur.id, b.dataset.remove);
      if (editingRegId === b.dataset.remove) editingRegId = null;
    } catch (e) { toast('Remove failed: ' + (e.message || e)); }
  }));
}

function renderRegFields() {
  const m = cur.settings.mode;
  const el = $('#regFields');
  if (el.dataset.mode !== m) {
    const field = (id, label, required) =>
      `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="text" ${required ? 'required' : ''} placeholder="${label}"></div>`;
    let h = '';
    if (m === 'doubles-fixed') {
      h = field('reg-p1', 'Player 1', true) + field('reg-p2', 'Player 2', true) + field('reg-team', 'Team name (optional)');
    } else {
      h = field('reg-name', m === 'doubles-random' ? 'Player name (partner drawn later)' : 'Player name', true);
    }
    el.innerHTML = h;
    el.dataset.mode = m;
  }
  $('#regSkillWrap').style.display = m === 'doubles-random' ? '' : 'none';
  $('#regHint').textContent =
    m === 'doubles-random'
      ? (cur.settings.skillMode === 'off'
        ? 'Partners are randomised when you generate. (Skill answers only matter if skill-based grouping is on.)'
        : 'Partners and groups are balanced using the skill answers.')
      : m === 'doubles-fixed' ? 'Register each known pair once.'
        : 'Tip: start typing — pick from your player list to add an existing player in one tap.';
}

function startEdit(id) {
  const e = regs.find(x => x.id === id);
  if (!e) return;
  if (cur.gen && hasAnyScore(cur.gen)) { toast('Scores are recorded — use “Redraw” to restart.'); return; }
  editingRegId = id;
  if (e.mode === cur.settings.mode) {
    if (e.mode === 'doubles-fixed') {
      $('#reg-p1').value = e.p1 || '';
      $('#reg-p2').value = e.p2 || '';
      $('#reg-team').value = e.teamName || '';
    } else $('#reg-name').value = e.name || '';
    $('#reg-rating').value = String(e.rating != null ? e.rating : 5);
    $('#reg-years').value = String(e.yearsIdx != null ? e.yearsIdx : 1);
  } else {
    toast('This entry uses a different game mode — remove it, or switch the mode first.');
    editingRegId = null;
  }
  const btn = $('#regSubmit');
  btn.textContent = '💾 Save changes';
  $('#btn-cancel-edit').style.display = '';
  renderPlayersTab();
}

function cancelEdit() {
  if (!editingRegId) return;
  editingRegId = null;
  ['reg-name', 'reg-p1', 'reg-p2', 'reg-team'].forEach(id => { const el = $('#' + id); if (el) el.value = ''; });
  $('#reg-rating').value = '5';
  $('#reg-years').value = '1';
  $('#regSubmit').textContent = '＋ Add player';
  $('#btn-cancel-edit').style.display = 'none';
  renderPlayersTab();
}

// ---------- roster suggestions while typing a player name ----------

function hideRosterSuggest() {
  const box = $('#regSuggest');
  box.hidden = true;
  box.innerHTML = '';
}

function showRosterSuggest(input) {
  const box = $('#regSuggest');
  const q = (input.value || '').trim().toLowerCase();
  if (!q || !players.length) return hideRosterSuggest();
  const hits = players.filter(p => String(p.name || '').toLowerCase().includes(q)).slice(0, 6);
  if (!hits.length) return hideRosterSuggest();
  box.innerHTML = hits.map(p => {
    const skill = p.rating != null
      ? ` <span class="chip chip-skill">★ ${E.skillLabel(E.skillScore(p.rating, p.yearsIdx))}</span>` : '';
    return `<button type="button" data-pname="${esc(p.name)}" data-prating="${p.rating != null ? p.rating : ''}" data-pyears="${p.yearsIdx != null ? p.yearsIdx : ''}">${esc(p.name)}${skill}<span class="muted"> · from your list</span></button>`;
  }).join('');
  box.hidden = false;
  $$('#regSuggest [data-pname]').forEach(b => b.addEventListener('click', () => {
    input.value = b.dataset.pname;
    if (cur && cur.settings.mode === 'doubles-random') {
      if (b.dataset.prating !== '') $('#reg-rating').value = b.dataset.prating;
      if (b.dataset.pyears !== '') $('#reg-years').value = b.dataset.pyears;
    }
    hideRosterSuggest();
  }));
}

// ---------- setup / plan / generate ----------

function renderSetupTab() {
  const st = cur.settings;
  const mode = $$('input[name="mode"]').find(r => r.value === st.mode);
  if (mode && !mode.checked) mode.checked = true;
  setVal($('#set-games'), st.games);
  setVal($('#set-pts'), st.setPoints || 21);
  setVal($('#set-format'), st.format);
  setVal($('#set-skill'), st.skillMode);
  setVal($('#set-hours'), st.hours);
  setVal($('#set-courts'), st.courts);
  setVal($('#set-matchmin'), st.matchMinutes);
  setVal($('#set-changeover'), st.changeoverMinutes);
  const [h, m] = [Math.floor((st.startMinutes || 0) / 60), (st.startMinutes || 0) % 60];
  setVal($('#set-start'), `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  setVal($('#set-groups'), st.groupsOverride == null ? 'auto' : String(st.groupsOverride));
  setVal($('#set-grouprounds'), st.groupRounds == null ? 'auto' : String(st.groupRounds));
  $('#groupsOverrideWrap').style.display = st.format === 'groups' ? '' : 'none';
  $('#groupRoundsWrap').style.display = st.format === 'groups' ? '' : 'none';
  $('#skillFieldWrap').style.display = st.mode === 'doubles-random' ? '' : 'none';
  renderPlan();
}

function renderPlan() {
  const el = $('#plan-body');
  const st = cur.settings;
  const n = E.effectiveEntries(st, modeRegs().length);
  const plan = E.computePlan(st, n);
  let h = '';
  const metaCount = st.mode === 'doubles-random'
    ? `${modeRegs().length} players → ${n} team${n === 1 ? '' : 's'}`
    : `${n} ${n === 1 ? 'entry' : 'entries'}`;
  h += `<div class="plan-meta">${metaCount} · ${st.hours} h from ${E.fmtTime(st.startMinutes)} · ${st.courts} court${st.courts > 1 ? 's' : ''} · ${plan.slotLen}-min slots · best of ${st.games} · sets to ${st.setPoints || 21} (win by 2)</div>`;
  if (plan.reason) {
    h += `<p class="plan-note">${esc(plan.reason)}</p>`;
  } else if (plan.mode === 'knockout') {
    const b = plan.bracket;
    h += `<div class="plan-row">Bracket of ${b.size}${b.byes ? ` · ${b.byes} bye${b.byes > 1 ? 's' : ''} (top seed${b.byes > 1 ? 's' : ''} skip round 1)` : ''}</div>`;
    h += `<div class="plan-row">Rounds: ${b.rounds.join(' → ')}</div>`;
    h += `<div class="plan-row">${b.matches} matches · ~${plan.slotsUsed} slots</div>`;
  } else if (plan.groups) {
    const g = plan.groups;
    const perTeam = st.groupRounds ? `${st.groupRounds} match${st.groupRounds > 1 ? 'es' : ''} each` : 'full round-robin';
    h += `<div class="plan-row">Groups: ${g.k} of size (${g.sizes.join(', ')}) — ${perTeam} — top 2 advance</div>`;
    h += `<div class="plan-row">Group stage: ${g.groupMatches} ${g.groupMatches === 1 ? 'match' : 'matches'}</div>`;
    h += `<div class="plan-row">Knockout: ${g.koRounds.join(' → ')} · ${g.koMatches} ${g.koMatches === 1 ? 'match' : 'matches'}</div>`;
    h += `<div class="plan-row">Total: ${g.totalMatches} ${g.totalMatches === 1 ? 'match' : 'matches'} · ~${g.slots} slots (incl. break)</div>`;
  }
  if (!plan.reason) {
    if (plan.ok) {
      const finish = E.fmtTime(st.startMinutes + plan.slotsUsed * plan.slotLen);
      const end = E.fmtTime(st.startMinutes + st.hours * 60);
      h += `<p class="plan-ok">✓ Fits — finishes around <b>${finish}</b>, timeframe ends ${end}.</p>`;
    } else {
      h += `<p class="plan-warn">⚠ ${esc(plan.warnings[0] || 'Doesn\'t fit the timeframe.')}</p>`;
      plan.suggestions.forEach(sg => { h += `<p class="plan-sug">💡 ${esc(sg)}</p>`; });
    }
  }
  h += `<details class="plan-how"><summary>How is this calculated?</summary>
    <p>Timeframe ÷ (${st.matchMinutes}-min match + ${st.changeoverMinutes}-min changeover) = number of time slots. Each slot runs ${st.courts} game${st.courts > 1 ? 's' : ''} at once. The engine picks the largest group structure that finishes inside the slots, reserving slots for the knockout rounds plus a short break. Top 2 of each group advance.</p>
  </details>`;
  el.innerHTML = h;
  $('#btn-generate').classList.toggle('dimmed', !!plan.reason);
}

function doGenerate() {
  const st = cur.settings;
  const entries = modeRegs().map(toEntry);
  const plan = E.computePlan(st, E.effectiveEntries(st, entries.length));
  if (plan.reason) { toast(plan.reason); return; }
  if (!plan.ok) {
    if (!confirm(`This plan needs about ${plan.slotsUsed} slots but the timeframe only holds ${plan.totalSlots} (it will overrun by ~${E.fmtDur((plan.slotsUsed - plan.totalSlots) * plan.slotLen)}).\nGenerate anyway?`)) return;
  }
  cur.gen = E.buildTournament(st, entries);
  persistGen();
  orgTab = 'groups';
  renderOrgView();
  toast('Tournament generated — share the live link so players can follow along!');
}

const toEntry = r => ({ id: r.id, mode: r.mode, name: r.name, p1: r.p1, p2: r.p2, teamName: r.teamName, rating: r.rating, yearsIdx: r.yearsIdx });

// ---------- shared rendering (groups / schedule / bracket) ----------

function renderGroupsTab() {
  const gen = cur.gen;
  $('#groups-sub').textContent = gen.settings.skillMode === 'off'
    ? 'Random draw'
    : gen.settings.skillMode === 'balanced' ? 'Balanced by skill' : 'Matched by skill level';
  let h = '';
  if (gen.groups) {
    h = `<div class="groups-grid">` + gen.groups.map(g =>
      `<div class="group-card"><h3>${esc(g.name)}</h3><div class="g-members">` +
      g.entryIds.map(id => {
        const u = gen._unitById[id];
        const skillChip = gen.settings.skillMode !== 'off'
          ? ` <span class="chip chip-skill">★ ${E.skillLabel(u.skill)}</span>` : '';
        return `<div class="g-member"><span class="m-name">${esc(u.name)}</span>${skillChip}</div>`;
      }).join('') +
      `</div></div>`
    ).join('') + `</div>`;
  } else {
    h = `<p class="plan-note">Straight knockout — no group stage. The full bracket is on the <b>Bracket</b> tab.</p>`;
  }
  (gen.notes || []).forEach(n => { h += `<p class="plan-warn">⚠ ${esc(n)}</p>`; });
  $('#groups-body').innerHTML = h;
}

// Editable cards: one blank score box per set (best of 3 → three boxes, best of 5
// → five), each starting blank/0-0 so the manager can just type in the scores.
function matchCard(m, readOnly = false) {
  const gen = cur.gen;
  const a = E.participantInfo(gen, m, 'a');
  const b = E.participantInfo(gen, m, 'b');
  const target = gen.settings.setPoints || 21;
  const r = E.matchResult(m, gen.settings.games, target);
  const complete = !!m.winnerId || r.complete;
  const scoreable = !m.byed && a.id && b.id && a.id !== b.id;
  const cap = E.setCapFor(target);
  const games = gen.settings.games;
  const warnMark = s => E.setWinnerOf(s[0], s[1], target) == null
    ? `<span class="set-warn" title="Not a valid finish — the set must end at ${target} (win by 2) or the cap of ${cap}">⚠</span>`
    : '';
  let setsHtml;
  if (readOnly) {
    setsHtml = m.sets.length
      ? m.sets.map(([pa, pb]) =>
        `<span class="set-chip ${pa > pb ? 'win-a' : pb > pa ? 'win-b' : ''}"><span class="set-num">${pa}</span><span class="sep">–</span><span class="set-num">${pb}</span>${warnMark([pa, pb])}</span>`).join('')
      : `<span class="set-chip empty">–</span>`;
  } else if (scoreable) {
    setsHtml = '';
    for (let i = 0; i < games; i++) {
      const s = m.sets[i];
      const cls = s ? (s[0] > s[1] ? 'win-a' : s[1] > s[0] ? 'win-b' : '') : '';
      setsHtml += `<span class="set-chip ${cls}">
        <input data-set="${i}" data-side="a" data-match="${m.id}" value="${s ? s[0] : ''}" placeholder="0" inputmode="numeric" min="0" max="${cap}">
        <span class="sep">–</span>
        <input data-set="${i}" data-side="b" data-match="${m.id}" value="${s ? s[1] : ''}" placeholder="0" inputmode="numeric" min="0" max="${cap}">
        ${s ? warnMark(s) : ''}
      </span>`;
    }
  } else {
    setsHtml = `<span class="set-chip empty">${m.byed ? 'bye' : 'TBC'}</span>`;
  }
  const isFin = m.stage === 'Final';
  const stageLabel = m.type === 'group' ? m.groupId : `${m.stage} ${m.koNo}`;
  const winSide = m.winnerId === a.id ? a : m.winnerId === b.id ? b : null;
  return `
  <div class="match ${complete ? 'done' : ''}" data-mid="${m.id}">
    <div class="m-stage"><span>${esc(stageLabel)}</span>${m.byed ? '<em>bye</em>' : ''}${isFin ? ' 🏆' : ''}</div>
    <div class="m-main">
      <span class="m-name side-a ${m.winnerId === a.id ? 'win' : ''}" title="${esc(a.name)}${a.tag ? ` (${esc(a.tag)})` : ''}">${esc(a.name)}</span>
      <div class="m-sets">${setsHtml}</div>
      <span class="m-name side-b ${m.winnerId === b.id ? 'win' : ''}" title="${esc(b.name)}${b.tag ? ` (${esc(b.tag)})` : ''}">${esc(b.name)}</span>
    </div>
    ${complete
      ? `<div class="m-winner">${isFin ? '🏆 Champion' : 'Winner'}: <b>${esc(winSide ? winSide.name : '—')}</b> ${m.byed || readOnly ? '' : `<button class="undo" data-act="reset-match" data-match="${m.id}">undo</button>`}</div>`
      : ''}
  </div>`;
}

function scheduleHtml(readOnly = false) {
  const gen = cur.gen;
  const finish = E.projectedFinishMin(gen);
  const end = gen.settings.startMin + gen.settings.hours * 60;
  const fits = finish <= end;
  let h = `<div class="plan-banner ${fits ? 'ok' : 'warn'}">${fits ? '✓' : '⚠'} ${gen.matches.length} matches · projected finish ${E.fmtTime(finish)} · timeframe ends ${E.fmtTime(end)} · sets to ${gen.settings.setPoints || 21} (win by 2)</div>`;
  const maxSlot = Math.max(0, ...gen.matches.map(m => m.slot));
  for (let s = 0; s <= maxSlot; s++) {
    if (gen.bufferSlot === s) {
      h += `<div class="slot-break">☕ Break — group stage over, knockout begins</div>`;
      continue;
    }
    const ms = gen.matches.filter(m => m.slot === s).sort((x, y) => x.court - y.court);
    if (!ms.length) continue;
    h += `<div class="slot">
      <div class="slot-head"><span class="slot-time">${E.fmtTime(gen.settings.startMin + s * gen.settings.slotLen)}</span>
      <span class="slot-sub">${ms.length} game${ms.length > 1 ? 's' : ''} · court${ms.length > 1 ? 's' : ''} ${ms.map(m => m.court).join(', ')}</span></div>
      <div class="slot-matches">${ms.map(m => matchCard(m, readOnly)).join('')}</div>
    </div>`;
  }
  return h;
}

function renderScheduleTab(readOnly = false) {
  if (!cur.gen) return;
  $('#schedule-body').innerHTML = scheduleHtml(readOnly);
}

function renderBracketTab(readOnly = false) {
  const gen = cur.gen;
  let h = '';
  if (gen.groups) {
    h += `<h3 class="bracket-h">Group standings <span class="muted">(top 2 advance)</span></h3>
    <div class="standings-grid">`;
    gen.groups.forEach(g => {
      const st = E.groupStandings(gen, g.id);
      const done = E.groupComplete(gen, g.id);
      h += `<table class="standings"><thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>Sets</th><th>Pts</th></tr></thead><tbody>`;
      st.forEach((row, i) => {
        const u = gen._unitById[row.id];
        const adv = done && i < 2;
        h += `<tr class="${adv ? 'adv' : ''}"><td>${i + 1}</td><td>${esc(u.name)}${adv ? ' <span class="adv-tag">→ KO</span>' : ''}</td><td>${row.won}</td><td>${row.played - row.won}</td><td>${row.sf}–${row.sa}</td><td>${row.pf}–${row.pa}</td></tr>`;
      });
      h += `</tbody></table>`;
    });
    h += `</div>`;
  }
  if (gen.ko) {
    h += `<h3 class="bracket-h">Knockout</h3><div class="ko">` +
      gen.ko.rounds.map((row, ri) =>
        `<div class="ko-col"><h4>${esc(gen.ko.names[ri])}</h4>` + row.map(m => matchCard(m, readOnly)).join('') + `</div>`
      ).join('') + `</div>`;
  }
  const champ = gen.championId ? gen._unitById[gen.championId] : null;
  h += `<div class="champion-banner ${champ ? 'show' : ''}">${champ ? `🏆 <span class="champ-name">${esc(champ.name)}</span> wins the tournament!` : ''}</div>`;
  $('#bracket-body').innerHTML = h;
}

function refreshMatch(m) {
  const r = E.matchResult(m, cur.gen.settings.games, cur.gen.settings.setPoints || 21);
  const prev = m.winnerId;
  m.winnerId = r.complete ? r.winnerId : (m.byed ? m.winnerId : null);
  if (!m.winnerId && prev) {
    cur.gen.matches.forEach(x => { if (dependsOn(x, m)) { x.sets = []; x.winnerId = null; } });
    if (m.stage === 'Final') cur.gen.championId = null;
  }
  if (m.stage === 'Final' && m.winnerId) cur.gen.championId = m.winnerId;
  persistGen();
  renderOrgView();
}

function dependsOn(m, src) {
  for (const side of ['aRef', 'bRef']) {
    const r = m[side];
    if (r && r.kind === 'winner') {
      if (r.matchId === src.id) return true;
      const parent = cur.gen._matchById[r.matchId];
      if (parent && dependsOn(parent, src)) return true;
    }
  }
  return false;
}

// ================= BOOT =================

function fillSkillSelects() {
  const r = $('#reg-rating');
  if (r) r.innerHTML = Object.entries(E.RATING_LABELS).map(([v, label]) =>
    `<option value="${v}" ${Number(v) === 5 ? 'selected' : ''}>${v} — ${label}</option>`).join('');
  const y = $('#reg-years');
  if (y) y.innerHTML = E.YEARS.map((yy, i) =>
    `<option value="${i}" ${i === 1 ? 'selected' : ''}>${yy.label}</option>`).join('');
}

function showSetupNotice(err) {
  showScreen('auth');
  $('#screen-auth .auth-card').innerHTML = `
    <div class="auth-brand">🏸 <b>ShuttleUp</b></div>
    <h2>Almost there — one setup step left</h2>
    <p class="plan-note">This copy of ShuttleUp isn't connected to Firebase yet, so sign-in and live sync are disabled.</p>
    <p class="plan-note">Open <b>js/config.js</b>, paste your Firebase web config into <code>window.FIREBASE_CONFIG</code> (instructions in <b>SETUP.md</b>), and redeploy. <br><br><b>${esc(err && err.message || 'Firebase config missing')}</b></p>`;
}

function friendlyAuthError(err) {
  const c = (err && err.code || '').replace('auth/', '');
  const map = {
    'email-already-in-use': 'That email is already registered — try signing in instead.',
    'invalid-credential': 'Wrong email or password.',
    'user-not-found': 'No account with that email — try creating one.',
    'wrong-password': 'Wrong email or password.',
    'invalid-email': 'That email address doesn\'t look right.',
    'weak-password': 'Password must be at least 6 characters.',
    'too-many-requests': 'Too many attempts — wait a minute and try again.',
    'network-request-failed': 'Network problem — check your connection.',
  };
  return map[c] || (err && err.message) || 'Something went wrong.';
}

(async function boot() {
  if (!DB.isConfigured()) { showSetupNotice({ message: 'FIREBASE_CONFIG is still the placeholder in js/config.js.' }); return; }
  try {
    await DB.init(window.FIREBASE_CONFIG);
  } catch (e) {
    showSetupNotice(e);
    return;
  }
  fillSkillSelects();
  bindUI();
  let prevUid = null;
  DB.onAuthChange(u => {
    const uidChanged = (u && u.uid) !== prevUid;
    prevUid = u ? u.uid : null;
    user = u;
    if (!u) {
      teardownTournament();
      if (unsubTournaments) { unsubTournaments(); unsubTournaments = null; }
      if (unsubPlayers) { unsubPlayers(); unsubPlayers = null; }
      myTournaments = [];
      players = [];
      $('#chip-user').hidden = true;
      $('#btn-signout').textContent = 'Sign in';
      // signed-out viewers keep the live view; everyone else goes to the auth screen
      route();
      return;
    }
    $('#chip-user').hidden = false;
    $('#chip-user').textContent = '👤 ' + (u.displayName || u.email);
    $('#btn-signout').textContent = 'Sign out';
    if (uidChanged) {
      toast('Welcome, ' + (u.displayName || u.email.split('@')[0]) + '!');
      route();
    }
  }, err => { console.warn('auth error', err); });
  showScreen('auth');
})();

// ---------- UI wiring ----------

function bindUI() {
  // auth
  const setAuthMode = m => {
    authMode = m;
    $('#authTab-signup').classList.toggle('active', m === 'signup');
    $('#authTab-login').classList.toggle('active', m === 'login');
    $('#authNameWrap').style.display = m === 'signup' ? '' : 'none';
    $('#authName').required = m === 'signup';
    $('#authSubmit').textContent = m === 'signup' ? 'Create account' : 'Sign in';
    $('#authErr').textContent = '';
  };
  $('#authTab-signup').addEventListener('click', () => setAuthMode('signup'));
  $('#authTab-login').addEventListener('click', () => setAuthMode('login'));
  $('#authForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const email = $('#authEmail').value.trim();
    const pass = $('#authPass').value;
    $('#authErr').textContent = '';
    $('#authSubmit').disabled = true;
    try {
      if (authMode === 'signup') {
        const name = $('#authName').value.trim();
        if (!name) { $('#authErr').textContent = 'Enter your name.'; return; }
        await DB.signUp(name, email, pass);
        // profile update lands after the auth listener fired — fix the chip now
        if (user) { user.displayName = user.displayName || name; $('#chip-user').textContent = '👤 ' + name; }
      } else {
        await DB.signIn(email, pass);
      }
      $('#authForm').reset();
    } catch (err) {
      $('#authErr').textContent = friendlyAuthError(err);
    } finally {
      $('#authSubmit').disabled = false;
    }
  });
  $('#btn-signout').addEventListener('click', () => {
    if (!user) {
      if (window.location.hash === '#/home' || !window.location.hash) showScreen('auth');
      else window.location.hash = '#/home';
      return;
    }
    DB.signOut().catch(() => { });
  });

  // home
  $('#btn-create').addEventListener('click', async () => {
    const name = $('#newName').value.trim();
    if (!name) { toast('Give your tournament a name'); return; }
    try {
      const tid = await DB.createTournament(user.uid, user.displayName || user.email, name, { ...DEFAULTS });
      $('#newName').value = '';
      window.location.hash = '#/t/' + tid;
    } catch (e) { toast('Create failed: ' + (e.message || e)); }
  });
  $$('#homeTabs .tab').forEach(b => b.addEventListener('click', () => {
    homeTab = b.dataset.tab;
    renderHome();
  }));
  $('#rosterSearch').addEventListener('input', renderRoster);

  // org tabs
  $$('#orgTabs .tab').forEach(b => b.addEventListener('click', () => {
    if (b.hidden || b.disabled) return;
    orgTab = b.dataset.tab;
    renderOrgView();
  }));

  // settings (org)
  $$('input[name="mode"]').forEach(radio => radio.addEventListener('change', () => {
    const newMode = radio.value;
    if (!cur || cur.settings.mode === newMode) return;
    cur.settings.mode = newMode;
    if (newMode !== 'doubles-random' && cur.settings.skillMode !== 'off') cur.settings.skillMode = 'off';
    if (regs.some(r => r.mode !== newMode)) toast('Players registered in another mode are kept but excluded from the draw.');
    DB.patchTournament(cur.id, { settings: { ...cur.settings } }).catch(e => toast('Save failed: ' + (e.message || e)));
    renderOrgView();
  }));
  $('#set-games').addEventListener('change', e => {
    if (!cur) return;
    cur.settings.games = Number(e.target.value);
    cur.settings.matchMinutes = cur.settings.games === 5 ? 40 : 25;
    DB.patchTournament(cur.id, { settings: { ...cur.settings } }).catch(() => { });
    renderOrgView();
  });
  $('#set-pts').addEventListener('change', e => {
    if (!cur) return;
    cur.settings.setPoints = Number(e.target.value) || 21;
    DB.patchTournament(cur.id, { settings: { ...cur.settings } }).catch(() => { });
    renderOrgView();
  });
  const patchSetting = key => e => {
    if (!cur) return;
    cur.settings[key] = e.target.value;
    DB.patchTournament(cur.id, { settings: { ...cur.settings } }).catch(() => { });
    renderOrgView();
  };
  $('#set-format').addEventListener('change', patchSetting('format'));
  $('#set-skill').addEventListener('change', patchSetting('skillMode'));
  $('#set-hours').addEventListener('input', e => { if (!cur) return; cur.settings.hours = Number(e.target.value) || 0; renderPlan(); scheduleSettingsSave(); });
  $('#set-courts').addEventListener('input', e => { if (!cur) return; cur.settings.courts = Math.max(1, Math.round(Number(e.target.value) || 1)); renderPlan(); scheduleSettingsSave(); });
  $('#set-matchmin').addEventListener('input', e => { if (!cur) return; cur.settings.matchMinutes = Number(e.target.value) || 25; renderPlan(); scheduleSettingsSave(); });
  $('#set-changeover').addEventListener('input', e => { if (!cur) return; cur.settings.changeoverMinutes = Number(e.target.value) || 0; renderPlan(); scheduleSettingsSave(); });
  $('#set-start').addEventListener('change', e => {
    if (!cur) return;
    const [h, m] = e.target.value.split(':').map(Number);
    cur.settings.startMinutes = (h || 0) * 60 + (m || 0);
    DB.patchTournament(cur.id, { settings: { ...cur.settings } }).catch(() => { });
    renderPlan();
  });
  $('#set-groups').addEventListener('change', e => {
    if (!cur) return;
    cur.settings.groupsOverride = e.target.value === 'auto' ? null : Number(e.target.value);
    DB.patchTournament(cur.id, { settings: { ...cur.settings } }).catch(() => { });
    renderPlan();
  });
  $('#set-grouprounds').addEventListener('change', e => {
    if (!cur) return;
    cur.settings.groupRounds = e.target.value === 'auto' ? null : Number(e.target.value);
    DB.patchTournament(cur.id, { settings: { ...cur.settings } }).catch(() => { });
    renderPlan();
  });
  let setT = null;
  function scheduleSettingsSave() {
    clearTimeout(setT);
    setT = setTimeout(() => DB.patchTournament(cur.id, { settings: { ...cur.settings } }).catch(() => { }), 500);
  }

  // generate / redraw
  $('#btn-generate').addEventListener('click', doGenerate);
  $('#btn-regen').addEventListener('click', () => {
    const msg = hasAnyScore(cur.gen)
      ? 'Scores are already recorded and will be cleared. Redraw groups and schedule?'
      : 'Redraw groups and schedule with a new random draw?';
    if (!confirm(msg)) return;
    cur.gen = E.buildTournament(cur.settings, modeRegs().map(toEntry));
    persistGen();
    renderOrgView();
    toast('New draw generated');
  });
  $('#btn-to-schedule').addEventListener('click', () => { orgTab = 'schedule'; renderOrgView(); });

  // live view invite
  $('#btn-copy-link').addEventListener('click', async () => {
    const link = inviteLink();
    try {
      await navigator.clipboard.writeText(link);
      toast('Link copied — share it with your players!');
    } catch {
      $('#inviteLink').select();
      document.execCommand('copy');
      toast('Link copied');
    }
  });

  // organizer manual registration
  $('#regForm').addEventListener('submit', ev => {
    ev.preventDefault();
    if (!cur) return;
    const m = cur.settings.mode;
    const wasEdit = !!editingRegId;
    const data = {
      mode: m,
      rating: Number($('#reg-rating').value) || 5,
      yearsIdx: Number($('#reg-years').value) || 1,
    };
    if (m === 'doubles-fixed') {
      data.p1 = $('#reg-p1').value.trim();
      data.p2 = $('#reg-p2').value.trim();
      data.teamName = $('#reg-team').value.trim();
      if (!data.p1 || !data.p2) { toast('Enter both players'); return; }
    } else {
      data.name = $('#reg-name').value.trim();
      if (!data.name) { toast('Enter a name'); return; }
    }
    hideRosterSuggest();
    (async () => {
      try {
        if (wasEdit) {
          await DB.updateRegistration(cur.id, editingRegId, data);
          editingRegId = null;
          $('#regSubmit').textContent = '＋ Add player';
          $('#btn-cancel-edit').style.display = 'none';
        } else {
          await DB.addRegistration(cur.id, { ...data, addedBy: user.uid, addedByName: user.displayName || user.email });
          // keep the manager's player roster up to date (skill answers only apply in random-partners mode)
          const names = m === 'doubles-fixed' ? [data.p1, data.p2] : [data.name];
          const withSkill = m === 'doubles-random';
          for (const nm of names) {
            DB.findOrCreatePlayer(user.uid, {
              name: nm,
              rating: withSkill ? data.rating : null,
              yearsIdx: withSkill ? data.yearsIdx : null,
            }).catch(() => { });
          }
        }
        if (m === 'doubles-fixed') { $('#reg-p1').value = ''; $('#reg-p2').value = ''; $('#reg-team').value = ''; }
        else $('#reg-name').value = '';
        if (cur.gen && !wasEdit) toast('Player added — hit Redraw (Groups tab) to include them in the draw.');
        else toast(wasEdit ? 'Updated' : 'Added');
      } catch (e) { toast('Save failed: ' + (e.message || e)); }
    })();
  });
  $('#btn-cancel-edit').addEventListener('click', cancelEdit);

  // roster suggestions while typing a name
  const onNameKey = ev => {
    const t = ev.target;
    if (!t || (t.id !== 'reg-name' && t.id !== 'reg-p1' && t.id !== 'reg-p2')) return;
    showRosterSuggest(t);
  };
  $('#regFields').addEventListener('input', onNameKey);
  $('#regFields').addEventListener('focusin', onNameKey);
  document.addEventListener('click', ev => {
    const box = $('#regSuggest');
    if (box.hidden) return;
    if (box.contains(ev.target)) return;
    if (ev.target.id === 'reg-name' || ev.target.id === 'reg-p1' || ev.target.id === 'reg-p2') return;
    hideRosterSuggest();
  });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') hideRosterSuggest(); });

  // score boxes: select existing contents on focus/tap so typing a digit
  // overwrites it directly (matters most for a box auto-filled with 0 while
  // its partner box is still being typed into).
  document.addEventListener('focus', ev => {
    const inp = ev.target.closest && ev.target.closest('input[data-set]');
    if (inp) inp.select();
  }, true);

  // set score entry (org only). Each match shows a blank box per set — typing a
  // score (e.g. 21, then 15) records that set; clearing both boxes of a set
  // removes it. Committed on blur/Enter so typing isn't interrupted.
  document.addEventListener('change', ev => {
    const t = ev.target;
    if (!t.dataset || t.dataset.set == null || !t.dataset.match || !cur || !cur.gen) return;
    if (!isOrganizer()) return;
    E.rebuildMaps(cur.gen);
    const m = cur.gen._matchById[t.dataset.match];
    if (!m) return;
    const i = Number(t.dataset.set);
    const other = t.dataset.side === 'a' ? 'b' : 'a';
    const inpA = t.dataset.side === 'a' ? t : document.querySelector(`input[data-match="${m.id}"][data-set="${i}"][data-side="a"]`);
    const inpB = t.dataset.side === 'b' ? t : document.querySelector(`input[data-match="${m.id}"][data-set="${i}"][data-side="b"]`);
    if (!inpA || !inpB) return;
    const a = Math.max(0, Math.min(30, Math.round(Number(inpA.value) || 0)));
    const b = Math.max(0, Math.min(30, Math.round(Number(inpB.value) || 0)));
    if (a === 0 && b === 0) { if (m.sets[i]) m.sets.splice(i, 1); }
    else m.sets[i] = [a, b];
    refreshMatch(m);
  });

  // reset a whole match (delegated)
  document.addEventListener('click', ev => {
    const t = ev.target.closest('[data-act]');
    if (!t || !cur || !cur.gen) return;
    if (!isOrganizer()) return;
    E.rebuildMaps(cur.gen);
    const m = cur.gen._matchById[t.dataset.match];
    if (!m) return;
    if (t.dataset.act === 'reset-match') {
      if (!confirm('Clear this match result? Downstream knockout results for it will be cleared too.')) return;
      m.sets = [];
      m.winnerId = null;
      cur.gen.matches.forEach(x => { if (dependsOn(x, m)) { x.sets = []; x.winnerId = null; } });
      if (m.stage === 'Final') cur.gen.championId = null;
      persistGen();
      renderOrgView();
    }
  });
}
