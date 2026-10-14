const crypto = require('node:crypto');
const db = require('./database');

const DAY = 86_400_000;
const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/* ------------------------------------------------------------------ *
 * Premium helpers (guild based).
 *   db:  premium.<guildId> = { expires, activatedBy, days }
 *        keys.<CODE>       = { days, used, usedBy, guildId }
 * ------------------------------------------------------------------ */

function get(guildId) {
  return db.get(`premium.${guildId}`, null);
}

function isActive(guildId) {
  const entry = get(guildId);
  return !!(entry && typeof entry.expires === 'number' && entry.expires > Date.now());
}

function expiresAt(guildId) {
  const entry = get(guildId);
  return entry && typeof entry.expires === 'number' ? entry.expires : null;
}

function daysLeft(guildId) {
  const expires = expiresAt(guildId);
  if (!expires) return 0;
  return Math.max(0, Math.ceil((expires - Date.now()) / DAY));
}

/** Adds `days` to the current premium time (or starts it). Returns the new expiry. */
function grant(guildId, days = 30, activatedBy = null) {
  const current = get(guildId);
  const base = current && current.expires > Date.now() ? current.expires : Date.now();
  const expires = base + days * DAY;
  db.set(`premium.${guildId}`, {
    expires,
    days,
    activatedBy: activatedBy || current?.activatedBy || null,
    activatedAt: current?.activatedAt || Date.now(),
  });
  return expires;
}

function revoke(guildId) {
  return db.delete(`premium.${guildId}`);
}

function list() {
  const all = db.get('premium', {}) || {};
  return Object.entries(all)
    .filter(([, entry]) => entry && entry.expires > Date.now())
    .map(([guildId, entry]) => ({ guildId, ...entry }));
}

/** Generates and stores an unused key. Returns the code. */
function generateKey(days = 30) {
  const group = () =>
    Array.from({ length: 4 }, () => KEY_ALPHABET[crypto.randomInt(KEY_ALPHABET.length)]).join('');
  const code = `HELPER-${group()}-${group()}-${group()}`;
  db.set(`keys.${code}`, { days, used: false, usedBy: null, guildId: null, createdAt: Date.now() });
  return code;
}

/** Redeems a key for a guild. Returns { ok, days?, expires?, error? }. */
function redeemKey(code, guildId, userId = null) {
  const key = db.get(`keys.${String(code || '').trim().toUpperCase()}`, null);
  if (!key) return { ok: false, error: 'That key does not exist. Double-check it and try again.' };
  if (key.used) return { ok: false, error: 'That key has already been used.' };

  const days = Number(key.days) || 30;
  const expires = grant(guildId, days, userId);
  db.set(`keys.${String(code).trim().toUpperCase()}`, { ...key, used: true, usedBy: userId, guildId });
  return { ok: true, days, expires };
}

module.exports = { get, isActive, expiresAt, daysLeft, grant, revoke, list, generateKey, redeemKey, DAY };
