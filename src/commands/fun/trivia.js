const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response, footer } = require('../../utils/embed');
const { rateLimit } = require('../../utils/ratelimit');

const ANSWER_MS = 15000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('trivia')
    .setDescription('Answer a trivia question'),

  async execute(interaction) {
    if (!rateLimit(`trivia:${interaction.guild.id}`, 5, 30000)) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Rate limit reached for this server. Try again in a little while.', color: colors.error })], ephemeral: true });
    }

    await interaction.deferReply();

    try {
      const res = await fetch('https://opentdb.com/api.php?amount=1&type=multiple');
      if (!res.ok) throw new Error();
      const data = await res.json();
      const q = data.results[0];

      const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

      const correct = decode(q.correct_answer);
      const answers = [...q.incorrect_answers.map(decode), correct].sort(() => Math.random() - 0.5);
      const correctIdx = answers.indexOf(correct);
      const labels = ['A', 'B', 'C', 'D'];

      const embed = base(interaction.client, colors.primary)
        .setAuthor({ name: `Trivia — ${decode(q.category)}` })
        .setDescription(`${decode(q.question)}\n\n${answers.map((a, i) => `**${labels[i]}.** ${a}`).join('\n')}`)
        .setFooter(footer(interaction.client, `Difficulty: ${q.difficulty} · ${ANSWER_MS / 1000} seconds`));

      const row = new ActionRowBuilder().addComponents(
        labels.map((l, i) =>
          new ButtonBuilder().setCustomId(`trivia_${i}`).setLabel(l).setStyle(ButtonStyle.Secondary)
        )
      );

      const msg = await interaction.editReply({ embeds: [embed], components: [row] });

      const collector = msg.createMessageComponentCollector({
        filter: (i) => i.user.id === interaction.user.id,
        max: 1,
        time: ANSWER_MS,
      });

      collector.on('collect', async (btn) => {

        const picked = parseInt(btn.customId.split('_')[1]);
        if (picked === correctIdx) {
          await btn.reply({ embeds: [response({ client: interaction.client, description: `${btn.user} got it right! The answer was **${correct}**`, color: colors.success })] });
        } else {
          await btn.reply({ embeds: [response({ client: interaction.client, description: `${btn.user} wrong! The answer was **${correct}**`, color: colors.error })] });
        }
      });

      collector.on('end', () => {
        const disabledRow = new ActionRowBuilder().addComponents(
          labels.map((l, i) =>
            new ButtonBuilder()
              .setCustomId(`trivia_${i}`)
              .setLabel(l)
              .setStyle(i === correctIdx ? ButtonStyle.Success : ButtonStyle.Secondary)
              .setDisabled(true)
          )
        );
        interaction.editReply({ components: [disabledRow] }).catch(() => {});
      });
    } catch {
      await interaction.editReply({ embeds: [response({ client: interaction.client, description: 'Failed to fetch trivia question.', color: colors.error })] });
    }
  },
};
