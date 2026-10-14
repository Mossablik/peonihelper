const { version: djsVersion } = require('discord.js');
const db = require('../utils/database');
const embeds = require('../utils/embed');
const helpers = require('../utils/helpers');

/* ------------------------------------------------------------------ *
 * Information Commands (12)
 * serverinfo, userinfo, membercount, avatar, banner, roleinfo,
 * channelinfo, botinfo, uptime, ping, invite, boosts
 * ------------------------------------------------------------------ */

const CHANNEL_TYPES = {
  0: 'Text', 2: 'Voice', 4: 'Category', 5: 'Announcement', 10: 'Announcement Thread',
  11: 'Public Thread', 12: 'Private Thread', 13: 'Stage', 15: 'Forum', 16: 'Media',
};

module.exports = [
  {
    name: 'serverinfo',
    aliases: ['si', 'guild'],
    description: 'Show information about the server.',
    usage: '',
    cooldown: 5,
    async execute(message, args, client) {
      const guild = message.guild;
      await guild.members.fetch().catch(() => {});
      const humans = guild.members.cache.filter((m) => !m.user.bot).size;
      const bots = guild.members.cache.filter((m) => m.user.bot).size;

      const embed = embeds
        .base(embeds.colors.info)
        .setTitle(guild.name)
        .setThumbnail(guild.iconURL({ size: 256 }))
        .addFields(
          { name: 'Owner', value: guild.ownerId ? `<@${guild.ownerId}>` : 'Unknown', inline: true },
          { name: 'Created', value: helpers.formatStamp(guild.createdTimestamp), inline: true },
          { name: 'ID', value: guild.id, inline: true },
          { name: 'Members', value: `${guild.memberCount} (${humans} humans • ${bots} bots)`, inline: true },
          { name: 'Channels', value: `${guild.channels.cache.size} total (${guild.channels.cache.filter((c) => c.isTextBased()).size} text / ${guild.channels.cache.filter((c) => c.type === 2).size} voice)`, inline: true },
          { name: 'Roles', value: String(guild.roles.cache.size), inline: true },
          { name: 'Emojis', value: `${guild.emojis.cache.size}/${guild.maximumEmojis}`, inline: true },
          { name: 'Boosts', value: `${guild.premiumSubscriptionCount || 0} (tier ${guild.premiumTier})`, inline: true },
          { name: 'Features', value: helpers.truncate(guild.features.map((f) => `\`${f}\``).join(' ') || 'None', 1000) || 'None', inline: false }
        );

      if (guild.bannerURL()) embed.setImage(guild.bannerURL({ size: 1024 }));
      return message.reply({ embeds: [embed] });
    },
  },

  {
    name: 'userinfo',
    aliases: ['ui', 'whois'],
    description: 'Show information about a member.',
    usage: '[@user]',
    cooldown: 5,
    async execute(message, args, client) {
      const member = args[0] ? await helpers.resolveMember(message, args[0]) : message.member;
      if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });

      const user = member.user;
      const topRoles = member.roles.cache
        .filter((role) => role.id !== message.guild.id)
        .sort((a, b) => b.position - a.position)
        .first(5);

      const flags = user.flags?.toArray?.() || [];

      const embed = embeds
        .base(embeds.colors.info)
        .setTitle(user.tag)
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: 'User', value: `${user} (\`${user.id}\`)`, inline: true },
          { name: 'Account created', value: helpers.formatStamp(user.createdTimestamp), inline: true },
          { name: 'Joined server', value: helpers.formatStamp(member.joinedTimestamp || Date.now()), inline: true },
          { name: 'Highest role', value: member.roles.highest?.id === message.guild.id ? 'None' : `${member.roles.highest}`, inline: true },
          { name: `Roles (${member.roles.cache.size - 1})`, value: topRoles.length ? topRoles.map((r) => `${r}`).join(', ') : 'None', inline: false },
          { name: 'Badges', value: flags.length ? flags.map((f) => `\`${f}\``).join(', ') : 'None', inline: true },
          { name: 'Timeout', value: member.isCommunicationDisabled() ? `Until ${helpers.formatStamp(member.communicationDisabledUntilTimestamp)}` : 'No', inline: true },
          { name: 'Bot', value: user.bot ? 'Yes' : 'No', inline: true }
        );

      if (member.displayAvatarURL()) embed.setImage(user.displayAvatarURL({ size: 512 }));
      return message.reply({ embeds: [embed] });
    },
  },

  {
    name: 'membercount',
    aliases: ['mc'],
    description: 'Show how many members the server has.',
    usage: '',
    cooldown: 5,
    async execute(message, args, client) {
      await message.guild.members.fetch().catch(() => {});
      const total = message.guild.memberCount;
      const humans = message.guild.members.cache.filter((m) => !m.user.bot).size;
      const bots = total - humans;
      return message.reply({
        embeds: [embeds.info(`**${message.guild.name}** has **${total}** member(s):\n> 👤 Humans: **${humans}**\n> 🤖 Bots: **${bots}**`)],
      });
    },
  },

  {
    name: 'avatar',
    aliases: ['a', 'pfp'],
    description: "Show a member's avatar.",
    usage: '[@user]',
    cooldown: 5,
    async execute(message, args, client) {
      const member = args[0] ? await helpers.resolveMember(message, args[0]) : message.member;
      if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });

      const url = member.user.displayAvatarURL({ size: 1024, dynamic: true });
      return message.reply({
        embeds: [
          embeds
            .base(embeds.colors.info)
            .setTitle(`${member.user.tag}'s avatar`)
            .setImage(url)
            .setDescription(`[Download](${url})`),
        ],
      });
    },
  },

  {
    name: 'banner',
    aliases: ['b'],
    description: "Show a member's profile banner.",
    usage: '[@user]',
    cooldown: 5,
    async execute(message, args, client) {
      const target = args[0] ? await helpers.resolveMember(message, args[0]) : message.member;
      if (!target) return message.reply({ embeds: [embeds.error('I could not find that member.')] });

      const user = await client.users.fetch(target.id, { force: true }).catch(() => target.user);
      const url = user.bannerURL({ size: 1024 });
      if (!url) return message.reply({ embeds: [embeds.error(`**${user.tag}** does not have a banner.`)] });

      return message.reply({
        embeds: [embeds.base(embeds.colors.info).setTitle(`${user.tag}'s banner`).setImage(url).setDescription(`[Download](${url})`)],
      });
    },
  },

  {
    name: 'roleinfo',
    aliases: ['ri'],
    description: 'Show information about a role.',
    usage: '<@role|id|name>',
    cooldown: 5,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'roleinfo <@role|id|name>')] });

      const role = await helpers.resolveRole(message, args.join(' '));
      if (!role) return message.reply({ embeds: [embeds.error('I could not find that role.')] });

      return message.reply({
        embeds: [
          embeds
            .base(role.hexColor && role.hexColor !== '#000000' ? role.hexColor : embeds.colors.info)
            .setTitle(`Role: ${role.name}`)
            .addFields(
              { name: 'ID', value: role.id, inline: true },
              { name: 'Colour', value: role.hexColor, inline: true },
              { name: 'Created', value: helpers.formatStamp(role.createdTimestamp), inline: true },
              { name: 'Members', value: String(role.members.size), inline: true },
              { name: 'Position', value: `${role.position} / ${message.guild.roles.cache.size}`, inline: true },
              { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No', inline: true },
              { name: 'Hoisted', value: role.hoist ? 'Yes' : 'No', inline: true },
              { name: 'Managed', value: role.managed ? 'Yes' : 'No', inline: true },
              { name: 'Permissions', value: helpers.truncate(role.permissions.toArray().join(', ') || 'None', 1000), inline: false }
            ),
        ],
      });
    },
  },

  {
    name: 'channelinfo',
    aliases: ['ci', 'chinfo'],
    description: 'Show information about a channel.',
    usage: '[#channel]',
    cooldown: 5,
    async execute(message, args, client) {
      const channel = args[0] ? await helpers.resolveChannel(message, args[0]) : message.channel;
      if (!channel) return message.reply({ embeds: [embeds.error('I could not find that channel.')] });

      return message.reply({
        embeds: [
          embeds
            .base(embeds.colors.info)
            .setTitle(`Channel: ${channel.name || 'unknown'}`)
            .addFields(
              { name: 'ID', value: channel.id, inline: true },
              { name: 'Type', value: CHANNEL_TYPES[channel.type] || String(channel.type), inline: true },
              { name: 'Created', value: helpers.formatStamp(channel.createdTimestamp), inline: true },
              { name: 'Category', value: channel.parent ? channel.parent.name : 'None', inline: true },
              { name: 'NSFW', value: channel.nsfw ? 'Yes' : 'No', inline: true },
              { name: 'Slowmode', value: channel.rateLimitPerUser ? `${channel.rateLimitPerUser}s` : 'Off', inline: true },
              { name: 'Topic', value: channel.topic ? helpers.truncate(channel.topic, 500) : 'None', inline: false }
            ),
        ],
      });
    },
  },

  {
    name: 'botinfo',
    aliases: ['about', 'stats'],
    description: 'Show information about the bot.',
    usage: '',
    cooldown: 5,
    async execute(message, args, client) {
      const memory = Math.round(process.memoryUsage().rss / 1024 / 1024);
      const guildData = db.getGuild(message.guild.id);

      return message.reply({
        embeds: [
          embeds
            .base(embeds.colors.primary)
            .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
            .setTitle(`${client.user.username} - bot information`)
            .addFields(
              { name: 'Servers', value: String(client.guilds.cache.size), inline: true },
              { name: 'Users', value: String(client.users.cache.size), inline: true },
              { name: 'Commands', value: String(client.commands.size), inline: true },
              { name: 'Uptime', value: helpers.formatDuration(Date.now() - client.startedAt), inline: true },
              { name: 'Ping', value: `${Math.round(client.ws.ping)}ms`, inline: true },
              { name: 'Memory', value: `${memory} MB`, inline: true },
              { name: 'Node', value: process.version, inline: true },
              { name: 'discord.js', value: `v${djsVersion}`, inline: true },
              { name: 'Prefix', value: `\`${guildData.prefix || client.config.prefix}\` (use \`prefix\` to change)`, inline: false }
            ),
        ],
      });
    },
  },

  {
    name: 'uptime',
    aliases: ['up'],
    description: "Show how long the bot has been running.",
    usage: '',
    cooldown: 5,
    async execute(message, args, client) {
      return message.reply({ embeds: [embeds.info(`I have been online for **${helpers.formatDuration(Date.now() - client.startedAt)}**.`)] });
    },
  },

  {
    name: 'ping',
    aliases: ['latency'],
    description: 'Show the bot latency.',
    usage: '',
    cooldown: 5,
    async execute(message, args, client) {
      const sent = await message.reply({ embeds: [embeds.info('Pinging...')] });
      const roundtrip = sent.createdTimestamp - message.createdTimestamp;
      return sent.edit({
        embeds: [
          embeds.info(
            `🏓 **Pong!**\n> WebSocket: **${Math.round(client.ws.ping)}ms**\n> Roundtrip: **${roundtrip}ms**`
          ),
        ],
      });
    },
  },

  {
    name: 'invite',
    aliases: [],
    description: 'Get the invite link of the bot.',
    usage: '',
    cooldown: 5,
    async execute(message, args, client) {
      return message.reply({
        embeds: [
          embeds
            .base(embeds.colors.primary)
            .setTitle('Invite me to your server')
            .setDescription(
              `**[Click here to invite me](${client.generateInvite({ permissions: ['Administrator'], scopes: ['bot'] })})**\n\nThanks for using **${client.user.username}**!`
            ),
        ],
      });
    },
  },

  {
    name: 'boosts',
    aliases: ['boostinfo', 'nitro'],
    description: 'Show the boost status of the server.',
    usage: '',
    cooldown: 5,
    async execute(message, args, client) {
      const guild = message.guild;
      const boosters = guild.members.cache.filter((m) => m.premiumSince).sort((a, b) => a.premiumSinceTimestamp - b.premiumSinceTimestamp);

      const tierBenefits = {
        0: 'No tier',
        1: 'Tier 1 - 50% extra emojis, 128kbps audio',
        2: 'Tier 2 - 1080p streaming, 256kbps audio',
        3: 'Tier 3 - 384kbps audio, vanity URL',
      };

      return message.reply({
        embeds: [
          embeds
            .base(embeds.colors.premium)
            .setTitle(`${guild.name} boosts`)
            .addFields(
              { name: 'Boosts', value: String(guild.premiumSubscriptionCount || 0), inline: true },
              { name: 'Tier', value: tierBenefits[guild.premiumTier] || 'Unknown', inline: true },
              {
                name: `Boosters (${boosters.size})`,
                value: boosters.size ? helpers.truncate(boosters.map((m) => `${m}`).join(', '), 1000) : 'No boosters yet',
                inline: false,
              }
            ),
        ],
      });
    },
  },
];
