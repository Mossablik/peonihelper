const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const db = require('../utils/database');
const embeds = require('../utils/embed');
const helpers = require('../utils/helpers');
const perms = require('../utils/permissions');
const interactions = require('../utils/interactions');

/* ------------------------------------------------------------------ *
 * Apply Commands (4)
 * apply-setup, apply, apply-role, apply-review
 *
 * The panel lists the staff positions with one button each. Pressing a
 * button opens a modal form tailored to that position (name, age,
 * experience, motivation, daily availability). The submitted form is
 * posted to the review channel where staff can accept or deny it with
 * buttons. On approval the position's role (apply-role) is granted.
 * ------------------------------------------------------------------ */

/** The staff positions shown on the panel, each with its own form. */
const POSITIONS = [
  { slug: 'staff-team', emoji: '🛡️', name: 'Staff Team', blurb: 'Moderate chats and help keep the server safe.' },
  { slug: 'event-hoster', emoji: '🎉', name: 'Event Hoster', blurb: 'Plan and run fun events for the community.' },
  { slug: 'designer', emoji: '🎨', name: 'Designer', blurb: 'Design banners, icons, and graphics for the server.' },
  { slug: 'partnership', emoji: '🤝', name: 'Partnership', blurb: 'Handle partnerships and server collaborations.' },
  { slug: 'developer', emoji: '💻', name: 'Developer', blurb: "Build and maintain the server's bots and tools." },
];

const PENDING_COOLDOWN = 24 * 3600000;

function config(guildId) {
  return db.getGuild(guildId).apply;
}

function positionBySlug(slug) {
  return POSITIONS.find((position) => position.slug === slug) || null;
}

/** Accepts a slug ("staff-team") or a name ("Staff Team"). */
function resolvePosition(input) {
  const lower = String(input || '').toLowerCase().trim();
  return POSITIONS.find((position) => position.slug === lower || position.name.toLowerCase() === lower) || null;
}

function warningLine(guild) {
  return `⚠️ **This form will be submitted to ${guild.name}.** Do not share passwords or other sensitive information.`;
}

function pendingEntry(guildId, userId) {
  const stored = db.get(`applies.${guildId}.${userId}`);
  return stored && Date.now() - (stored.at || 0) < PENDING_COOLDOWN ? stored : null;
}

/** The panel embed: the position list, instructions and the warning. */
function panelEmbed(guild) {
  const list = POSITIONS.map((position) => `• ${position.emoji} **${position.name}**: *${position.blurb}*`).join('\n');

  return embeds
    .base(embeds.colors.primary)
    .setTitle('Staff Applications')
    .setDescription(
      `${list}\n\n` +
        `**How to apply:** pick your position below - the application form opens right away. All fields are required.\n\n` +
        warningLine(guild)
    )
    .setFooter({ text: 'Applications are reviewed by the staff team' });
}

/** The two button rows of the panel (3 + 2 positions). */
function panelComponents() {
  const buttonFor = (position) =>
    new ButtonBuilder().setCustomId(`apply:pos:${position.slug}`).setLabel(position.name).setStyle(ButtonStyle.Secondary);

  return [
    new ActionRowBuilder().addComponents(...POSITIONS.slice(0, 3).map(buttonFor)),
    new ActionRowBuilder().addComponents(...POSITIONS.slice(3).map(buttonFor)),
  ];
}

/** The modal form for one position. */
function buildModal(position) {
  const modal = new ModalBuilder()
    .setCustomId(`apply:modal:${position.slug}`)
    .setTitle(helpers.truncate(`${position.name} application`, 45));

  const fields = [
    { id: 'name', label: 'What is your name?', style: TextInputStyle.Short, placeholder: 'Your name' },
    { id: 'age', label: 'How old are you?', style: TextInputStyle.Short, placeholder: 'e.g. 17' },
    { id: 'experience', label: `Relevant experience for ${position.name}?`, style: TextInputStyle.Paragraph, placeholder: 'Tell us about your experience' },
    { id: 'why', label: `Why do you want to be ${position.name}?`, style: TextInputStyle.Paragraph, placeholder: 'Tell us why you want to join' },
    { id: 'availability', label: 'Daily availability (hours)?', style: TextInputStyle.Short, placeholder: 'e.g. 7' },
  ];

  for (const field of fields) {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(field.id)
          .setLabel(helpers.truncate(field.label, 45))
          .setStyle(field.style)
          .setPlaceholder(helpers.truncate(field.placeholder, 100))
          .setRequired(true)
          .setMaxLength(field.style === TextInputStyle.Paragraph ? 1000 : 100)
      )
    );
  }

  return modal;
}

