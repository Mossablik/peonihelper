const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const db = require('../utils/database');
const embeds = require('../utils/embed');
const helpers = require('../utils/helpers');
const perms = require('../utils/permissions');
const interactions = require('../utils/interactions');

/* ------------------------------------------------------------------ *
 * Selfrole Commands (6)
 * selfrole-setup, selfrole-add, selfrole-remove, selfrole-list,
 * selfrole-info, selfrole-delete
 * ------------------------------------------------------------------ */

const MAX_OPTIONS = 20;
const CUSTOM_EMOJI_REGEX = /^<(a?):(\w+):(\d{17,20})>$/;

function config(guildId) {
  const cfg = db.getGuild(guildId).selfroles;
  if (!Array.isArray(cfg.options)) cfg.options = [];
  return cfg;
}

/** Parses a custom (<:name:id>) or unicode emoji. Returns null when invalid. */
function parseEmoji(input) {
  const raw = String(input || '').trim();
  if (!raw || raw.length > 64) return null;
  const custom = raw.match(CUSTOM_EMOJI_REGEX);
  if (custom) return { raw, custom: true, id: custom[3], animated: Boolean(custom[1]) };
  if (/\p{Extended_Pictographic}/u.test(raw)) return { raw, custom: false };
  return null;
}

/** Builds the select-menu components for the stored options. */
function buildComponents(cfg) {
  const options = (cfg.options || []).slice(0, 25).map((entry) => {
    const custom = String(entry.emoji || '').match(CUSTOM_EMOJI_REGEX);
    return {
      label: helpers.truncate(entry.label || 'role', 100),
      value: `role:${entry.roleId}`,
      description: 'Click to toggle',
      emoji: custom ? { id: custom[3] } : { name: entry.emoji || '⭐' },
    };
  });
  if (!options.length) return [];
  const menu = new StringSelectMenuBuilder().setCustomId('selfrole:select').setPlaceholder('Choose your roles').addOptions(options);
  return [new ActionRowBuilder().addComponents(menu)];
}

/** Rebuilds and edits the stored panel message. Returns false when gone. */
async function updatePanel(guild, cfg) {
  if (!cfg.channelId || !cfg.messageId) return false;
  const channel = guild.channels.cache.get(cfg.channelId) || (await guild.channels.fetch(cfg.channelId).catch(() => null));
  if (!channel || !channel.messages) return false;
  const message = await channel.messages.fetch(cfg.messageId).catch(() => null);
  if (!message) return false;
  await message.edit({ components: buildComponents(cfg) }).catch(() => {});
  return true;
}

/* ---------------------------- commands ----------------------------- */

