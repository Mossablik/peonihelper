/**
 * Smoke test: `npm run smoke`
 * Executes every command with mocked Discord objects to catch runtime errors
 * (undefined functions, bad property access, etc.). It never touches Discord
 * and never writes to disk.
 */
const { Collection, ChannelType, PermissionFlagsBits } = require('discord.js');

/* --------------------------- keep disk safe -------------------------- */
const db = require('../src/utils/database');
db.save = () => {};
db.flush = () => {};

const { loadCommands } = require('../src/handlers/commandHandler');
const categories = require('../src/categories');
const config = require('../config.json');

/* ----------------------------- mock helpers -------------------------- */
const BOT_ID = '100000000000000001';
const OWNER_ID = '100000000000000002';
const USER_ID = '100000000000000003';

function permissionsBitfield() {
  const all = Object.values(PermissionFlagsBits).reduce((acc, bit) => acc | bit, 0n);
  return { has: () => true, bitfield: all, toArray: () => Object.keys(PermissionFlagsBits) };
}

function makeRole(id, name, position = 1) {
  return {
    id,
    name,
    position,
    managed: false,
    hoist: false,
    mentionable: true,
    editable: true,
    hexColor: '#5865F2',
    members: new Collection(),
    createdTimestamp: Date.now() - 1000000,
    permissions: { toArray: () => ['SendMessages'] },
    set: async () => makeRole(id, name, position),
    setColor: async () => makeRole(id, name, position),
    delete: async () => {},
    toString: () => `<@&${id}>`,
  };
}

function makeOverwrites() {
  const cache = new Collection();
  return {
    cache,
    edit: async (id, perms) => {
      cache.set(id, { id, deny: { has: () => false }, allow: { has: () => false } });
      return {};
    },
    delete: async (id) => cache.delete(id),
    create: async () => ({}),
  };
}

function makeTextChannel(id, name, type = ChannelType.GuildText) {
  const channel = {
    id,
    name,
    type,
    topic: null,
    nsfw: false,
    rateLimitPerUser: 0,
    position: 1,
    createdTimestamp: Date.now() - 2000000,
    parent: null,
    parentId: null,
    guild: null,
    isTextBased: () => type !== ChannelType.GuildVoice && type !== ChannelType.GuildCategory,
    isVoiceBased: () => type === ChannelType.GuildVoice || type === ChannelType.GuildStageVoice,
    isThread: () => false,
    isDMBased: () => false,
    members: new Collection(),
    messages: {
      fetch: async () => {
        const collection = new Collection();
        const mockMessage = makeSentMessage({});
        collection.set(mockMessage.id, mockMessage);
        // Some commands treat the fetched result as a single message (e.g. ticket panels).
        collection.delete = async () => {};
        return collection;
      },
      pin: async () => {},
    },
    permissionOverwrites: makeOverwrites(),
    permissionsFor: () => permissionsBitfield(),
    send: async (payload) => makeSentMessage(payload),
    sendTyping: async () => {},
    setRateLimitPerUser: async () => {},
    setTopic: async () => {},
    clone: async () => makeTextChannel(`${id}clone`, name),
    delete: async () => {},
    setName: async () => channel,
    setPosition: async () => channel,
    toString: () => `<#${id}>`,
  };
  return channel;
}

function makeVoiceChannel(id, name) {
  const channel = makeTextChannel(id, name, ChannelType.GuildVoice);
  channel.members = new Collection();
  return channel;
}

function makeSentMessage(payload) {
  const msg = {
    id: String(900000000000000000n + BigInt(Math.floor(Math.random() * 100000))),
    content: typeof payload === 'string' ? payload : payload?.content || '',
    embeds: typeof payload === 'string' ? [] : payload?.embeds || [],
    components: typeof payload === 'string' ? [] : payload?.components || [],
    createdTimestamp: Date.now(),
    author: { id: BOT_ID, bot: true, tag: 'Helper#0001' },
    edit: async (next) => Object.assign(msg, typeof next === 'string' ? { content: next } : next),
    delete: async () => {},
    react: async () => {},
    startThread: async () => ({ members: { add: async () => {} } }),
    fetch: async () => msg,
  };
  return msg;
}

