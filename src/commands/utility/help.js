const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { colors, BRAND } = require('../../utils/constants');
const { base, footer } = require('../../utils/embed');
const { isSlash } = require('../../utils/invocation');
const config = require('../../config');
const store = require('../../database/store');
const fs = require('fs');
const path = require('path');

// Prefix-only commands are not registered as slash, so never advertise `/name` for them.
function usage(name, prefix) {
  return isSlash(name) ? `\`/${name}\` or \`${prefix}${name}\`` : `\`${prefix}${name}\``;
}

// Join lines up to max chars; say how many were left out instead of letting Discord reject the embed.
function fitLines(lines, max) {
  const out = [];
  let len = 0;
  for (let i = 0; i < lines.length; i++) {
    if (len + lines[i].length + 1 > max - 40) {
      out.push(`...and ${lines.length - i} more not shown here`);
      break;
    }
    out.push(lines[i]);
    len += lines[i].length + 1;
  }
  return out.join('\n');
}

const helpRef = (prefix) => (isSlash('help') ? '`/help <command>`' : `\`${prefix}help <command>\``);

const categoryMeta = {
  moderation: { emoji: '🛡️', desc: 'Keep your server safe' },
  config: { emoji: '⚙️', desc: 'Server configuration' },
  economy: { emoji: '💰', desc: 'Currency and gambling' },
  leveling: { emoji: '📊', desc: 'XP and rank progression' },
  utility: { emoji: '🔧', desc: 'Tools and information' },
  music: { emoji: '🎵', desc: 'Music playback' },
  fun: { emoji: '🎮', desc: 'Games and entertainment' },
  lastfm: { emoji: '🎧', desc: 'Last.fm scrobbling' },
  ai: { emoji: '🤖', desc: 'AI-powered features' },
};

function getCategories(commands) {
  const commandsDir = path.join(__dirname, '..');
  const categories = {};

  for (const folder of fs.readdirSync(commandsDir)) {
    const folderPath = path.join(commandsDir, folder);
    if (!fs.statSync(folderPath).isDirectory()) continue;
    const files = fs.readdirSync(folderPath).filter((f) => f.endsWith('.js'));
    const cmds = files.map((f) => f.replace('.js', '')).filter((name) => commands.has(name));
    if (cmds.length) categories[folder] = cmds;
  }

  return categories;
}

function buildOverviewEmbed(client, categories, prefix) {
  const lines = Object.entries(categories).map(([cat, cmds]) => {
    const meta = categoryMeta[cat] || { emoji: '📁', desc: cat };
    return `${meta.emoji} **${cat.charAt(0).toUpperCase() + cat.slice(1)}** — ${cmds.length} commands\n▸ ${meta.desc}`;
  });

  const total = Object.values(categories).reduce((s, c) => s + c.length, 0);

  return base(client, colors.primary)
    .setAuthor({ name: `${BRAND} — command list`, iconURL: client.user.displayAvatarURL() })
    .setDescription(
      `${lines.join('\n\n')}\n\n` +
      `**${total}** commands total\n` +
      `Use the menu below to browse a category\n` +
      `${helpRef(prefix)} for detailed info\n` +
      `**Prefix** \`${prefix}\` works for every command. **Slash** \`/\` works for the ones marked \`/\` in each category.`
    );
}

function buildCategoryEmbed(client, cat, cmds, commands, prefix) {
  const meta = categoryMeta[cat] || { emoji: '📁', desc: cat };
  const title = cat.charAt(0).toUpperCase() + cat.slice(1);

  const commandLines = cmds.map((name) => {
    const cmd = commands.get(name);
    const desc = cmd?.data?.toJSON?.()?.description || 'No description';
    return `\`${prefix}${name}\`${isSlash(name) ? ' `/`' : ''} — ${desc}`;
  });

  return base(client, colors.primary)
    .setAuthor({ name: `${meta.emoji} ${title}`, iconURL: client.user.displayAvatarURL() })
    .setDescription(fitLines(commandLines, 4000))
    .setFooter(footer(client, `${cmds.length} commands • ${isSlash('help') ? '/' : prefix}help <command> for details`));
}

