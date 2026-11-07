// Discord-facing half of /plan (pure logic in src/ai/setupplan.js).
// Flow: draft with the model -> validate in code -> show a card -> Apply (only the requester) -> re-check and run
// one op at a time. The card shares the pending map and button handler in src/ai/actions.js ('aiact:' buttons), so
// the requester-only check, the double-click guard, expiry and cancel behave like every other AI action.
const crypto = require('crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const { colors, BRAND } = require('../utils/constants');
const { base, response } = require('../utils/embed');
const store = require('../database/store');
const log = require('../utils/logger');
const plan = require('../ai/setupplan');
const { shared } = require('../ai/actions');

const { pending, hasPending, userRateOk, rateOk, NO_PINGS, audit } = shared;

const ENABLED_KEY = 'ai_plan_enabled'; // off until a server admin turns it on
const COOLDOWN_MS = 60 * 1000;
const TTL_MS = 120 * 1000;
const lastDraft = new Map(); // guildId -> time of the last model call

const DEFAULT_WELCOME = 'Welcome to {server}, {user}! You\'re member #{membercount} \u{1F389}'; // same text as /welcome create
const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 3)}...` : t; };

const enabled = (guildId) => store.getConfig(guildId, ENABLED_KEY) === true;

// Snapshot of the guild in the shape the pure validator expects. Invoker is re-fetched every time.
async function buildState(guild, invokerId) {
  const invoker = await guild.members.fetch({ user: invokerId, force: true }).catch(() => null);
  if (!invoker) return null;
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!me) return null;
  const typeOf = (c) => (c.type === ChannelType.GuildCategory ? 'category' : c.type === ChannelType.GuildText ? 'text' : c.type === ChannelType.GuildVoice ? 'voice' : 'other');
  return {
    ownerId: guild.ownerId,
    invoker: { id: invoker.id, top: invoker.roles.highest.position, has: (f) => invoker.permissions.has(f) },
    bot: { top: me.roles.highest.position, has: (f) => me.permissions.has(f) },
    channels: [...guild.channels.cache.values()].map((c) => ({ id: c.id, name: c.name, type: typeOf(c), parentId: c.parentId || null })),
    roles: [...guild.roles.cache.values()].map((r) => ({ id: r.id, name: r.name, position: r.position, managed: r.managed, everyone: r.id === guild.id })),
  };
}

// Real effects. Config ops call the same store keys the config commands write.
function makeExec(guild, client, reason) {
  const toId = (ref, created) => plan.idOf(ref, created);
  return async (op, index, created) => {
    switch (op.op) {
      case 'create_category': {
        const c = await guild.channels.create({ name: op.name, type: ChannelType.GuildCategory, reason });
        return { id: c.id };
      }
      case 'create_text_channel': {
        const c = await guild.channels.create({ name: op.name, type: ChannelType.GuildText, parent: toId(op.category, created) || undefined, topic: op.topic || undefined, reason });
        return { id: c.id };
      }
      case 'create_voice_channel': {
        const c = await guild.channels.create({ name: op.name, type: ChannelType.GuildVoice, parent: toId(op.category, created) || undefined, reason });
        return { id: c.id };
      }
      case 'create_role': {
        const r = await guild.roles.create({ name: op.name, color: op.color ?? undefined, hoist: op.hoist, permissions: [], mentionable: false, reason });
        return { id: r.id };
      }
      case 'setup_ticket_panel': {
        // run the real /ticket setup so the store keys and the panel are exactly what that command makes
        const channel = guild.channels.cache.get(toId(op.channel, created));
        const role = guild.roles.cache.get(toId(op.support_role, created));
        if (!channel || !role) throw new Error('channel or role not found');
        let out = null;
        await require('../commands/config/ticket').execute({
          guild, client, options: { getSubcommand: () => 'setup', getChannel: () => channel, getRole: () => role },
          reply: async (payload) => { out = payload; },
        });
        if (out?.embeds?.[0]?.data?.color === colors.error) throw new Error(clip(out.embeds[0].data.description || 'ticket setup failed', 160));
        return {};
      }
      case 'set_welcome_channel': {
        store.setConfig(guild.id, 'welcome_channel', toId(op.channel, created));
        if (!store.getConfig(guild.id, 'welcome_message')) store.setConfig(guild.id, 'welcome_message', DEFAULT_WELCOME);
        return {};
      }
      case 'set_log_channel': {
        store.setConfig(guild.id, plan.LOG_KINDS[op.kind], toId(op.channel, created));
        return {};
      }
      case 'set_autorole': {
        const id = toId(op.role, created);
        const roles = store.getConfig(guild.id, 'autoroles') || [];
        if (!roles.includes(id)) store.setConfig(guild.id, 'autoroles', [...roles, id]);
        return {};
      }
      default:
        throw new Error('unknown step');
    }
  };
}

function planCard({ client, ops, dropped, invokerId, expiresAt }) {
  const lines = ops.map((o, i) => `${i + 1}. ${o.text}`);
  const embed = base(client, colors.warning)
    .setAuthor({ name: 'AI SETUP PLAN' })
    .setDescription('Nothing changes until you press Apply.')
    .addFields({ name: `Plan (${ops.length} steps, run in this order)`, value: `\`\`\`\n${clip(lines.join('\n'), 950)}\n\`\`\`` });
  if (ops.some((o) => o.op === 'set_welcome_channel')) {
    embed.addFields({ name: 'Note', value: 'The welcome step also sets the default welcome message if the server has none.' });
  }
  if (dropped.length) {
    const d = dropped.slice(0, 8).map((x) => `- ${x.text}: ${x.reason}`);
    if (dropped.length > 8) d.push(`...and ${dropped.length - 8} more`);
    embed.addFields({ name: 'Left out', value: clip(d.join('\n'), 1000) });
  }
  embed.addFields(
    { name: 'Who can apply', value: `Only <@${invokerId}> (permissions are checked again before every step)`, inline: true },
    { name: 'Expires', value: `<t:${Math.floor(expiresAt / 1000)}:R>`, inline: true },
  );
  return embed;
}

