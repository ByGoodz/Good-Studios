
'use strict';

const fs = require('fs');
const path = require('path');

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder,
    escapeMarkdown
} = require('discord.js');

// ==========================================
// INOVARESALE BOT 3.0
// PAINÉIS DO SISTEMA DE TICKETS
// ==========================================

const COR_PRINCIPAL = 0x9951CB;

const CAMINHO_BANNER = path.join(
    __dirname,
    '..',
    'assets',
    'banner.png'
);

const ASSINATURA_PNG = Buffer.from([
    137, 80, 78, 71, 13, 10, 26, 10
]);

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
    const numero = Number(valor || 0);

    if (!Number.isFinite(numero)) {
        return '0';
    }

    return Math.floor(Math.max(0, numero))
        .toLocaleString('pt-BR');
}

function formatarPedido(id) {
    return `INV-${String(id).padStart(4, '0')}`;
}

function nomeMetodo(chave) {
    return METODOS[chave] || 'Não informado';
}

function nomePagamento(chave) {
    const nomes = {
        pix: 'PIX',
        mm: 'Solicitar MM',
        outro: 'Outro'
    };

    return nomes[chave] || 'Não informado';
}

function nomeStatus(status) {
    const estados = {
        criando: 'Criando pedido',
        aberto: 'Aguardando atendimento',
        em_atendimento: 'Em atendimento',
        finalizando: 'Finalizando compra',
        finalizado: 'Compra concluída',
        cancelado: 'Pedido cancelado'
    };

    return estados[status] || 'Aguardando atendimento';
}

function textoSeguro(valor, limite = 60) {
    const texto = String(valor || 'Não informado')
        .replace(/[\r\n\t]/g, ' ')
        .trim()
        .slice(0, limite);

    return escapeMarkdown(texto || 'Não informado');
}

// ==========================================
// BANNER ORIGINAL DA INOVARESALE
// ==========================================

function carregarBanner() {
    try {
        if (!fs.existsSync(CAMINHO_BANNER)) {
            console.warn(
                '[TicketPanel] assets/banner.png não encontrado.'
            );
            return null;
        }

        const dados = fs.readFileSync(CAMINHO_BANNER);

        if (
            dados.length < 100 ||
            dados.length > 8 * 1024 * 1024 ||
            !dados.subarray(0, 8).equals(ASSINATURA_PNG)
        ) {
            console.warn(
                '[TicketPanel] banner.png inválido ou muito grande.'
            );
            return null;
        }

        return new AttachmentBuilder(dados, {
            name: 'banner.png'
        });

    } catch (erro) {
        console.error(
            '[TicketPanel] Erro ao carregar banner:',
            erro.message
        );
        return null;
    }
}

function adicionarBanner(embed, resposta) {
    const banner = carregarBanner();

    if (banner) {
        embed.setImage('attachment://banner.png');
        resposta.files = [banner];
    }

    return resposta;
}

// ==========================================
// VERIFICAR MODALIDADE DISPONÍVEL
// ==========================================

function metodoDisponivel(config = {}, chave) {
    if (!METODOS[chave]) {
        return false;
    }

    const bloqueados = config.tickets?.bloqueados || {};
    const precoK = config.calculadora?.[chave];

    const precoValido =
        precoK !== null &&
        precoK !== undefined &&
        Number.isFinite(Number(precoK)) &&
        Number(precoK) > 0;

    // Via Grupo permanece bloqueada por padrão.
    if (
        chave === 'viaGrupo' &&
        bloqueados.viaGrupo !== false
    ) {
        return false;
    }

    return (
        bloqueados[chave] !== true &&
        precoValido
    );
}

// ==========================================
// BOTÕES DE MODALIDADE
// ==========================================

