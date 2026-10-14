const embeds = require('../utils/embed');
const helpers = require('../utils/helpers');

/* ------------------------------------------------------------------ *
 * Checker Commands (7)
 * voice-check, voice-list, server-check, user-check, invite-check,
 * channel-check, role-check
 * ------------------------------------------------------------------ */

const CHANNEL_TYPES = { 0: 'Text', 2: 'Voice', 4: 'Category', 5: 'Announcement', 13: 'Stage', 15: 'Forum' };
const VERIFICATION = { 0: 'None', 1: 'Low', 2: 'Medium', 3: 'High', 4: 'Very High' };
const EXPLICIT_FILTER = { 0: 'Disabled', 1: 'Members without roles', 2: 'All members' };
const MFA_LEVEL = { 0: 'Disabled', 1: 'Enabled' };

/** Consistent blue "checker" embed. */
function checkerEmbed(title) {
  return embeds.base(embeds.colors.info).setTitle(title).setFooter({ text: 'Helper checker' });
}

function label(map, value) {
  return map[value] ?? String(value);
}

/** Status marks for a connected voice member. */
function voiceMarks(member) {
  const voice = member.voice;
  if (!voice) return [];
  const marks = [];
  if (voice.serverMute) marks.push('🔇 server-muted');
  if (voice.selfMute) marks.push('🔇 self-muted');
  if (voice.serverDeaf) marks.push('🔕 server-deafened');
  if (voice.selfDeaf) marks.push('🔕 self-deafened');
  if (voice.streaming) marks.push('📺 streaming');
  if (!marks.length && voice.speaking) marks.push('🎙️ speaking');
  return marks;
}

