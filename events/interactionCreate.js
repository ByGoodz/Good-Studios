
'use strict';

const {
    Events,
    MessageFlags,
    PermissionFlagsBits
} = require('discord.js');

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

const COMANDOS_ADMIN = new Set([
    'setup',
    'estoque',
    'venda'
]);

function identificarHandler(customId) {
    if (
        typeof customId !== 'string' ||
        !customId.length
    ) {
        return null;
    }

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

    if (customId.startsWith('ticket_')) {
        return {
            nome: 'tickets',
            executar: handleTicketInteraction
        };
    }

    if (customId.startsWith('avaliacao_')) {
        return {
            nome: 'avaliacoes',
            executar: handleAvaliacaoInteraction
        };
    }

    if (customId.startsWith('limiteds_')) {
        return {
            nome: 'limiteds',
            executar: handleLimitedsInteraction
        };
    }

    if (customId.startsWith('status_')) {
        return {
            nome: 'status',
            executar: async interaction => {
                const statusService = require(
                    '../services/statusService'
                );

                if (
                    typeof statusService.handleStatusInteraction !==
                    'function'
                ) {
                    await responderErro(
                        interaction,
                        '⚠️ O novo painel de status ainda não está disponível.'
                    );

                    return true;
                }

                return statusService.handleStatusInteraction(
                    interaction
                );
            }
        };
    }

    return null;
}

async function responderErro(interaction, mensagem) {
    const payload = {
        content: mensagem,
        allowedMentions: {
            parse: []
        }
    };

    if (interaction.deferred) {
        return interaction.editReply(payload);
    }

    if (interaction.replied) {
        return interaction.followUp({
            ...payload,
            flags: MessageFlags.Ephemeral
        });
    }

    return interaction.reply({
        ...payload,
        flags: MessageFlags.Ephemeral
    });
}

async function executarComando(interaction, client) {
    const nome = interaction.commandName;

    if (
        COMANDOS_ADMIN.has(nome) &&
        !interaction.memberPermissions?.has(
            PermissionFlagsBits.Administrator
        )
    ) {
        await responderErro(
            interaction,
            '❌ Apenas administradores podem utilizar esse comando.'
        );

        return;
    }

    const comando = client.commands?.get(nome);

    if (
        !comando ||
        typeof comando.execute !== 'function'
    ) {
        console.warn(
            `[InovareSale] Comando não encontrado: /${nome}`
        );

        await responderErro(
            interaction,
            '❌ Esse comando não está disponível no momento.'
        );

        return;
    }

    await comando.execute(interaction, client);
}

async function executarComponente(interaction) {
    const handler = identificarHandler(
        interaction.customId
    );

    if (!handler) {
        return false;
    }

    const tratado = await handler.executar(interaction);

    if (!tratado) {
        await responderErro(
            interaction,
            '⚠️ Esta opção não está disponível ou pertence a uma versão antiga do painel.'
        );
    }

    return true;
}

function ehInteracaoDeComponente(interaction) {
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

module.exports = {
    name: Events.InteractionCreate,

    async execute(interaction, client) {
        const bot = client || interaction.client;

        try {
            if (interaction.isChatInputCommand()) {
                await executarComando(
                    interaction,
                    bot
                );

                return;
            }

            if (ehInteracaoDeComponente(interaction)) {
                await executarComponente(
                    interaction
                );

                return;
            }
        } catch (erro) {
            console.error(
                '[InovareSale Bot 3.1] Erro em interactionCreate:',
                erro
            );

            try {
                await responderErro(
                    interaction,
                    '❌ Ocorreu um erro ao processar sua ação. Tente novamente ou avise a equipe.'
                );
            } catch (erroResposta) {
                console.error(
                    '[InovareSale Bot 3.1] Falha ao responder interação:',
                    erroResposta
                );
            }
        }
    }
};
