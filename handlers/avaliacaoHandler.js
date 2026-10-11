
'use strict';

const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags
} = require('discord.js');

const {
    db
} = require('../database/db');

const {
    registrarLogSistema
} = require('../services/logsService');

// ==========================================
// INOVARESALE BOT 3.0
// HANDLER COMPLETO DE AVALIAÇÕES
// ==========================================

// FUNCIONALIDADES:
//
// - Enviar avaliação por DM
// - Escolher de 1 a 5 estrelas
// - Permitir comentário opcional
// - Confirmar o cliente do ticket
// - Aceitar apenas compras concluídas
// - Salvar avaliações no SQLite
// - Impedir avaliação duplicada
// - Impedir solicitações duplicadas
// - Preservar avaliações antigas
// - Registrar avaliação nos logs
// - Consultar estatísticas reais
//
// COMPATIBILIDADE:
//
// events/interactionCreate.js chama:
//
// handleAvaliacaoInteraction(interaction)
//
// handlers/ticketHandler.js chama:
//
// solicitarAvaliacao(client, ticket)
//
// Esses nomes permanecem iguais.

// ==========================================
// CONFIGURAÇÕES
// ==========================================

const COR = 0x9951CB;

const MAX_COMENTARIO = 500;

const STATUS_SOLICITACAO = Object.freeze({
    PREPARANDO: 'preparando',
    ENVIANDO: 'enviando',
    ENVIADO: 'enviado',
    FALHA: 'falha',
    AVALIADO: 'avaliado'
});

// ==========================================
// ERROS CONTROLADOS
// ==========================================

class ErroAvaliacao extends Error {
    constructor(mensagem) {
        super(mensagem);

        this.name = 'ErroAvaliacao';
    }
}

// ==========================================
// TABELA ORIGINAL DE AVALIAÇÕES
// ==========================================

// Mantemos exatamente o nome da
// tabela usado pelo sistema anterior.
//
// CREATE TABLE IF NOT EXISTS
// não apaga avaliações existentes.
//
// Cada ticket pode receber apenas
// uma avaliação definitiva.

db.exec(`
    CREATE TABLE IF NOT EXISTS avaliacoes (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        ticket_id INTEGER NOT NULL UNIQUE,

        servidor_id TEXT NOT NULL,

        cliente_id TEXT NOT NULL,

        nota INTEGER NOT NULL
            CHECK (nota BETWEEN 1 AND 5),

        comentario TEXT,

        criada_em TEXT NOT NULL
            DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (ticket_id)
            REFERENCES tickets(id)
    );

    CREATE INDEX IF NOT EXISTS
        idx_avaliacoes_cliente

    ON avaliacoes (
        servidor_id,
        cliente_id
    );
`);

// ==========================================
// CONTROLE DE SOLICITAÇÕES POR DM
// ==========================================

// Esta tabela é nova.
//
// Ela registra se o bot já tentou
// enviar a solicitação de avaliação.
//
// Se uma DM tiver resultado incerto,
// o bot não envia outra automaticamente.
//
// Isso evita várias mensagens iguais
// após reinícios ou eventos repetidos.
//
// A tabela original "avaliacoes"
// permanece intacta.

db.exec(`
    CREATE TABLE IF NOT EXISTS
        avaliacoes_solicitacoes_v3 (

            ticket_id INTEGER PRIMARY KEY,

            servidor_id TEXT NOT NULL,

            cliente_id TEXT NOT NULL,

            status TEXT NOT NULL
                DEFAULT 'preparando',

            canal_id TEXT,

            mensagem_id TEXT,

            erro TEXT,

            criada_em TEXT NOT NULL
                DEFAULT CURRENT_TIMESTAMP,

            atualizada_em TEXT NOT NULL
                DEFAULT CURRENT_TIMESTAMP
        );

    CREATE INDEX IF NOT EXISTS
        idx_avaliacoes_solicitacoes_servidor_v3

    ON avaliacoes_solicitacoes_v3 (
        servidor_id,
        status
    );
`);

// ==========================================
// CONSULTAS PREPARADAS
// ==========================================