/** The minimum age required to apply (shown in the log embed). */
const AGE_MIN = 15;
const AGE_MAX = 120;

/** Returns an error message when the submitted answers are not acceptable. */
function validateAnswers(values) {
  if (!String(values.name || '').trim()) return '**What is your name?** is required - please fill it in and submit again.';

  const age = String(values.age || '').trim();
  if (!/^\d{1,3}$/.test(age) || Number(age) < AGE_MIN || Number(age) > AGE_MAX) {
    return `Please enter a valid age between **${AGE_MIN}** and **${AGE_MAX}** in **How old are you?**.`;
  }

  if (!String(values.experience || '').trim()) return '**Relevant experience** is required - please fill it in and submit again.';
  if (!String(values.why || '').trim()) return '**Why do you want this position?** is required - please fill it in and submit again.';

  const availability = String(values.availability || '').trim();
  if (!/^\d{1,3}$/.test(availability) || Number(availability) < 1 || Number(availability) > 168) {
    return 'Please enter your daily availability as a number of hours between **1** and **168** (e.g. `7`).';
  }

  return null;
}

/** Turns a multi-line answer into a Discord blockquote. */
function quote(text) {
  const lines = String(text).trim().split('\n').map((line) => line.trimEnd());
  return lines.map((line) => `> ${line || '>'}`).join('\n');
}

/**
 * Delivers the answers to the review channel with accept/deny buttons and
 * stores them for `apply-review`. Returns { ok, error? }.
 */
async function submitApplication(user, guild, position, values) {
  const cfg = config(guild.id);

  const review = guild.channels.cache.get(cfg.reviewChannelId) || (await guild.channels.fetch(cfg.reviewChannelId).catch(() => null));
  if (!review || !review.isTextBased()) {
    return { ok: false, error: 'The staff review channel does not exist anymore, so your application could not be delivered.' };
  }

  const submittedAt = Math.floor(Date.now() / 1000);
  const managerRoleId = cfg.managerRoleId;

  const embed = embeds
    .base(embeds.colors.info)
    .setTitle(`New ${position.name} application`)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: `Applicant: ${user.tag} • ${user.id}` })
    .setTimestamp()
    .addFields(
      { name: '🔮 __Applicant:__', value: `<@${user.id}> (\`${user.id}\`)`, inline: false },
      { name: '🔮 __Full Name:__', value: helpers.truncate(String(values.name).trim(), 1024) || '*(empty)*', inline: false },
      { name: '🔮 __Applied Position:__', value: `${position.emoji} \`${position.name}\``, inline: false },
      { name: '🔮 __Age:__', value: `${helpers.truncate(String(values.age).trim(), 1024)} *(Requirement: ${AGE_MIN}+)*`, inline: false },
      { name: '🔮 __Daily Availability:__', value: helpers.truncate(String(values.availability).trim(), 1024), inline: false },
      { name: '🔮 __Submitted At:__', value: `<t:${submittedAt}:R>`, inline: false },
      { name: '__Previous Experience:__', value: helpers.truncate(quote(values.experience), 1024), inline: false },
      { name: '__Why You Want This Role:__', value: helpers.truncate(quote(values.why), 1024), inline: false }
    );

  if (managerRoleId) {
    embed.addFields({ name: '🔮 __Attention Managers:__', value: `<@&${managerRoleId}>`, inline: false });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`apply:approve:${user.id}`).setLabel('Accept').setStyle(ButtonStyle.Success).setEmoji('✅'),
    new ButtonBuilder().setCustomId(`apply:deny:${user.id}`).setLabel('Refuse').setStyle(ButtonStyle.Danger).setEmoji('❌')
  );

  // parse: [] keeps the manager mention purely visual - it renders as a
  // role chip but never notifies anyone.
  const sent = await review
    .send({ content: managerRoleId ? `<@&${managerRoleId}>` : undefined, embeds: [embed], components: [row], allowedMentions: { parse: [] } })
    .catch(() => null);
  if (!sent) return { ok: false, error: 'Your application could not be delivered to the staff team. Please contact an administrator.' };

  db.set(`applies.${guild.id}.${user.id}`, {
    at: Date.now(),
    username: user.tag,
    position: position.slug,
    answers: { name: values.name, age: values.age, experience: values.experience, why: values.why, availability: values.availability },
  });
  await user.send({ embeds: [embeds.success(`Your **${guild.name}** application for **${position.name}** was submitted. The staff team will review it soon.`)] }).catch(() => {});
  return { ok: true };
}

