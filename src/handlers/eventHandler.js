const fs = require('node:fs');
const path = require('node:path');

/**
 * Loads every file inside src/events/.
 * Event files export: { name: 'messageCreate', once: false, execute(client, ...args) }
 */
function loadEvents(client) {
  const dir = path.join(__dirname, '..', 'events');
  if (!fs.existsSync(dir)) return 0;

  let loaded = 0;
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith('.js')) continue;

    let event;
    try {
      event = require(path.join(dir, file));
    } catch (err) {
      console.error(`[events] Failed to load ${file}:`, err.message);
      continue;
    }

    if (!event || !event.name || typeof event.execute !== 'function') {
      console.warn(`[events] ${file} does not export { name, execute }.`);
      continue;
    }

    const listener = (...args) => event.execute(client, ...args);
    if (event.once) client.once(event.name, listener);
    else client.on(event.name, listener);
    loaded++;
  }

  return loaded;
}

module.exports = { loadEvents };
