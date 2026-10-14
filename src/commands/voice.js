const { ChannelType, PermissionFlagsBits } = require('discord.js');
const embeds = require('../utils/embed');
const helpers = require('../utils/helpers');

/* ------------------------------------------------------------------ *
 * Voice Commands (4)
 * join, disconnect, move, vlock
 * ------------------------------------------------------------------ */

/** Optional voice library - the bot still works without it. */
let voice = null;
try {
  voice = require('@discordjs/voice');
} catch {
  voice = null;
}

function isVoiceChannel(channel) {
  return channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice;
}

module.exports = [
  {
    name: 'join',
    aliases: ['vcjoin'],
    description: 'Join your current voice channel.',
    usage: '',
    botPermissions: ['Connect', 'Speak'],
    cooldown: 5,
    async execute(message, args, client) {
      const channel = message.member.voice.channel;
      if (!channel) return message.reply({ embeds: [embeds.error('You must be in a voice channel first.')] });

      const botPerms = channel.permissionsFor(message.guild.members.me);
      if (!botPerms || !botPerms.has(PermissionFlagsBits.Connect)) {
        return message.reply({ embeds: [embeds.error(`I do not have the **Connect** permission in ${channel}.`)] });
      }

      if (!voice) {
        return message.reply({ embeds: [embeds.error('The voice library (@discordjs/voice) is not installed, so I cannot connect to voice channels.')] });
      }

      try {
        const existing = voice.getVoiceConnection(message.guild.id);
        if (existing) {
          if (existing.joinConfig.channelId === channel.id && existing.state.status === voice.VoiceConnectionStatus.Ready) {
            return message.reply({ embeds: [embeds.info(`I am already connected to ${channel}.`)] });
          }
          existing.destroy();
        }

        const connection = voice.joinVoiceChannel({
          channelId: channel.id,
          guildId: message.guild.id,
          adapterCreator: message.guild.voiceAdapterCreator,
          selfDeaf: true,
        });

        await voice.entersState(connection, voice.VoiceConnectionStatus.Ready, 15_000);
      } catch (err) {
        return message.reply({ embeds: [embeds.error(`I could not connect to ${channel}: ${err.message}`)] });
      }

      return message.reply({ embeds: [embeds.success(`Connected to ${channel}. Use \`disconnect\` to make me leave.`)] });
    },
  },

  {
    name: 'disconnect',
    aliases: [],
    description: 'Disconnect a member (or the bot) from a voice channel.',
    usage: '[@user]',
    permissions: ['MoveMembers'],
    botPermissions: ['MoveMembers'],
    cooldown: 5,
    async execute(message, args, client) {
      if (args[0]) {
        const member = await helpers.resolveMember(message, args[0]);
        if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });
        if (!member.voice.channel) return message.reply({ embeds: [embeds.error('That member is not in a voice channel.')] });

        try {
          await member.voice.disconnect(`Disconnected by ${message.author.tag}`);
        } catch (err) {
          return message.reply({ embeds: [embeds.error(`I could not disconnect that member: ${err.message}`)] });
        }
        return message.reply({ embeds: [embeds.success(`**${member.user.tag}** was disconnected from voice.`)] });
      }

      const me = message.guild.members.me;
      if (!me.voice.channelId) return message.reply({ embeds: [embeds.error('I am not connected to a voice channel.')] });

      try {
        const connection = voice ? voice.getVoiceConnection(message.guild.id) : null;
        if (connection) connection.destroy();
        else await me.voice.disconnect();
      } catch (err) {
        return message.reply({ embeds: [embeds.error(`I could not disconnect: ${err.message}`)] });
      }
      return message.reply({ embeds: [embeds.success('I disconnected from the voice channel.')] });
    },
  },

  {
    name: 'move',
    aliases: [],
    description: 'Move a member to another voice channel.',
    usage: '<@user> <#voice-channel>',
    permissions: ['MoveMembers'],
    botPermissions: ['MoveMembers', 'Connect'],
    cooldown: 5,
    async execute(message, args, client) {
      if (!args[0] || !args[1]) return message.reply({ embeds: [helpers.usageError(client, message, 'move <@user> <#voice-channel>')] });

      const member = await helpers.resolveMember(message, args[0]);
      if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });
      if (!member.voice.channel) return message.reply({ embeds: [embeds.error('That member is not in a voice channel.')] });

      const target = await helpers.resolveChannel(message, args[1]);
      if (!target) return message.reply({ embeds: [embeds.error('I could not find that channel.')] });
      if (!isVoiceChannel(target)) return message.reply({ embeds: [embeds.error('That is not a voice channel.')] });

      try {
        await member.voice.setChannel(target, `Moved by ${message.author.tag}`);
      } catch (err) {
        return message.reply({ embeds: [embeds.error(`I could not move that member: ${err.message}`)] });
      }

      return message.reply({ embeds: [embeds.success(`**${member.user.tag}** was moved to **${target.name}**.`)] });
    },
  },

  {
    name: 'vlock',
    aliases: [],
    description: 'Toggle the Connect permission of a voice channel for @everyone.',
    usage: '[#voice-channel]',
    permissions: ['ManageChannels'],
    botPermissions: ['ManageChannels'],
    cooldown: 5,
    async execute(message, args, client) {
      let channel = null;
      if (args[0]) {
        channel = await helpers.resolveChannel(message, args[0]);
        if (!channel) return message.reply({ embeds: [embeds.error('I could not find that channel.')] });
        if (!isVoiceChannel(channel)) return message.reply({ embeds: [embeds.error('That is not a voice channel.')] });
      } else {
        channel = message.member.voice.channel;
        if (!channel) return message.reply({ embeds: [embeds.error('You are not in a voice channel. Mention one, e.g. `vlock <#voice-channel>`.')] });
      }

      const everyone = message.guild.roles.everyone.id;
      const overwrite = channel.permissionOverwrites.cache.get(everyone);
      const locked = overwrite ? overwrite.deny.has(PermissionFlagsBits.Connect) : false;

      try {
        await channel.permissionOverwrites.edit(everyone, { Connect: locked ? null : false }, { reason: `${message.author.tag} | vlock` });
      } catch (err) {
        return message.reply({ embeds: [embeds.error(`I could not update that channel: ${err.message}`)] });
      }

      if (locked) return message.reply({ embeds: [embeds.success(`**${channel.name}** is now **unlocked** - members can connect again.`)] });
      return message.reply({ embeds: [embeds.success(`**${channel.name}** is now **locked** - members cannot connect.`)] });
    },
  },
];
