require('dotenv').config();

const {
    Client,
    Collection,
    GatewayIntentBits,
    Events
} = require('discord.js');

const setup = require('./commands/setup');
const estoque = require('./commands/estoque');
const venda = require('./commands/venda');

const interactionCreate = require('./events/interactionCreate');
const messageCreate = require('./events/messageCreate');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.commands = new Collection();

client.commands.set(setup.data.name, setup);
client.commands.set(estoque.data.name, estoque);
client.commands.set(venda.data.name, venda);

client.on(
    interactionCreate.name,
    (...args) => interactionCreate.execute(...args, client)
);

client.on(
    messageCreate.name,
    (...args) => messageCreate.execute(...args, client)
);

client.once(Events.ClientReady, bot => {
    console.log(`✅ Bot online: ${bot.user.tag}`);
    console.log('✅ /setup carregado');
    console.log('✅ /estoque carregado');
    console.log('✅ /venda carregado');
    console.log('✅ Este arquivo NÃO altera os comandos do Discord.');
});

client.login(process.env.DISCORD_TOKEN);