const SQL = {
    buscarTicket: db.prepare(`
        SELECT *
        FROM tickets
        WHERE id = ?
        LIMIT 1
    `),

    buscarAvaliacao: db.prepare(`
        SELECT *
        FROM avaliacoes
        WHERE ticket_id = ?
        LIMIT 1
    `),

    inserirAvaliacao: db.prepare(`
        INSERT OR IGNORE INTO avaliacoes (
            ticket_id,
            servidor_id,
            cliente_id,
            nota,
            comentario
        )

        VALUES (?, ?, ?, ?, ?)
    `),

    reservarSolicitacao: db.prepare(`
        INSERT OR IGNORE INTO
            avaliacoes_solicitacoes_v3 (
                ticket_id,
                servidor_id,
                cliente_id,
                status
            )

        VALUES (
            ?, ?, ?, 'preparando'
        )
    `),

    marcarEnviando: db.prepare(`
        UPDATE avaliacoes_solicitacoes_v3

        SET status = 'enviando',
            atualizada_em = CURRENT_TIMESTAMP

        WHERE ticket_id = ?
          AND status = 'preparando'
    `),

    marcarEnviado: db.prepare(`
        UPDATE avaliacoes_solicitacoes_v3

        SET status = 'enviado',
            canal_id = ?,
            mensagem_id = ?,
            erro = NULL,
            atualizada_em = CURRENT_TIMESTAMP

        WHERE ticket_id = ?
          AND status = 'enviando'
    `),

    marcarFalha: db.prepare(`
        UPDATE avaliacoes_solicitacoes_v3

        SET status = 'falha',
            erro = ?,
            atualizada_em = CURRENT_TIMESTAMP

        WHERE ticket_id = ?
          AND status IN (
              'preparando',
              'enviando'
          )
    `),

    marcarAvaliado: db.prepare(`
        UPDATE avaliacoes_solicitacoes_v3

        SET status = 'avaliado',
            atualizada_em = CURRENT_TIMESTAMP

        WHERE ticket_id = ?
    `),

    resumo: db.prepare(`
        SELECT
            COUNT(*) AS total,

            ROUND(
                AVG(nota),
                2
            ) AS media

        FROM avaliacoes

        WHERE servidor_id = ?
    `),

    distribuicao: db.prepare(`
        SELECT
            nota,
            COUNT(*) AS total

        FROM avaliacoes

        WHERE servidor_id = ?

        GROUP BY nota
    `)
};

// ==========================================
// VALIDAR ID DO TICKET
// ==========================================

function validarTicketId(valor) {
    const id = Number(valor);

    if (
        !Number.isSafeInteger(id) ||
        id < 1
    ) {
        throw new ErroAvaliacao(
            'Número do ticket inválido.'
        );
    }

    return id;
}

// ==========================================
// VALIDAR NOTA
// ==========================================

function validarNota(valor) {
    const nota = Number(valor);

    if (
        !Number.isInteger(nota) ||
        nota < 1 ||
        nota > 5
    ) {
        throw new ErroAvaliacao(
            'A nota precisa ser de 1 a 5 estrelas.'
        );
    }

    return nota;
}

// ==========================================
// VALIDAR COMENTÁRIO
// ==========================================

function normalizarComentario(valor) {
    const comentario =
        String(valor ?? '')
            .replace(/\u0000/g, '')
            .trim();

    if (
        comentario.length >
        MAX_COMENTARIO
    ) {
        throw new ErroAvaliacao(
            'O comentário ultrapassou ' +
            '500 caracteres.'
        );
    }

    return comentario || null;
}

// ==========================================
// FORMATAR NÚMERO DO PEDIDO
// ==========================================

function numeroPedido(ticketId) {
    return (
        'INV-' +
        String(ticketId).padStart(4, '0')
    );
}

// ==========================================
// VERIFICAR TICKET CONCLUÍDO
// ==========================================

// "finalizado" é o estado utilizado
// pelo ticketService.js atual.
//
// "concluido" é aceito por
// compatibilidade com registros
// mais antigos, caso existam.

function ticketConcluido(ticket) {
    return Boolean(
        ticket &&
        [
            'finalizado',
            'concluido'
        ].includes(
            ticket.status
        )
    );
}

// ==========================================
// BUSCAR TICKET
// ==========================================

function buscarTicket(ticketId) {
    const id =
        validarTicketId(ticketId);

    return SQL.buscarTicket.get(
        id
    ) || null;
}

// ==========================================
// CONSULTAR AVALIAÇÃO EXISTENTE
// ==========================================

function buscarAvaliacao(ticketId) {
    const id =
        validarTicketId(ticketId);

    return SQL.buscarAvaliacao.get(
        id
    ) || null;
}

function avaliacaoExiste(ticketId) {
    return Boolean(
        buscarAvaliacao(
            ticketId
        )
    );
}

