const { ApplicationCommandOptionType } = require('discord.js');

// Slash commands get min/max/length/choices enforced by Discord; prefix input is free text, so enforce the same
// limits here. Returns { error } for a bad value, { value } for a normalized one, or null when it is fine.
function validateOption(opt, val) {
  if (val === null || val === undefined) {
    // an Integer/Number that was supplied but did not parse
    if (opt.type === ApplicationCommandOptionType.Integer || opt.type === ApplicationCommandOptionType.Number) {
      return { error: `\`${opt.name}\` must be a number (digits only, no commas or suffixes like \`1k\`).` };
    }
    return null;
  }
  const isNum = opt.type === ApplicationCommandOptionType.Integer || opt.type === ApplicationCommandOptionType.Number;
  if (isNum) {
    if (opt.min_value !== undefined && val < opt.min_value) return { error: `\`${opt.name}\` must be at least ${opt.min_value}.` };
    if (opt.max_value !== undefined && val > opt.max_value) return { error: `\`${opt.name}\` must be at most ${opt.max_value}.` };
  }
  if (opt.type === ApplicationCommandOptionType.String && typeof val === 'string') {
    if (opt.min_length !== undefined && val.length < opt.min_length) return { error: `\`${opt.name}\` must be at least ${opt.min_length} characters.` };
    if (opt.max_length !== undefined && val.length > opt.max_length) return { error: `\`${opt.name}\` must be at most ${opt.max_length} characters.` };
  }
  if (Array.isArray(opt.choices) && opt.choices.length && (isNum || opt.type === ApplicationCommandOptionType.String)) {
    const lower = (x) => String(x).toLowerCase();
    const hit = opt.choices.find((c) => lower(c.value) === lower(val) || lower(c.name) === lower(val));
    if (!hit) return { error: `\`${opt.name}\` must be one of: ${opt.choices.map((c) => `\`${c.value}\``).join(', ')}.` };
    if (hit.value !== val) return { value: hit.value };
  }
  return null;
}

const DEFER_MESSAGES = [
  'listening..',
  'reading the room..',
  'taking it all in..',
  'piecing it together..',
  'one moment, thinking..',
  'tuning in..',
  'picking up on that..',
  'sitting with this..',
  'catching the vibe..',
  'hold that thought..',
];

class PrefixContext {
  constructor(message, args, command) {
    this.message = message;
    this.guild = message.guild;
    this.channel = message.channel;
    this.user = message.author;
    this.member = message.member;
    this.client = message.client;
    this.guildId = message.guildId;
    this.channelId = message.channelId;
    this.createdTimestamp = message.createdTimestamp;
    this.commandName = command.data.name;
    this.replied = false;
    this.deferred = false;

    this._parsed = {};
    this._subcommand = null;
    this._missingArgs = [];
    this._invalid = []; // human-readable problems with supplied values (out of range, not a choice, ...)
    this._parseArgs(args, command.data.toJSON());
  }

  _parseArgs(args, data) {
    let options = data.options || [];

    // Handle subcommands
    if (options.length && options[0].type === ApplicationCommandOptionType.Subcommand) {
      const subName = args.shift();
      this._subcommand = subName || null;
      const sub = options.find((o) => o.name === subName);
      if (sub) options = sub.options || [];
      else options = [];
    }

    const attachments = [...(this.message.attachments?.values() ?? [])];

    for (const opt of options) {
      // Attachments come from the message itself, not from text args.
      if (opt.type === ApplicationCommandOptionType.Attachment) {
        const file = attachments.shift();
        if (file) this._parsed[opt.name] = file;
        else if (opt.required) this._missingArgs.push(opt.name);
        continue;
      }

      if (args.length === 0) {
        if (opt.required) this._missingArgs.push(opt.name);
        continue;
      }

      switch (opt.type) {
        case ApplicationCommandOptionType.User: {
          const raw = args.shift();
          const m = /^<@!?(\d{17,20})>$/.exec(raw) || /^(\d{17,20})$/.exec(raw);
          const cache = this.client?.users?.cache;
          if (!m || (cache && !cache.has(m[1]))) { this._invalid.push(`Could not find that user (\`${opt.name}\`). Mention them or use their ID.`); continue; }
          this._parsed[opt.name] = { id: m[1], raw };
          break;
        }
        case ApplicationCommandOptionType.Channel: {
          const raw = args.shift();
          const m = /^<#(\d{17,20})>$/.exec(raw) || /^(\d{17,20})$/.exec(raw);
          const cache = this.guild?.channels?.cache;
          if (!m || (cache && !cache.has(m[1]))) { this._invalid.push(`Could not find that channel (\`${opt.name}\`). Mention it or use its ID.`); continue; }
          this._parsed[opt.name] = { id: m[1], raw };
          break;
        }
        case ApplicationCommandOptionType.Role: {
          const raw = args.shift();
          const m = /^<@&(\d{17,20})>$/.exec(raw) || /^(\d{17,20})$/.exec(raw);
          const cache = this.guild?.roles?.cache;
          if (!m || (cache && !cache.has(m[1]))) { this._invalid.push(`Could not find that role (\`${opt.name}\`). Mention it or use its ID.`); continue; }
          this._parsed[opt.name] = { id: m[1], raw };
          break;
        }
        case ApplicationCommandOptionType.Integer: {
          // Strict: optional sign + digits only. "1k", "1,000", "5e3" are rejected instead of silently becoming 1/1/5.
          // Keep 0 (e.g. `slowmode 0`); only unparseable input becomes null (reported by validateOption).
          const t = args.shift();
          const n = /^[+-]?\d+$/.test(t) ? Number(t) : NaN;
          this._parsed[opt.name] = Number.isSafeInteger(n) ? n : null;
          break;
        }
        case ApplicationCommandOptionType.Number: {
          const t = args.shift();
          const n = /^[+-]?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN;
          this._parsed[opt.name] = Number.isFinite(n) ? n : null;
          break;
        }
        case ApplicationCommandOptionType.Boolean: {
          const val = args.shift()?.toLowerCase();
          this._parsed[opt.name] = val === 'true' || val === 'yes' || val === '1';
          break;
        }
        case ApplicationCommandOptionType.String: {
          if (opt === options[options.length - 1]) {
            this._parsed[opt.name] = args.join(' ') || null;
            args = [];
          } else {
            this._parsed[opt.name] = args.shift();
          }
          break;
        }
        default:
          this._parsed[opt.name] = args.shift();
      }

      const check = validateOption(opt, this._parsed[opt.name]);
      if (check?.error) {
        this._invalid.push(check.error);
        delete this._parsed[opt.name];
      } else if (check && 'value' in check) {
        this._parsed[opt.name] = check.value;
      }
    }
  }

  get options() {
    const ctx = this;
    return {
      getUser(name) {
        const val = ctx._parsed[name];
        if (!val) return null;
        return ctx.client.users.cache.get(val.id) || null;
      },
      getMember(name) {
        const val = ctx._parsed[name];
        if (!val) return null;
        return ctx.guild.members.cache.get(val.id) || null;
      },
      getString(name) {
        return ctx._parsed[name] || null;
      },
      getInteger(name) {
        return ctx._parsed[name] ?? null;
      },
      getRole(name) {
        const val = ctx._parsed[name];
        if (!val) return null;
        return ctx.guild.roles.cache.get(val.id) || null;
      },
      getChannel(name) {
        const val = ctx._parsed[name];
        if (!val) return null;
        return ctx.guild.channels.cache.get(val.id) || null;
      },
      getBoolean(name) {
        return ctx._parsed[name] ?? null;
      },
      getNumber(name) {
        return ctx._parsed[name] ?? null;
      },
      getAttachment(name) {
        return ctx._parsed[name] ?? null;
      },
      getSubcommand() {
        return ctx._subcommand;
      },
    };
  }

  async reply(data) {
    this.replied = true;
    if (typeof data === 'string') data = { content: data };
    if (data.ephemeral) delete data.ephemeral;
    this._lastReply = await this.message.reply({ failIfNotExists: false, ...data });
    return this._lastReply;
  }

  async editReply(data) {
    if (typeof data === 'string') data = { content: data };
    // The deferred placeholder ("hold that thought..") is plain message content; an edit that omits `content` keeps it,
    // so every embed reply ended up under stray text. Clear it unless the caller set content on purpose.
    if (!('content' in data)) data = { ...data, content: null };
    if (this._lastReply) return this._lastReply.edit(data);
    return this.message.reply({ failIfNotExists: false, ...data });
  }

  async deleteReply() {
    if (this._lastReply) await this._lastReply.delete();
    this._lastReply = null;
  }

  async deferReply() {
    this.deferred = true;
    this._lastReply = await this.message.reply({ failIfNotExists: false, content: DEFER_MESSAGES[Math.floor(Math.random() * DEFER_MESSAGES.length)] });
    return this._lastReply;
  }

  async fetchReply() {
    return this._lastReply ?? null;
  }

  get memberPermissions() {
    return this.member?.permissions ?? null;
  }

  async followUp(data) {
    if (typeof data === 'string') data = { content: data };
    if (data.ephemeral) delete data.ephemeral;
    return this.message.reply({ failIfNotExists: false, ...data });
  }

  isChatInputCommand() {
    return true;
  }
}

module.exports = PrefixContext;
