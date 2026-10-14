const fs = require('node:fs');
const path = require('node:path');

/**
 * Loads every file inside src/commands/.
 * A file may export a single command object or an array of command objects.
 * The file name becomes the command's category when none is set explicitly.
 *
 * Command shape:
 * {
 *   name: 'ban',
 *   aliases: ['b'],
 *   description: 'Ban a member.',
 *   usage: '<@user> [reason]',
 *   permissions: ['BanMembers'],      // required by the member
 *   botPermissions: ['BanMembers'],   // required by the bot
 *   guildOnly: true,
 *   ownerOnly: false,
 *   premium: false,
 *   cooldown: 5,                      // seconds
 *   async execute(message, args, client) {}
 * }
 */
function loadCommands() {
  const dir = path.join(__dirname, '..', 'commands');
  const commands = new Map();
  const aliases = new Map();
  const byCategory = new Map();

  if (!fs.existsSync(dir)) return { commands, aliases, byCategory };

  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith('.js')) continue;

    const category = path.basename(file, '.js');
    let exported;
    try {
      exported = require(path.join(dir, file));
    } catch (err) {
      console.error(`[commands] Failed to load ${file}:`, err.message);
      continue;
    }

    const list = Array.isArray(exported) ? exported : [exported];
    if (!byCategory.has(category)) byCategory.set(category, []);

    for (const command of list) {
      if (!command || typeof command !== 'object' || !command.name || typeof command.execute !== 'function') {
        console.warn(`[commands] Skipped an invalid command in ${file}.`);
        continue;
      }

      command.category = command.category || category;
      command.aliases = Array.isArray(command.aliases) ? command.aliases : [];

      if (commands.has(command.name)) {
        console.warn(`[commands] Duplicate command name "${command.name}" (${file}) - kept the first one.`);
        continue;
      }

      commands.set(command.name, command);
      byCategory.get(command.category).push(command);

      for (const alias of command.aliases) {
        const key = alias.toLowerCase();
        if (commands.has(key) || aliases.has(key)) {
          console.warn(`[commands] Duplicate alias "${alias}" on "${command.name}" - ignored.`);
          continue;
        }
        aliases.set(key, command);
      }
    }
  }

  return { commands, aliases, byCategory };
}

module.exports = { loadCommands };
