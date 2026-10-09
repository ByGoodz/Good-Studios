
'use strict';

// ==========================================
// INOVARESALE BOT 2.0 — ARQUIVO PRINCIPAL
// ==========================================
// Este arquivo inicia o bot pelo Discord.
// Nao registra comandos e nao migra dados.

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
    Client,
    Collection,
    Events,
    GatewayIntentBits
} = require('discord.js');

const { verificarArmazenamento } = require('./utils/storage');
const { fecharBanco } = require('./database/db');

const TOKEN = process.env.DISCORD_TOKEN;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.commands = new Collection();

// ==========================================
// CARREGAR COMANDOS DA PASTA commands/
// ==========================================

function carregarComandos() {
    const pasta = path.join(__dirname, 'commands');

    if (!fs.existsSync(pasta)) {
        throw new Error('A pasta commands nao foi encontrada.');
    }

    const arquivos = fs.readdirSync(pasta)
        .filter(nome => nome.endsWith('.js'))
        .sort();

    for (const arquivo of arquivos) {
        const comando = require(path.join(pasta, arquivo));

        if (
            !comando?.data ||
            typeof comando.data.toJSON !== 'function' ||
            typeof comando.execute !== 'function'
        ) {
            throw new Error(
                `O arquivo commands/${arquivo} precisa exportar data e execute().`
            );
        }

        const nome = comando.data.toJSON().name;

        if (!nome || client.commands.has(nome)) {
            throw new Error(
                `Nome de comando ausente ou duplicado: commands/${arquivo}`
            );
        }

        client.commands.set(nome, comando);
        console.log(`✅ Comando carregado: /${nome}`);
    }

    console.log(`📦 Total de comandos: ${client.commands.size}`);
}

// ==========================================
// CARREGAR EVENTOS DA PASTA events/
// ==========================================

function carregarEventos() {
    const pasta = path.join(__dirname, 'events');

    if (!fs.existsSync(pasta)) {
        throw new Error('A pasta events nao foi encontrada.');
    }

    const arquivos = fs.readdirSync(pasta)
        .filter(nome => nome.endsWith('.js'))
        .sort();

    for (const arquivo of arquivos) {
        const evento = require(path.join(pasta, arquivo));

        if (
            !evento?.name ||
            typeof evento.execute !== 'function'
        ) {
            throw new Error(
                `O arquivo events/${arquivo} precisa exportar name e execute().`
            );
        }

        const executar = async (...args) => {
            try {
                await evento.execute(...args, client);
            } catch (erro) {
                console.error(
                    `❌ Erro no evento ${evento.name} (${arquivo}):`,
                    erro
                );
            }
        };

        if (evento.once) {
            client.once(evento.name, executar);
        } else {
            client.on(evento.name, executar);
        }

        console.log(`✅ Evento carregado: ${evento.name}`);
    }

    console.log(`⚡ Total de eventos: ${arquivos.length}`);
}

// ==========================================
// STATUS E DIAGNOSTICOS
// ==========================================

client.once(Events.ClientReady, bot => {
    console.log('');
    console.log('💎 INOVARESALE BOT 2.0 ONLINE!');
    console.log(`🤖 Conta: ${bot.user.tag}`);
    console.log(`🏠 Servidores: ${bot.guilds.cache.size}`);
    console.log('');
});

client.on(Events.Error, erro => {
    console.error('❌ Erro na conexao com o Discord:', erro);
});

process.on('unhandledRejection', erro => {
    console.error('❌ Promise rejeitada sem tratamento:', erro);
});

// ==========================================
// ENCERRAMENTO SEGURO (RAILWAY / LOCAL)
// ==========================================

let encerrando = false;

function encerrarBot(sinal) {
    if (encerrando) return;
    encerrando = true;

    console.log(`🛑 Encerrando bot (${sinal})...`);

    try {
        client.destroy();
    } catch (erro) {
        console.error('Erro ao desconectar do Discord:', erro);
    }

    try {
        fecharBanco();
    } catch (erro) {
        console.error('Erro ao fechar o banco:', erro);
    }

    process.exit(0);
}

process.once('SIGINT', () => encerrarBot('SIGINT'));
process.once('SIGTERM', () => encerrarBot('SIGTERM'));

// ==========================================
// INICIAR
// ==========================================

async function iniciar() {
    if (!TOKEN) {
        throw new Error(
            'DISCORD_TOKEN nao foi configurado no arquivo .env ou na Railway.'
        );
    }

    // Nunca sobrescrever as vendas antigas com um banco vazio.
    // A migracao sera feita separadamente antes do deploy.
    verificarArmazenamento();

    carregarComandos();
    carregarEventos();

    console.log('🔐 Historico e configuracoes SQLite verificados.');
    console.log('🔄 Conectando ao Discord...');

    await client.login(TOKEN);
}

iniciar().catch(erro => {
    console.error('❌ Nao foi possivel iniciar o InovareSale Bot:', erro);

    try {
        fecharBanco();
    } catch {}

    process.exit(1);
});
