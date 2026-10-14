const fs = require('node:fs');
const path = require('node:path');

/* ------------------------------------------------------------------ *
 * Tiny JSON file database (no external dependency).
 * Keys are dot-separated paths, e.g. "guilds.123456789.jail.roleId".
 * ------------------------------------------------------------------ */

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'database.json');

const GUILD_DEFAULTS = {
  prefix: null, // null = use the global prefix from config.json
  verification: {}, // { roleId, channelId, logChannelId, messageId }
  apply: {}, // { reviewChannelId, panelChannelId, panelMessageId, roles: { positionSlug: roleId } }
  tickets: {}, // { categoryId, logChannelId, limit, panelChannelId, panelMessageId, open: {} }
  selfroles: {}, // { channelId, messageId, options: [{ roleId, emoji, label }] }
  jail: {}, // { roleId, channelId, logChannelId, duration, history: [] }
  warns: {}, // { userId: [{ reason, moderator, at }] }
  tags: {}, // { name: { content, author, createdAt } }
  welcome: {}, // { channelId, message, autorole }
  starboard: {}, // { channelId, threshold }
};

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

class Database {
  constructor() {
    this.data = {};
    this._timer = null;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(FILE)) {
        this.data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      }
    } catch (err) {
      console.error('[database] Could not read database.json:', err.message);
      this.data = {};
    }
    if (!isPlainObject(this.data)) this.data = {};
  }

  _segments(key) {
    return String(key).split('.').filter(Boolean);
  }

  get(key, fallback = undefined) {
    let node = this.data;
    for (const segment of this._segments(key)) {
      if (!isPlainObject(node) && !Array.isArray(node)) return fallback;
      if (!(segment in node)) return fallback;
      node = node[segment];
    }
    return node === undefined ? fallback : node;
  }

  set(key, value) {
    const segments = this._segments(key);
    const last = segments.pop();
    let node = this.data;
    for (const segment of segments) {
      if (!isPlainObject(node[segment])) node[segment] = {};
      node = node[segment];
    }
    node[last] = value;
    this.save();
    return value;
  }

  delete(key) {
    const segments = this._segments(key);
    const last = segments.pop();
    let node = this.data;
    for (const segment of segments) {
      if (!isPlainObject(node[segment])) return false;
      node = node[segment];
    }
    if (!(last in node)) return false;
    delete node[last];
    this.save();
    return true;
  }

  has(key) {
    return this.get(key, Symbol.for('missing')) !== Symbol.for('missing');
  }

  push(key, value) {
    const list = this.get(key, []);
    if (!Array.isArray(list)) return this.set(key, [value]);
    list.push(value);
    return this.set(key, list);
  }

  /**
   * Returns the (live) settings object for a guild, with defaults filled in.
   * Remember to call db.save() after mutating deep properties.
   */
  getGuild(guildId) {
    const key = `guilds.${guildId}`;
    let current = this.get(key);
    if (!isPlainObject(current)) {
      current = clone(GUILD_DEFAULTS);
      this.set(key, current);
      return current;
    }

    let changed = false;
    for (const [field, defaultValue] of Object.entries(GUILD_DEFAULTS)) {
      if (!(field in current)) {
        current[field] = clone(defaultValue);
        changed = true;
      }
    }
    if (changed) this.set(key, current);
    return current;
  }

  /** Debounced write to disk (writes are also flushed on shutdown). */
  save() {
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.flush();
    }, 250);
    if (this._timer.unref) this._timer.unref();
  }

  flush() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.error('[database] Could not write database.json:', err.message);
    }
  }
}

module.exports = new Database();
