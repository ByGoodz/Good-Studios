
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

// ==========================================
// INOVARESALE BOT 2.0
// PAINÉIS DO SISTEMA DE TICKETS
// ==========================================

const COR_PRINCIPAL = 0xC0C0C0;

const METODOS = {
    viaPlus: 'Via Plus',
    semTaxa: 'Robux Sem Taxa',
    taxado: 'Robux Taxado',
    viaGrupo: 'Robux Via Grupo'
};

// ==========================================
// FORMATAÇÕES
// ==========================================

function formatarRobux(valor) {
    return Number(valor || 0).toLocaleString(
        'pt-BR'
    );
}

function formatarDinheiro(valor) {
    return Number(valor || 0).toLocaleString(
        'pt-BR',
        {
            style: 'currency',
            currency: 'BRL'
        }
    );
}

function formatarCentavos(centavos) {
    return formatarDinheiro(
        Number(centavos || 0) / 100
    );
}

function formatarPedido(id) {
    return `INV-${String(id).padStart(4, '0')}`;
}

function nomeMetodo(chave) {
    return METODOS[chave] || 'Não informado';
}

function nomePagamento(chave) {
    if (chave === 'pix') {
        return 'PIX';
    }

    if (chave === 'mm') {
        return 'Solicitar MM';
    }

    return 'Não informado';
}

function nomeStatus(status) {
    const statusDisponiveis = {
        criando: '⏳ Criando pedido',
        aberto: '🟡 Aguardando atendimento',
        em_atendimento: '🔵 Em atendimento',
        finalizando: '⏳ Finalizando compra',
        finalizado: '✅ Compra concluída',
        cancelado: '❌ Pedido cancelado'
    };

    return statusDisponiveis[status] ||
        '🟡 Aguardando atendimento';
}

// ==========================================
// VERIFICAR MÉTODO DISPONÍVEL
// ==========================================

function metodoDisponivel(config, chave) {
    if (!METODOS[chave]) {
        return false;
    }

    const bloqueados =
        config.tickets?.bloqueados || {};

    const precoK = Number(
        config.calculadora?.[chave]
    );

    // Via Grupo começa bloqueado na versão 2.0.
    if (
        chave === 'viaGrupo' &&
        bloqueados[chave] !== false
    ) {
        return false;
    }

    return (
        bloqueados[chave] !== true &&
        Number.isFinite(precoK) &&
        precoK > 0
    );
}

// ==========================================
// PAINEL DE ESCOLHA DE MODALIDADE
// ==========================================

function criarPainelModalidades(
    config,
    quantidade
) {
    const embed = new EmbedBuilder()
        .setColor(COR_PRINCIPAL)

        .setTitle(
            '💎 Escolha sua modalidade de compra'
        )

        .setDescription(
            `**Quantidade solicitada:** ` +
            `${formatarRobux(quantidade)} Robux\n\n` +

            'Escolha como deseja receber seus Robux.\n\n' +

            '➕ **Via Plus**\n' +
            'Compra utilizando a modalidade Plus.\n\n' +

            '💸 **Robux Sem Taxa**\n' +
            'A quantidade digitada corresponde ' +
            'ao valor da gamepass. O recebimento ' +
            'considera a taxa de 30%.\n\n' +

            '💰 **Robux Taxado**\n' +
            'O valor da gamepass é calculado ' +
            'para compensar a taxa de 30%.\n\n' +

            '👥 **Robux Via Grupo**\n' +
            'Disponível somente quando a equipe ' +
            'liberar essa modalidade.'
        )

        .setFooter({
            text: 'InovareSale • Escolha sua modalidade'
        });

    const botoes = new ActionRowBuilder();

    for (const [chave, nome] of Object.entries(METODOS)) {
        const disponivel = metodoDisponivel(
            config,
            chave
        );

        botoes.addComponents(
            new ButtonBuilder()
                .setCustomId(
                    `ticket_metodo_${chave}`
                )
                .setLabel(nome)
                .setStyle(
                    disponivel
                        ? ButtonStyle.Primary
                        : ButtonStyle.Secondary
                )
                .setDisabled(!disponivel)
        );
    }

    return {
        embeds: [embed],
        components: [botoes],
        allowedMentions: {
            parse: []
        }
    };
}

// ==========================================
// PAINEL DE ESCOLHA DE PAGAMENTO
// ==========================================

