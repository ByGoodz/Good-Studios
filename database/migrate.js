
'use strict';

// ==========================================
// INOVARESALE BOT 3.0
// MIGRAÇÃO SEGURA DO HISTÓRICO
// ==========================================
//
// Este arquivo:
//
// - Importa config.json e sales.json
// - Preserva as compras antigas
// - Não substitui dados já existentes
// - Faz backup do SQLite
// - Faz backup dos JSON originais
// - Verifica a integridade do banco
// - Usa transação na importação
// - Não apaga arquivos
//
// IMPORTANTE:
//
// A migração é executada somente com:
//
// node database/migrate.js
//
// O index.js não chama este arquivo.
//
// Não executa DROP, DELETE ou
// UPDATE nas chaves config e sales.

const fs = require('fs');
const path = require('path');

const {
    db,
    fecharBanco
} = require('./db');

// ==========================================
// CAMINHOS
// ==========================================

const pastaData = path.join(
    __dirname,
    '..',
    'data'
);

const configPath = path.join(
    pastaData,
    'config.json'
);

const salesPath = path.join(
    pastaData,
    'sales.json'
);

const pastaBanco = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, 'storage');

const caminhoBanco = path.join(
    pastaBanco,
    'inovaresale.sqlite'
);

const pastaBackupBanco = path.join(
    pastaBanco,
    'backups'
);

const pastaBackupJSON = path.join(
    pastaData,
    'backups'
);

// ==========================================
// CONSULTAS PREPARADAS
// ==========================================

const buscarDado = db.prepare(`
    SELECT valor
    FROM dados
    WHERE chave = ?
`);

const inserirDado = db.prepare(`
    INSERT INTO dados (
        chave,
        valor,
        atualizado_em
    )
    VALUES (?, ?, CURRENT_TIMESTAMP)
`);

// ==========================================
// FUNÇÕES AUXILIARES
// ==========================================

function ehObjeto(valor) {
    return (
        valor !== null &&
        typeof valor === 'object' &&
        !Array.isArray(valor)
    );
}

function arquivoExiste(caminho) {
    try {
        const info = fs.statSync(caminho);

        return (
            info.isFile() &&
            info.size > 0
        );
    } catch {
        return false;
    }
}

function identificadorBackup() {
    return (
        new Date()
            .toISOString()
            .replace(/[:.]/g, '-') +
        '-' +
        process.pid
    );
}

// ==========================================
// LER JSON ORIGINAL
// ==========================================

function lerJSON(caminho) {
    if (!arquivoExiste(caminho)) {
        throw new Error(
            'Arquivo original não encontrado ' +
            `ou vazio: ${caminho}`
        );
    }

    let dados;

    try {
        dados = JSON.parse(
            fs.readFileSync(
                caminho,
                'utf8'
            ).replace(/^\uFEFF/, '')
        );

    } catch (erro) {
        throw new Error(
            `JSON inválido em ${caminho}: ` +
            erro.message
        );
    }

    if (!ehObjeto(dados)) {
        throw new Error(
            `O arquivo ${caminho} ` +
            'precisa conter um objeto JSON.'
        );
    }

    return dados;
}

// ==========================================
// VERIFICAR CONTEÚDO DO SQLITE
// ==========================================

function lerDadoExistente(chave) {
    const linha = buscarDado.get(
        chave
    );

    if (!linha) {
        return null;
    }

    let dados;

    try {
        dados = JSON.parse(
            linha.valor
        );

    } catch {
        throw new Error(
            `A chave "${chave}" existe no SQLite, ` +
            'mas contém JSON inválido. ' +
            'Não vamos substituí-la.'
        );
    }

    if (!ehObjeto(dados)) {
        throw new Error(
            `A chave "${chave}" existe, mas ` +
            'não contém um objeto válido.'
        );
    }

    return dados;
}

function dadosJaExistem(chave) {
    return Boolean(
        buscarDado.get(chave)
    );
}

// ==========================================
// CONTAR VENDAS ANTIGAS
// ==========================================

function contarVendas(sales) {
    if (!ehObjeto(sales)) {
        throw new Error(
            'Histórico de vendas inválido.'
        );
    }

    let totalClientes = 0;
    let totalVendas = 0;

    for (
        const servidor
        of Object.values(sales)
    ) {
        if (!ehObjeto(servidor)) {
            continue;
        }

        for (
            const cliente
            of Object.values(servidor)
        ) {
            if (!ehObjeto(cliente)) {
                continue;
            }

            totalClientes++;

            if (
                Array.isArray(
                    cliente.historico
                )
            ) {
                totalVendas +=
                    cliente.historico.length;
            }
        }
    }

    return {
        totalClientes,
        totalVendas
    };
}

// ==========================================
// VERIFICAR INTEGRIDADE DO SQLITE
// ==========================================

