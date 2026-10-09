
const fs = require('fs');
const path = require('path');

const {
    db,
    fecharBanco
} = require('./db');

// ==========================================
// INOVARESALE BOT 2.0
// MIGRAÇÃO DOS DADOS ANTIGOS
// ==========================================

// Local dos arquivos originais

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

// ==========================================
// VERIFICAR ARQUIVO
// ==========================================

function arquivoExiste(caminho) {
    try {
        return (
            fs.existsSync(caminho) &&
            fs.statSync(caminho).isFile() &&
            fs.statSync(caminho).size > 0
        );
    } catch {
        return false;
    }
}

// ==========================================
// LER JSON ANTIGO
// ==========================================

function lerJSON(caminho) {
    if (!arquivoExiste(caminho)) {
        throw new Error(
            `Arquivo não encontrado ou vazio: ${caminho}`
        );
    }

    const conteudo = fs.readFileSync(
        caminho,
        'utf8'
    );

    const dados = JSON.parse(conteudo);

    if (
        !dados ||
        typeof dados !== 'object' ||
        Array.isArray(dados)
    ) {
        throw new Error(
            `Estrutura JSON inválida: ${caminho}`
        );
    }

    return dados;
}

// ==========================================
// VERIFICAR SE JÁ EXISTE NO BANCO
// ==========================================

function dadosJaExistem(chave) {
    const resultado = db.prepare(`
        SELECT chave
        FROM dados
        WHERE chave = ?
    `).get(chave);

    return Boolean(resultado);
}

// ==========================================
// CRIAR BACKUP DOS ARQUIVOS
// ==========================================

function criarBackup() {
    const pastaBackup = path.join(
        pastaData,
        'backups'
    );

    fs.mkdirSync(pastaBackup, {
        recursive: true
    });

    const data = new Date()
        .toISOString()
        .replace(/[:.]/g, '-');

    const arquivos = [
        {
            origem: configPath,
            nome: 'config'
        },
        {
            origem: salesPath,
            nome: 'sales'
        }
    ];

    for (const arquivo of arquivos) {
        if (!arquivoExiste(arquivo.origem)) {
            continue;
        }

        const destino = path.join(
            pastaBackup,
            `${arquivo.nome}-${data}.json`
        );

        fs.copyFileSync(
            arquivo.origem,
            destino,
            fs.constants.COPYFILE_EXCL
        );

        console.log(
            `✅ Backup criado: ${path.basename(destino)}`
        );
    }
}

// ==========================================
// IMPORTAR DADOS SEM SOBRESCREVER
// ==========================================

function importarJSON(chave, dados) {
    if (dadosJaExistem(chave)) {
        console.log(
            `ℹ️ ${chave} já existe no banco. Importação ignorada.`
        );

        return false;
    }

    const resultado = db.prepare(`
        INSERT OR IGNORE INTO dados (
            chave,
            valor,
            atualizado_em
        )
        VALUES (
            ?,
            ?,
            CURRENT_TIMESTAMP
        )
    `).run(
        chave,
        JSON.stringify(dados)
    );

    return resultado.changes > 0;
}

// ==========================================
// VALIDAR HISTÓRICO DE VENDAS
// ==========================================

function contarVendas(sales) {
    let totalClientes = 0;
    let totalVendas = 0;

    for (const servidor of Object.values(sales)) {
        if (
            !servidor ||
            typeof servidor !== 'object'
        ) {
            continue;
        }

        for (const cliente of Object.values(servidor)) {
            if (
                !cliente ||
                typeof cliente !== 'object'
            ) {
                continue;
            }

            totalClientes++;

            if (Array.isArray(cliente.historico)) {
                totalVendas += cliente.historico.length;
            }
        }
    }

    return {
        totalClientes,
        totalVendas
    };
}

// ==========================================
// EXECUTAR MIGRAÇÃO
// ==========================================

function migrar() {
    console.log('');
    console.log('======================================');
    console.log('    INOVARESALE — MIGRAÇÃO 2.0');
    console.log('======================================');
    console.log('');

    // Verificar tudo antes de alterar o banco.

    const pendencias = [];

    if (!dadosJaExistem('config')) {
        pendencias.push({
            chave: 'config',
            caminho: configPath
        });
    }

    if (!dadosJaExistem('sales')) {
        pendencias.push({
            chave: 'sales',
            caminho: salesPath
        });
    }

    if (pendencias.length === 0) {
        console.log(
            '✅ Configurações e vendas já existem no banco.'
        );

        console.log(
            '✅ Nenhum dado foi sobrescrito.'
        );

        return;
    }

    const dadosParaImportar = [];

    for (const item of pendencias) {
        dadosParaImportar.push({
            chave: item.chave,
            dados: lerJSON(item.caminho)
        });
    }

    // Criar backups antes de importar.

    criarBackup();

    // Importação em transação:
    // tudo é salvo junto ou nada é salvo.

    const executar = db.transaction(() => {
        for (const item of dadosParaImportar) {
            importarJSON(
                item.chave,
                item.dados
            );
        }
    });

    executar();

    // ======================================
    // RESULTADO
    // ======================================

    console.log('');

    for (const item of dadosParaImportar) {
        console.log(
            `✅ ${item.chave} importado com sucesso.`
        );

        if (item.chave === 'sales') {
            const resumo = contarVendas(item.dados);

            console.log(
                `👥 Clientes no histórico: ${resumo.totalClientes}`
            );

            console.log(
                `🛒 Compras no histórico: ${resumo.totalVendas}`
            );
        }
    }

    console.log('');
    console.log(
        '✅ Migração concluída com sucesso!'
    );

    console.log(
        '✅ Arquivos JSON originais preservados.'
    );

    console.log('');
}

// ==========================================
// INICIAR SOMENTE QUANDO EXECUTADO
// DIRETAMENTE
// ==========================================

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

module.exports = {
    migrar,
    contarVendas
};
