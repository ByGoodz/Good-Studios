
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

// ==========================================
// INOVARESALE BOT 2.0
// ROTEADOR CENTRAL DE INTERACOES
// ==========================================
// Cada botao, menu e modal deve ser atendido
// por UM unico handler para evitar o erro
// "Interaction has already been acknowledged".

const COMANDOS_ADMIN = new Set([
    'setup',
    'estoque',
    'venda'
]);

function pertenceAoSetup(id) {
    return (
        id.startsWith('setup_') ||
        id.startsWith('modal_k_') ||
        id === 'modal_estoque_preco'
    );
}

function pertenceAosTickets(id) {
    return id.startsWith('ticket_');
}

function pertenceAsAvaliacoes(id) {
    return id.startsWith('avaliacao_');
}

async function responderErro(interaction, texto) {
    const payload = {
        content: texto,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] }
    };

    // Uma interacao ja respondida nao pode receber reply() novamente.
    if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload);
    } else {
        await interaction.reply(payload);
    }
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

    if (!comando || typeof comando.execute !== 'function') {
        console.warn(`[InovareSale] Comando nao encontrado: /${nome}`);

        await responderErro(
            interaction,
            '❌ Esse comando ainda não está disponível. Avise a equipe.'
        );
        return;
    }

    // Compativel com os comandos existentes, que recebem interaction.
    // O argumento client e opcional para os comandos novos.
    await comando.execute(interaction, client);
}

async function executarComponente(interaction) {
    const id = interaction.customId;

    if (typeof id !== 'string' || id.length === 0) {
        return;
    }

    // ======================================
    // 1. CONFIGURACOES ADMINISTRATIVAS
    // ======================================

    if (pertenceAoSetup(id)) {
        const tratado = await handleSetupInteraction(interaction);

        if (!tratado) {
            await responderErro(
                interaction,
                '⚠️ Essa opção de configuração não está disponível.'
            );
        }

        return;
    }

    // ======================================
    // 2. TICKETS E COMPRAS
    // ======================================

    if (pertenceAosTickets(id)) {
        const tratado = await handleTicketInteraction(interaction);

        if (!tratado) {
            await responderErro(
                interaction,
                '⚠️ Essa opção de compra não está disponível.'
            );
        }

        return;
    }

    // ======================================
    // 3. AVALIACOES DOS CLIENTES
    // ======================================

    if (pertenceAsAvaliacoes(id)) {
        const tratado = await handleAvaliacaoInteraction(interaction);

        if (!tratado) {
            await responderErro(
                interaction,
                '⚠️ Essa opção de avaliação não está disponível.'
            );
        }

        return;
    }

    // ======================================
    // 4. ESTOQUE E OUTROS COLLECTORS
    // ======================================
    //
    // Os botoes "estoque_v2_*" do comando
    // /estoque continuam sob o collector
    // de commands/estoque.js.
    //
    // Nao responder aqui, pois isso causaria
    // duas respostas ao mesmo clique.
    //
    // Componentes de outros comandos tambem
    // podem possuir seus proprios collectors.
}

// ==========================================
// EVENTO PRINCIPAL
// ==========================================

module.exports = {
    name: Events.InteractionCreate,

    async execute(interaction, client) {
        const bot = client || interaction.client;

        try {
            // ==================================
            // COMANDOS DE BARRA (/)
            // ==================================

            if (interaction.isChatInputCommand()) {
                await executarComando(interaction, bot);
                return;
            }

            // ==================================
            // BOTOES, MENUS E FORMULARIOS
            // ==================================

            if (
                interaction.isButton() ||
                interaction.isStringSelectMenu() ||
                interaction.isChannelSelectMenu() ||
                interaction.isRoleSelectMenu() ||
                interaction.isModalSubmit()
            ) {
                await executarComponente(interaction);
            }

        } catch (erro) {
            console.error(
                '[InovareSale] Erro em interactionCreate:',
                erro
            );

            // ==================================
            // RESPONDER ERRO SEM TRAVAR O BOT
            // ==================================

            try {
                await responderErro(
                    interaction,
                    '❌ Ocorreu um erro ao processar sua ação. ' +
                    'Tente novamente ou avise a equipe.'
                );

            } catch (erroResposta) {
                console.error(
                    '[InovareSale] Falha ao informar erro da interação:',
                    erroResposta
                );
            }
        }
    }
};
