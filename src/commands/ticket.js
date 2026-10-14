const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const db = require('../utils/database');
const embeds = require('../utils/embed');
const helpers = require('../utils/helpers');
const perms = require('../utils/permissions');
const interactions = require('../utils/interactions');

/* ------------------------------------------------------------------ *
 * Ticket Commands (5)
 * ticket-setup, ticket-log, ticket-limit, ticket-close, ticket-disable
 * ------------------------------------------------------------------ */

function config(guildId) {
  return db.getGuild(guildId).tickets;
}

function openCount(cfg) {
  return Object.keys(cfg.open || {}).length;
}

/** Sends a ticket embed to the configured log channel (if any). */
async function sendLog(guild, cfg, embed) {
  if (!cfg.logChannelId) return;
  const channel = guild.channels.cache.get(cfg.logChannelId) || (await guild.channels.fetch(cfg.logChannelId).catch(() => null));
  if (!channel || !channel.isTextBased()) return;
  await channel.send({ embeds: [embed] }).catch(() => {});
}

/** Reuses the stored ticket category or creates a new "Tickets" category. */
async function ensureCategory(guild, cfg) {
  if (cfg.categoryId) {
    const existing = guild.channels.cache.get(cfg.categoryId) || (await guild.channels.fetch(cfg.categoryId).catch(() => null));
    if (existing && existing.type === ChannelType.GuildCategory) return existing;
  }
  return guild.channels.create({ name: 'Tickets', type: ChannelType.GuildCategory }).catch(() => null);
}

/* ---------------------------- commands ----------------------------- */

module.exports = [
  {
    name: 'ticket-setup',
    aliases: [],
    description: 'Set up the ticket system and post the panel.',
    usage: '[@staff-role] [#log-channel]',
    permissions: ['ManageGuild'],
    botPermissions: ['ManageChannels', 'SendMessages', 'EmbedLinks'],
    cooldown: 5,
    async execute(message, args, client) {
      const cfg = config(message.guild.id);

      const category = await ensureCategory(message.guild, cfg);
      if (!category) return message.reply({ embeds: [embeds.error('I could not create or find the Tickets category - check my **Manage Channels** permission.')] });
      cfg.categoryId = category.id;

      if (args[0]) {
        const role = await helpers.resolveRole(message, args[0]);
        if (!role) return message.reply({ embeds: [embeds.error('I could not find that staff role.')] });
        const check = perms.canManageRole(message.member, role);
        if (!check.ok) return message.reply({ embeds: [embeds.error(check.error)] });
        cfg.staffRoleId = role.id;
      }

      if (args[1]) {
        const channel = await helpers.resolveChannel(message, args[1]);
        if (!channel || !channel.isTextBased()) return message.reply({ embeds: [embeds.error('The log channel must be an existing text channel.')] });
        cfg.logChannelId = channel.id;
      } else if (!cfg.logChannelId) {
        cfg.logChannelId = message.channel.id;
      }

      const limit = Number.isFinite(cfg.limit) ? cfg.limit : 3;
      const panel = await message.channel.send({
        embeds: [
          embeds
            .base(embeds.colors.primary)
            .setTitle('Tickets')
            .setDescription('Click the button below to create a private support ticket.')
            .setFooter({ text: `Limit: ${limit} open ticket(s) per user` }),
        ],
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket:new').setLabel('Create ticket').setStyle(ButtonStyle.Primary).setEmoji('🎫'))],
      });

      cfg.panelChannelId = message.channel.id;
      cfg.panelMessageId = panel.id;
      db.save();

      return message.reply({ embeds: [embeds.success(`Ticket system set up in category **${category.name}**.\n**Staff role:** ${cfg.staffRoleId ? `<@&${cfg.staffRoleId}>` : 'Not set'}\n**Log channel:** <#${cfg.logChannelId}>\nPanel posted in ${message.channel}.`)] });
    },
  },

  {
    name: 'ticket-log',
    aliases: [],
    description: 'Set the channel where ticket logs are sent.',
    usage: '<#channel>',
    permissions: ['ManageGuild'],
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'ticket-log <#channel>')] });

      const channel = await helpers.resolveChannel(message, args[0]);
      if (!channel || !channel.isTextBased()) return message.reply({ embeds: [embeds.error('That is not an existing text channel.')] });

      const cfg = config(message.guild.id);
      cfg.logChannelId = channel.id;
      db.save();

      return message.reply({ embeds: [embeds.success(`The ticket log channel is now ${channel}.`)] });
    },
  },

  {
    name: 'ticket-limit',
    aliases: [],
    description: 'Set how many open tickets a user may have (0 = unlimited).',
    usage: '<0-20>',
    permissions: ['ManageGuild'],
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'ticket-limit <0-20>', 'Use `0` for no limit.')] });

      const limit = Number(args[0]);
      if (!Number.isInteger(limit) || limit < 0 || limit > 20) {
        return message.reply({ embeds: [helpers.usageError(client, message, 'ticket-limit <0-20>', 'The limit must be a whole number between 0 and 20.')] });
      }

      const cfg = config(message.guild.id);
      cfg.limit = limit;
      db.save();

      return message.reply({ embeds: [embeds.success(limit === 0 ? 'Ticket limit removed - users can now open unlimited tickets.' : `Each user may now have up to **${limit}** open ticket(s).`)] });
    },
  },

  {
    name: 'ticket-close',
    aliases: [],
    description: 'Close the current ticket channel.',
    usage: '',
    cooldown: 5,
    async execute(message, args, client) {
      const cfg = config(message.guild.id);
      const entry = (cfg.open || {})[message.channel.id];
      if (!entry) return message.reply({ embeds: [embeds.error('This is not an open ticket.')] });

      const isOpener = entry.openerId === message.author.id;
      if (!isOpener && !perms.has(message.member, ['ManageGuild'])) {
        return message.reply({ embeds: [embeds.error('Only the ticket opener or a member with **Manage Server** can close this ticket.')] });
      }

      await message.reply({ embeds: [embeds.warn('This ticket is being closed. The channel will be deleted in a few seconds.')] });

      await sendLog(
        message.guild,
        cfg,
        embeds
          .base(embeds.colors.moderation)
          .setTitle('Ticket closed')
          .addFields(
            { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
            { name: 'Opener', value: `<@${entry.openerId}>`, inline: true },
            { name: 'Closed by', value: `<@${message.author.id}>`, inline: true },
            { name: 'Created', value: helpers.formatStamp(entry.createdAt || Date.now(), 'R'), inline: true }
          )
      );

      setTimeout(() => {
        delete cfg.open[message.channel.id];
        db.save();
        message.channel.delete('Ticket closed').catch(() => {});
      }, 5000).unref?.();
    },
  },

  {
    name: 'ticket-disable',
    aliases: [],
    description: 'Remove the ticket panel and reset the configuration.',
    usage: '',
    permissions: ['ManageGuild'],
    cooldown: 5,
    async execute(message, args, client) {
      const cfg = config(message.guild.id);

      if (cfg.panelChannelId && cfg.panelMessageId) {
        const channel = message.guild.channels.cache.get(cfg.panelChannelId) || (await message.guild.channels.fetch(cfg.panelChannelId).catch(() => null));
        if (channel && channel.messages) {
          const panel = await channel.messages.fetch(cfg.panelMessageId).catch(() => null);
          if (panel) await panel.delete().catch(() => {});
        }
      }

      const keptLog = cfg.logChannelId;
      const keptOpen = cfg.open;
      db.set(`guilds.${message.guild.id}.tickets`, keptLog ? { logChannelId: keptLog, open: keptOpen || {} } : { open: keptOpen || {} });
      db.save();

      return message.reply({ embeds: [embeds.success('The ticket panel was removed and the ticket configuration was reset.')] });
    },
  },
];

