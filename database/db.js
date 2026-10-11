
'use strict';

// ==========================================
// INOVARESALE BOT 3.0
// BANCO DE DADOS SQLITE
// ==========================================
//
// Responsabilidades:
//
// - Abrir o banco SQLite persistente
// - Criar somente tabelas inexistentes
// - Preservar configurações antigas
// - Preservar histórico de vendas
// - Armazenar tickets
// - Impedir vendas duplicadas por ticket
// - Registrar ações dos tickets
// - Fornecer transações
// - Encerrar a conexão com segurança
//
// IMPORTANTE:
//
// NÃO apaga tabelas.
// NÃO executa DROP TABLE.
// NÃO limpa o histórico.
// NÃO cria as chaves "config" ou
// "sales" automaticamente.
//
// A importação dos JSON antigos
// continua em database/migrate.js.

const fs = require('fs');
const path = require('path');

const Database = require('better-sqlite3');

// ==========================================
// DIRETÓRIO DE ARMAZENAMENTO
// ==========================================
//
// Railway:
// DATA_DIR=/data
//
// Computador:
// database/storage
//
// Mantemos o mesmo caminho utilizado
// pela versão anterior.
//
// Mudar DATA_DIR pode fazer o programa
// encontrar outro arquivo SQLite.
//
// Antes do deploy, é necessário
// conferir o volume persistente.

const diretorio = process.env.DATA_DIR
    ? path.resolve(
        process.env.DATA_DIR
    )
    : path.join(
        __dirname,
        'storage'
    );

// ==========================================
// PREPARAR DIRETÓRIO
// ==========================================

fs.mkdirSync(
    diretorio,
    {
        recursive: true
    }
);

// ==========================================
// CAMINHO DO BANCO
// ==========================================

const caminhoBanco = path.join(
    diretorio,
    'inovaresale.sqlite'
);

// ==========================================
// ABRIR CONEXÃO
// ==========================================

const db = new Database(
    caminhoBanco
);

// ==========================================
// CONFIGURAR SQLITE
// ==========================================

// WAL permite leituras enquanto
// outras operações são gravadas.
//
// FULL prioriza a durabilidade
// das gravações confirmadas.
//
// Foreign keys protege as relações
// de tickets e vendas.

db.pragma(
    'journal_mode = WAL'
);

db.pragma(
    'synchronous = FULL'
);

db.pragma(
    'foreign_keys = ON'
);

db.pragma(
    'busy_timeout = 5000'
);

// ==========================================
// TABELAS PRINCIPAIS
// ==========================================
//
// CREATE TABLE IF NOT EXISTS
// preserva estruturas já existentes.
//
// Não usamos DROP TABLE,
// DELETE FROM ou REPLACE.
//
// Os serviços específicos da versão
// 3.0 continuam responsáveis por
// criar suas próprias tabelas.

