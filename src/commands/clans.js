const db = require('../utils/database');
const embeds = require('../utils/embed');
const helpers = require('../utils/helpers');

/* ------------------------------------------------------------------ *
 * Clans Commands (19)
 * clan-create, clan-info, clan-invite, clan-invites, clan-join,
 * clan-leave, clan-kick, clan-promote, clan-demote, clan-members,
 * clan-leaderboard, clan-points, clan-addpoints, clan-setleader,
 * clan-rename, clan-icon, clan-search, clan-reset, clan-claim
 * ------------------------------------------------------------------ */

const DAY_MS = 24 * 3600000;
const NAME_REGEX = /^[A-Za-z0-9 _-]+$/;
const RANK_EMOJI = { leader: '👑', coleader: '⭐', member: '•' };
const RANK_LABEL = { leader: 'Leader', coleader: 'Co-leader', member: 'Member' };

function getClans(guildId) {
  return db.get(`clans.${guildId}`, {}) || {};
}

/** Fetches a clan and fills in any missing default fields. */
function getClan(guildId, clanId) {
  const clan = db.get(`clans.${guildId}.${clanId}`, null);
  if (!clan || typeof clan !== 'object') return null;
  if (!clan.members || typeof clan.members !== 'object') clan.members = {};
  if (!Array.isArray(clan.invites)) clan.invites = [];
  if (!Number.isFinite(clan.points)) clan.points = Number(clan.points) || 0;
  if (clan.icon === undefined) clan.icon = null;
  if (!clan.createdAt) clan.createdAt = Date.now();
  return clan;
}

function saveClan(guildId, clan) {
  db.set(`clans.${guildId}.${clan.id}`, clan);
}

function deleteClan(guildId, clanId) {
  db.delete(`clans.${guildId}.${clanId}`);
}

/** Clan the user belongs to in this guild (clears stale userClan links). */
function getUserClan(guildId, userId) {
  const clanId = db.get(`userClan.${guildId}.${userId}`, null);
  if (!clanId) return null;
  const clan = getClan(guildId, clanId);
  if (!clan) db.delete(`userClan.${guildId}.${userId}`);
  return clan;
}

/** Adds or removes a member and always keeps `userClan` in sync. */
function setMembership(guildId, clan, userId, rank) {
  if (rank) clan.members[userId] = rank;
  else delete clan.members[userId];
  saveClan(guildId, clan);
  if (rank) db.set(`userClan.${guildId}.${userId}`, clan.id);
  else db.delete(`userClan.${guildId}.${userId}`);
}

function rankOf(clan, userId) {
  return clan.members[userId] || null;
}

function isLeader(clan, userId) {
  return clan.leaderId === userId;
}

function isOfficer(clan, userId) {
  const rank = rankOf(clan, userId);
  return rank === 'leader' || rank === 'coleader';
}

function memberCount(clan) {
  return clan && clan.members ? Object.keys(clan.members).length : 0;
}

/** Finds a clan by exact id, exact case-insensitive name or (loose) leading name substring. */
function findClan(guildId, query, loose = false) {
  const text = String(query || '').trim();
  if (!text) return null;
  const clans = getClans(guildId);
  const byId = clans[text];
  if (byId && typeof byId === 'object') return byId;
  const list = Object.values(clans);
  const lower = text.toLowerCase();
  const exact = list.find((clan) => clan.name && clan.name.toLowerCase() === lower);
  if (exact || !loose) return exact || null;
  return list.find((clan) => clan.name && clan.name.toLowerCase().startsWith(lower)) || null;
}

/** Resolves a clan from a mention / id / exact name, defaulting to the author's own clan. */
async function resolveClan(message, input) {
  const guildId = message.guild.id;
  if (!input) return getUserClan(guildId, message.author.id);
  const member = await helpers.resolveMember(message, input);
  if (member) return getUserClan(guildId, member.id);
  return findClan(guildId, input, false);
}

function validateName(raw) {
  const name = String(raw || '').trim();
  if (name.length < 3 || name.length > 20) return { ok: false, error: 'Clan names must be **3-20** characters long.' };
  if (!NAME_REGEX.test(name)) return { ok: false, error: 'Clan names may only contain letters, numbers, spaces, hyphens and underscores.' };
  return { ok: true, name };
}

