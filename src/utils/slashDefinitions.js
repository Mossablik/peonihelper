/* ------------------------------------------------------------------ *
 * Slash command definitions.
 *
 * Slash is reserved for the SETUP commands only - everything else is
 * handled by the prefix front-end (!help, !ban, ...):
 *
 *   /verify-setup   /apply-setup   /ticket-setup   /selfrole-setup
 *   /jail-setup     /welcome-setup /starboard-setup
 *
 * The typed options (user / role / channel / string / integer) are derived
 * automatically from each command's `usage` string, so the command modules
 * stay the single source of truth - the slash adapter replays the exact
 * same (message, args) pair every command's `execute` expects.
 * ------------------------------------------------------------------ */

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const helpers = require('./helpers');

const MAX_OPTIONS = 25; // Discord's hard limit for options

/** Small enum sets that deserve Discord select dropdowns instead of free text. */
const ENUM_FAMILIES = [
  ['on', 'off'],
  ['enable', 'disable'],
  ['yes', 'no'],
  ['approve', 'deny', 'accept', 'reject'],
];

/** Usage tokens with these names become integer options. */
const INTEGER_NAMES = new Set(['amount', 'number', 'count', 'winners', 'days', 'sides', 'threshold']);

/** Friendly option descriptions by name. */
const OPTION_DESCRIPTIONS = {
  user: 'The member this applies to',
  user2: 'The second member',
  users: 'Members to target (mentions or IDs, separated by spaces)',
  role: 'The role',
  channel: 'The channel',
  'voice-channel': 'The voice channel',
  'review-channel': 'The channel where applications are reviewed',
  'log-channel': 'The log channel',
  duration: 'Duration, e.g. 10m, 1h30m or 2d',
  text: 'The text',
  message: 'The message',
  reason: 'Reason for the action',
  name: 'The name',
  key: 'The key',
  amount: 'How many',
  count: 'How many',
  days: 'Number of days',
  winners: 'Number of winners',
  sides: 'Number of dice sides',
  threshold: 'Member count threshold',
  emoji: 'Emoji (unicode or custom)',
  'message-id': 'The message ID',
  messageid: 'The message ID',
  prize: 'The prize',
  question: 'Your question',
  expression: 'The expression, e.g. 2*(3+4)',
  url: 'The URL',
  'image-url': 'Image URL, or "off"',
  nickname: 'The new nickname',
  action: 'The action',
  seconds: 'Seconds, or "off"',
  guildid: 'The server ID',
  hex: 'Hex colour like #FF00FF',
  option: 'An option',
};

/* --------------------------- usage parser --------------------------- */

function tokenizeUsage(usage) {
  // Keeps bracketed groups together: "[#hex colour]" or "[field1 | field2 | ...]".
  return String(usage || '').match(/\[[^\]]*\]|<[^>]*>|\S+/g) || [];
}

/** "<@user>" -> "@user", "[#channel]" -> "#channel" */
function strip(token) {
  return token.replace(/^[[<]/, '').replace(/[>\]]$/, '');
}

/** Turns any label into a valid slash option name (<= 32 chars, [a-z0-9-]). */
function sanitizeName(raw) {
  let name = String(raw || '')
    .toLowerCase()
    .replace(/\|/g, ' ')
    .replace(/[^a-z0-9 _-]/g, ' ')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!name) name = 'value';
  if (/^\d/.test(name)) name = `opt-${name}`;
  return name.slice(0, 32);
}

function describeOption(name, kind, alternatives) {
  let base;
  if (kind === 'user') base = OPTION_DESCRIPTIONS.user;
  else if (kind === 'users') base = OPTION_DESCRIPTIONS.users;
  else if (kind === 'role') base = OPTION_DESCRIPTIONS.role;
  else if (kind === 'channel') base = OPTION_DESCRIPTIONS.channel;
  else base = OPTION_DESCRIPTIONS[name] || helpers.truncate(`The ${name.replace(/-/g, ' ')}`, 100);

  if (kind === 'string' && alternatives?.length) {
    return helpers.truncate(`${base} - or: ${alternatives.join(', ')}`, 100);
  }
  return base;
}

