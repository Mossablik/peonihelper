const db = require('../utils/database');
const embeds = require('../utils/embed');
const helpers = require('../utils/helpers');
const perms = require('../utils/permissions');

/* ------------------------------------------------------------------ *
 * Moderation Commands (16)
 * ban, unban, kick, mute, unmute, timeout, untimeout, warn, warns,
 * warninfo, clearwarns, purge, nick, massban, softban, modlogs
 * ------------------------------------------------------------------ */

function logAction(guildId, entry) {
  const logs = db.get(`guilds.${guildId}.modlogs`, []) || [];
  logs.unshift({ ...entry, at: Date.now() });
  db.set(`guilds.${guildId}.modlogs`, logs.slice(0, 150));
}

function warnKey(guildId, userId) {
  return `guilds.${guildId}.warns.${userId}`;
}

async function notify(target, embed) {
  await target.send({ embeds: [embed] }).catch(() => {});
}

module.exports = [
  {
    name: 'ban',
    aliases: ['banish'],
    description: 'Permanently ban a member from the server.',
    usage: '<@user|id> [reason]',
    permissions: ['BanMembers'],
    botPermissions: ['BanMembers'],
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'ban <@user|id> [reason]')] });

      const member = await helpers.resolveMember(message, args[0]);
      const user = member?.user || (await helpers.resolveUser(message, args[0], client));
      if (!user) return message.reply({ embeds: [embeds.error('I could not find that user.')] });

      if (member) {
        const check = perms.canModerate(message.member, member);
        if (!check.ok) return message.reply({ embeds: [embeds.error(check.error)] });
      }

      const reason = args.slice(1).join(' ') || 'No reason provided';
      await message.guild.members.ban(user.id, { reason: `${message.author.tag} | ${reason}` }).catch((err) => {
        throw new Error(`ban failed: ${err.message}`);
      });

      logAction(message.guild.id, { action: 'Ban', target: user.id, moderator: message.author.id, reason });
      await notify(user, embeds.error(`You were banned from **${message.guild.name}**.\n**Reason:** ${reason}`));
      return message.reply({ embeds: [embeds.success(`**${user.tag}** was banned.\n**Reason:** ${reason}`)] });
    },
  },

  {
    name: 'unban',
    aliases: ['pardon'],
    description: 'Unban a previously banned user.',
    usage: '<id> [reason]',
    permissions: ['BanMembers'],
    botPermissions: ['BanMembers'],
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'unban <id> [reason]')] });

      const id = String(args[0]).replace(/[<@!>]/g, '');
      if (!helpers.isSnowflake(id)) return message.reply({ embeds: [embeds.error('Please provide a valid user ID.')] });

      const ban = await message.guild.bans.fetch(id).catch(() => null);
      if (!ban) return message.reply({ embeds: [embeds.error('That user is not banned in this server.')] });

      const reason = args.slice(1).join(' ') || 'No reason provided';
      await message.guild.members.unban(id, { reason: `${message.author.tag} | ${reason}` });

      logAction(message.guild.id, { action: 'Unban', target: id, moderator: message.author.id, reason });
      return message.reply({ embeds: [embeds.success(`**${ban.user.tag}** was unbanned.\n**Reason:** ${reason}`)] });
    },
  },

  {
    name: 'kick',
    aliases: [],
    description: 'Kick a member from the server.',
    usage: '<@user> [reason]',
    permissions: ['KickMembers'],
    botPermissions: ['KickMembers'],
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'kick <@user> [reason]')] });

      const member = await helpers.resolveMember(message, args[0]);
      if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });

      const check = perms.canModerate(message.member, member);
      if (!check.ok) return message.reply({ embeds: [embeds.error(check.error)] });
      if (!member.kickable) return message.reply({ embeds: [embeds.error('I cannot kick that member - check my role position.')] });

      const reason = args.slice(1).join(' ') || 'No reason provided';
      await notify(member.user, embeds.warn(`You were kicked from **${message.guild.name}**.\n**Reason:** ${reason}`));
      await member.kick(`${message.author.tag} | ${reason}`);

      logAction(message.guild.id, { action: 'Kick', target: member.id, moderator: message.author.id, reason });
      return message.reply({ embeds: [embeds.success(`**${member.user.tag}** was kicked.\n**Reason:** ${reason}`)] });
    },
  },

  {
    name: 'mute',
    aliases: ['timeout'],
    description: 'Timeout (mute) a member for a duration.',
    usage: '<@user> [duration] [reason]',
    permissions: ['ModerateMembers'],
    botPermissions: ['ModerateMembers'],
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'mute <@user> [duration] [reason]', 'Example duration: `10m`, `1h`, `1d`')] });

      const member = await helpers.resolveMember(message, args[0]);
      if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });

      const check = perms.canModerate(message.member, member);
      if (!check.ok) return message.reply({ embeds: [embeds.error(check.error)] });

      const duration = helpers.parseDuration(args[1]) || 10 * 60 * 1000;
      if (duration > 28 * 86400000) return message.reply({ embeds: [embeds.error('The maximum timeout length is **28 days**.')] });

      const reasonStart = helpers.parseDuration(args[1]) ? 2 : 1;
      const reason = args.slice(reasonStart).join(' ') || 'No reason provided';

      await member.timeout(duration, `${message.author.tag} | ${reason}`);

      logAction(message.guild.id, { action: 'Mute', target: member.id, moderator: message.author.id, reason, duration });
      await notify(member.user, embeds.warn(`You were timed out in **${message.guild.name}** for **${helpers.formatDuration(duration)}**.\n**Reason:** ${reason}`));
      return message.reply({
        embeds: [embeds.success(`**${member.user.tag}** was timed out for **${helpers.formatDuration(duration)}**.\n**Reason:** ${reason}`)],
      });
    },
  },

  {
    name: 'unmute',
    aliases: ['untimeout'],
    description: 'Remove a timeout from a member.',
    usage: '<@user> [reason]',
    permissions: ['ModerateMembers'],
    botPermissions: ['ModerateMembers'],
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'unmute <@user> [reason]')] });

      const member = await helpers.resolveMember(message, args[0]);
      if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });

      const check = perms.canModerate(message.member, member);
      if (!check.ok) return message.reply({ embeds: [embeds.error(check.error)] });
      if (!member.isCommunicationDisabled()) return message.reply({ embeds: [embeds.error('That member is not timed out.')] });

      const reason = args.slice(1).join(' ') || 'No reason provided';
      await member.timeout(null, `${message.author.tag} | ${reason}`);

      logAction(message.guild.id, { action: 'Unmute', target: member.id, moderator: message.author.id, reason });
      await notify(member.user, embeds.success(`Your timeout in **${message.guild.name}** was removed.`));
      return message.reply({ embeds: [embeds.success(`**${member.user.tag}** is no longer timed out.`)] });
    },
  },

  {
    name: 'timeout',
    aliases: [],
    description: 'Timeout a member for an exact duration.',
    usage: '<@user> <duration> [reason]',
    permissions: ['ModerateMembers'],
    botPermissions: ['ModerateMembers'],
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0] || !args[1]) return message.reply({ embeds: [helpers.usageError(client, message, 'timeout <@user> <duration> [reason]', 'Example duration: `30m`, `2h`, `1d`')] });

      const member = await helpers.resolveMember(message, args[0]);
      if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });

      const check = perms.canModerate(message.member, member);
      if (!check.ok) return message.reply({ embeds: [embeds.error(check.error)] });

      const duration = helpers.parseDuration(args[1]);
      if (!duration) return message.reply({ embeds: [embeds.error('That duration is invalid. Example: `30m`, `2h`, `1d`.')] });
      if (duration > 28 * 86400000) return message.reply({ embeds: [embeds.error('The maximum timeout length is **28 days**.')] });

      const reason = args.slice(2).join(' ') || 'No reason provided';
      await member.timeout(duration, `${message.author.tag} | ${reason}`);

      logAction(message.guild.id, { action: 'Timeout', target: member.id, moderator: message.author.id, reason, duration });
      await notify(member.user, embeds.warn(`You were timed out in **${message.guild.name}** for **${helpers.formatDuration(duration)}**.\n**Reason:** ${reason}`));
      return message.reply({
        embeds: [embeds.success(`**${member.user.tag}** was timed out for **${helpers.formatDuration(duration)}**.`)],
      });
    },
  },

  {
    name: 'untimeout',
    aliases: [],
    description: 'Remove a timeout from a member (alias of unmute).',
    usage: '<@user> [reason]',
    permissions: ['ModerateMembers'],
    botPermissions: ['ModerateMembers'],
    cooldown: 3,
    async execute(message, args, client) {
      // Shares the behaviour of `unmute`.
      const unmute = module.exports.find((cmd) => cmd.name === 'unmute');
      return unmute.execute(message, args, client);
    },
  },

  {
    name: 'warn',
    aliases: [],
    description: 'Warn a member.',
    usage: '<@user> [reason]',
    permissions: ['ModerateMembers'],
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'warn <@user> [reason]')] });

      const member = await helpers.resolveMember(message, args[0]);
      if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });

      const check = perms.canModerate(message.member, member);
      if (!check.ok) return message.reply({ embeds: [embeds.error(check.error)] });

      const reason = args.slice(1).join(' ') || 'No reason provided';
      const warns = db.get(warnKey(message.guild.id, member.id), []) || [];
      warns.push({ reason, moderator: message.author.id, at: Date.now() });
      db.set(warnKey(message.guild.id, member.id), warns);

      logAction(message.guild.id, { action: 'Warn', target: member.id, moderator: message.author.id, reason });
      await notify(member.user, embeds.warn(`You received a warning in **${message.guild.name}**.\n**Reason:** ${reason}\n**Total warnings:** ${warns.length}`));
      return message.reply({
        embeds: [embeds.success(`**${member.user.tag}** has been warned. They now have **${warns.length}** warning(s).`)],
      });
    },
  },

  {
    name: 'warns',
    aliases: ['warnings'],
    description: 'List the warnings of a member.',
    usage: '[@user]',
    permissions: ['ModerateMembers'],
    cooldown: 3,
    async execute(message, args, client) {
      const member = args[0] ? await helpers.resolveMember(message, args[0]) : message.member;
      if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });

      const warns = db.get(warnKey(message.guild.id, member.id), []) || [];
      if (!warns.length) return message.reply({ embeds: [embeds.info(`**${member.user.tag}** has no warnings.`)] });

      const lines = warns.map(
        (warn, index) => `**${index + 1}.** ${helpers.truncate(warn.reason, 80)} — <@${warn.moderator}> • ${helpers.formatStamp(warn.at, 'R')}`
      );
      return message.reply({
        embeds: [embeds.base(embeds.colors.moderation).setTitle(`Warnings of ${member.user.tag}`).setDescription(lines.join('\n'))],
      });
    },
  },

  {
    name: 'warninfo',
    aliases: [],
    description: 'Show the details of a single warning.',
    usage: '<@user> <number>',
    permissions: ['ModerateMembers'],
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0] || !args[1]) return message.reply({ embeds: [helpers.usageError(client, message, 'warninfo <@user> <number>')] });

      const member = await helpers.resolveMember(message, args[0]);
      if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });

      const index = Number(args[1]) - 1;
      const warns = db.get(warnKey(message.guild.id, member.id), []) || [];
      const warn = warns[index];
      if (!warn) return message.reply({ embeds: [embeds.error(`**${member.user.tag}** only has **${warns.length}** warning(s).`)] });

      return message.reply({
        embeds: [
          embeds
            .base(embeds.colors.moderation)
            .setTitle(`Warning #${index + 1} of ${member.user.tag}`)
            .addFields(
              { name: 'Reason', value: helpers.truncate(warn.reason, 1000), inline: false },
              { name: 'Moderator', value: `<@${warn.moderator}>`, inline: true },
              { name: 'Date', value: helpers.formatStamp(warn.at), inline: true }
            ),
        ],
      });
    },
  },

  {
    name: 'clearwarns',
    aliases: ['delwarns'],
    description: 'Remove one or all warnings from a member.',
    usage: '<@user> [number|all]',
    permissions: ['ModerateMembers'],
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'clearwarns <@user> [number|all]')] });

      const member = await helpers.resolveMember(message, args[0]);
      if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });

      const warns = db.get(warnKey(message.guild.id, member.id), []) || [];
      if (!warns.length) return message.reply({ embeds: [embeds.info(`**${member.user.tag}** has no warnings.`)] });

      if (!args[1] || String(args[1]).toLowerCase() === 'all') {
        db.delete(warnKey(message.guild.id, member.id));
        logAction(message.guild.id, { action: 'ClearWarns', target: member.id, moderator: message.author.id, reason: 'All warnings removed' });
        return message.reply({ embeds: [embeds.success(`Removed **${warns.length}** warning(s) from **${member.user.tag}**.`)] });
      }

      const index = Number(args[1]) - 1;
      if (!warns[index]) return message.reply({ embeds: [embeds.error(`That warning does not exist. They have **${warns.length}** warning(s).`)] });

      warns.splice(index, 1);
      db.set(warnKey(message.guild.id, member.id), warns);
      logAction(message.guild.id, { action: 'ClearWarn', target: member.id, moderator: message.author.id, reason: `Warning #${index + 1}` });
      return message.reply({ embeds: [embeds.success(`Removed warning **#${index + 1}** from **${member.user.tag}**.`)] });
    },
  },

  {
    name: 'purge',
    aliases: ['clear', 'del'],
    description: 'Delete messages from a channel (optionally only from one user).',
    usage: '<1-100> [@user]',
    permissions: ['ManageMessages'],
    botPermissions: ['ManageMessages'],
    cooldown: 5,
    async execute(message, args, client) {
      const amount = Number(args[0]);
      if (!amount || amount < 1 || amount > 100) {
        return message.reply({ embeds: [helpers.usageError(client, message, 'purge <1-100> [@user]')] });
      }

      const target = args[1] ? await helpers.resolveMember(message, args[1]) : null;
      if (args[1] && !target) return message.reply({ embeds: [embeds.error('I could not find that member.')] });

      const fetched = await message.channel.messages.fetch({ limit: 100 });
      let toDelete = fetched;
      if (target) {
        toDelete = fetched.filter((msg) => msg.author.id === target.id && msg.createdTimestamp > Date.now() - 14 * 86400000);
      }
      toDelete = toDelete.filter((msg) => msg.createdTimestamp > Date.now() - 14 * 86400000);
      if (!toDelete.size) return message.reply({ embeds: [embeds.error('There was nothing I could delete (messages older than 14 days cannot be bulk deleted).')] });

      const deleted = await message.channel.bulkDelete(toDelete, true);
      logAction(message.guild.id, { action: 'Purge', target: target?.id || null, moderator: message.author.id, reason: `${deleted.size} message(s)` });
      return message.reply({ embeds: [embeds.success(`Deleted **${deleted.size}** message(s).`)] }).then((msg) => setTimeout(() => msg.delete().catch(() => {}), 5000));
    },
  },

  {
    name: 'nick',
    aliases: ['nickname'],
    description: "Change or reset a member's nickname.",
    usage: '<@user> [nickname]',
    permissions: ['ManageNicknames'],
    botPermissions: ['ManageNicknames'],
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'nick <@user> [nickname]')] });

      const member = await helpers.resolveMember(message, args[0]);
      if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });

      const check = perms.canModerate(message.member, member);
      if (!check.ok) return message.reply({ embeds: [embeds.error(check.error)] });

      const nickname = args.slice(1).join(' ') || null;
      await member.setNickname(nickname, `${message.author.tag}`);

      logAction(message.guild.id, { action: 'Nickname', target: member.id, moderator: message.author.id, reason: nickname || 'Reset' });
      return message.reply({
        embeds: [embeds.success(nickname ? `Nickname of **${member.user.tag}** changed to **${nickname}**.` : `Nickname of **${member.user.tag}** was reset.`)],
      });
    },
  },

  {
    name: 'massban',
    aliases: [],
    description: 'Ban several members at once.',
    usage: '<@user> <@user> ... [reason]',
    permissions: ['BanMembers'],
    botPermissions: ['BanMembers'],
    cooldown: 10,
    async execute(message, args, client) {
      const members = message.mentions.members;
      if (!members || !members.size) {
        return message.reply({ embeds: [helpers.usageError(client, message, 'massban <@user> <@user> ... [reason]', 'You must mention the members you want to ban.')] });
      }

      const reasonIndex = args.indexOf(members.last().id) + 1;
      const reason = args.slice(reasonIndex).join(' ') || 'No reason provided';

      const banned = [];
      const failed = [];
      for (const member of members.values()) {
        const check = perms.canModerate(message.member, member);
        if (!check.ok || !member.bannable) {
          failed.push(member.user.tag);
          continue;
        }
        const done = await message.guild.members.ban(member.id, { reason: `${message.author.tag} | ${reason}` }).catch(() => null);
        if (done) {
          banned.push(member.user.tag);
          logAction(message.guild.id, { action: 'MassBan', target: member.id, moderator: message.author.id, reason });
        } else {
          failed.push(member.user.tag);
        }
      }

      const lines = [];
      if (banned.length) lines.push(`**Banned (${banned.length}):** ${banned.join(', ')}`);
      if (failed.length) lines.push(`**Failed (${failed.length}):** ${failed.join(', ')}`);
      lines.push(`**Reason:** ${reason}`);
      return message.reply({ embeds: [embeds.success(lines.join('\n'))] });
    },
  },

  {
    name: 'softban',
    aliases: [],
    description: "Ban and instantly unban a member to delete their recent messages.",
    usage: '<@user> [reason]',
    permissions: ['BanMembers'],
    botPermissions: ['BanMembers'],
    cooldown: 5,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'softban <@user> [reason]')] });

      const member = await helpers.resolveMember(message, args[0]);
      if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });

      const check = perms.canModerate(message.member, member);
      if (!check.ok) return message.reply({ embeds: [embeds.error(check.error)] });

      const reason = args.slice(1).join(' ') || 'No reason provided';
      await message.guild.members.ban(member.id, { deleteMessageSeconds: 86400, reason: `${message.author.tag} | ${reason}` });
      await message.guild.members.unban(member.id, `${message.author.tag} | softban`);

      logAction(message.guild.id, { action: 'Softban', target: member.id, moderator: message.author.id, reason });
      return message.reply({ embeds: [embeds.success(`**${member.user.tag}** was softbanned - their last day of messages was deleted.`)] });
    },
  },

  {
    name: 'modlogs',
    aliases: ['logs', 'modlog'],
    description: 'Show the recent moderation actions of this server.',
    usage: '[@user]',
    permissions: ['ModerateMembers'],
    cooldown: 5,
    async execute(message, args, client) {
      let logs = db.get(`guilds.${message.guild.id}.modlogs`, []) || [];

      if (args[0]) {
        const member = await helpers.resolveMember(message, args[0]);
        if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });
        logs = logs.filter((entry) => entry.target === member.id);
      }

      if (!logs.length) return message.reply({ embeds: [embeds.info('There are no moderation logs to show.')] });

      const lines = logs.slice(0, 10).map((entry) => {
        const target = entry.target ? `<@${entry.target}>` : 'channel';
        const moderator = entry.moderator ? `<@${entry.moderator}>` : 'unknown';
        return `**${entry.action}** • ${target} • by ${moderator} • ${helpers.formatStamp(entry.at, 'R')}\n> ${helpers.truncate(entry.reason || 'No reason', 80)}`;
      });

      return message.reply({
        embeds: [
          embeds
            .base(embeds.colors.moderation)
            .setTitle(args[0] ? 'Moderation logs (filtered)' : 'Recent moderation logs')
            .setDescription(lines.join('\n'))
            .setFooter({ text: `Showing ${Math.min(logs.length, 10)} of ${logs.length}` }),
        ],
      });
    },
  },
];