function verificarIntegridadeBanco() {
    const resultado = db.pragma(
        'quick_check',
        {
            simple: true
        }
    );

    if (resultado !== 'ok') {
        throw new Error(
            'O SQLite relatou um problema ' +
            'de integridade. Migração interrompida.'
        );
    }
}

// ==========================================
// BACKUP DOS JSON ORIGINAIS
// ==========================================

function criarBackupJSON(
    arquivos,
    identificador
) {
    fs.mkdirSync(
        pastaBackupJSON,
        {
            recursive: true
        }
    );

    const backups = [];

    for (const arquivo of arquivos) {
        const destino = path.join(
            pastaBackupJSON,
            `${arquivo.chave}-${identificador}.json`
        );

        fs.copyFileSync(
            arquivo.caminho,
            destino,
            fs.constants.COPYFILE_EXCL
        );

        // Conferir se a cópia corresponde
        // ao arquivo que será importado.

        const original = fs.readFileSync(
            arquivo.caminho
        );

        const copia = fs.readFileSync(
            destino
        );

        if (!original.equals(copia)) {
            throw new Error(
                'Falha ao verificar backup ' +
                `do arquivo ${arquivo.chave}.`
            );
        }

        backups.push(destino);

        console.log(
            '✅ Backup JSON criado: ' +
            destino
        );
    }

    return backups;
}

// ==========================================
// BACKUP CONSISTENTE DO SQLITE
// ==========================================
//
// VACUUM INTO cria uma cópia do
// banco usando o próprio SQLite.
//
// Isso é mais seguro que copiar
// somente o arquivo .sqlite quando
// o banco trabalha em modo WAL.
//
// O backup precisa ser concluído
// antes de importar qualquer dado.
//
// Se falhar, a migração é interrompida.

function criarBackupBanco(
    identificador
) {
    fs.mkdirSync(
        pastaBackupBanco,
        {
            recursive: true
        }
    );

    const destino = path.join(
        pastaBackupBanco,
        `inovaresale-${identificador}.sqlite`
    );

    // O arquivo de destino
    // não pode existir.

    if (fs.existsSync(destino)) {
        throw new Error(
            'Já existe um backup com ' +
            'este identificador.'
        );
    }

    db.prepare(
        'VACUUM INTO ?'
    ).run(destino);

    if (!arquivoExiste(destino)) {
        throw new Error(
            'A cópia de segurança ' +
            'do SQLite não foi criada.'
        );
    }

    console.log(
        '✅ Backup SQLite criado: ' +
        destino
    );

    return destino;
}

// ==========================================
// COMPARAR HISTÓRICOS
// ==========================================
//
// Uma cópia antiga do sales.json
// pode ter mais ou menos compras
// que o histórico atual no SQLite.
//
// Não misturamos os dados
// automaticamente.
//
// Se houver diferença suspeita,
// avisamos, sem sobrescrever nada.

function conferirHistoricoOriginal(
    salesBanco
) {
    if (!arquivoExiste(salesPath)) {
        return;
    }

    let salesOriginal;

    try {
        salesOriginal = lerJSON(
            salesPath
        );
    } catch (erro) {
        console.warn(
            '⚠️ Não foi possível comparar ' +
            'o sales.json original:',
            erro.message
        );

        return;
    }

    const banco = contarVendas(
        salesBanco
    );

    const original = contarVendas(
        salesOriginal
    );

    console.log(
        `👥 Clientes no SQLite: ${banco.totalClientes}`
    );

    console.log(
        `🛒 Compras no SQLite: ${banco.totalVendas}`
    );

    if (
        original.totalVendas >
        banco.totalVendas
    ) {
        console.warn(
            '⚠️ ATENÇÃO: o sales.json original ' +
            'contém mais entradas de histórico ' +
            'que o SQLite atual.'
        );

        console.warn(
            '⚠️ Nenhum dado será sobrescrito. ' +
            'Confira os backups antes de prosseguir.'
        );
    }
}

// ==========================================
// IMPORTAR UMA CHAVE
// ==========================================
//
// Só permite inserir uma chave
// que ainda não existe.
//
// Não utiliza UPDATE nem REPLACE.
//
// Se a chave aparecer durante
// a operação, a transação falha
// e não sobrescreve o registro.

function importarJSON(
    chave,
    dados
) {
    if (
        chave !== 'config' &&
        chave !== 'sales'
    ) {
        throw new Error(
            'Chave de migração não permitida.'
        );
    }

    if (!ehObjeto(dados)) {
        throw new Error(
            `Dados inválidos para ${chave}.`
        );
    }

    if (dadosJaExistem(chave)) {
        return false;
    }

    const resultado = inserirDado.run(
        chave,
        JSON.stringify(dados)
    );

    return resultado.changes === 1;
}

