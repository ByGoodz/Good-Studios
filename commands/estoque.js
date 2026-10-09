
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

// ==========================================
// FORMATAR QUANTIDADE
// ==========================================

function interpretarQuantidade(texto) {
    let valor = String(texto)
        .trim()
        .toLowerCase()
        .replace(/\s/g, '');

    if (valor.endsWith('k')) {
        const numero = Number(
            valor.slice(0, -1).replace(',', '.')
        );

        if (!Number.isFinite(numero) || numero <= 0) {
            return null;
        }

        return Math.floor(numero * 1000);
    }

    if (!/^[\d.,]+$/.test(valor)) {
        return null;
    }

    valor = valor.replace(/\./g, '').replace(',', '.');

    const numero = Number(valor);

    if (!Number.isFinite(numero) || numero <= 0) {
        return null;
    }

    return Math.floor(numero);
}

function formatarQuantidade(valor) {
    return Number(valor).toLocaleString('pt-BR');
}

function formatarK(valor) {
    return `K${Number(valor).toLocaleString('pt-BR', {
        maximumFractionDigits: 2
    })}`;
}

// ==========================================
// IDENTIFICAR MENSAGENS DE ESTOQUE
// ==========================================

function ehMensagemDeEstoque(mensagem, botId) {
    if (mensagem.author.id !== botId) {
        return false;
    }

    const texto = mensagem.content || '';

    return (
        texto.includes('𝐋𝐎𝐉𝐀 𝐎𝐍') ||
        texto.includes('𝐋𝐎𝐉𝐀 𝐎𝐅𝐅') ||
        texto.includes('LOJA ON!') ||
        texto.includes('LOJA OFF!') ||
        texto.includes('📦 Estoque disponível:')
    );
}

// ==========================================
// ENCONTRAR ÚLTIMA PUBLICAÇÃO
// ==========================================

async function buscarUltimaMensagem(canal, config, botId) {
    const idSalvo = config.estoque?.ultimaMensagemId;

    if (idSalvo) {
        try {
            const mensagem = await canal.messages.fetch(idSalvo);

            if (mensagem.author.id === botId) {
                return mensagem;
            }
        } catch (erro) {
            console.log(
                'Última publicação não encontrada pelo ID.'
            );
        }
    }

    // Compatibilidade com mensagens publicadas
    // antes desta atualização.
    const mensagens = await canal.messages.fetch({
        limit: 100
    });

    return mensagens.find(
        mensagem => ehMensagemDeEstoque(mensagem, botId)
    ) || null;
}

// ==========================================
// CRIAR TEXTO DO ESTOQUE
// ==========================================

function criarTextoEstoque(config) {
    const estoque = config.estoque;

    if (estoque.status === 'OFF') {
        return (
            '🔴 **𝐋𝐎𝐉𝐀 𝐎𝐅𝐅!**\n\n' +
            '📦 No momento, nossas vendas estão ' +
            'temporariamente pausadas.\n\n' +
            '🔔 Assim que o estoque estiver disponível ' +
            'novamente, avisaremos por aqui.\n\n' +
            '💎 **InovareSale • Sua loja de Robux**'
        );
    }

    const quantidade = formatarQuantidade(
        estoque.quantidade
    );

    const preco = formatarK(
        estoque.precoK ?? 39
    );

    const canalCompra = estoque.canalCompraId
        ? `<#${estoque.canalCompraId}>`
        : 'Canal não configurado';

    return (
        '🟢 **𝐋𝐎𝐉𝐀 𝐎𝐍!**\n\n' +
        `📦 **𝐄𝐬𝐭𝐨𝐪𝐮𝐞 𝐝𝐢𝐬𝐩𝐨𝐧𝐢́𝐯𝐞𝐥:** ${quantidade} Robux\n\n` +
        `💸 **𝐏𝐫𝐞𝐜̧𝐨:** ${preco}\n\n` +
        '**𝐏𝐚𝐫𝐚 𝐜𝐨𝐦𝐩𝐫𝐚𝐫, 𝐚𝐜𝐞𝐬𝐬𝐞:**\n' +
        `${canalCompra}\n\n` +
        '💬 **Dúvidas podem ser tratadas ' +
        'no ticket de compra.**\n\n' +
        '⚠️ **Pagamento somente após autorização ' +
        'da equipe.**\n\n' +
        '💎 **InovareSale • Sua loja de Robux**'
    );
}

// ==========================================
// PUBLICAR E SUBSTITUIR ESTOQUE
// ==========================================

