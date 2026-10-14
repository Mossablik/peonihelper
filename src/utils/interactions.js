/* ------------------------------------------------------------------ *
 * Registry for button / select-menu / modal handlers.
 * A category module registers itself at load time:
 *
 *   const interactions = require('../utils/interactions');
 *   interactions.register('verify', async (interaction, client) => { ... });
 *
 * The handler is resolved from the part of the customId before the first
 * ":", so a button with customId "apply:approve:123456" is handled by the
 * handler registered under "apply".
 * ------------------------------------------------------------------ */

const handlers = new Map();

function register(key, handler) {
  handlers.set(key, handler);
}

function get(key) {
  return handlers.get(key) || null;
}

function has(key) {
  return handlers.has(key);
}

module.exports = { register, get, has };
