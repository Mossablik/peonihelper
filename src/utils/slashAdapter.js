/* ------------------------------------------------------------------ *
 * Slash adapter.
 *
 * Turns a slash command interaction into the exact `(message, args)`
 * pair the existing commands already expect, so every command works
 * through BOTH front-ends without any code changes:
 *
 *   /moderation ban user:@x reason:spam
 *        |
 *        +-> message = pseudo message (author, member, mentions, reply, ...)
 *        +-> args    = ['<@1234>', 'spam']   (what "!ban <@1234> spam" produces)
 *
 * Mentions resolved by Discord (users, roles, channels) are injected into
 * `message.mentions`, because commands such as massban / addrole read the
 * member list from there.
 * ------------------------------------------------------------------ */

const { Collection } = require('discord.js');
const helpers = require('./helpers');

const MENTION_REGEX = /<@!?(\d{17,20})>/;

function readOption(interaction, opt) {
  try {
    switch (opt.kind) {
      case 'user':
        return interaction.options.getUser(opt.name) ?? undefined;
      case 'role':
        return interaction.options.getRole(opt.name) ?? undefined;
      case 'channel':
        return interaction.options.getChannel(opt.name) ?? undefined;
      case 'integer':
        return interaction.options.getInteger?.(opt.name) ?? undefined;
      default:
        return interaction.options.getString(opt.name) ?? undefined;
    }
  } catch {
    return undefined;
  }
}

/** Looks up a guild member from cache or the API. */
async function collectMember(interaction, userId) {
  const guild = interaction.guild;
  if (!guild) return null;
  return (
    guild.members.cache.get(userId) || (await guild.members.fetch(userId).catch(() => null)) || null
  );
}

/**
 * Rebuilds the (message, args) argument list from the resolved slash options.
 * @returns {{ args: string[], mentions: { members: Collection, users: Collection, roles: Collection, channels: Collection } }}
 */
async function buildArgs(interaction, optionSpecs = []) {
  const args = [];
  const mentions = {
    members: new Collection(),
    users: new Collection(),
    roles: new Collection(),
    channels: new Collection(),
  };

  for (let i = 0; i < optionSpecs.length; i++) {
    const opt = optionSpecs[i];

    // Pipe groups ("title | description | colour") become ONE argument.
    if (opt.pipe) {
      const parts = [];
      while (i < optionSpecs.length && optionSpecs[i].pipe) {
        const value = readOption(interaction, optionSpecs[i]);
        if (value !== undefined && value !== null && String(value).trim()) parts.push(String(value).trim());
        i++;
      }
      i--;
      if (parts.length) args.push(parts.join(' | '));
      continue;
    }

    const value = readOption(interaction, opt);
    if (value === undefined || value === null) continue;

    if (opt.kind === 'user') {
      args.push(`<@${value.id}>`);
      mentions.users.set(value.id, value);
      const member = (typeof interaction.options.getMember === 'function' && interaction.options.getMember(opt.name)) || (await collectMember(interaction, value.id));
      if (member) mentions.members.set(member.id, member);
    } else if (opt.kind === 'users') {
      for (const token of String(value).split(/\s+/).filter(Boolean)) {
        args.push(token);
        const match = token.match(MENTION_REGEX);
        const userId = match ? match[1] : helpers.isSnowflake(token) ? token.trim() : null;
        if (!userId) continue;
        const member = await collectMember(interaction, userId);
        if (member) {
          mentions.members.set(member.id, member);
          mentions.users.set(member.id, member.user);
        }
      }
    } else if (opt.kind === 'role') {
      args.push(`<@&${value.id}>`);
      mentions.roles.set(value.id, value);
    } else if (opt.kind === 'channel') {
      args.push(`<#${value.id}>`);
      mentions.channels.set(value.id, value);
    } else {
      args.push(String(value));
    }
  }

  return { args, mentions };
}

/**
 * Builds a message-like object around a slash interaction.
 * The first `message.reply(...)` becomes the deferred response, later ones
 * become follow-ups; `edit` targets the deferred response.
 */
function buildMessage(interaction, args, mentions) {
  let replied = false;

  const proxy = () => ({
    id: interaction.id,
    createdTimestamp: Date.now(),
    edit: (payload) => interaction.editReply(payload),
    delete: async () => {
      try {
        await interaction.deleteReply();
      } catch {
        /* ignore */
      }
    },
    react: async () => null,
    pin: async () => null,
  });

  return {
    id: interaction.id,
    content: `/${interaction.commandName || 'command'}`,
    author: interaction.user,
    member: interaction.member,
    guild: interaction.guild,
    channel: interaction.channel,
    client: interaction.client,
    createdAt: new Date(interaction.createdTimestamp || Date.now()),
    createdTimestamp: interaction.createdTimestamp || Date.now(),
    mentions: { ...mentions, repliedUser: null, has: () => false, first: () => null },
    reply: async (payload) => {
      if (!replied) {
        replied = true;
        await interaction.editReply(payload);
      } else {
        await interaction.followUp(payload);
      }
      return proxy();
    },
    edit: (payload) => interaction.editReply(payload),
    delete: async () => {
      /* slash commands leave no message behind */
    },
    react: async () => null,
    pin: async () => null,
    args,
  };
}

module.exports = { buildArgs, buildMessage };