async function publicarEstoque(guild, client, config) {
    const canal = await guild.channels.fetch(
        config.estoque.canalId
    );

    if (
        !canal ||
        !canal.isTextBased() ||
        !canal.messages
    ) {
        throw new Error(
            'Canal de estoque inválido ou inacessível.'
        );
    }

    // Primeiro publica a mensagem nova.
    const mensagemNova = await canal.send({
        content: criarTextoEstoque(config),
        allowedMentions: {
            parse: []
        }
    });

    // Salva o ID antes de tentar limpar as antigas.
    const idAnterior = config.estoque.ultimaMensagemId;

    config.estoque.ultimaMensagemId = mensagemNova.id;
    saveConfig(config);

    const antigas = new Map();

    if (idAnterior && idAnterior !== mensagemNova.id) {
        try {
            const anterior = await canal.messages.fetch(
                idAnterior
            );

            if (anterior.author.id === client.user.id) {
                antigas.set(anterior.id, anterior);
            }
        } catch (erro) {
            // A mensagem antiga pode ter sido apagada.
        }
    }

    // Procura também publicações antigas realizadas
    // antes de existir a configuração ultimaMensagemId.
    try {
        const recentes = await canal.messages.fetch({
            limit: 100
        });

        for (const mensagem of recentes.values()) {
            if (
                mensagem.id !== mensagemNova.id &&
                ehMensagemDeEstoque(
                    mensagem,
                    client.user.id
                )
            ) {
                antigas.set(mensagem.id, mensagem);
            }
        }
    } catch (erro) {
        console.error(
            'Erro ao localizar estoques antigos:',
            erro
        );
    }

    for (const mensagem of antigas.values()) {
        try {
            await mensagem.delete();
        } catch (erro) {
            console.error(
                'Não foi possível apagar estoque antigo:',
                erro
            );
        }
    }

    return mensagemNova;
}

// ==========================================
// CRIAR MODAL DE QUANTIDADE
// ==========================================

function criarModalQuantidade() {
    const modal = new ModalBuilder()
        .setCustomId('estoque_v2_quantidade')
        .setTitle('Estoque disponível');

    const input = new TextInputBuilder()
        .setCustomId('quantidade')
        .setLabel('Quantos Robux temos em estoque?')
        .setPlaceholder('Exemplo: 5000 ou 5k')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(input)
    );

    return modal;
}

// ==========================================
// CRIAR MODAL DE EDIÇÃO
// ==========================================

function criarModalEdicao(textoAtual) {
    const modal = new ModalBuilder()
        .setCustomId('estoque_v2_editar')
        .setTitle('Editar última publicação');

    const input = new TextInputBuilder()
        .setCustomId('mensagem')
        .setLabel('Texto da publicação')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(2000)
        .setRequired(true)
        .setValue(textoAtual.slice(0, 2000));

    modal.addComponents(
        new ActionRowBuilder().addComponents(input)
    );

    return modal;
}

// ==========================================
// COMANDO /ESTOQUE
// ==========================================