// ==========================================
// EXECUTAR MIGRAÇÃO
// ==========================================

function migrar() {
    console.log('');
    console.log(
        '========================================'
    );
    console.log(
        '  INOVARESALE BOT 3.0 - MIGRAÇÃO'
    );
    console.log(
        '========================================'
    );
    console.log('');

    console.log(
        '📂 Diretório de dados: ' +
        pastaBanco
    );

    console.log(
        '🗄️ Banco SQLite: ' +
        caminhoBanco
    );

    console.log('');

    // ======================================
    // VERIFICAR SQLITE ANTES DE ALTERAR
    // ======================================

    verificarIntegridadeBanco();

    // ======================================
    // CONSULTAR DADOS EXISTENTES
    // ======================================

    const configExistente =
        lerDadoExistente('config');

    const salesExistente =
        lerDadoExistente('sales');

    const pendencias = [];

    if (configExistente === null) {
        pendencias.push({
            chave: 'config',
            caminho: configPath
        });
    }

    if (salesExistente === null) {
        pendencias.push({
            chave: 'sales',
            caminho: salesPath
        });
    }

    // ======================================
    // BANCO JÁ MIGRADO
    // ======================================

    if (pendencias.length === 0) {
        console.log(
            '✅ Configurações já existem no SQLite.'
        );

        console.log(
            '✅ Histórico de vendas já existe no SQLite.'
        );

        console.log(
            '✅ Nenhuma importação necessária.'
        );

        console.log(
            '✅ Nenhum dado foi sobrescrito.'
        );

        conferirHistoricoOriginal(
            salesExistente
        );

        return {
            importados: [],
            jaExistiam: [
                'config',
                'sales'
            ]
        };
    }

    // ======================================
    // LER TODOS OS ARQUIVOS NECESSÁRIOS
    // ======================================

    const dadosParaImportar =
        pendencias.map(item => ({
            ...item,
            dados: lerJSON(
                item.caminho
            )
        }));

    // Todos os arquivos precisam
    // estar válidos ANTES dos backups
    // e da transação de importação.

    console.log(
        '📋 Dados pendentes: ' +
        pendencias.map(
            item => item.chave
        ).join(', ')
    );

    // ======================================
    // CRIAR BACKUPS
    // ======================================

    const identificador =
        identificadorBackup();

    criarBackupJSON(
        pendencias,
        identificador
    );

    criarBackupBanco(
        identificador
    );

    // ======================================
    // IMPORTAÇÃO ATÔMICA
    // ======================================

    const importados =
        db.transaction(() => {
            const nomes = [];

            for (
                const item
                of dadosParaImportar
            ) {
                const importado =
                    importarJSON(
                        item.chave,
                        item.dados
                    );

                if (!importado) {
                    throw new Error(
                        `A chave ${item.chave} não ` +
                        'pôde ser importada.'
                    );
                }

                nomes.push(
                    item.chave
                );
            }

            return nomes;
        })();

    // ======================================
    // CONFERIR RESULTADO
    // ======================================

    const configFinal =
        lerDadoExistente('config');

    const salesFinal =
        lerDadoExistente('sales');

    if (
        !configFinal ||
        !salesFinal
    ) {
        throw new Error(
            'A importação foi gravada, mas ' +
            'uma das chaves não foi encontrada. ' +
            'Confira o banco e os backups.'
        );
    }

    console.log('');

    for (
        const chave
        of importados
    ) {
        console.log(
            `✅ ${chave} importado com sucesso.`
        );
    }

    const resumo = contarVendas(
        salesFinal
    );

    console.log(
        `👥 Clientes no histórico: ${resumo.totalClientes}`
    );

    console.log(
        `🛒 Compras no histórico: ${resumo.totalVendas}`
    );

    console.log('');
    console.log(
        '✅ Migração concluída!'
    );
    console.log(
        '✅ Arquivos JSON originais preservados.'
    );
    console.log(
        '✅ Backup SQLite preservado.'
    );
    console.log(
        '✅ Nenhum dado existente foi sobrescrito.'
    );
    console.log('');

    return {
        importados,
        jaExistiam: [
            ...(configExistente ? ['config'] : []),
            ...(salesExistente ? ['sales'] : [])
        ],
        resumo
    };
}

// ==========================================
// EXECUTAR SOMENTE DIRETAMENTE
// ==========================================
//
// require('./database/migrate')
// não executa a importação.
//
// A execução é manual e separada
// da inicialização do bot.

if (require.main === module) {
    try {
        migrar();

    } catch (erro) {
        console.error('');
        console.error(
            '❌ Falha na migração:',
            erro
        );

        process.exitCode = 1;

    } finally {
        fecharBanco();
    }
}

// ==========================================
// EXPORTAÇÕES
// ==========================================

module.exports = {
    migrar,
    contarVendas
};
