const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../utils/database');
const embeds = require('../utils/embed');
const helpers = require('../utils/helpers');
const perms = require('../utils/permissions');
const interactions = require('../utils/interactions');

/* ------------------------------------------------------------------ *
 * Verification Commands (8)
 * verify-setup, verify, verify-role, verify-channel, verify-log,
 * verify-info, verify-disable, verifypass
 * ------------------------------------------------------------------ */

function config(guildId) {
  return db.getGuild(guildId).verification;
}

/** Sends a verification embed to the configured log channel (if any). */
async function sendLog(guild, cfg, text) {
  if (!cfg.logChannelId) return;
  const channel = guild.channels.cache.get(cfg.logChannelId) || (await guild.channels.fetch(cfg.logChannelId).catch(() => null));
  if (!channel || !channel.isTextBased()) return;
  await channel.send({ embeds: [embeds.moderation(text, 'Verification log')] }).catch(() => {});
}

/** Gives the verification role to a member. Throws when the role add fails. */
async function addVerifyRole(member, cfg) {
  await member.roles.add(cfg.roleId, 'Verification');
}

/* ---------------------------- commands ----------------------------- */

module.exports = [
  {
    name: 'verify-setup',
    aliases: [],
    description: 'Post the verification panel with a verify button.',
    usage: '',
    permissions: ['ManageGuild'],
    botPermissions: ['SendMessages', 'EmbedLinks'],
    cooldown: 5,
    async execute(message, args, client) {
      const cfg = config(message.guild.id);
      if (!cfg.roleId) return message.reply({ embeds: [embeds.error(`The verification role is not set yet. Run \`${helpers.getPrefix(client, message)}verify-role <@role>\` first.`)] });

      const panel = await message.channel.send({
        embeds: [embeds.base(embeds.colors.info).setTitle('Verification').setDescription('Click the button below to verify and get access to the server.')],
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verify:btn').setLabel('Verify').setStyle(ButtonStyle.Success).setEmoji('✅'))],
      });

      cfg.channelId = message.channel.id;
      cfg.messageId = panel.id;
      db.save();

      return message.reply({ embeds: [embeds.success(`Verification panel posted in ${message.channel}.`)] });
    },
  },

  {
    name: 'verify',
    aliases: [],
    description: 'Get the verification role.',
    usage: '',
    botPermissions: ['ManageRoles'],
    cooldown: 5,
    async execute(message, args, client) {
      const cfg = config(message.guild.id);
      if (!cfg.roleId) return message.reply({ embeds: [embeds.error('Verification is not configured in this server.')] });

      if (message.member.roles.cache.has(cfg.roleId)) {
        return message.reply({ embeds: [embeds.info('You are already verified.')] });
      }

      try {
        await addVerifyRole(message.member, cfg);
      } catch (err) {
        return message.reply({ embeds: [embeds.error('I could not give you the verification role - check my role position.')] });
      }

      await sendLog(message.guild, cfg, `**${message.author.tag}** was verified by themselves.`);
      return message.reply({ embeds: [embeds.success('You have been verified! You now have access to the server.')] });
    },
  },

  {
    name: 'verify-role',
    aliases: [],
    description: 'Set the role given by the verification system.',
    usage: '<@role>',
    permissions: ['ManageGuild'],
    botPermissions: ['ManageRoles'],
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'verify-role <@role>')] });

      const role = await helpers.resolveRole(message, args[0]);
      if (!role) return message.reply({ embeds: [embeds.error('I could not find that role.')] });

      const check = perms.canManageRole(message.member, role);
      if (!check.ok) return message.reply({ embeds: [embeds.error(check.error)] });

      const cfg = config(message.guild.id);
      cfg.roleId = role.id;
      db.save();

      return message.reply({ embeds: [embeds.success(`The verification role is now **${role.name}**.`)] });
    },
  },

  {
    name: 'verify-channel',
    aliases: [],
    description: 'Set the channel where the verification panel was posted.',
    usage: '<#channel>',
    permissions: ['ManageGuild'],
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'verify-channel <#channel>')] });

      const channel = await helpers.resolveChannel(message, args[0]);
      if (!channel) return message.reply({ embeds: [embeds.error('I could not find that channel.')] });
      if (!channel.isTextBased()) return message.reply({ embeds: [embeds.error('That is not a text channel.')] });

      const cfg = config(message.guild.id);
      cfg.channelId = channel.id;
      db.save();

      return message.reply({ embeds: [embeds.success(`The verification panel channel is now ${channel}.`)] });
    },
  },

  {
    name: 'verify-log',
    aliases: [],
    description: 'Set the channel where verification logs are sent.',
    usage: '<#channel>',
    permissions: ['ManageGuild'],
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'verify-log <#channel>')] });

      const channel = await helpers.resolveChannel(message, args[0]);
      if (!channel) return message.reply({ embeds: [embeds.error('I could not find that channel.')] });
      if (!channel.isTextBased()) return message.reply({ embeds: [embeds.error('That is not a text channel.')] });

      const cfg = config(message.guild.id);
      cfg.logChannelId = channel.id;
      db.save();

      return message.reply({ embeds: [embeds.success(`The verification log channel is now ${channel}.`)] });
    },
  },

  {
    name: 'verify-info',
    aliases: [],
    description: 'Show the current verification configuration.',
    usage: '',
    cooldown: 5,
    async execute(message, args, client) {
      const cfg = config(message.guild.id);
      const role = cfg.roleId ? message.guild.roles.cache.get(cfg.roleId) : null;
      const channel = cfg.channelId ? message.guild.channels.cache.get(cfg.channelId) : null;
      const logChannel = cfg.logChannelId ? message.guild.channels.cache.get(cfg.logChannelId) : null;

      let panelState = 'Not set';
      if (cfg.channelId && cfg.messageId) {
        const source = channel || (await message.guild.channels.fetch(cfg.channelId).catch(() => null));
        if (source && source.messages) {
          const panel = await source.messages.fetch(cfg.messageId).catch(() => null);
          panelState = panel ? `Present in ${source}` : 'Message was deleted';
        } else {
          panelState = 'Panel channel no longer exists';
        }
      }

      return message.reply({
        embeds: [
          embeds
            .base(embeds.colors.info)
            .setTitle('Verification setup')
            .addFields(
              { name: 'Role', value: cfg.roleId ? (role ? `<@&${cfg.roleId}>` : `<@&${cfg.roleId}> (deleted)`) : 'Not set', inline: true },
              { name: 'Panel channel', value: channel ? `${channel}` : cfg.channelId ? `<#${cfg.channelId}> (deleted)` : 'Not set', inline: true },
              { name: 'Log channel', value: logChannel ? `${logChannel}` : cfg.logChannelId ? `<#${cfg.logChannelId}> (deleted)` : 'Not set', inline: true },
              { name: 'Panel message', value: panelState, inline: false }
            ),
        ],
      });
    },
  },

  {
    name: 'verify-disable',
    aliases: [],
    description: 'Remove the verification panel and clear the configuration.',
    usage: '',
    permissions: ['ManageGuild'],
    cooldown: 5,
    async execute(message, args, client) {
      const cfg = config(message.guild.id);

      if (cfg.channelId && cfg.messageId) {
        const channel = message.guild.channels.cache.get(cfg.channelId) || (await message.guild.channels.fetch(cfg.channelId).catch(() => null));
        if (channel && channel.messages) {
          const panel = await channel.messages.fetch(cfg.messageId).catch(() => null);
          if (panel) await panel.delete().catch(() => {});
        }
      }

      delete cfg.roleId;
      delete cfg.channelId;
      delete cfg.logChannelId;
      delete cfg.messageId;
      db.save();

      return message.reply({ embeds: [embeds.success('The verification system has been disabled and its configuration cleared.')] });
    },
  },

  {
    name: 'verifypass',
    aliases: [],
    description: 'Manually verify a member.',
    usage: '<@user>',
    permissions: ['ManageRoles'],
    botPermissions: ['ManageRoles'],
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'verifypass <@user>')] });

      const cfg = config(message.guild.id);
      if (!cfg.roleId) return message.reply({ embeds: [embeds.error('Verification is not configured in this server.')] });

      const member = await helpers.resolveMember(message, args[0]);
      if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });

      if (member.roles.cache.has(cfg.roleId)) {
        return message.reply({ embeds: [embeds.info(`**${member.user.tag}** is already verified.`)] });
      }

      try {
        await addVerifyRole(member, cfg);
      } catch (err) {
        return message.reply({ embeds: [embeds.error('I could not give that member the verification role - check my role position.')] });
      }

      await sendLog(message.guild, cfg, `**${member.user.tag}** was verified by **${message.author.tag}**.`);
      return message.reply({ embeds: [embeds.success(`**${member.user.tag}** has been verified.`)] });
    },
  },
];

/* -------------------------- interactions --------------------------- */

interactions.register('verify', async (interaction, client) => {
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
  if (!interaction.inGuild()) return;
  if (interaction.customId !== 'verify:btn') return;

  try {
    await interaction.deferReply({ ephemeral: true });

    const cfg = config(interaction.guildId);
    if (!cfg.roleId) return interaction.editReply({ embeds: [embeds.error('Verification is not configured in this server.')] });

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return interaction.editReply({ embeds: [embeds.error('I could not find you in this server.')] });

    if (member.roles.cache.has(cfg.roleId)) {
      return interaction.editReply({ embeds: [embeds.info('You are already verified.')] });
    }

    try {
      await addVerifyRole(member, cfg);
    } catch (err) {
      return interaction.editReply({ embeds: [embeds.error('I could not give you the verification role - check my role position.')] });
    }

    await sendLog(interaction.guild, cfg, `**${interaction.user.tag}** was verified by themselves.`);
    return interaction.editReply({ embeds: [embeds.success('You have been verified! You now have access to the server.')] });
  } catch (err) {
    return interaction.editReply({ embeds: [embeds.error('Something went wrong while verifying you. Please try again later.')] }).catch(() => {});
  }
});
