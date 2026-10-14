const db = require('./database');

/* ------------------------------------------------------------------ *
 * Persistent scheduler.
 * Jobs are stored in the database ("schedules.<id>") so they survive a
 * restart. Modules register a handler for their job type at load time:
 *
 *   const scheduler = require('../utils/scheduler');
 *   scheduler.register('reminder', async (data) => { ... });
 *   scheduler.add('reminder', { channelId, text }, Date.now() + 60000);
 * ------------------------------------------------------------------ */

const handlers = new Map();
let timer = null;
let client = null;

/**
 * Registers a handler for a job type.
 * The handler is called with (data, client).
 */
function register(type, handler) {
  handlers.set(type, handler);
}

function add(type, data, at) {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  db.set(`schedules.${id}`, { type, at: Math.floor(at), data });
  start();
  return id;
}

function cancel(id) {
  return db.delete(`schedules.${id}`);
}

function tick() {
  const now = Date.now();
  const jobs = db.get('schedules', {}) || {};
  for (const [id, job] of Object.entries(jobs)) {
    if (!job || typeof job.at !== 'number' || job.at > now) continue;
    db.delete(`schedules.${id}`);
    const handler = handlers.get(job.type);
    if (!handler) {
      console.warn(`[scheduler] No handler for job type "${job.type}", dropped.`);
      continue;
    }
    Promise.resolve(handler(job.data || {}, client)).catch((err) => {
      console.error(`[scheduler:${job.type}]`, err);
    });
  }
}

function start(botClient = null, intervalMs = 15_000) {
  if (botClient) client = botClient;
  if (timer) return;
  tick();
  timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
}

module.exports = { register, add, cancel, start, handlers };
