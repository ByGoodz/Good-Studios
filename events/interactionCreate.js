
'use strict';

const {
    Events,
    MessageFlags,
    PermissionFlagsBits
} = require('discord.js');

// ==========================================
// INOVARESALE BOT 3.0
// ROTEADOR CENTRAL DE INTERAÇÕES
// ==========================================
//
// Responsável por direcionar:
//
// - Comandos de barra (/)
// - Botões de configuração
// - Botões de tickets
// - Formulários de tickets
// - Avaliações por DM
// - Painéis de Limiteds
// - Compras de Limiteds
// - Entregas de Limiteds
//
// Cada interação deve ser atendida
// por apenas um handler.
//
// Componentes de outros sistemas
// que possuem collectors próprios
// não são interceptados.

// ==========================================
// HANDLERS
// ==========================================

const {
    handleSetupInteraction
} = require('../handlers/setupHandler');

const {
    handleTicketInteraction
} = require('../handlers/ticketHandler');

const {
    handleAvaliacaoInteraction
} = require('../handlers/avaliacaoHandler');

const {
    handleLimitedsInteraction
} = require('../handlers/limitedsHandler');

// ==========================================
// COMANDOS ADMINISTRATIVOS
// ==========================================

// Uma camada adicional de proteção.
//
// Cada comando também deve
// validar suas próprias permissões.

const COMANDOS_ADMIN = new Set([
    'setup',
    'estoque',
    'venda'
]);

// ==========================================
// IDENTIFICAR O HANDLER
// ==========================================

function identificarHandler(customId) {
    if (
        typeof customId !== 'string' ||
        customId.length === 0
    ) {
        return null;
    }

    // ======================================
    // SETUP ADMINISTRATIVO
    // ======================================

    if (
        customId.startsWith('setup_') ||
        customId.startsWith('modal_k_') ||
        customId === 'modal_estoque_preco'
    ) {
        return {
            nome: 'setup',
            executar: handleSetupInteraction
        };
    }

    // ======================================
    // TICKETS E COMPRAS DE ROBUX
    // ======================================

    if (
        customId.startsWith('ticket_')
    ) {
        return {
            nome: 'tickets',
            executar: handleTicketInteraction
        };
    }

    // ======================================
    // AVALIAÇÕES
    // ======================================

    if (
        customId.startsWith('avaliacao_')
    ) {
        return {
            nome: 'avaliacoes',
            executar: handleAvaliacaoInteraction
        };
    }

    // ======================================
    // LIMITEDS
    // ======================================

    if (
        customId.startsWith('limiteds_')
    ) {
        return {
            nome: 'limiteds',
            executar: handleLimitedsInteraction
        };
    }

    return null;
}

// ==========================================
// RESPONDER ERRO DE FORMA SEGURA
// ==========================================

async function responderErro(
    interaction,
    mensagem
) {
    const payload = {
        content: mensagem,

        allowedMentions: {
            parse: []
        }
    };

    // Interação com deferReply:
    // usar editReply evita tentar
    // responder pela segunda vez.

    if (interaction.deferred) {
        return interaction.editReply(
            payload
        );
    }

    // Interação já respondida:
    // enviar uma mensagem adicional
    // de forma privada.

    if (interaction.replied) {
        return interaction.followUp({
            ...payload,

            flags:
                MessageFlags.Ephemeral
        });
    }

    // Primeira resposta:
    // manter privada.

    return interaction.reply({
        ...payload,

        flags:
            MessageFlags.Ephemeral
    });
}

// ==========================================
// EXECUTAR COMANDO SLASH
// ==========================================

