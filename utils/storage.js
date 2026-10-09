
'use strict';

// ==========================================
// INOVARESALE BOT 2.0
// ARMAZENAMENTO PERSISTENTE EM SQLITE
// ==========================================
// O SQLite guarda config e sales na tabela "dados".
// Os JSON antigos sao importados UMA VEZ pelo
// database/migrate.js, antes de ligar a versao 2.0.
// Este arquivo NAO executa migracoes nem cria
// historicos vazios automaticamente.

const { db } = require('../database/db');

const CHAVE_CONFIG = 'config';
const CHAVE_VENDAS = 'sales';

const buscarDado = db.prepare(
    'SELECT valor FROM dados WHERE chave = ?'
);

const atualizarDado = db.prepare(
    'UPDATE dados SET valor = ? WHERE chave = ?'
);

// ==========================================
// VERIFICAR SE A MIGRACAO FOI REALIZADA
// ==========================================

function verificarArmazenamento() {
    const configExiste = Boolean(buscarDado.get(CHAVE_CONFIG));
    const vendasExistem = Boolean(buscarDado.get(CHAVE_VENDAS));

    if (!configExiste || !vendasExistem) {
        const faltando = [];

        if (!configExiste) faltando.push('config');
        if (!vendasExistem) faltando.push('sales');

        throw new Error(
            '[InovareSale] Banco ainda nao migrado: ' +
            faltando.join(', ') + '. ' +
            'Antes de iniciar o bot 2.0, execute ' +
            '"node database/migrate.js" com os JSON ' +
            'originais e o DATA_DIR correto. ' +
            'O historico NAO sera recriado automaticamente.'
        );
    }

    return true;
}

// ==========================================
// VALIDAR OBJETOS ARMAZENADOS
// ==========================================

function ehObjeto(valor) {
    return (
        valor !== null &&
        typeof valor === 'object' &&
        !Array.isArray(valor)
    );
}

function validarObjeto(valor, nome) {
    if (!ehObjeto(valor)) {
        throw new TypeError(
            `[InovareSale] ${nome} deve ser um objeto.`
        );
    }

    // JSON.stringify falha em estruturas circulares;
    // e impede salvar valores incompativeis com JSON.
    const texto = JSON.stringify(valor);

    if (typeof texto !== 'string') {
        throw new TypeError(
            `[InovareSale] ${nome} nao pode ser salvo como JSON.`
        );
    }

    return texto;
}

// ==========================================
// LER OBJETO SALVO
// ==========================================

function lerObjeto(chave) {
    verificarArmazenamento();

    const linha = buscarDado.get(chave);

    if (!linha) {
        throw new Error(
            `[InovareSale] Dado "${chave}" nao encontrado no SQLite.`
        );
    }

    let objeto;

    try {
        objeto = JSON.parse(linha.valor);
    } catch {
        throw new Error(
            `[InovareSale] JSON "${chave}" invalido no SQLite. ` +
            'Confira o backup antes de corrigir.'
        );
    }

    if (!ehObjeto(objeto)) {
        throw new Error(
            `[InovareSale] Dado "${chave}" corrompido: objeto esperado.`
        );
    }

    return objeto;
}

// ==========================================
// GRAVAR OBJETO SEM RECRIAR A CHAVE
// ==========================================

function gravarObjeto(chave, valor) {
    const texto = validarObjeto(valor, chave);
    verificarArmazenamento();

    const resultado = atualizarDado.run(texto, chave);

    if (resultado.changes !== 1) {
        throw new Error(
            `[InovareSale] Falha ao atualizar "${chave}" no SQLite.`
        );
    }

    return valor;
}

// ==========================================
// CONFIGURACOES
// ==========================================

function getConfig() {
    return lerObjeto(CHAVE_CONFIG);
}

function saveConfig(config) {
    return gravarObjeto(CHAVE_CONFIG, config);
}

// ==========================================
// HISTORICO DE VENDAS
// ==========================================

function getSales() {
    return lerObjeto(CHAVE_VENDAS);
}

function validarHistoricoPreservado(atual, novo) {
    // Nao permitir que um codigo antigo ou incompleto
    // substitua acidentalmente o historico por {}.
    for (const [servidorId, clientes] of Object.entries(atual)) {
        if (!ehObjeto(clientes)) continue;

        const novosClientes = novo[servidorId];

        if (!ehObjeto(novosClientes)) {
            throw new Error(
                `[InovareSale] Gravacao bloqueada: historico do servidor ${servidorId} desapareceria.`
            );
        }

        for (const [clienteId, dados] of Object.entries(clientes)) {
            const novoCliente = novosClientes[clienteId];

            if (!ehObjeto(novoCliente)) {
                throw new Error(
                    `[InovareSale] Gravacao bloqueada: historico do cliente ${clienteId} desapareceria.`
                );
            }

            const quantidadeAntiga = Array.isArray(dados?.historico)
                ? dados.historico.length
                : 0;

            const quantidadeNova = Array.isArray(novoCliente.historico)
                ? novoCliente.historico.length
                : 0;

            if (quantidadeNova < quantidadeAntiga) {
                throw new Error(
                    `[InovareSale] Gravacao bloqueada: compras antigas de ${clienteId} seriam perdidas.`
                );
            }

            const comprasAntigas = Number(dados?.quantidadeCompras || 0);
            const comprasNovas = Number(novoCliente.quantidadeCompras || 0);

            if (comprasNovas < comprasAntigas) {
                throw new Error(
                    `[InovareSale] Gravacao bloqueada: total de compras de ${clienteId} diminuiria.`
                );
            }
        }
    }
}

function saveSales(sales) {
    validarObjeto(sales, CHAVE_VENDAS);

    // Transacao: comparar e salvar como uma operacao unica.
    return db.transaction(() => {
        const historicoAtual = getSales();
        validarHistoricoPreservado(historicoAtual, sales);
        return gravarObjeto(CHAVE_VENDAS, sales);
    })();
}

// ==========================================
// EXPORTACOES COMPATIVEIS COM O BOT ANTIGO
// ==========================================

module.exports = {
    getConfig,
    saveConfig,
    getSales,
    saveSales,
    verificarArmazenamento
};