module.exports = [
  {
    name: 'voice-check',
    aliases: [],
    description: 'Inspect a voice channel and who is connected to it.',
    usage: '[#voice-channel]',
    cooldown: 5,
    async execute(message, args, client) {
      let channel = null;

      if (args[0]) {
        channel = await helpers.resolveChannel(message, args[0]);
        if (!channel) return message.reply({ embeds: [embeds.error('I could not find that channel.')] });
        if (channel.type !== 2) return message.reply({ embeds: [embeds.error('That channel is not a voice channel.')] });
      } else {
        channel = message.member?.voice?.channel || null;
        if (!channel) {
          return message.reply({ embeds: [embeds.error('You are not connected to a voice channel. Mention one with `voice-check #channel`.')] });
        }
      }

      const members = channel.members;
      const lines = members.size
        ? members.first(15).map((member) => {
            const marks = voiceMarks(member);
            return `<@${member.id}>${marks.length ? ` - ${marks.join(', ')}` : ''}`;
          })
        : ['Empty'];

      const embed = checkerEmbed('Voice channel check').addFields(
        { name: 'ID', value: channel.id, inline: true },
        { name: 'Type', value: 'Voice', inline: true },
        { name: 'Category', value: channel.parent?.name || 'None', inline: true },
        { name: 'Created', value: helpers.formatStamp(channel.createdTimestamp, 'R'), inline: true },
        { name: 'Bitrate', value: `${Math.round((channel.bitrate || 0) / 1000)} kbps`, inline: true },
        { name: 'User limit', value: channel.userLimit ? String(channel.userLimit) : 'Unlimited', inline: true },
        { name: 'Region', value: channel.rtcRegion || 'Automatic', inline: true },
        { name: `Connected (${members.size})`, value: helpers.truncate(lines.join('\n'), 1000), inline: false }
      );
      if (members.size > 15) embed.setFooter({ text: `Helper checker - showing 15 of ${members.size} connected` });

      return message.reply({ embeds: [embed] });
    },
  },

  {
    name: 'voice-list',
    aliases: [],
    description: 'List every voice channel with its connected members.',
    usage: '',
    cooldown: 5,
    async execute(message, args, client) {
      const voiceChannels = message.guild.channels.cache
        .filter((channel) => channel.type === 2)
        .sort((a, b) => a.position - b.position);
      if (!voiceChannels.size) return message.reply({ embeds: [embeds.info('This server has no voice channels.')] });

      const totalConnected = voiceChannels.reduce((sum, channel) => sum + (channel.members?.size || 0), 0);
      const lines = voiceChannels.first(25).map(
        (channel) =>
          `**${helpers.truncate(channel.name, 50)}** - \`${channel.id}\` (${channel.members?.size || 0}/${channel.userLimit || '∞'})`
      );

      return message.reply({
        embeds: [
          checkerEmbed('Voice channel list')
            .setDescription(lines.join('\n'))
            .setFooter({
              text: `Helper checker - ${voiceChannels.size} voice channel(s) - ${totalConnected} connected member(s)`,
            }),
        ],
      });
    },
  },

  {
    name: 'server-check',
    aliases: [],
    description: 'Run a deep check of this server.',
    usage: '',
    cooldown: 5,
    async execute(message, args, client) {
      const guild = message.guild;

      let ownerUser = null;
      if (guild.ownerId) {
        ownerUser = client.users.cache.get(guild.ownerId) || (await client.users.fetch(guild.ownerId).catch(() => null));
      }

      const embed = checkerEmbed('Server check')
        .setThumbnail(guild.iconURL({ size: 256 }))
        .addFields(
          { name: 'Name', value: guild.name, inline: true },
          { name: 'ID', value: guild.id, inline: true },
          { name: 'Owner', value: guild.ownerId ? `<@${guild.ownerId}>` : 'Unknown', inline: true },
          { name: 'Owner account created', value: ownerUser ? helpers.formatStamp(ownerUser.createdTimestamp, 'R') : 'Unknown', inline: true },
          { name: 'Created', value: helpers.formatStamp(guild.createdTimestamp, 'R'), inline: true },
          { name: 'Verification level', value: label(VERIFICATION, guild.verificationLevel), inline: true },
          { name: '2FA for moderators', value: label(MFA_LEVEL, guild.mfaLevel), inline: true },
          { name: 'Explicit content filter', value: label(EXPLICIT_FILTER, guild.explicitContentFilter), inline: true },
          {
            name: 'AFK channel',
            value: guild.afkChannel ? `#${guild.afkChannel.name} (${guild.afkTimeout}s)` : 'None',
            inline: true,
          },
          { name: 'System channel', value: guild.systemChannel ? `#${guild.systemChannel.name}` : 'None', inline: true },
          { name: 'Approx. members', value: String(guild.memberCount), inline: true },
          { name: 'Shard id', value: String(guild.shardId), inline: true },
          { name: 'Features', value: `${guild.features.length} enabled`, inline: true }
        );

      return message.reply({ embeds: [embed] });
    },
  },

  {
    name: 'user-check',
    aliases: [],
    description: 'Check a user account in detail.',
    usage: '[@user|id]',
    cooldown: 5,
    async execute(message, args, client) {
      const target = args[0] || message.author.id;
      const member = await helpers.resolveMember(message, target);
      const user = member?.user || (await helpers.resolveUser(message, target, client));
      if (!user) return message.reply({ embeds: [embeds.error('I could not find that user.')] });

      const ageDays = Math.floor((Date.now() - user.createdTimestamp) / 86400000);
      const flags = user.flags?.toArray?.() || [];

      const fresh = await client.users.fetch(user.id, { force: true }).catch(() => null);
      const bannerUrl = fresh?.bannerURL({ size: 1024 }) || null;

      let mutual = 0;
      try {
        mutual = client.guilds.cache.filter((guild) => guild.members.cache.has(user.id)).size;
      } catch {
        mutual = 0;
      }

      const avatarUrl = user.displayAvatarURL({ size: 1024 });
      const embed = checkerEmbed('User check')
        .setThumbnail(avatarUrl)
        .addFields(
          { name: 'User', value: `${user.tag} (\`${user.id}\`)`, inline: true },
          { name: 'Bot', value: user.bot ? 'Yes' : 'No', inline: true },
          {
            name: 'Account created',
            value: `${helpers.formatStamp(user.createdTimestamp, 'R')}\n${ageDays} day(s) old`,
            inline: true,
          },
          { name: 'Badges', value: flags.length ? flags.map((flag) => `\`${flag}\``).join(', ') : 'None', inline: false },
          { name: 'Avatar', value: `[Open avatar](${avatarUrl})`, inline: true },
          { name: 'Banner', value: bannerUrl ? `[Open banner](${bannerUrl})` : 'None', inline: true },
          { name: 'Mutual servers', value: String(mutual), inline: true },
          {
            name: 'Member of this server',
            value: member ? `Joined ${helpers.formatStamp(member.joinedTimestamp || Date.now(), 'R')}` : 'No',
            inline: false,
          }
        );

      return message.reply({ embeds: [embed] });
    },
  },

  {
    name: 'invite-check',
    aliases: [],
    description: 'Check where an invite leads to.',
    usage: '<code|url>',
    cooldown: 5,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'invite-check <code|url>')] });

      const raw = args[0];
      const urlMatch = raw.match(/(?:discord\.(?:gg|io|me|li)\/|discord(?:app)?\.com\/invite\/)([\w-]+)/i);
      const code = urlMatch ? urlMatch[1] : /^[\w-]{2,32}$/.test(raw) ? raw : null;
      if (!code) return message.reply({ embeds: [embeds.error('That does not look like a valid invite code or link.')] });

      const invite = await client.fetchInvite(code).catch(() => null);
      if (!invite) return message.reply({ embeds: [embeds.error('I could not find that invite - it may be expired or invalid.')] });

      const embed = checkerEmbed('Invite check').addFields(
        { name: 'Server', value: invite.guild ? `${invite.guild.name} (\`${invite.guild.id}\`)` : 'Unknown', inline: true },
        { name: 'Inviter', value: invite.inviter ? `${invite.inviter.tag}` : 'Unknown', inline: true },
        { name: 'Channel', value: invite.channel?.name ? `#${invite.channel.name}` : 'Unknown', inline: true },
        { name: 'Uses', value: `${invite.uses ?? 0} / ${invite.maxUses || 'Unlimited'}`, inline: true },
        { name: 'Temporary membership', value: invite.temporary ? 'Yes' : 'No', inline: true },
        { name: 'Expires', value: invite.expiresTimestamp ? helpers.formatStamp(invite.expiresTimestamp, 'R') : 'Never', inline: true }
      );

      const icon = invite.guild?.iconURL?.({ size: 256 });
      if (icon) embed.setThumbnail(icon);

      return message.reply({ embeds: [embed] });
    },
  },

  {
    name: 'channel-check',
    aliases: [],
    description: 'Inspect a channel in detail.',
    usage: '[#channel]',
    cooldown: 5,
    async execute(message, args, client) {
      const channel = args[0] ? await helpers.resolveChannel(message, args[0]) : message.channel;
      if (!channel) return message.reply({ embeds: [embeds.error('I could not find that channel.')] });

      return message.reply({
        embeds: [
          checkerEmbed(`Channel check: #${channel.name || 'unknown'}`).addFields(
            { name: 'Name', value: `#${channel.name || 'unknown'}`, inline: true },
            { name: 'ID', value: channel.id, inline: true },
            { name: 'Type', value: CHANNEL_TYPES[channel.type] || String(channel.type), inline: true },
            { name: 'Category', value: channel.parent?.name || 'None', inline: true },
            { name: 'Created', value: helpers.formatStamp(channel.createdTimestamp, 'R'), inline: true },
            { name: 'Position', value: String(channel.position ?? 'n/a'), inline: true },
            { name: 'NSFW', value: channel.nsfw ? 'Yes' : 'No', inline: true },
            { name: 'Slowmode', value: channel.rateLimitPerUser ? `${channel.rateLimitPerUser}s` : 'Off', inline: true },
            { name: 'Permission overwrites', value: String(channel.permissionOverwrites?.cache?.size ?? 0), inline: true },
            { name: 'Members reached', value: channel.members?.size !== undefined ? String(channel.members.size) : 'n/a', inline: true },
            { name: 'Topic', value: channel.topic ? helpers.truncate(channel.topic, 300) : 'None', inline: false }
          ),
        ],
      });
    },
  },

  {
    name: 'role-check',
    aliases: [],
    description: 'Inspect a role in detail.',
    usage: '<@role|id|name>',
    cooldown: 5,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'role-check <@role|id|name>')] });

      const role = await helpers.resolveRole(message, args.join(' '));
      if (!role) return message.reply({ embeds: [embeds.error('I could not find that role.')] });

      const highestFor = role.members.filter((member) => member.roles.highest?.id === role.id).size;
      const colour = role.hexColor && role.hexColor !== '#000000' ? role.hexColor : embeds.colors.info;

      return message.reply({
        embeds: [
          checkerEmbed(`Role check: ${role.name}`).addFields(
            { name: 'Name', value: role.name, inline: true },
            { name: 'ID', value: role.id, inline: true },
            { name: 'Colour', value: role.hexColor, inline: true },
            { name: 'Created', value: helpers.formatStamp(role.createdTimestamp, 'R'), inline: true },
            { name: 'Position', value: `${role.position} / ${message.guild.roles.cache.size}`, inline: true },
            { name: 'Members', value: String(role.members.size), inline: true },
            { name: 'Hoisted', value: role.hoist ? 'Yes' : 'No', inline: true },
            { name: 'Hoist style', value: role.hoist ? 'Separate group in the member list' : 'Grouped with the other roles', inline: true },
            { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No', inline: true },
            { name: 'Managed', value: role.managed ? 'Yes' : 'No', inline: true },
            { name: 'Highest role for', value: String(highestFor), inline: true },
            { name: 'Colour swatch', value: 'The colour of this embed is the role colour.', inline: false }
          ).setColor(colour),
        ],
      });
    },
  },
];
