const { ContainerBuilder, MessageFlags, StringSelectMenuBuilder } = require('discord.js');
const db = require('../utils/database');
const embeds = require('../utils/embed');
const helpers = require('../utils/helpers');
const scheduler = require('../utils/scheduler');
const interactions = require('../utils/interactions');

/* ------------------------------------------------------------------ *
 * General Tools (5)
 * help, prefix, afk, remind, calc
 * ------------------------------------------------------------------ */

/* --------------------------- reminders ---------------------------- */
scheduler.register('reminder', async (data, client) => {
  const channel = data.channelId ? await client.channels.fetch(data.channelId).catch(() => null) : null;
  if (channel?.isTextBased()) {
    await channel.send({ content: `<@${data.userId}>`, embeds: [embeds.info(`⏰ **Reminder:** ${data.text}`)] }).catch(() => {});
  }
  const user = await client.users.fetch(data.userId).catch(() => null);
  if (user) {
    await user.send({ embeds: [embeds.info(`⏰ **Reminder:** ${data.text}`)] }).catch(() => {});
  }
});

/* ------------------------------ help ------------------------------- */
function findCategory(client, query) {
  const lower = String(query || '').toLowerCase();
  return client.categories.find((cat) => cat.id === lower || cat.name.toLowerCase() === lower || cat.name.toLowerCase().replace(/\s+/g, '') === lower.replace(/\s+/g, ''));
}

function findCommand(client, query) {
  const lower = String(query || '').toLowerCase();
  return client.commands.get(lower) || client.aliases.get(lower) || null;
}

function commandListLine(command, prefix) {
  const aliases = command.aliases.length ? ` *(${command.aliases.join(', ')})*` : '';
  return `\`${prefix}${command.name}${command.usage ? ` ${command.usage}` : ''}\`${aliases} - ${command.description}`;
}

/* -------------------- help panel (component v2) -------------------- */

/** Display order of the categories in the select menu. */
const HELP_ORDER = [
  'information', 'general', 'fun', 'moderation', 'jail', 'admin', 'roles', 'voice',
  'ticket', 'selfrole', 'verification', 'apply', 'clans', 'premium', 'checker',
];

