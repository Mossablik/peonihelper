const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../utils/database');
const embeds = require('../utils/embed');
const helpers = require('../utils/helpers');
const interactions = require('../utils/interactions');
const perms = require('../utils/permissions');
const premiumUtil = require('../utils/premium');
const scheduler = require('../utils/scheduler');

/* ------------------------------------------------------------------ *
 * Premium Commands (18)
 * premium-activate, premium-generate, premium-revoke, premium-info,
 * premium-status, premium-list, premium-perks, welcome-setup,
 * welcome-disable, autorole, embed, giveaway, giveaway-reroll,
 * starboard-setup, tag, tag-create, tag-delete, reactionrole
 * ------------------------------------------------------------------ */

const DAY = 86_400_000;
const PERIOD = 30 * DAY;
const CUSTOM_EMOJI_REGEX = /^<a?:([a-zA-Z0-9_]+):(\d{17,20})>$/;
const UNICODE_EMOJI_REGEX = /[\p{Extended_Pictographic}]/u;
const HEX_REGEX = /^#?[0-9a-fA-F]{6}$/;
const TAG_NAME_REGEX = /^[a-z0-9 _-]+$/i;

/* ----------------------------- helpers ---------------------------- */

/** Live reaction-role map of a guild (creates it when missing). */
function reactionMap(guildId) {
  const guildData = db.getGuild(guildId);
  if (!guildData.reactionroles || typeof guildData.reactionroles !== 'object') guildData.reactionroles = {};
  return guildData.reactionroles;
}

function findGiveaway(messageId) {
  const list = db.get('giveaways', []) || [];
  return list.find((entry) => entry && entry.id === messageId) || null;
}

/** Unique winners that are still in the guild (host and bots excluded). */
async function pickWinners(guild, entered, count) {
  const ids = [...new Set(Array.isArray(entered) ? entered : [])];
  const valid = [];
  for (const id of ids) {
    const member = await guild.members.fetch(id).catch(() => null);
    if (member && !member.user.bot) valid.push(id);
  }
  return helpers.shuffle(valid).slice(0, Math.max(0, Number(count) || 1));
}

function winnerText(winners, prize) {
  if (!winners.length) return 'No valid entries.';
  return `🎉 Congratulations ${winners.map((id) => `<@${id}>`).join(', ')} - you won **${prize}**!`;
}