/**
 * Approves or denies a stored application: role add (approve only), cleanup
 * and DM to the applicant. Returns { ok, error?, stored? }.
 */
async function finalizeApplication(guild, member, approve, reason, moderatorTag) {
  const cfg = config(guild.id);
  const stored = db.get(`applies.${guild.id}.${member.id}`);

  if (approve && stored?.position) {
    const roleId = cfg.roles?.[stored.position];
    if (roleId) {
      const added = await member.roles.add(roleId, `Staff application approved by ${moderatorTag}`).catch(() => null);
      if (!added) return { ok: false, error: 'I could not add the position role - check my role position.' };
    }
  }

  db.delete(`applies.${guild.id}.${member.id}`);

  const embed = approve
    ? embeds.success(`Congratulations! Your application to join the **${guild.name}** staff team was **accepted**.${reason ? `\n**Reason:** ${reason}` : ''}`, 'Application approved')
    : embeds.error(`Your application to join the **${guild.name}** staff team was **rejected**.${reason ? `\n**Reason:** ${reason}` : ''}`, 'Application denied');
  await member.send({ embeds: [embed] }).catch(() => {});

  return { ok: true, stored };
}

/* ---------------------------- commands ----------------------------- */

module.exports = [
  {
    name: 'apply-setup',
    aliases: [],
    description: 'Post the staff application panel and set the log channel + manager role.',
    usage: '[#review-channel] [@manager-role]',
    permissions: ['ManageGuild'],
    botPermissions: ['SendMessages', 'EmbedLinks'],
    cooldown: 5,
    async execute(message, args, client) {
      let review = message.channel;
      if (args[0]) {
        review = await helpers.resolveChannel(message, args[0]);
        if (!review || !review.isTextBased()) return message.reply({ embeds: [embeds.error('The log channel must be an existing text channel.')] });
      }

      let managerRole = null;
      if (args[1]) {
        managerRole = await helpers.resolveRole(message, args[1]);
        if (!managerRole) return message.reply({ embeds: [embeds.error('I could not find that manager role.')] });
      }

      const cfg = config(message.guild.id);

      // Replace a previous panel, if there is one.
      if (cfg.panelChannelId && cfg.panelMessageId) {
        const oldChannel = message.guild.channels.cache.get(cfg.panelChannelId) || (await message.guild.channels.fetch(cfg.panelChannelId).catch(() => null));
        const oldMessage = oldChannel?.messages ? await oldChannel.messages.fetch(cfg.panelMessageId).catch(() => null) : null;
        if (oldMessage) await oldMessage.delete().catch(() => {});
      }

      const panel = await message.channel.send({ embeds: [panelEmbed(message.guild)], components: panelComponents() });

      cfg.reviewChannelId = review.id;
      if (managerRole) cfg.managerRoleId = managerRole.id;
      cfg.panelChannelId = message.channel.id;
      cfg.panelMessageId = panel.id;
      db.save();

      const mapped = POSITIONS.filter((position) => cfg.roles?.[position.slug]).length;
      return message.reply({
        embeds: [
          embeds.success(
            `Staff applications are set up.\n**Positions:** ${POSITIONS.map((p) => p.name).join(', ')}\n**Application log:** ${review}${managerRole ? `\n**Attention Managers:** ${managerRole}` : ''}\n**Roles linked:** ${mapped}/${POSITIONS.length} (use \`apply-role <position> <@role>\` to grant a role on approval)\nPanel posted in ${message.channel}.`
          ),
        ],
      });
    },
  },

  {
    name: 'apply',
    aliases: [],
    description: 'Open the staff application panel.',
    usage: '',
    botPermissions: ['SendMessages', 'EmbedLinks'],
    cooldown: 10,
    async execute(message, args, client) {
      const cfg = config(message.guild.id);

      if (pendingEntry(message.guild.id, message.author.id)) {
        return message.reply({ embeds: [embeds.warn('You already have a staff application waiting for review.')] });
      }

      if (!cfg.reviewChannelId) {
        return message.reply({ embeds: [embeds.error(`The staff application system is not set up yet. Ask an administrator to run \`${helpers.commandPath(client, 'apply-setup')}\`.`)] });
      }

      // The form itself opens from a button (Discord only allows modals as an
      // interaction response), so this command hands over the panel.
      return message.reply({ embeds: [panelEmbed(message.guild)], components: panelComponents() });
    },
  },

  {
    name: 'apply-role',
    aliases: [],
    description: 'Link a staff position to a role that is granted on approval.',
    usage: '<staff-team|event-hoster|designer|partnership|developer> <@role>',
    permissions: ['ManageGuild'],
    cooldown: 5,
    async execute(message, args, client) {
      const position = resolvePosition(args[0]);
      if (!position) return message.reply({ embeds: [helpers.usageError(client, message, 'apply-role <staff-team|event-hoster|designer|partnership|developer> <@role>')] });

      const role = await helpers.resolveRole(message, args[1]);
      if (!role) return message.reply({ embeds: [embeds.error('I could not find that role.')] });

      const check = perms.canManageRole(message.member, role);
      if (!check.ok) return message.reply({ embeds: [embeds.error(check.error)] });

      const cfg = config(message.guild.id);
      cfg.roles = cfg.roles || {};
      cfg.roles[position.slug] = role.id;
      db.save();

      return message.reply({
        embeds: [embeds.success(`${position.emoji} **${position.name}** applications now grant the ${role} role on approval.`)],
      });
    },
  },

  {
    name: 'apply-review',
    aliases: [],
    description: 'Approve or deny a staff application.',
    usage: '<approve|deny> <@user> [reason]',
    permissions: ['ManageGuild'],
    cooldown: 3,
    async execute(message, args, client) {
      const action = String(args[0] || '').toLowerCase();
      const approve = action === 'approve' || action === 'accept';
      const deny = action === 'deny' || action === 'reject';
      if (!approve && !deny) return message.reply({ embeds: [helpers.usageError(client, message, 'apply-review <approve|deny> <@user> [reason]')] });
      if (!args[1]) return message.reply({ embeds: [helpers.usageError(client, message, 'apply-review <approve|deny> <@user> [reason]')] });

      const member = await helpers.resolveMember(message, args[1]);
      if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });

      const reason = args.slice(2).join(' ').trim();
      const result = await finalizeApplication(message.guild, member, approve, reason, message.author.tag);
      if (!result.ok) return message.reply({ embeds: [embeds.error(result.error)] });

      const position = result.stored?.position ? positionBySlug(result.stored.position) : null;
      const note = result.stored ? (position ? ` (${position.emoji} ${position.name})` : '') : '\n*No stored answers were found for this member.*';
      return message.reply({
        embeds: [embeds.success(`${approve ? 'Approved' : 'Denied'} the staff application of **${member.user.tag}**${note}.${reason ? `\n**Reason:** ${reason}` : ''}`)],
      });
    },
  },
];

