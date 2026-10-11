
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
// INOVARESALE BOT 3.0
// COMANDO /SETUP
// ==========================================

const CONFIGURACAO = {
    nome: 'InovareSale',
    versao: '3.0.0',
    prefixo: '[InovareSale | Setup]'
};

// ==========================================
// IDENTIFICAR COMPONENTES DO SETUP
// ==========================================

function ehComponenteSetup(componente) {
    const id = String(
        componente?.customId ||
        componente?.custom_id ||
        ''
    );

    return (
        id.startsWith('setup_') ||
        id.startsWith('setup:') ||
        id.startsWith('setup3_')
    );
}

// ==========================================
// IDENTIFICAR PAINEL ADMINISTRATIVO
// ==========================================

function ehPainelDoSetup(mensagem, botId) {
    if (!mensagem || mensagem.author?.id !== botId) {
        return false;
    }

    // Identifica os painéis antigos pelos botões.
    // Identifica os novos também pelo menu de seleção.
    const temComponentesSetup = (
        mensagem.components || []
    ).some(linha =>
        (linha.components || []).some(
            componente => ehComponenteSetup(componente)
        )
    );

    if (temComponentesSetup) {
        return true;
    }

    // Compatibilidade com publicações que tenham
    // perdido os componentes após uma atualização.
    const temEmbedAdministrativo = (
        mensagem.embeds || []
    ).some(embed => {
        const titulo = String(
            embed.title || ''
        ).toUpperCase();

        return (
            titulo.includes('INOVARESALE') &&
            (
                titulo.includes('ADMINISTRATIVA') ||
                titulo.includes('PAINEL CENTRAL') ||
                titulo.includes('PAINEL DE CONFIGURA')
            )
        );
    });

    return temEmbedAdministrativo;
}

// ==========================================
// LOCALIZAR PAINEL JÁ PUBLICADO
// ==========================================

async function localizarPainelAntigo(canal, botId) {
    try {
        const mensagens = await canal.messages.fetch({
            limit: 100
        });

        const candidatos = mensagens.filter(
            mensagem => ehPainelDoSetup(
                mensagem,
                botId
            )
        );

        return candidatos.first() || null;

    } catch (erro) {
        console.warn(
            `${CONFIGURACAO.prefixo} ` +
            'Não foi possível localizar o painel anterior:',
            erro.message
        );

        return null;
    }
}

// ==========================================
// VALIDAR PUBLICAÇÃO GERADA PELO PAINEL
// ==========================================

function validarPublicacao(publicacao) {
    if (
        !publicacao ||
        typeof publicacao !== 'object'
    ) {
        throw new Error(
            'O setupPanel não retornou uma publicação válida.'
        );
    }

    const temEmbeds =
        Array.isArray(publicacao.embeds) &&
        publicacao.embeds.length > 0;

    const temConteudo =
        typeof publicacao.content === 'string' &&
        publicacao.content.length > 0;

    if (!temEmbeds && !temConteudo) {
        throw new Error(
            'O painel administrativo não possui conteúdo.'
        );
    }

    return {
        ...publicacao,

        // Não permite mencionar @everyone ou @here.
        allowedMentions: {
            parse: []
        }
    };
}

// ==========================================
// PUBLICAR OU ATUALIZAR PAINEL
// ==========================================

async function publicarOuAtualizarPainel(
    canal,
    botId,
    publicacao
) {
    const antigo = await localizarPainelAntigo(
        canal,
        botId
    );

    if (antigo) {
        try {
            const mensagemAtualizada = await antigo.edit(
                publicacao
            );

            console.log(
                `${CONFIGURACAO.prefixo} ` +
                `Painel atualizado: ${mensagemAtualizada.id}`
            );

            return {
                mensagem: mensagemAtualizada,
                acao: 'atualizado'
            };

        } catch (erro) {
            console.warn(
                `${CONFIGURACAO.prefixo} ` +
                'Não foi possível editar o painel anterior:',
                erro.message
            );

            // A edição pode falhar caso a mensagem
            // antiga não esteja mais acessível.
            // Nesse caso, tentamos publicar outra.
        }
    }

    const mensagemNova = await canal.send(
        publicacao
    );

    console.log(
        `${CONFIGURACAO.prefixo} ` +
        `Painel publicado: ${mensagemNova.id}`
    );

    return {
        mensagem: mensagemNova,
        acao: 'publicado'
    };
}

