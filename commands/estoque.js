
'use strict';

const fs = require('fs');
const path = require('path');
const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    AttachmentBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags
} = require('discord.js');

const { getConfig, saveConfig } = require('../utils/storage');

const COR = 0x9951CB;
const TITULO = 'INOVARESALE | ESTOQUE';
const PREFIXO = 'estoque_v2_';

const BANNER = path.join(
    __dirname,
    '..',
    'assets',
    'banner.png'
);

// ==========================================
// INTERPRETAR QUANTIDADE DE ROBUX
// ==========================================

function interpretarQuantidade(texto) {
    const entrada = String(texto || '')
        .trim()
        .toLowerCase()
        .replace(/\s/g, '');

    if (!entrada) return null;

    let quantidade;

    if (/^\d+(?:[.,]\d+)?k$/.test(entrada)) {
        quantidade =
            Number(entrada.slice(0, -1).replace(',', '.')) * 1000;
    } else if (/^\d{1,3}(?:\.\d{3})+$/.test(entrada)) {
        quantidade = Number(entrada.replace(/\./g, ''));
    } else if (/^\d+$/.test(entrada)) {
        quantidade = Number(entrada);
    } else {
        return null;
    }

    if (
        !Number.isSafeInteger(Math.floor(quantidade)) ||
        quantidade < 1
    ) {
        return null;
    }

    return Math.floor(quantidade);
}

function formatarQuantidade(valor) {
    return Number(valor || 0).toLocaleString('pt-BR');
}

function formatarK(valor) {
    return `K${Number(valor || 0).toLocaleString('pt-BR', {
        maximumFractionDigits: 2
    })}`;
}

// ==========================================
// IDENTIFICAR PUBLICAÇÕES DE ESTOQUE
// ==========================================

function ehMensagemEstoque(mensagem, botId) {
    if (mensagem.author?.id !== botId) {
        return false;
    }

    const texto = mensagem.content || '';

    const titulos = (mensagem.embeds || []).map(
        embed => embed.title || ''
    );

    return (
        titulos.some(titulo => titulo.includes(TITULO)) ||
        texto.includes('𝐋𝐎𝐉𝐀 𝐎𝐍') ||
        texto.includes('𝐋𝐎𝐉𝐀 𝐎𝐅𝐅') ||
        texto.includes('LOJA ON!') ||
        texto.includes('LOJA OFF!') ||
        texto.includes('📦 Estoque disponível:')
    );
}

// ==========================================
// LOCALIZAR ÚLTIMA PUBLICAÇÃO
// ==========================================

async function buscarUltimaMensagem(canal, config, botId) {
    const id = config.estoque?.ultimaMensagemId;

    if (id) {
        try {
            const mensagem = await canal.messages.fetch(id);

            if (mensagem.author.id === botId) {
                return mensagem;
            }
        } catch (erro) {
            console.warn(
                '[Estoque] Mensagem anterior não encontrada:',
                erro.message
            );
        }
    }

    const mensagens = await canal.messages.fetch({
        limit: 100
    });

    return (
        mensagens.find(
            mensagem => ehMensagemEstoque(mensagem, botId)
        ) || null
    );
}

// ==========================================
// CRIAR PUBLICAÇÃO DO ESTOQUE 3.0
// ==========================================

function criarPublicacao(config) {
    const estoque = config.estoque || {};

    const ativo =
        String(estoque.status || '').toUpperCase() === 'ON';

    const embed = new EmbedBuilder()
        .setColor(ativo ? COR : 0x6D6476)
        .setTitle(TITULO)
        .setFooter({
            text: 'InovareSale • Central de estoque'
        })
        .setTimestamp();

    if (ativo) {
        embed.setDescription(
            'Nossa loja está recebendo pedidos! ' +
            'Confira a disponibilidade e acesse a central de compras.'
        );

        embed.addFields(
            {
                name: 'Status',
                value: '🟢 Loja ON',
                inline: true
            },
            {
                name: 'Disponível',
                value:
                    `${formatarQuantidade(estoque.quantidade)} Robux`,
                inline: true
            },
            {
                name: 'Preço por K',
                value: formatarK(estoque.precoK ?? 39),
                inline: true
            }
        );

        embed.addFields({
            name: 'Fazer pedido',
            value: estoque.canalCompraId
                ? `Acesse <#${estoque.canalCompraId}> para iniciar sua compra.`
                : 'Consulte a Central de Pedidos do servidor.',
            inline: false
        });
    } else {
        embed.setDescription(
            'As vendas estão temporariamente pausadas. ' +
            'Avisaremos por aqui quando o estoque ' +
            'estiver disponível novamente.'
        );

        embed.addFields({
            name: 'Status',
            value: '🔴 Loja OFF',
            inline: true
        });
    }

    // Banner original da InovareSale.
    const arquivos = [];

    try {
        if (
            fs.existsSync(BANNER) &&
            fs.statSync(BANNER).size > 0
        ) {
            arquivos.push(
                new AttachmentBuilder(BANNER, {
                    name: 'banner.png'
                })
            );

            embed.setImage(
                'attachment://banner.png'
            );
        }
    } catch (erro) {
        console.warn(
            '[Estoque] Banner não pôde ser anexado:',
            erro.message
        );
    }

    return {
        embeds: [embed],
        files: arquivos,
        allowedMentions: {
            parse: []
        }
    };
}

