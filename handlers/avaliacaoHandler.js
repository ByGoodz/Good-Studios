
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

const { db } = require('../database/db');

// ==========================================
// CRIAR TABELA DE AVALIAÇÕES
// ==========================================

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

    CREATE INDEX IF NOT EXISTS idx_avaliacoes_cliente
        ON avaliacoes(servidor_id, cliente_id);
`);

// ==========================================
// VERIFICAR SE TICKET FOI CONCLUÍDO
// ==========================================

function ticketConcluido(ticket) {
    return (
        ticket &&
        (
            ticket.status === 'finalizado' ||
            ticket.status === 'concluido'
        )
    );
}

// ==========================================
// BUSCAR TICKET
// ==========================================

function buscarTicket(ticketId) {
    return db.prepare(`
        SELECT *
        FROM tickets
        WHERE id = ?
    `).get(ticketId) || null;
}

// ==========================================
// VERIFICAR AVALIAÇÃO EXISTENTE
// ==========================================

function avaliacaoExiste(ticketId) {
    return Boolean(
        db.prepare(`
            SELECT id
            FROM avaliacoes
            WHERE ticket_id = ?
        `).get(ticketId)
    );
}

// ==========================================
// CRIAR PAINEL DE AVALIAÇÃO
// ==========================================

function criarPainelAvaliacao(ticketId) {
    const embed = new EmbedBuilder()
        .setColor(0xC0C0C0)
        .setTitle(
            '⭐ Avalie sua compra — InovareSale'
        )
        .setDescription(
            '💎 Obrigado por comprar na **InovareSale**!\n\n' +

            'Sua compra foi concluída com sucesso.\n\n' +

            '**Como foi sua experiência com nossa equipe?**\n\n' +

            'Escolha uma nota de **1 a 5 estrelas** ' +
            'nos botões abaixo.\n\n' +

            'Depois, você poderá escrever um comentário ' +
            'sobre o atendimento.'
        )
        .setFooter({
            text:
                `InovareSale • Pedido #${ticketId}`
        });

    const botoes = new ActionRowBuilder();

    for (let nota = 1; nota <= 5; nota++) {
        botoes.addComponents(
            new ButtonBuilder()
                .setCustomId(
                    `avaliacao_nota_${ticketId}_${nota}`
                )
                .setLabel(`${nota} ⭐`)
                .setStyle(
                    nota === 5
                        ? ButtonStyle.Success
                        : ButtonStyle.Secondary
                )
        );
    }

    return {
        embeds: [embed],
        components: [botoes],
        allowedMentions: {
            parse: []
        }
    };
}

// ==========================================
// ENVIAR AVALIAÇÃO PARA O CLIENTE
// ==========================================

async function solicitarAvaliacao(client, ticket) {
    if (!ticketConcluido(ticket)) {
        return false;
    }

    if (avaliacaoExiste(ticket.id)) {
        return false;
    }

    try {
        const cliente = await client.users.fetch(
            ticket.cliente_id
        );

        await cliente.send(
            criarPainelAvaliacao(ticket.id)
        );

        console.log(
            `⭐ Avaliação solicitada para ticket #${ticket.id}`
        );

        return true;

    } catch (erro) {
        // O cliente pode estar com DMs desativadas.
        console.log(
            `⚠️ Não consegui enviar avaliação do ticket #${ticket.id}:`,
            erro.message
        );

        return false;
    }
}

// ==========================================
// VALIDAR PROPRIETÁRIO DO TICKET
// ==========================================

function validarCliente(interaction, ticket) {
    if (!ticket) {
        return '❌ Pedido não encontrado.';
    }

    if (
        ticket.cliente_id !== interaction.user.id
    ) {
        return (
            '❌ Apenas o cliente que realizou ' +
            'a compra pode avaliar esse pedido.'
        );
    }

    if (!ticketConcluido(ticket)) {
        return (
            '❌ Apenas compras concluídas ' +
            'podem receber avaliações.'
        );
    }

    return null;
}

// ==========================================
// MOSTRAR FORMULÁRIO DE COMENTÁRIO
// ==========================================

async function abrirFormulario(
    interaction,
    ticketId,
    nota
) {
    const modal = new ModalBuilder()
        .setCustomId(
            `avaliacao_enviar_${ticketId}_${nota}`
        )
        .setTitle(
            `Avaliação — ${nota} estrela(s)`
        );

    const comentario = new TextInputBuilder()
        .setCustomId('comentario')
        .setLabel(
            'Conte como foi seu atendimento'
        )
        .setPlaceholder(
            'Seu comentário é opcional.'
        )
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(500);

    modal.addComponents(
        new ActionRowBuilder()
            .addComponents(comentario)
    );

    await interaction.showModal(modal);
}