function makeMember(id, name, opts = {}) {
  const role = makeRole(`${id}role`, name, 3);
  const roles = new Collection([[role.id, role]]);
  const member = {
    id,
    user: {
      id,
      tag: `${name}#0001`,
      username: name,
      bot: !!opts.bot,
      displayAvatarURL: () => 'https://example.com/avatar.png',
      bannerURL: () => null,
      flags: { toArray: () => [] },
      createdTimestamp: Date.now() - 4000000000,
      send: async () => {},
      createDM: async () => makeTextChannel('999999999999999999', 'dm'),
      toString: () => `<@${id}>`,
      fetch: async () => ({ ...{ id, tag: `${name}#0001` }, flags: { toArray: () => [] }, displayAvatarURL: () => '', bannerURL: () => null }),
    },
    roles: {
      cache: roles,
      highest: role,
      add: async () => member,
      remove: async () => member,
      set: async () => member,
    },
    permissions: permissionsBitfield(),
    joinedTimestamp: Date.now() - 3000000000,
    premiumSince: opts.premiumSince || null,
    premiumSinceTimestamp: opts.premiumSince ? Date.now() : null,
    joinedAt: new Date(Date.now() - 3000000000),
    voice: {
      channelId: opts.voiceChannelId || null,
      channel: null,
      selfMute: false,
      serverMute: false,
      selfDeaf: false,
      serverDeaf: false,
      streaming: false,
      setChannel: async () => member,
      disconnect: async () => member,
    },
    moderation: { timeout: async () => member, unsetTimeout: async () => member },
    timeout: async () => member,
    setNickname: async () => member,
    kick: async () => member,
    ban: async () => {},
    send: async () => {},
    isCommunicationDisabled: () => false,
    communicationDisabledUntilTimestamp: null,
    displayAvatarURL: () => 'https://example.com/avatar.png',
    toString: () => `<@${id}>`,
    fetch: async () => member,
  };
  return member;
}

function makeGuild() {
  const everyone = makeRole('100000000000000010', '@everyone', 0);
  everyone.managed = false;
  const text = makeTextChannel('100000000000000100', 'general');
  const voice = makeVoiceChannel('100000000000000101', 'Lobby');

  const member = makeMember(USER_ID, 'Tester');
  member.guild = null;

  const guild = {
    id: '100000000000000020',
    name: 'Test Server',
    ownerId: OWNER_ID,
    memberCount: 12,
    createdTimestamp: Date.now() - 5000000000,
    premiumTier: 1,
    premiumSubscriptionCount: 2,
    mfaLevel: 1,
    verificationLevel: 1,
    explicitContentFilter: 1,
    afkTimeout: 300,
    afkChannelId: null,
    systemChannelId: null,
    features: ['COMMUNITY'],
    shardId: 0,
    maximumEmojis: 50,
    vanityURLCode: null,
    iconURL: () => 'https://example.com/icon.png',
    bannerURL: () => null,
    splashURL: () => null,
    fetchOwner: async () => makeMember(OWNER_ID, 'Owner'),
    voiceAdapterCreator: {},
    roles: {
      cache: new Collection([
        [everyone.id, everyone],
        ['100000000000000011', makeRole('100000000000000011', 'Members', 1)],
        ['100000000000000012', makeRole('100000000000000012', 'Staff', 2)],
      ]),
      everyone,
      fetch: async (id) => new Collection().get(id) || null,
      create: async (opts) => {
        const created = makeRole(`${id()}`, opts.name || 'New Role', 1);
        return created;
      },
    },
    channels: {
      cache: new Collection([
        [text.id, text],
        [voice.id, voice],
      ]),
      fetch: async (key) => {
        if (key && typeof key === 'object') return key;
        return (
          guild.channels.cache.get(key) ||
          makeTextChannel(key, 'channel') ||
          null
        );
      },
      create: async (opts) => makeTextChannel(`${id()}`, opts.name || 'channel', opts.type),
    },
    emojis: { cache: new Collection(), fetch: async () => new Collection() },
    members: {
      cache: new Collection([[member.id, member]]),
      fetch: async (key) => {
        if (!key) return guild.members.cache;
        if (typeof key === 'object') return key;
        return guild.members.cache.get(key) || makeMember(key, `user${key}`);
      },
      ban: async () => makeMember('100000000000000099', 'banned'),
      unban: async () => makeMember('100000000000000099', 'banned'),
    },
    invites: { fetch: async () => new Collection() },
    emojisExists: true,
    setName: async () => guild,
    toString: () => guild.name,
  };

  member.guild = guild;
  text.guild = guild;
  voice.guild = guild;
  voice.members.set(member.id, member);

  const botMember = makeMember(BOT_ID, 'Helper', { bot: true });
  botMember.guild = guild;
  guild.members.me = botMember;
  guild.members.cache.set(BOT_ID, botMember);

  return guild;
}