/**
 * Converts a command's usage string into slash option specs.
 * @returns {Array<{ name: string, kind: string, required: boolean, choices?: string[], min?: number, max?: number, pipe?: boolean }>}
 */
function parseUsage(usage) {
  const tokens = tokenizeUsage(usage);
  const options = [];
  const used = new Set();

  const push = (spec) => {
    const base = sanitizeName(spec.name);
    let name = base;
    let n = 2;
    while (used.has(name)) name = `${base.slice(0, 28)}-${n++}`;
    used.add(name);
    spec.name = name;
    options.push(spec);
    return spec;
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '...') continue;

    // Everything behind a "|" is joined back together with " | " later on.
    if (token === '|') {
      for (let j = i + 1; j < tokens.length; j++) {
        const t = tokens[j];
        if (t === '|' || t === '...') continue;
        push({ name: strip(t), kind: 'string', required: !t.startsWith('['), pipe: true });
      }
      break;
    }

    const required = !token.startsWith('[');
    const core = strip(token);
    const lower = core.toLowerCase();
    const alternatives = lower.split('|').map((a) => a.trim()).filter(Boolean);
    const first = alternatives[0] || lower;

    // A token that also has a "|" neighbour belongs to a pipe group.
    const pipeNeighbour = tokens[i + 1] === '|' || tokens[i - 1] === '|';

    // --- variadic member list: <@user...> or <@user> <@user> ...
    const repeated = tokens[i + 1] && strip(tokens[i + 1]).toLowerCase() === lower && tokens[i + 2] === '...';
    if (/@user\.\.\.$/.test(lower) || (lower.startsWith('@user') && repeated)) {
      push({ name: 'users', kind: 'users', required });
      if (repeated) i += 2;
      continue;
    }

    // --- single member: <@user>, [@user], <@user|id>, <@user|id|name>
    if (first.startsWith('@user') || first.startsWith('@member')) {
      push({ name: options.some((o) => o.kind === 'user') ? 'user2' : 'user', kind: 'user', required });
      continue;
    }

    // --- role: <@role>, [@role], <@role|id|name>, [@staff-role]
    if (first.startsWith('@role') || (first.startsWith('@') && /role$/.test(first))) {
      const others = alternatives.slice(1);
      const roleish = others.every((a) => ['id', 'name', '@role'].includes(a));
      if (others.length === 0 || roleish) {
        push({ name: 'role', kind: 'role', required });
      } else {
        push({ name: first.replace(/^@/, ''), kind: 'string', required, alternatives: others, pipe: pipeNeighbour });
      }
      continue;
    }

    // --- channel: <#channel>, [#channel], <#voice-channel>
    if (first.startsWith('#')) {
      push({ name: first.slice(1), kind: 'channel', required });
      continue;
    }

    // --- bracketed list: [field1 | field2 | ...] -> one free-text option
    if (token.startsWith('[') && alternatives.includes('...')) {
      const base = first.replace(/\d+$/, '');
      push({ name: /s$/.test(base) ? base : `${base}s`, kind: 'string', required: false });
      continue;
    }

    // --- variadic text: <option> <option> ...
    if (tokens[i + 1] && strip(tokens[i + 1]).toLowerCase() === lower && tokens[i + 2] === '...') {
      push({ name: `${lower}1`, kind: 'string', required: true });
      push({ name: `${lower}2`, kind: 'string', required: true });
      push({ name: `${lower}3`, kind: 'string', required: false });
      push({ name: `${lower}4`, kind: 'string', required: false });
      i += 2;
      continue;
    }
    if (/\.\.\.$/.test(lower)) {
      push({ name: lower.replace(/\.\.\.$/, ''), kind: 'string', required });
      continue;
    }

    // --- numeric range: <1-100>, <0-20>
    if (/^\d+-\d+$/.test(lower)) {
      const [min, max] = lower.split('-').map(Number);
      push({ name: min === 0 ? 'count' : 'amount', kind: 'integer', required, min, max });
      continue;
    }

    // --- enums become dropdowns: <approve|deny>, [on|off], <enable|disable>
    const enumFamily = ENUM_FAMILIES.find((family) => alternatives.length > 1 && alternatives.every((a) => family.includes(a)));
    if (enumFamily) {
      push({ name: first, kind: 'string', required, choices: alternatives });
      continue;
    }

    // --- integer-ish names: <amount>, <days>, <winners>
    if (INTEGER_NAMES.has(lower)) {
      push({ name: lower, kind: 'integer', required });
      continue;
    }

    // --- everything else is free text: <duration>, [reason], <key>, <text...>
    push({ name: first.replace(/^@/, ''), kind: 'string', required, alternatives: alternatives.slice(1), pipe: pipeNeighbour });
  }

  return options.slice(0, MAX_OPTIONS);
}

