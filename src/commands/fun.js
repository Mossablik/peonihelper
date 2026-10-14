const embeds = require('../utils/embed');
const helpers = require('../utils/helpers');

/* ------------------------------------------------------------------ *
 * Fun Commands (26)
 * 8ball, coinflip, dice, choose, rate, ship, pp, joke, fact, quote,
 * wouldyourather, truth, dare, slot, emojify, mock, reverse, vaporwave,
 * say, hug, slap, kiss, pat, poke, wave, highfive
 * ------------------------------------------------------------------ */

/* ------------------------------- data ------------------------------ */

const BALL_GROUPS = [
  {
    label: 'positive',
    answers: [
      'It is certain.',
      'It is decidedly so.',
      'Without a doubt.',
      'Yes - definitely.',
      'You may rely on it.',
      'As I see it, yes.',
      'Most likely.',
      'Outlook good.',
      'Yes.',
      'Signs point to yes.',
    ],
  },
  {
    label: 'neutral',
    answers: [
      'Reply hazy, try again.',
      'Ask again later.',
      'Better not tell you now.',
      'Cannot predict now.',
      'Concentrate and ask again.',
      'Maybe. Maybe not.',
    ],
  },
  {
    label: 'negative',
    answers: [
      "Don't count on it.",
      'My reply is no.',
      'My sources say no.',
      'Outlook not so good.',
      'Very doubtful.',
      'No way.',
    ],
  },
];

const JOKES = [
  { setup: "Why don't scientists trust atoms?", punchline: 'Because they make up everything!' },
  { setup: 'Why did the scarecrow win an award?', punchline: 'He was outstanding in his field!' },
  { setup: "What do you call cheese that isn't yours?", punchline: 'Nacho cheese!' },
  { setup: "Why don't eggs tell jokes?", punchline: "They'd crack each other up!" },
  { setup: "I'm reading a book about anti-gravity.", punchline: "It's impossible to put down!" },
  { setup: 'Why did the bicycle fall over?', punchline: 'Because it was two-tired!' },
  { setup: 'What did the ocean say to the beach?', punchline: 'Nothing, it just waved!' },
  { setup: "Why can't you give Elsa a frozen drink?", punchline: 'Because she will let it go!' },
  { setup: 'What do you call a fake noodle?', punchline: 'An impasta!' },
  { setup: 'Why did the golfer bring two pairs of pants?', punchline: 'In case he got a hole in one!' },
  { setup: 'How does a penguin build its house?', punchline: 'Igloos it together!' },
  { setup: 'What do you call a bear with no teeth?', punchline: 'A gummy bear!' },
  { setup: 'Why was the math book sad?', punchline: 'It had too many problems!' },
  { setup: 'What do you call a dog that does magic?', punchline: 'A labracadabrador!' },
  { setup: 'Why did the tomato turn red?', punchline: 'Because it saw the salad dressing!' },
  { setup: 'What did one wall say to the other?', punchline: 'I will meet you at the corner!' },
  { setup: 'Why do cows wear bells?', punchline: "Because their horns don't work!" },
];

const FACTS = [
  'Honey never spoils. Archaeologists have found 3,000-year-old honey in Egyptian tombs that was still edible.',
  'Octopuses have three hearts and blue blood.',
  'A day on Venus is longer than its year.',
  'Bananas are berries, but strawberries are not.',
  'Sharks existed before trees did.',
  'The Eiffel Tower can grow over 15 cm taller during summer due to heat expansion.',
  'Wombats poop in cubes.',
  'Cleopatra lived closer in time to the Moon landing than to the building of the Great Pyramid.',
  'There are more stars in the universe than grains of sand on every beach on Earth.',
  'A group of flamingos is called a "flamboyance".',
  'Dolphins give each other names using unique whistle signatures.',
  'The shortest war in history lasted about 38 minutes.',
  'Some cats are allergic to humans.',
  'Water can exist as a solid, liquid and gas at the exact same time (its triple point).',
];

