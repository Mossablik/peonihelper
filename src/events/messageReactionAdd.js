const db = require('../utils/database');
const embeds = require('../utils/embed');
const helpers = require('../utils/helpers');

/* ------------------------------------------------------------------ *
 * Starboard + reaction roles.
 *   guilds.<guildId>.starboard       = { channelId, threshold }
 *   starred.<guildId>.<messageId>    = starboard message id
 *   guilds.<guildId>.reactionroles   = { <messageId>: { <emojiKey>: roleId } }
 * ------------------------------------------------------------------ */

const STAR = '⭐';

function isImage(attachment) {
  if (!attachment) return false;
  if (attachment.contentType && attachment.contentType.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp)(\?|$)/i.test(attachment.url || '');
}

function buildStarboardEmbed(reaction) {
  const message = reaction.message;
  const parts = [];
  if (message.content) parts.push(helpers.truncate(message.content, 1000));
  parts.push(`[Jump](${message.url})`);

  const embed = embeds
    .base(embeds.colors.premium)
    .setTitle('⭐ Starboard')
    .setDescription(helpers.truncate(parts.join('\n\n'), 4000))
    .setFooter({ text: `${reaction.count} stars • #${message.channel?.name || 'unknown'}` })
    .setTimestamp(message.createdTimestamp || null);

  if (message.author) {
    embed.setAuthor({
      name: message.author.tag,
      iconURL: message.author.displayAvatarURL({ size: 64 }),
    });
  }

  const attachment = message.attachments.first();
  if (isImage(attachment)) embed.setImage(attachment.url);

  return embed;
}

async function handleStarboard(client, reaction) {
  const message = reaction.message;
  const guildId = message.guild.id;
  if (reaction.emoji.name !== STAR) return;

  const starboard = db.get(`guilds.${guildId}.starboard`);
  if (!starboard || !starboard.channelId || !starboard.threshold) return;
  if (message.channel.id === starboard.channelId) return;
  if ((reaction.count || 0) < starboard.threshold) return;

  const channel = await client.channels.fetch(starboard.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const content = `${reaction.count} ${STAR}`;
  const embed = buildStarboardEmbed(reaction);
  const starKey = `starred.${guildId}.${message.id}`;
  const existingId = db.get(starKey, null);

  // Already posted -> just update the star count instead of duplicating.
  if (existingId) {
    const existing = await channel.messages.fetch(existingId).catch(() => null);
    if (existing) {
      await existing.edit({ content, embeds: [embed] }).catch(() => {});
      return;
    }
  }

  const sent = await channel.send({ content, embeds: [embed] }).catch(() => null);
  if (sent) db.set(starKey, sent.id);
}

async function handleReactionRole(reaction, user) {
  const message = reaction.message;
  const guildId = message.guild.id;

  const mapping = db.get(`guilds.${guildId}.reactionroles.${message.id}`, null);
  if (!mapping || typeof mapping !== 'object') return;

  const emojiKey = reaction.emoji.id || reaction.emoji.name;
  const roleId = mapping[emojiKey];
  if (!roleId) return;

  const member = await message.guild.members.fetch(user.id).catch(() => null);
  if (!member) return;

  const role =
    message.guild.roles.cache.get(roleId) || (await message.guild.roles.fetch(roleId).catch(() => null));
  if (!role) return;
  if (role.managed || role.id === message.guild.roles.everyone.id) return;

  const me = message.guild.members.me;
  if (me && role.position >= me.roles.highest.position) return;

  if (member.roles.cache.has(role.id)) return;
  await member.roles.add(role).catch(() => {});
}

module.exports = {
  name: 'messageReactionAdd',
  once: false,
  async execute(client, reaction, user) {
    try {
      if (reaction.partial) {
        try {
          await reaction.fetch();
        } catch {
          return;
        }
      }
      if (reaction.message?.partial) {
        try {
          await reaction.message.fetch();
        } catch {
          return;
        }
      }

      if (!user || user.bot) return;
      if (!reaction.message?.guild) return;

      await handleStarboard(client, reaction).catch((err) => console.error('[starboard]', err));
      await handleReactionRole(reaction, user).catch((err) => console.error('[reactionrole]', err));
    } catch (err) {
      console.error('[messageReactionAdd]', err);
    }
  },
};