/* -------------------------- interactions --------------------------- */

interactions.register('ticket', async (interaction, client) => {
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
  if (!interaction.inGuild()) return;
  if (interaction.customId !== 'ticket:new') return;

  try {
    await interaction.deferReply({ ephemeral: true });

    const cfg = config(interaction.guildId);
    const limit = Number.isFinite(cfg.limit) ? cfg.limit : 3;
    cfg.open = cfg.open || {};

    // Count the user's open tickets, cleaning up channels that no longer exist.
    let ownOpen = 0;
    for (const [channelId, entry] of Object.entries(cfg.open)) {
      const channel = interaction.guild.channels.cache.get(channelId) || (await interaction.guild.channels.fetch(channelId).catch(() => null));
      if (!channel) {
        delete cfg.open[channelId];
        continue;
      }
      if (entry.openerId === interaction.user.id) ownOpen++;
    }
    db.save();

    if (limit > 0 && ownOpen >= limit) {
      return interaction.editReply({ embeds: [embeds.error(`You already have **${ownOpen}** open ticket(s). The limit is **${limit}** - close a ticket before opening a new one.`)] });
    }

    const username = interaction.user.username.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'user';

    const overwrites = [
      { id: interaction.guild.roles.everyone.id, deny: ['ViewChannel'] },
      { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
    ];
    if (cfg.staffRoleId && interaction.guild.roles.cache.has(cfg.staffRoleId)) {
      overwrites.push({ id: cfg.staffRoleId, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] });
    }

    const channel = await interaction.guild.channels
      .create({
        name: `ticket-${username}`,
        type: ChannelType.GuildText,
        parent: cfg.categoryId || undefined,
        permissionOverwrites: overwrites,
      })
      .catch(() => null);
    if (!channel) return interaction.editReply({ embeds: [embeds.error('I could not create the ticket channel - check my **Manage Channels** permission.')] });

    cfg.open[channel.id] = { openerId: interaction.user.id, createdAt: Date.now() };
    db.save();

    const mentions = [`<@${interaction.user.id}>`];
    if (cfg.staffRoleId) mentions.push(`<@&${cfg.staffRoleId}>`);

    await channel
      .send({
        embeds: [embeds.base(embeds.colors.primary).setTitle('Ticket created').setDescription('Support will be with you shortly. Close with the close command.')],
        content: mentions.join(' '),
      })
      .catch(() => {});

    await interaction.editReply({ embeds: [embeds.success(`Your ticket was created: ${channel}`)] }).catch(() => {});
  } catch (err) {
    return interaction.editReply({ embeds: [embeds.error('Something went wrong while creating your ticket.')] }).catch(() => {});
  }
});
