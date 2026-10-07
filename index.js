require('dotenv').config();

const fs = require('fs');
const path = require('path');

const {
    Client,
    Collection,
    GatewayIntentBits,
    Events
} = require('discord.js');


// ==========================================
// CRIAR CLIENTE
// ==========================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});


// ==========================================
// COLEÇÃO DE COMANDOS
// ==========================================

client.commands = new Collection();


// ==========================================
// CARREGAR ARQUIVOS DA PASTA COMMANDS
// ==========================================

const commandsPath = path.join(
    __dirname,
    'commands'
);

const commandFiles = fs
    .readdirSync(commandsPath)
    .filter(file => file.endsWith('.js'));


for (const file of commandFiles) {

    const filePath = path.join(
        commandsPath,
        file
    );

    const command = require(filePath);


    if (
        !command.data ||
        !command.execute
    ) {

        console.log(
            `⚠️ Comando ignorado: ${file}`
        );

        continue;
    }


    client.commands.set(
        command.data.name,
        command
    );


    console.log(
        `📦 Comando carregado: /${command.data.name}`
    );
}


// ==========================================
// CARREGAR EVENTOS
// ==========================================

const eventsPath = path.join(
    __dirname,
    'events'
);

const eventFiles = fs
    .readdirSync(eventsPath)
    .filter(file => file.endsWith('.js'));


for (const file of eventFiles) {

    const filePath = path.join(
        eventsPath,
        file
    );

    const event = require(filePath);


    if (
        !event.name ||
        !event.execute
    ) {

        console.log(
            `⚠️ Evento ignorado: ${file}`
        );

        continue;
    }


    if (event.once) {

        client.once(
            event.name,
            (...args) => {
                event.execute(
                    ...args,
                    client
                );
            }
        );

    } else {

        client.on(
            event.name,
            (...args) => {
                event.execute(
                    ...args,
                    client
                );
            }
        );
    }


    console.log(
        `⚡ Evento carregado: ${file}`
    );
}


// ==========================================
// QUANDO O BOT FICAR ONLINE
// ==========================================

client.once(
    Events.ClientReady,

    bot => {

        console.log('');
        console.log(
            `✅ InovareSale está online como ${bot.user.tag}!`
        );

        console.log(
            `✅ ${client.commands.size} comandos carregados no bot.`
        );

        console.log(
            '✅ index.js não registra nem apaga comandos do Discord.'
        );
        console.log('');
    }
);


// ==========================================
// ERROS
// ==========================================

client.on(
    'error',
    erro => {

        console.error(
            '❌ Erro no Discord:',
            erro
        );
    }
);


process.on(
    'unhandledRejection',
    erro => {

        console.error(
            '❌ Erro não tratado:',
            erro
        );
    }
);


// ==========================================
// LOGIN
// ==========================================

client.login(
    process.env.DISCORD_TOKEN
);