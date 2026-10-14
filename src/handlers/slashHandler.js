/* ------------------------------------------------------------------ *
 * Slash command handler - SETUP commands only.
 *
 * Slash is deliberately kept small: the seven setup commands
 * (/verify-setup, /apply-setup, /ticket-setup, /selfrole-setup,
 * /jail-setup, /welcome-setup, /starboard-setup). Every other command
 * is handled by the prefix front-end (src/events/messageCreate.js).
 *
 * - `prepare(client)` builds the definitions once (see slashDefinitions).
 * - `register(client)` pushes them to Discord on startup. Global
 *   registration can take up to an hour to propagate; listing guild IDs
 *   in config.json ("slash": { "guilds": [...] }) or in the SLASH_GUILDS
 *   environment variable registers them instantly for testing.
 * - `handle(interaction)` runs the shared permission checks, converts the
 *   interaction into a (message, args) pair and executes the command
 *   object registered in src/commands/*.
 * ------------------------------------------------------------------ */

const embeds = require('../utils/embed');
const commandChecks = require('../utils/commandChecks');
const slashAdapter = require('../utils/slashAdapter');
const { buildSlashDefinitions } = require('../utils/slashDefinitions');

let cachedDefinitions = null;

/** Builds (once) the slash definitions and stores the spec on the client. */
function prepare(client) {
  if (cachedDefinitions) return cachedDefinitions;
  const { definitions, spec, paths } = buildSlashDefinitions(client.commandsByCategory);
  client.slashSpec = spec;
  client.slashPaths = paths;
  cachedDefinitions = definitions;
  return definitions;
}

/** Registers the slash commands with Discord. */
async function register(client) {
  if (client.config.slash?.enabled === false) {
    console.log('[slash] Disabled in config.json - skipping registration.');
    return;
  }

  const definitions = prepare(client);

  try {
    if (client.config.slash?.global !== false) {
      await client.application.commands.set(definitions);
      console.log(`[slash] Registered ${definitions.length} slash command(s) globally (may take up to an hour to appear).`);
    }

    const guildIds = (process.env.SLASH_GUILDS || (client.config.slash?.guilds || []).join(','))
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    for (const guildId of guildIds) {
      const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
      if (!guild) {
        console.warn(`[slash] Guild ${guildId} not found - skipped.`);
        continue;
      }
      await guild.commands.set(definitions);
      console.log(`[slash] Registered ${definitions.length} slash command(s) in ${guild.name} (instant).`);
    }
  } catch (err) {
    console.error('[slash] Failed to register slash commands:', err.message);
  }
}

/** Handles a chat input (slash) interaction. */
async function handle(interaction, client) {
  try {
    prepare(client);

    // Slash holds the setup commands only: /verify-setup, /jail-setup, ...
    const entry = client.slashSpec.get(interaction.commandName);

    if (!entry) {
      return await interaction.reply({ embeds: [embeds.error('That command is not available right now.')], ephemeral: true }).catch(() => {});
    }

    const command = entry.command;

    // Shared gate (owner, premium, permissions, cooldown).
    const check = commandChecks.verify(client, command, {
      member: interaction.member,
      user: interaction.user,
      channel: interaction.channel,
      channelId: interaction.channelId,
      guildId: interaction.guildId,
      me: interaction.guild?.members?.me,
    });
    if (!check.ok) {
      return await interaction.reply({ embeds: [check.embed], ephemeral: true }).catch(() => {});
    }

    // Defer up front: commands reply through editReply from here on.
    await interaction.deferReply().catch(() => null);
    if (!interaction.deferred && !interaction.replied) return;

    const { args, mentions } = await slashAdapter.buildArgs(interaction, entry.options);
    const message = slashAdapter.buildMessage(interaction, args, mentions);

    try {
      await command.execute(message, args, client);
    } catch (err) {
      console.error(`[slash:${command.name}]`, err);
      await interaction
        .editReply({ embeds: [embeds.error('Something went wrong while running that command. The error has been logged.')] })
        .catch(() => {});
    }
  } catch (err) {
    console.error('[slash]', err);
    const payload = { embeds: [embeds.error('Something went wrong while handling that command.')], ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
}

module.exports = { prepare, register, handle };
