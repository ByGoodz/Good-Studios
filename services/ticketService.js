
'use strict';

const {
    db,
    registrarLog
} = require('../database/db');

// ==========================================
// INOVARESALE BOT 3.0
// SERVIÇO DE TICKETS
// ==========================================

// Responsável por:
// - Registrar tickets no SQLite
// - Consultar pedidos
// - Vincular canais do Discord
// - Controlar atendimento
// - Finalizar e cancelar tickets
// - Consultar histórico e estatísticas
//
// Não publica mensagens no Discord.
// Não altera o sistema de preços.
// Não apaga dados antigos.
//
// O visual dos tickets fica em:
// panels/ticketPanel.js
//
// As interações ficam em:
// handlers/ticketHandler.js

// ==========================================
// STATUS DOS TICKETS
// ==========================================

const STATUS = Object.freeze({
    CRIANDO: 'criando',
    ABERTO: 'aberto',
    EM_ATENDIMENTO: 'em_atendimento',
    FINALIZANDO: 'finalizando',
    FINALIZADO: 'finalizado',
    CANCELADO: 'cancelado'
});

const MODALIDADES = Object.freeze([
    'viaPlus',
    'semTaxa',
    'taxado',
    'viaGrupo'
]);

const PAGAMENTOS = Object.freeze([
    'pix',
    'mm'
]);

const STATUS_ATIVOS = Object.freeze([
    STATUS.CRIANDO,
    STATUS.ABERTO,
    STATUS.EM_ATENDIMENTO,
    STATUS.FINALIZANDO
]);

const LIMITE_ROBUX = 50000000;

// ==========================================
// VALIDAÇÕES
// ==========================================

function validarId(valor, nome) {
    const texto = String(valor ?? '').trim();

    if (!/^\d{15,22}$/.test(texto)) {
        throw new Error(
            `${nome} inválido.`
        );
    }

    return texto;
}

function validarTicketId(valor) {
    const texto = String(valor ?? '').trim();

    if (!/^\d+$/.test(texto)) {
        throw new Error(
            'ID de ticket inválido.'
        );
    }

    const id = Number(texto);

    if (
        !Number.isSafeInteger(id) ||
        id <= 0
    ) {
        throw new Error(
            'ID de ticket inválido.'
        );
    }

    return id;
}

function validarQuantidade(valor) {
    if (
        !Number.isSafeInteger(valor) ||
        valor < 1 ||
        valor > LIMITE_ROBUX
    ) {
        throw new Error(
            'A quantidade de Robux deve ser um número ' +
            'inteiro entre 1 e 50.000.000.'
        );
    }

    return valor;
}

function validarPreco(centavos) {
    if (
        !Number.isSafeInteger(centavos) ||
        centavos <= 0
    ) {
        throw new Error(
            'Preço em centavos inválido.'
        );
    }

    return centavos;
}

function validarUsuarioRoblox(valor) {
    const username = String(valor ?? '')
        .trim();

    if (
        !/^[A-Za-z0-9_]{3,20}$/.test(username)
    ) {
        throw new Error(
            'Usuário Roblox inválido. ' +
            'Informe de 3 a 20 letras, números ou _.'
        );
    }

    return username;
}

function validarEscolha(
    valor,
    opcoes,
    nome
) {
    if (!opcoes.includes(valor)) {
        throw new Error(
            `${nome} inválido.`
        );
    }

    return valor;
}

function validarLimite(
    valor,
    padrao,
    maximo
) {
    const numero = Number(valor);

    if (
        !Number.isFinite(numero) ||
        numero < 1
    ) {
        return padrao;
    }

    return Math.min(
        Math.floor(numero),
        maximo
    );
}

// ==========================================
// CONSULTAS SQL
// ==========================================