// ==========================================
// VALIDAR CLIENTE DA COMPRA
// ==========================================

function validarCliente(
    interaction,
    ticket
) {
    if (!ticket) {
        throw new ErroAvaliacao(
            'Esse pedido não foi encontrado.'
        );
    }

    if (
        ticket.cliente_id !==
        interaction.user.id
    ) {
        throw new ErroAvaliacao(
            'Apenas o cliente que realizou ' +
            'a compra pode avaliá-la.'
        );
    }

    if (
        !ticketConcluido(ticket)
    ) {
        throw new ErroAvaliacao(
            'Apenas compras concluídas ' +
            'podem receber avaliações.'
        );
    }

    return true;
}

// ==========================================
// RESPONDER INTERAÇÃO
// ==========================================

// As avaliações são solicitadas
// por mensagem direta.
//
// Na DM, a resposta já é privada.
//
// Dentro de servidores, usamos
// a resposta efêmera.

async function responderPrivado(
    interaction,
    conteudo
) {
    const dados =
        typeof conteudo === 'string'
            ? { content: conteudo }
            : conteudo;

    const payload = {
        ...dados,

        allowedMentions: {
            parse: []
        }
    };

    if (
        interaction.inGuild?.()
    ) {
        payload.flags =
            MessageFlags.Ephemeral;
    }

    if (interaction.deferred) {
        const {
            flags,
            ...edicao
        } = payload;

        return interaction.editReply(
            edicao
        );
    }

    if (interaction.replied) {
        return interaction.followUp(
            payload
        );
    }

    return interaction.reply(
        payload
    );
}

// ==========================================
// CRIAR PAINEL DE AVALIAÇÃO
// ==========================================

// Cinco estrelas:
//
// 1 ⭐
// 2 ⭐
// 3 ⭐
// 4 ⭐
// 5 ⭐
//
// Os IDs permanecem compatíveis
// com o roteador de interações.
//
// avaliacao_nota_TICKET_NOTA

function criarPainelAvaliacao(ticketId) {
    const id =
        validarTicketId(ticketId);

    const embed =
        new EmbedBuilder()
            .setColor(COR)
            .setTitle(
                '⭐ INOVARESALE | AVALIE SUA COMPRA'
            )
            .setDescription(
                [
                    '💜 Obrigado por comprar na **InovareSale**!',
                    '',
                    `🎫 **Pedido:** ${numeroPedido(id)}`,
                    '',
                    '**Como foi sua experiência?**',
                    '',
                    'Escolha uma nota de **1 a 5 estrelas** ' +
                    'nos botões abaixo.',
                    '',
                    'Depois você poderá escrever um ' +
                    'comentário opcional sobre o atendimento.',
                    '',
                    'Sua avaliação será registrada ' +
                    'uma única vez.'
                ].join('\n')
            )
            .setFooter({
                text:
                    'InovareSale Bot 3.0 • Avaliações'
            });

    const linha =
        new ActionRowBuilder();

    for (
        let nota = 1;
        nota <= 5;
        nota++
    ) {
        linha.addComponents(
            new ButtonBuilder()
                .setCustomId(
                    `avaliacao_nota_${id}_${nota}`
                )
                .setLabel(
                    `${nota} ⭐`
                )
                .setStyle(
                    nota === 5
                        ? ButtonStyle.Success
                        : ButtonStyle.Secondary
                )
        );
    }

    return {
        embeds: [embed],

        components: [linha],

        allowedMentions: {
            parse: []
        }
    };
}

// ==========================================
// SOLICITAR AVALIAÇÃO POR DM
// ==========================================

// Chamado depois que a compra
// já foi finalizada no SQLite.
//
// Se o bot receber a mesma
// solicitação várias vezes,
// apenas a primeira poderá
// tentar enviar a DM.
//
// O estado é reservado ANTES
// do envio ao Discord.
//
// Se o envio ficar incerto,
// não haverá repetição automática.
//
// Eventual novo envio deverá ser
// tratado pela administração
// em uma revisão específica.