async function notify(user, embed) {
  await user.send({ embeds: [embed] }).catch(() => {});
}

/** Up to `limit` member mentions, each prefixed with its rank emoji. */
function roster(clan, limit) {
  const ids = Object.keys(clan.members);
  const lines = ids.slice(0, limit).map((id) => `${RANK_EMOJI[clan.members[id]] || '•'} <@${id}>`);
  if (ids.length > limit) lines.push(`*...and ${ids.length - limit} more member(s)*`);
  return lines.join('\n') || 'No members to show.';
}

module.exports = [
  {
    name: 'clan-create',
    aliases: [],
    description: 'Create a new clan.',
    usage: '<name>',
    cooldown: 30,
    async execute(message, args, client) {
      if (!args.length) return message.reply({ embeds: [helpers.usageError(client, message, 'clan-create <name>')] });
      const check = validateName(args.join(' '));
      if (!check.ok) return message.reply({ embeds: [embeds.error(check.error)] });

      const guildId = message.guild.id;
      if (getUserClan(guildId, message.author.id)) return message.reply({ embeds: [embeds.error(`You are already in a clan - use \`${helpers.getPrefix(client, message)}clan-leave\` first.`)] });

      const clanId = String((Number(db.get(`clanSeq.${guildId}`, 0)) || 0) + 1);
      db.set(`clanSeq.${guildId}`, Number(clanId));
      const clan = { id: clanId, name: check.name, leaderId: message.author.id, members: { [message.author.id]: 'leader' }, points: 0, icon: null, createdAt: Date.now(), invites: [] };
      saveClan(guildId, clan);
      db.set(`userClan.${guildId}.${message.author.id}`, clanId);

      return message.reply({ embeds: [embeds.success(`Clan **${clan.name}** was created! Use \`clan-invite\` to invite members.`)] });
    },
  },

  {
    name: 'clan-info',
    aliases: [],
    description: 'Show information about a clan.',
    usage: '[clan name|id|@user]',
    cooldown: 5,
    async execute(message, args, client) {
      const clan = await resolveClan(message, args[0]);
      if (!clan) return message.reply({ embeds: [embeds.error('I could not find that clan.')] });

      const embed = embeds.base(embeds.colors.primary).setTitle(clan.name).addFields(
        { name: 'Leader', value: `<@${clan.leaderId}>`, inline: true },
        { name: 'Members', value: String(memberCount(clan)), inline: true },
        { name: 'Points', value: String(clan.points), inline: true },
        { name: 'Created', value: helpers.formatStamp(clan.createdAt, 'R'), inline: true },
        { name: 'Members list', value: roster(clan, 15) }
      );
      if (clan.icon) embed.setThumbnail(clan.icon);
      return message.reply({ embeds: [embed] });
    },
  },

  {
    name: 'clan-invite',
    aliases: [],
    description: 'Invite a user to your clan.',
    usage: '<@user>',
    cooldown: 10,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'clan-invite <@user>')] });

      const guildId = message.guild.id;
      const clan = getUserClan(guildId, message.author.id);
      if (!clan) return message.reply({ embeds: [embeds.error('You are not in a clan.')] });
      if (!isOfficer(clan, message.author.id)) return message.reply({ embeds: [embeds.error('Only the clan leader or a co-leader can invite members.')] });

      const member = await helpers.resolveMember(message, args[0]);
      if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });
      if (getUserClan(guildId, member.id)) return message.reply({ embeds: [embeds.error(`**${member.user.tag}** is already in a clan.`)] });
      if (clan.invites.includes(member.id)) return message.reply({ embeds: [embeds.info(`**${member.user.tag}** has already been invited to **${clan.name}**.`)] });

      clan.invites.push(member.id);
      saveClan(guildId, clan);
      const text = `You were invited to join clan **${clan.name}** by **${message.author.tag}** - use \`clan-join ${clan.name}\` to accept.`;
      await notify(member.user, embeds.info(text));
      return message.reply({ embeds: [embeds.success(`Invited **${member.user.tag}** to **${clan.name}**.`)] });
    },
  },

  {
    name: 'clan-invites',
    aliases: [],
    description: 'List the clan invites you have received.',
    usage: '',
    cooldown: 5,
    async execute(message, args, client) {
      const lines = [];
      for (const clan of Object.values(getClans(message.guild.id))) {
        if (!Array.isArray(clan.invites) || !clan.invites.includes(message.author.id)) continue;
        if (clan.members && clan.members[message.author.id]) continue;
        lines.push(`**${clan.name}** - id \`${clan.id}\` - leader <@${clan.leaderId}> - ${memberCount(clan)} member(s)\n> Join with \`clan-join ${clan.name}\``);
      }

      if (!lines.length) return message.reply({ embeds: [embeds.info('You have no pending clan invites.')] });
      const embed = embeds.base(embeds.colors.info).setTitle('Clan invites').setDescription(lines.join('\n'));
      return message.reply({ embeds: [embed] });
    },
  },

  {
    name: 'clan-join',
    aliases: [],
    description: 'Join a clan you were invited to.',
    usage: '<name|id>',
    cooldown: 10,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'clan-join <name|id>')] });

      const guildId = message.guild.id;
      if (getUserClan(guildId, message.author.id)) return message.reply({ embeds: [embeds.error(`You are already in a clan - use \`${helpers.getPrefix(client, message)}clan-leave\` first.`)] });

      const clan = findClan(guildId, args.join(' '), true);
      if (!clan) return message.reply({ embeds: [embeds.error('I could not find that clan.')] });

      clan.invites = clan.invites.filter((id) => id !== message.author.id);
      setMembership(guildId, clan, message.author.id, 'member');
      return message.reply({ embeds: [embeds.success(`You joined clan **${clan.name}**! The leader can promote you with \`clan-promote <@user>\`.`)] });
    },
  },

  {
    name: 'clan-leave',
    aliases: [],
    description: 'Leave the clan you are a member of.',
    usage: '',
    cooldown: 15,
    async execute(message, args, client) {
      const guildId = message.guild.id;
      const clan = getUserClan(guildId, message.author.id);
      if (!clan) return message.reply({ embeds: [embeds.error('You are not in a clan.')] });
      if (isLeader(clan, message.author.id)) return message.reply({ embeds: [embeds.error(`You are the leader - use \`${helpers.getPrefix(client, message)}clan-setleader <@user>\` to transfer leadership before leaving.`)] });

      setMembership(guildId, clan, message.author.id, null);
      return message.reply({ embeds: [embeds.success(`You left clan **${clan.name}**.`)] });
    },
  },

  {
    name: 'clan-kick',
    aliases: [],
    description: 'Kick a member from your clan.',
    usage: '<@user>',
    cooldown: 10,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'clan-kick <@user>')] });

      const guildId = message.guild.id;
      const clan = getUserClan(guildId, message.author.id);
      if (!clan) return message.reply({ embeds: [embeds.error('You are not in a clan.')] });
      if (!isOfficer(clan, message.author.id)) return message.reply({ embeds: [embeds.error('Only the clan leader or a co-leader can kick members.')] });

      const member = await helpers.resolveMember(message, args[0]);
      if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });

      const actorRank = rankOf(clan, message.author.id);
      const targetRank = rankOf(clan, member.id);
      if (!targetRank) return message.reply({ embeds: [embeds.error('That user is not in your clan.')] });
      if (targetRank === 'leader') return message.reply({ embeds: [embeds.error('You cannot kick the clan leader.')] });
      if (actorRank !== 'leader' && targetRank === 'coleader') return message.reply({ embeds: [embeds.error('A co-leader cannot kick the leader or another co-leader.')] });

      setMembership(guildId, clan, member.id, null);
      await notify(member.user, embeds.warn(`You were kicked from clan **${clan.name}**.`));
      return message.reply({ embeds: [embeds.success(`**${member.user.tag}** was kicked from **${clan.name}**.`)] });
    },
  },

  {
    name: 'clan-promote',
    aliases: [],
    description: 'Promote a clan member to co-leader.',
    usage: '<@user>',
    cooldown: 10,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'clan-promote <@user>')] });

      const guildId = message.guild.id;
      const clan = getUserClan(guildId, message.author.id);
      if (!clan) return message.reply({ embeds: [embeds.error('You are not in a clan.')] });
      if (!isLeader(clan, message.author.id)) return message.reply({ embeds: [embeds.error('Only the clan leader can promote members.')] });

      const member = await helpers.resolveMember(message, args[0]);
      if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });

      const rank = rankOf(clan, member.id);
      if (!rank) return message.reply({ embeds: [embeds.error('That user is not in your clan.')] });
      if (rank === 'coleader') return message.reply({ embeds: [embeds.error(`**${member.user.tag}** is already a co-leader.`)] });
      if (rank === 'leader') return message.reply({ embeds: [embeds.error('That user is the clan leader.')] });

      setMembership(guildId, clan, member.id, 'coleader');
      return message.reply({ embeds: [embeds.success(`**${member.user.tag}** is now a co-leader of **${clan.name}**.`)] });
    },
  },

  {
    name: 'clan-demote',
    aliases: [],
    description: 'Demote a co-leader back to member.',
    usage: '<@user>',
    cooldown: 10,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'clan-demote <@user>')] });

      const guildId = message.guild.id;
      const clan = getUserClan(guildId, message.author.id);
      if (!clan) return message.reply({ embeds: [embeds.error('You are not in a clan.')] });
      if (!isLeader(clan, message.author.id)) return message.reply({ embeds: [embeds.error('Only the clan leader can demote members.')] });

      const member = await helpers.resolveMember(message, args[0]);
      if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });

      const rank = rankOf(clan, member.id);
      if (!rank) return message.reply({ embeds: [embeds.error('That user is not in your clan.')] });
      if (rank === 'leader') return message.reply({ embeds: [embeds.error('The clan leader cannot be demoted.')] });
      if (rank !== 'coleader') return message.reply({ embeds: [embeds.error(`**${member.user.tag}** is not a co-leader.`)] });

      setMembership(guildId, clan, member.id, 'member');
      return message.reply({ embeds: [embeds.success(`**${member.user.tag}** is now a regular member of **${clan.name}**.`)] });
    },
  },

  {
    name: 'clan-members',
    aliases: [],
    description: 'List the members of your clan.',
    usage: '',
    cooldown: 5,
    async execute(message, args, client) {
      const clan = getUserClan(message.guild.id, message.author.id);
      if (!clan) return message.reply({ embeds: [embeds.error('You are not in a clan.')] });

      const ids = Object.keys(clan.members);
      const lines = ids.slice(0, 25).map((id) => `<@${id}> - ${RANK_LABEL[clan.members[id]] || 'Member'}`);
      if (ids.length > 25) lines.push(`*...and ${ids.length - 25} more member(s)*`);

      const counts = {};
      for (const id of ids) counts[clan.members[id]] = (counts[clan.members[id]] || 0) + 1;
      const summary = `**${ids.length}** member(s) - 👑 ${counts.leader || 0} - ⭐ ${counts.coleader || 0} - ${counts.member || 0}`;

      const embed = embeds.base(embeds.colors.primary).setTitle(`${clan.name} - members`).setDescription(lines.join('\n')).setFooter({ text: summary });
      return message.reply({ embeds: [embed] });
    },
  },

  {
    name: 'clan-leaderboard',
    aliases: [],
    description: 'Show the top clans of this server by points.',
    usage: '',
    cooldown: 10,
    async execute(message, args, client) {
      const clans = Object.values(getClans(message.guild.id));
      if (!clans.length) return message.reply({ embeds: [embeds.info('There are no clans in this server yet.')] });

      clans.sort((a, b) => (b.points || 0) - (a.points || 0) || (a.createdAt || 0) - (b.createdAt || 0));
      const medals = ['🥇', '🥈', '🥉'];
      const lines = clans.slice(0, 10).map((clan, index) => `${medals[index] || `**${index + 1}.**`} **${clan.name}** - ${clan.points || 0} points - ${memberCount(clan)} member(s)`);

      const embed = embeds.base(embeds.colors.primary).setTitle('Clan leaderboard').setDescription(lines.join('\n'));
      return message.reply({ embeds: [embed] });
    },
  },

  {
    name: 'clan-points',
    aliases: [],
    description: 'Show the points and level of a clan.',
    usage: '[clan name|id]',
    cooldown: 5,
    async execute(message, args, client) {
      const guildId = message.guild.id;
      const clan = args.length ? findClan(guildId, args.join(' '), true) : getUserClan(guildId, message.author.id);
      if (!clan) return message.reply({ embeds: [embeds.error(args.length ? 'I could not find that clan.' : 'You are not in a clan.')] });

      const level = Math.floor(clan.points / 100);
      const progress = clan.points % 100;
      const embed = embeds.base(embeds.colors.primary).setTitle(clan.name)
        .setDescription(`**${clan.points}** point(s)\n**Level ${level}** - ${progress}/100 to next level`)
        .addFields({ name: 'Members', value: String(memberCount(clan)), inline: true });
      return message.reply({ embeds: [embed] });
    },
  },

  {
    name: 'clan-addpoints',
    aliases: [],
    description: "Add (or remove) points from a member's clan.",
    usage: '<@user> <amount>',
    permissions: ['ManageGuild'],
    cooldown: 5,
    async execute(message, args, client) {
      if (!args[0] || !args[1]) return message.reply({ embeds: [helpers.usageError(client, message, 'clan-addpoints <@user> <amount>')] });

      const member = await helpers.resolveMember(message, args[0]);
      if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });

      const clan = getUserClan(message.guild.id, member.id);
      if (!clan) return message.reply({ embeds: [embeds.error(`**${member.user.tag}** is not in a clan.`)] });

      const amount = Number(args[1]);
      if (!Number.isInteger(amount) || amount === 0 || amount < -10000 || amount > 10000) return message.reply({ embeds: [embeds.error('The amount must be a whole number between **-10000** and **10000** (not 0).')] });

      clan.points = Math.max(0, clan.points + amount);
      saveClan(message.guild.id, clan);
      const direction = amount > 0 ? 'added to' : 'removed from';
      return message.reply({ embeds: [embeds.success(`**${Math.abs(amount)}** point(s) ${direction} clan **${clan.name}** - new total **${clan.points}**.`)] });
    },
  },

  {
    name: 'clan-setleader',
    aliases: [],
    description: 'Transfer leadership of your clan.',
    usage: '<@user>',
    cooldown: 15,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'clan-setleader <@user>')] });

      const guildId = message.guild.id;
      const clan = getUserClan(guildId, message.author.id);
      if (!clan) return message.reply({ embeds: [embeds.error('You are not in a clan.')] });
      if (!isLeader(clan, message.author.id)) return message.reply({ embeds: [embeds.error('Only the current clan leader can transfer leadership.')] });

      const member = await helpers.resolveMember(message, args[0]);
      if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });
      if (member.id === message.author.id) return message.reply({ embeds: [embeds.error('You are already the clan leader.')] });
      if (!rankOf(clan, member.id)) return message.reply({ embeds: [embeds.error('That user is not in your clan.')] });

      clan.members[message.author.id] = 'coleader';
      clan.members[member.id] = 'leader';
      clan.leaderId = member.id;
      saveClan(guildId, clan);
      await notify(member.user, embeds.success(`You are now the leader of clan **${clan.name}**!`));

      return message.reply({ embeds: [embeds.success(`Leadership of **${clan.name}** was transferred to **${member.user.tag}**.`)] });
    },
  },

  {
    name: 'clan-rename',
    aliases: [],
    description: 'Rename your clan.',
    usage: '<name>',
    cooldown: 30,
    async execute(message, args, client) {
      if (!args.length) return message.reply({ embeds: [helpers.usageError(client, message, 'clan-rename <name>')] });

      const guildId = message.guild.id;
      const clan = getUserClan(guildId, message.author.id);
      if (!clan) return message.reply({ embeds: [embeds.error('You are not in a clan.')] });
      if (!isLeader(clan, message.author.id)) return message.reply({ embeds: [embeds.error('Only the clan leader can rename the clan.')] });

      const check = validateName(args.join(' '));
      if (!check.ok) return message.reply({ embeds: [embeds.error(check.error)] });

      const previous = clan.name;
      clan.name = check.name;
      saveClan(guildId, clan);
      return message.reply({ embeds: [embeds.success(`Clan **${previous}** was renamed to **${clan.name}**.`)] });
    },
  },

  {
    name: 'clan-icon',
    aliases: [],
    description: 'Set or remove your clan icon.',
    usage: '<image url|off>',
    cooldown: 15,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'clan-icon <image url|off>')] });

      const guildId = message.guild.id;
      const clan = getUserClan(guildId, message.author.id);
      if (!clan) return message.reply({ embeds: [embeds.error('You are not in a clan.')] });
      if (!isLeader(clan, message.author.id)) return message.reply({ embeds: [embeds.error('Only the clan leader can change the clan icon.')] });

      const input = args.join(' ');
      if (input.toLowerCase() === 'off') {
        clan.icon = null;
        saveClan(guildId, clan);
        return message.reply({ embeds: [embeds.success(`The icon of clan **${clan.name}** was removed.`)] });
      }

      let url;
      try {
        url = new URL(input);
      } catch {
        return message.reply({ embeds: [embeds.error('That is not a valid URL - use a direct image link or `off`.')] });
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return message.reply({ embeds: [embeds.error('The image URL must start with `http://` or `https://`.')] });
      if (!/\.(png|jpe?g|gif|webp)$/i.test(url.pathname)) return message.reply({ embeds: [embeds.error('The URL must end in `.png`, `.jpg`, `.jpeg`, `.gif` or `.webp`.')] });

      clan.icon = url.href;
      saveClan(guildId, clan);
      return message.reply({ embeds: [embeds.success(`The icon of clan **${clan.name}** was updated.`).setThumbnail(url.href)] });
    },
  },

  {
    name: 'clan-search',
    aliases: [],
    description: 'Search clans by name.',
    usage: '<name>',
    cooldown: 10,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'clan-search <name>')] });

      const query = args.join(' ').toLowerCase();
      const matches = Object.values(getClans(message.guild.id)).filter((clan) => clan.name && clan.name.toLowerCase().includes(query));
      if (!matches.length) return message.reply({ embeds: [embeds.error(`No clans matched **${helpers.truncate(args.join(' '), 40)}**.`)] });

      const lines = matches.slice(0, 10).map((clan) => `**${clan.name}** - ${clan.id} - ${memberCount(clan)} member(s) - ${clan.points} points`);
      const embed = embeds.base(embeds.colors.info).setDescription(lines.join('\n')).setFooter({ text: `Showing ${lines.length} of ${matches.length} clan(s)` });
      return message.reply({ embeds: [embed] });
    },
  },

  {
    name: 'clan-reset',
    aliases: [],
    description: 'Disband a clan (staff command).',
    usage: '<clan name|id|@user>',
    permissions: ['ManageGuild'],
    cooldown: 15,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'clan-reset <clan name|id|@user>')] });

      const guildId = message.guild.id;
      const clan = await resolveClan(message, args.join(' '));
      if (!clan) return message.reply({ embeds: [embeds.error('I could not find that clan.')] });

      for (const userId of Object.keys(clan.members)) db.delete(`userClan.${guildId}.${userId}`);
      const count = memberCount(clan);
      deleteClan(guildId, clan.id);
      return message.reply({ embeds: [embeds.success(`Clan **${clan.name}** was disbanded - **${count}** member(s) removed.`)] });
    },
  },

  {
    name: 'clan-claim',
    aliases: [],
    description: 'Claim 10 points for your clan (once per 24h).',
    usage: '',
    cooldown: 25,
    async execute(message, args, client) {
      const guildId = message.guild.id;
      const clan = getUserClan(guildId, message.author.id);
      if (!clan) return message.reply({ embeds: [embeds.error('You are not in a clan.')] });

      const last = Number(db.get(`clanClaims.${guildId}.${message.author.id}`, 0)) || 0;
      const elapsed = Date.now() - last;
      if (last && elapsed < DAY_MS) return message.reply({ embeds: [embeds.error(`You already claimed today - come back in **${helpers.formatDuration(DAY_MS - elapsed)}**.`)] });

      clan.points += 10;
      saveClan(guildId, clan);
      db.set(`clanClaims.${guildId}.${message.author.id}`, Date.now());
      return message.reply({ embeds: [embeds.success(`Clan **${clan.name}** gained **10** points - new total **${clan.points}**. Come back in 24h!`)] });
    },
  },
];
