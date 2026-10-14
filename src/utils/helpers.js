/* ------------------------------------------------------------------ *
 * Small shared helpers used by the commands.
 * ------------------------------------------------------------------ */

const db = require('./database');
const embeds = require('./embed');

const MENTION_REGEX = /<@!?(\d{17,20})>/;
const CHANNEL_MENTION_REGEX = /<#(\d{17,20})>/;
const ROLE_MENTION_REGEX = /<@&(\d{17,20})>/;

/** Splits a command line into args, keeping "quoted strings" together. */
function splitArgs(input) {
  const args = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = regex.exec(input)) !== null) {
    args.push(match[1] ?? match[2] ?? match[3]);
  }
  return args;
}

/** Parses "1d2h3m30s" (also plain numbers = milliseconds) into milliseconds. */
function parseDuration(input) {
  if (!input) return null;
  if (typeof input === 'number') return input > 0 ? input : null;
  const text = String(input).toLowerCase().trim();
  if (/^\d+$/.test(text)) {
    const raw = Number(text);
    return raw > 0 ? raw : null;
  }
  const regex = /(\d+)\s*(d|h|m|s|w)/g;
  let total = 0;
  let matched = false;
  let match;
  while ((match = regex.exec(text)) !== null) {
    matched = true;
    const value = Number(match[1]);
    total += value * { w: 604800000, d: 86400000, h: 3600000, m: 60000, s: 1000 }[match[2]];
  }
  return matched && total > 0 ? total : null;
}

/** Turns milliseconds into a readable string like "2h 30m". */
function formatDuration(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '0s';
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const units = [
    ['w', 604800],
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
    ['s', 1],
  ];
  const parts = [];
  let rest = seconds;
  for (const [label, size] of units) {
    const amount = Math.floor(rest / size);
    if (amount > 0) parts.push(`${amount}${label}`);
    rest %= size;
    if (parts.length >= 3) break;
  }
  return parts.length ? parts.join(' ') : '0s';
}

/** Formats a unix timestamp (ms) for embeds. */
function formatStamp(dateOrMs, style = 'F') {
  const ms = typeof dateOrMs === 'number' ? dateOrMs : new Date(dateOrMs).getTime();
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function truncate(text, limit = 200) {
  const str = String(text ?? '');
  return str.length > limit ? `${str.slice(0, limit - 1)}…` : str;
}

function isSnowflake(value) {
  return /^\d{17,20}$/.test(String(value || '').trim());
}

/** Resolves a guild member from an id or mention. Returns null when not found. */
async function resolveMember(message, input) {
  if (!input || !message.guild) return null;
  const mentionMatch = String(input).match(MENTION_REGEX);
  if (mentionMatch) {
    return message.mentions.members?.get(mentionMatch[1]) || (await message.guild.members.fetch(mentionMatch[1]).catch(() => null));
  }
  const id = String(input).trim();
  if (!isSnowflake(id)) return null;
  if (message.mentions.members?.size) {
    const mentioned = message.mentions.members.find((m) => m.id === id);
    if (mentioned) return mentioned;
  }
  return (await message.guild.members.fetch(id).catch(() => null)) || null;
}

/** Resolves a channel from an id or mention. Returns null when not found. */
async function resolveChannel(message, input) {
  if (!input || !message.guild) return null;
  const match = String(input).match(CHANNEL_MENTION_REGEX);
  const id = match ? match[1] : String(input).trim();
  if (!isSnowflake(id)) return null;
  return (await message.guild.channels.fetch(id).catch(() => null)) || null;
}

/** Resolves a role from an id, mention or (partial) name. Returns null when not found. */
async function resolveRole(message, input) {
  if (!input || !message.guild) return null;
  const match = String(input).match(ROLE_MENTION_REGEX);
  if (match) return message.guild.roles.cache.get(match[1]) || (await message.guild.roles.fetch(match[1]).catch(() => null));

  const id = String(input).trim();
  if (isSnowflake(id)) return message.guild.roles.cache.get(id) || (await message.guild.roles.fetch(id).catch(() => null));

  const lower = id.toLowerCase();
  return (
    message.guild.roles.cache.find((role) => role.name.toLowerCase() === lower) ||
    message.guild.roles.cache.find((role) => role.name.toLowerCase().includes(lower)) ||
    null
  );
}

/** Resolves a user from an id or mention (works outside the guild too). */
async function resolveUser(message, input, client) {
  if (!input) return null;
  const match = String(input).match(MENTION_REGEX);
  const id = match ? match[1] : String(input).trim();
  if (!isSnowflake(id)) return null;
  if (client?.users?.cache?.has(id)) return client.users.cache.get(id);
  return (await client.users.fetch(id).catch(() => null)) || null;
}

/** Removes "<@!?>", "<@&>" and "<#>" characters from a string. */
function cleanMentions(text) {
  return String(text ?? '').replace(/<@!?\d+>|<@&\d+>|<#\d+>/g, '');
}

/** Slash invocation of a setup command by name, e.g. "/verify-setup". */
function commandPath(client, name) {
  return client?.slashPaths?.get(name) || `/${name}`;
}

/** Effective prefix for a guild. */
function getPrefix(client, message) {
  const guildData = message?.guild ? db.getGuild(message.guild.id) : null;
  return (guildData && guildData.prefix) || client.config.prefix;
}

/**
 * Standard usage error embed, rendered with the prefix syntax.
 * @param {string} usageText  Full usage string, e.g. "ban <@user|id> [reason]"
 * @param {string} [hint]     Optional extra hint shown below the usage.
 */
function usageError(client, message, usageText, hint) {
  const prefix = getPrefix(client, message);
  const body = hint ? `**Usage:** \`${prefix}${usageText}\`\n${hint}` : `**Usage:** \`${prefix}${usageText}\``;
  return embeds.error(body, 'Invalid arguments');
}

module.exports = {
  splitArgs,
  parseDuration,
  formatDuration,
  formatStamp,
  randInt,
  pick,
  shuffle,
  chunk,
  truncate,
  isSnowflake,
  resolveMember,
  resolveChannel,
  resolveRole,
  resolveUser,
  cleanMentions,
  commandPath,
  getPrefix,
  usageError,
};
