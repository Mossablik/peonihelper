const { PermissionFlagsBits } = require('discord.js');

const READABLE = Object.fromEntries(
  Object.keys(PermissionFlagsBits).map((key) => [key, key.replace(/([A-Z])/g, ' $1').trim()])
);

/**
 * Checks permissions for a member.
 * @param {import('discord.js').GuildMember} member
 * @param {string[]} perms  PermissionFlagsBits key names, e.g. ['BanMembers']
 * @param {import('discord.js').GuildChannel} [channel]  Check channel overwrites too.
 */
function has(member, perms, channel = null) {
  if (!member || !perms) return true;
  const list = Array.isArray(perms) ? perms : [perms];
  if (list.length === 0) return true;
  const source = channel ? channel.permissionsFor(member) : member.permissions;
  if (!source) return false;
  return source.has(list.map((perm) => PermissionFlagsBits[perm]).filter(Boolean));
}

/** Turns permission key names into readable labels, e.g. "Ban Members". */
function missing(perms) {
  const list = Array.isArray(perms) ? perms : [perms];
  return list.map((perm) => READABLE[perm] || perm).join(', ');
}

/**
 * Can `actor` moderate `target`? Returns { ok, error }.
 * Checks guild ownership, role hierarchy and the bot's own role position.
 */
function canModerate(actor, target) {
  const guild = actor.guild;
  if (!guild) return { ok: false, error: 'This command can only be used in a server.' };

  if (target.id === guild.ownerId) {
    return { ok: false, error: 'That member owns this server.' };
  }
  if (target.id === actor.id) {
    return { ok: false, error: 'You cannot use this on yourself.' };
  }
  if (actor.id !== guild.ownerId && target.roles.highest.position >= actor.roles.highest.position) {
    return { ok: false, error: 'Their highest role is higher than (or equal to) yours.' };
  }

  const me = guild.members.me;
  if (me && target.roles.highest.position >= me.roles.highest.position) {
    return { ok: false, error: 'My highest role is lower than theirs, so I cannot touch that member.' };
  }

  return { ok: true, error: null };
}

/** Same hierarchy check, but for roles. */
function canManageRole(actor, role) {
  const guild = actor.guild;
  const me = guild?.members?.me || null;

  if (role.id === guild.roles.everyone.id) return { ok: false, error: 'That is the @everyone role.' };
  if (role.managed) return { ok: false, error: 'That role is managed by an integration and cannot be assigned.' };
  if (me && role.position >= me.roles.highest.position) {
    return { ok: false, error: 'That role is higher than (or equal to) my highest role.' };
  }
  if (actor.id !== guild.ownerId && role.position >= actor.roles.highest.position) {
    return { ok: false, error: 'That role is higher than (or equal to) your highest role.' };
  }
  return { ok: true, error: null };
}

module.exports = { has, missing, canModerate, canManageRole, READABLE };