const SQL = {
    buscarTicket: db.prepare(`
        SELECT *
        FROM tickets
        WHERE id = ?
    `),

    buscarPorCanal: db.prepare(`
        SELECT *
        FROM tickets
        WHERE canal_id = ?
        LIMIT 1
    `),

    buscarAtivo: db.prepare(`
        SELECT *
        FROM tickets
        WHERE servidor_id = ?
          AND cliente_id = ?
          AND status IN (
              'criando',
              'aberto',
              'em_atendimento',
              'finalizando'
          )
        ORDER BY id DESC
        LIMIT 1
    `),

    listarCliente: db.prepare(`
        SELECT *
        FROM tickets
        WHERE servidor_id = ?
          AND cliente_id = ?
        ORDER BY id DESC
        LIMIT ?
    `),

    criar: db.prepare(`
        INSERT INTO tickets (
            servidor_id,
            cliente_id,
            modalidade,
            quantidade_robux,
            preco_centavos,
            usuario_roblox,
            pagamento,
            status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'criando')
    `),

    vincularCanal: db.prepare(`
        UPDATE tickets
        SET canal_id = ?,
            status = 'aberto',
            atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status = 'criando'
          AND canal_id IS NULL
    `),

    descartarCriacao: db.prepare(`
        UPDATE tickets
        SET status = 'cancelado',
            atualizado_em = CURRENT_TIMESTAMP,
            encerrado_em = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status = 'criando'
    `),

    assumir: db.prepare(`
        UPDATE tickets
        SET atendente_id = ?,
            status = 'em_atendimento',
            atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status IN (
              'aberto',
              'em_atendimento'
          )
          AND (
              atendente_id IS NULL
              OR atendente_id = ?
          )
    `),

    iniciarFinalizacao: db.prepare(`
        UPDATE tickets
        SET status = 'finalizando',
            atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status IN (
              'aberto',
              'em_atendimento'
          )
    `),

    confirmarFinalizacao: db.prepare(`
        UPDATE tickets
        SET status = 'finalizado',
            preco_centavos = ?,
            atualizado_em = CURRENT_TIMESTAMP,
            encerrado_em = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status = 'finalizando'
    `),

    reverterFinalizacao: db.prepare(`
        UPDATE tickets
        SET status = 'aberto',
            atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status = 'finalizando'
    `),

    cancelar: db.prepare(`
        UPDATE tickets
        SET status = 'cancelado',
            atualizado_em = CURRENT_TIMESTAMP,
            encerrado_em = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status IN (
              'aberto',
              'em_atendimento'
          )
    `),

    historico: db.prepare(`
        SELECT *
        FROM logs_tickets
        WHERE ticket_id = ?
        ORDER BY id ASC
        LIMIT ?
    `),

    estatisticas: db.prepare(`
        SELECT
            status,
            COUNT(*) AS total
        FROM tickets
        WHERE servidor_id = ?
        GROUP BY status
    `)
};

// ==========================================
// CONSULTAR TICKET POR ID
// ==========================================

function buscarTicket(ticketId) {
    return SQL.buscarTicket.get(
        validarTicketId(ticketId)
    ) || null;
}

// ==========================================
// CONSULTAR TICKET PELO CANAL
// ==========================================

function buscarTicketPorCanal(canalId) {
    const id = validarId(
        canalId,
        'Canal'
    );

    return SQL.buscarPorCanal.get(id) || null;
}

// ==========================================
// VERIFICAR TICKET ATIVO DO CLIENTE
// ==========================================

function buscarTicketAtivoCliente(
    servidorId,
    clienteId
) {
    const servidor = validarId(
        servidorId,
        'Servidor'
    );

    const cliente = validarId(
        clienteId,
        'Cliente'
    );

    return SQL.buscarAtivo.get(
        servidor,
        cliente
    ) || null;
}

// ==========================================
// LISTAR HISTÓRICO DE TICKETS DO CLIENTE
// ==========================================

function listarTicketsCliente(
    servidorId,
    clienteId,
    limite = 10
) {
    const quantidade = validarLimite(
        limite,
        10,
        50
    );

    return SQL.listarCliente.all(
        validarId(servidorId, 'Servidor'),
        validarId(clienteId, 'Cliente'),
        quantidade
    );
}

// ==========================================
// CRIAR REGISTRO DE TICKET
// ==========================================

