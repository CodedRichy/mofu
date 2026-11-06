const { ApplicationCommandOptionType } = require('discord.js');

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
          const id = raw.replace(/[<@!>]/g, '');
          this._parsed[opt.name] = { id, raw };
          break;
        }
        case ApplicationCommandOptionType.Channel: {
          const raw = args.shift();
          const id = raw.replace(/[<#>]/g, '');
          this._parsed[opt.name] = { id, raw };
          break;
        }
        case ApplicationCommandOptionType.Role: {
          const raw = args.shift();
          const id = raw.replace(/[<@&>]/g, '');
          this._parsed[opt.name] = { id, raw };
          break;
        }
        case ApplicationCommandOptionType.Integer: {
          // Keep 0 (e.g. `slowmode 0`); only unparseable input becomes null.
          const n = parseInt(args.shift());
          this._parsed[opt.name] = Number.isNaN(n) ? null : n;
          break;
        }
        case ApplicationCommandOptionType.Number: {
          const n = parseFloat(args.shift());
          this._parsed[opt.name] = Number.isNaN(n) ? null : n;
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
    this._lastReply = await this.message.reply(data);
    return this._lastReply;
  }

  async editReply(data) {
    if (typeof data === 'string') data = { content: data };
    if (this._lastReply) return this._lastReply.edit(data);
    return this.message.reply(data);
  }

  async deferReply() {
    this.deferred = true;
    this._lastReply = await this.message.reply({ content: DEFER_MESSAGES[Math.floor(Math.random() * DEFER_MESSAGES.length)] });
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
    return this.message.reply(data);
  }

  isChatInputCommand() {
    return true;
  }
}

module.exports = PrefixContext;