// ==========================================
// MENSAGENS DE ERRO
// ==========================================

function criarMensagemErro(erro) {
    console.error(
        `${CONFIGURACAO.prefixo} Falha:`,
        erro
    );

    return (
        'Não foi possível publicar a Central Administrativa.\n\n' +
        '**Verifique se o bot possui:**\n' +
        '• Permissão para visualizar o canal.\n' +
        '• Permissão para enviar mensagens.\n' +
        '• Permissão para inserir links.\n' +
        '• Permissão para anexar arquivos.\n' +
        '• Permissão para ler o histórico de mensagens.\n\n' +
        'Se o problema continuar, consulte o terminal do bot.'
    );
}

// ==========================================
// COMANDO /SETUP
// ==========================================

module.exports = {

    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription(
            'Publica ou atualiza a Central Administrativa da InovareSale.'
        )
        .setDMPermission(false)
        .setDefaultMemberPermissions(
            PermissionFlagsBits.Administrator
        ),

    async execute(interaction) {

        // ==================================
        // VALIDAR SERVIDOR
        // ==================================

        if (!interaction.inGuild()) {
            return interaction.reply({
                content:
                    'Este comando só pode ser utilizado ' +
                    'dentro de um servidor.',
                flags: MessageFlags.Ephemeral
            });
        }

        // ==================================
        // VALIDAR ADMINISTRADOR
        // ==================================

        if (
            !interaction.memberPermissions?.has(
                PermissionFlagsBits.Administrator
            )
        ) {
            return interaction.reply({
                content:
                    'Somente administradores podem ' +
                    'utilizar o comando `/setup`.',
                flags: MessageFlags.Ephemeral
            });
        }

        // ==================================
        // RESPONDER PRIVADAMENTE
        // ==================================

        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        try {

            // ==================================
            // VALIDAR CANAL
            // ==================================

            const canal = interaction.channel;

            if (
                !canal ||
                canal.type !== ChannelType.GuildText ||
                typeof canal.send !== 'function' ||
                !canal.messages
            ) {
                return interaction.editReply({
                    content:
                        'Execute o comando `/setup` ' +
                        'em um canal de texto do servidor.'
                });
            }

            // ==================================
            // OBTER CONFIGURAÇÕES ATUAIS
            // ==================================

            const config = getConfig() || {};

            // ==================================
            // GERAR PAINEL ADMINISTRATIVO
            // ==================================

            // Este comando utiliza o setupPanel.js.
            // Na próxima etapa, esse arquivo terá
            // o layout 3.0, banner e menu de seleção.
            const publicacao = validarPublicacao(
                criarPublicacaoSetup(config)
            );

            // ==================================
            // PUBLICAR OU ATUALIZAR
            // ==================================

            const resultado =
                await publicarOuAtualizarPainel(
                    canal,
                    interaction.client.user.id,
                    publicacao
                );

            // ==================================
            // CONFIRMAR AO ADMINISTRADOR
            // ==================================

            const texto =
                resultado.acao === 'atualizado'
                    ? 'Central Administrativa atualizada com sucesso!'
                    : 'Central Administrativa publicada com sucesso!';

            await interaction.editReply({
                content:
                    `**${texto}**\n\n` +
                    `**Versão planejada:** ${CONFIGURACAO.versao}\n` +
                    `[Abrir painel administrativo](${resultado.mensagem.url})`
            });

        } catch (erro) {
            await interaction.editReply({
                content: criarMensagemErro(erro)
            });
        }
    }
};