/* -------------------------- interactions --------------------------- */

interactions.register('apply', async (interaction, client) => {
  if (!interaction.isButton() && !interaction.isModalSubmit()) return;

  try {
    /* ----- old panel button (graceful migration) ----- */
    if (interaction.isButton() && interaction.customId === 'apply:btn') {
      return interaction.reply({
        embeds: [embeds.info('This panel was updated. Please use the position buttons on the new application panel.')],
        ephemeral: true,
      });
    }

    /* ----- position button: open that position's form ----- */
    if (interaction.isButton() && interaction.customId.startsWith('apply:pos:')) {
      if (!interaction.inGuild()) return;

      const position = positionBySlug(interaction.customId.split(':')[2]);
      if (!position) {
        return interaction.reply({ embeds: [embeds.error('That position no longer exists.')], ephemeral: true });
      }

      const cfg = config(interaction.guild.id);
      if (!cfg.reviewChannelId) {
        return interaction.reply({ embeds: [embeds.error(`The staff application system is not set up yet. Ask an administrator to run \`${helpers.commandPath(client, 'apply-setup')}\`.`)], ephemeral: true });
      }
      if (pendingEntry(interaction.guild.id, interaction.user.id)) {
        return interaction.reply({ embeds: [embeds.warn('You already have a staff application waiting for review.')], ephemeral: true });
      }

      // showModal must be the very first response - no awaits before it.
      try {
        await interaction.showModal(buildModal(position));
      } catch (err) {
        await interaction.reply({ embeds: [embeds.error('I could not open the form - please try again.')] }).catch(() => {});
      }
      return;
    }

    /* ----- form submitted ----- */
    if (interaction.isModalSubmit() && interaction.customId.startsWith('apply:modal:')) {
      if (!interaction.inGuild()) return;

      const position = positionBySlug(interaction.customId.split(':')[2]);
      if (!position) {
        return interaction.reply({ embeds: [embeds.error('That position no longer exists.')], ephemeral: true });
      }

      const read = (id) => {
        try {
          return interaction.fields.getTextInputValue(id);
        } catch {
          return '';
        }
      };
      const values = { name: read('name'), age: read('age'), experience: read('experience'), why: read('why'), availability: read('availability') };

      const problem = validateAnswers(values);
      if (problem) {
        return interaction.reply({ embeds: [embeds.error(problem)], ephemeral: true });
      }
      if (pendingEntry(interaction.guild.id, interaction.user.id)) {
        return interaction.reply({ embeds: [embeds.warn('You already have a staff application waiting for review.')], ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      const result = await submitApplication(interaction.user, interaction.guild, position, values);
      if (!result.ok) return interaction.editReply({ embeds: [embeds.error(result.error)] });

      return interaction.editReply({ embeds: [embeds.success(`Your **${position.name}** application was submitted ✅ - the staff team will review it soon.`)] });
    }

    /* ----- review buttons ----- */
    if (interaction.customId.startsWith('apply:approve:') || interaction.customId.startsWith('apply:deny:')) {
      await interaction.deferReply({ ephemeral: true });
      if (!interaction.inGuild()) return interaction.editReply({ embeds: [embeds.error('Applications can only be reviewed in a server.')] });
      if (!perms.has(interaction.member, ['ManageGuild'])) {
        return interaction.editReply({ embeds: [embeds.error('You need the **Manage Server** permission to review applications.')] });
      }

      const approve = interaction.customId.startsWith('apply:approve:');
      const applicantId = interaction.customId.split(':')[2];
      const member = await interaction.guild.members.fetch(applicantId).catch(() => null);
      if (!member) return interaction.editReply({ embeds: [embeds.error('I could not find that applicant in this server.')] });

      const result = await finalizeApplication(interaction.guild, member, approve, '', interaction.user.tag);
      if (!result.ok) return interaction.editReply({ embeds: [embeds.error(result.error)] });

      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.editReply({
        embeds: [embeds.success(`${approve ? 'Approved' : 'Denied'} the staff application of **${member.user.tag}**.`)],
      });
    }
  } catch (err) {
    console.error('[apply:interaction]', err);
    const payload = { embeds: [embeds.error('Something went wrong while processing that application.')], ephemeral: true };
    if (interaction.replied || interaction.deferred) return interaction.followUp(payload).catch(() => {});
    return interaction.reply(payload).catch(() => {});
  }
});
