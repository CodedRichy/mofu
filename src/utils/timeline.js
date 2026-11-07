// Per-member case timeline: merges numbered cases (every action type, including notes and appeals) with the
// older store-only warnings and notes that never got a case number, newest first.
// The merge and render functions are pure; loadTimeline/renderTimelineField read the database lazily.
// renderTimelineField(guildId, userId) is the entry point other code (e.g. a confirm card) can call.

const { clip, modLabel } = require('./modguard');

const DEDUPE_MS = 10000; // a warning/note row and the case opened for the same action land within seconds
const FIELD_MAX = 1024;

const tsOf = (iso) => {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
};

// cases: mod_cases rows; warnings/notes: store rows ({ id, moderator, reason|content, timestamp }).
// A store row is dropped when a case of the same kind exists for this member within DEDUPE_MS, because that
// case already represents it (with its number).
function mergeTimeline({ cases = [], warnings = [], notes = [] } = {}) {
  const entries = cases.map((c) => ({
    ts: c.created_at,
    caseId: c.case_id,
    kind: 'case',
    action: String(c.action || 'case'),
    moderator: c.moderator_id || c.moderator_tag || null,
    reason: c.reason || null,
    duration: c.duration || null,
    status: c.status || 'active',
  }));

  // A note case carries no text (the text lives in the notes table). Show it while the note exists.
  for (const e of entries) {
    if (e.action !== 'note') continue;
    const hit = notes.find((n) => Math.abs(tsOf(n.timestamp) - e.ts) <= DEDUPE_MS);
    e.reason = hit ? hit.content : '(note removed)';
  }

  const covered = (kind, ts) => cases.some((c) => c.action === kind && Math.abs(c.created_at - ts) <= DEDUPE_MS);

  for (const w of warnings) {
    const ts = tsOf(w.timestamp);
    if (covered('warn', ts)) continue;
    entries.push({ ts, caseId: null, kind: 'warning', refId: w.id, action: 'warn', moderator: w.moderator || null, reason: w.reason || null, duration: null, status: 'active' });
  }
  for (const n of notes) {
    const ts = tsOf(n.timestamp);
    if (covered('note', ts)) continue;
    entries.push({ ts, caseId: null, kind: 'note', refId: n.id, action: 'note', moderator: n.moderator || null, reason: n.content || null, duration: null, status: 'active' });
  }

  // newest first; case number breaks ties so two actions in the same millisecond keep their order
  entries.sort((a, b) => (b.ts - a.ts) || ((b.caseId || 0) - (a.caseId || 0)));
  return entries;
}

function formatEntry(e, { reasonMax = 80 } = {}) {
  const label = e.caseId ? `\`#${e.caseId}\`` : `\`${e.kind} #${e.refId}\``;
  const dur = e.duration ? ` ${clip(e.duration, 12)}` : '';
  const void_ = e.status === 'void' ? ' (void)' : '';
  const why = e.reason ? ` - ${clip(String(e.reason).replace(/\s+/g, ' '), reasonMax)}` : '';
  const who = e.moderator ? ` by ${modLabel(e.moderator)}` : '';
  const when = e.ts ? ` <t:${Math.floor(e.ts / 1000)}:R>` : '';
  return `${label} **${clip(e.action, 24)}**${dur}${void_}${why}${who}${when}`;
}

// A compact embed field: newest `limit` entries, always within Discord's 1024-character field limit.
function timelineField(entries, { limit = 5, name = 'Recent timeline', reasonMax = 60 } = {}) {
  if (!entries.length) return { name, value: 'Nothing recorded for this member.', inline: false };
  const shown = entries.slice(0, limit).map((e) => formatEntry(e, { reasonMax }));
  let value = shown.join('\n');
  const more = entries.length - shown.length;
  if (more > 0) value += `\n...and ${more} older`;
  if (value.length > FIELD_MAX) {
    // too long: drop lines from the bottom, keep the count honest
    while (shown.length > 1 && `${shown.join('\n')}\n...and ${entries.length - shown.length} older`.length > FIELD_MAX) shown.pop();
    value = clip(`${shown.join('\n')}${entries.length > shown.length ? `\n...and ${entries.length - shown.length} older` : ''}`, FIELD_MAX);
  }
  return { name, value, inline: false };
}

// deps (for tests): { infractions, store }
function loadTimeline(guildId, userId, { limit = 50, deps = {} } = {}) {
  const infractions = deps.infractions || require('../database/infractions');
  const store = deps.store || require('../database/store');
  return mergeTimeline({
    cases: infractions.casesFor(guildId, userId, limit),
    warnings: store.getWarnings(guildId, userId),
    notes: store.getNotes(guildId, userId),
  });
}

// Never throws: a broken lookup must not break the card that asked for it. Returns an embed field or null.
function renderTimelineField(guildId, userId, opts = {}) {
  try {
    const entries = loadTimeline(guildId, userId, { deps: opts.deps });
    return timelineField(entries, opts);
  } catch {
    return null;
  }
}

module.exports = { mergeTimeline, formatEntry, timelineField, loadTimeline, renderTimelineField, DEDUPE_MS };
