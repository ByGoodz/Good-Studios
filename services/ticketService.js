
'use strict';

const { db, registrarLog } = require('../database/db');

const STATUS = Object.freeze({
    CRIANDO: 'criando',
    ABERTO: 'aberto',
    EM_ATENDIMENTO: 'em_atendimento',
    FINALIZANDO: 'finalizando',
    FINALIZADO: 'finalizado',
    CANCELADO: 'cancelado'
});

const MODALIDADES = Object.freeze([
    'viaPlus', 'semTaxa', 'taxado', 'viaGrupo'
]);

const PAGAMENTOS = Object.freeze(['pix', 'mm']);

const STATUS_ATIVOS = [
    STATUS.CRIANDO,
    STATUS.ABERTO,
    STATUS.EM_ATENDIMENTO,
    STATUS.FINALIZANDO
];

function validarId(valor, nome) {
    const texto = String(valor ?? '').trim();
    if (!/^\d{15,22}$/.test(texto)) {
        throw new Error(`${nome} inválido.`);
    }
    return texto;
}

function validarTicketId(valor) {
    const id = Number(valor);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error('ID de ticket inválido.');
    }
    return id;
}

function validarQuantidade(valor) {
    if (!Number.isSafeInteger(valor) || valor < 1 || valor > 50000000) {
        throw new Error('A quantidade deve ser um número inteiro entre 1 e 50.000.000.');
    }
    return valor;
}

function validarPreco(centavos) {
    if (!Number.isSafeInteger(centavos) || centavos <= 0) {
        throw new Error('Preço em centavos inválido.');
    }
    return centavos;
}

function validarUsuarioRoblox(valor) {
    const username = String(valor ?? '').trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
        throw new Error('Usuário Roblox inválido (3 a 20 caracteres).');
    }
    return username;
}

function validarEscolha(valor, opcoes, nome) {
    if (!opcoes.includes(valor)) {
        throw new Error(`${nome} inválido.`);
    }
    return valor;
}

// ==========================================
// CONSULTAS
// ==========================================

function buscarTicket(id) {
    return db.prepare('SELECT * FROM tickets WHERE id = ?')
        .get(validarTicketId(id)) || null;
}

function buscarTicketPorCanal(canalId) {
    return db.prepare('SELECT * FROM tickets WHERE canal_id = ?')
        .get(validarId(canalId, 'Canal')) || null;
}

function buscarTicketAtivoCliente(servidorId, clienteId) {
    return db.prepare(`
        SELECT * FROM tickets
        WHERE servidor_id = ? AND cliente_id = ?
          AND status IN ('criando', 'aberto', 'em_atendimento', 'finalizando')
        ORDER BY id DESC LIMIT 1
    `).get(
        validarId(servidorId, 'Servidor'),
        validarId(clienteId, 'Cliente')
    ) || null;
}

function listarTicketsCliente(servidorId, clienteId, limite = 10) {
    const quantidade = Math.min(Math.max(Number(limite) || 10, 1), 50);
    return db.prepare(`
        SELECT * FROM tickets
        WHERE servidor_id = ? AND cliente_id = ?
        ORDER BY id DESC LIMIT ?
    `).all(
        validarId(servidorId, 'Servidor'),
        validarId(clienteId, 'Cliente'),
        quantidade
    );
}

// ==========================================
// ABRIR PEDIDO (SÓ NO BANCO)
// ==========================================

function criarRegistroTicket({
    servidorId,
    clienteId,
    modalidade,
    quantidadeRobux,
    precoCentavos,
    usuarioRoblox,
    pagamento
}) {
    const dados = {
        servidorId: validarId(servidorId, 'Servidor'),
        clienteId: validarId(clienteId, 'Cliente'),
        modalidade: validarEscolha(modalidade, MODALIDADES, 'Modalidade'),
        quantidadeRobux: validarQuantidade(quantidadeRobux),
        precoCentavos: validarPreco(precoCentavos),
        usuarioRoblox: validarUsuarioRoblox(usuarioRoblox),
        pagamento: validarEscolha(pagamento, PAGAMENTOS, 'Pagamento')
    };

    return db.transaction(() => {
        const existente = buscarTicketAtivoCliente(
            dados.servidorId, dados.clienteId
        );

        if (existente) {
            const erro = new Error(
                'Você já possui um ticket aberto ou em criação.'
            );
            erro.codigo = 'TICKET_JA_ABERTO';
            erro.ticket = existente;
            throw erro;
        }

        const resultado = db.prepare(`
            INSERT INTO tickets (
                servidor_id, cliente_id, modalidade,
                quantidade_robux, preco_centavos,
                usuario_roblox, pagamento, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'criando')
        `).run(
            dados.servidorId,
            dados.clienteId,
            dados.modalidade,
            dados.quantidadeRobux,
            dados.precoCentavos,
            dados.usuarioRoblox,
            dados.pagamento
        );

        const id = Number(resultado.lastInsertRowid);
        registrarLog(id, dados.clienteId, 'ticket_criado');
        return buscarTicket(id);
    })();
}

// Chamar DEPOIS que o Discord criar o canal privado.
function vincularCanalTicket(ticketId, canalId) {
    const id = validarTicketId(ticketId);
    const canal = validarId(canalId, 'Canal');

    const resultado = db.prepare(`
        UPDATE tickets
        SET canal_id = ?, status = 'aberto',
            atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'criando' AND canal_id IS NULL
    `).run(canal, id);

    if (resultado.changes !== 1) {
        throw new Error('Ticket não está aguardando criação do canal.');
    }

    registrarLog(id, null, 'canal_criado', canal);
    return buscarTicket(id);
}