// Second menu: pick a command in the open category to see its description (cap 25).
function buildCommandMenu(cmds, commands) {
  return new StringSelectMenuBuilder()
    .setCustomId('help_cmd')
    .setPlaceholder('Pick a command for details')
    .addOptions(cmds.slice(0, 25).map((name) => ({
      label: name.slice(0, 100),
      description: (commands.get(name)?.data?.toJSON?.()?.description || 'No description').slice(0, 100),
      value: name,
    })));
}

function buildMenu(categories) {
  return new StringSelectMenuBuilder()
    .setCustomId('help_category')
    .setPlaceholder('Select a category')
    .addOptions(
      Object.entries(categories).map(([cat, cmds]) => {
        const meta = categoryMeta[cat] || { emoji: '📁', desc: cat };
        return {
          label: cat.charAt(0).toUpperCase() + cat.slice(1),
          description: `${meta.desc} — ${cmds.length} commands`,
          value: cat,
          emoji: meta.emoji,
        };
      })
    );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('View all commands or details on a specific command')
    .addStringOption((o) => o.setName('command').setDescription('Command name for detailed info')),

  async execute(interaction) {
    const specific = interaction.options.getString('command');
    const prefix = store.getConfig(interaction.guild?.id, 'prefix') || config.discord.defaultPrefix;
    const commands = interaction.client.commands;

    if (specific) {
      const cmd = commands.get(specific.toLowerCase());
      if (!cmd) {
        return interaction.reply({ content: `Command \`${specific}\` not found.`, ephemeral: true });
      }

      const data = cmd.data.toJSON();
      const embed = base(interaction.client, colors.primary)
        .setAuthor({ name: data.name, iconURL: interaction.client.user.displayAvatarURL() })
        .setDescription(data.description);

      if (data.options?.length) {
        const opts = data.options
          .map((o) => `\`${o.name}\` ${o.required ? '— required' : '— optional'}\n▸ ${o.description}`)
          .join('\n\n');
        embed.addFields({ name: 'Options', value: opts });
      }

      embed.addFields({ name: 'Usage', value: usage(data.name, prefix) });

      return interaction.reply({ embeds: [embed] });
    }

    const categories = getCategories(commands);

    const embed = buildOverviewEmbed(interaction.client, categories, prefix);
    const menu = buildMenu(categories);

    const reply = await interaction.reply({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(menu)],
    });

    const collector = reply.createMessageComponentCollector({ time: 120_000 });

    collector.on('collect', async (i) => {
      if (i.customId === 'help_cmd') {
        const c = commands.get(i.values[0]);
        const d = c?.data?.toJSON?.();
        if (!d) return i.deferUpdate().catch(() => {});
        const detail = base(interaction.client, colors.primary)
          .setAuthor({ name: isSlash(d.name) ? `/${d.name}` : `${prefix}${d.name}`, iconURL: interaction.client.user.displayAvatarURL() })
          .setDescription(`${d.description}

${usage(d.name, prefix)}`);
        return i.reply({ embeds: [detail], ephemeral: true }).catch(() => {});
      }
      if (i.customId !== 'help_category') return;

      const cat = i.values[0];
      const cmds = categories[cat];

      if (!cmds) {
        return i.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(buildMenu(categories))] });
      }

      const catEmbed = buildCategoryEmbed(interaction.client, cat, cmds, commands, prefix);

      const updatedMenu = buildMenu(categories);
      updatedMenu.options.forEach((opt) => {
        if (opt.data.value === cat) opt.setDefault(true);
      });

      await i.update({
        embeds: [catEmbed],
        components: [
          new ActionRowBuilder().addComponents(updatedMenu),
          new ActionRowBuilder().addComponents(buildCommandMenu(cmds, commands)),
        ],
      });
    });

    collector.on('end', () => {
      reply.edit({ components: [] }).catch(() => {});
    });
  },
};
