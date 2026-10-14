const { ChannelType } = require('discord.js');
const db = require('../utils/database');
const embeds = require('../utils/embed');
const helpers = require('../utils/helpers');
const perms = require('../utils/permissions');
const scheduler = require('../utils/scheduler');

/* ------------------------------------------------------------------ *
 * Jail Commands (12)
 * jail-setup, jail-disable, jail, unjail, unjail-all, jail-list,
 * jail-info, jail-role, jail-channel, jail-log, jail-time, jail-history
 * ------------------------------------------------------------------ */

function config(guildId) {
  const guildData = db.getGuild(guildId);
  if (!guildData.jail) guildData.jail = {};
  return guildData.jail;
}

function recordKey(guildId, userId) {
  return `jaildb.${guildId}.${userId}`;
}

function getRecord(guildId, userId) {
  return db.get(recordKey(guildId, userId), null);
}

function pushHistory(guildId, entry) {
  const cfg = config(guildId);
  if (!Array.isArray(cfg.history)) cfg.history = [];
  cfg.history.push({ at: Date.now(), ...entry });
  if (cfg.history.length > 100) cfg.history.splice(0, cfg.history.length - 100);
}

async function fetchChannel(guild, id) {
  if (!id) return null;
  return guild.channels.cache.get(id) || (await guild.channels.fetch(id).catch(() => null));
}

/** Sends a jail log embed to the log channel (falls back to the jail channel). */
async function sendLog(guild, cfg, text) {
  const channel = (await fetchChannel(guild, cfg.logChannelId)) || (await fetchChannel(guild, cfg.channelId));
  if (!channel || !channel.isTextBased()) return;
  await channel.send({ embeds: [embeds.moderation(text, 'Jail log')] }).catch(() => {});
}

/** Roles of a member that we may store and later restore. */
function restorableRoles(guild, member) {
  const me = guild.members.me;
  return member.roles.cache
    .filter((role) => role.id !== guild.roles.everyone.id && !role.managed && (!me || role.position < me.roles.highest.position))
    .map((role) => role.id);
}

/** Jails a member: strips roles, adds the jail role, hides every channel, schedules the release. */
async function jailMember(guild, member, byUser, reason, durationMs) {
  const cfg = config(guild.id);
  const auditReason = `${byUser.tag} | ${reason}`;
  const everyoneId = guild.roles.everyone.id;

  // 1. Remember and remove the current roles.
  const roles = restorableRoles(guild, member);
  if (roles.length) await member.roles.remove(roles, auditReason).catch(() => {});

  // 2. Give the jail role.
  const jailRole = guild.roles.cache.get(cfg.roleId) || (await guild.roles.fetch(cfg.roleId).catch(() => null));
  if (jailRole) await member.roles.add(jailRole, auditReason).catch(() => {});

  // 3. Hide every text channel from @everyone (up to 60).
  const overwritten = [];
  const textChannels = guild.channels.cache.filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement).first(60);
  for (const channel of textChannels) {
    const done = await channel.permissionOverwrites.edit(everyoneId, { ViewChannel: false }, { reason: auditReason }).catch(() => null);
    if (done) overwritten.push(channel.id);
  }

  // Keep the jail channel visible, and let the member talk there.
  const jailChannel = await fetchChannel(guild, cfg.channelId);
  if (jailChannel && jailChannel.isTextBased()) {
    await jailChannel.permissionOverwrites.edit(everyoneId, { ViewChannel: true }, { reason: auditReason }).catch(() => {});
    await jailChannel.permissionOverwrites.edit(member, { ViewChannel: true, SendMessages: true }, { reason: auditReason }).catch(() => {});
  }

  // 4. Store the record + history.
  const record = {
    roles,
    jailedAt: Date.now(),
    by: byUser.id,
    reason,
    releaseAt: durationMs > 0 ? Date.now() + durationMs : null,
    scheduleId: null,
    overwritten,
  };
  db.set(recordKey(guild.id, member.id), record);

  // 5. Schedule the automatic release.
  if (durationMs > 0) {
    record.scheduleId = scheduler.add('jail-release', { guildId: guild.id, userId: member.id }, record.releaseAt);
    db.save();
  }
  pushHistory(guild.id, { userId: member.id, by: byUser.id, reason, action: 'jail' });
  db.save();

  // 6. Tell the member.
  const release = record.releaseAt ? ` You will be released ${helpers.formatStamp(record.releaseAt, 'R')}.` : ' You will stay there until a moderator releases you.';
  await member
    .send({ embeds: [embeds.warn(`You were jailed in **${guild.name}**.${release}\n**Reason:** ${reason}`)] })
    .catch(() => {});
  return record;
}