const QUOTES = [
  { text: 'The only way to do great work is to love what you do.', author: 'Steve Jobs' },
  { text: 'Not all those who wander are lost.', author: 'J.R.R. Tolkien' },
  { text: 'In the middle of difficulty lies opportunity.', author: 'Albert Einstein' },
  { text: 'Be yourself; everyone else is already taken.', author: 'Oscar Wilde' },
  { text: 'It does not matter how slowly you go, as long as you do not stop.', author: 'Confucius' },
  { text: 'The best way out is always through.', author: 'Robert Frost' },
  { text: 'Try not to become a person of success, but rather try to become a person of value.', author: 'Albert Einstein' },
  { text: 'Simplicity is the ultimate sophistication.', author: 'Leonardo da Vinci' },
  { text: 'Well done is better than well said.', author: 'Benjamin Franklin' },
  { text: 'Life is what happens when you are busy making other plans.', author: 'John Lennon' },
  { text: 'The journey of a thousand miles begins with a single step.', author: 'Lao Tzu' },
  { text: 'Stay hungry, stay foolish.', author: 'Steve Jobs' },
  { text: 'If you judge people, you have no time to love them.', author: 'Mother Teresa' },
];

const WYR_PAIRS = [
  { a: 'Be able to fly', b: 'Be invisible' },
  { a: 'Never use social media again', b: 'Never watch TV or movies again' },
  { a: 'Always be 10 minutes late', b: 'Always be 20 minutes early' },
  { a: 'Have unlimited money', b: 'Have unlimited time' },
  { a: 'Talk to animals', b: 'Speak every language' },
  { a: 'Live without music', b: 'Live without movies' },
  { a: 'Only eat pizza for a year', b: 'Only eat salads for a year' },
  { a: 'Know how you will die', b: 'Know when you will die' },
  { a: 'Be famous', b: 'Be rich' },
  { a: 'Have a rewind button for your life', b: 'Have a pause button for your life' },
  { a: 'Travel to the past', b: 'Travel to the future' },
];

const TRUTHS = [
  'What is the most embarrassing thing you have ever done?',
  'What is a secret you have never told anyone here?',
  'What is the last thing you searched for on your phone?',
  'Have you ever pretended to be sick to skip something?',
  'What is your biggest fear?',
  'Who was your first crush?',
  'What is the weirdest food you have ever eaten?',
  'Have you ever broken something and blamed someone else?',
  'What is the silliest thing you get unreasonably angry about?',
  'What is your worst habit?',
  'If you could erase one memory, which one would it be?',
  'What is the longest you have gone without showering?',
];

const DARES = [
  'Do your best impression of a famous person for 30 seconds.',
  'Send a voice message singing the chorus of your favourite song.',
  'Change your nickname to "I love bots" for the next 10 minutes.',
  'Post a selfie with the silliest caption you can think of.',
  'Do 10 jumping jacks right now, no excuses.',
  'Speak only in emojis until your next message.',
  'Compliment the last person who spoke in this chat.',
  'Take a sip of water like it is fine wine.',
  'Act like a zombie until someone reacts to your message.',
  'Name 5 foods in 5 seconds. Go!',
  'Put your phone on your head for 10 seconds.',
];

const SLOT_SYMBOLS = ['🍒', '🍋', '🔔', '⭐', '💎', '7️⃣', '🍀'];

const HUG_LINES = [
  'warm, cozy and full of puppy energy.',
  'a big bear hug that lasts just a little too long.',
  'squeezes tight and refuses to let go.',
  'the kind of hug that fixes a whole rough day.',
  'gentle, warm and surprisingly comfy.',
  'a hug so soft it should come with a blanket.',
  'the perfect "you got this" hug.',
];

const SLAP_LINES = [
  'a dramatic, movie-style slap across the face!',
  'a plastic slipper thrown with pinpoint accuracy.',
  'a surprisingly powerful slap. Respect.',
  'a slap so loud the neighbours checked in.',
  'an overhand slap with unnecessary spin.',
  'a gentle slap - more like a high-five with attitude.',
];

