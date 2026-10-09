
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// ==========================================
// LOCAL DO BANCO DE DADOS
// ==========================================

// Na Railway, DATA_DIR deverá apontar para
// um volume persistente, como /data.
//
// No computador, usamos uma pasta local.

const diretorio = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, 'storage');

fs.mkdirSync(diretorio, {
    recursive: true
});

const caminhoBanco = path.join(
    diretorio,
    'inovaresale.sqlite'
);

// ==========================================
// CONECTAR AO BANCO
// ==========================================

const db = new Database(caminhoBanco);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// ==========================================
// CRIAR TABELAS
// ==========================================

db.exec(`

    -- Configurações e dados existentes

    CREATE TABLE IF NOT EXISTS dados (
        chave TEXT PRIMARY KEY,
        valor TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
            DEFAULT CURRENT_TIMESTAMP
    );

    -- Tickets de compra

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

    CREATE INDEX IF NOT EXISTS idx_tickets_cliente
        ON tickets(servidor_id, cliente_id);

    CREATE INDEX IF NOT EXISTS idx_tickets_status
        ON tickets(servidor_id, status);

    -- Registro para impedir que o mesmo ticket
    -- contabilize uma venda duas vezes

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

    -- Histórico de ações dos tickets

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

    CREATE INDEX IF NOT EXISTS idx_logs_ticket
        ON logs_tickets(ticket_id);

`);

// ==========================================
// LER DADOS JSON
// ==========================================

function obterJSON(chave, padrao = {}) {

    const resultado = db.prepare(`
        SELECT valor
        FROM dados
        WHERE chave = ?
    `).get(chave);

    if (!resultado) {
        return padrao;
    }

    try {
        return JSON.parse(resultado.valor);
    } catch (erro) {
        console.error(
            'Erro ao interpretar dados:',
            chave,
            erro
        );

        throw erro;
    }
}

// ==========================================
// SALVAR DADOS JSON
// ==========================================

function salvarJSON(chave, valor) {

    const conteudo = JSON.stringify(valor);

    if (conteudo === undefined) {
        throw new Error(
            'Não é possível salvar um valor indefinido.'
        );
    }

    db.prepare(`
        INSERT INTO dados (
            chave,
            valor,
            atualizado_em
        )
        VALUES (?, ?, CURRENT_TIMESTAMP)

        ON CONFLICT(chave)
        DO UPDATE SET
            valor = excluded.valor,
            atualizado_em = CURRENT_TIMESTAMP
    `).run(chave, conteudo);
}

// ==========================================
// TRANSAÇÕES
// ==========================================

function executarTransacao(funcao) {

    return db.transaction(funcao)();
}

// ==========================================
// BUSCAR TICKET
// ==========================================

function buscarTicket(id) {

    return db.prepare(`
        SELECT *
        FROM tickets
        WHERE id = ?
    `).get(id) || null;
}

// ==========================================
// BUSCAR TICKET PELO CANAL
// ==========================================

function buscarTicketPorCanal(canalId) {

    return db.prepare(`
        SELECT *
        FROM tickets
        WHERE canal_id = ?
    `).get(canalId) || null;
}

// ==========================================
// REGISTRAR AÇÃO NO HISTÓRICO
// ==========================================

function registrarLog(
    ticketId,
    usuarioId,
    acao,
    detalhes = null
) {

    return db.prepare(`
        INSERT INTO logs_tickets (
            ticket_id,
            usuario_id,
            acao,
            detalhes
        )
        VALUES (?, ?, ?, ?)
    `).run(
        ticketId,
        usuarioId,
        acao,
        detalhes
    );
}

// ==========================================
// FECHAR CONEXÃO
// ==========================================

function fecharBanco() {

    if (db.open) {
        db.close();
    }
}

// ==========================================
// EXPORTAR FUNÇÕES
// ==========================================

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