// ==========================================
// PUBLICAR E SUBSTITUIR ESTOQUE ANTIGO
// ==========================================

async function publicarEstoque(guild, client, config) {
    const canalId = config.estoque?.canalId;

    if (!canalId) {
        throw new Error(
            'Canal de estoque não configurado.'
        );
    }

    const canal = await guild.channels.fetch(canalId);

    if (
        !canal?.isTextBased() ||
        !canal.messages ||
        typeof canal.send !== 'function'
    ) {
        throw new Error(
            'Canal de estoque inválido ou inacessível.'
        );
    }

    // Primeiro publica o novo anúncio.
    const nova = await canal.send(
        criarPublicacao(config)
    );

    // Guarda o ID da nova publicação.
    const idAnterior =
        config.estoque.ultimaMensagemId;

    config.estoque.ultimaMensagemId = nova.id;

    saveConfig(config);

    // Localiza publicações antigas.
    const antigas = new Map();

    if (
        idAnterior &&
        idAnterior !== nova.id
    ) {
        try {
            const antiga = await canal.messages.fetch(
                idAnterior
            );

            if (antiga.author.id === client.user.id) {
                antigas.set(antiga.id, antiga);
            }
        } catch (_) {
            // A mensagem antiga pode ter sido apagada.
        }
    }

    try {
        const mensagens = await canal.messages.fetch({
            limit: 100
        });

        for (const mensagem of mensagens.values()) {
            if (
                mensagem.id !== nova.id &&
                ehMensagemEstoque(
                    mensagem,
                    client.user.id
                )
            ) {
                antigas.set(
                    mensagem.id,
                    mensagem
                );
            }
        }
    } catch (erro) {
        console.warn(
            '[Estoque] Não foi possível listar anúncios antigos:',
            erro.message
        );
    }

    // Remove publicações anteriores.
    for (const mensagem of antigas.values()) {
        try {
            await mensagem.delete();
        } catch (erro) {
            console.warn(
                '[Estoque] Não foi possível apagar anúncio antigo:',
                erro.message
            );
        }
    }

    return nova;
}

// ==========================================
// MODAL: ATUALIZAR QUANTIDADE
// ==========================================

function criarModalQuantidade() {
    const modal = new ModalBuilder()
        .setCustomId(`${PREFIXO}quantidade`)
        .setTitle('Atualizar estoque');

    const quantidade = new TextInputBuilder()
        .setCustomId('quantidade')
        .setLabel('Quantidade de Robux disponível')
        .setPlaceholder('Ex.: 5000 ou 5k')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(24)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(quantidade)
    );

    return modal;
}

// ==========================================
// MODAL: EDITAR PUBLICAÇÃO
// ==========================================

function criarModalEdicao(texto) {
    const modal = new ModalBuilder()
        .setCustomId(`${PREFIXO}editar`)
        .setTitle('Editar anúncio de estoque');

    const mensagem = new TextInputBuilder()
        .setCustomId('mensagem')
        .setLabel('Descrição do anúncio')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(2000)
        .setRequired(true);

    if (texto) {
        mensagem.setValue(
            String(texto).slice(0, 2000)
        );
    }

    modal.addComponents(
        new ActionRowBuilder().addComponents(mensagem)
    );

    return modal;
}

// ==========================================
// PAINEL ADMINISTRATIVO DE ESTOQUE
// ==========================================

