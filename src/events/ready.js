const { ActivityType } = require('discord.js');
const scheduler = require('../utils/scheduler');
const slashHandler = require('../handlers/slashHandler');

module.exports = {
  name: 'clientReady',
  once: true,
  execute(client) {
    scheduler.start(client);
    slashHandler.register(client); // async, logs its own result

    client.user.setActivity(`${client.config.prefix}help`, { type: ActivityType.Watching });

    console.log('--------------------------------------------------');
    console.log(`[helper] Logged in as ${client.user.tag}`);
    console.log(`[helper] Serving ${client.guilds.cache.size} server(s)`);
    console.log(`[helper] Loaded ${client.commands.size} command(s)`);
    console.log(`[helper] Prefix: ${client.config.prefix} (per-server configurable)`);
    console.log('[helper] Slash (setup only): /verify-setup /apply-setup /ticket-setup /selfrole-setup /jail-setup /welcome-setup /starboard-setup');
    console.log('--------------------------------------------------');
  },
};