module.exports = [
  {
    name: 'selfrole-setup',
    aliases: [],
    description: 'Post the self-role panel in a channel.',
    usage: '<#channel>',
    permissions: ['ManageGuild'],
    botPermissions: ['SendMessages', 'EmbedLinks', 'ManageRoles'],
    cooldown: 5,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'selfrole-setup <#channel>')] });

      const channel = await helpers.resolveChannel(message, args[0]);
      if (!channel || !channel.isTextBased()) return message.reply({ embeds: [embeds.error('The self-role panel must be posted in an existing text channel.')] });

      const cfg = config(message.guild.id);

      // Remove a previous panel, if it still exists.
      if (cfg.channelId && cfg.messageId) {
        const oldChannel = message.guild.channels.cache.get(cfg.channelId) || (await message.guild.channels.fetch(cfg.channelId).catch(() => null));
        if (oldChannel && oldChannel.messages) {
          const oldPanel = await oldChannel.messages.fetch(cfg.messageId).catch(() => null);
          if (oldPanel) await oldPanel.delete().catch(() => {});
        }
      }

      const panel = await channel.send({
        embeds: [
          embeds
            .base(embeds.colors.primary)
            .setTitle('Self roles')
            .setDescription('Use the menu below to give or remove roles.')
            .setFooter({ text: `${cfg.options.length} self role(s) configured` }),
        ],
        components: buildComponents(cfg),
      });

      cfg.channelId = channel.id;
      cfg.messageId = panel.id;
      db.save();

      return message.reply({ embeds: [embeds.success(`Self-role panel posted in ${channel} with **${cfg.options.length}** option(s).`)] });
    },
  },

  {
    name: 'selfrole-add',
    aliases: [],
    description: 'Add a role option to the self-role panel.',
    usage: '<emoji> <@role> [label...]',
    permissions: ['ManageGuild', 'ManageRoles'],
    botPermissions: ['ManageRoles'],
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0] || !args[1]) return message.reply({ embeds: [helpers.usageError(client, message, 'selfrole-add <emoji> <@role> [label...]', 'Example: `selfrole-add 🎉 @Members Giveaways`')] });

      const cfg = config(message.guild.id);
      if (!cfg.messageId) return message.reply({ embeds: [embeds.error(`There is no self-role panel yet. Run \`${helpers.commandPath(client, 'selfrole-setup')} <#channel>\` first.`)] });

      const emoji = parseEmoji(args[0]);
      if (!emoji) return message.reply({ embeds: [embeds.error('That emoji is invalid. Use a single unicode emoji or a custom one like `<:name:id>`.')] });

      const role = await helpers.resolveRole(message, args[1]);
      if (!role) return message.reply({ embeds: [embeds.error('I could not find that role.')] });

      const check = perms.canManageRole(message.member, role);
      if (!check.ok) return message.reply({ embeds: [embeds.error(check.error)] });

      if (cfg.options.some((entry) => entry.roleId === role.id)) {
        return message.reply({ embeds: [embeds.error(`**${role.name}** is already on the self-role panel. Use \`selfrole-remove\` first.`)] });
      }
      if (cfg.options.length >= MAX_OPTIONS) {
        return message.reply({ embeds: [embeds.error(`The self-role panel is full (maximum **${MAX_OPTIONS}** options).`)] });
      }

      const label = args.slice(2).join(' ').trim() || role.name;
      cfg.options.push({ roleId: role.id, emoji: emoji.raw, label: helpers.truncate(label, 50) });
      db.save();

      const updated = await updatePanel(message.guild, cfg);
      return message.reply({
        embeds: [embeds.success(`${emoji.raw} **${helpers.truncate(label, 50)}** (${role}) was added to the self-role panel.${updated ? '' : `\n*The panel message could not be edited - run \`${helpers.commandPath(client, 'selfrole-setup')}\` again.*`}`)],
      });
    },
  },

  {
    name: 'selfrole-remove',
    aliases: [],
    description: 'Remove a role option from the self-role panel.',
    usage: '<@role|number>',
    permissions: ['ManageGuild'],
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'selfrole-remove <@role|number>')] });

      const cfg = config(message.guild.id);
      if (!cfg.options.length) return message.reply({ embeds: [embeds.error('There are no self roles configured.')] });

      let index = -1;
      const number = Number(args[0]);
      if (Number.isInteger(number) && number >= 1 && number <= cfg.options.length) {
        index = number - 1;
      } else {
        const role = await helpers.resolveRole(message, args[0]);
        if (!role) return message.reply({ embeds: [embeds.error('I could not find that role or number.')] });
        index = cfg.options.findIndex((entry) => entry.roleId === role.id);
        if (index === -1) return message.reply({ embeds: [embeds.error(`**${role.name}** is not on the self-role panel.`)] });
      }

      const [removed] = cfg.options.splice(index, 1);
      db.save();

      if (!cfg.options.length) {
        // Keep the embed but strip the (now empty) menu.
        const channel = message.guild.channels.cache.get(cfg.channelId) || (await message.guild.channels.fetch(cfg.channelId).catch(() => null));
        const panel = channel && channel.messages ? await channel.messages.fetch(cfg.messageId).catch(() => null) : null;
        if (panel) await panel.edit({ components: [] }).catch(() => {});
      } else {
        await updatePanel(message.guild, cfg);
      }

      return message.reply({ embeds: [embeds.success(`Removed **${removed.label}** (<@&${removed.roleId}>) from the self-role panel.`)] });
    },
  },

  {
    name: 'selfrole-list',
    aliases: [],
    description: 'List the roles on the self-role panel.',
    usage: '',
    cooldown: 5,
    async execute(message, args, client) {
      const cfg = config(message.guild.id);
      if (!cfg.options.length) return message.reply({ embeds: [embeds.info('There are no self roles configured.')] });

      const lines = cfg.options.map((entry, index) => `**${index + 1}.** ${entry.emoji} **${helpers.truncate(entry.label, 40)}** — <@&${entry.roleId}> (\`${entry.roleId}\`)`);
      return message.reply({
        embeds: [embeds.base(embeds.colors.info).setTitle(`Self roles (${cfg.options.length})`).setDescription(lines.join('\n'))],
      });
    },
  },

  {
    name: 'selfrole-info',
    aliases: [],
    description: 'Show information about a self-role option.',
    usage: '<@role>',
    cooldown: 5,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'selfrole-info <@role>')] });

      const role = await helpers.resolveRole(message, args[0]);
      if (!role) return message.reply({ embeds: [embeds.error('I could not find that role.')] });

      const cfg = config(message.guild.id);
      const entry = cfg.options.find((option) => option.roleId === role.id);
      if (!entry) return message.reply({ embeds: [embeds.error(`**${role.name}** is not on the self-role panel.`)] });

      const members = await message.guild.members.fetch({ role: role.id }).catch(() => null);
      const count = members ? members.size : role.members.size;

      return message.reply({
        embeds: [
          embeds
            .base(embeds.colors.info)
            .setTitle('Self-role info')
            .addFields(
              { name: 'Role', value: `<@&${role.id}>`, inline: true },
              { name: 'Emoji', value: entry.emoji, inline: true },
              { name: 'Label', value: helpers.truncate(entry.label, 100), inline: true },
              { name: 'Members with role', value: String(count), inline: true }
            ),
        ],
      });
    },
  },

  {
    name: 'selfrole-delete',
    aliases: [],
    description: 'Delete the self-role panel and clear the configuration.',
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

      delete cfg.channelId;
      delete cfg.messageId;
      cfg.options = [];
      db.save();

      return message.reply({ embeds: [embeds.success('The self-role panel was deleted and the configuration was cleared.')] });
    },
  },
];