function criarBotoesModalidades(config = {}) {
    const linha = new ActionRowBuilder();

    for (const [chave, nome] of Object.entries(METODOS)) {
        const disponivel = metodoDisponivel(
            config,
            chave
        );

        linha.addComponents(
            new ButtonBuilder()
                .setCustomId(`ticket_metodo_${chave}`)
                .setLabel(nome)
                .setStyle(
                    disponivel
                        ? ButtonStyle.Primary
                        : ButtonStyle.Secondary
                )
                .setDisabled(!disponivel)
        );
    }

    return linha;
}

// ==========================================
// PAINEL DE ESCOLHA DA MODALIDADE
// ==========================================

function criarPainelModalidades(
    config = {},
    quantidade = 0
) {
    const embed = new EmbedBuilder()
        .setColor(COR_PRINCIPAL)
        .setTitle(
            'INOVARESALE | ESCOLHER MODALIDADE'
        )
        .setDescription(
            'Selecione como deseja receber seus Robux.'
        )
        .addFields(
            {
                name: 'Quantidade solicitada',
                value: `${formatarRobux(quantidade)} Robux`,
                inline: true
            },
            {
                name: 'Etapa',
                value: 'Escolha da modalidade',
                inline: true
            }
        )
        .addFields(
            {
                name: 'Via Plus',
                value: 'Entrega pela modalidade Plus.',
                inline: true
            },
            {
                name: 'Robux Sem Taxa',
                value:
                    'Recebimento com desconto da taxa do Roblox.',
                inline: true
            },
            {
                name: 'Robux Taxado',
                value:
                    'Gamepass calculada para compensar a taxa.',
                inline: true
            },
            {
                name: 'Robux Via Grupo',
                value:
                    'Disponível quando liberado pela equipe.',
                inline: true
            }
        )
        .setFooter({
            text: 'InovareSale • Selecione uma modalidade'
        });

    return {
        embeds: [embed],
        components: [
            criarBotoesModalidades(config)
        ],
        allowedMentions: {
            parse: []
        }
    };
}

// ==========================================
// PAINEL DE ESCOLHA DO PAGAMENTO
// ==========================================

// O parâmetro precoCentavos continua aceito
// por compatibilidade, mas NÃO é exibido.
//
// O preço permanece calculado internamente
// pelo sistema de pedidos.

