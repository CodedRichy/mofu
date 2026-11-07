const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, footer } = require('../../utils/embed');

const NUM_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create a poll')
    // Max lengths keep question + 6 options inside the 4096-char embed description (slash strings allow 6000 each).
    .addStringOption((o) => o.setName('question').setDescription('Poll question').setRequired(true).setMaxLength(300))
    .addStringOption((o) => o.setName('option1').setDescription('Option 1').setRequired(true).setMaxLength(200))
    .addStringOption((o) => o.setName('option2').setDescription('Option 2').setRequired(true).setMaxLength(200))
    .addStringOption((o) => o.setName('option3').setDescription('Option 3').setMaxLength(200))
    .addStringOption((o) => o.setName('option4').setDescription('Option 4').setMaxLength(200))
    .addStringOption((o) => o.setName('option5').setDescription('Option 5').setMaxLength(200))
    .addStringOption((o) => o.setName('option6').setDescription('Option 6').setMaxLength(200)),

  async execute(interaction) {
    const question = interaction.options.getString('question');
    const options = [];

    for (let i = 1; i <= 6; i++) {
      const opt = interaction.options.getString(`option${i}`);
      if (opt) options.push(opt);
    }

    const desc = options.map((o, i) => `${NUM_EMOJIS[i]} ${o}`).join('\n\n');

    const embed = base(interaction.client, colors.primary)
      .setAuthor({ name: '📊 Poll', iconURL: interaction.user.displayAvatarURL() })
      .setDescription(`**${question}**\n\n${desc}`)
      .setFooter(footer(interaction.client, `Asked by ${interaction.user.tag}`));

    await interaction.reply({ embeds: [embed] });
    const msg = await interaction.fetchReply();

    for (let i = 0; i < options.length; i++) {
      await msg.react(NUM_EMOJIS[i]).catch(() => {});
    }
  },
};