/** Releases a member: restores roles, clears the overwrites, cancels the schedule, deletes the record. */
async function unjailMember(guild, member, byUser, reason) {
  const cfg = config(guild.id);
  const auditReason = `${byUser.tag} | ${reason}`;
  const everyoneId = guild.roles.everyone.id;
  const record = getRecord(guild.id, member.id);
  const me = guild.members.me;

  if (record) {
    // 1. Restore the stored roles that still exist and are assignable.
    const restorable = (record.roles || [])
      .map((id) => guild.roles.cache.get(id))
      .filter((role) => role && !role.managed && (!me || role.position < me.roles.highest.position));
    if (restorable.length) await member.roles.add(restorable, auditReason).catch(() => {});
    if (cfg.roleId && member.roles.cache.has(cfg.roleId)) {
      await member.roles.remove(cfg.roleId, auditReason).catch(() => {});
    }

    // 2. Undo the overwrites we created.
    for (const channelId of record.overwritten || []) {
      const channel = await fetchChannel(guild, channelId);
      if (!channel || !channel.permissionOverwrites) continue;
      const overwrite = channel.permissionOverwrites.cache.get(everyoneId);
      if (overwrite && overwrite.deny.has('ViewChannel')) {
        await channel.permissionOverwrites.delete(everyoneId, auditReason).catch(() => {});
      }
    }

    // Remove the special allows of the jail channel.
    const jailChannel = await fetchChannel(guild, cfg.channelId);
    if (jailChannel && jailChannel.permissionOverwrites) {
      const overwrite = jailChannel.permissionOverwrites.cache.get(everyoneId);
      if (overwrite && overwrite.allow.has('ViewChannel')) {
        await jailChannel.permissionOverwrites.delete(everyoneId, auditReason).catch(() => {});
      }
      await jailChannel.permissionOverwrites.delete(member.id, auditReason).catch(() => {});
    }

    // 3. Cancel the schedule and drop the record.
    if (record.scheduleId) scheduler.cancel(record.scheduleId);
    db.delete(recordKey(guild.id, member.id));
  }

  pushHistory(guild.id, { userId: member.id, by: byUser.id, reason, action: 'unjail' });
  db.save();

  await member.send({ embeds: [embeds.success(`You were unjailed in **${guild.name}**.\n**Reason:** ${reason}`)] }).catch(() => {});
}

/* ------------------------- scheduled release ------------------------ */
scheduler.register('jail-release', async (data, client) => {
  const guild = await client.guilds.fetch(data.guildId).catch(() => null);
  if (!guild) return;

  const member = await guild.members.fetch(data.userId).catch(() => null);
  const record = getRecord(guild.id, data.userId);
  const botUser = { id: client.user.id, tag: client.user.tag };

  if (member && record) {
    await unjailMember(guild, member, botUser, 'Jail time finished');
  } else if (record) {
    if (record.scheduleId) scheduler.cancel(record.scheduleId);
    db.delete(recordKey(guild.id, data.userId));
    pushHistory(guild.id, { userId: data.userId, by: client.user.id, reason: 'Jail time finished (member left)', action: 'unjail' });
    db.save();
  }

  const cfg = config(guild.id);
  const channel = (await fetchChannel(guild, cfg.logChannelId)) || (await fetchChannel(guild, cfg.channelId));
  if (channel && channel.isTextBased()) {
    await channel.send({ embeds: [embeds.info(`<@${data.userId}> was released - their jail time has finished.`)] }).catch(() => {});
  }
});

/* ---------------------------- commands ----------------------------- */

