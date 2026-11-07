const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { useQueue } = require('discord-player');
const { colors } = require('../../utils/constants');
const { base, response } = require('../../utils/embed');

const PAGE_SIZE = 10;

const fmtMs = (ms) => {
  const s = Math.floor((ms || 0) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};

// Stateless: the button carries the target page, and every click re-reads the live queue, so a page never goes stale
// and nothing is held in memory per message.
function buildPage(client, guild, queue, wanted) {
  const tracks = queue.tracks.toArray();
  const pages = Math.max(1, Math.ceil(tracks.length / PAGE_SIZE));
  const page = Math.min(Math.max(0, wanted), pages - 1);
  const start = page * PAGE_SIZE;
  const current = queue.currentTrack;

  let desc = `**Now playing**\n[${current.title}](${current.url}) - ${current.duration}\n\n`;
  desc += tracks.length
    ? '**Up next**\n' + tracks.slice(start, start + PAGE_SIZE).map((t, i) => `\`${start + i + 1}.\` [${t.title}](${t.url}) - ${t.duration}`).join('\n')
    : '*No more tracks in the queue.*';

  const total = tracks.reduce((n, t) => n + (t.durationMS || 0), 0);
  const embed = base(client, colors.primary)
    .setAuthor({ name: `Queue - ${guild.name}` })
    .setDescription(desc.slice(0, 4000))
    .setFooter({ text: `Page ${page + 1}/${pages} - ${tracks.length} tracks${tracks.length ? ` - ${fmtMs(total)} to go` : ''} - sonder` });

  const b = (id, label, to, disabled) => new ButtonBuilder().setCustomId(`mq:${to}:${id}`).setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(disabled);
  const first = page === 0, last = page >= pages - 1;
  const row = new ActionRowBuilder().addComponents(
    b('first', '<<', 0, first), b('prev', '<', page - 1, first), b('next', '>', page + 1, last), b('last', '>>', pages - 1, last),
  );
  return { embeds: [embed], components: pages > 1 ? [row] : [] };
}

async function handleButton(interaction) {
  const queue = useQueue(interaction.guild.id);
  if (!queue?.currentTrack) {
    return interaction.update({ embeds: [response({ client: interaction.client, description: 'Queue is empty.', color: colors.muted })], components: [] });
  }
  const to = parseInt(interaction.customId.split(':')[1], 10);
  await interaction.update(buildPage(interaction.client, interaction.guild, queue, Number.isFinite(to) ? to : 0));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('View the current queue')
    .addIntegerOption((o) => o.setName('page').setDescription('Page number').setMinValue(1)),

  async execute(interaction) {
    const queue = useQueue(interaction.guild.id);
    if (!queue || !queue.currentTrack) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Queue is empty.', color: colors.muted })], ephemeral: true });
    }
    await interaction.reply(buildPage(interaction.client, interaction.guild, queue, (interaction.options.getInteger('page') || 1) - 1));
  },

  handleButton,
  buildPage,
};