let counter = 0;
function id() {
  return String(110000000000000000 + ++counter);
}

function makeClient(guild) {
  const user = {
    id: BOT_ID,
    tag: 'Helper#0001',
    username: 'Helper',
    bot: true,
    displayAvatarURL: () => 'https://example.com/bot.png',
  };
  return {
    user,
    config: { ...config, ownerIds: [OWNER_ID] },
    commands: new Map(),
    aliases: new Map(),
    categories,
    cooldowns: new Collection(),
    slashPaths: clientSlashPaths,
    startedAt: Date.now() - 3600000,
    ws: { ping: 42 },
    guilds: {
      cache: new Collection([[guild.id, guild]]),
      fetch: async (key) => guild,
    },
    users: {
      cache: new Collection(),
      fetch: async (key) => {
        const target = typeof key === 'object' ? key : null;
        const idValue = target ? target.id : key;
        return makeMember(idValue, `user${idValue}`).user;
      },
    },
    channels: { fetch: async (key) => makeTextChannel(key, 'channel') },
    fetchInvite: async () => ({
      code: 'abc',
      guild: { id: guild.id, name: guild.name, memberCount: 12 },
      inviter: { tag: 'User#0001' },
      channel: { name: 'general' },
      uses: 1,
      maxUses: 0,
      temporary: false,
      expiresTimestamp: null,
    }),
    generateInvite: () => 'https://discord.com/oauth2/authorize',
  };
}

function makeMessage(guild, content = '') {
  const channel = guild.channels.cache.get('100000000000000100');
  const member = guild.members.cache.get(USER_ID);
  const replies = [];

  const message = {
    id: '100000000000000500',
    content,
    guild,
    channel,
    member,
    author: member.user,
    mentions: {
      members: new Collection(),
      users: new Collection(),
      channels: new Collection(),
      roles: new Collection(),
      everyone: false,
      has: () => false,
      first: () => null,
    },
    createdTimestamp: Date.now(),
    replies,
    reply: async (payload) => {
      replies.push(payload);
      return makeSentMessage(payload);
    },
    delete: async () => {},
    react: async () => {},
    pin: async () => {},
  };
  return message;
}

/* -------------------------- slash helpers --------------------------- */
function sampleOptionValue(opt, guild) {
  if (opt.kind === 'user') {
    const member = guild.members.cache.get(USER_ID);
    return { user: member.user, member };
  }
  if (opt.kind === 'users') return `<@${USER_ID}>`;
  if (opt.kind === 'role') return guild.roles.cache.get('100000000000000011');
  if (opt.kind === 'channel') return guild.channels.cache.get('100000000000000100');
  if (opt.kind === 'integer') return Number.isFinite(opt.min) ? opt.min : 5;
  return opt.choices ? opt.choices[0].value : 'test';
}

function makeSlashInteraction(key, entry, guild, client) {
  const member = guild.members.cache.get(USER_ID);
  const channel = guild.channels.cache.get('100000000000000100');
  const values = new Map(entry.options.map((opt) => [opt.name, sampleOptionValue(opt, guild)]));

  return {
    id: '100000000000000600',
    commandName: key.split(':')[0],
    user: member.user,
    member,
    guild,
    channel,
    channelId: channel.id,
    guildId: guild.id,
    client,
    createdTimestamp: Date.now(),
    inGuild: () => true,
    replied: false,
    deferred: false,
    options: {
      getSubcommand: () => (key.includes(':') ? key.split(':')[1] : null),
      getUser: (name) => values.get(name)?.user ?? null,
      getMember: (name) => values.get(name)?.member ?? null,
      getRole: (name) => values.get(name) ?? null,
      getChannel: (name) => values.get(name) ?? null,
      getString: (name) => (typeof values.get(name) === 'string' ? values.get(name) : null),
      getInteger: (name) => (typeof values.get(name) === 'number' ? values.get(name) : null),
      get: (name) => values.get(name) ?? null,
    },
    reply: async () => {},
    deferReply: async () => ({}),
    editReply: async () => {},
    followUp: async () => {},
    deleteReply: async () => {},
    showModal: async () => {},
  };
}

