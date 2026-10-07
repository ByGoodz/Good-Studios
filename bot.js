require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    Collection,
    Events
} = require('discord.js');


// ==========================================
// COMANDOS
// ==========================================

const setup = require('./commands/setup');
const estoque = require('./commands/estoque');
const venda = require('./commands/venda');


// ==========================================
// EVENTOS
// ==========================================

const interactionCreate = require('./events/interactionCreate');
const messageCreate = require('./events/messageCreate');


// ==========================================
// CLIENTE DO DISCORD
// ==========================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,

        // Necessário para cargos automáticos
        GatewayIntentBits.GuildMembers,

        // Necessário para detectar mensagens nos canais
        GatewayIntentBits.GuildMessages,

        // ESSENCIAL PARA A CALCULADORA
        // Permite ler "5000", "5k", "R$ 100" etc.
        GatewayIntentBits.MessageContent
    ]
});


// ==========================================
// COLEÇÃO DE COMANDOS
// ==========================================

client.commands = new Collection();

client.commands.set(
    setup.data.name,
    setup
);

client.commands.set(
    estoque.data.name,
    estoque
);

client.commands.set(
    venda.data.name,
    venda
);


// ==========================================
// EVENTO DE INTERAÇÕES
// /setup
// /estoque
// /venda
// botões
// menus
// modais
// ==========================================

client.on(
    Events.InteractionCreate,
    (...args) => {
        interactionCreate.execute(
            ...args,
            client
        );
    }
);


// ==========================================
// EVENTO DE MENSAGENS
// CALCULADORA
// ==========================================

client.on(
    Events.MessageCreate,
    (...args) => {
        messageCreate.execute(
            ...args,
            client
        );
    }
);


// ==========================================
// QUANDO O BOT FICAR ONLINE
// ==========================================

client.once(
    Events.ClientReady,
    bot => {

        console.log('');
        console.log('======================================');
        console.log('       INOVARESALE BOT ONLINE');
        console.log('======================================');
        console.log('');

        console.log(
            `✅ Bot online: ${bot.user.tag}`
        );

        console.log(
            '✅ /setup carregado'
        );

        console.log(
            '✅ /estoque carregado'
        );

        console.log(
            '✅ /venda carregado'
        );

        console.log(
            '✅ Calculadora por mensagens carregada'
        );

        console.log(
            '✅ GuildMessages ativado'
        );

        console.log(
            '✅ MessageContent ativado'
        );

        console.log('');
        console.log(
            '🚀 Railway conectado com sucesso'
        );
        console.log('');
    }
);


// ==========================================
// ERROS DO DISCORD
// ==========================================

client.on(
    'error',
    erro => {

        console.error(
            '❌ Erro do Discord:',
            erro
        );
    }
);


// ==========================================
// ERROS NÃO TRATADOS
// ==========================================

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
// VERIFICAR TOKEN SEM MOSTRAR O TOKEN
// ==========================================

console.log(
    'TOKEN EXISTE:',
    !!process.env.DISCORD_TOKEN
);

console.log(
    'TAMANHO TOKEN:',
    process.env.DISCORD_TOKEN?.length
);


// ==========================================
// LOGIN
// ==========================================

client.login(
    process.env.DISCORD_TOKEN
);