function resultEmbed({ client, title, color, result, total }) {
  const out = [];
  if (result.done.length) out.push(`**Done (${result.done.length}/${total})**\n${result.done.map((d) => `- ${d.text}`).join('\n')}`);
  if (result.failed) out.push(`**Stopped at step ${result.failed.index + 1}**\n- ${result.failed.text}\nReason: ${result.failed.error}`);
  if (result.notRun.length) out.push(`**Not done**\n${result.notRun.map((d) => `- ${d.text}`).join('\n')}`);
  if (!result.failed) out.push('Everything in the plan ran.');
  return base(client, color).setAuthor({ name: title }).setDescription(clip(out.join('\n\n'), 4000))
    .setFooter({ text: `via ${BRAND} AI`, iconURL: client?.user?.displayAvatarURL?.() || undefined });
}

/**
 * Entry point used by the /plan command. deps.ask is the model call (defaults to the shared AI chat helper).
 */
async function propose(interaction, request, deps = {}) {
  const { guild, client } = interaction;
  const ask = deps.ask || require('../utils/ai').chat;
  const say = (description, color = colors.error) =>
    interaction.reply({ embeds: [response({ client, description, color })], ephemeral: true, allowedMentions: NO_PINGS });
  const userId = interaction.user.id;

  if (!guild) return say('this only works in a server.');
  if (!enabled(guild.id)) return say(`ai setup plans are off in this server. an administrator can turn them on with \`${store.getConfig(guild.id, 'prefix') || ';'}plan enable\`.`, colors.muted);
  if (hasPending(guild.id, userId)) return say('you already have one waiting. confirm or cancel it first.', colors.muted);

  const state = await buildState(guild, userId);
  if (!state) return say("couldn't verify your permissions.");
  if (!plan.has(state.invoker, 'ManageGuild')) return say('you need the **Manage Server** permission to ask for a plan.');

  const wait = lastDraft.get(guild.id) + COOLDOWN_MS - Date.now();
  if (wait > 0) return say(`plans are limited to one at a time per server. try again in ${Math.ceil(wait / 1000)} seconds.`, colors.muted);
  if (!userRateOk(guild.id, userId)) return say('slow down a bit. try again in a few minutes.', colors.muted);
  if (!rateOk(guild.id)) return say('a lot of ai actions in a short time. try again later.');

  lastDraft.set(guild.id, Date.now());
  await interaction.deferReply?.();
  const text = await ask(plan.buildMessages(request, state), { maxTokens: 900, temperature: 0, guildId: guild.id, kind: 'chat' }).catch(() => null);
  const reply = (description, color = colors.error) =>
    (interaction.deferred || interaction.replied ? interaction.editReply : interaction.reply).call(interaction, { embeds: [response({ client, description, color })], allowedMentions: NO_PINGS });
  const raw = plan.parsePlanText(text);
  if (!raw) return reply('i could not draft a plan right now (the AI is unavailable, over its limit, or gave an unusable answer). nothing was changed.');

  const { ops, dropped } = plan.validatePlan(raw, state);
  if (!ops.length) {
    const why = dropped.length ? `\n${dropped.slice(0, 6).map((x) => `- ${x.text}: ${x.reason}`).join('\n')}` : '';
    return reply(`there was nothing in that request i can set up.${why}\nnothing was changed.`, colors.muted);
  }

  const id = crypto.randomUUID();
  const expiresAt = Date.now() + TTL_MS;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`aiact:${id}:ok`).setLabel('Apply').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`aiact:${id}:no`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  const payload = { embeds: [planCard({ client, ops, dropped, invokerId: userId, expiresAt })], components: [row], allowedMentions: NO_PINGS };
  const sent = await (interaction.deferred ? interaction.editReply(payload) : interaction.reply(payload)).catch(() => null);
  if (!sent) return;
  const card = sent.edit ? sent : await interaction.fetchReply?.().catch(() => null);

  // The audit row keeps the step names, never the request text.
  const auditId = audit.record({
    guildId: guild.id, invokerId: userId, targetId: '-', kind: 'plan',
    reason: clip(ops.map((o) => o.op).join(', '), 200),
  });
  const timer = setTimeout(() => {
    if (!pending.delete(id)) return;
    audit.resolve(auditId, 'expired');
    card?.edit?.({ embeds: [response({ client, description: 'The plan expired. Nothing was changed.', color: colors.muted })], components: [], allowedMentions: NO_PINGS }).catch(() => {});
  }, TTL_MS);
  timer.unref?.();

  pending.set(id, {
    auditId, kind: 'plan', guildId: guild.id, invokerId: userId, targetId: null, dur: null, timer,
    // runs only after actions.handleButton checked the presser is the requester, removed the card and acknowledged it
    onConfirm: async ({ interaction: press, p, show }) => {
      const tag = press.user.tag;
      const reason = `[${BRAND} plan] requested by ${tag}`.slice(0, 512);
      const exec = makeExec(press.guild, press.client, reason);
      const result = await plan.applyPlan(ops, {
        recheck: async (op, i, created) => {
          const fresh = await buildState(press.guild, p.invokerId);
          if (!fresh) return "couldn't verify your permissions";
          return plan.recheckOp(op, i, fresh, created);
        },
        exec,
      });
      const ok = !result.failed;
      audit.resolve(p.auditId, ok ? 'executed' : (result.failed.stage === 'check' ? 'rejected' : 'failed'),
        `${result.done.length}/${ops.length} done${result.failed ? `; stopped: ${clip(result.failed.error, 120)}` : ''}`);
      log.info(`AI plan ${ok ? 'applied' : 'stopped'}: ${result.done.length}/${ops.length} by=${p.invokerId} guild=${p.guildId}`);
      await show({ embeds: [resultEmbed({ client: press.client, title: ok ? 'PLAN APPLIED' : 'PLAN STOPPED', color: ok ? colors.success : colors.error, result, total: ops.length })] });
    },
  });
  log.info(`AI plan proposed: ${ops.length} steps by=${userId} guild=${guild.id}`);
}

async function setEnabled(interaction, on) {
  const { guild, client } = interaction;
  const member = await guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
  if (!member?.permissions.has('Administrator')) {
    return interaction.reply({ embeds: [response({ client, description: 'only an administrator can change this.', color: colors.error })], ephemeral: true });
  }
  store.setConfig(guild.id, ENABLED_KEY, on);
  return interaction.reply({ embeds: [response({ client, description: on ? 'ai setup plans are on. every plan still needs an Apply press from the person who asked.' : 'ai setup plans are off.', color: on ? colors.success : colors.muted })], ephemeral: true });
}

module.exports = { propose, setEnabled, buildState, makeExec, planCard, resultEmbed, enabled, ENABLED_KEY, COOLDOWN_MS, _resetCooldown: () => lastDraft.clear() };