/** Shared end/reroll handler for the "giveaway" scheduler job. */
async function finishGiveaway(data, client) {
  try {
    const stored = findGiveaway(data.id);
    const channel = await client.channels.fetch(data.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const winners = await pickWinners(
      channel.guild,
      stored ? stored.entered : data.entered,
      stored ? stored.winners : data.winners
    );

    const msg = await channel.messages.fetch(data.id).catch(() => null);
    if (msg && msg.embeds.length) {
      const embed = embeds.EmbedBuilder.from(msg.embeds[0]).setFooter({ text: 'Ended' });
      await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
    }

    const prize = (stored && stored.prize) || data.prize || 'the prize';
    await channel.send({ content: winnerText(winners, prize) }).catch(() => {});
  } catch (err) {
    console.error('[giveaway:end]', err);
  }
}

scheduler.register('giveaway', finishGiveaway);
scheduler.register('giveaway-end-early', finishGiveaway);

/* -------------------- giveaway "Enter" button -------------------- */
interactions.register('giveaway', async (interaction) => {
  const stored = findGiveaway(interaction.message?.id);
  if (!stored) {
    return interaction.reply({ embeds: [embeds.error('That giveaway is no longer running.')], ephemeral: true });
  }
  if (stored.endsAt <= Date.now()) {
    return interaction.reply({ embeds: [embeds.warn('That giveaway has already ended.')], ephemeral: true });
  }
  if (Array.isArray(stored.entered) && stored.entered.includes(interaction.user.id)) {
    return interaction.reply({ embeds: [embeds.info('You have already entered this giveaway.')], ephemeral: true });
  }

  if (!Array.isArray(stored.entered)) stored.entered = [];
  stored.entered.push(interaction.user.id);
  db.save();

  return interaction.reply({
    embeds: [embeds.success(`You are entered into **${stored.prize}** - good luck!`)],
    ephemeral: true,
  });
});

/* ------------------------------ commands -------------------------- */

module.exports = [
  {
    name: 'premium-activate',
    aliases: [],
    description: 'Activate or extend premium for this server with a key.',
    usage: '<key>',
    cooldown: 10,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'premium-activate <key>')] });

      const result = premiumUtil.redeemKey(args[0], message.guild.id, message.author.id);
      if (!result.ok) return message.reply({ embeds: [embeds.error(result.error)] });

      const expires = premiumUtil.expiresAt(message.guild.id);
      return message.reply({
        embeds: [
          embeds.premium(
            `Premium activated for **${message.guild.name}** for **${result.days}** day(s) - expires ${helpers.formatStamp(expires)}.`
          ),
        ],
      });
    },
  },

  {
    name: 'premium-generate',
    aliases: [],
    description: 'Generate a premium key (bot owner only).',
    usage: '<days>',
    ownerOnly: true,
    cooldown: 5,
    async execute(message, args, client) {
      const days = Number(args[0]);
      if (!args[0] || !Number.isInteger(days) || days < 1 || days > 365) {
        return message.reply({
          embeds: [helpers.usageError(client, message, 'premium-generate <days>', 'Days must be a whole number between 1 and 365.')],
        });
      }

      const code = premiumUtil.generateKey(days);
      const dm = await message.author
        .send({ embeds: [embeds.premium(`Your premium key for **${days}** day(s):\n\`${code}\``, 'Premium key')] })
        .catch(() => null);

      return message.reply({
        embeds: [
          embeds
            .premium(
              `Generated key \`${code}\` for **${days}** day(s).${dm ? ' I also sent it to your direct messages.' : ' I could not message you, so here it is.'}`,
              'Key generated'
            )
            .setFooter({ text: `Requested by ${message.author.tag}` }),
        ],
      });
    },
  },

  {
    name: 'premium-revoke',
    aliases: [],
    description: 'Remove premium from a server (bot owner only).',
    usage: '<guildId>',
    ownerOnly: true,
    cooldown: 5,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'premium-revoke <guildId>')] });
      if (!helpers.isSnowflake(args[0])) return message.reply({ embeds: [embeds.error('Please provide a valid server ID.')] });

      const removed = premiumUtil.revoke(args[0]);
      if (!removed) return message.reply({ embeds: [embeds.error('That server has no premium.')] });

      return message.reply({ embeds: [embeds.success(`Premium removed from server \`${args[0]}\`.`)] });
    },
  },

  {
    name: 'premium-info',
    aliases: [],
    description: 'Show the premium status of this server.',
    usage: '',
    cooldown: 5,
    async execute(message, args, client) {
      const guild = message.guild;
      const active = premiumUtil.isActive(guild.id);
      const expires = premiumUtil.expiresAt(guild.id);
      const days = premiumUtil.daysLeft(guild.id);

      return message.reply({
        embeds: [
          embeds
            .base(embeds.colors.premium)
            .setTitle('Premium info')
            .setDescription(`Use \`${helpers.getPrefix(client, message)}premium-activate <key>\` to activate or extend.`)
            .addFields(
              { name: 'Status', value: active ? 'Active' : 'Inactive', inline: true },
              { name: 'Days left', value: active ? String(days) : '0', inline: true },
              { name: 'Expires', value: active && expires ? helpers.formatStamp(expires) : 'Never', inline: true }
            )
            .setFooter({ text: `Guild: ${guild.name} (${guild.id})` }),
        ],
      });
    },
  },

  {
    name: 'premium-status',
    aliases: [],
    description: 'Show a progress bar of the current premium period.',
    usage: '',
    cooldown: 5,
    async execute(message, args, client) {
      const guild = message.guild;
      const active = premiumUtil.isActive(guild.id);
      const expires = premiumUtil.expiresAt(guild.id);
      const days = premiumUtil.daysLeft(guild.id);

      const remaining = active && expires ? Math.max(0, expires - Date.now()) : 0;
      const fraction = active ? Math.min(1, remaining / PERIOD) : 1;
      const filled = Math.round(fraction * 20);
      const bar = `[${'█'.repeat(filled)}${'░'.repeat(20 - filled)}]`;

      return message.reply({
        embeds: [
          embeds
            .base(embeds.colors.premium)
            .setTitle('Premium status')
            .setDescription(`${bar}\n**${active ? 'Active' : 'Inactive'}** - ${active ? `**${days}** day(s) left` : 'no premium running'}`)
            .addFields(
              {
                name: 'Expires',
                value: active && expires ? `${helpers.formatStamp(expires)}\n\`${expires}\`` : 'Never',
                inline: true,
              },
              { name: 'Days left', value: `\`${days}\``, inline: true },
              { name: 'Period', value: `\`${PERIOD}\` ms (30 days)`, inline: true },
              { name: 'Now', value: `\`${Date.now()}\``, inline: true }
            )
            .setFooter({ text: `Guild: ${guild.name} (${guild.id})` }),
        ],
      });
    },
  },

  {
    name: 'premium-list',
    aliases: [],
    description: 'List every server with active premium (bot owner only).',
    usage: '',
    ownerOnly: true,
    cooldown: 10,
    async execute(message, args, client) {
      const entries = premiumUtil.list();
      if (!entries.length) return message.reply({ embeds: [embeds.info('There are no active premium servers.')] });

      const shown = entries.slice(0, 20);
      const lines = shown.map((entry) => {
        const name = client.guilds.cache.get(entry.guildId)?.name || 'Unknown guild';
        const left = Math.max(0, Math.ceil((entry.expires - Date.now()) / DAY));
        return `\`${entry.guildId}\` - ${name} - expires ${helpers.formatStamp(entry.expires)} - **${left}** day(s) left`;
      });

      return message.reply({
        embeds: [
          embeds
            .base(embeds.colors.premium)
            .setTitle('Active premium servers')
            .setDescription(lines.join('\n'))
            .setFooter({ text: `Showing ${shown.length} of ${entries.length}` }),
        ],
      });
    },
  },

  {
    name: 'premium-perks',
    aliases: [],
    description: 'List everything premium unlocks.',
    usage: '',
    cooldown: 5,
    async execute(message, args, client) {
      const perks = [
        ['Welcome system', 'Custom welcome messages and an automatic role for new members'],
        ['Custom embeds', 'Post rich embeds to any channel with the `embed` command'],
        ['Giveaways', 'Host giveaways with automatic winner drawing and rerolls'],
        ['Starboard', 'Keep the best messages of your server in a starboard channel'],
        ['Reaction roles', 'Self-assignable roles through reactions on any message'],
        ['Tags', 'Create, use and manage custom tags for your community'],
        ['Priority support', 'Get help from the developer faster than free servers'],
      ];

      return message.reply({
        embeds: [
          embeds
            .base(embeds.colors.premium)
            .setTitle('💎 Premium perks')
            .setDescription(perks.map(([name, desc]) => `**${name}** - ${desc}`).join('\n'))
            .setFooter({ text: 'Activate a key with premium-activate <key> - see premium-info' }),
        ],
      });
    },
  },

  {
    name: 'welcome-setup',
    aliases: [],
    description: 'Set the welcome message for new members.',
    usage: '<#channel> <message...>',
    permissions: ['ManageGuild'],
    premium: true,
    cooldown: 5,
    async execute(message, args, client) {
      if (!args[0] || !args[1]) {
        return message.reply({
          embeds: [helpers.usageError(client, message, 'welcome-setup <#channel> <message...>', 'Placeholders: {user} {server} {count}')],
        });
      }

      const channel = await helpers.resolveChannel(message, args[0]);
      if (!channel) return message.reply({ embeds: [embeds.error('I could not find that channel.')] });
      if (!channel.isTextBased()) return message.reply({ embeds: [embeds.error('That channel is not a text channel.')] });

      const text = args.slice(1).join(' ').trim();
      if (text.length < 3) return message.reply({ embeds: [embeds.error('The welcome message must be at least **3** characters long.')] });

      const guildData = db.getGuild(message.guild.id);
      guildData.welcome = { ...(guildData.welcome || {}), channelId: channel.id, message: helpers.truncate(text, 500) };
      db.save();

      const preview = text
        .replaceAll('{user}', message.author.toString())
        .replaceAll('{server}', message.guild.name)
        .replaceAll('{count}', String(message.guild.memberCount));

      const sent = await channel.send({ embeds: [embeds.info(preview, `Welcome to ${message.guild.name}!`)] }).catch(() => null);
      const note = sent ? 'A preview was posted in that channel.' : 'I could not post a preview there - check my permissions.';

      return message.reply({
        embeds: [embeds.success(`Welcome message saved for ${channel}.\n> ${helpers.truncate(text, 200)}\n${note}`)],
      });
    },
  },

  {
    name: 'welcome-disable',
    aliases: [],
    description: 'Disable the welcome message and autorole.',
    usage: '',
    permissions: ['ManageGuild'],
    premium: true,
    cooldown: 5,
    async execute(message, args, client) {
      const guildData = db.getGuild(message.guild.id);
      const welcome = guildData.welcome || {};
      for (const key of Object.keys(welcome)) delete welcome[key];
      guildData.welcome = welcome;
      db.save();

      return message.reply({ embeds: [embeds.success('The welcome message and autorole are now disabled.')] });
    },
  },

  {
    name: 'autorole',
    aliases: [],
    description: 'Set the role new members get automatically (or turn it off).',
    usage: '<@role|off>',
    permissions: ['ManageGuild', 'ManageRoles'],
    premium: true,
    cooldown: 5,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'autorole <@role|off>')] });

      const guildData = db.getGuild(message.guild.id);
      guildData.welcome = guildData.welcome || {};

      if (args[0].toLowerCase() === 'off') {
        if (!guildData.welcome.autorole) return message.reply({ embeds: [embeds.info('No autorole is configured.')] });
        delete guildData.welcome.autorole;
        db.save();
        return message.reply({ embeds: [embeds.success('Autorole disabled - new members no longer receive a role.')] });
      }

      const role = await helpers.resolveRole(message, args[0]);
      if (!role) return message.reply({ embeds: [embeds.error('I could not find that role.')] });

      const check = perms.canManageRole(message.member, role);
      if (!check.ok) return message.reply({ embeds: [embeds.error(check.error)] });

      guildData.welcome.autorole = role.id;
      db.save();

      return message.reply({ embeds: [embeds.success(`New members will now receive ${role}.`)] });
    },
  },

  {
    name: 'embed',
    aliases: [],
    description: 'Post a custom embed to a channel.',
    usage: '<#channel> <title> | <description> | [#hex colour]',
    permissions: ['ManageGuild'],
    premium: true,
    cooldown: 5,
    async execute(message, args, client) {
      if (!args[0] || !args[1]) {
        return message.reply({
          embeds: [helpers.usageError(client, message, 'embed <#channel> <title> | <description> | [#hex colour]')],
        });
      }

      const channel = await helpers.resolveChannel(message, args[0]);
      if (!channel) return message.reply({ embeds: [embeds.error('I could not find that channel.')] });
      if (!channel.isTextBased()) return message.reply({ embeds: [embeds.error('That channel is not a text channel.')] });

      const parts = args.slice(1).join(' ').split('|').map((part) => part.trim());
      const title = parts[0] || '';
      const description = parts[1] || '';
      const colour = parts[2] || '';

      if (!title || !description) {
        return message.reply({
          embeds: [helpers.usageError(client, message, 'embed <#channel> <title> | <description> | [#hex colour]')],
        });
      }
      if (title.length > 256) return message.reply({ embeds: [embeds.error('The title must be **256** characters or fewer.')] });
      if (description.length > 4000) return message.reply({ embeds: [embeds.error('The description must be **4000** characters or fewer.')] });
      if (colour && !HEX_REGEX.test(colour)) {
        return message.reply({ embeds: [embeds.error('The colour must be a hex value like `#FF00FF`.')] });
      }

      const hex = colour ? `#${colour.replace('#', '')}` : undefined;
      const embed = embeds.base(hex).setTitle(title).setDescription(description);

      const sent = await channel.send({ embeds: [embed] }).catch(() => null);
      if (!sent) return message.reply({ embeds: [embeds.error(`I could not send an embed to ${channel} - check my permissions.`)] });

      const confirm = await message.reply({ embeds: [embeds.success(`Embed posted to ${channel}.`)] });
      await message.delete().catch(() => {});
      return confirm;
    },
  },

  {
    name: 'giveaway',
    aliases: [],
    description: 'Start a giveaway in this channel.',
    usage: '<duration> <winners> <prize...>',
    permissions: ['ManageGuild'],
    premium: true,
    cooldown: 5,
    async execute(message, args, client) {
      if (!args[0] || !args[1] || !args[2]) {
        return message.reply({ embeds: [helpers.usageError(client, message, 'giveaway <duration> <winners> <prize...>', 'Example: `giveaway 1h 2 Nitro`')] });
      }

      const duration = helpers.parseDuration(args[0]);
      if (!duration) return message.reply({ embeds: [embeds.error('That duration is invalid. Example: `30m`, `6h`, `1d`.')] });
      if (duration < 60_000) return message.reply({ embeds: [embeds.error('The minimum giveaway length is **1 minute**.')] });
      if (duration > 7 * DAY) return message.reply({ embeds: [embeds.error('The maximum giveaway length is **7 days**.')] });

      const winners = Number(args[1]);
      if (!Number.isInteger(winners) || winners < 1 || winners > 10) {
        return message.reply({ embeds: [embeds.error('The number of winners must be a whole number between **1** and **10**.')] });
      }

      const prize = args.slice(2).join(' ').trim();
      if (prize.length < 1 || prize.length > 100) {
        return message.reply({ embeds: [embeds.error('The prize must be between **1** and **100** characters.')] });
      }

      const endsAt = Date.now() + duration;
      const embed = embeds
        .base(embeds.colors.premium)
        .setTitle('🎉 Giveaway!')
        .addFields(
          { name: 'Prize', value: prize, inline: true },
          { name: 'Winners', value: String(winners), inline: true },
          { name: 'Ends', value: helpers.formatStamp(endsAt, 'R'), inline: true },
          { name: 'Hosted by', value: `${message.author}`, inline: true }
        )
        .setFooter({ text: 'Press Enter to participate' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('giveaway:enter').setLabel('Enter').setEmoji('🎉').setStyle(ButtonStyle.Success)
      );

      const sent = await message.channel.send({ embeds: [embed], components: [row] }).catch(() => null);
      if (!sent) return message.reply({ embeds: [embeds.error('I could not post the giveaway - check my permissions in this channel.')] });

      db.push('giveaways', {
        id: sent.id,
        channelId: sent.channel.id,
        guildId: message.guild.id,
        prize,
        winners,
        endsAt,
        hostId: message.author.id,
        entered: [],
      });
      scheduler.add('giveaway', { id: sent.id, channelId: sent.channel.id, guildId: message.guild.id, prize, winners, hostId: message.author.id }, endsAt);

      return message.reply({
        embeds: [embeds.success(`Giveaway started for **${prize}** - it ends ${helpers.formatStamp(endsAt, 'R')}.`)],
      });
    },
  },

  {
    name: 'giveaway-reroll',
    aliases: [],
    description: 'Draw a new winner for a finished giveaway.',
    usage: '<messageId>',
    permissions: ['ManageGuild'],
    premium: true,
    cooldown: 5,
    async execute(message, args, client) {
      if (!args[0] || !helpers.isSnowflake(args[0])) {
        return message.reply({ embeds: [helpers.usageError(client, message, 'giveaway-reroll <messageId>')] });
      }

      const stored = findGiveaway(args[0]);
      if (!stored) return message.reply({ embeds: [embeds.error('I could not find that giveaway.')] });
      if (stored.endsAt > Date.now()) return message.reply({ embeds: [embeds.error('That giveaway has not ended yet.')] });

      const channel = await client.channels.fetch(stored.channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) return message.reply({ embeds: [embeds.error('I could not reach the channel of that giveaway.')] });

      const winners = await pickWinners(message.guild, stored.entered, stored.winners);
      const announced = await channel.send({ content: `🎲 Reroll! ${winners.length ? `New winner(s): ${winners.map((id) => `<@${id}>`).join(', ')} - you won **${stored.prize}**!` : 'No valid entries.'}` }).catch(() => null);
      if (!announced) return message.reply({ embeds: [embeds.error('I could not announce the reroll in that channel.')] });

      return message.reply({
        embeds: [embeds.success(winners.length ? `Rerolled **${stored.prize}** - new winner(s): ${winners.map((id) => `<@${id}>`).join(', ')}.` : 'No valid entries for that giveaway.')],
      });
    },
  },

  {
    name: 'starboard-setup',
    aliases: [],
    description: 'Set up the starboard channel for this server.',
    usage: '<#channel> [threshold]',
    permissions: ['ManageGuild'],
    premium: true,
    cooldown: 5,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'starboard-setup <#channel> [threshold]')] });

      const channel = await helpers.resolveChannel(message, args[0]);
      if (!channel) return message.reply({ embeds: [embeds.error('I could not find that channel.')] });
      if (!channel.isTextBased()) return message.reply({ embeds: [embeds.error('That channel is not a text channel.')] });

      let threshold = 3;
      if (args[1] !== undefined) {
        threshold = Number(args[1]);
        if (!Number.isInteger(threshold) || threshold < 1 || threshold > 50) {
          return message.reply({ embeds: [embeds.error('The threshold must be a whole number between **1** and **50**.')] });
        }
      }

      const guildData = db.getGuild(message.guild.id);
      guildData.starboard = { channelId: channel.id, threshold };
      db.save();

      return message.reply({
        embeds: [embeds.success(`Starboard enabled: messages need **${threshold}** ⭐ to be posted in ${channel}.`)],
      });
    },
  },

  {
    name: 'tag',
    aliases: [],
    description: 'Post the content of a stored tag.',
    usage: '<name>',
    premium: true,
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'tag <name>')] });

      const name = args[0].toLowerCase();
      const tags = db.getGuild(message.guild.id).tags || {};
      const tag = tags[name];
      if (!tag) return message.reply({ embeds: [embeds.error(`There is no tag with that name - use \`tag-create\` to make it.`)] });

      return message.reply({
        embeds: [
          embeds
            .info(helpers.truncate(tag.content, 4000), `Tag: ${name}`)
            .setFooter({ text: `Requested by ${message.author.tag}` }),
        ],
      });
    },
  },

  {
    name: 'tag-create',
    aliases: [],
    description: 'Create a reusable tag.',
    usage: '<name> <content...>',
    premium: true,
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0] || !args[1]) return message.reply({ embeds: [helpers.usageError(client, message, 'tag-create <name> <content...>')] });

      const name = args[0].toLowerCase();
      if (name.length > 30 || !TAG_NAME_REGEX.test(name)) {
        return message.reply({
          embeds: [embeds.error('The tag name must be **30** characters or fewer and only letters, numbers, spaces, `_` and `-`.')],
        });
      }

      const content = args.slice(1).join(' ').trim();
      if (content.length < 1 || content.length > 1000) {
        return message.reply({ embeds: [embeds.error('The tag content must be between **1** and **1000** characters.')] });
      }

      const guildData = db.getGuild(message.guild.id);
      const tags = guildData.tags || {};
      guildData.tags = tags;

      const existing = tags[name];
      const canManage = perms.has(message.member, ['ManageGuild'], message.channel);
      if (existing && existing.author !== message.author.id && !canManage) {
        return message.reply({ embeds: [embeds.error(`The tag **${name}** already exists and belongs to someone else.`)] });
      }

      tags[name] = { content, author: message.author.id, createdAt: Date.now() };
      db.save();

      return message.reply({ embeds: [embeds.success(`Tag **${name}** ${existing ? 'updated' : 'created'} - use it with \`tag ${name}\`.`)] });
    },
  },

  {
    name: 'tag-delete',
    aliases: [],
    description: 'Delete a stored tag.',
    usage: '<name>',
    premium: true,
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'tag-delete <name>')] });

      const name = args[0].toLowerCase();
      const guildData = db.getGuild(message.guild.id);
      const tags = guildData.tags || {};
      guildData.tags = tags;

      const tag = tags[name];
      if (!tag) return message.reply({ embeds: [embeds.error('There is no tag with that name.')] });

      const canManage = perms.has(message.member, ['ManageGuild'], message.channel);
      if (tag.author !== message.author.id && !canManage) {
        return message.reply({ embeds: [embeds.error('Only the author of the tag (or a member with Manage Server) can delete it.')] });
      }

      delete tags[name];
      db.save();
      return message.reply({ embeds: [embeds.success(`Tag **${name}** deleted.`)] });
    },
  },

  {
    name: 'reactionrole',
    aliases: [],
    description: 'Link a reaction on a message to a role.',
    usage: '<messageId> <emoji> <@role|off>',
    permissions: ['ManageGuild', 'ManageRoles'],
    premium: true,
    cooldown: 5,
    async execute(message, args, client) {
      if (!args[0] || !args[1] || !args[2]) {
        return message.reply({ embeds: [helpers.usageError(client, message, 'reactionrole <messageId> <emoji> <@role|off>')] });
      }
      if (!helpers.isSnowflake(args[0])) return message.reply({ embeds: [embeds.error('Please provide a valid message ID (right click a message -> Copy Message ID).')] });

      const customMatch = String(args[1]).match(CUSTOM_EMOJI_REGEX);
      if (!customMatch && !UNICODE_EMOJI_REGEX.test(args[1])) {
        return message.reply({ embeds: [embeds.error('Please provide an emoji, for example `⭐` or `<:name:id>`.')] });
      }
      const emojiKey = customMatch ? customMatch[2] : String(args[1]);

      const map = reactionMap(message.guild.id);
      const mapping = map[args[0]] && typeof map[args[0]] === 'object' ? map[args[0]] : {};

      if (args[2].toLowerCase() === 'off') {
        if (!(emojiKey in mapping)) return message.reply({ embeds: [embeds.error('That emoji is not linked to a role on that message.')] });
        delete mapping[emojiKey];
        if (Object.keys(mapping).length) {
          map[args[0]] = mapping;
        } else {
          delete map[args[0]];
        }
        db.save();
        return message.reply({ embeds: [embeds.success(`Reaction role removed for \`${args[0]}\`.`)] });
      }

      const role = await helpers.resolveRole(message, args[2]);
      if (!role) return message.reply({ embeds: [embeds.error('I could not find that role.')] });

      const check = perms.canManageRole(message.member, role);
      if (!check.ok) return message.reply({ embeds: [embeds.error(check.error)] });

      const target = await message.channel.messages.fetch(args[0]).catch(() => null);
      if (!target) return message.reply({ embeds: [embeds.error('I could not find that message in this channel.')] });

      mapping[emojiKey] = role.id;
      map[args[0]] = mapping;
      db.save();

      const lines = Object.entries(mapping).map(([key, roleId]) => `\`${key}\` -> <@&${roleId}>`);
      return message.reply({
        embeds: [
          embeds
            .success(`Reaction role saved for message \`${args[0]}\` in ${message.channel}:`)
            .setDescription(lines.join('\n')),
        ],
      });
    },
  },
];
