
const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder,
    MessageFlags,
    ChannelType
} = require('discord.js');

const fs = require('fs');
const path = require('path');

const {
    getConfig,
    saveConfig
} = require('../utils/storage');

// ==========================================
// IMAGENS DO PAINEL
// ==========================================

function caminhoImagem(nome) {
    return path.join(
        __dirname,
        '..',
        'assets',
        nome
    );
}

function imagemDisponivel(nome) {
    const caminho = caminhoImagem(nome);

    try {
        const tamanho = fs.statSync(caminho).size;

        return (
            tamanho > 0 &&
            tamanho <= 8 * 1024 * 1024
        );
    } catch {
        return false;
    }
}

function arquivosDoPainel() {
    const arquivos = [];

    for (const nome of ['banner.png', 'logo.png']) {
        if (imagemDisponivel(nome)) {
            arquivos.push(
                new AttachmentBuilder(
                    caminhoImagem(nome),
                    { name: nome }
                )
            );
        }
    }

    return arquivos;
}

// ==========================================
// CRIAR PAINEL CENTRAL
// ==========================================

function criarPainelPrincipal(imagens = {}) {
    const embed = new EmbedBuilder()
        .setColor(0xC0C0C0)
        .setTitle(
            '⚙️ CENTRAL DE CONFIGURAÇÕES — INOVARESALE'
        )
        .setDescription(
            'Bem-vindo ao painel administrativo da ' +
            '**InovareSale Bot 2.0**.\n\n' +

            'Gerencie todos os sistemas da loja ' +
            'diretamente pelo Discord.\n\n' +

            '━━━━━━━━━━━━━━━━━━━━\n\n' +

            '🧮 **CALCULADORA**\n' +
            'Preços K, métodos de compra e canal ' +
            'da calculadora.\n\n' +

            '📦 **ESTOQUE**\n' +
            'Canal de estoque, preço, publicações ' +
            'e status da loja.\n\n' +

            '💰 **VENDAS**\n' +
            'Canal de vendas e registros ' +
            'de compras concluídas.\n\n' +

            '🏆 **CARGOS**\n' +
            'Configuração dos cargos automáticos ' +
            'dos clientes.\n\n' +

            '🎫 **TICKETS**\n' +
            'Equipe de atendimento, categorias ' +
            'e permissões de compra.\n\n' +

            '🔐 **BLOQUEIOS**\n' +
            'Tranque ou destranque cada ' +
            'modalidade de compra.\n\n' +

            '🛒 **CENTRAL DE PEDIDOS**\n' +
            'Configure e publique o painel ' +
            'de compras da loja.\n\n' +

            '━━━━━━━━━━━━━━━━━━━━\n\n' +

            '🛡️ **Acesso administrativo**\n' +
            'Apenas administradores podem ' +
            'alterar as configurações.'
        )
        .setFooter({
            text:
                'InovareSale • Painel Central 2.0'
        })
        .setTimestamp();

    if (imagens.logo) {
        embed.setThumbnail(imagens.logo);
    }

    if (imagens.banner) {
        embed.setImage(imagens.banner);
    }

    // ======================================
    // PRIMEIRA LINHA DE BOTÕES
    // ======================================

    const linha1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('setup_calculadora')
                .setLabel('Calculadora')
                .setEmoji('🧮')
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId('setup_estoque')
                .setLabel('Estoque')
                .setEmoji('📦')
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId('setup_vendas')
                .setLabel('Vendas')
                .setEmoji('💰')
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId('setup_cargos')
                .setLabel('Cargos')
                .setEmoji('🏆')
                .setStyle(ButtonStyle.Secondary)
        );

    // ======================================
    // SEGUNDA LINHA DE BOTÕES
    // ======================================

    const linha2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('setup_tickets')
                .setLabel('Tickets')
                .setEmoji('🎫')
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId('setup_bloqueios')
                .setLabel('Bloqueios')
                .setEmoji('🔐')
                .setStyle(ButtonStyle.Danger),

            new ButtonBuilder()
                .setCustomId('setup_pedidos')
                .setLabel('Central de Pedidos')
                .setEmoji('🛒')
                .setStyle(ButtonStyle.Secondary)
        );

    return {
        embeds: [embed],
        components: [linha1, linha2]
    };
}

// ==========================================
// BUSCAR PAINEL ANTERIOR
// ==========================================