const KISS_LINES = [
  'a sweet peck on the cheek.',
  'the kind of kiss that ends a fairy tale.',
  'a gentle kiss right on the forehead.',
  'a smooch so loud it echoed through the server.',
  'a quick kiss and a shy smile.',
  'a movie-style dramatic kiss. Someone grab the popcorn!',
];

const PAT_LINES = [
  'gentle pats that fix everything, obviously.',
  'the legendary head pats. +10 morale for everyone.',
  'soft, slow pats. You are doing great.',
  'expert-level pats with impeccable rhythm.',
  'a flurry of pats. Achievement unlocked: loved.',
];

const POKE_LINES = [
  'poke poke... do it again!',
  'an annoying little poke right in the shoulder.',
  'a poke so subtle you wonder if it even happened.',
  'poke poke poke! Consider yourself poked.',
  'a boop right on the nose. Gotcha!',
];

const WAVE_LINES = [
  'a cheerful, full-arm wave!',
  'the fancy wave reserved for important people.',
  'a tiny, shy wave with a big smile.',
  'a wave so enthusiastic it created wind.',
  'the classic "hello, new friend!" wave.',
];

const HIGHFIVE_LINES = [
  'a perfect high-five. Nothing but net!',
  'a high-five so loud it echoed.',
  'a slow-mo high-five. Nailed the timing.',
  'a double high-five. Twice the power!',
  'a high-five that could rival a handshake deal.',
];

/** Per-command data for the seven social commands. */
const ACTIONS = {
  hug: { display: 'hugs', title: 'Hug', lines: HUG_LINES },
  slap: { display: 'slaps', title: 'Slap', lines: SLAP_LINES },
  kiss: { display: 'kisses', title: 'Kiss', lines: KISS_LINES },
  pat: { display: 'pats', title: 'Pat', lines: PAT_LINES },
  poke: { display: 'pokes', title: 'Poke', lines: POKE_LINES },
  wave: { display: 'waves', title: 'Wave', lines: WAVE_LINES },
  highfive: { display: 'high-fives', title: 'High five', lines: HIGHFIVE_LINES },
};

/* ----------------------------- helpers ----------------------------- */