/* ------------------------------ run pass ----------------------------- */
const { commands, byCategory } = loadCommands();
const { buildSlashDefinitions } = require('../src/utils/slashDefinitions');
const { spec: slashSpec, paths: clientSlashPaths } = buildSlashDefinitions(byCategory);

const results = [];
const errors = [];

(async () => {
  for (const [, command] of [...commands.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const guild = makeGuild();
    const client = makeClient(guild);
    client.commands = commands;
    const message = makeMessage(guild);

    try {
      await command.execute(message, [], client);
      results.push({ name: command.name, status: 'ok' });
    } catch (err) {
      errors.push({ name: command.name, error: err });
      results.push({ name: command.name, status: 'throw' });
    }
  }

  // Second pass: one synthetic argument, which exercises validation paths.
  for (const [, command] of [...commands.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const guild = makeGuild();
    const client = makeClient(guild);
    client.commands = commands;
    const message = makeMessage(guild);
    message.mentions.members.set(USER_ID, guild.members.cache.get(USER_ID));

    const sampleArgs = {
      role: ['100000000000000011'],
      user: ['100000000000000003'],
      channel: ['100000000000000100'],
    };
    const usage = command.usage || '';
    let args = [];
    if (usage.includes('@role') || usage.includes('role')) args = sampleArgs.role;
    else if (usage.includes('@user') || usage.includes('user')) args = sampleArgs.user;
    else if (usage.includes('#') || usage.includes('channel')) args = sampleArgs.channel;
    else args = ['test'];

    try {
      await command.execute(message, args, client);
      results.push({ name: command.name, status: 'ok', pass: 2 });
    } catch (err) {
      errors.push({ name: `${command.name} [args]`, error: err });
      results.push({ name: command.name, status: 'throw', pass: 2 });
    }
  }

  // Third pass: the slash front-end (setup commands only). Each setup
  // command runs through the slash adapter with typed, resolved options -
  // the same code path a real /verify-setup interaction takes.
  const slashAdapter = require('../src/utils/slashAdapter');

  for (const [key, entry] of [...slashSpec.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const guild = makeGuild();
    const client = makeClient(guild);
    client.commands = commands;
    client.commandsByCategory = byCategory;
    client.categories = categories;

    const interaction = makeSlashInteraction(key, entry, guild, client);
    try {
      const { args, mentions } = await slashAdapter.buildArgs(interaction, entry.options);
      const message = slashAdapter.buildMessage(interaction, args, mentions);
      await entry.command.execute(message, args, client);
      results.push({ name: entry.command.name, status: 'ok', pass: 3 });
    } catch (err) {
      errors.push({ name: `${entry.command.name} [slash ${key}]`, error: err });
      results.push({ name: entry.command.name, status: 'throw', pass: 3 });
    }
  }

  const okCount = results.filter((r) => r.status === 'ok').length;
  console.log(`\nExecuted ${results.length} command run(s) across ${commands.size} commands.`);
  console.log(`Clean: ${okCount}  |  Threw: ${errors.length}\n`);

  if (errors.length) {
    const seen = new Set();
    for (const { name, error } of errors) {
      if (seen.has(name)) continue;
      seen.add(name);
      console.log(`✖ ${name}`);
      console.log(`   ${error && error.stack ? error.stack.split('\n').slice(0, 3).join('\n   ') : error}\n`);
    }
    process.exitCode = 1;
  } else {
    console.log('All commands executed without throwing.');
  }

  // Scheduler / interaction registration sanity.
  const interactions = require('../src/utils/interactions');
  const scheduler = require('../src/utils/scheduler');
  console.log(`\nRegistered interaction keys: ${[...new Set(['verify', 'apply', 'ticket', 'selfrole', 'giveaway'].filter((k) => interactions.has(k)))].join(', ')}`);
  console.log(`Registered scheduler jobs: ${[...scheduler.handlers.keys()].join(', ')}`);
  console.log(`Slash definitions (setup only): ${slashSpec.size} -> ${[...slashSpec.keys()].map((k) => `/${k}`).join(' ')}`);
})();
