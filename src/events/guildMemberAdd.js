const db = require('../utils/database');
const embeds = require('../utils/embed');
const premiumUtil = require('../utils/premium');

/** Welcome messages + autorole (premium feature). */
module.exports = {
  name: 'guildMemberAdd',
  async execute(client, member) {
    const settings = db.get(`guilds.${member.guild.id}.welcome`);
    if (!settings) return;

    // Welcome/auto-role is a premium perk.
    if (!premiumUtil.isActive(member.guild.id)) return;

    if (settings.autorole) {
      const role = member.guild.roles.cache.get(settings.autorole);
      if (role && role.editable && !role.managed) {
        await member.roles.add(role).catch(() => {});
      }
    }

    if (settings.channelId && settings.message) {
      const channel = await member.guild.channels.fetch(settings.channelId).catch(() => null);
      if (channel && channel.isTextBased()) {
        const text = settings.message
          .replaceAll('{user}', member.toString())
          .replaceAll('{server}', member.guild.name)
          .replaceAll('{count}', String(member.guild.memberCount));
        await channel.send({ embeds: [embeds.info(text, `Welcome to ${member.guild.name}!`)] }).catch(() => {});
      }
    }
  },
};
