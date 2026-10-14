const interactions = require('../utils/interactions');
const embeds = require('../utils/embed');
const slashHandler = require('../handlers/slashHandler');

module.exports = {
  name: 'interactionCreate',
  async execute(client, interaction) {
    // Slash commands (both front-ends share the same command objects).
    if (interaction.isChatInputCommand()) {
      return slashHandler.handle(interaction, client);
    }

    // Buttons, select menus and modals are routed by customId prefix.
    if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;

    const key = String(interaction.customId || '').split(':')[0];
    const handler = interactions.get(key);
    if (!handler) return;

    try {
      await handler(interaction, client);
    } catch (err) {
      console.error(`[interaction:${key}]`, err);
      const payload = { embeds: [embeds.error('Something went wrong while handling that interaction.')], ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  },
};