function orderedCategories(client) {
  return [...client.categories].sort((a, b) => {
    const ai = HELP_ORDER.indexOf(a.id);
    const bi = HELP_ORDER.indexOf(b.id);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

function categoryCommands(client, categoryId) {
  return [...client.commands.values()]
    .filter((cmd) => cmd.category === categoryId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Title, intro text and banner of the help panel (config.json -> "help"). */
function helpBranding(client) {
  const cfg = client.config.help || {};
  const name = client.user?.username || 'Helper';
  return {
    title: cfg.title || `◇ ${name}`,
    intro: cfg.intro || `I'm ${name} and I'll help you develop your server. I have many features you can use as you wish. I hope to be of service to you.`,
    banner: cfg.banner || client.user?.displayAvatarURL?.({ size: 512, dynamic: true }) || null,
  };
}

/**
 * Builds the help panel as a component-v2 message:
 * heading, intro, stats line, separator, banner, separator, subtext,
 * the expanded category (optional) and the category select menu.
 */
function buildHelpPanel(client, prefix, selectedId = null) {
  const branding = helpBranding(client);
  const container = new ContainerBuilder();

  container.addTextDisplayComponents((t) => t.setContent(`# ${branding.title}`));
  container.addTextDisplayComponents((t) => t.setContent(`**${branding.intro}**`));
  container.addTextDisplayComponents((t) =>
    t.setContent(`-# prefix \`${prefix}\`   ◇ ${client.categories.length} categories  ◇ ${client.commands.size} commands `)
  );
  container.addSeparatorComponents((s) => s.setDivider(true));

  if (branding.banner) {
    container.addMediaGalleryComponents((g) => g.addItems((i) => i.setURL(branding.banner)));
    container.addSeparatorComponents((s) => s.setDivider(true));
  }

  container.addTextDisplayComponents((t) => t.setContent('-# Pick a category below to see its commands.'));

  const category = selectedId ? client.categories.find((cat) => cat.id === selectedId) : null;
  if (category) {
    const lines = categoryCommands(client, category.id).map((cmd) => commandListLine(cmd, prefix));
    let content = `## ${category.emoji} ${category.name}\n${lines.join('\n') || 'No commands in this category.'}`;
    if (content.length > 3800) content = `${content.slice(0, 3800)}\n…`;
    container.addTextDisplayComponents((t) => t.setContent(content));
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId('help:category')
    .setPlaceholder(category ? 'Pick another category' : 'Pick a category to see its commands')
    .addOptions(
      orderedCategories(client).map((cat) => ({
        label: helpers.truncate(cat.name, 100),
        value: cat.id,
        description: helpers.truncate(cat.description, 100),
      }))
    );
  container.addActionRowComponents((row) => row.addComponents(select));

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/* ------------------------------ calc ------------------------------- */
/** Tiny safe math evaluator - only numbers and + - * / % ( ) ^ are allowed. */
function calculateSafe(expression) {
  const normalized = String(expression).replace(/\s+/g, '').replaceAll('^', '**');
  if (!/^[\d+\-*/().%]+$/.test(normalized.replaceAll('**', ''))) return null;
  // eslint-disable-next-line no-new-func
  const value = Function(`"use strict"; return (${normalized});`)();
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

module.exports = [
  {
    name: 'help',
    aliases: ['h', 'commands'],
    description: 'Show all commands, or the details of one category/command.',
    usage: '[category|command]',
    cooldown: 5,
    async execute(message, args, client) {
      const prefix = helpers.getPrefix(client, message);
      const query = args.join(' ').toLowerCase();

      // No argument -> the help panel with the category select menu
      if (!query) {
        return message.reply(buildHelpPanel(client, prefix));
      }

      // Category -> the help panel with that category expanded
      const category = findCategory(client, query);
      if (category) {
        return message.reply(buildHelpPanel(client, prefix, category.id));
      }

      // Command -> details
      const command = findCommand(client, query);
      if (command) {
        const meta = client.categories.find((cat) => cat.id === command.category);
        return message.reply({
          embeds: [
            embeds
              .base(embeds.colors.primary)
              .setTitle(`${prefix}${command.name}`)
              .addFields(
                { name: 'Description', value: command.description || 'No description.', inline: false },
                { name: 'Usage', value: `\`${prefix}${command.name}${command.usage ? ` ${command.usage}` : ''}\``, inline: false },
                { name: 'Aliases', value: command.aliases.length ? command.aliases.map((a) => `\`${prefix}${a}\``).join(', ') : 'None', inline: true },
                { name: 'Category', value: meta ? `${meta.emoji} ${meta.name}` : command.category, inline: true },
                { name: 'Permissions', value: command.permissions?.length ? command.permissions.map((p) => `\`${p}\``).join(', ') : 'Everyone', inline: true },
                { name: 'Cooldown', value: `${command.cooldown || client.config.cooldownSeconds || 3}s`, inline: true },
                { name: 'Premium', value: command.premium ? 'Yes' : 'No', inline: true }
              ),
          ],
        });
      }

      return message.reply({ embeds: [embeds.error(`Nothing found for **${query}**. Use \`${prefix}help\` to see all categories.`)] });
    },
  },

  {
    name: 'prefix',
    aliases: [],
    description: 'View or change the prefix of this server.',
    usage: '[new prefix]',
    permissions: ['ManageGuild'],
    cooldown: 5,
    async execute(message, args, client) {
      const guildData = db.getGuild(message.guild.id);

      if (!args[0]) {
        return message.reply({
          embeds: [embeds.info(`The prefix of this server is \`${guildData.prefix || client.config.prefix}\`.\nYou can also mention me instead of using the prefix.`)],
        });
      }

      const newPrefix = args[0].slice(0, 5);
      db.set(`guilds.${message.guild.id}.prefix`, newPrefix === client.config.prefix ? null : newPrefix);

      return message.reply({
        embeds: [embeds.success(newPrefix === client.config.prefix ? `Prefix reset to the default \`${client.config.prefix}\`.` : `Prefix changed to \`${newPrefix}\`.`)],
      });
    },
  },

  {
    name: 'afk',
    aliases: [],
    description: 'Mark yourself as AFK. Removed automatically when you talk again.',
    usage: '[reason]',
    cooldown: 3,
    async execute(message, args, client) {
      const reason = args.join(' ') || 'AFK';
      db.set(`afk.${message.guild.id}.${message.author.id}`, { reason: helpers.truncate(reason, 100), since: Date.now() });
      return message.reply({ embeds: [embeds.success(`You are now AFK: **${reason}**`)] });
    },
  },

  {
    name: 'remind',
    aliases: ['reminder'],
    description: 'Set a reminder.',
    usage: '<duration> <text>',
    cooldown: 5,
    async execute(message, args, client) {
      const duration = helpers.parseDuration(args[0]);
      if (!duration) return message.reply({ embeds: [helpers.usageError(client, message, 'remind <duration> <text>', 'Example: `remind 2h water the plants`')] });
      if (duration < 60_000) return message.reply({ embeds: [embeds.error('The minimum reminder length is **1 minute**.')] });
      if (duration > 365 * 86400000) return message.reply({ embeds: [embeds.error('The maximum reminder length is **1 year**.')] });

      const text = helpers.truncate(args.slice(1).join(' ') || 'You asked me to remind you!', 200);
      scheduler.add('reminder', { userId: message.author.id, channelId: message.channel.id, text }, Date.now() + duration);

      return message.reply({
        embeds: [embeds.success(`⏰ I will remind you in **${helpers.formatDuration(duration)}** (${helpers.formatStamp(Date.now() + duration, 'T')}): ${text}`)],
      });
    },
  },

  {
    name: 'calc',
    aliases: ['math', 'calculate'],
    description: 'Do a quick math calculation.',
    usage: '<expression>',
    cooldown: 3,
    async execute(message, args, client) {
      if (!args.length) return message.reply({ embeds: [helpers.usageError(client, message, 'calc <expression>', 'Example: `calc (12 + 8) * 3`')] });

      const result = calculateSafe(args.join(' '));
      if (result === null) return message.reply({ embeds: [embeds.error('That expression is invalid. Only numbers and `+ - * / % ( ) ^` are allowed.')] });

      return message.reply({ embeds: [embeds.info(`**${args.join(' ')}** = **${result}**`)] });
    },
  },
];

/* -------------------------- help interaction ------------------------ */

interactions.register('help', async (interaction, client) => {
  if (!interaction.isStringSelectMenu()) return;

  const selectedId = interaction.values?.[0];
  const category = client.categories.find((cat) => cat.id === selectedId);
  if (!category) {
    return interaction
      .update({ embeds: [embeds.error('That category no longer exists.')], components: [], flags: MessageFlags.IsComponentsV2 })
      .catch(() => {});
  }

  const prefix = helpers.getPrefix(client, { guild: interaction.guild });
  await interaction.update(buildHelpPanel(client, prefix, selectedId));
});

// Export the helper for the validate script (does not affect the command loader).
module.exports.calculateSafe = calculateSafe;
module.exports.buildHelpPanel = buildHelpPanel;