db.exec(`
    -- =====================================
    -- CONFIGURAÇÕES E HISTÓRICO ANTIGO
    -- =====================================

    CREATE TABLE IF NOT EXISTS dados (

        chave TEXT PRIMARY KEY,

        valor TEXT NOT NULL,

        atualizado_em TEXT NOT NULL
            DEFAULT CURRENT_TIMESTAMP
    );

    -- =====================================
    -- TICKETS DE COMPRA DE ROBUX
    -- =====================================

    CREATE TABLE IF NOT EXISTS tickets (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        servidor_id TEXT NOT NULL,

        cliente_id TEXT NOT NULL,

        canal_id TEXT UNIQUE,

        modalidade TEXT NOT NULL,

        quantidade_robux INTEGER NOT NULL,

        preco_centavos INTEGER,

        usuario_roblox TEXT,

        pagamento TEXT,

        atendente_id TEXT,

        status TEXT NOT NULL
            DEFAULT 'aberto',

        criado_em TEXT NOT NULL
            DEFAULT CURRENT_TIMESTAMP,

        atualizado_em TEXT NOT NULL
            DEFAULT CURRENT_TIMESTAMP,

        encerrado_em TEXT
    );

    CREATE INDEX IF NOT EXISTS
        idx_tickets_cliente

    ON tickets (
        servidor_id,
        cliente_id
    );

    CREATE INDEX IF NOT EXISTS
        idx_tickets_status

    ON tickets (
        servidor_id,
        status
    );

    -- =====================================
    -- VENDAS VINCULADAS A TICKETS
    -- =====================================
    --
    -- PRIMARY KEY(ticket_id) impede
    -- que o mesmo ticket crie dois
    -- registros nessa tabela.
    --
    -- O serviço de vendas usa
    -- transação para atualizar o
    -- histórico e inserir este vínculo.

    CREATE TABLE IF NOT EXISTS vendas_tickets (

        ticket_id INTEGER PRIMARY KEY,

        cliente_id TEXT NOT NULL,

        valor_centavos INTEGER NOT NULL,

        quantidade_robux INTEGER NOT NULL,

        registrado_por TEXT NOT NULL,

        registrado_em TEXT NOT NULL
            DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (ticket_id)
            REFERENCES tickets(id)
    );

    -- =====================================
    -- HISTÓRICO DE AÇÕES DOS TICKETS
    -- =====================================

    CREATE TABLE IF NOT EXISTS logs_tickets (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        ticket_id INTEGER NOT NULL,

        usuario_id TEXT,

        acao TEXT NOT NULL,

        detalhes TEXT,

        criado_em TEXT NOT NULL
            DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (ticket_id)
            REFERENCES tickets(id)
    );

    CREATE INDEX IF NOT EXISTS
        idx_logs_ticket

    ON logs_tickets (
        ticket_id
    );
`);

// ==========================================
// CONSULTAS PREPARADAS
// ==========================================

const SQL = {
    buscarDado: db.prepare(`
        SELECT valor
        FROM dados
        WHERE chave = ?
    `),

    salvarDado: db.prepare(`
        INSERT INTO dados (
            chave,
            valor,
            atualizado_em
        )

        VALUES (
            ?,
            ?,
            CURRENT_TIMESTAMP
        )

        ON CONFLICT(chave)
        DO UPDATE SET
            valor = excluded.valor,
            atualizado_em = CURRENT_TIMESTAMP
    `),

    buscarTicket: db.prepare(`
        SELECT *
        FROM tickets
        WHERE id = ?
    `),

    buscarTicketPorCanal: db.prepare(`
        SELECT *
        FROM tickets
        WHERE canal_id = ?
    `),

    registrarLogTicket: db.prepare(`
        INSERT INTO logs_tickets (
            ticket_id,
            usuario_id,
            acao,
            detalhes
        )

        VALUES (?, ?, ?, ?)
    `)
};

// ==========================================
// VALIDAR OBJETO
// ==========================================

function ehObjeto(valor) {
    return (
        valor !== null &&
        typeof valor === 'object' &&
        !Array.isArray(valor)
    );
}

// ==========================================
// PROTEGER HISTÓRICO DE VENDAS
// ==========================================
//
// Essa proteção é aplicada quando
// alguém usa salvarJSON('sales', ...).
//
// Nunca aceitamos a remoção de
// servidores ou clientes existentes.
//
// Nunca aceitamos que o histórico
// de compras antigas diminua.
//
// Também verificamos se os itens
// antigos continuam preservados.
//
// O utilitário storage.js já possui
// sua própria verificação adicional.