// Esta função cria somente o registro
// no SQLite.
//
// O canal privado será criado pelo handler
// usando as categorias configuradas no /setup.
//
// O preço em centavos é armazenado para
// registrar corretamente a venda depois.

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
        servidorId: validarId(
            servidorId,
            'Servidor'
        ),

        clienteId: validarId(
            clienteId,
            'Cliente'
        ),

        modalidade: validarEscolha(
            modalidade,
            MODALIDADES,
            'Modalidade'
        ),

        quantidadeRobux: validarQuantidade(
            quantidadeRobux
        ),

        precoCentavos: validarPreco(
            precoCentavos
        ),

        usuarioRoblox: validarUsuarioRoblox(
            usuarioRoblox
        ),

        pagamento: validarEscolha(
            pagamento,
            PAGAMENTOS,
            'Pagamento'
        )
    };

    // A consulta e a inserção ocorrem
    // na mesma transação SQLite.
    //
    // Isso evita registrar dois tickets
    // ativos para o mesmo cliente por
    // chamadas sequenciais deste serviço.

    return db.transaction(() => {
        const existente = buscarTicketAtivoCliente(
            dados.servidorId,
            dados.clienteId
        );

        if (existente) {
            const erro = new Error(
                'Você já possui um ticket ' +
                'aberto ou em criação.'
            );

            erro.codigo = 'TICKET_JA_ABERTO';
            erro.ticket = existente;

            throw erro;
        }

        const resultado = SQL.criar.run(
            dados.servidorId,
            dados.clienteId,
            dados.modalidade,
            dados.quantidadeRobux,
            dados.precoCentavos,
            dados.usuarioRoblox,
            dados.pagamento
        );

        const ticketId = Number(
            resultado.lastInsertRowid
        );

        registrarLog(
            ticketId,
            dados.clienteId,
            'ticket_criado'
        );

        return buscarTicket(ticketId);
    })();
}

// ==========================================
// VINCULAR CANAL DO DISCORD AO TICKET
// ==========================================

// Usar somente depois que o Discord
// confirmar que criou o canal privado.

function vincularCanalTicket(
    ticketId,
    canalId
) {
    const id = validarTicketId(
        ticketId
    );

    const canal = validarId(
        canalId,
        'Canal'
    );

    const resultado = SQL.vincularCanal.run(
        canal,
        id
    );

    if (resultado.changes !== 1) {
        throw new Error(
            'O ticket não está aguardando ' +
            'a criação de um canal.'
        );
    }

    registrarLog(
        id,
        null,
        'canal_criado',
        canal
    );

    return buscarTicket(id);
}

// ==========================================
// DESCARTAR CRIAÇÃO COM FALHA
// ==========================================

// Mantém o registro no histórico com
// status cancelado para auditoria.
//
// Não exclui tickets antigos do SQLite.

function descartarTicketEmCriacao(
    ticketId,
    motivo = 'Falha ao criar canal'
) {
    const id = validarTicketId(
        ticketId
    );

    const resultado = SQL.descartarCriacao.run(
        id
    );

    if (resultado.changes === 1) {
        registrarLog(
            id,
            null,
            'criacao_falhou',
            String(motivo).slice(0, 500)
        );
    }

    return resultado.changes === 1;
}

// ==========================================
// ASSUMIR ATENDIMENTO
// ==========================================

// Um atendente pode assumir um ticket
// que ainda não tenha responsável.
//
// O mesmo atendente pode repetir a
// operação sem transferir o ticket.
//
// Outro atendente não pode substituir
// o responsável por esta função.

function assumirTicket(
    ticketId,
    atendenteId
) {
    const id = validarTicketId(
        ticketId
    );

    const atendente = validarId(
        atendenteId,
        'Atendente'
    );

    const anterior = buscarTicket(id);

    const resultado = SQL.assumir.run(
        atendente,
        id,
        atendente
    );

    if (resultado.changes !== 1) {
        throw new Error(
            'Este ticket foi encerrado ' +
            'ou já pertence a outro atendente.'
        );
    }

    // Não cria um segundo registro
    // de "assumir" se o mesmo atendente
    // clicar novamente no botão.
    if (
        anterior?.atendente_id !== atendente ||
        anterior?.status !== STATUS.EM_ATENDIMENTO
    ) {
        registrarLog(
            id,
            atendente,
            'assumir'
        );
    }

    return buscarTicket(id);
}

// ==========================================
// INICIAR FINALIZAÇÃO
// ==========================================

// O preço pago é informado pelo atendente
// no modal administrativo.
//
// Nenhum valor em reais é publicado aqui.

