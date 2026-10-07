const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags
} = require('discord.js');

const {
    getConfig,
    saveConfig
} = require('../utils/storage');


// ================================
// TRANSFORMAR TEXTO EM QUANTIDADE
// ================================

function interpretarQuantidade(texto) {

    let valor = texto
        .trim()
        .toLowerCase()
        .replace(/\s/g, '');

    // Exemplo: 2.2k ou 2,2k
    if (valor.endsWith('k')) {

        valor = valor
            .replace('k', '')
            .replace(',', '.');

        const numero = Number(valor);

        if (!Number.isFinite(numero) || numero <= 0) {
            return null;
        }

        return Math.floor(numero * 1000);
    }

    // Exemplo: 2200 ou 2.200
    valor = valor
        .replace(/\./g, '')
        .replace(',', '.');

    const numero = Number(valor);

    if (!Number.isFinite(numero) || numero <= 0) {
        return null;
    }

    return Math.floor(numero);
}


// ================================
// FORMATAR ESTOQUE
// ================================

function formatarEstoque(valor) {

    if (valor >= 1000000) {

        const numero = valor / 1000000;

        return `${numero
            .toFixed(numero % 1 === 0 ? 0 : 1)
            .replace('.', ',')}M`;
    }

    if (valor >= 1000) {

        const numero = valor / 1000;

        return `${numero
            .toFixed(numero % 1 === 0 ? 0 : 1)
            .replace('.', '.')}k`;
    }

    return valor.toLocaleString('pt-BR');
}


// ================================
// FORMATAR PREÇO K
// ================================

function formatarK(valor) {

    const numero = Number(valor);

    return `K${numero.toLocaleString('pt-BR', {
        maximumFractionDigits: 2
    })}`;
}


// ================================
// COMANDO /ESTOQUE
// ================================

