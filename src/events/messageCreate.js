const db = require('../utils/database');
const embeds = require('../utils/embed');
const helpers = require('../utils/helpers');
const commandChecks = require('../utils/commandChecks');

/* ------------------------------------------------------------------ *
 * Message events: the PREFIX front-end.
 *
 * Parses "<prefix><command> <args...>" (or "<@bot> <command> ...") and
 * runs the command through the shared gate (commandChecks). The AFK
 * system also reacts to regular messages.
 * ------------------------------------------------------------------ */

function handleAfk(client, message) {
  const baseKey = `afk.${message.guild.id}`;

  // Mentioned users who are AFK
  for (const member of message.mentions.members?.values() || []) {
    const entry = db.get(`${baseKey}.${member.id}`);
    if (!entry) continue;
    message
      .reply({ embeds: [embeds.info(`**${member.user.tag}** is AFK: ${helpers.truncate(entry.reason, 100)} (${helpers.formatStamp(entry.since)}).`)] })
      .then((msg) => setTimeout(() => msg.delete().catch(() => {}), 8000))
      .catch(() => {});
  }

  // Author who is no longer AFK
  const own = db.get(`${baseKey}.${message.author.id}`);
  if (own) {
    db.delete(`${baseKey}.${message.author.id}`);
    const awayFor = helpers.formatDuration(Date.now() - (own.since || Date.now()));
    message
      .reply({ embeds: [embeds.success(`Welcome back! You were AFK for **${awayFor}**.`)] })
      .then((msg) => setTimeout(() => msg.delete().catch(() => {}), 8000))
      .catch(() => {});
  }
}

module.exports = {
  name: 'messageCreate',
  async execute(client, message) {
    if (message.author.bot || !message.guild) return;

    handleAfk(client, message);

    const prefix = helpers.getPrefix(client, message);

    const startsWithPrefix = message.content.startsWith(prefix);
    const isMention = Boolean(message.mentions.has?.(client.user));
    if (!startsWithPrefix && !isMention) return;

    // Strip the prefix (or the mention) and split into args.
    let content = message.content;
    if (startsWithPrefix) content = content.slice(prefix.length);
    else content = content.replace(new RegExp(`^<@!?${client.user.id}>\\s*`), '');

    const args = content.trim().split(/\s+/).filter(Boolean);
    const name = (args.shift() || '').toLowerCase();

    // Bare prefix or bare mention -> short hint.
    if (!name) {
      if (isMention) {
        message.reply({ embeds: [embeds.info(`The prefix of this server is \`${prefix}\`. Type \`${prefix}help\` to see all commands.`)] }).catch(() => {});
      }
      return;
    }

    const command = client.commands.get(name) || client.aliases.get(name);
    if (!command) return; // unknown command: stay silent

    // Shared gate (owner, premium, permissions, bot-permissions, cooldown).
    const check = commandChecks.verify(client, command, {
      member: message.member,
      user: message.author,
      channel: message.channel,
      channelId: message.channel?.id,
      guildId: message.guild?.id,
      me: message.guild?.members?.me,
    });
    if (!check.ok) return message.reply({ embeds: [check.embed] }).catch(() => {});

    try {
      await command.execute(message, args, client);
    } catch (err) {
      console.error(`[helper] Command ${command.name} failed:`, err);
      message
        .reply({ embeds: [embeds.error('Something went wrong while running that command. The error has been logged.')] })
        .catch(() => {});
    }
  },
};