function iniciarFinalizacao(
    ticketId,
    atendenteId
) {
    const id = validarTicketId(
        ticketId
    );

    const atendente = validarId(
        atendenteId,
        'Atendente'
    );

    const resultado = SQL.iniciarFinalizacao.run(
        id
    );

    if (resultado.changes !== 1) {
        return false;
    }

    registrarLog(
        id,
        atendente,
        'iniciou_finalizacao'
    );

    return true;
}

// ==========================================
// CONFIRMAR FINALIZAÇÃO
// ==========================================

// IMPORTANTE:
// Esta função deve ser chamada somente
// DEPOIS do registrarVenda() terminar.
//
// registrarVenda() continua responsável
// pelo histórico e pela prevenção
// de vendas duplicadas por ticket.

function confirmarFinalizacao(
    ticketId,
    atendenteId,
    valorCentavos
) {
    const id = validarTicketId(
        ticketId
    );

    const atendente = validarId(
        atendenteId,
        'Atendente'
    );

    const centavos = validarPreco(
        valorCentavos
    );

    const resultado = SQL.confirmarFinalizacao.run(
        centavos,
        id
    );

    if (resultado.changes !== 1) {
        throw new Error(
            'O ticket não está em finalização.'
        );
    }

    registrarLog(
        id,
        atendente,
        'venda_finalizada',
        `Valor pago: ${
            (centavos / 100).toLocaleString(
                'pt-BR',
                {
                    style: 'currency',
                    currency: 'BRL'
                }
            )
        }`
    );

    return buscarTicket(id);
}

// ==========================================
// REVERTER FINALIZAÇÃO
// ==========================================

// Usar somente quando for seguro
// tentar novamente.
//
// Se a venda já tiver sido salva,
// o serviço de vendas impedirá a
// duplicação pelo mesmo ticketId.

function reverterFinalizacao(ticketId) {
    const id = validarTicketId(
        ticketId
    );

    const resultado =
        SQL.reverterFinalizacao.run(id);

    return resultado.changes === 1;
}

// ==========================================
// CANCELAR TICKET
// ==========================================

// A ação de cancelar não registra venda.
//
// Tickets finalizados ou em finalização
// não podem ser cancelados.

function cancelarTicket(
    ticketId,
    atendenteId,
    motivo = null
) {
    const id = validarTicketId(
        ticketId
    );

    const atendente = validarId(
        atendenteId,
        'Atendente'
    );

    const resultado = SQL.cancelar.run(
        id
    );

    if (resultado.changes !== 1) {
        throw new Error(
            'Este ticket já foi encerrado ' +
            'ou está em finalização.'
        );
    }

    registrarLog(
        id,
        atendente,
        'cancelamento',
        motivo
            ? String(motivo).slice(0, 500)
            : null
    );

    return buscarTicket(id);
}

// ==========================================
// HISTÓRICO DE AÇÕES DO TICKET
// ==========================================

function obterHistoricoTicket(
    ticketId,
    limite = 50
) {
    const quantidade = validarLimite(
        limite,
        50,
        100
    );

    return SQL.historico.all(
        validarTicketId(ticketId),
        quantidade
    );
}

// ==========================================
// ESTATÍSTICAS DO SERVIDOR
// ==========================================

function obterEstatisticasTickets(
    servidorId
) {
    const servidor = validarId(
        servidorId,
        'Servidor'
    );

    const linhas = SQL.estatisticas.all(
        servidor
    );

    // Contadores de todos os status.
    const totais = Object.fromEntries(
        Object.values(STATUS).map(
            status => [status, 0]
        )
    );

    for (const linha of linhas) {
        totais[linha.status] =
            Number(linha.total || 0);
    }

    const ativos = STATUS_ATIVOS.reduce(
        (soma, status) =>
            soma + (totais[status] || 0),
        0
    );

    const total = linhas.reduce(
        (soma, linha) =>
            soma + Number(linha.total || 0),
        0
    );

    return {
        ...totais,

        ativos,
        total
    };
}

// ==========================================
// EXPORTAÇÕES COMPATÍVEIS
// ==========================================

// Mantém TODAS as funções exportadas
// anteriormente para não quebrar
// outras partes do projeto.

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
