const embeds = require('../utils/embed');
const helpers = require('../utils/helpers');
const perms = require('../utils/permissions');

/* ------------------------------------------------------------------ *
 * Roles Commands (4)
 * addrole, removerole, roles, role-color
 * ------------------------------------------------------------------ */

module.exports = [
  {
    name: 'addrole',
    aliases: [],
    description: 'Add a role to one or more members.',
    usage: '<@role> <@user...>',
    permissions: ['ManageRoles'],
    botPermissions: ['ManageRoles'],
    cooldown: 5,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'addrole <@role> <@user...>')] });

      const role = await helpers.resolveRole(message, args[0]);
      if (!role) return message.reply({ embeds: [embeds.error('I could not find that role.')] });

      const check = perms.canManageRole(message.member, role);
      if (!check.ok) return message.reply({ embeds: [embeds.error(check.error)] });

      const members = message.mentions.members;
      if (!members || !members.size) {
        return message.reply({ embeds: [helpers.usageError(client, message, 'addrole <@role> <@user...>')] });
      }

      const results = [];
      let succeeded = 0;
      let failed = 0;
      for (const member of members.values()) {
        const done = await member.roles.add(role, `${message.author.tag} | addrole`).catch(() => null);
        if (done) {
          succeeded++;
          results.push(`✅ <@${member.id}>`);
        } else {
          failed++;
          results.push(`❌ <@${member.id}>`);
        }
      }

      const lines = [`**Role:** ${role}`, `**Added:** ${succeeded} • **Failed:** ${failed}`, '', ...results.slice(0, 15)];
      if (results.length > 15) lines.push(`…and ${results.length - 15} more.`);
      return message.reply({ embeds: [embeds.success(lines.join('\n'))] });
    },
  },

  {
    name: 'removerole',
    aliases: [],
    description: 'Remove a role from one or more members.',
    usage: '<@role> <@user...>',
    permissions: ['ManageRoles'],
    botPermissions: ['ManageRoles'],
    cooldown: 5,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, 'removerole <@role> <@user...>')] });

      const role = await helpers.resolveRole(message, args[0]);
      if (!role) return message.reply({ embeds: [embeds.error('I could not find that role.')] });

      const check = perms.canManageRole(message.member, role);
      if (!check.ok) return message.reply({ embeds: [embeds.error(check.error)] });

      const members = message.mentions.members;
      if (!members || !members.size) {
        return message.reply({ embeds: [helpers.usageError(client, message, 'removerole <@role> <@user...>')] });
      }

      const results = [];
      let succeeded = 0;
      let failed = 0;
      for (const member of members.values()) {
        if (!member.roles.cache.has(role.id)) {
          results.push(`➖ <@${member.id}> (did not have it)`);
          continue;
        }
        const done = await member.roles.remove(role, `${message.author.tag} | removerole`).catch(() => null);
        if (done) {
          succeeded++;
          results.push(`✅ <@${member.id}>`);
        } else {
          failed++;
          results.push(`❌ <@${member.id}>`);
        }
      }

      const lines = [`**Role:** ${role}`, `**Removed:** ${succeeded} • **Failed:** ${failed}`, '', ...results.slice(0, 15)];
      if (results.length > 15) lines.push(`…and ${results.length - 15} more.`);
      return message.reply({ embeds: [embeds.success(lines.join('\n'))] });
    },
  },

  {
    name: 'roles',
    aliases: [],
    description: 'List every role in this server.',
    usage: '',
    cooldown: 5,
    async execute(message, args, client) {
      const roles = [...message.guild.roles.cache.values()].sort((a, b) => b.position - a.position);
      if (!roles.length) return message.reply({ embeds: [embeds.info('This server has no roles.')] });

      const lines = roles.map((role) => `${role.position} - ${role} (${role.members.size} members)`);
      const pages = helpers.chunk(lines, 15).slice(0, 10);

      const embed = embeds.base(embeds.colors.primary).setTitle(`Roles in ${message.guild.name}`);
      pages.forEach((page, index) => {
        embed.addFields({ name: `Roles (page ${index + 1})`, value: page.join('\n') || '—', inline: false });
      });

      const totalFields = helpers.chunk(lines, 15).length;
      if (totalFields > 10) {
        embed.setFooter({ text: `Showing the first ${pages.length * 15} of ${roles.length} roles - use roleinfo for details.` });
      } else {
        embed.setFooter({ text: `${roles.length} role(s) in this server` });
      }

      return message.reply({ embeds: [embed] });
    },
  },

  {
    name: 'role-color',
    aliases: [],
    description: "Change a role's colour.",
    usage: '<@role> <#hex|reset>',
    permissions: ['ManageRoles'],
    botPermissions: ['ManageRoles'],
    cooldown: 5,
    async execute(message, args, client) {
      if (!args[0] || !args[1]) return message.reply({ embeds: [helpers.usageError(client, message, 'role-color <@role> <#hex|reset>')] });

      const role = await helpers.resolveRole(message, args[0]);
      if (!role) return message.reply({ embeds: [embeds.error('I could not find that role.')] });

      const check = perms.canManageRole(message.member, role);
      if (!check.ok) return message.reply({ embeds: [embeds.error(check.error)] });

      const input = args[1].toLowerCase();
      let color;
      if (input === 'reset') {
        color = '#000000';
      } else if (/^#?[0-9a-f]{6}$/.test(input)) {
        color = `#${input.replace('#', '')}`;
      } else {
        return message.reply({ embeds: [embeds.error('Please provide a valid colour like `#ff0000`, or `reset`.')] });
      }

      try {
        await role.setColor(color, `${message.author.tag} | role-color`);
      } catch (err) {
        return message.reply({ embeds: [embeds.error(`I could not change that role's colour: ${err.message}`)] });
      }

      return message.reply({ embeds: [embeds.success(`Colour of ${role} set to **${color}**.`)] });
    },
  },
];