async function buscarPainelAnterior(guild, config) {
    const canalId = config.setup?.painelCanalId;
    const mensagemId = config.setup?.painelMensagemId;

    if (!canalId || !mensagemId) {
        return null;
    }

    try {
        const canal = await guild.channels.fetch(canalId);

        if (!canal?.isTextBased() || !canal.messages) {
            return null;
        }

        const mensagem = await canal.messages.fetch(
            mensagemId
        );

        if (mensagem.author.id !== guild.members.me?.id) {
            return null;
        }

        return mensagem;
    } catch {
        return null;
    }
}

// ==========================================
// MONTAR PAINEL COM IMAGENS
// ==========================================

function criarPublicacaoNova() {
    const imagens = {};

    if (imagemDisponivel('banner.png')) {
        imagens.banner = 'attachment://banner.png';
    }

    if (imagemDisponivel('logo.png')) {
        imagens.logo = 'attachment://logo.png';
    }

    return {
        ...criarPainelPrincipal(imagens),
        files: arquivosDoPainel(),
        allowedMentions: {
            parse: []
        }
    };
}

// ==========================================
// COMANDO /SETUP
// ==========================================

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription(
            'Publica o painel central da InovareSale.'
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.Administrator
        ),

    criarPainelPrincipal,

    async execute(interaction) {
        if (
            !interaction.memberPermissions?.has(
                PermissionFlagsBits.Administrator
            )
        ) {
            return interaction.reply({
                content:
                    '❌ Apenas administradores podem usar este comando.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (
            !interaction.guild ||
            interaction.channel?.type !==
                ChannelType.GuildText
        ) {
            return interaction.reply({
                content:
                    '❌ Use `/setup` em um canal de texto do servidor.',
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        try {
            const config = getConfig();

            if (!config.setup) {
                config.setup = {};
            }

            const anterior = await buscarPainelAnterior(
                interaction.guild,
                config
            );

            // ==================================
            // PAINEL JÁ ESTÁ NESTE CANAL
            // ==================================

            if (
                anterior &&
                anterior.channelId === interaction.channelId
            ) {
                const imagens = {};

                const banner = anterior.attachments.find(
                    arquivo => arquivo.name === 'banner.png'
                );

                const logo = anterior.attachments.find(
                    arquivo => arquivo.name === 'logo.png'
                );

                if (banner) {
                    imagens.banner = banner.url;
                }

                if (logo) {
                    imagens.logo = logo.url;
                }

                await anterior.edit({
                    ...criarPainelPrincipal(imagens),
                    allowedMentions: {
                        parse: []
                    }
                });

                return interaction.editReply({
                    content:
                        `✅ O painel central já está neste canal!\n` +
                        `[Clique aqui para visualizar](${anterior.url})`
                });
            }

            // ==================================
            // PUBLICAR PAINEL NO NOVO CANAL
            // ==================================

            const novoPainel = await interaction.channel.send(
                criarPublicacaoNova()
            );

            const canalAnteriorId =
                config.setup.painelCanalId;

            config.setup.painelCanalId =
                novoPainel.channelId;

            config.setup.painelMensagemId =
                novoPainel.id;

            saveConfig(config);

            // ==================================
            // REMOVER PAINEL ANTERIOR
            // ==================================

            let aviso = '';

            if (
                anterior &&
                anterior.id !== novoPainel.id
            ) {
                try {
                    await anterior.delete();
                } catch (erro) {
                    console.error(
                        'Não foi possível apagar o painel anterior:',
                        erro
                    );

                    aviso =
                        '\n⚠️ Não consegui apagar o painel antigo. ' +
                        'Você pode excluí-lo manualmente.';
                }
            } else if (canalAnteriorId) {
                // O painel antigo pode já ter sido apagado.
            }

            await interaction.editReply({
                content:
                    '✅ **Painel Central publicado!**\n\n' +
                    `📍 Canal: <#${novoPainel.channelId}>\n` +
                    `[Abrir painel](${novoPainel.url})` +
                    aviso
            });

        } catch (erro) {
            console.error(
                'Erro ao publicar o /setup:',
                erro
            );

            await interaction.editReply({
                content:
                    '❌ Não consegui publicar o painel. ' +
                    'Verifique se o bot tem permissão de ' +
                    'ver o canal, enviar mensagens, ' +
                    'anexar arquivos e inserir links.'
            });
        }
    }
};