function criarPainel(config) {
    const estoque = config.estoque || {};

    const ativo =
        String(estoque.status || '').toUpperCase() === 'ON';

    const embed = new EmbedBuilder()
        .setColor(COR)
        .setTitle('INOVARESALE | GERENCIAR ESTOQUE')
        .setDescription(
            'Controle a disponibilidade e a ' +
            'publicação do estoque da loja.'
        )
        .addFields(
            {
                name: 'Status atual',
                value: ativo
                    ? '🟢 Loja ON'
                    : '🔴 Loja OFF',
                inline: true
            },
            {
                name: 'Quantidade',
                value:
                    `${formatarQuantidade(estoque.quantidade)} Robux`,
                inline: true
            },
            {
                name: 'Preço por K',
                value: formatarK(
                    estoque.precoK ?? 39
                ),
                inline: true
            }
        )
        .setFooter({
            text: 'Uma nova publicação substitui a anterior.'
        });

    const botoes = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${PREFIXO}on`)
            .setLabel('Loja ON')
            .setEmoji('🟢')
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId(`${PREFIXO}off`)
            .setLabel('Loja OFF')
            .setEmoji('🔴')
            .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
            .setCustomId(`${PREFIXO}editar_botao`)
            .setLabel('Editar anúncio')
            .setEmoji('✏️')
            .setStyle(ButtonStyle.Secondary)
    );

    return {
        embeds: [embed],
        components: [botoes]
    };
}

// ==========================================
// TRATAMENTO DE ERROS
// ==========================================

async function respostaErro(interaction, mensagem) {
    try {
        if (
            interaction.deferred ||
            interaction.replied
        ) {
            await interaction.editReply({
                content: mensagem,
                embeds: [],
                components: []
            });
        } else {
            await interaction.reply({
                content: mensagem,
                flags: MessageFlags.Ephemeral
            });
        }
    } catch (erro) {
        console.error(
            '[Estoque] Erro ao informar falha:',
            erro
        );
    }
}

// ==========================================
// COMANDO /ESTOQUE
// ==========================================

module.exports = {
    data: new SlashCommandBuilder()
        .setName('estoque')
        .setDescription(
            'Gerencie o estoque da InovareSale.'
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.Administrator
        ),

    async execute(interaction, client) {
        if (
            !interaction.inGuild() ||
            !interaction.memberPermissions?.has(
                PermissionFlagsBits.Administrator
            )
        ) {
            await interaction.reply({
                content:
                    'Você não tem permissão para usar este comando.',
                flags: MessageFlags.Ephemeral
            });

            return;
        }

        const bot = client || interaction.client;
        const config = getConfig();

        if (!config.estoque?.canalId) {
            await interaction.reply({
                content:
                    'Configure o canal de estoque pelo ' +
                    '`/setup` antes de continuar.',
                flags: MessageFlags.Ephemeral
            });

            return;
        }

        await interaction.reply({
            ...criarPainel(config),
            flags: MessageFlags.Ephemeral
        });

        const painel = await interaction.fetchReply();

        const collector = painel.createMessageComponentCollector({
            filter: i =>
                i.user.id === interaction.user.id &&
                i.customId.startsWith(PREFIXO),
            time: 120000,
            max: 1
        });

        collector.on('collect', async i => {
            try {

                // ==================================
                // LOJA OFF
                // ==================================

                if (i.customId === `${PREFIXO}off`) {
                    await i.deferUpdate();

                    const atual = getConfig();

                    atual.estoque.status = 'OFF';
                    atual.estoque.quantidade = 0;

                    await publicarEstoque(
                        interaction.guild,
                        bot,
                        atual
                    );

                    await interaction.editReply({
                        content:
                            '✅ Loja OFF! A publicação foi atualizada.',
                        embeds: [],
                        components: []
                    });

                    return;
                }

                // ==================================
                // LOJA ON
                // ==================================

                if (i.customId === `${PREFIXO}on`) {
                    await i.showModal(
                        criarModalQuantidade()
                    );

                    let modal;

                    try {
                        modal = await i.awaitModalSubmit({
                            filter: m =>
                                m.customId === `${PREFIXO}quantidade` &&
                                m.user.id === interaction.user.id,
                            time: 120000
                        });
                    } catch (_) {
                        // Usuário fechou o modal.
                        return;
                    }

                    await modal.deferReply({
                        flags: MessageFlags.Ephemeral
                    });

                    const quantidade = interpretarQuantidade(
                        modal.fields.getTextInputValue(
                            'quantidade'
                        )
                    );

                    if (!quantidade) {
                        await modal.editReply({
                            content:
                                '❌ Quantidade inválida. ' +
                                'Informe `5000` ou `5k`.'
                        });

                        return;
                    }

                    try {
                        const atual = getConfig();

                        atual.estoque.status = 'ON';
                        atual.estoque.quantidade = quantidade;

                        await publicarEstoque(
                            interaction.guild,
                            bot,
                            atual
                        );

                        await modal.editReply({
                            content:
                                `✅ Loja ON! ` +
                                `${formatarQuantidade(quantidade)} Robux publicados.`
                        });

                        await interaction.editReply({
                            components: []
                        });
                    } catch (erro) {
                        console.error(
                            '[Estoque] Falha ao ativar loja:',
                            erro
                        );

                        await modal.editReply({
                            content:
                                '❌ Não foi possível publicar o estoque. ' +
                                'Verifique o canal e as permissões.'
                        });
                    }

                    return;
                }

                // ==================================
                // EDITAR ÚLTIMO ANÚNCIO
                // ==================================

                if (
                    i.customId ===
                    `${PREFIXO}editar_botao`
                ) {
                    const atual = getConfig();

                    const canal = await interaction.guild
                        .channels.fetch(
                            atual.estoque.canalId
                        );

                    if (
                        !canal?.isTextBased() ||
                        !canal.messages
                    ) {
                        await i.update({
                            content:
                                '❌ Canal de estoque indisponível.',
                            embeds: [],
                            components: []
                        });

                        return;
                    }

                    const mensagem =
                        await buscarUltimaMensagem(
                            canal,
                            atual,
                            bot.user.id
                        );

                    if (!mensagem) {
                        await i.update({
                            content:
                                '❌ Ainda não há publicação para editar.',
                            embeds: [],
                            components: []
                        });

                        return;
                    }

                    // Compatível com embeds novos
                    // e mensagens antigas de texto.
                    const original =
                        mensagem.embeds[0]?.title?.includes(TITULO)
                            ? (
                                mensagem.embeds[0].description ||
                                ''
                            )
                            : (
                                mensagem.content ||
                                ''
                            );

                    await i.showModal(
                        criarModalEdicao(original)
                    );

                    let modal;

                    try {
                        modal = await i.awaitModalSubmit({
                            filter: m =>
                                m.customId === `${PREFIXO}editar` &&
                                m.user.id === interaction.user.id,
                            time: 120000
                        });
                    } catch (_) {
                        return;
                    }

                    await modal.deferReply({
                        flags: MessageFlags.Ephemeral
                    });

                    const texto = modal.fields
                        .getTextInputValue('mensagem')
                        .trim();

                    if (!texto) {
                        await modal.editReply({
                            content:
                                '❌ A descrição não pode ficar vazia.'
                        });

                        return;
                    }

                    try {
                        if (
                            mensagem.embeds[0]?.title?.includes(
                                TITULO
                            )
                        ) {
                            const embed = EmbedBuilder.from(
                                mensagem.embeds[0]
                            );

                            embed.setDescription(texto);

                            await mensagem.edit({
                                embeds: [embed],
                                allowedMentions: {
                                    parse: []
                                }
                            });
                        } else {
                            await mensagem.edit({
                                content: texto,
                                allowedMentions: {
                                    parse: []
                                }
                            });
                        }

                        atual.estoque.ultimaMensagemId =
                            mensagem.id;

                        saveConfig(atual);

                        await modal.editReply({
                            content:
                                '✅ Publicação editada com sucesso!'
                        });

                        await interaction.editReply({
                            components: []
                        });
                    } catch (erro) {
                        console.error(
                            '[Estoque] Erro ao editar anúncio:',
                            erro
                        );

                        await modal.editReply({
                            content:
                                '❌ Não foi possível editar a publicação.'
                        });
                    }
                }

            } catch (erro) {
                console.error(
                    '[Estoque] Erro no comando:',
                    erro
                );

                if (
                    !i.replied &&
                    !i.deferred
                ) {
                    try {
                        await i.reply({
                            content:
                                '❌ Não foi possível concluir essa ação.',
                            flags: MessageFlags.Ephemeral
                        });
                    } catch (_) {}
                }

                await respostaErro(
                    interaction,
                    '❌ Não foi possível atualizar o estoque. ' +
                    'Verifique as permissões do bot.'
                );
            }
        });

        collector.on('end', async () => {
            try {
                await interaction.editReply({
                    components: []
                });
            } catch (_) {}
        });
    }
};
