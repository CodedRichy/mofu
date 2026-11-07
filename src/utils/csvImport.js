// Parse a CSV of warnings exported from another bot. Strict on purpose: this is an uploaded file.
//   - every user id must look like a Discord snowflake
//   - hard caps on rows and on field lengths
//   - problems are reported per line, they never abort the whole import silently
const MAX_ROWS = 1000;
const MAX_REASON = 1000;
const MAX_FIELD = 20000;
const SNOWFLAKE = /^\d{15,21}$/;

// Minimal RFC-4180 style parser: quoted fields, "" escapes, delimiters and newlines inside quotes.
// The delimiter (comma, semicolon or tab) is detected from the first line unless given.
// Returns rows; `rows.unterminatedFrom` is the 1-based line where a quote was opened and never closed (0 if none).
function parseCsv(text, delimiter) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const delim = delimiter || detectDelimiter(src);
  const rows = [];
  let line = 1;
  let quoteLine = 0;
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\n' || (c === '\r' && src[i + 1] !== '\n')) line++;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else {
        field += c;
        // a real reason is capped at MAX_REASON; a quoted field this long is a quote that was never closed
        if (field.length > MAX_FIELD) break;
      }
    } else if (c === '"' && field.trim() === '') { inQuotes = true; quoteLine = line; field = ''; }
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  Object.defineProperty(rows, 'unterminatedFrom', { value: inQuotes ? quoteLine : 0, enumerable: false });
  if (inQuotes) return rows; // the half-read row is dropped, never imported
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows;
}

// Pick the delimiter from the header line: whichever of , ; tab appears most outside quotes (comma wins ties).
function detectDelimiter(src) {
  const first = src.split(/\r\n|\n|\r/, 1)[0] || '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let q = false;
  for (const c of first) {
    if (c === '"') q = !q;
    else if (!q && c in counts) counts[c]++;
  }
  let best = ',';
  for (const d of [';', '\t']) if (counts[d] > counts[best]) best = d;
  return best;
}

const ALIASES = {
  user: ['user_id', 'userid', 'user', 'member', 'member_id', 'id', 'target', 'target_id'],
  reason: ['reason', 'warning', 'message', 'note', 'text'],
  moderator: ['moderator', 'moderator_id', 'mod', 'mod_id', 'issuer', 'issued_by', 'by'],
  timestamp: ['timestamp', 'date', 'created_at', 'created', 'time', 'when'],
};

function columnMap(header) {
  const names = header.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const map = {};
  for (const [key, list] of Object.entries(ALIASES)) {
    const idx = names.findIndex((n) => list.includes(n));
    if (idx >= 0) map[key] = idx;
  }
  return map;
}

function toIso(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  const ms = /^\d{10}$/.test(v) ? Number(v) * 1000 : /^\d{13}$/.test(v) ? Number(v) : Date.parse(v);
  if (!Number.isFinite(ms) || ms < Date.UTC(2015, 4, 13) || ms > Date.now() + 86400000) return null; // before Discord existed / future
  return new Date(ms).toISOString();
}

/**
 * @returns {{ rows: {userId, reason, moderatorId, timestamp}[], errors: string[], truncated: boolean }}
 */
function parseWarningsCsv(text) {
  const table = parseCsv(text);
  const errors = [];
  const badQuoteLine = table.unterminatedFrom || 0;
  const quoteError = badQuoteLine ? `line ${badQuoteLine}: a quote was opened and never closed, so this row and everything after it was skipped. fix the quote and re-upload.` : null;
  if (!table.length) return { rows: [], errors: quoteError ? [quoteError] : ['the file is empty.'], truncated: false };

  // header row if the first cell of the first row is not a snowflake
  const hasHeader = !SNOWFLAKE.test(table[0][0].trim());
  let cols = { user: 0, reason: 1, moderator: 2, timestamp: 3 };
  let start = 0;
  if (hasHeader) {
    cols = columnMap(table[0]);
    start = 1;
    if (cols.user === undefined) return { rows: [], errors: ['no user column found. use a header like `user_id,reason`.'], truncated: false };
  }

  const rows = [];
  const seen = new Set();
  let truncated = false;
  for (let i = start; i < table.length; i++) {
    const line = i + 1;
    if (rows.length >= MAX_ROWS) { truncated = true; break; }
    const cells = table[i];
    const userId = (cells[cols.user] || '').trim();
    if (!SNOWFLAKE.test(userId)) { if (errors.length < 10) errors.push(`line ${line}: "${userId.slice(0, 30)}" is not a user id.`); continue; }
    const reason = (cols.reason !== undefined ? cells[cols.reason] || '' : '').replace(/\s+/g, ' ').trim().slice(0, MAX_REASON) || 'No reason provided';
    const modRaw = cols.moderator !== undefined ? (cells[cols.moderator] || '').trim() : '';
    const moderatorId = SNOWFLAKE.test(modRaw) ? modRaw : null;
    const timestamp = cols.timestamp !== undefined ? toIso(cells[cols.timestamp]) : null;

    const key = `${userId}|${reason}|${timestamp || ''}`;
    if (seen.has(key)) continue; // exact duplicate row in the same file
    seen.add(key);
    rows.push({ userId, reason, moderatorId, timestamp });
  }
  if (quoteError) errors.push(quoteError);
  return { rows, errors, truncated };
}

module.exports = { parseCsv, parseWarningsCsv, MAX_ROWS };