function criarPainelPagamento({
    quantidade,
    modalidade,
    precoCentavos
} = {}) {
    const embed = new EmbedBuilder()
        .setColor(COR_PRINCIPAL)
        .setTitle(
            'INOVARESALE | FORMA DE PAGAMENTO'
        )
        .setDescription(
            'Seu pedido está quase pronto!\n' +
            'Escolha como deseja prosseguir.'
        )
        .addFields(
            {
                name: 'Quantidade',
                value:
                    `${formatarRobux(quantidade)} Robux`,
                inline: true
            },
            {
                name: 'Modalidade',
                value: nomeMetodo(modalidade),
                inline: true
            }
        )
        .addFields(
            {
                name: 'PIX',
                value:
                    'Receba as instruções durante o atendimento.',
                inline: true
            },
            {
                name: 'Solicitar MM',
                value:
                    'Solicite uma compra com intermediário.',
                inline: true
            }
        )
        .addFields({
            name: 'Atenção',
            value:
                'Nunca compartilhe sua senha ou códigos ' +
                'de verificação. Aguarde a orientação ' +
                'da equipe antes de realizar pagamentos.',
            inline: false
        })
        .setFooter({
            text: 'InovareSale • Atendimento seguro'
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
// BOTÕES PRINCIPAIS DO TICKET
// ==========================================

function criarBotoesTicket() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('ticket_assumir')
                .setLabel('Assumir ticket')
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId('ticket_finalizar')
                .setLabel('Concluir compra')
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId('ticket_cancelar')
                .setLabel('Fechar ticket')
                .setStyle(ButtonStyle.Danger)
        );
}

// ==========================================
// PAINEL PRINCIPAL DO TICKET 3.0
// ==========================================

function criarPainelTicket(
    ticket = {},
    usuarioRoblox = null,
    orcamento = {}
) {
    const pedidoId = formatarPedido(
        ticket.id || 0
    );

    const clienteId = String(
        ticket.cliente_id || ''
    );

    const quantidade = formatarRobux(
        ticket.quantidade_robux
    );

    const modalidade = nomeMetodo(
        ticket.modalidade
    );

    const usuario = textoSeguro(
        usuarioRoblox ||
        ticket.usuario_roblox ||
        'Não informado',
        30
    );

    const pagamento = nomePagamento(
        ticket.pagamento
    );

    const status = nomeStatus(
        ticket.status
    );

    const recebido = orcamento.recebido ??
        ticket.quantidade_robux;

    const gamepass = orcamento.gamepass ?? null;

    const embed = new EmbedBuilder()
        .setColor(COR_PRINCIPAL)
        .setTitle(
            'INOVARESALE | PEDIDO DE ROBUX'
        )
        .setDescription(
            `Olá, ${
                /^\d{17,20}$/.test(clienteId)
                    ? `<@${clienteId}>`
                    : 'cliente'
            }! Seu ticket foi criado com sucesso.\n\n` +
            'Nossa equipe realizará o atendimento em breve.'
        );

    // ==================================
    // INFORMAÇÕES LADO A LADO
    // ==================================

    embed.addFields(
        {
            name: 'Quantidade',
            value: `${quantidade} Robux`,
            inline: true
        },
        {
            name: 'Modalidade',
            value: modalidade,
            inline: true
        },
        {
            name: 'Usuário Roblox',
            value: usuario,
            inline: true
        },
        {
            name: 'Status',
            value: status,
            inline: true
        },
        {
            name: 'Pagamento',
            value: pagamento,
            inline: true
        },
        {
            name: 'Pedido',
            value: pedidoId,
            inline: true
        }
    );

    // ==================================
    // INFORMAÇÕES SOBRE A ENTREGA
    // ==================================

    if (
        recebido !== null &&
        recebido !== undefined &&
        Number.isFinite(Number(recebido))
    ) {
        embed.addFields({
            name: 'Robux a receber',
            value:
                `${formatarRobux(recebido)} Robux`,
            inline: true
        });
    }

    if (
        gamepass !== null &&
        gamepass !== undefined &&
        Number.isFinite(Number(gamepass))
    ) {
        embed.addFields({
            name: 'Gamepass necessária',
            value:
                `${formatarRobux(gamepass)} Robux`,
            inline: true
        });
    }

    // ==================================
    // AVISO DE SEGURANÇA
    // ==================================

    embed.addFields({
        name: 'Informações importantes',
        value:
            'Aguarde um atendente iniciar o atendimento.\n' +
            'Não compartilhe senhas nem realize pagamentos ' +
            'antes das orientações da equipe.',
        inline: false
    });

    embed.setFooter({
        text: `InovareSale • ${pedidoId}`
    });

    embed.setTimestamp();

    // ==================================
    // PREPARAR RESPOSTA
    // ==================================

    const resposta = {
        embeds: [embed],
        components: [
            criarBotoesTicket()
        ],
        allowedMentions: {
            parse: []
        }
    };

    // Banner original abaixo dos campos
    // do embed, acima dos botões.
    adicionarBanner(embed, resposta);

    return resposta;
}

// ==========================================
// AVISO DE INTERMEDIÁRIO (MM)
// ==========================================

function criarAvisoMM() {
    const embed = new EmbedBuilder()
        .setColor(COR_PRINCIPAL)
        .setTitle(
            'INOVARESALE | INTERMEDIÁRIO SOLICITADO'
        )
        .setDescription(
            'Você selecionou **Solicitar MM**.\n\n' +
            'Nossa equipe organizará a intermediação ' +
            'da compra. Aguarde as instruções ' +
            'de um atendente autorizado.'
        )
        .addFields({
            name: 'Segurança',
            value:
                'Não compartilhe senhas, códigos de ' +
                'verificação ou dados sensíveis. ' +
                'Não realize pagamentos antecipados.',
            inline: false
        })
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
// EXPORTAÇÕES COMPATÍVEIS
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
