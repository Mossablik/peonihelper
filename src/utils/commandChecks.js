/* ------------------------------------------------------------------ *
 * Shared command gate for the slash front-end (src/handlers/slashHandler.js).
 *
 * Keeping owner / premium / permission / bot-permission / cooldown
 * checks in one place guarantees consistent behaviour everywhere.
 * ------------------------------------------------------------------ */

const embeds = require('./embed');
const perms = require('./permissions');
const premiumUtil = require('./premium');

/** Starts (or queries) the cooldown for a command. Returns remaining ms when on cooldown. */
function applyCooldown(client, command, userId) {
  const seconds = Number.isFinite(command.cooldown) ? command.cooldown : client.config.cooldownSeconds || 3;
  if (!seconds) return null;

  const key = `${command.name}:${userId}`;
  const now = Date.now();
  const until = client.cooldowns.get(key);
  if (until && until > now) return until - now;

  const max = client.config.maxCooldownSeconds || 60;
  client.cooldowns.set(key, now + Math.min(seconds, max) * 1000);
  setTimeout(() => client.cooldowns.delete(key), Math.min(seconds, max) * 1000 + 500).unref?.();
  return null;
}

/**
 * Verifies that `user` (with `member`) may run `command`.
 * @param {object} client
 * @param {object} command
 * @param {object} context  { member, user, channel, channelId, guildId, me }
 * @returns {{ ok: true } | { ok: false, code: string, embed: object, remaining?: number }}
 */
function verify(client, command, context = {}) {
  const { member, user, channel, guildId } = context;
  const isOwner = client.config.ownerIds.includes(user.id);

  if (command.ownerOnly && !isOwner) {
    return { ok: false, code: 'ownerOnly', embed: embeds.error('This command can only be used by the bot owner.') };
  }

  if (command.premium && !premiumUtil.isActive(guildId)) {
    return {
      ok: false,
      code: 'premium',
      embed: embeds.premium(
        '💎 This command is **premium only**. Activate a key with the `premium-activate` command. See `premium-info` for details.'
      ),
    };
  }

  if (command.permissions?.length && !perms.has(member, command.permissions, channel)) {
    return {
      ok: false,
      code: 'permissions',
      embed: embeds.error(`You need the following permission(s) to use this command: **${perms.missing(command.permissions)}**.`),
    };
  }

  const me = context.me || member?.guild?.members?.me;
  if (command.botPermissions?.length && !perms.has(me, command.botPermissions, channel)) {
    return {
      ok: false,
      code: 'botPermissions',
      embed: embeds.error(`I am missing the following permission(s): **${perms.missing(command.botPermissions)}**.`),
    };
  }

  if (!isOwner) {
    const remaining = applyCooldown(client, command, user.id);
    if (remaining) {
      return {
        ok: false,
        code: 'cooldown',
        remaining,
        embed: embeds.warn(`Slow down! Try again in **${(remaining / 1000).toFixed(1)}s**.`),
      };
    }
  }

  return { ok: true };
}

module.exports = { applyCooldown, verify };