async function solicitarAvaliacao(
    client,
    ticket
) {
    if (
        !client?.users ||
        !ticket?.id
    ) {
        return false;
    }

    const id =
        validarTicketId(
            ticket.id
        );

    // ======================================
    // CONFERIR ESTADO REAL NO SQLITE
    // ======================================

    const atual =
        buscarTicket(id);

    if (
        !ticketConcluido(atual)
    ) {
        return false;
    }

    // ======================================
    // NÃO SOLICITAR APÓS AVALIAÇÃO
    // ======================================

    if (
        avaliacaoExiste(id)
    ) {
        return false;
    }

    // ======================================
    // RESERVAR SOLICITAÇÃO
    // ======================================

    const reserva =
        SQL.reservarSolicitacao.run(
            id,
            atual.servidor_id,
            atual.cliente_id
        );

    if (
        reserva.changes !== 1
    ) {
        // Este ticket já teve
        // uma solicitação registrada.

        return false;
    }

    try {
        const iniciado =
            SQL.marcarEnviando.run(
                id
            );

        if (
            iniciado.changes !== 1
        ) {
            return false;
        }

        // ==================================
        // CONSULTAR CLIENTE
        // ==================================

        const cliente =
            await client.users.fetch(
                atual.cliente_id
            );

        if (!cliente) {
            throw new Error(
                'Cliente não encontrado.'
            );
        }

        // ==================================
        // ENVIAR PAINEL POR DM
        // ==================================

        const mensagem =
            await cliente.send(
                criarPainelAvaliacao(
                    id
                )
            );

        // ==================================
        // CONFIRMAR MENSAGEM
        // ==================================

        SQL.marcarEnviado.run(
            mensagem.channelId,
            mensagem.id,
            id
        );

        console.log(
            '[InovareSale | Avaliações] ' +
            `Avaliação solicitada: ${numeroPedido(id)}`
        );

        return true;

    } catch (erro) {
        console.warn(
            '[InovareSale | Avaliações] ' +
            `Não foi possível solicitar ${numeroPedido(id)}:`,
            erro.message
        );

        // Uma falha de conexão após
        // o envio pode ter ocorrido
        // mesmo que a DM tenha
        // sido recebida.
        //
        // Por segurança, não
        // repetiremos automaticamente.

        try {
            SQL.marcarFalha.run(
                String(
                    erro.message ||
                    'Falha ao enviar DM'
                ).slice(0, 400),
                id
            );

        } catch (erroBanco) {
            console.error(
                '[InovareSale | Avaliações] ' +
                'Falha ao registrar problema:',
                erroBanco
            );
        }

        return false;
    }
}

// ==========================================
// CRIAR FORMULÁRIO DE COMENTÁRIO
// ==========================================

// ID mantido:
//
// avaliacao_enviar_TICKET_NOTA
//
// O comentário não é obrigatório.

async function abrirFormulario(
    interaction,
    ticketId,
    nota
) {
    const modal =
        new ModalBuilder()
            .setCustomId(
                `avaliacao_enviar_${ticketId}_${nota}`
            )
            .setTitle(
                `Avaliação - ${nota} estrela(s)`
            );

    const campo =
        new TextInputBuilder()
            .setCustomId(
                'comentario'
            )
            .setLabel(
                'Como foi seu atendimento?'
            )
            .setPlaceholder(
                'Seu comentário é opcional'
            )
            .setStyle(
                TextInputStyle.Paragraph
            )
            .setRequired(false)
            .setMaxLength(
                MAX_COMENTARIO
            );

    modal.addComponents(
        new ActionRowBuilder()
            .addComponents(campo)
    );

    await interaction.showModal(
        modal
    );
}

// ==========================================
// SALVAR AVALIAÇÃO NO SQLITE
// ==========================================

// A validação e a gravação ocorrem
// dentro de uma única transação.
//
// O ticket é consultado novamente.
//
// Assim, mesmo que o usuário
// mantenha um formulário antigo
// aberto, ele só poderá avaliar
// um pedido que esteja concluído.
//
// INSERT OR IGNORE respeita a
// restrição UNIQUE(ticket_id).
//
// Uma segunda tentativa NÃO cria
// outra avaliação.