/* -------------------------- interactions --------------------------- */

interactions.register('selfrole', async (interaction, client) => {
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
  if (!interaction.inGuild()) return;
  if (!interaction.isStringSelectMenu() || interaction.customId !== 'selfrole:select') return;

  try {
    await interaction.deferReply({ ephemeral: true });

    const cfg = config(interaction.guildId);
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return interaction.editReply({ embeds: [embeds.error('I could not find you in this server.')] });

    const added = [];
    const removed = [];
    const failed = [];

    for (const value of interaction.values) {
      const roleId = value.startsWith('role:') ? value.slice(5) : null;
      const entry = cfg.options.find((option) => option.roleId === roleId);
      if (!entry) continue;

      try {
        if (member.roles.cache.has(roleId)) {
          await member.roles.remove(roleId, 'Selfrole');
          removed.push(`<@&${roleId}>`);
        } else {
          await member.roles.add(roleId, 'Selfrole');
          added.push(`<@&${roleId}>`);
        }
      } catch (err) {
        failed.push(`<@&${roleId}>`);
      }
    }

    const lines = [];
    if (added.length) lines.push(`**Added:** ${added.join(', ')}`);
    if (removed.length) lines.push(`**Removed:** ${removed.join(', ')}`);
    if (failed.length) lines.push(`**Failed:** ${failed.join(', ')} (check my role position)`);
    if (!lines.length) lines.push('Nothing changed.');

    return interaction.editReply({ embeds: [embeds.success(lines.join('\n'), 'Self roles')] });
  } catch (err) {
    return interaction.editReply({ embeds: [embeds.error('Something went wrong while updating your roles.')] }).catch(() => {});
  }
});
