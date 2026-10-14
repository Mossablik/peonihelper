/**
 * Project validation script: `npm run check`
 *  1. Syntax-checks every JavaScript file.
 *  2. Loads the command modules and verifies structure + command counts.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

/** Expected number of commands per category (from the spec). */
const EXPECTED = {
  verification: 8,
  apply: 4,
  clans: 19,
  premium: 18,
  checker: 7,
  admin: 9,
  roles: 4,
  voice: 4,
  ticket: 5,
  selfrole: 6,
  information: 12,
  general: 5,
  fun: 26,
  moderation: 16,
  jail: 12,
};

let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`  ✖ ${msg}`);
};
const ok = (msg) => console.log(`  ✔ ${msg}`);

/* ------------------------- 1. syntax check ------------------------- */
console.log('\n[1/3] Syntax check');
const jsFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) jsFiles.push(full);
  }
})(ROOT);

let syntaxErrors = 0;
for (const file of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    syntaxErrors++;
    fail(`Syntax error in ${path.relative(ROOT, file)}\n     ${(err.stderr || '').toString().trim().split('\n').slice(0, 4).join('\n     ')}`);
  }
}
if (!syntaxErrors) ok(`${jsFiles.length} file(s) parsed without syntax errors`);

/* --------------------- 2. command structure check ------------------- */
console.log('\n[2/3] Command modules');
const { loadCommands } = require(path.join(ROOT, 'src', 'handlers', 'commandHandler.js'));
const categories = require(path.join(ROOT, 'src', 'categories.js'));

const { commands, byCategory } = loadCommands();

for (const meta of categories) {
  const list = byCategory.get(meta.id) || [];
  const expected = EXPECTED[meta.id];

  if (fs.existsSync(path.join(ROOT, 'src', 'commands', `${meta.id}.js`)) === false) {
    fail(`Category file src/commands/${meta.id}.js is missing`);
    continue;
  }
  if (list.length !== expected) {
    fail(`Category "${meta.id}": expected ${expected} command(s), found ${list.length}`);
  } else {
    ok(`${meta.name}: ${list.length} command(s)`);
  }

  for (const command of list) {
    if (!command.description) fail(`${command.name}: missing description`);
    if (command.usage === undefined) fail(`${command.name}: missing usage (use '' when there are no arguments)`);
    if (typeof command.execute !== 'function') fail(`${command.name}: execute is not a function`);
    if (command.cooldown !== undefined && (!Number.isFinite(command.cooldown) || command.cooldown < 0)) {
      fail(`${command.name}: invalid cooldown`);
    }
    for (const perm of [...(command.permissions || []), ...(command.botPermissions || [])]) {
      const { PermissionFlagsBits } = require('discord.js');
      if (!(perm in PermissionFlagsBits)) fail(`${command.name}: unknown permission "${perm}"`);
    }
  }
}

const total = [...byCategory.values()].reduce((sum, list) => sum + list.length, 0);
console.log('\n--------------------------------------------------');
console.log(`Total commands loaded: ${total} / 155 expected`);
if (total !== 155) fail(`Expected 155 commands in total, found ${total}`);

/* ----------------------- 3. slash definitions ---------------------- */
console.log('\n[3/3] Slash commands (setup commands only)');
const { buildSlashDefinitions } = require(path.join(ROOT, 'src', 'utils', 'slashDefinitions.js'));
const { definitions, spec, paths } = buildSlashDefinitions(byCategory);

const SLASH_NAME_REGEX = /^[-_a-z0-9]{1,32}$/;

/** Only the setup commands are exposed in slash; everything else is prefix-only. */
const setupNames = [...commands.keys()].filter((name) => name.includes('setup')).sort();

if (definitions.length > 100) {
  fail(`Discord allows at most 100 top-level slash commands, found ${definitions.length}`);
} else {
  ok(`${definitions.length} top-level slash command(s) (setup only, limit: 100)`);
}

for (const def of definitions) {
  if (!SLASH_NAME_REGEX.test(def.name)) fail(`Slash command "${def.name}": invalid name`);
  if (!def.description || def.description.length > 100) fail(`Slash command "${def.name}": missing or overlong description`);

  const options = def.options || [];
  if (options.length > 25) fail(`/${def.name}: ${options.length} options (Discord limit: 25)`);

  const optionNames = new Set();
  let seenOptional = false;
  for (const option of options) {
    if (!SLASH_NAME_REGEX.test(option.name)) fail(`/${def.name}: invalid option name "${option.name}"`);
    if (optionNames.has(option.name)) fail(`/${def.name}: duplicate option name "${option.name}"`);
    optionNames.add(option.name);
    if (!option.description || option.description.length > 100) fail(`/${def.name} ${option.name}: missing or overlong description`);
    if (option.required) {
      if (seenOptional) fail(`/${def.name}: required option "${option.name}" comes after an optional one`);
    } else {
      seenOptional = true;
    }
  }
}

// The spec must contain exactly the setup commands - nothing else.
const covered = [...spec.values()].map((entry) => entry.command.name);
const missing = setupNames.filter((name) => !covered.includes(name));
const extra = covered.filter((name) => !setupNames.includes(name));
if (missing.length) fail(`Setup commands without a slash definition: ${missing.join(', ')}`);
if (extra.length) fail(`Non-setup commands in slash (only setup is allowed): ${extra.join(', ')}`);
if (!missing.length && !extra.length) {
  ok(`exactly the ${setupNames.length} setup commands are in slash: ${setupNames.map((n) => `/${n}`).join(' ')}`);
}

// The paths map (used by hints) must resolve 1:1.
const badPaths = setupNames.filter((name) => paths.get(name) !== `/${name}`);
if (badPaths.length) fail(`Bad slash paths for: ${badPaths.join(', ')}`);
else ok('slash paths resolve 1:1 (verify-setup -> /verify-setup, ...)');

if (failures) {
  console.log(`\n${failures} problem(s) found.\n`);
  process.exit(1);
}
console.log('All checks passed.\n');
