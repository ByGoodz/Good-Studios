
'use strict';

// ==========================================
// INOVARESALE BOT 3.0
// REGISTRO DE COMANDOS DO DISCORD
// ==========================================
//
// Este arquivo:
//
// - Lê todos os comandos da pasta commands
// - Verifica se cada comando é válido
// - Impede nomes duplicados
// - Identifica a aplicação pelo token
// - Consulta comandos globais existentes
// - Atualiza comandos com nomes existentes
// - Cadastra comandos novos
// - Não exclui comandos automaticamente
//
// IMPORTANTE:
//
// Não inicia o bot.
// Não modifica o SQLite.
// Não executa migrações.
//
// Só publica os comandos quando
// executado manualmente através de:
//
// npm run deploy

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const {
    REST,
    Routes,
    ApplicationCommandType
} = require('discord.js');

// ==========================================
// CONFIGURAÇÕES
// ==========================================

const TOKEN = process.env.DISCORD_TOKEN;

const PASTA_COMANDOS = path.join(
    __dirname,
    'commands'
);

// ==========================================
// LISTAR ARQUIVOS
// ==========================================

function listarArquivosComandos() {
    if (!fs.existsSync(PASTA_COMANDOS)) {
        throw new Error(
            'A pasta commands não foi encontrada.'
        );
    }

    const arquivos = fs.readdirSync(
        PASTA_COMANDOS,
        {
            withFileTypes: true
        }
    )
        .filter(arquivo =>
            arquivo.isFile() &&
            arquivo.name.endsWith('.js')
        )
        .map(arquivo => arquivo.name)
        .sort();

    if (arquivos.length === 0) {
        throw new Error(
            'Nenhum arquivo JavaScript foi encontrado ' +
            'na pasta commands.'
        );
    }

    return arquivos;
}

// ==========================================
// IDENTIFICADOR ÚNICO DO COMANDO
// ==========================================

// O Discord permite comandos de tipos
// diferentes com o mesmo nome.
//
// Para comandos slash, o tipo é 1.
//
// Mantemos o tipo no identificador
// para evitar conflitos incorretos.

function chaveComando(dados) {
    const tipo =
        dados.type ??
        ApplicationCommandType.ChatInput;

    return `${tipo}:${dados.name}`;
}

// ==========================================
// VALIDAR COMANDO
// ==========================================

function validarComando(
    comando,
    arquivo
) {
    if (
        !comando?.data ||
        typeof comando.data.toJSON !==
            'function' ||
        typeof comando.execute !==
            'function'
    ) {
        throw new Error(
            `O arquivo commands/${arquivo} ` +
            'precisa exportar data e execute().'
        );
    }

    const dados =
        comando.data.toJSON();

    if (
        !dados ||
        typeof dados.name !== 'string' ||
        dados.name.length < 1 ||
        dados.name.length > 32
    ) {
        throw new Error(
            `Nome de comando inválido: ${arquivo}`
        );
    }

    // Garantir que os dados possam ser
    // serializados antes de enviar
    // qualquer coisa ao Discord.

    try {
        JSON.stringify(dados);
    } catch {
        throw new Error(
            `O comando ${arquivo} contém ` +
            'dados que não podem ser enviados.'
        );
    }

    return dados;
}

// ==========================================
// CARREGAR COMANDOS
// ==========================================

function carregarComandos() {
    const arquivos =
        listarArquivosComandos();

    const comandos = [];

    const nomes =
        new Set();

    for (const arquivo of arquivos) {
        const caminho = path.join(
            PASTA_COMANDOS,
            arquivo
        );

        const comando =
            require(caminho);

        const dados =
            validarComando(
                comando,
                arquivo
            );

        const chave =
            chaveComando(dados);

        if (nomes.has(chave)) {
            throw new Error(
                `Comando duplicado: /${dados.name}`
            );
        }

        nomes.add(chave);

        comandos.push(dados);

        console.log(
            `📦 Comando encontrado: /${dados.name}`
        );
    }

    console.log(
        `[InovareSale] ${comandos.length} ` +
        'comando(s) válido(s).'
    );

    return comandos;
}

// ==========================================
// VALIDAR TOKEN
// ==========================================

function verificarToken() {
    if (
        typeof TOKEN !== 'string' ||
        !TOKEN.trim()
    ) {
        throw new Error(
            'DISCORD_TOKEN não configurado. ' +
            'Verifique o arquivo .env.'
        );
    }
}

// ==========================================
// OBTER ID DA APLICAÇÃO
// ==========================================

async function obterAplicacao(rest) {
    const aplicacao =
        await rest.get(
            Routes.oauth2CurrentApplication()
        );

    if (
        !aplicacao?.id ||
        !/^\d{15,22}$/.test(
            String(aplicacao.id)
        )
    ) {
        throw new Error(
            'Não foi possível identificar ' +
            'a aplicação do bot.'
        );
    }

    return aplicacao;
}

// ==========================================
// CONSULTAR COMANDOS EXISTENTES
// ==========================================

async function consultarComandosDiscord(
    rest,
    aplicacaoId
) {
    const existentes =
        await rest.get(
            Routes.applicationCommands(
                aplicacaoId
            )
        );

    if (!Array.isArray(existentes)) {
        throw new Error(
            'O Discord não retornou uma lista ' +
            'válida de comandos existentes.'
        );
    }

    return existentes;
}