module.exports = {
    data: new SlashCommandBuilder()
        .setName('estoque')
        .setDescription(
            'Gerencia o status e o estoque da InovareSale.'
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.Administrator
        ),

    async execute(interaction, client) {
        const config = getConfig();

        if (!config.estoque?.canalId) {
            return interaction.reply({
                content:
                    '❌ Configure o canal de estoque no `/setup`.',
                flags: MessageFlags.Ephemeral
            });
        }

        const embed = new EmbedBuilder()
            .setColor(0xC0C0C0)
            .setTitle('📦 Estoque — InovareSale')
            .setDescription(
                'Gerencie a publicação de estoque da loja.\n\n' +
                '🟢 **Loja ON:** informa uma quantidade ' +
                'e publica o estoque disponível.\n\n' +
                '🔴 **Loja OFF:** informa que as vendas ' +
                'estão pausadas.\n\n' +
                '✏️ **Editar última:** altera diretamente ' +
                'o texto da publicação atual.\n\n' +
                'Uma nova publicação substitui as anteriores.'
            )
            .setFooter({
                text: 'InovareSale • Gerenciamento de Estoque'
            });

        const botoes = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('estoque_v2_on')
                    .setLabel('Loja ON')
                    .setEmoji('🟢')
                    .setStyle(ButtonStyle.Success),

                new ButtonBuilder()
                    .setCustomId('estoque_v2_off')
                    .setLabel('Loja OFF')
                    .setEmoji('🔴')
                    .setStyle(ButtonStyle.Danger),

                new ButtonBuilder()
                    .setCustomId('estoque_v2_editar_botao')
                    .setLabel('Editar última')
                    .setEmoji('✏️')
                    .setStyle(ButtonStyle.Secondary)
            );

        await interaction.reply({
            embeds: [embed],
            components: [botoes],
            flags: MessageFlags.Ephemeral
        });

        const painel = await interaction.fetchReply();

        const collector = painel.createMessageComponentCollector({
            filter: i => i.user.id === interaction.user.id,
            time: 120000,
            max: 1
        });

        collector.on('collect', async i => {
            try {
                // ==============================
                // LOJA OFF
                // ==============================

                if (i.customId === 'estoque_v2_off') {
                    await i.deferUpdate();

                    const atual = getConfig();
                    atual.estoque.status = 'OFF';
                    atual.estoque.quantidade = 0;

                    await publicarEstoque(
                        interaction.guild,
                        client,
                        atual
                    );

                    await interaction.editReply({
                        content:
                            '✅ Loja OFF! A publicação anterior foi substituída.',
                        embeds: [],
                        components: []
                    });

                    return;
                }

                // ==============================
                // LOJA ON
                // ==============================

                if (i.customId === 'estoque_v2_on') {
                    await i.showModal(
                        criarModalQuantidade()
                    );

                    const resposta = await i.awaitModalSubmit({
                        filter: modal =>
                            modal.customId === 'estoque_v2_quantidade' &&
                            modal.user.id === interaction.user.id,
                        time: 120000
                    });

                    await resposta.deferReply({
                        flags: MessageFlags.Ephemeral
                    });

                    const quantidade = interpretarQuantidade(
                        resposta.fields.getTextInputValue(
                            'quantidade'
                        )
                    );

                    if (!quantidade) {
                        await resposta.editReply({
                            content:
                                '❌ Quantidade inválida. Use `5000` ou `5k`.'
                        });
                        return;
                    }

                    const atual = getConfig();

                    atual.estoque.status = 'ON';
                    atual.estoque.quantidade = quantidade;

                    await publicarEstoque(
                        interaction.guild,
                        client,
                        atual
                    );

                    await resposta.editReply({
                        content:
                            `✅ Loja ON! Estoque publicado: **${formatarQuantidade(quantidade)} Robux**.`
                    });

                    await interaction.editReply({
                        components: []
                    });

                    return;
                }

                // ==============================
                // EDITAR ÚLTIMA PUBLICAÇÃO
                // ==============================

                if (
                    i.customId ===
                    'estoque_v2_editar_botao'
                ) {
                    const atual = getConfig();

                    const canal = await interaction.guild
                        .channels.fetch(
                            atual.estoque.canalId
                        );

                    if (
                        !canal ||
                        !canal.isTextBased() ||
                        !canal.messages
                    ) {
                        await i.update({
                            content:
                                '❌ Canal de estoque não encontrado.',
                            embeds: [],
                            components: []
                        });
                        return;
                    }

                    const mensagem = await buscarUltimaMensagem(
                        canal,
                        atual,
                        client.user.id
                    );

                    if (!mensagem) {
                        await i.update({
                            content:
                                '❌ Ainda não existe publicação de estoque para editar.',
                            embeds: [],
                            components: []
                        });
                        return;
                    }

                    await i.showModal(
                        criarModalEdicao(mensagem.content)
                    );

                    const resposta = await i.awaitModalSubmit({
                        filter: modal =>
                            modal.customId === 'estoque_v2_editar' &&
                            modal.user.id === interaction.user.id,
                        time: 120000
                    });

                    await resposta.deferReply({
                        flags: MessageFlags.Ephemeral
                    });

                    const novoTexto = resposta.fields
                        .getTextInputValue('mensagem')
                        .trim();

                    if (!novoTexto) {
                        await resposta.editReply({
                            content: '❌ A mensagem não pode ficar vazia.'
                        });
                        return;
                    }

                    await mensagem.edit({
                        content: novoTexto,
                        allowedMentions: {
                            parse: []
                        }
                    });

                    atual.estoque.ultimaMensagemId =
                        mensagem.id;

                    saveConfig(atual);

                    await resposta.editReply({
                        content:
                            '✅ Última publicação editada com sucesso!'
                    });

                    await interaction.editReply({
                        components: []
                    });
                }

            } catch (erro) {
                console.error(
                    'Erro no comando /estoque:',
                    erro
                );

                try {
                    await interaction.editReply({
                        content:
                            '❌ Ocorreu um erro ao atualizar o estoque. Verifique os logs.',
                        embeds: [],
                        components: []
                    });
                } catch {}
            }
        });

        collector.on('end', async () => {
            try {
                await interaction.editReply({
                    components: []
                });
            } catch {}
        });
    }
};