/* ------------------------- definition builder ------------------------ */

function setGuildOnly(builder) {
  if (typeof builder.setContexts === 'function') builder.setContexts(InteractionContextType.Guild);
  else if (typeof builder.setDMPermission === 'function') builder.setDMPermission(false);
  return builder;
}

function addOption(sub, opt) {
  const description = describeOption(opt.name, opt.kind, opt.alternatives);

  if (opt.kind === 'user') {
    sub.addUserOption((o) => o.setName(opt.name).setDescription(description).setRequired(opt.required));
  } else if (opt.kind === 'role') {
    sub.addRoleOption((o) => o.setName(opt.name).setDescription(description).setRequired(opt.required));
  } else if (opt.kind === 'channel') {
    sub.addChannelOption((o) => o.setName(opt.name).setDescription(description).setRequired(opt.required));
  } else if (opt.kind === 'integer') {
    sub.addIntegerOption((o) => {
      o.setName(opt.name).setDescription(description).setRequired(opt.required);
      if (Number.isFinite(opt.min)) o.setMinValue(opt.min);
      if (Number.isFinite(opt.max)) o.setMaxValue(opt.max);
      return o;
    });
  } else {
    sub.addStringOption((o) => {
      o.setName(opt.name).setDescription(description).setRequired(opt.required);
      if (opt.choices?.length) o.addChoices(...opt.choices.slice(0, 25).map((value) => ({ name: value, value })));
      return o;
    });
  }
}

/** Commands whose name contains "setup" are the ones exposed in slash. */
const isSetupCommand = (command) => command.name.includes('setup');

/**
 * Builds the slash command definitions (for Discord) plus a spec map
 * (for the adapter that replays the argument list) and a path map
 * (command name -> slash invocation, used by hints and help).
 *
 * Only setup commands ("verify-setup", "jail-setup", ...) are registered;
 * every other command is prefix-only.
 * @returns {{ definitions: object[], spec: Map<string, { command: object, options: object[] }>, paths: Map<string, string> }}
 */
function buildSlashDefinitions(byCategory) {
  const definitions = [];
  const spec = new Map();
  const paths = new Map();

  for (const list of byCategory.values()) {
    for (const command of list) {
      if (!isSetupCommand(command)) continue;

      const options = parseUsage(command.usage);
      const builder = setGuildOnly(
        new SlashCommandBuilder().setName(sanitizeName(command.name)).setDescription(helpers.truncate(command.description || 'No description.', 100))
      );
      for (const opt of options) addOption(builder, opt);

      definitions.push(builder.toJSON());
      spec.set(command.name, { command, options });
      paths.set(command.name, `/${command.name}`);
    }
  }

  return { definitions, spec, paths };
}

module.exports = { buildSlashDefinitions, parseUsage, sanitizeName };