function verificarHistoricoPreservado(
    antigo,
    novo
) {
    if (
        !ehObjeto(antigo) ||
        !ehObjeto(novo)
    ) {
        throw new Error(
            'Histórico de vendas inválido. ' +
            'Gravação bloqueada.'
        );
    }

    for (
        const [servidorId, clientes]
        of Object.entries(antigo)
    ) {
        if (!ehObjeto(clientes)) {
            throw new Error(
                'Histórico antigo do servidor ' +
                `${servidorId} está inválido.`
            );
        }

        const novosClientes =
            novo[servidorId];

        if (!ehObjeto(novosClientes)) {
            throw new Error(
                'Gravação bloqueada: histórico ' +
                `do servidor ${servidorId} sumiria.`
            );
        }

        for (
            const [clienteId, dados]
            of Object.entries(clientes)
        ) {
            const novoCliente =
                novosClientes[clienteId];

            if (
                !ehObjeto(dados) ||
                !ehObjeto(novoCliente)
            ) {
                throw new Error(
                    'Gravação bloqueada: dados antigos ' +
                    `do cliente ${clienteId} seriam perdidos.`
                );
            }

            // ==================================
            // COMPRAS REGISTRADAS
            // ==================================

            const comprasAntigas =
                Number(
                    dados.quantidadeCompras || 0
                );

            const comprasNovas =
                Number(
                    novoCliente.quantidadeCompras || 0
                );

            if (
                !Number.isFinite(comprasNovas) ||
                comprasNovas < comprasAntigas
            ) {
                throw new Error(
                    'Gravação bloqueada: o número ' +
                    `de compras de ${clienteId} diminuiria.`
                );
            }

            // ==================================
            // ROBUX ACUMULADOS
            // ==================================

            const robuxAntigos =
                Number(
                    dados.totalRobux || 0
                );

            const robuxNovos =
                Number(
                    novoCliente.totalRobux || 0
                );

            if (
                !Number.isFinite(robuxNovos) ||
                robuxNovos < robuxAntigos
            ) {
                throw new Error(
                    'Gravação bloqueada: os Robux ' +
                    `de ${clienteId} diminuiriam.`
                );
            }

            // ==================================
            // HISTÓRICO INDIVIDUAL
            // ==================================

            const historicoAntigo =
                dados.historico;

            const historicoNovo =
                novoCliente.historico;

            if (
                historicoAntigo !== undefined &&
                !Array.isArray(historicoAntigo)
            ) {
                throw new Error(
                    'Histórico antigo de compras ' +
                    `inválido para ${clienteId}.`
                );
            }

            if (
                !Array.isArray(historicoNovo) &&
                Array.isArray(historicoAntigo)
            ) {
                throw new Error(
                    'Gravação bloqueada: histórico ' +
                    `do cliente ${clienteId} desapareceria.`
                );
            }

            const anteriores =
                Array.isArray(historicoAntigo)
                    ? historicoAntigo
                    : [];

            const posteriores =
                Array.isArray(historicoNovo)
                    ? historicoNovo
                    : [];

            if (
                posteriores.length <
                anteriores.length
            ) {
                throw new Error(
                    'Gravação bloqueada: compras antigas ' +
                    `do cliente ${clienteId} seriam apagadas.`
                );
            }

            // ==================================
            // CONFERIR COMPRAS ANTIGAS
            // ==================================

            for (
                let indice = 0;
                indice < anteriores.length;
                indice++
            ) {
                const compraAntiga =
                    JSON.stringify(
                        anteriores[indice]
                    );

                const compraNova =
                    JSON.stringify(
                        posteriores[indice]
                    );

                if (
                    compraAntiga !== compraNova
                ) {
                    throw new Error(
                        'Gravação bloqueada: uma compra ' +
                        `antiga de ${clienteId} seria alterada.`
                    );
                }
            }
        }
    }
}

// ==========================================
// LER JSON DO SQLITE
// ==========================================
//
// Mantemos a mesma assinatura:
//
// obterJSON(chave, padrao = {})
//
// A função nunca altera o banco.
//
// Para dados financeiros, os módulos
// devem preferir getSales() do
// utils/storage.js, que exige
// a existência da chave "sales".

function obterJSON(
    chave,
    padrao = {}
) {
    const nome =
        String(chave ?? '').trim();

    if (!nome) {
        throw new Error(
            'Informe a chave dos dados.'
        );
    }

    const registro =
        SQL.buscarDado.get(nome);

    if (!registro) {
        return padrao;
    }

    try {
        return JSON.parse(
            registro.valor
        );

    } catch (erro) {
        console.error(
            '[InovareSale | SQLite] ' +
            `Erro ao ler JSON "${nome}":`,
            erro
        );

        throw new Error(
            `O JSON da chave "${nome}" ` +
            'está inválido. Nenhum dado foi substituído.'
        );
    }
}

// ==========================================
// SALVAR JSON NO SQLITE
// ==========================================
//
// Mantemos a mesma assinatura:
//
// salvarJSON(chave, valor)
//
// O registro é inserido ou atualizado.
//
// Se a chave for "sales" e já
// existir um histórico, aplicamos
// a verificação de preservação.
//
// Não devemos utilizar essa função
// para zerar compras ou configurações.