function salvarAvaliacao({
    ticketId,
    clienteId,
    nota,
    comentario
}) {
    const id =
        validarTicketId(
            ticketId
        );

    const estrelas =
        validarNota(
            nota
        );

    const texto =
        normalizarComentario(
            comentario
        );

    return db.transaction(() => {
        const ticket =
            buscarTicket(
                id
            );

        if (!ticket) {
            throw new ErroAvaliacao(
                'Pedido não encontrado.'
            );
        }

        if (
            ticket.cliente_id !==
            clienteId
        ) {
            throw new ErroAvaliacao(
                'Você não é o cliente desse pedido.'
            );
        }

        if (
            !ticketConcluido(ticket)
        ) {
            throw new ErroAvaliacao(
                'Esse pedido ainda não foi concluído.'
            );
        }

        const anterior =
            SQL.buscarAvaliacao.get(
                id
            );

        if (anterior) {
            return {
                novo: false,
                avaliacao: anterior,
                ticket
            };
        }

        const insercao =
            SQL.inserirAvaliacao.run(
                id,
                ticket.servidor_id,
                ticket.cliente_id,
                estrelas,
                texto
            );

        const avaliacao =
            SQL.buscarAvaliacao.get(
                id
            );

        if (!avaliacao) {
            throw new Error(
                'Não foi possível confirmar ' +
                'a avaliação no SQLite.'
            );
        }

        if (
            insercao.changes === 1
        ) {
            SQL.marcarAvaliado.run(
                id
            );
        }

        return {
            novo:
                insercao.changes === 1,

            avaliacao,
            ticket
        };
    })();
}

// ==========================================
// REGISTRAR AVALIAÇÃO NOS LOGS
// ==========================================

// A avaliação é salva primeiro.
//
// Falhas de logs não apagam
// a nota nem o comentário.
//
// O comentário é enviado apenas
// para o canal administrativo
// de logs, quando configurado.
//
// Não publicamos avaliações
// automaticamente em canais públicos.

async function registrarLogAvaliacao(
    client,
    ticket,
    avaliacao
) {
    try {
        const guild =
            client.guilds.cache.get(
                ticket.servidor_id
            );

        if (!guild) {
            return false;
        }

        const nota =
            Number(
                avaliacao.nota
            );

        const comentario =
            avaliacao.comentario
                ? String(
                    avaliacao.comentario
                )
                    .replace(/@/g, '＠')
                    .slice(0, MAX_COMENTARIO)
                : 'Sem comentário.';

        await registrarLogSistema({
            guild,

            tipo:
                'avaliacao_registrada',

            titulo:
                'Nova avaliação recebida',

            detalhes:
                `Pedido: ${
                    numeroPedido(ticket.id)
                }\n` +
                `Cliente: <@${ticket.cliente_id}>\n` +
                `Nota: ${'⭐'.repeat(nota)} (${nota}/5)\n` +
                `Comentário: ${comentario}`,

            autorId:
                ticket.cliente_id,

            alvoId:
                ticket.cliente_id,

            referencia:
                numeroPedido(ticket.id),

            chaveEvento:
                `avaliacao_${ticket.id}`
        });

        return true;

    } catch (erro) {
        console.error(
            '[InovareSale | Avaliações] ' +
            'Falha ao registrar log:',
            erro
        );

        return false;
    }
}

// ==========================================
// PROCESSAR BOTÃO DE ESTRELAS
// ==========================================

async function processarBotaoNota(
    interaction,
    ticketId,
    nota
) {
    const ticket =
        buscarTicket(
            ticketId
        );

    validarCliente(
        interaction,
        ticket
    );

    const estrelas =
        validarNota(
            nota
        );

    if (
        avaliacaoExiste(ticketId)
    ) {
        await responderPrivado(
            interaction,
            '✅ Você já avaliou essa compra.'
        );

        return true;
    }

    await abrirFormulario(
        interaction,
        ticketId,
        estrelas
    );

    return true;
}

// ==========================================
// PROCESSAR FORMULÁRIO DE AVALIAÇÃO
// ==========================================

async function processarFormulario(
    interaction,
    ticketId,
    nota
) {
    const ticket =
        buscarTicket(
            ticketId
        );

    validarCliente(
        interaction,
        ticket
    );

    const estrelas =
        validarNota(
            nota
        );

    const comentario =
        interaction.fields
            .getTextInputValue(
                'comentario'
            );

    // ======================================
    // ADIAR RESPOSTA
    // ======================================

    const deferOptions =
        interaction.inGuild()
            ? {
                flags:
                    MessageFlags.Ephemeral
            }
            : {};

    await interaction.deferReply(
        deferOptions
    );

    // ======================================
    // SALVAR NO SQLITE
    // ======================================

    const resultado =
        salvarAvaliacao({
            ticketId,

            clienteId:
                interaction.user.id,

            nota:
                estrelas,

            comentario
        });

    // ======================================
    // AVALIAÇÃO EXISTENTE
    // ======================================

    if (!resultado.novo) {
        await responderPrivado(
            interaction,
            '✅ Esta compra já foi avaliada. ' +
            'Não registramos uma segunda avaliação.'
        );

        return true;
    }

    // ======================================
    // CONFIRMAR AO CLIENTE
    // ======================================

    await responderPrivado(
        interaction,
        {
            content:
                '💜 **Obrigado por avaliar a InovareSale!**\n\n' +
                `⭐ Sua nota: **${estrelas}/5**\n\n` +
                '✅ Sua avaliação foi salva com sucesso.'
        }
    );

    console.log(
        '[InovareSale | Avaliações] ' +
        `Pedido ${numeroPedido(ticketId)} ` +
        `recebeu ${estrelas} estrela(s).`
    );

    // ======================================
    // REGISTRAR LOG
    // ======================================

    await registrarLogAvaliacao(
        interaction.client,
        resultado.ticket,
        resultado.avaliacao
    );

    return true;
}

