const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const { chat } = require('../../utils/ai');

const PERSONAS = {
  pirate: {
    name: 'Captain mofu',
    emoji: '\u{1F3F4}‍☠️',
    prompt: 'You are a swashbuckling pirate captain. Speak in pirate dialect with plenty of \'arr\', \'ye\', and nautical metaphors. Be dramatic and adventurous. Keep responses under 150 words.',
  },
  shakespeare: {
    name: 'Bardic mofu',
    emoji: '\u{1F3AD}',
    prompt: 'You are Shakespeare himself. Speak in Early Modern English with poetic flourish, iambic cadence, and dramatic flair. Reference your plays when relevant. Keep responses under 150 words.',
  },
  chef: {
    name: 'Chef mofu',
    emoji: '\u{1F468}‍\u{1F373}',
    prompt: 'You are a passionate French chef. Everything relates back to food and cooking. Use French expressions liberally. Be dramatic about culinary matters. Keep responses under 150 words.',
  },
  noir: {
    name: 'Detective mofu',
    emoji: '\u{1F575}️',
    prompt: 'You are a hard-boiled noir detective from the 1940s. Narrate everything like a mystery novel. Be cynical, witty, and world-weary. Use noir metaphors and slang. Keep responses under 150 words.',
  },
  zen: {
    name: 'Sage mofu',
    emoji: '\u{1F9D8}',
    prompt: 'You are a calm, wise zen master. Respond with gentle wisdom, short parables, and thoughtful observations. Be serene and philosophical. Keep responses under 150 words.',
  },
  gamer: {
    name: 'Pro mofu',
    emoji: '\u{1F3AE}',
    prompt: 'You are an overly enthusiastic competitive gamer. Use gaming terminology for everything. Reference game mechanics, speedruns, and esports. Extremely hyped energy. Keep responses under 150 words.',
  },
};

const PERSONA_DESCRIPTIONS = {
  pirate: 'A swashbuckling pirate captain',
  shakespeare: 'The Bard himself, speaking in verse',
  chef: 'A passionate French culinary master',
  noir: 'A hard-boiled 1940s detective',
  zen: 'A calm and wise zen master',
  gamer: 'An overly enthusiastic competitive gamer',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('persona')
    .setDescription('Chat with a specific AI personality')
    .addSubcommand((sub) =>
      sub.setName('chat').setDescription('Talk to a persona')
        .addStringOption((o) =>
          o.setName('personality').setDescription('Choose a personality').setRequired(true)
            .addChoices(
              { name: 'Pirate', value: 'pirate' },
              { name: 'Shakespeare', value: 'shakespeare' },
              { name: 'Chef', value: 'chef' },
              { name: 'Noir Detective', value: 'noir' },
              { name: 'Zen Master', value: 'zen' },
              { name: 'Gamer', value: 'gamer' },
            )
        )
        .addStringOption((o) =>
          o.setName('message').setDescription('Your message to the persona').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('View available personas')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'chat') {
      await interaction.deferReply();

      const personality = interaction.options.getString('personality');
      const message = interaction.options.getString('message');
      const persona = PERSONAS[personality];

      const messages = [
        { role: 'system', content: persona.prompt + ' You are in a Discord server. Keep it PG-13. Never break character.' },
        { role: 'user', content: message },
      ];

      const reply = await chat(messages, { maxTokens: 200, temperature: 0.85, guildId: interaction.guildId });

      if (!reply) {
        return interaction.editReply({
          embeds: [response({ client: interaction.client, description: 'The persona failed to respond. Try again later.', color: colors.error })],
          ephemeral: true,
        });
      }

      await interaction.editReply({
        embeds: [response({ client: interaction.client, description: `${persona.emoji} **${persona.name}**\n\n${reply}`, color: colors.primary })],
      });

    } else if (sub === 'list') {
      const lines = Object.entries(PERSONAS).map(
        ([key, p]) => `${p.emoji} **${p.name}** (\`${key}\`)\n${PERSONA_DESCRIPTIONS[key]}`
      );

      await interaction.reply({
        embeds: [response({ client: interaction.client, description: lines.join('\n\n'), color: colors.primary })],
      });
    }
  },
};
