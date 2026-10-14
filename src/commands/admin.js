const { ChannelType } = require('discord.js');
const embeds = require('../utils/embed');
const helpers = require('../utils/helpers');

/* ------------------------------------------------------------------ *
 * Admin Tools (9)
 * slowmode, lock, unlock, hide, unhide, moveall, nuke, announce, lockdown
 * ------------------------------------------------------------------ */

/** Edits a permission overwrite on a channel. Returns null on success or the error message. */
async function setOverwrite(channel, roleOrId, permissions, reason) {
  try {
    await channel.permissionOverwrites.edit(roleOrId, permissions, reason ? { reason } : undefined);
    return null;
  } catch (err) {
    return err.message;
  }
}

module.exports = [
  {
    name: 'slowmode',
    aliases: [],
    description: 'Set the slowmode delay of the current channel.',
    usage: '<seconds|off>',
    permissions: ['ManageChannels'],
    botPermissions: ['ManageChannels'],
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'slowmode <seconds|off>')] });

      const input = String(args[0]).toLowerCase();
      let seconds;
      if (input === 'off') {
        seconds = 0;
      } else {
        if (!/^\d+$/.test(input)) return message.reply({ embeds: [embeds.error('Please provide a whole number of seconds between 0 and 21600, or `off`.')] });
        seconds = Number(input);
        if (seconds > 21600) return message.reply({ embeds: [embeds.error('The maximum slowmode delay is **21600** seconds (6 hours).')] });
      }

      try {
        await message.channel.setRateLimitPerUser(seconds, `${message.author.tag} | slowmode`);
      } catch (err) {
        return message.reply({ embeds: [embeds.error(`I could not set slowmode in this channel: ${err.message}`)] });
      }

      if (!seconds) return message.reply({ embeds: [embeds.success('Slowmode has been **disabled** in this channel.')] });
      return message.reply({ embeds: [embeds.success(`Slowmode set to **${seconds} second(s)** in this channel.`)] });
    },
  },

  {
    name: 'lock',
    aliases: [],
    description: 'Lock the current channel so members cannot send messages or join voice.',
    usage: '[reason]',
    permissions: ['ManageChannels'],
    botPermissions: ['ManageChannels', 'ViewChannel'],
    cooldown: 3,
    async execute(message, args, client) {
      const reason = args.join(' ') || 'No reason provided';
      const failure = await setOverwrite(
        message.channel,
        message.guild.roles.everyone.id,
        { SendMessages: false, Connect: false },
        `${message.author.tag} | lock: ${reason}`
      );
      if (failure) return message.reply({ embeds: [embeds.error(`I could not lock this channel: ${failure}`)] });

      return message.reply({ embeds: [embeds.success(`Channel locked by <@${message.author.id}>.\n**Reason:** ${reason}`)] });
    },
  },

  {
    name: 'unlock',
    aliases: [],
    description: 'Unlock the current channel so members can send messages again.',
    usage: '[reason]',
    permissions: ['ManageChannels'],
    botPermissions: ['ManageChannels'],
    cooldown: 3,
    async execute(message, args, client) {
      const reason = args.join(' ') || 'No reason provided';
      const failure = await setOverwrite(
        message.channel,
        message.guild.roles.everyone.id,
        { SendMessages: null, Connect: null },
        `${message.author.tag} | unlock: ${reason}`
      );
      if (failure) return message.reply({ embeds: [embeds.error(`I could not unlock this channel: ${failure}`)] });

      return message.reply({ embeds: [embeds.success(`Channel unlocked by <@${message.author.id}>.\n**Reason:** ${reason}`)] });
    },
  },

  {
    name: 'hide',
    aliases: [],
    description: 'Hide the current channel from @everyone.',
    usage: '',
    permissions: ['ManageChannels'],
    botPermissions: ['ManageChannels'],
    cooldown: 3,
    async execute(message, args, client) {
      const failure = await setOverwrite(
        message.channel,
        message.guild.roles.everyone.id,
        { ViewChannel: false },
        `${message.author.tag} | hide`
      );
      if (failure) return message.reply({ embeds: [embeds.error(`I could not hide this channel: ${failure}`)] });

      return message.reply({ embeds: [embeds.success('This channel is now **hidden** from @everyone.')] });
    },
  },

  {
    name: 'unhide',
    aliases: [],
    description: 'Unhide the current channel from @everyone.',
    usage: '',
    permissions: ['ManageChannels'],
    botPermissions: ['ManageChannels'],
    cooldown: 3,
    async execute(message, args, client) {
      const failure = await setOverwrite(
        message.channel,
        message.guild.roles.everyone.id,
        { ViewChannel: null },
        `${message.author.tag} | unhide`
      );
      if (failure) return message.reply({ embeds: [embeds.error(`I could not unhide this channel: ${failure}`)] });

      return message.reply({ embeds: [embeds.success('This channel is now **visible** to everyone again.')] });
    },
  },

  {
    name: 'moveall',
    aliases: [],
    description: 'Move everyone in your voice channel to another voice channel.',
    usage: '<#voice-channel>',
    permissions: ['MoveMembers'],
    botPermissions: ['MoveMembers', 'Connect'],
    cooldown: 10,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'moveall <#voice-channel>')] });

      const target = await helpers.resolveChannel(message, args[0]);
      if (!target) return message.reply({ embeds: [embeds.error('I could not find that channel.')] });
      if (target.type !== ChannelType.GuildVoice && target.type !== ChannelType.GuildStageVoice) {
        return message.reply({ embeds: [embeds.error('That is not a voice channel.')] });
      }

      const source = message.member.voice.channel;
      if (!source) return message.reply({ embeds: [embeds.error('You must be in a voice channel first.')] });
      if (source.id === target.id) return message.reply({ embeds: [embeds.error('You are already in that channel.')] });

      let moved = 0;
      let failed = 0;
      for (const member of source.members.values()) {
        if (member.user.bot) continue;
        const done = await member.voice.setChannel(target, `Moved by ${message.author.tag}`).catch(() => null);
        if (done) moved++;
        else failed++;
      }

      const lines = [`Moved **${moved}** member(s) from ${source} to ${target}.`];
      if (failed) lines.push(`**${failed}** member(s) could not be moved.`);
      return message.reply({ embeds: [embeds.success(lines.join('\n'))] });
    },
  },

  {
    name: 'nuke',
    aliases: [],
    description: 'Recreate the current channel to wipe it, keeping its name and position.',
    usage: '',
    permissions: ['ManageChannels'],
    botPermissions: ['ManageChannels', 'ViewChannel'],
    cooldown: 15,
    async execute(message, args, client) {
      const channel = message.channel;
      if (channel.isThread() || channel.type === ChannelType.GuildCategory) {
        return message.reply({ embeds: [embeds.error('This command cannot be used on threads or categories.')] });
      }

      const position = channel.position;
      let clone;
      try {
        clone = await channel.clone();
      } catch (err) {
        return message.reply({ embeds: [embeds.error(`I could not clone this channel: ${err.message}`)] });
      }

      try {
        await channel.delete();
      } catch (err) {
        await clone.delete().catch(() => {});
        return message.reply({ embeds: [embeds.error(`I could not delete this channel: ${err.message}`)] });
      }

      try {
        await clone.setPosition(position);
      } catch (err) {
        // Position is only cosmetic - the channel was still recreated.
      }

      await clone
        .send({
          embeds: [embeds.success(`Channel nuked by <@${message.author.id}> - it was recreated empty.\nNew channel: ${clone}`)],
        })
        .catch(() => {});
      return null;
    },
  },

  {
    name: 'announce',
    aliases: [],
    description: 'Send an announcement embed to a channel.',
    usage: '<#channel> <message...>',
    permissions: ['ManageChannels'],
    botPermissions: ['SendMessages', 'EmbedLinks'],
    cooldown: 5,
    async execute(message, args, client) {
      if (!args[0] || !args[1]) return message.reply({ embeds: [helpers.usageError(client, message, 'announce <#channel> <message...>')] });

      const channel = await helpers.resolveChannel(message, args[0]);
      if (!channel) return message.reply({ embeds: [embeds.error('I could not find that channel.')] });
      if (!channel.isTextBased() || channel.isVoiceBased()) {
        return message.reply({ embeds: [embeds.error('That is not a text channel.')] });
      }

      const content = args.slice(1).join(' ');
      if (content.length < 1 || content.length > 2000) {
        return message.reply({ embeds: [embeds.error('The announcement must be between **1** and **2000** characters.')] });
      }

      try {
        await channel.send({
          embeds: [
            embeds
              .base(embeds.colors.warning)
              .setTitle('📢 Announcement')
              .setDescription(content)
              .setFooter({ text: `Announced by ${message.author.tag}` }),
          ],
        });
      } catch (err) {
        return message.reply({ embeds: [embeds.error(`I could not send the announcement to ${channel}: ${err.message}`)] });
      }

      await message.delete().catch(() => {});
      return message.channel.send({ embeds: [embeds.success(`Announcement sent to ${channel}.`)] });
    },
  },

  {
    name: 'lockdown',
    aliases: [],
    description: 'Lock or unlock every text channel in the server.',
    usage: '[on|off]',
    permissions: ['ManageGuild'],
    botPermissions: ['ManageChannels'],
    cooldown: 30,
    async execute(message, args, client) {
      const input = (args[0] || 'on').toLowerCase();
      if (input !== 'on' && input !== 'off') return message.reply({ embeds: [helpers.usageError(client, message, 'lockdown [on|off]')] });

      const on = input === 'on';
      const everyone = message.guild.roles.everyone.id;
      const reason = `${message.author.tag} | lockdown ${input}`;

      const textChannels = message.guild.channels.cache.filter(
        (channel) => channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement
      );
      const channels = [...textChannels.values()].slice(0, 50);

      let succeeded = 0;
      let failed = 0;
      for (const channel of channels) {
        const failure = await setOverwrite(channel, everyone, { SendMessages: on ? false : null }, reason);
        if (failure) failed++;
        else succeeded++;
      }

      const lines = [`${on ? 'Locked' : 'Unlocked'} **${succeeded}** channel(s).`];
      if (failed) lines.push(`**${failed}** channel(s) could not be updated.`);
      if (textChannels.size > 50) lines.push(`Note: this server has **${textChannels.size}** text channels, so only the first ${channels.length} were processed.`);
      return message.reply({ embeds: [embeds.success(lines.join('\n'), on ? 'Server lockdown enabled' : 'Server lockdown disabled')] });
    },
  },
];