// ==========================================
// HANDLER PRINCIPAL
// ==========================================

async function handleAvaliacaoInteraction(
    interaction
) {
    const id =
        interaction.customId || '';

    if (
        !id.startsWith(
            'avaliacao_'
        )
    ) {
        return false;
    }

    try {
        // ==================================
        // BOTÃO DE ESTRELAS
        // ==================================

        const botao =
            id.match(
                /^avaliacao_nota_(\d+)_([1-5])$/
            );

        if (
            interaction.isButton() &&
            botao
        ) {
            const ticketId =
                validarTicketId(
                    botao[1]
                );

            const nota =
                validarNota(
                    botao[2]
                );

            return await processarBotaoNota(
                interaction,
                ticketId,
                nota
            );
        }

        // ==================================
        // FORMULÁRIO DE COMENTÁRIO
        // ==================================

        const formulario =
            id.match(
                /^avaliacao_enviar_(\d+)_([1-5])$/
            );

        if (
            interaction.isModalSubmit() &&
            formulario
        ) {
            const ticketId =
                validarTicketId(
                    formulario[1]
                );

            const nota =
                validarNota(
                    formulario[2]
                );

            return await processarFormulario(
                interaction,
                ticketId,
                nota
            );
        }

        // ==================================
        // ID ANTIGO OU NÃO RECONHECIDO
        // ==================================

        await responderPrivado(
            interaction,
            '⚠️ Esse formulário de avaliação ' +
            'não é mais reconhecido.'
        );

        return true;

    } catch (erro) {
        console.error(
            '[InovareSale | Avaliações] Erro:',
            erro
        );

        const mensagem =
            erro instanceof ErroAvaliacao
                ? `❌ ${erro.message}`
                : (
                    '❌ Não foi possível processar ' +
                    'sua avaliação. Tente novamente ' +
                    'ou avise a equipe.'
                );

        try {
            await responderPrivado(
                interaction,
                mensagem
            );

        } catch (erroResposta) {
            console.error(
                '[InovareSale | Avaliações] ' +
                'Falha ao responder:',
                erroResposta
            );
        }

        return true;
    }
}

// ==========================================
// CONSULTAR RESUMO DAS AVALIAÇÕES
// ==========================================

// Mostra:
//
// - Quantidade de avaliações
// - Média de estrelas
// - Distribuição de 1 a 5
//
// Não inventamos avaliações
// nem substituímos valores antigos.

function obterResumoAvaliacoes(
    servidorId
) {
    const servidor =
        String(
            servidorId ?? ''
        ).trim();

    if (
        !/^\d{15,22}$/.test(servidor)
    ) {
        throw new Error(
            'Servidor inválido.'
        );
    }

    const resultado =
        SQL.resumo.get(
            servidor
        );

    const linhas =
        SQL.distribuicao.all(
            servidor
        );

    const distribuicao = {
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0
    };

    for (const linha of linhas) {
        const nota =
            Number(
                linha.nota
            );

        if (
            nota >= 1 &&
            nota <= 5
        ) {
            distribuicao[nota] =
                Number(
                    linha.total || 0
                );
        }
    }

    return {
        total:
            Number(
                resultado?.total || 0
            ),

        media:
            Number(
                resultado?.media || 0
            ),

        distribuicao
    };
}

// ==========================================
// EXPORTAÇÕES
// ==========================================

// Compatibilidade com o sistema
// anterior e com os serviços 3.0.

module.exports = {
    criarPainelAvaliacao,

    solicitarAvaliacao,

    handleAvaliacaoInteraction,

    obterResumoAvaliacoes,

    buscarAvaliacao,
    avaliacaoExiste
};
