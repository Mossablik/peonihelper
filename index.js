const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');

/* ------------------------------------------------------------------ *
 * Load optional .env file (no external dependency needed)
 * ------------------------------------------------------------------ */
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

const config = require('./config.json');
const categories = require('./src/categories');
const { loadCommands } = require('./src/handlers/commandHandler');
const { loadEvents } = require('./src/handlers/eventHandler');
const db = require('./src/utils/database');

const token = process.env.DISCORD_TOKEN || config.token;
const ownerIds = (process.env.OWNERS || (config.ownerIds || []).join(','))
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

if (!token) {
  console.error('[helper] No bot token found. Put it in .env (DISCORD_TOKEN=...) or in config.json (token).');
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 * Client
 * ------------------------------------------------------------------ */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.Channel],
});

client.config = { ...config, ownerIds };
client.db = db;
client.categories = categories;
client.cooldowns = new Collection();
client.startedAt = Date.now();

const { commands, aliases, byCategory } = loadCommands();
client.commands = commands;
client.aliases = aliases;
client.commandsByCategory = byCategory;

loadEvents(client);

client.login(token).catch((err) => {
  console.error('[helper] Login failed:', err.message);
  process.exitCode = 1;
  client.destroy().catch(() => {});
});

/* ------------------------------------------------------------------ *
 * Safety nets
 * ------------------------------------------------------------------ */
process.on('unhandledRejection', (err) => {
  console.error('[helper] Unhandled rejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('[helper] Uncaught exception:', err);
});
process.on('SIGINT', () => {
  console.log('\n[helper] Saving data and shutting down...');
  db.save();
  process.exit(0);
});
