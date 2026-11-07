// Weekly community health post for small servers. Pure functions only (aggregation + rendering), no I/O,
// so everything here is unit-tested. Input is counters; message text is never seen or stored.
const { base, footer } = require('./embed');
const { colors } = require('./constants');

const DAY_MS = 86400000;
const WINDOW_DAYS = 7;
const QUIET_MAX_MESSAGES = 3; // a channel with this many messages or fewer in the window is "quiet"
const MAX_QUIET_SHOWN = 3;
const MAX_QUESTIONS_SHOWN = 5;
const MAX_SUGGESTIONS = 3;
const MIN_JOINS_FOR_RATE = 3; // below this a percentage says nothing
const ACTIVATION_MS = DAY_MS; // posted or reacted within this long after joining
const QUESTION_MIN_AGE_MS = 60 * 60 * 1000; // fresh questions are not "unanswered" yet

const FOOTER_TEXT = 'counts only, no message text stored';

// UTC day key, "YYYY-MM-DD".
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

// The last `days` day keys ending at `now` (inclusive), oldest first.
function windowDays(now, days = WINDOW_DAYS) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push(dayKey(now - i * DAY_MS));
  return out;
}

// A question is a message whose trimmed text ends with a question mark. Returns a boolean; the text is not kept.
function isQuestion(text) {
  return typeof text === 'string' && text.trim().endsWith('?');
}

// Is this new member's first activity inside the activation window?
function isActivation(joinedAt, now) {
  return Number.isFinite(joinedAt) && now >= joinedAt && now - joinedAt <= ACTIVATION_MS;
}

// rows: [{ joins, leaves, activated }] (one per day). Returns totals.
function sumDaily(rows) {
  const t = { joins: 0, leaves: 0, activated: 0 };
  for (const r of rows || []) {
    t.joins += Math.max(0, Number(r.joins) || 0);
    t.leaves += Math.max(0, Number(r.leaves) || 0);
    t.activated += Math.max(0, Number(r.activated) || 0);
  }
  t.activated = Math.min(t.activated, t.joins); // a share can never pass 100%
  return t;
}

// channels: [{ id, name, createdAt }] text channels that members can see.
// counts: { channelId: messagesInWindow }. excluded: ids staff excluded.
// Returns up to `limit` quietest channels (fewest messages first, then name); channels made inside the window are skipped.
function quietChannels({ channels, counts, excluded, now, limit = MAX_QUIET_SHOWN }) {
  const skip = new Set(excluded || []);
  const windowStart = now - WINDOW_DAYS * DAY_MS;
  return (channels || [])
    .filter((c) => !skip.has(c.id))
    .filter((c) => !(Number(c.createdAt) > windowStart))
    .map((c) => ({ id: c.id, name: c.name, messages: Math.max(0, Number(counts?.[c.id]) || 0) }))
    .filter((c) => c.messages <= QUIET_MAX_MESSAGES)
    .sort((a, b) => a.messages - b.messages || String(a.name).localeCompare(String(b.name)))
    .slice(0, limit);
}

// questions: [{ guildId, channelId, messageId, createdAt, answered }]. Oldest first, bounded.
function unansweredQuestions({ questions, now, limit = MAX_QUESTIONS_SHOWN }) {
  const all = (questions || [])
    .filter((q) => !q.answered && now - q.createdAt >= QUESTION_MIN_AGE_MS && now - q.createdAt <= WINDOW_DAYS * DAY_MS)
    .sort((a, b) => a.createdAt - b.createdAt);
  return { total: all.length, shown: all.slice(0, limit) };
}

const jumpLink = (q) => `https://discord.com/channels/${q.guildId}/${q.channelId}/${q.messageId}`;

