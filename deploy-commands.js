
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const {
    REST,
    Routes,
    ApplicationCommandType
} = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const PASTA_COMANDOS = path.join(__dirname, 'commands');

function chaveComando(dados) {
    return `${dados.type ?? ApplicationCommandType.ChatInput}:${dados.name}`;
}

function carregarComandos() {
    if (!fs.existsSync(PASTA_COMANDOS)) {
        throw new Error('A pasta commands não foi encontrada.');
    }

    const arquivos = fs.readdirSync(PASTA_COMANDOS, {
        withFileTypes: true
    })
        .filter(arquivo =>
            arquivo.isFile() &&
            arquivo.name.endsWith('.js')
        )
        .map(arquivo => arquivo.name)
        .sort();

    if (!arquivos.length) {
        throw new Error(
            'Nenhum comando encontrado na pasta commands.'
        );
    }

    const comandos = [];
    const nomes = new Set();

    for (const arquivo of arquivos) {
        const comando = require(
            path.join(PASTA_COMANDOS, arquivo)
        );

        if (
            !comando?.data ||
            typeof comando.data.toJSON !== 'function' ||
            typeof comando.execute !== 'function'
        ) {
            throw new Error(
                `Comando inválido em commands/${arquivo}: ` +
                'data e execute() são obrigatórios.'
            );
        }

        const dados = comando.data.toJSON();

        if (
            !dados ||
            typeof dados.name !== 'string' ||
            dados.name.length < 1 ||
            dados.name.length > 32
        ) {
            throw new Error(
                `Nome inválido em commands/${arquivo}.`
            );
        }

        const chave = chaveComando(dados);

        if (nomes.has(chave)) {
            throw new Error(
                `Comando duplicado: /${dados.name}.`
            );
        }

        JSON.stringify(dados);

        nomes.add(chave);
        comandos.push(dados);

        console.log(
            `[InovareSale] Encontrado: /${dados.name} (${arquivo})`
        );
    }

    for (const nome of ['warn', 'ban']) {
        const existe = comandos.some(comando =>
            comando.name === nome &&
            (
                comando.type ??
                ApplicationCommandType.ChatInput
            ) === ApplicationCommandType.ChatInput
        );

        if (!existe) {
            console.warn(
                `[InovareSale] ATENÇÃO: /${nome} ` +
                'não foi encontrado na pasta commands.'
            );

            console.warn(
                `[InovareSale] O deploy não pode publicar ` +
                `/${nome} sem o arquivo correspondente.`
            );
        }
    }

    return comandos;
}

async function registrarComandos() {
    if (!TOKEN || typeof TOKEN !== 'string') {
        throw new Error(
            'DISCORD_TOKEN não configurado.'
        );
    }

    const comandos = carregarComandos();

    const rest = new REST({
        version: '10'
    }).setToken(TOKEN);

    const aplicacao = await rest.get(
        Routes.oauth2CurrentApplication()
    );

    const aplicacaoId = String(
        aplicacao?.id || ''
    );

    if (!/^\d{15,22}$/.test(aplicacaoId)) {
        throw new Error(
            'Não foi possível identificar a aplicação do Discord.'
        );
    }

    console.log(
        `[InovareSale] Aplicação: ${aplicacaoId}`
    );

    console.log(
        `[InovareSale] Publicando ${comandos.length} ` +
        'comando(s) globais...'
    );

    const rota = Routes.applicationCommands(
        aplicacaoId
    );

    const anteriores = await rest.get(rota);

    if (!Array.isArray(anteriores)) {
        throw new Error(
            'Não foi possível consultar os comandos existentes.'
        );
    }

    const existentes = new Map(
        anteriores.map(comando => [
            chaveComando(comando),
            comando
        ])
    );

    let criados = 0;
    let atualizados = 0;

    for (const dados of comandos) {
        const anterior = existentes.get(
            chaveComando(dados)
        );

        let publicado;

        if (anterior) {
            publicado = await rest.patch(
                Routes.applicationCommand(
                    aplicacaoId,
                    anterior.id
                ),
                {
                    body: dados
                }
            );

            atualizados++;
        } else {
            publicado = await rest.post(
                rota,
                {
                    body: dados
                }
            );

            criados++;
        }

        if (
            !publicado?.id ||
            publicado.name !== dados.name
        ) {
            throw new Error(
                `Falha ao confirmar a publicação de /${dados.name}.`
            );
        }

        console.log(
            `[InovareSale] ${
                anterior ? 'Atualizado' : 'Criado'
            }: /${dados.name}`
        );
    }

    const confirmados = await rest.get(
        rota
    );

    if (!Array.isArray(confirmados)) {
        throw new Error(
            'Não foi possível conferir os comandos publicados.'
        );
    }

    const nomesConfirmados = new Set(
        confirmados.map(chaveComando)
    );

    const faltando = comandos.filter(
        comando =>
            !nomesConfirmados.has(
                chaveComando(comando)
            )
    );

    if (faltando.length) {
        throw new Error(
            'Comandos não encontrados na verificação: ' +
            faltando.map(
                comando => `/${comando.name}`
            ).join(', ')
        );
    }

    for (const nome of ['warn', 'ban']) {
        const chave = `${ApplicationCommandType.ChatInput}:${nome}`;

        console.log(
            `[InovareSale] /${nome}: ${
                nomesConfirmados.has(chave)
                    ? 'registrado globalmente'
                    : 'NÃO registrado'
            }`
        );
    }

    const locais = new Set(
        comandos.map(chaveComando)
    );

    const preservados = confirmados.filter(
        comando =>
            !locais.has(
                chaveComando(comando)
            )
    );

    console.log(
        `[InovareSale] Criados: ${criados}`
    );

    console.log(
        `[InovareSale] Atualizados: ${atualizados}`
    );

    console.log(
        `[InovareSale] Comandos antigos preservados: ${preservados.length}`
    );

    console.log(
        '[InovareSale] Registro de comandos concluído.'
    );

    return {
        total: comandos.length,
        criados,
        atualizados,
        preservados: preservados.length
    };
}

if (require.main === module) {
    registrarComandos().catch(erro => {
        console.error(
            '[InovareSale] Falha ao registrar comandos:',
            erro
        );

        process.exitCode = 1;
    });
}

module.exports = {
    carregarComandos,
    registrarComandos
};
