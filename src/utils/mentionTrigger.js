// Mention-first chat trigger. Pure helper, no Discord objects, no network.
//
// Why it exists: without the Message Content privileged intent Discord still delivers the text of messages
// that mention the bot (and DMs and the bot's own messages). So "@mofu what is the time" keeps working even
// when keyword triggers ("yo mofu ...") and prefix commands cannot see message text.
//
// Two ways to be addressed here:
//   - 'mention': the message STARTS with a mention of the bot (<@id> or <@!id>). A mention in the middle of a
//     sentence is somebody talking about the bot, not to it, so it does not count.
//   - 'reply':   the message is a reply to one of the bot's own chat messages (the caller works that out, see
//     messageCreate.js, and passes isReplyToBot). Discord only includes the text of a reply when the reply
//     pings the bot, which is the default for the Reply button.
// A leading mention is stripped from the returned text in both cases.

const LEADING_JOINERS = /^[\s,:;\-–—]+/;

function cleanId(id) {
  return String(id ?? '').replace(/\D/g, '');
}

// Returns { triggered, kind, text }. kind is 'mention', 'reply' or null. text is the message with a leading bot
// mention (and the punctuation right after it) removed, trimmed. text may be '' (a bare ping).
function detectMentionTrigger({ content, botId, isReplyToBot = false } = {}) {
  const none = { triggered: false, kind: null, text: typeof content === 'string' ? content.trim() : '' };
  const id = cleanId(botId);
  if (!id || typeof content !== 'string') return none;

  const m = new RegExp(`^\\s*<@!?${id}>`).exec(content);
  if (m) {
    const text = content.slice(m[0].length).replace(LEADING_JOINERS, '').trim();
    return { triggered: true, kind: 'mention', text };
  }
  if (isReplyToBot) return { triggered: true, kind: 'reply', text: content.trim() };
  return none;
}

// True when the text mentions the bot anywhere. Not a trigger by itself.
function mentionsBotAnywhere(content, botId) {
  const id = cleanId(botId);
  if (!id || typeof content !== 'string') return false;
  return new RegExp(`<@!?${id}>`).test(content);
}

module.exports = { detectMentionTrigger, mentionsBotAnywhere };