// Usar se o Discord falhar ao criar o canal.
function descartarTicketEmCriacao(ticketId, motivo = 'Falha ao criar canal') {
    const id = validarTicketId(ticketId);
    const resultado = db.prepare(`
        UPDATE tickets
        SET status = 'cancelado',
            atualizado_em = CURRENT_TIMESTAMP,
            encerrado_em = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'criando'
    `).run(id);

    if (resultado.changes) {
        registrarLog(id, null, 'criacao_falhou', String(motivo).slice(0, 500));
    }

    return resultado.changes === 1;
}

// ==========================================
// ATENDIMENTO
// ==========================================

function assumirTicket(ticketId, atendenteId) {
    const id = validarTicketId(ticketId);
    const atendente = validarId(atendenteId, 'Atendente');

    const resultado = db.prepare(`
        UPDATE tickets
        SET atendente_id = ?, status = 'em_atendimento',
            atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ? AND status IN ('aberto', 'em_atendimento')
          AND (atendente_id IS NULL OR atendente_id = ?)
    `).run(atendente, id, atendente);

    if (resultado.changes !== 1) {
        throw new Error('Ticket fechado ou já assumido por outro atendente.');
    }

    registrarLog(id, atendente, 'assumir');
    return buscarTicket(id);
}

function iniciarFinalizacao(ticketId, atendenteId) {
    const id = validarTicketId(ticketId);
    const atendente = validarId(atendenteId, 'Atendente');

    const resultado = db.prepare(`
        UPDATE tickets
        SET status = 'finalizando', atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ? AND status IN ('aberto', 'em_atendimento')
    `).run(id);

    if (resultado.changes !== 1) {
        return false;
    }

    registrarLog(id, atendente, 'iniciou_finalizacao');
    return true;
}

// Só confirmar DEPOIS que registrarVenda() concluir com sucesso.
function confirmarFinalizacao(ticketId, atendenteId, valorCentavos) {
    const id = validarTicketId(ticketId);
    const atendente = validarId(atendenteId, 'Atendente');
    const centavos = validarPreco(valorCentavos);

    const resultado = db.prepare(`
        UPDATE tickets
        SET status = 'finalizado', preco_centavos = ?,
            atualizado_em = CURRENT_TIMESTAMP,
            encerrado_em = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'finalizando'
    `).run(centavos, id);

    if (resultado.changes !== 1) {
        throw new Error('Ticket não está em finalização.');
    }

    registrarLog(id, atendente, 'venda_finalizada',
        `Valor pago: R$ ${(centavos / 100).toFixed(2)}`);
    return buscarTicket(id);
}

function reverterFinalizacao(ticketId) {
    const id = validarTicketId(ticketId);
    const resultado = db.prepare(`
        UPDATE tickets
        SET status = 'aberto', atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'finalizando'
    `).run(id);
    return resultado.changes === 1;
}

function cancelarTicket(ticketId, atendenteId, motivo = null) {
    const id = validarTicketId(ticketId);
    const atendente = validarId(atendenteId, 'Atendente');

    const resultado = db.prepare(`
        UPDATE tickets
        SET status = 'cancelado',
            atualizado_em = CURRENT_TIMESTAMP,
            encerrado_em = CURRENT_TIMESTAMP
        WHERE id = ? AND status IN ('aberto', 'em_atendimento')
    `).run(id);

    if (resultado.changes !== 1) {
        throw new Error('Este ticket já foi encerrado ou está em finalização.');
    }

    registrarLog(id, atendente, 'cancelamento',
        motivo ? String(motivo).slice(0, 500) : null);
    return buscarTicket(id);
}

// ==========================================
// HISTÓRICO E ESTATÍSTICAS
// ==========================================

function obterHistoricoTicket(ticketId, limite = 50) {
    const quantidade = Math.min(Math.max(Number(limite) || 50, 1), 100);
    return db.prepare(`
        SELECT * FROM logs_tickets
        WHERE ticket_id = ?
        ORDER BY id ASC LIMIT ?
    `).all(validarTicketId(ticketId), quantidade);
}

function obterEstatisticasTickets(servidorId) {
    const linhas = db.prepare(`
        SELECT status, COUNT(*) AS total
        FROM tickets
        WHERE servidor_id = ?
        GROUP BY status
    `).all(validarId(servidorId, 'Servidor'));

    const totais = Object.fromEntries(
        Object.values(STATUS).map(status => [status, 0])
    );

    for (const linha of linhas) {
        totais[linha.status] = linha.total;
    }

    return {
        ...totais,
        ativos: STATUS_ATIVOS.reduce((soma, status) => soma + totais[status], 0),
        total: linhas.reduce((soma, linha) => soma + linha.total, 0)
    };
}

module.exports = {
    STATUS,
    MODALIDADES,
    PAGAMENTOS,
    buscarTicket,
    buscarTicketPorCanal,
    buscarTicketAtivoCliente,
    listarTicketsCliente,
    criarRegistroTicket,
    vincularCanalTicket,
    descartarTicketEmCriacao,
    assumirTicket,
    iniciarFinalizacao,
    confirmarFinalizacao,
    reverterFinalizacao,
    cancelarTicket,
    obterHistoricoTicket,
    obterEstatisticasTickets
};