function criarPainelPagamento({
    quantidade,
    modalidade,
    precoCentavos
}) {
    const embed = new EmbedBuilder()
        .setColor(COR_PRINCIPAL)

        .setTitle(
            '💳 Escolha seu método de pagamento'
        )

        .setDescription(
            'Confira as informações do seu pedido.\n\n' +

            `💎 **Robux:** ` +
            `${formatarRobux(quantidade)}\n\n` +

            `📦 **Modalidade:** ` +
            `${nomeMetodo(modalidade)}\n\n` +

            `💰 **Preço estimado:** ` +
            `${formatarCentavos(precoCentavos)}\n\n` +

            '━━━━━━━━━━━━━━━━━━━━\n\n' +

            '💚 **PIX**\n' +
            'Você receberá as instruções ' +
            'de pagamento durante o atendimento.\n\n' +

            '🤝 **SOLICITAR MM**\n' +
            'Solicite um intermediário para ' +
            'acompanhar sua compra.\n\n' +

            '⚠️ Nunca informe sua senha ' +
            'ou pague antes da orientação da equipe.'
        )

        .setFooter({
            text: 'InovareSale • Pagamento seguro'
        });

    const botoes = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('ticket_pagamento_pix')
                .setLabel('PIX')
                .setEmoji('💚')
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId('ticket_pagamento_mm')
                .setLabel('Solicitar MM')
                .setEmoji('🤝')
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
// BOTÕES ADMINISTRATIVOS DO TICKET
// ==========================================

function criarBotoesTicket() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('ticket_assumir')
                .setLabel('Assumir atendimento')
                .setEmoji('🙋')
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId('ticket_finalizar')
                .setLabel('Finalizar venda')
                .setEmoji('✅')
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId('ticket_cancelar')
                .setLabel('Cancelar')
                .setEmoji('❌')
                .setStyle(ButtonStyle.Danger)
        );
}

// ==========================================
// MENSAGEM PRINCIPAL DO TICKET
// ==========================================

function criarPainelTicket(
    ticket,
    usuarioRoblox,
    orcamento = {}
) {
    const pedidoId = formatarPedido(ticket.id);

    const quantidade = formatarRobux(
        ticket.quantidade_robux
    );

    const valor = formatarCentavos(
        ticket.preco_centavos
    );

    const usuario = String(
        usuarioRoblox ||
        ticket.usuario_roblox ||
        'Não informado'
    ).replace(/`/g, '');

    const robuxRecebidos = orcamento.recebido ??
        ticket.quantidade_robux;

    const gamepass = orcamento.gamepass ?? null;

    const embed = new EmbedBuilder()
        .setColor(COR_PRINCIPAL)

        .setTitle(
            `🛒 Pedido de Robux — ${pedidoId}`
        )

        .setDescription(
            '💎 **Bem-vindo ao seu atendimento ' +
            'na InovareSale!**\n\n' +

            'Confira abaixo os dados da compra.\n\n' +

            '━━━━━━━━━━━━━━━━━━━━\n\n' +

            '📋 **INFORMAÇÕES DO PEDIDO**\n\n' +

            `👤 **Cliente:** <@${ticket.cliente_id}>\n\n` +

            `🎮 **Usuário Roblox:** \`${usuario}\`\n\n` +

            `💎 **Quantidade solicitada:** ` +
            `${quantidade} Robux\n\n` +

            `📦 **Modalidade:** ` +
            `${nomeMetodo(ticket.modalidade)}\n\n` +

            `💰 **Preço estimado:** ${valor}\n\n` +

            `💳 **Pagamento:** ` +
            `${nomePagamento(ticket.pagamento)}\n\n` +

            `✅ **Robux a receber:** ` +
            `${formatarRobux(robuxRecebidos)}\n\n` +

            (gamepass === null
                ? ''
                : `🎟️ **Gamepass necessária:** ` +
                  `${formatarRobux(gamepass)} Robux\n\n`) +

            '━━━━━━━━━━━━━━━━━━━━\n\n' +

            `📌 **Status:** ` +
            `${nomeStatus(ticket.status)}\n\n` +

            '⏳ Aguarde nossa equipe iniciar ' +
            'o atendimento.\n\n' +

            '⚠️ **Nunca compartilhe sua senha.**\n' +
            'Realize o pagamento somente após ' +
            'a confirmação de nossa equipe.'
        )

        .setFooter({
            text:
                `InovareSale • Pedido ${pedidoId}`
        })

        .setTimestamp();

    return {
        embeds: [embed],
        components: [
            criarBotoesTicket()
        ],
        allowedMentions: {
            parse: []
        }
    };
}

// ==========================================
// MENSAGEM PARA PAGAMENTO COM MM
// ==========================================

function criarAvisoMM() {
    const embed = new EmbedBuilder()
        .setColor(COR_PRINCIPAL)

        .setTitle(
            '🤝 Intermediário solicitado'
        )

        .setDescription(
            'Você escolheu a opção ' +
            '**Solicitar MM**.\n\n' +

            'Nossa equipe vai organizar ' +
            'a intermediação da compra.\n\n' +

            '⏳ Aguarde as instruções ' +
            'de um atendente autorizado.\n\n' +

            '⚠️ Não envie senhas, códigos ' +
            'de verificação nem realize pagamentos ' +
            'antecipados.'
        )

        .setFooter({
            text: 'InovareSale • Atendimento'
        });

    return {
        embeds: [embed],
        allowedMentions: {
            parse: []
        }
    };
}

// ==========================================
// EXPORTAR FUNÇÕES
// ==========================================

module.exports = {
    criarPainelModalidades,
    criarPainelPagamento,
    criarPainelTicket,
    criarBotoesTicket,
    criarAvisoMM,
    formatarPedido,
    nomeMetodo,
    nomePagamento
};
