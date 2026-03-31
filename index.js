const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActivityType,
  Partials,
  PermissionsBitField,
  Collection,
  IntentsBitField
} = require('discord.js');

const sqlite3 = require('sqlite3').verbose();

 // Import
const { Intents } = require('discord.js');


const client = new Client({
  intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildModeration,
  GatewayIntentBits.GuildEmojisAndStickers,
  GatewayIntentBits.GuildIntegrations,
  GatewayIntentBits.GuildWebhooks,
  GatewayIntentBits.GuildInvites,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildPresences,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.GuildMessageTyping,
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.DirectMessageReactions,
  GatewayIntentBits.DirectMessageTyping,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildScheduledEvents,
  GatewayIntentBits.AutoModerationConfiguration,
  GatewayIntentBits.AutoModerationExecution
  ], 
  partials: [
    Partials.User,
    Partials.Channel,
    Partials.GuildMember,
    Partials.Message,
    Partials.Reaction
  ]
});

const permissions = [ 
  PermissionsBitField.Flags.Administrator
];


// ================= DATABASE =================
const db = new sqlite3.Database('./data.db');

// MESSAGE TABLE
db.run(`
CREATE TABLE IF NOT EXISTS messages (
  userId TEXT,
  guildId TEXT,
  count INTEGER DEFAULT 0,
  PRIMARY KEY (userId, guildId)
)
`),

// VOICE TABLE
db.run(`
CREATE TABLE IF NOT EXISTS voice (
  userId TEXT,
  guildId TEXT,
  time INTEGER DEFAULT 0,
  PRIMARY KEY (userId, guildId)
)
`),

// SKULL TABLE
db.run(`
CREATE TABLE IF NOT EXISTS skulls (
  userId TEXT,
  guildId TEXT,
  count INTEGER DEFAULT 0,
  PRIMARY KEY (userId, guildId)
)
`),

// CONFIG TABLE (LDB CHANNEL)
db.run(`
CREATE TABLE IF NOT EXISTS config (
  guildId TEXT PRIMARY KEY,
  ldbChannel TEXT
)
`);

const voiceJoin = {};

// ================= READY =================
const updateStatus = () => {
  const guildCount = client.guilds.cache.size;

  let userCount = 0;
  client.guilds.cache.forEach(g => {
    userCount += g.memberCount || 0;
  });

  client.user.setPresence({
    activities: [
      {
        name: `${userCount} users in ${guildCount} servers`,
        type: ActivityType.Watching
      }
    ],
    status: "online"
  });
};

client.once('ready', () => {
  updateStatus();
  setInterval(updateStatus, 30000);
});

// ================= MESSAGE EVENT =================
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const content = message.content.toLowerCase();
  const userId = message.author.id;
  const guildId = message.guild.id;

  // ================= MESSAGE TRACK =================
  db.run(`
    INSERT INTO messages (userId, guildId, count)
    VALUES (?, ?, 1)
    ON CONFLICT(userId, guildId)
    DO UPDATE SET count = count + 1
  `, [userId, guildId]);

  // ================= CHECK LDB CHANNEL =================
  const isAllowed = await new Promise((resolve) => {
    db.get(
      `SELECT ldbChannel FROM config WHERE guildId = ?`,
      [guildId],
      (err, row) => {
        if (err || !row) return resolve(false);
        resolve(row.ldbChannel === message.channel.id);
      }
    );
  });

  // ================= BLOCK LDB COMMANDS OUTSIDE CHANNEL =================
  const ldbCommands = ["!msgldb", "!vcldb", "!skulls"];

  if (ldbCommands.includes(content) && !isAllowed) {
    return message.reply("❌ These commands can only be used in the LDB channel.");
  }

  // ================= ADMIN SET LDB =================
  if (message.content.startsWith("!setldb")) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply("❌ Only admins can set LDB channel.");
    }

    const target = message.mentions.channels.first();
    if (!target) {
      return message.reply("⚠️ Usage: `!setldb #channel`");
    }

    db.run(
      `INSERT INTO config (guildId, ldbChannel)
       VALUES (?, ?)
       ON CONFLICT(guildId)
       DO UPDATE SET ldbChannel = excluded.ldbChannel`,
      [guildId, target.id],
      (err) => {
        if (err) return message.reply("❌ Failed to set LDB channel.");
        message.reply(`✅ LDB channel set to ${target}`);
      }
    );

    return;
  }

  // ================= COMMANDS =================
  if (content === "!help") {
    return message.reply("!msgldb | !vcldb | !skulls | !setldb");
  }

  if (content === "!msgldb")
    return sendLeaderboard(message, "messages", "Messages", "count");

  if (content === "!vcldb")
    return sendLeaderboard(message, "voice", "Voice", "time");

  if (content === "!skulls")
    return sendLeaderboard(message, "skulls", "Skulls", "count");
}),
// ================= VOICE TRACK =================
client.on('voiceStateUpdate', (oldState, newState) => {
  const userId = newState.id;
  const guildId = newState.guild.id;

  if (!oldState.channelId && newState.channelId) {
    voiceJoin[userId] = Date.now();
  }

  if (oldState.channelId && !newState.channelId) {
    if (!voiceJoin[userId]) return;

    const timeSpent = Date.now() - voiceJoin[userId];
    delete voiceJoin[userId];

    db.run(`
      INSERT INTO voice (userId, guildId, time)
      VALUES (?, ?, ?)
      ON CONFLICT(userId, guildId)
      DO UPDATE SET time = time + ?
    `, [userId, guildId, timeSpent, timeSpent]);
  }
});