// ==========================================
// REGISTRAR COMANDOS
// ==========================================

async function registrarComandos() {
    verificarToken();

    // ======================================
    // VALIDAR TODOS OS ARQUIVOS PRIMEIRO
    // ======================================

    // Se algum comando estiver inválido,
    // a publicação não começa.

    const comandos =
        carregarComandos();

    // ======================================
    // CRIAR CONEXÃO COM A API DO DISCORD
    // ======================================

    const rest =
        new REST({
            version: '10'
        }).setToken(TOKEN);

    // ======================================
    // IDENTIFICAR APLICAÇÃO
    // ======================================

    const aplicacao =
        await obterAplicacao(rest);

    const aplicacaoId =
        aplicacao.id;

    console.log('');
    console.log(
        '💜 INOVARESALE BOT 3.0'
    );
    console.log(
        '🔄 Preparando comandos globais...'
    );
    console.log(
        `🤖 Aplicação: ${aplicacaoId}`
    );
    console.log('');

    // ======================================
    // CONSULTAR COMANDOS JÁ REGISTRADOS
    // ======================================

    const existentes =
        await consultarComandosDiscord(
            rest,
            aplicacaoId
        );

    const mapaExistentes =
        new Map();

    for (const comando of existentes) {
        mapaExistentes.set(
            chaveComando(comando),
            comando
        );
    }

    // ======================================
    // PUBLICAR COMANDOS INDIVIDUALMENTE
    // ======================================

    // POST com o mesmo nome e tipo
    // atualiza o comando existente.
    //
    // POST de um nome novo
    // cadastra esse comando.
    //
    // Não usamos PUT em toda a lista.
    //
    // Assim, outros comandos não
    // são excluídos automaticamente.

    let atualizados = 0;
    let criados = 0;

    for (const dados of comandos) {
        const chave =
            chaveComando(dados);

        const anterior =
            mapaExistentes.get(chave);

        console.log(
            `${anterior ? '🔄' : '➕'} ` +
            `Processando /${dados.name}...`
        );

        const registrado =
            await rest.post(
                Routes.applicationCommands(
                    aplicacaoId
                ),
                {
                    body: dados
                }
            );

        if (
            !registrado?.id ||
            registrado.name !== dados.name
        ) {
            throw new Error(
                `Não foi possível confirmar ` +
                `o comando /${dados.name}.`
            );
        }

        if (anterior) {
            atualizados++;

            console.log(
                `✅ Atualizado: /${dados.name}`
            );

        } else {
            criados++;

            console.log(
                `✅ Criado: /${dados.name}`
            );
        }

        mapaExistentes.set(
            chave,
            registrado
        );
    }

    // ======================================
    // IDENTIFICAR COMANDOS EXTRAS
    // ======================================

    // Comandos globais antigos que
    // não estão na pasta commands
    // permanecem no Discord.
    //
    // Isso evita exclusões acidentais.
    //
    // A remoção de comandos obsoletos
    // deverá ser feita separadamente
    // após revisão.

    const nomesLocais = new Set(
        comandos.map(
            chaveComando
        )
    );

    const extras =
        existentes.filter(comando =>
            !nomesLocais.has(
                chaveComando(comando)
            )
        );

    // ======================================
    // RESULTADO
    // ======================================

    console.log('');
    console.log(
        '======================================'
    );
    console.log(
        '💜 INOVARESALE - COMANDOS'
    );
    console.log(
        '======================================'
    );

    console.log(
        `✅ Comandos atualizados: ${atualizados}`
    );

    console.log(
        `✅ Comandos criados: ${criados}`
    );

    console.log(
        `📦 Comandos processados: ${comandos.length}`
    );

    if (extras.length > 0) {
        console.log('');
        console.warn(
            `⚠️ ${extras.length} comando(s) global(is) ` +
            'existente(s) não estão na pasta commands.'
        );

        for (const comando of extras) {
            console.warn(
                `   • /${comando.name}`
            );
        }

        console.warn(
            'Eles foram preservados. ' +
            'Revise-os antes de removê-los.'
        );
    }

    console.log('');
    console.log(
        '🎉 Registro de comandos finalizado!'
    );

    console.log(
        '💜 InovareSale Bot 3.0'
    );
    console.log('');

    return {
        total: comandos.length,
        atualizados,
        criados,
        preservados: extras.length
    };
}

// ==========================================
// EXECUTAR APENAS MANUALMENTE
// ==========================================

// Importar este arquivo com require()
// não publica comandos automaticamente.

if (require.main === module) {
    registrarComandos().catch(erro => {
        console.error('');
        console.error(
            '❌ Falha ao registrar comandos:',
            erro
        );

        console.error(
            '⚠️ Alguns comandos anteriores ' +
            'podem ter sido atualizados antes ' +
            'da falha. Confira o resultado.'
        );

        process.exitCode = 1;
    });
}

// ==========================================
// EXPORTAR FUNÇÕES
// ==========================================

module.exports = {
    carregarComandos,
    registrarComandos
};