function salvarJSON(
    chave,
    valor
) {
    const nome =
        String(chave ?? '').trim();

    if (!nome) {
        throw new Error(
            'Informe a chave que será salva.'
        );
    }

    const conteudo =
        JSON.stringify(valor);

    if (
        typeof conteudo !== 'string'
    ) {
        throw new Error(
            'Não é possível salvar ' +
            'um valor indefinido.'
        );
    }

    return db.transaction(() => {
        // ==================================
        // PROTEGER HISTÓRICO EXISTENTE
        // ==================================

        if (nome === 'sales') {
            if (!ehObjeto(valor)) {
                throw new Error(
                    'O histórico de vendas ' +
                    'precisa ser um objeto.'
                );
            }

            const anterior =
                SQL.buscarDado.get(
                    'sales'
                );

            if (anterior) {
                let historico;

                try {
                    historico =
                        JSON.parse(
                            anterior.valor
                        );

                } catch {
                    throw new Error(
                        'Histórico antigo inválido. ' +
                        'Gravação bloqueada.'
                    );
                }

                verificarHistoricoPreservado(
                    historico,
                    valor
                );
            }
        }

        // ==================================
        // SALVAR NO SQLITE
        // ==================================

        return SQL.salvarDado.run(
            nome,
            conteudo
        );
    })();
}

// ==========================================
// EXECUTAR TRANSAÇÃO
// ==========================================
//
// Mantém compatibilidade com:
//
// executarTransacao(() => {
//     // alterações no SQLite
// });
//
// Se a função lançar um erro,
// a transação será revertida.

function executarTransacao(funcao) {
    if (
        typeof funcao !== 'function'
    ) {
        throw new TypeError(
            'A transação precisa receber uma função.'
        );
    }

    return db.transaction(
        funcao
    )();
}

// ==========================================
// BUSCAR TICKET POR ID
// ==========================================

function buscarTicket(id) {
    const numero = Number(id);

    if (
        !Number.isSafeInteger(numero) ||
        numero <= 0
    ) {
        return null;
    }

    return SQL.buscarTicket.get(
        numero
    ) || null;
}

// ==========================================
// BUSCAR TICKET PELO CANAL
// ==========================================

function buscarTicketPorCanal(canalId) {
    const id =
        String(canalId ?? '').trim();

    if (!id) {
        return null;
    }

    return SQL.buscarTicketPorCanal.get(
        id
    ) || null;
}

// ==========================================
// REGISTRAR LOG DE TICKET
// ==========================================
//
// Registra o evento dentro da tabela
// logs_tickets.
//
// Não depende da publicação no Discord.
//
// Não apaga ações anteriores.

function registrarLog(
    ticketId,
    usuarioId,
    acao,
    detalhes = null
) {
    const id = Number(ticketId);

    if (
        !Number.isSafeInteger(id) ||
        id <= 0
    ) {
        throw new Error(
            'ID de ticket inválido para o log.'
        );
    }

    const tipo =
        String(acao ?? '').trim();

    if (!tipo) {
        throw new Error(
            'A ação do ticket não foi informada.'
        );
    }

    return SQL.registrarLogTicket.run(
        id,
        usuarioId
            ? String(usuarioId)
            : null,
        tipo,
        detalhes === null ||
        detalhes === undefined
            ? null
            : String(detalhes)
    );
}

// ==========================================
// FECHAR CONEXÃO SQLITE
// ==========================================
//
// Chamado pelo index.js quando o
// processo é encerrado.
//
// O banco só é fechado se estiver
// realmente aberto.
//
// Não remove nenhum arquivo.

function fecharBanco() {
    if (!db.open) {
        return;
    }

    db.close();
}

// ==========================================
// EXPORTAÇÕES
// ==========================================
//
// Preservamos todos os nomes
// utilizados pelo projeto anterior.

module.exports = {
    db,

    obterJSON,
    salvarJSON,

    executarTransacao,

    buscarTicket,
    buscarTicketPorCanal,

    registrarLog,

    fecharBanco
};