module.exports = [
  {
    name: 'jail-setup',
    aliases: [],
    description: 'Set up the jail system (role and channel).',
    usage: '<@role|create> [#channel]',
    permissions: ['ManageGuild'],
    botPermissions: ['ManageRoles', 'ManageChannels'],
    cooldown: 5,
    async execute(message, args, client) {
      const cfg = config(message.guild.id);

      let role = args[0] ? await helpers.resolveRole(message, args[0]) : null;
      if (!role && (!args[0] || args[0].toLowerCase() === 'create')) {
        role = await message.guild.roles
          .create({
            name: 'Jailed',
            permissions: ['ViewChannel', 'SendMessages', 'Connect', 'Speak', 'UseApplicationCommands', 'SendMessagesInThreads'],
            color: '#992D22',
            reason: `${message.author.tag} | jail-setup`,
          })
          .catch(() => null);
        if (!role) return message.reply({ embeds: [embeds.error('I could not create the jail role - check my Manage Roles permission.')] });
      }
      if (!role) return message.reply({ embeds: [embeds.error('I could not find that role. Use a role mention/ID, or `create`.')] });

      const check = perms.canManageRole(message.member, role);
      if (!check.ok) return message.reply({ embeds: [embeds.error(check.error)] });

      const channel = args[1] ? await helpers.resolveChannel(message, args[1]) : message.channel;
      if (!channel.isTextBased()) return message.reply({ embeds: [embeds.error('The jail channel must be a text channel.')] });

      cfg.roleId = role.id;
      cfg.channelId = channel.id;
      db.save();

      return message.reply({ embeds: [embeds.success(`The jail system is configured.\n**Role:** ${role}\n**Channel:** ${channel}`)] });
    },
  },

  {
    name: 'jail-disable',
    aliases: [],
    description: 'Disable the jail system (keeps the history).',
    usage: '',
    permissions: ['ManageGuild'],
    cooldown: 3,
    async execute(message, args, client) {
      const cfg = config(message.guild.id);
      cfg.roleId = null;
      cfg.channelId = null;
      cfg.logChannelId = null;
      cfg.duration = 0;
      db.save();

      return message.reply({ embeds: [embeds.success('The jail system was disabled. The jail history was kept.')] });
    },
  },

  {
    name: 'jail',
    aliases: [],
    description: 'Jail a member: strips their roles and hides every channel.',
    usage: '<@user> [duration] [reason]',
    permissions: ['ModerateMembers'],
    botPermissions: ['ManageRoles', 'ManageChannels'],
    cooldown: 5,
    async execute(message, args, client) {
      const guild = message.guild;
      const cfg = config(guild.id);
      if (!cfg.roleId || !cfg.channelId) return message.reply({ embeds: [embeds.error(`The jail system is not configured yet - run \`${helpers.commandPath(client, 'jail-setup')}\` first.`)] });
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'jail <@user> [duration] [reason]')] });

      const member = await helpers.resolveMember(message, args[0]);
      if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });

      const check = perms.canModerate(message.member, member);
      if (!check.ok) return message.reply({ embeds: [embeds.error(check.error)] });
      if (getRecord(guild.id, member.id)) return message.reply({ embeds: [embeds.error(`**${member.user.tag}** is already in jail - use \`unjail\` first.`)] });

      const jailRole = guild.roles.cache.get(cfg.roleId) || (await guild.roles.fetch(cfg.roleId).catch(() => null));
      if (!jailRole || !jailRole.editable) return message.reply({ embeds: [embeds.error(`I cannot assign the configured jail role - run \`${helpers.commandPath(client, 'jail-setup')}\` again.`)] });

      const parsed = helpers.parseDuration(args[1]);
      const duration = parsed || cfg.duration || 0;
      const reason = args.slice(parsed ? 2 : 1).join(' ') || 'No reason provided';

      await jailMember(guild, member, message.author, reason, duration);

      const durationText = duration ? `for **${helpers.formatDuration(duration)}**` : 'until manually unjailed';
      await sendLog(guild, cfg, `**${member.user.tag}** was jailed by **${message.author.tag}** ${durationText}.\n**Reason:** ${reason}`);
      return message.reply({ embeds: [embeds.success(`**${member.user.tag}** was jailed ${durationText}.\n**Reason:** ${reason}`)] });
    },
  },

  {
    name: 'unjail',
    aliases: [],
    description: 'Release a member from jail.',
    usage: '<@user> [reason]',
    permissions: ['ModerateMembers'],
    botPermissions: ['ManageRoles', 'ManageChannels'],
    cooldown: 5,
    async execute(message, args, client) {
      const guild = message.guild;
      const cfg = config(guild.id);
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'unjail <@user> [reason]')] });

      const member = await helpers.resolveMember(message, args[0]);
      if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });
      if (!getRecord(guild.id, member.id)) return message.reply({ embeds: [embeds.error(`**${member.user.tag}** is not in jail.`)] });

      const reason = args.slice(1).join(' ') || 'No reason provided';
      await unjailMember(guild, member, message.author, reason);

      await sendLog(guild, cfg, `**${member.user.tag}** was unjailed by **${message.author.tag}**.\n**Reason:** ${reason}`);
      return message.reply({ embeds: [embeds.success(`**${member.user.tag}** was unjailed.\n**Reason:** ${reason}`)] });
    },
  },

  {
    name: 'unjail-all',
    aliases: [],
    description: 'Release every jailed member at once.',
    usage: '',
    permissions: ['ManageGuild', 'ModerateMembers'],
    botPermissions: ['ManageRoles', 'ManageChannels'],
    cooldown: 60,
    async execute(message, args, client) {
      const guild = message.guild;
      const cfg = config(guild.id);
      const records = db.get(`jaildb.${guild.id}`, {}) || {};
      const ids = Object.keys(records);
      if (!ids.length) return message.reply({ embeds: [embeds.info('Nobody is currently in jail.')] });

      let released = 0;
      let gone = 0;
      let errors = 0;
      for (const userId of ids) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
          gone++;
          if (records[userId]?.scheduleId) scheduler.cancel(records[userId].scheduleId);
          db.delete(recordKey(guild.id, userId));
          continue;
        }
        try {
          await unjailMember(guild, member, message.author, 'Unjail-all');
          released++;
        } catch {
          errors++;
        }
      }
      db.save();

      await sendLog(guild, cfg, `**${message.author.tag}** released everyone from jail.`);
      return message.reply({
        embeds: [embeds.success(`**${message.author.tag}** cleared the jail.\n**Unjailed:** ${released}\n**Already gone:** ${gone}\n**Errors:** ${errors}`)],
      });
    },
  },

  {
    name: 'jail-list',
    aliases: ['jailed'],
    description: 'List the members that are currently in jail.',
    usage: '',
    cooldown: 5,
    async execute(message, args, client) {
      const records = db.get(`jaildb.${message.guild.id}`, {}) || {};
      const ids = Object.keys(records);
      if (!ids.length) return message.reply({ embeds: [embeds.info('Nobody is currently in jail.')] });

      const lines = ids.slice(0, 15).map((userId) => {
        const record = records[userId] || {};
        return `<@${userId}> • jailed ${helpers.formatStamp(record.jailedAt || Date.now(), 'R')} • ${helpers.truncate(record.reason || 'No reason', 60)}`;
      });

      return message.reply({
        embeds: [
          embeds
            .base(embeds.colors.moderation)
            .setTitle('Members in jail')
            .setDescription(lines.join('\n'))
            .setFooter({ text: `Showing ${Math.min(ids.length, 15)} of ${ids.length}` }),
        ],
      });
    },
  },

  {
    name: 'jail-info',
    aliases: [],
    description: 'Show the jail details of a member.',
    usage: '[@user]',
    cooldown: 5,
    async execute(message, args, client) {
      const member = args[0] ? await helpers.resolveMember(message, args[0]) : message.member;
      if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });

      const record = getRecord(message.guild.id, member.id);
      if (!record) return message.reply({ embeds: [embeds.error(`**${member.user.tag}** is not in jail.`)] });

      const cfg = config(message.guild.id);
      const roles = record.roles || [];
      const roleList = roles.length ? `${roles.slice(0, 10).map((id) => `<@&${id}>`).join(' ')}${roles.length > 10 ? ' …' : ''}` : 'None';

      const embed = embeds
        .base(embeds.colors.moderation)
        .setTitle(`Jail info - ${member.user.tag}`)
        .addFields(
          { name: 'User', value: `<@${member.id}> (\`${member.id}\`)`, inline: false },
          { name: 'Jailed at', value: helpers.formatStamp(record.jailedAt, 'R'), inline: true },
          { name: 'By', value: `<@${record.by}>`, inline: true },
          { name: 'Reason', value: helpers.truncate(record.reason || 'No reason provided', 1000), inline: false },
          { name: `Roles to restore (${roles.length})`, value: roleList, inline: false },
          { name: 'Release at', value: record.releaseAt ? helpers.formatStamp(record.releaseAt, 'R') : 'Manual', inline: true }
        );
      if (cfg.channelId) embed.addFields({ name: 'Jail channel', value: `<#${cfg.channelId}>`, inline: true });

      return message.reply({ embeds: [embed] });
    },
  },

  {
    name: 'jail-role',
    aliases: [],
    description: 'Set only the jail role.',
    usage: '<@role|id>',
    permissions: ['ManageGuild'],
    botPermissions: ['ManageRoles'],
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'jail-role <@role|id>')] });

      const role = await helpers.resolveRole(message, args[0]);
      if (!role) return message.reply({ embeds: [embeds.error('I could not find that role.')] });

      const check = perms.canManageRole(message.member, role);
      if (!check.ok) return message.reply({ embeds: [embeds.error(check.error)] });

      const cfg = config(message.guild.id);
      cfg.roleId = role.id;
      db.save();

      return message.reply({ embeds: [embeds.success(`The jail role is now **${role.name}**.`)] });
    },
  },

  {
    name: 'jail-channel',
    aliases: [],
    description: 'Set only the jail channel.',
    usage: '<#channel>',
    permissions: ['ManageGuild'],
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'jail-channel <#channel>')] });

      const channel = await helpers.resolveChannel(message, args[0]);
      if (!channel) return message.reply({ embeds: [embeds.error('I could not find that channel.')] });
      if (!channel.isTextBased()) return message.reply({ embeds: [embeds.error('That is not a text channel.')] });

      const cfg = config(message.guild.id);
      cfg.channelId = channel.id;
      db.save();

      return message.reply({ embeds: [embeds.success(`The jail channel is now ${channel}.`)] });
    },
  },

  {
    name: 'jail-log',
    aliases: [],
    description: 'Set the channel where jail actions are logged.',
    usage: '<#channel>',
    permissions: ['ManageGuild'],
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'jail-log <#channel>')] });

      const channel = await helpers.resolveChannel(message, args[0]);
      if (!channel) return message.reply({ embeds: [embeds.error('I could not find that channel.')] });
      if (!channel.isTextBased()) return message.reply({ embeds: [embeds.error('That is not a text channel.')] });

      const cfg = config(message.guild.id);
      cfg.logChannelId = channel.id;
      db.save();

      return message.reply({ embeds: [embeds.success(`The jail log channel is now ${channel}.`)] });
    },
  },

  {
    name: 'jail-time',
    aliases: [],
    description: 'Set the default jail duration.',
    usage: '<duration|off>',
    permissions: ['ManageGuild'],
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'jail-time <duration|off>')] });

      const cfg = config(message.guild.id);
      if (args[0].toLowerCase() === 'off') {
        cfg.duration = 0;
        db.save();
        return message.reply({ embeds: [embeds.success('The default jail duration is now **off** - members stay jailed until manually unjailed.')] });
      }

      const duration = helpers.parseDuration(args[0]);
      if (!duration || duration < 60000) {
        return message.reply({ embeds: [embeds.error('Please provide a duration of at least **1 minute**, e.g. `30m`, `1h`, `1d` - or `off`.')] });
      }

      cfg.duration = duration;
      db.save();
      return message.reply({
        embeds: [embeds.success(`The default jail duration is now **${helpers.formatDuration(duration)}** - jailed members are released automatically after that time.`)],
      });
    },
  },

  {
    name: 'jail-history',
    aliases: [],
    description: 'Show the jail history of this server.',
    usage: '[@user]',
    cooldown: 5,
    async execute(message, args, client) {
      let history = config(message.guild.id).history || [];
      let title = 'Jail history';

      if (args[0]) {
        const member = await helpers.resolveMember(message, args[0]);
        if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });
        history = history.filter((entry) => entry.userId === member.id);
        title = `Jail history of ${member.user.tag}`;
      }
      if (!history.length) return message.reply({ embeds: [embeds.info('There are no jail history entries to show.')] });

      const newest = [...history].reverse();
      const lines = newest
        .slice(0, 15)
        .map((entry) => `${helpers.formatStamp(entry.at, 'R')} - ${entry.action} - <@${entry.userId}> - by <@${entry.by}> - ${helpers.truncate(entry.reason || 'No reason', 60)}`);

      return message.reply({
        embeds: [
          embeds
            .base(embeds.colors.moderation)
            .setTitle(title)
            .setDescription(lines.join('\n'))
            .setFooter({ text: `Showing ${Math.min(newest.length, 15)} of ${newest.length}` }),
        ],
      });
    },
  },
];