/** Sum of all character codes - used for the deterministic `rate` command. */
function sumOfCodes(text) {
  return [...String(text)].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

/** Small multiplicative string hash - same input always gives the same number. */
function hashString(text) {
  let hash = 0;
  for (const char of String(text)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

/** Builds a 10-segment bar such as '🟩🟩🟩🟩⬜⬜⬜⬜⬜⬜'. */
function percentageBar(percent, filled = '🟩', empty = '⬜', size = 10) {
  const filledCount = Math.max(0, Math.min(size, Math.round(percent / (100 / size))));
  return filled.repeat(filledCount) + empty.repeat(size - filledCount);
}

/** Builds a 10-segment heart bar for the ship command. */
function heartsBar(percent) {
  return percentageBar(percent, '❤️', '🤍');
}

/** Playful verdict text for a ship percentage. */
function shipVerdict(score) {
  if (score <= 25) return 'Better as friends';
  if (score <= 50) return 'Maybe...';
  if (score <= 75) return 'Looking good!';
  return 'Perfect match!';
}

/** sPoNgEbOb-fies text by alternating the case of every letter. */
function mockify(text) {
  let upper = false;
  return [...text]
    .map((char) => {
      if (!/[a-z]/i.test(char)) return char;
      upper = !upper;
      return upper ? char.toUpperCase() : char.toLowerCase();
    })
    .join('');
}

/** Shared builder for the hug/slap/kiss/pat/poke/wave/highfive commands. */
async function actionEmbed(emoji, verb, message, args, client) {
  const action = ACTIONS[verb];
  if (!args[0]) return helpers.usageError(client, message, `${verb} <@user>`);

  const member = await helpers.resolveMember(message, args[0]);
  if (!member) return embeds.error('I could not find that member.');
  if (member.id === message.author.id) return embeds.error(`You cannot ${action.display} yourself! Get a friend instead.`);

  return embeds
    .base(embeds.colors.moderation)
    .setTitle(`${emoji} ${action.title}`)
    .setDescription(`${emoji} **${message.author}** ${action.display} **${member}**!\n> ${helpers.pick(action.lines)}`)
    .setFooter({ text: `Requested by ${message.author.tag}` });
}

/* ----------------------------- commands ---------------------------- */

module.exports = [
  {
    name: '8ball',
    aliases: ['ball'],
    description: 'Ask the magic 8-ball a question about your fate.',
    usage: '<question>',
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0]) return message.reply({ embeds: [helpers.usageError(client, message, '8ball <question>')] });

      const question = args.join(' ');
      const group = helpers.pick(BALL_GROUPS);
      const answer = helpers.pick(group.answers);

      return message.reply({
        embeds: [
          embeds
            .base(embeds.colors.primary)
            .setTitle('🎱 Magic 8-Ball')
            .addFields(
              { name: 'Question', value: helpers.truncate(question, 200), inline: false },
              { name: 'Answer', value: `**${answer}**\n*The answer is ${group.label}.*`, inline: false }
            ),
        ],
      });
    },
  },

  {
    name: 'coinflip',
    aliases: ['flip'],
    description: 'Flip a coin and let fate decide.',
    usage: '',
    cooldown: 3,
    async execute(message, args, client) {
      const flip = helpers.pick(['Heads', 'Tails']);
      const face = flip === 'Heads' ? '👑' : '🌙';
      return message.reply({
        embeds: [
          embeds
            .base(embeds.colors.premium)
            .setTitle('🪙 Coin flip')
            .setDescription(`The coin spins through the air... and lands on **${flip}**! ${face}`),
        ],
      });
    },
  },

  {
    name: 'dice',
    aliases: ['roll'],
    description: 'Roll one or more dice.',
    usage: '[sides] [count]',
    cooldown: 3,
    async execute(message, args, client) {
      const sides = args[0] !== undefined ? Number(args[0]) : 6;
      const count = args[1] !== undefined ? Number(args[1]) : 1;

      if (!Number.isInteger(sides) || sides < 2 || sides > 100) {
        return message.reply({ embeds: [embeds.error('The number of sides must be a whole number between **2** and **100**.')] });
      }
      if (!Number.isInteger(count) || count < 1 || count > 10) {
        return message.reply({ embeds: [embeds.error('You can roll between **1** and **10** dice at a time.')] });
      }

      const rolls = Array.from({ length: count }, () => helpers.randInt(1, sides));
      const total = rolls.reduce((sum, n) => sum + n, 0);
      const description =
        count === 1
          ? `You rolled one d${sides}...\nResult: **${rolls[0]}**`
          : `**${count}**d${sides} roll:\nResults: ${rolls.map((n) => `**${n}**`).join(', ')}\n**Total: ${total}**`;

      return message.reply({ embeds: [embeds.base(embeds.colors.warning).setTitle('🎲 Dice').setDescription(description)] });
    },
  },

  {
    name: 'choose',
    aliases: ['pick'],
    description: 'Let the bot choose between two or more options.',
    usage: '<option> <option> ...',
    cooldown: 3,
    async execute(message, args, client) {
      if (args.length < 2) return message.reply({ embeds: [helpers.usageError(client, message, 'choose <option> <option> ...')] });

      const chosen = helpers.pick(args);
      const options = args.map((option, index) => `**${index + 1}.** ${option}`).join('\n');

      return message.reply({
        embeds: [
          embeds
            .base(embeds.colors.info)
            .setTitle('🤔 Decisions')
            .setDescription(`${options}\n\n➜ My verdict: **${chosen}**`),
        ],
      });
    },
  },

  {
    name: 'rate',
    aliases: [],
    description: 'Rate anything from 0% to 100%. The same text always gets the same score.',
    usage: '<text>',
    cooldown: 3,
    async execute(message, args, client) {
      const text = args.join(' ').trim();
      if (!text) return message.reply({ embeds: [helpers.usageError(client, message, 'rate <text>')] });

      const score = sumOfCodes(text) % 101;
      const bar = percentageBar(score);

      return message.reply({
        embeds: [
          embeds
            .base(embeds.colors.premium)
            .setTitle('⭐ Rating')
            .setDescription(`I rate **${helpers.truncate(text, 150)}**...\n${bar}\n**${score}%**`),
        ],
      });
    },
  },

  {
    name: 'ship',
    aliases: [],
    description: 'Calculate the love match between two members.',
    usage: '<@user> <@user>',
    cooldown: 3,
    async execute(message, args, client) {
      if (!args[0] || !args[1]) return message.reply({ embeds: [helpers.usageError(client, message, 'ship <@user> <@user>')] });

      const first = await helpers.resolveMember(message, args[0]);
      if (!first) return message.reply({ embeds: [embeds.error('I could not find that member.')] });
      const second = await helpers.resolveMember(message, args[1]);
      if (!second) return message.reply({ embeds: [embeds.error('I could not find that member.')] });

      // Sort the ids so the result is the same no matter who is mentioned first.
      const key = [first.id, second.id].sort().join('-');
      const score = hashString(key) % 101;

      return message.reply({
        embeds: [
          embeds
            .base(embeds.colors.moderation)
            .setTitle('💘 Ship')
            .setDescription(
              `**${first.user.tag}** ❤️ **${second.user.tag}**\n${heartsBar(score)}\n**${score}%** match - ${shipVerdict(score)}!`
            )
            .setFooter({ text: 'Scientifically 100% accurate.' }),
        ],
      });
    },
  },

  {
    name: 'pp',
    aliases: [],
    description: 'Measure... something. It is deterministic - do not @ me.',
    usage: '[@user]',
    cooldown: 3,
    async execute(message, args, client) {
      const member = args[0] ? await helpers.resolveMember(message, args[0]) : message.member;
      if (!member) return message.reply({ embeds: [embeds.error('I could not find that member.')] });

      const length = (hashString(member.id) % 30) + 1;
      const ruler = '8' + '='.repeat(length) + 'D';

      let comment;
      if (length <= 5) comment = 'Ouch. At least you are honest...';
      else if (length <= 10) comment = 'Hmm... confidence is key!';
      else if (length <= 15) comment = 'Perfectly average. Nothing to be ashamed of.';
      else if (length <= 20) comment = 'Whoa, watch out with that thing!';
      else if (length <= 25) comment = 'The medics are on standby.';
      else comment = 'That breaks the laws of physics!';

      return message.reply({
        embeds: [
          embeds
            .base(embeds.colors.info)
            .setTitle('📏 Measurement')
            .setDescription(`Official measurement for **${member.user.tag}**:\n\`\`\`${ruler}\`\`\`\n**${length} cm** - ${comment}`)
            .setFooter({ text: 'Results are peer reviewed by absolutely no one.' }),
        ],
      });
    },
  },

  {
    name: 'joke',
    aliases: [],
    description: 'Tell a random clean joke.',
    usage: '',
    cooldown: 3,
    async execute(message, args, client) {
      const joke = helpers.pick(JOKES);
      return message.reply({
        embeds: [
          embeds
            .base(embeds.colors.warning)
            .setTitle('😂 Joke')
            .addFields(
              { name: 'Setup', value: joke.setup, inline: false },
              { name: 'Punchline', value: `||${joke.punchline}||`, inline: false }
            )
            .setFooter({ text: 'Click the spoiler to reveal the punchline!' }),
        ],
      });
    },
  },

  {
    name: 'fact',
    aliases: [],
    description: 'Share a random fun fact.',
    usage: '',
    cooldown: 3,
    async execute(message, args, client) {
      return message.reply({
        embeds: [embeds.base(embeds.colors.info).setTitle('🧠 Fun fact').setDescription(helpers.pick(FACTS))],
      });
    },
  },

  {
    name: 'quote',
    aliases: [],
    description: 'Share a random quote.',
    usage: '',
    cooldown: 3,
    async execute(message, args, client) {
      const quote = helpers.pick(QUOTES);
      return message.reply({
        embeds: [
          embeds
            .base(embeds.colors.primary)
            .setTitle('💬 Quote of the moment')
            .setDescription(`> ${quote.text}`)
            .setFooter({ text: `— ${quote.author}` }),
        ],
      });
    },
  },

  {
    name: 'wouldyourather',
    aliases: ['wyr'],
    description: 'Ask a random "would you rather" question.',
    usage: '',
    cooldown: 3,
    async execute(message, args, client) {
      const pair = helpers.pick(WYR_PAIRS);
      return message.reply({
        embeds: [
          embeds
            .base(embeds.colors.warning)
            .setTitle('⚖️ Would you rather')
            .addFields(
              { name: 'A', value: pair.a, inline: true },
              { name: 'B', value: pair.b, inline: true }
            )
            .setFooter({ text: 'React or reply with your pick!' }),
        ],
      });
    },
  },

  {
    name: 'truth',
    aliases: [],
    description: 'Ask a random truth question.',
    usage: '',
    cooldown: 3,
    async execute(message, args, client) {
      return message.reply({
        embeds: [embeds.base(embeds.colors.info).setTitle('🕵️ Truth').setDescription(helpers.pick(TRUTHS))],
      });
    },
  },

  {
    name: 'dare',
    aliases: [],
    description: 'Give a random light dare.',
    usage: '',
    cooldown: 3,
    async execute(message, args, client) {
      return message.reply({
        embeds: [embeds.base(embeds.colors.error).setTitle('😈 Dare').setDescription(helpers.pick(DARES))],
      });
    },
  },

  {
    name: 'slot',
    aliases: [],
    description: 'Try your luck at the slot machine.',
    usage: '',
    cooldown: 3,
    async execute(message, args, client) {
      const symbols = Array.from({ length: 3 }, () => helpers.pick(SLOT_SYMBOLS));
      const [a, b, c] = symbols;
      const reel = `│ ${symbols.join(' │ ')} │`;

      let result;
      let color;
      if (a === b && b === c) {
        result = '**JACKPOT!** 🎊🎉✨ You matched all three!';
        color = embeds.colors.premium;
      } else if (a === b || a === c || b === c) {
        result = 'Two matched - **small win**! So close to the jackpot!';
        color = embeds.colors.success;
      } else {
        result = 'No matches... **the house wins this time!**';
        color = embeds.colors.error;
      }

      return message.reply({ embeds: [embeds.base(color).setTitle('🎰 Slots').setDescription(`\`\`\`${reel}\`\`\`\n${result}`)] });
    },
  },

  {
    name: 'emojify',
    aliases: [],
    description: 'Turn your text into regional indicator emojis.',
    usage: '<text>',
    cooldown: 3,
    async execute(message, args, client) {
      const text = args.join(' ');
      if (!text) return message.reply({ embeds: [helpers.usageError(client, message, 'emojify <text>')] });

      const emojified = text.replace(/([a-z])/gi, (char) => String.fromCodePoint(0x1f1e6 + char.toLowerCase().charCodeAt(0) - 97));
      if (emojified.length > 1900) return message.reply({ embeds: [embeds.error('That text is too long to emojify - please use fewer characters.')] });

      return message.reply({ embeds: [embeds.base(embeds.colors.success).setTitle('😀 Emojified').setDescription(emojified)] });
    },
  },

  {
    name: 'mock',
    aliases: [],
    description: 'sPoNgEbOb-fy your text.',
    usage: '<text>',
    cooldown: 3,
    async execute(message, args, client) {
      const text = args.join(' ');
      if (!text) return message.reply({ embeds: [helpers.usageError(client, message, 'mock <text>')] });

      return message.reply({
        embeds: [
          embeds
            .base(embeds.colors.warning)
            .setTitle('Mocking SpongeBob')
            .setDescription(`🥴 ${mockify(text)}`)
            .setFooter({ text: 'sPoNgEbOuLd Be PrOuD' }),
        ],
      });
    },
  },

  {
    name: 'reverse',
    aliases: [],
    description: 'Reverse your text.',
    usage: '<text>',
    cooldown: 3,
    async execute(message, args, client) {
      const text = args.join(' ');
      if (!text) return message.reply({ embeds: [helpers.usageError(client, message, 'reverse <text>')] });

      const reversed = [...text].reverse().join('');
      return message.reply({ embeds: [embeds.base(embeds.colors.info).setTitle('⏪ Reversed').setDescription(reversed)] });
    },
  },

  {
    name: 'vaporwave',
    aliases: [],
    description: 'Turn your text into fullwidth vaporwave letters.',
    usage: '<text>',
    cooldown: 3,
    async execute(message, args, client) {
      const text = args.join(' ');
      if (!text) return message.reply({ embeds: [helpers.usageError(client, message, 'vaporwave <text>')] });

      const vaporwaved = [...text]
        .map((char) => {
          const code = char.charCodeAt(0);
          if (char === ' ') return '　';
          if (code >= 33 && code <= 126) return String.fromCharCode(code + 0xfee0);
          return char;
        })
        .join('');

      return message.reply({ embeds: [embeds.base(embeds.colors.primary).setTitle('🌊 Vaporwave').setDescription(vaporwaved)] });
    },
  },

  {
    name: 'say',
    aliases: [],
    description: 'Repeat your text as the bot (the command message is deleted).',
    usage: '<text>',
    cooldown: 3,
    async execute(message, args, client) {
      const text = args.join(' ');
      if (!text) return message.reply({ embeds: [helpers.usageError(client, message, 'say <text>')] });

      await message.delete().catch(() => {});
      return message.channel.send(text);
    },
  },

  {
    name: 'hug',
    aliases: [],
    description: 'Give a member a warm hug.',
    usage: '<@user>',
    cooldown: 3,
    async execute(message, args, client) {
      return message.reply({ embeds: [await actionEmbed('🤗', 'hug', message, args, client)] });
    },
  },

  {
    name: 'slap',
    aliases: [],
    description: 'Slap a member. Gently. Probably.',
    usage: '<@user>',
    cooldown: 3,
    async execute(message, args, client) {
      return message.reply({ embeds: [await actionEmbed('👋', 'slap', message, args, client)] });
    },
  },

  {
    name: 'kiss',
    aliases: [],
    description: 'Blow a kiss to a member.',
    usage: '<@user>',
    cooldown: 3,
    async execute(message, args, client) {
      return message.reply({ embeds: [await actionEmbed('💋', 'kiss', message, args, client)] });
    },
  },

  {
    name: 'pat',
    aliases: [],
    description: 'Pat a member on the head.',
    usage: '<@user>',
    cooldown: 3,
    async execute(message, args, client) {
      return message.reply({ embeds: [await actionEmbed('🤚', 'pat', message, args, client)] });
    },
  },

  {
    name: 'poke',
    aliases: [],
    description: 'Poke a member until they respond.',
    usage: '<@user>',
    cooldown: 3,
    async execute(message, args, client) {
      return message.reply({ embeds: [await actionEmbed('👉', 'poke', message, args, client)] });
    },
  },

  {
    name: 'wave',
    aliases: [],
    description: 'Wave at a member.',
    usage: '<@user>',
    cooldown: 3,
    async execute(message, args, client) {
      return message.reply({ embeds: [await actionEmbed('👋', 'wave', message, args, client)] });
    },
  },

  {
    name: 'highfive',
    aliases: [],
    description: 'Give a member a victorious high-five.',
    usage: '<@user>',
    cooldown: 3,
    async execute(message, args, client) {
      return message.reply({ embeds: [await actionEmbed('🖐️', 'highfive', message, args, client)] });
    },
  },
];
