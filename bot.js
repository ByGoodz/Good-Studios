require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    Collection,
    Events
} = require("discord.js");

const setup = require("./commands/setup");
const estoque = require("./commands/estoque");
const venda = require("./commands/venda");

const interactionCreate = require("./events/interactionCreate");
const messageCreate = require("./events/messageCreate");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

client.commands = new Collection();

client.commands.set(setup.data.name, setup);
client.commands.set(estoque.data.name, estoque);
client.commands.set(venda.data.name, venda);

// ================================
// INTERAÇÕES / SLASH COMMANDS
// ================================

client.on(
    Events.InteractionCreate,
    (...args) => interactionCreate.execute(...args, client)
);

// ================================
// EVENTO DE MENSAGENS
// ================================

client.on(
    Events.MessageCreate,
    (...args) => messageCreate.execute(...args, client)
);

// ================================
// BOT ONLINE
// ================================

client.once(Events.ClientReady, bot => {
    console.log(`✅ Bot online: ${bot.user.tag}`);
    console.log("✅ /setup carregado");
    console.log("✅ /estoque carregado");
    console.log("✅ /venda carregado");
    console.log("✅ Railway conectado com sucesso");
});

// ================================
// VERIFICAÇÃO DO TOKEN
// NÃO MOSTRA O TOKEN
// ================================

console.log("TOKEN EXISTE:", !!process.env.DISCORD_TOKEN);
console.log("TAMANHO TOKEN:", process.env.DISCORD_TOKEN?.length);

// ================================
// LOGIN
// ================================

client.login(process.env.DISCORD_TOKEN);