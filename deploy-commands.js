
'use strict';

// ==========================================
// INOVARESALE BOT 2.0
// REGISTRO AUTOMATICO DOS COMANDOS
// ==========================================

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const {
    REST,
    Routes
} = require('discord.js');

// ==========================================
// CONFIGURACOES
// ==========================================

const TOKEN = process.env.DISCORD_TOKEN;

const PASTA_COMANDOS = path.join(
    __dirname,
    'commands'
);

// ==========================================
// CARREGAR COMANDOS
// ==========================================

function carregarComandos() {
    if (!fs.existsSync(PASTA_COMANDOS)) {
        throw new Error(
            'A pasta commands não foi encontrada.'
        );
    }

    const arquivos = fs.readdirSync(
        PASTA_COMANDOS
    ).filter(
        arquivo => arquivo.endsWith('.js')
    );

    const comandos = [];
    const nomes = new Set();

    for (const arquivo of arquivos) {
        const caminho = path.join(
            PASTA_COMANDOS,
            arquivo
        );

        const comando = require(caminho);

        if (
            !comando.data ||
            typeof comando.data.toJSON !== 'function'
        ) {
            throw new Error(
                `O arquivo ${arquivo} não possui um comando válido em "data".`
            );
        }

        const dados = comando.data.toJSON();

        if (!dados.name) {
            throw new Error(
                `O comando em ${arquivo} não possui nome.`
            );
        }

        if (nomes.has(dados.name)) {
            throw new Error(
                `Comando duplicado: /${dados.name}`
            );
        }

        nomes.add(dados.name);
        comandos.push(dados);

        console.log(
            `✅ Comando encontrado: /${dados.name}`
        );
    }

    if (comandos.length === 0) {
        throw new Error(
            'Nenhum comando foi encontrado.'
        );
    }

    return comandos;
}

// ==========================================
// REGISTRAR COMANDOS NO DISCORD
// ==========================================

async function registrarComandos() {
    if (!TOKEN) {
        throw new Error(
            'DISCORD_TOKEN não foi encontrado no .env.'
        );
    }

    const comandos = carregarComandos();

    const rest = new REST({
        version: '10'
    }).setToken(TOKEN);

    // Buscar o ID da aplicação pelo próprio token.
    const aplicacao = await rest.get(
        Routes.oauth2CurrentApplication()
    );

    const clientId = aplicacao.id;

    if (!clientId) {
        throw new Error(
            'Não foi possível identificar a aplicação do bot.'
        );
    }

    console.log('');
    console.log(
        '🚀 Registrando comandos da InovareSale...'
    );

    const registrados = await rest.put(
        Routes.applicationCommands(clientId),
        {
            body: comandos
        }
    );

    console.log('');
    console.log(
        `✅ ${registrados.length} comandos registrados com sucesso!`
    );

    for (const comando of registrados) {
        console.log(
            `💎 /${comando.name}`
        );
    }

    console.log('');
    console.log(
        '🎉 InovareSale Bot 2.0 — Comandos atualizados!'
    );
}

// ==========================================
// EXECUTAR
// ==========================================

registrarComandos().catch(erro => {
    console.error(
        '❌ Erro ao registrar comandos:',
        erro
    );

    process.exitCode = 1;
});
