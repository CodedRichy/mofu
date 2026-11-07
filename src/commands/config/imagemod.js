const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const imagemod = require('../../utils/imagemod');
const crowd = require('../../utils/crowdsignal');
const duration = require('../../utils/duration');
const store = require('../../database/store');

// Image checks settings. Default OFF per server. Prefix command (the manager registers it).
const STATE_CHOICES = [{ name: 'on', value: 'on' }, { name: 'off', value: 'off' }];
const withState = (name, desc) => (s) => s.setName(name).setDescription(desc)
  .addStringOption((o) => o.setName('state').setDescription('on or off').setRequired(true).addChoices(...STATE_CHOICES));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('imagemod')
    .setDescription('Check suspicious images (scam images, login QR codes) when the chat reacts to them')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('on').setDescription('Turn image checks on'))
    .addSubcommand((s) => s.setName('off').setDescription('Turn image checks off'))
    .addSubcommand((s) => s.setName('status').setDescription('Show the image check settings and the daily count'))
    .addSubcommand((s) => s.setName('test').setDescription('Try it yourself: check the next image you post, no crowd needed')
      .addStringOption((o) => o.setName('mode').setDescription('scan = real check, buttons = fake alert to try the buttons')
        .addChoices({ name: 'scan', value: 'scan' }, { name: 'buttons', value: 'buttons' })))
    .addSubcommand(withState('autodelete', 'Delete high-confidence matches automatically'))
    .addSubcommand(withState('scanall', 'Also check images from accounts under 7 days old'))
    .addSubcommand((s) => s.setName('categories').setDescription('List or change what is alerted on')
      .addStringOption((o) => o.setName('name').setDescription('Category to switch').addChoices(
        ...imagemod.CATEGORIES.map((c) => ({ name: c, value: c })),
      ))
      .addStringOption((o) => o.setName('state').setDescription('on or off').addChoices(...STATE_CHOICES))),

  async execute(interaction) {
    const { guild } = interaction;
    const reply = (description, color = colors.primary) =>
      interaction.reply({ embeds: [response({ client: interaction.client, description, color })], ephemeral: true });

    const perms = interaction.member?.permissions;
    if (!perms || !(perms.has('ManageGuild') || perms.has('Administrator'))) {
      return reply('You need the Manage Server permission to change image checks.', colors.error);
    }

    const sub = interaction.options.getSubcommand();
    const cfg = imagemod.getConfig(guild.id);
    const hasModlog = Boolean(store.getConfig(guild.id, 'modlog_channel'));

    if (sub === 'on' || sub === 'off') {
      imagemod.setConfig(guild.id, { enabled: sub === 'on' });
      if (sub === 'off') return reply('Image checks are **off**.', colors.muted);
      return reply([
        'Image checks are **on**.',
        imagemod.PRIVACY_LINE,
        'Discord already blurs explicit media for many members, so the default categories are scam text and login QR codes.',
        hasModlog ? 'Alerts go to your modlog channel with Delete, Timeout and Dismiss buttons.' : '**No modlog channel is set**, so nothing will be checked or alerted until one is configured.',
        imagemod.REPORT_LINE,
      ].join('\n'), hasModlog ? colors.success : colors.warning);
    }

    if (sub === 'test') {
      if (!cfg.enabled) return reply('Turn image checks on first with `imagemod on`, then run the test again.', colors.warning);
      if (!hasModlog) return reply('Set a modlog channel first: the test posts its alert there.', colors.warning);
      const mode = interaction.options.getString('mode') === 'buttons' ? 'buttons' : 'scan';
      require('../../handlers/imagemod').armTest(guild.id, interaction.user.id, mode);
      return reply(mode === 'buttons'
        ? 'Ready. Post any image in the next 5 minutes and I will send a clearly labelled TEST alert to the modlog channel so you can try its buttons. Delete will really delete the image you posted.'
        : 'Ready. Post an image in the next 5 minutes and I will check it for real (login QR code, then the model) and say what I found. For a login QR test, use a QR that encodes a discord.com/ra/ link.', colors.success);
    }

    if (sub === 'autodelete' || sub === 'scanall') {
      const on = interaction.options.getString('state') === 'on';
      imagemod.setConfig(guild.id, sub === 'autodelete' ? { autoDelete: on } : { scanAll: on });
      if (sub === 'autodelete') {
        return reply(on
          ? `Auto-delete is **on**: matches at ${Math.round(imagemod.AUTO_DELETE_CONFIDENCE * 100)}% confidence or higher are deleted without a button press. The alert still goes to the modlog channel.`
          : 'Auto-delete is **off**. Moderators decide with the buttons.', on ? colors.warning : colors.muted);
      }
      return reply(on
        ? `Scan-all is **on**: images from accounts under ${duration.format(imagemod.NEW_ACCOUNT_MS)} old are checked even without a crowd reaction. Each check uses the daily image allowance.`
        : 'Scan-all is **off**: images are checked only after the chat reacts to them.', on ? colors.warning : colors.muted);
    }

    if (sub === 'categories') {
      const name = interaction.options.getString('name');
      const state = interaction.options.getString('state');
      let next = cfg;
      if (name && state) {
        const set = new Set(cfg.categories);
        if (state === 'on') set.add(name); else set.delete(name);
        next = imagemod.setConfig(guild.id, { categories: [...set] });
      }
      const lines = imagemod.CATEGORIES.map((c) => `${next.categories.includes(c) ? '[on] ' : '[off]'} \`${c}\` ${imagemod.CATEGORY_LABEL[c]}`);
      return reply(`**Categories**\n${lines.join('\n')}\nChange one with \`categories <name> <on|off>\`. Login QR codes are decoded locally; the other categories use the model.`);
    }

    // status
    const u = imagemod.getUsage(guild.id);
    const geminiOk = require('../../utils/gemini').available();
    return reply([
      `**Image checks** ${cfg.enabled ? 'on' : 'off'}`,
      `**Auto-delete** ${cfg.autoDelete ? 'on' : 'off'}   **Scan-all** ${cfg.scanAll ? 'on' : 'off'}`,
      `**Categories** ${cfg.categories.length ? cfg.categories.join(', ') : 'none'}`,
      `**Alert channel** ${hasModlog ? 'modlog channel set' : 'not set (required)'}`,
      `**Model key** ${geminiOk ? 'configured' : 'missing (only QR decoding works)'}`,
      `**Today (UTC)** ${u.used} of ${imagemod.DAILY_IMAGE_BUDGET} model checks used, ${u.flagged} flagged, ${u.deleted} deleted, ${u.dismissed} dismissed, ${u.denied} skipped for the allowance`,
      `**Crowd window** ${duration.format(crowd.WINDOW_MS)} after an image post`,
      '',
      imagemod.PRIVACY_LINE,
      imagemod.REPORT_LINE,
    ].join('\n'), colors.info);
  },
};