async function executarComando(
    interaction,
    client
) {
    const nome =
        interaction.commandName;

    // ======================================
    // RESTRIÇÃO ADMINISTRATIVA
    // ======================================

    if (
        COMANDOS_ADMIN.has(nome) &&
        !interaction.memberPermissions?.has(
            PermissionFlagsBits.Administrator
        )
    ) {
        await responderErro(
            interaction,

            '❌ Apenas administradores podem ' +
            'utilizar esse comando.'
        );

        return;
    }

    // ======================================
    // LOCALIZAR COMANDO
    // ======================================

    const comando =
        client.commands?.get(nome);

    if (
        !comando ||
        typeof comando.execute !== 'function'
    ) {
        console.warn(
            '[InovareSale] ' +
            `Comando não encontrado: /${nome}`
        );

        await responderErro(
            interaction,

            '❌ Esse comando não está ' +
            'disponível no momento.'
        );

        return;
    }

    // ======================================
    // EXECUTAR
    // ======================================

    // Mantemos o contrato anterior:
    //
    // comando.execute(interaction, client)
    //
    // Comandos que usam apenas
    // interaction continuam
    // funcionando normalmente.

    await comando.execute(
        interaction,
        client
    );
}

// ==========================================
// EXECUTAR COMPONENTE
// ==========================================

async function executarComponente(
    interaction
) {
    const customId =
        interaction.customId;

    const handler =
        identificarHandler(
            customId
        );

    // ======================================
    // COMPONENTE NÃO GERENCIADO
    // ======================================

    // Não respondemos a componentes
    // desconhecidos.
    //
    // Eles podem pertencer a um
    // collector de outro comando.
    //
    // Exemplos:
    //
    // estoque_v2_*
    //
    // Responder aqui causaria
    // "Interaction has already
    // been acknowledged".

    if (!handler) {
        return false;
    }

    // ======================================
    // DIRECIONAR AO HANDLER CORRETO
    // ======================================

    const tratado =
        await handler.executar(
            interaction
        );

    // ======================================
    // HANDLER NÃO RECONHECEU A AÇÃO
    // ======================================

    // Só mostramos a mensagem de erro
    // quando a interação pertence
    // claramente a um dos prefixos
    // gerenciados por este roteador.

    if (!tratado) {
        await responderErro(
            interaction,

            '⚠️ Esta opção não está disponível ' +
            'ou pertence a uma versão antiga ' +
            'do painel.'
        );
    }

    return true;
}

// ==========================================
// IDENTIFICAR COMPONENTES DO DISCORD
// ==========================================

function ehInteracaoDeComponente(
    interaction
) {
    return Boolean(
        interaction.isButton?.() ||
        interaction.isStringSelectMenu?.() ||
        interaction.isChannelSelectMenu?.() ||
        interaction.isRoleSelectMenu?.() ||
        interaction.isUserSelectMenu?.() ||
        interaction.isMentionableSelectMenu?.() ||
        interaction.isModalSubmit?.()
    );
}

// ==========================================
// EVENTO PRINCIPAL
// ==========================================

module.exports = {
    name:
        Events.InteractionCreate,

    async execute(
        interaction,
        client
    ) {
        const bot =
            client ||
            interaction.client;

        try {
            // ==================================
            // COMANDOS SLASH
            // ==================================

            if (
                interaction.isChatInputCommand()
            ) {
                await executarComando(
                    interaction,
                    bot
                );

                return;
            }

            // ==================================
            // BOTÕES, MENUS E MODAIS
            // ==================================

            if (
                ehInteracaoDeComponente(
                    interaction
                )
            ) {
                await executarComponente(
                    interaction
                );

                return;
            }

            // ==================================
            // OUTROS TIPOS DE INTERAÇÃO
            // ==================================

            // Interações não reconhecidas
            // são ignoradas para não
            // interferir em outros
            // listeners ou collectors.

        } catch (erro) {
            console.error(
                '[InovareSale Bot 3.0] ' +
                'Erro em interactionCreate:',
                erro
            );

            try {
                await responderErro(
                    interaction,

                    '❌ Ocorreu um erro ao processar ' +
                    'sua ação. Tente novamente ' +
                    'ou avise a equipe.'
                );

            } catch (erroResposta) {
                console.error(
                    '[InovareSale Bot 3.0] ' +
                    'Falha ao responder interação:',
                    erroResposta
                );
            }
        }
    }
};
