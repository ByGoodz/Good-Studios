
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

// ==========================================
// INOVARESALE BOT 2.0
// PAINEL DE ESTOQUE
// ==========================================

// ==========================================
// FORMATAÇÕES
// ==========================================

function formatarRobux(valor) {
    return Number(valor || 0).toLocaleString('pt-BR');
}

function formatarK(valor) {
    return `K${Number(valor ?? 39).toLocaleString(
        'pt-BR',
        { maximumFractionDigits: 2 }
    )}`;
}

function formatarCanal(canalId) {
    return canalId
        ? `<#${canalId}>`
        : '`Não configurado`';
}

// ==========================================
// PAINEL ADMINISTRATIVO DO ESTOQUE
// ==========================================

function criarPainelEstoque(config = {}) {
    const estoque = config.estoque || {};

    const status = estoque.status === 'ON'
        ? '🟢 Loja ON'
        : '🔴 Loja OFF';

    const quantidade = formatarRobux(
        estoque.quantidade
    );

    const embed = new EmbedBuilder()
        .setColor(0xC0C0C0)

        .setTitle(
            '📦 GERENCIAMENTO DE ESTOQUE — INOVARESALE'
        )

        .setDescription(
            'Bem-vindo ao gerenciamento de estoque ' +
            'da **InovareSale**!\n\n' +

            '━━━━━━━━━━━━━━━━━━━━\n\n' +

            `🏪 **Status atual:** ${status}\n\n` +

            `💎 **Robux disponíveis:** ${quantidade}\n\n` +

            `💰 **Preço atual:** ${formatarK(estoque.precoK)}\n\n` +

            `📍 **Canal de estoque:** ${formatarCanal(estoque.canalId)}\n\n` +

            `🛒 **Canal de compra:** ${formatarCanal(estoque.canalCompraId)}\n\n` +

            '━━━━━━━━━━━━━━━━━━━━\n\n' +

            '🟢 **Loja ON**\n' +
            'Informe a quantidade disponível e publique o estoque.\n\n' +

            '🔴 **Loja OFF**\n' +
            'Pause as vendas e informe os clientes.\n\n' +

            '✏️ **Editar última**\n' +
            'Altere a mensagem de estoque já publicada.\n\n' +

            '📢 Ao publicar um novo estoque, ' +
            'a publicação anterior será substituída.'
        )

        .setFooter({
            text:
                'InovareSale • Administração de Estoque'
        })

        .setTimestamp();

    // ======================================
    // BOTÕES
    // ======================================

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

    return {
        embeds: [embed],
        components: [botoes],
        allowedMentions: {
            parse: []
        }
    };
}

// ==========================================
// EXPORTAR PAINEL
// ==========================================

module.exports = {
    criarPainelEstoque
};