// ==========================================
// SALVAR AVALIAÇÃO
// ==========================================

function salvarAvaliacao(
    ticket,
    nota,
    comentario
) {
    const resultado = db.prepare(`
        INSERT OR IGNORE INTO avaliacoes (
            ticket_id,
            servidor_id,
            cliente_id,
            nota,
            comentario
        )
        VALUES (?, ?, ?, ?, ?)
    `).run(
        ticket.id,
        ticket.servidor_id,
        ticket.cliente_id,
        nota,
        comentario || null
    );

    return resultado.changes > 0;
}

// ==========================================
// PROCESSAR BOTÕES E FORMULÁRIOS
// ==========================================

async function handleAvaliacaoInteraction(
    interaction
) {
    const id = interaction.customId || '';

    if (
        !id.startsWith('avaliacao_nota_') &&
        !id.startsWith('avaliacao_enviar_')
    ) {
        return false;
    }

    try {
        // ==================================
        // BOTÃO DE ESTRELAS
        // ==================================

        if (
            interaction.isButton() &&
            id.startsWith('avaliacao_nota_')
        ) {
            const match = id.match(
                /^avaliacao_nota_(\d+)_(\d)$/
            );

            if (!match) {
                return false;
            }

            const ticketId = Number(match[1]);
            const nota = Number(match[2]);

            const ticket = buscarTicket(ticketId);

            const erro = validarCliente(
                interaction,
                ticket
            );

            if (erro) {
                await interaction.reply({
                    content: erro,
                    flags: MessageFlags.Ephemeral
                });

                return true;
            }

            if (nota < 1 || nota > 5) {
                await interaction.reply({
                    content: '❌ Nota inválida.',
                    flags: MessageFlags.Ephemeral
                });

                return true;
            }

            if (avaliacaoExiste(ticketId)) {
                await interaction.reply({
                    content:
                        '✅ Você já avaliou essa compra.',
                    flags: MessageFlags.Ephemeral
                });

                return true;
            }

            await abrirFormulario(
                interaction,
                ticketId,
                nota
            );

            return true;
        }

        // ==================================
        // ENVIO DO FORMULÁRIO
        // ==================================

        if (
            interaction.isModalSubmit() &&
            id.startsWith('avaliacao_enviar_')
        ) {
            const match = id.match(
                /^avaliacao_enviar_(\d+)_(\d)$/
            );

            if (!match) {
                return false;
            }

            const ticketId = Number(match[1]);
            const nota = Number(match[2]);

            const ticket = buscarTicket(ticketId);

            const erro = validarCliente(
                interaction,
                ticket
            );

            if (erro) {
                await interaction.reply({
                    content: erro,
                    flags: MessageFlags.Ephemeral
                });

                return true;
            }

            if (nota < 1 || nota > 5) {
                await interaction.reply({
                    content: '❌ Nota inválida.',
                    flags: MessageFlags.Ephemeral
                });

                return true;
            }

            const comentario = interaction.fields
                .getTextInputValue('comentario')
                .trim();

            const salvo = salvarAvaliacao(
                ticket,
                nota,
                comentario
            );

            if (!salvo) {
                await interaction.reply({
                    content:
                        '✅ Essa compra já foi avaliada.',
                    flags: MessageFlags.Ephemeral
                });

                return true;
            }

            console.log(
                `⭐ Ticket #${ticketId} recebeu ${nota} estrela(s).`
            );

            await interaction.reply({
                content:
                    '💎 **Obrigado por avaliar a InovareSale!**\n\n' +
                    `⭐ Sua nota: **${nota}/5**\n\n` +
                    'Sua avaliação foi registrada com sucesso.',
                flags: MessageFlags.Ephemeral,
                allowedMentions: {
                    parse: []
                }
            });

            return true;
        }

        return false;

    } catch (erro) {
        console.error(
            '❌ Erro no sistema de avaliações:',
            erro
        );

        if (
            !interaction.replied &&
            !interaction.deferred
        ) {
            await interaction.reply({
                content:
                    '❌ Não foi possível processar sua avaliação.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }

        return true;
    }
}

// ==========================================
// CONSULTAR RESUMO DAS AVALIAÇÕES
// ==========================================

function obterResumoAvaliacoes(servidorId) {
    const resumo = db.prepare(`
        SELECT
            COUNT(*) AS total,
            ROUND(AVG(nota), 2) AS media
        FROM avaliacoes
        WHERE servidor_id = ?
    `).get(servidorId);

    return {
        total: resumo.total || 0,
        media: resumo.media || 0
    };
}

// ==========================================
// EXPORTAR FUNÇÕES
// ==========================================

module.exports = {
    criarPainelAvaliacao,
    solicitarAvaliacao,
    handleAvaliacaoInteraction,
    obterResumoAvaliacoes
};