// Up to MAX_SUGGESTIONS suggestions, each phrased as something staff could consider, never as something done.
function suggestions({ totals, quiet, unanswered, helpChannelCount }) {
  const out = [];
  if (unanswered.total > 0) {
    out.push(`Consider having a helper look at the ${unanswered.total} question${unanswered.total === 1 ? '' : 's'} still waiting for a reply.`);
  }
  if (totals.joins >= MIN_JOINS_FOR_RATE && totals.activated / totals.joins < 0.5) {
    out.push('Consider a short welcome message or an intro channel prompt, since fewer than half of new members posted or reacted early on.');
  }
  if (totals.leaves > totals.joins && totals.leaves >= MIN_JOINS_FOR_RATE) {
    out.push('Consider re-reading your rules and welcome flow from a newcomer view, since more people left than joined.');
  }
  if (quiet.length > 0) {
    out.push(`Consider a conversation starter in ${quiet[0].name ? `#${quiet[0].name}` : 'a quiet channel'}, or merging channels that stay quiet.`);
  }
  if (helpChannelCount === 0) {
    out.push('Consider choosing a help channel with the helpadd option so unanswered questions can be listed.');
  }
  return out.slice(0, MAX_SUGGESTIONS);
}

// Build the report data from raw counters. Pure.
function buildReport({ now, daily, counts, channels, excluded, questions, helpChannelCount, since }) {
  const totals = sumDaily(daily);
  const quiet = quietChannels({ channels, counts, excluded, now });
  const unanswered = unansweredQuestions({ questions, now });
  const messages = Object.values(counts || {}).reduce((a, n) => a + Math.max(0, Number(n) || 0), 0);
  return {
    totals, quiet, unanswered, messages,
    helpChannelCount: helpChannelCount || 0,
    partial: Number.isFinite(since) && since > now - WINDOW_DAYS * DAY_MS,
    since: Number.isFinite(since) ? since : null,
    suggestions: suggestions({ totals, quiet, unanswered, helpChannelCount: helpChannelCount || 0 }),
  };
}

const pct = (n, d) => `${Math.round((n / d) * 100)}%`;

// Render the report as an embed.
function renderEmbed(client, report, { guildName } = {}) {
  const { totals, quiet, unanswered } = report;
  const embed = base(client, colors.primary)
    .setTitle(`Weekly community health${guildName ? ` - ${String(guildName).slice(0, 80)}` : ''}`)
    .setFooter(footer(client, FOOTER_TEXT));

  const lines = [`**Joins** ${totals.joins}`, `**Leaves** ${totals.leaves}`, `**Messages** ${report.messages}`];
  if (totals.joins >= MIN_JOINS_FOR_RATE) {
    lines.push(`**Posted again** ${totals.activated} of ${totals.joins} new members (${pct(totals.activated, totals.joins)}) posted or reacted within a day of joining`);
  } else if (totals.joins > 0) {
    lines.push(`**Posted again** ${totals.activated} of ${totals.joins} new members posted or reacted within a day of joining (too few joins for a percentage)`);
  } else {
    lines.push('**Posted again** no new members in this period');
  }
  const intro = report.partial && report.since
    ? `Counting since <t:${Math.floor(report.since / 1000)}:D>, so this covers less than a full week.\n`
    : `Covers the last ${WINDOW_DAYS} days.\n`;
  embed.setDescription(intro + lines.join('\n'));

  embed.addFields({
    name: 'Quiet channels',
    value: quiet.length
      ? quiet.map((c) => `<#${c.id}> - ${c.messages} message${c.messages === 1 ? '' : 's'}`).join('\n')
      : `None at or under ${QUIET_MAX_MESSAGES} messages.`,
  });

  let qValue;
  if (report.helpChannelCount === 0) qValue = 'No help channels chosen yet, so questions are not tracked.';
  else if (unanswered.total === 0) qValue = 'None waiting. A question is a message ending in a question mark that nobody replied to.';
  else {
    qValue = unanswered.shown.map((q, i) => `${i + 1}. [Jump to question](${jumpLink(q)}) in <#${q.channelId}>`).join('\n');
    if (unanswered.total > unanswered.shown.length) qValue += `\n...and ${unanswered.total - unanswered.shown.length} more.`;
  }
  embed.addFields({ name: `Unanswered questions (${unanswered.total})`, value: qValue.slice(0, 1024) });

  if (report.suggestions.length) {
    embed.addFields({ name: 'Suggestions (proposals only, nothing is changed for you)', value: report.suggestions.map((s) => `- ${s}`).join('\n').slice(0, 1024) });
  }
  return embed;
}

module.exports = {
  DAY_MS, WINDOW_DAYS, QUIET_MAX_MESSAGES, MAX_QUIET_SHOWN, MAX_QUESTIONS_SHOWN, MAX_SUGGESTIONS, MIN_JOINS_FOR_RATE,
  ACTIVATION_MS, QUESTION_MIN_AGE_MS, FOOTER_TEXT,
  dayKey, windowDays, isQuestion, isActivation, sumDaily, quietChannels, unansweredQuestions, jumpLink,
  suggestions, buildReport, renderEmbed,
};
