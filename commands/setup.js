
'use strict';

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    ChannelType
} = require('discord.js');

const { getConfig } = require('../utils/storage');

const {
    criarPublicacaoSetup
} = require('../panels/setupPanel');

// ==========================================
// INOVARESALE BOT 2.0
// COMANDO /SETUP
// ==========================================

// Verifica se uma mensagem é um painel
// administrativo publicado pelo próprio bot.

function ehPainelDoSetup(mensagem, botId) {
    if (mensagem.author?.id !== botId) {
        return false;
    }

    return (mensagem.components || []).some(linha =>
        (linha.components || []).some(componente =>
            typeof componente.customId === 'string' &&
            componente.customId.startsWith('setup_')
        )
    );
}

// ==========================================
// PROCURAR PAINEL ANTIGO
// ==========================================

async function localizarPainelAntigo(canal, botId) {
    try {
        const mensagens = await canal.messages.fetch({
            limit: 100
        });

        return mensagens.find(mensagem =>
            ehPainelDoSetup(mensagem, botId)
        ) || null;

    } catch (erro) {
        console.warn(
            '[InovareSale] Não foi possível procurar o painel antigo:',
            erro.message
        );

        return null;
    }
}

// ==========================================
// COMANDO /SETUP
// ==========================================

module.exports = {

    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription(
            'Publica ou atualiza o painel administrativo da InovareSale'
        )
        .setDMPermission(false)
        .setDefaultMemberPermissions(
            PermissionFlagsBits.Administrator
        ),

    async execute(interaction) {

        // ==================================
        // VERIFICAR SERVIDOR
        // ==================================

        if (!interaction.inGuild()) {
            return interaction.reply({
                content:
                    'Este comando só funciona dentro do servidor.',
                flags: MessageFlags.Ephemeral
            });
        }

        // ==================================
        // VERIFICAR ADMINISTRADOR
        // ==================================

        if (
            !interaction.memberPermissions?.has(
                PermissionFlagsBits.Administrator
            )
        ) {
            return interaction.reply({
                content:
                    'Somente administradores podem usar o /setup.',
                flags: MessageFlags.Ephemeral
            });
        }

        // Resposta privada enquanto o bot
        // prepara o painel público.

        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        try {
            // ==================================
            // VERIFICAR CANAL
            // ==================================

            const canal = interaction.channel;

            if (
                !canal ||
                canal.type !== ChannelType.GuildText
            ) {
                return interaction.editReply({
                    content:
                        'Execute o /setup em um canal de texto do servidor.'
                });
            }

            // ==================================
            // CARREGAR CONFIGURAÇÕES
            // ==================================

            const config = getConfig() || {};

            // ==================================
            // CRIAR PAINEL NOVO
            // ==================================

            // Usa o painel com banner.png,
            // logo.png e os sete botões.

            const painel = criarPublicacaoSetup(
                config
            );

            // ==================================
            // LOCALIZAR PAINEL ANTIGO
            // ==================================

            const antigo = await localizarPainelAntigo(
                canal,
                interaction.client.user.id
            );

            let mensagem;
            let acao;

            // ==================================
            // ATUALIZAR PAINEL EXISTENTE
            // ==================================

            if (antigo) {
                try {
                    mensagem = await antigo.edit(
                        painel
                    );

                    acao = 'atualizado';

                } catch (erro) {
                    console.warn(
                        '[InovareSale] Erro ao atualizar painel antigo:',
                        erro.message
                    );
                }
            }

            // ==================================
            // PUBLICAR PAINEL NOVO
            // ==================================

            if (!mensagem) {
                mensagem = await canal.send(
                    painel
                );

                acao = 'publicado';
            }

            // ==================================
            // CONFIRMAÇÃO AO ADMINISTRADOR
            // ==================================

            return interaction.editReply({
                content:
                    `Painel administrativo ${acao} com sucesso!\n` +
                    `[Abrir painel](${mensagem.url})`
            });

        } catch (erro) {

            console.error(
                '[InovareSale] Erro no /setup:',
                erro
            );

            return interaction.editReply({
                content:
                    'Não foi possível publicar o painel.\n\n' +
                    'Confira se o bot possui as permissões:\n' +
                    '• Ver canal\n' +
                    '• Enviar mensagens\n' +
                    '• Inserir links\n' +
                    '• Anexar arquivos\n\n' +
                    `Detalhes: ${String(
                        erro.message || erro
                    ).slice(0, 500)}`
            });
        }
    }
};