module.exports = {

    data: new SlashCommandBuilder()

        .setName('estoque')

        .setDescription(
            'Atualiza o status e o estoque da InovareSale.'
        )

        .setDefaultMemberPermissions(
            PermissionFlagsBits.Administrator
        ),


    async execute(interaction) {

        const config = getConfig();


        // ================================
        // VERIFICAR CONFIGURAÇÃO
        // ================================

        if (!config.estoque?.canalId) {

            await interaction.reply({

                content:
                    '❌ O canal de estoque ainda não foi configurado.\nUse `/setup` primeiro.',

                flags:
                    MessageFlags.Ephemeral
            });

            return;
        }


        if (!config.estoque?.canalCompraId) {

            await interaction.reply({

                content:
                    '❌ O canal de compra ainda não foi configurado.\nUse `/setup` primeiro.',

                flags:
                    MessageFlags.Ephemeral
            });

            return;
        }


        // ================================
        // PAINEL ON / OFF
        // ================================

        const embed = new EmbedBuilder()

            .setTitle(
                '📦 Atualizar Estoque — InovareSale'
            )

            .setDescription(
                'Escolha o estado atual da loja.\n\n' +

                '🟢 **LOJA ON**\n' +
                'A loja está funcionando e existe estoque disponível.\n\n' +

                '🔴 **LOJA OFF**\n' +
                'As vendas estão temporariamente pausadas.'
            )

            .setFooter({
                text:
                    'InovareSale • Gerenciamento de Estoque'
            });


        const botoes = new ActionRowBuilder()

            .addComponents(

                new ButtonBuilder()

                    .setCustomId('estoque_on')

                    .setLabel('Loja ON')

                    .setEmoji('🟢')

                    .setStyle(
                        ButtonStyle.Success
                    ),


                new ButtonBuilder()

                    .setCustomId('estoque_off')

                    .setLabel('Loja OFF')

                    .setEmoji('🔴')

                    .setStyle(
                        ButtonStyle.Danger
                    )
            );


        await interaction.reply({

            embeds: [embed],

            components: [botoes],

            flags:
                MessageFlags.Ephemeral
        });


        const mensagem =
            await interaction.fetchReply();


        const collector =
            mensagem.createMessageComponentCollector({

                filter: i =>
                    i.user.id ===
                    interaction.user.id,

                time: 120000
            });


        // ================================
        // CLIQUE NOS BOTÕES
        // ================================

        collector.on(
            'collect',
            async i => {

                // ========================
                // LOJA OFF
                // ========================

                if (
                    i.customId ===
                    'estoque_off'
                ) {

                    const configAtual =
                        getConfig();


                    if (!configAtual.estoque) {
                        configAtual.estoque = {};
                    }


                    configAtual.estoque.status =
                        'OFF';

                    configAtual.estoque.quantidade =
                        0;


                    saveConfig(
                        configAtual
                    );


                    const canal =
                        await interaction.guild.channels.fetch(
                            configAtual
                                .estoque
                                .canalId
                        );


                    if (!canal?.isTextBased()) {

                        await i.update({

                            content:
                                '❌ Não consegui encontrar o canal de estoque configurado.',

                            embeds: [],

                            components: []
                        });

                        collector.stop();

                        return;
                    }


                    await canal.send({

                        content:
                            '🔴 **𝐋𝐎𝐉𝐀 𝐎𝐅𝐅!**\n\n' +

                            '📦 No momento, nossas vendas estão temporariamente pausadas.\n\n' +

                            '🔔 Assim que o estoque estiver disponível novamente, avisaremos por aqui.\n\n' +

                            '@everyone',

                        allowedMentions: {
                            parse: ['everyone']
                        }
                    });


                    await i.update({

                        content:
                            '✅ Loja marcada como **OFF** e aviso publicado.',

                        embeds: [],

                        components: []
                    });


                    collector.stop();

                    return;
                }


                // ========================
                // LOJA ON
                // ========================

                if (
                    i.customId ===
                    'estoque_on'
                ) {

                    const modal =
                        new ModalBuilder()

                            .setCustomId(
                                `estoque_quantidade_${interaction.id}`
                            )

                            .setTitle(
                                'Estoque disponível'
                            );


                    const input =
                        new TextInputBuilder()

                            .setCustomId(
                                'quantidade'
                            )

                            .setLabel(
                                'Quantos Robux temos em estoque?'
                            )

                            .setPlaceholder(
                                'Exemplo: 2200 ou 2.2k'
                            )

                            .setStyle(
                                TextInputStyle.Short
                            )

                            .setRequired(true);


                    const linha =
                        new ActionRowBuilder()
                            .addComponents(
                                input
                            );


                    modal.addComponents(
                        linha
                    );


                    await i.showModal(
                        modal
                    );


                    // ====================
                    // ESPERAR QUANTIDADE
                    // ====================

                    try {

                        const modalSubmit =
                            await i.awaitModalSubmit({

                                filter: modalInteraction =>

                                    modalInteraction
                                        .customId ===
                                    `estoque_quantidade_${interaction.id}`

                                    &&

                                    modalInteraction
                                        .user
                                        .id ===
                                    interaction.user.id,

                                time: 120000
                            });


                        const texto =
                            modalSubmit
                                .fields
                                .getTextInputValue(
                                    'quantidade'
                                );


                        const quantidade =
                            interpretarQuantidade(
                                texto
                            );


                        if (!quantidade) {

                            await modalSubmit.reply({

                                content:
                                    '❌ Quantidade inválida. Use algo como `2200` ou `2.2k`.',

                                flags:
                                    MessageFlags.Ephemeral
                            });

                            return;
                        }


                        const configAtual =
                            getConfig();


                        if (!configAtual.estoque) {
                            configAtual.estoque = {};
                        }


                        configAtual
                            .estoque
                            .status =
                            'ON';


                        configAtual
                            .estoque
                            .quantidade =
                            quantidade;


                        saveConfig(
                            configAtual
                        );


                        // ====================
                        // PEGAR CANAL
                        // ====================

                        const canal =
                            await interaction
                                .guild
                                .channels
                                .fetch(
                                    configAtual
                                        .estoque
                                        .canalId
                                );


                        if (!canal?.isTextBased()) {

                            await modalSubmit.reply({

                                content:
                                    '❌ Não consegui encontrar o canal de estoque.',

                                flags:
                                    MessageFlags.Ephemeral
                            });

                            return;
                        }


                        const estoqueFormatado =
                            formatarEstoque(
                                quantidade
                            );


                        const preco =
                            formatarK(
                                configAtual
                                    .estoque
                                    .precoK ||
                                39
                            );


                        const canalCompra =
                            configAtual
                                .estoque
                                .canalCompraId;


                        // ====================
                        // PUBLICAR ESTOQUE
                        // ====================

                        await canal.send({

                            content:
                                '🟢 **𝐋𝐎𝐉𝐀 𝐎𝐍!**\n\n' +

                                `📦 **𝐄𝐬𝐭𝐨𝐪𝐮𝐞 𝐝𝐢𝐬𝐩𝐨𝐧𝐢́𝐯𝐞𝐥:** ${estoqueFormatado}\n\n` +

                                `💸 **𝐏𝐫𝐞𝐜̧𝐨:** **${preco}**\n\n` +

                                '**𝐏𝐚𝐫𝐚 𝐜𝐨𝐦𝐩𝐫𝐚𝐫, 𝐚𝐜𝐞𝐬𝐬𝐞:**\n' +

                                `<#${canalCompra}>\n\n` +

                                '💬 **𝐃𝐮́𝐯𝐢𝐝𝐚𝐬 𝐩𝐨𝐝𝐞𝐦 𝐬𝐞𝐫 𝐭𝐫𝐚𝐭𝐚𝐝𝐚𝐬 𝐧𝐨 𝐭𝐢𝐜𝐤𝐞𝐭 𝐝𝐞 𝐜𝐨𝐦𝐩𝐫𝐚.**\n' +

                                '**𝐏𝐚𝐠𝐚𝐦𝐞𝐧𝐭𝐨 𝐬𝐨́ 𝐚𝐩𝐨́𝐬 𝐚 𝐚𝐮𝐭𝐨𝐫𝐢𝐳𝐚𝐜̧𝐚̃𝐨.**\n\n' +

                                '@everyone',

                            allowedMentions: {
                                parse: ['everyone']
                            }
                        });


                        await modalSubmit.reply({

                            content:
                                `✅ Loja marcada como **ON**.\nEstoque publicado: **${estoqueFormatado} Robux**.`,

                            flags:
                                MessageFlags.Ephemeral
                        });


                        collector.stop();

                    } catch {

                        // O administrador demorou
                        // mais de 2 minutos.
                    }
                }
            }
        );
    }
};