// ================= SKULL REACTIONS =================
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;

  if (reaction.partial) await reaction.fetch();
  if (reaction.message.partial) await reaction.message.fetch();

  if (reaction.emoji.name !== "💀") return;

  const author = reaction.message.author;
  if (!author || author.bot) return;

  const guildId = reaction.message.guild.id;

  db.run(`
    INSERT INTO skulls (userId, guildId, count)
    VALUES (?, ?, 1)
    ON CONFLICT(userId, guildId)
    DO UPDATE SET count = count + 1
  `, [author.id, guildId]);
});

// ================= LEADERBOARD =================
async function sendLeaderboard(message, table, title, column) {
  const guildId = message.guild.id;

  db.all(`
    SELECT * FROM ${table}
    WHERE guildId = ?
    ORDER BY ${column} DESC
    LIMIT 50
    `, [guildId], async (err, rows) => {
      if (!rows?.length) return message.reply("No data yet.");
    let page = 0;
    const perPage = 10;

    const generate = async () => {
      const start = page * perPage;
      const current = rows.slice(start, start + perPage);

      let desc = "";

      for (let i = 0; i < current.length; i++) {
        const user = await client.users.fetch(current[i].userId).catch(() => null);
        const name = user ? user.username : "Unknown";

        if (table === "voice") {
          const ms = current[i].time;
          const h = Math.floor(ms / (1000 * 60 * 60));
          const m = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
          desc += `**${start + i + 1}. ${name} - ${h}h ${m}m**\n`;
        } else {
          desc += `**${start + i + 1}. ${name} - ${current[i].count}**\n`;
        }
      }

      return new EmbedBuilder()
        .setTitle(`${message.guild.name} • ${title} Leaderboard`)
        .setDescription(desc)
        .setColor("Purple")
        .setFooter({ text: `Page ${page + 1}` });
    };

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("prev").setLabel("⬅️").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("next").setLabel("➡️").setStyle(ButtonStyle.Primary)
    );

    const msg = await message.reply({
      embeds: [await generate()],
      components: [row]
    });

    const collector = msg.createMessageComponentCollector({ time: 60000 });

    collector.on("collect", async (i) => {
      if (i.user.id !== message.author.id)
        return i.reply({ content: "Not yours.", ephemeral: true });

      if (i.customId === "prev") page--;
      if (i.customId === "next") page++;

      const maxPage = Math.ceil(rows.length / perPage) - 1;
      page = Math.max(0, Math.min(page, maxPage));

      await i.update({ embeds: [await generate()] });
    });
  });
}

// ================= FUN COMMAND =================
 
client.on("messageCreate", (message) => {
  if (message.author.bot) return;

  if (message.content.toLowerCase() === "!howgay") {
    const percent = Math.floor(Math.random() * 101);

    let comment = "";

    if (percent < 20) comment = "ur straight but got potential 📉";
    else if (percent < 50) comment = "sussy baka 👀";
    else if (percent < 80) comment = "nani ?! femboy dayo 😂";
    else comment = "ur a total furry bro";

    return message.reply(`🌈 You are ${percent}% chaotic. ${comment}`);
  }
});

// Uwu patterns

const uwuLocks = new Map();

const uwuPatterns = [
  { find: /\bmy\b/gi, replace: 'mwu' },
  { find: /\bme\b/gi, replace: 'mwu' },
  { find: /r/gi, replace: 'w' },
  { find: /l/gi, replace: 'w' },
  { find: /!/g, replace: '!! ' },
  { find: /\?/g, replace: '? UwU' },
  { find: /\./g, replace: ' owo' }
];

const uwuFaces = [' UwU', ' :3', ' ^w^', ' owo'];

function uwuify(text) {
  let uwuText = text.toLowerCase();

  uwuPatterns.forEach(({ find, replace }) => {
    uwuText = uwuText.replace(find, replace);
  });

  if (Math.random() < 0.3) {
    uwuText += uwuFaces[Math.floor(Math.random() * uwuFaces.length)];
  }

  return uwuText.charAt(0).toUpperCase() + uwuText.slice(1);
}

client.on('ready', () => {
  console.log(`${client.user.tag} is online - UWU LOCK READY`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // 🔒 Check if user is uwu locked
  if (uwuLocks.has(message.author.id)) {
    try {
      await message.delete();
      const uwuMsg = uwuify(message.content);
      const fake = await message.channel.send(`**${message.author.username}:** ${uwuMsg}`);
      await fake.react('💕');
    } catch (err) {
      console.log("Error:", err.message);
    }
    return;
  }

  // Commands
  if (!message.content.startsWith('!')) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === 'uwulock') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply('❌ Missing admin perms!');
    }

    const targetUser = message.mentions.users.first();
    if (!targetUser) {
      return message.reply('Usage: `!uwulock @user [seconds]`');
    }

    const duration = parseInt(args[0]) || 30;

    if (targetUser.id === message.author.id) {
      return message.reply("💀 You can't uwu yourself!");
    }

    uwuLocks.set(targetUser.id, true);

    message.reply(`🔒 <@${targetUser.id}> is UWU-LOCKED for ${duration}s!`);

    setTimeout(() => {
      uwuLocks.delete(targetUser.id);
      message.channel.send(`✅ <@${targetUser.id}> uwu-lock expired!`);
    }, duration * 1000);
  }
});
 client.login('ur bot token here '); 