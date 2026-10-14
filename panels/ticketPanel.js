'use strict';
const {
    EmbedBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    SeparatorBuilder,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    escapeMarkdown
} = require('discord.js');
const COR_PRINCIPAL = 0x9951CB;
const METODOS = {
    viaPlus: 'Via Plus',
    semTaxa: 'Robux Sem Taxa',
    taxado: 'Robux Taxado',
    viaGrupo: 'Robux Via Grupo'
};
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
function criarBotoesTicket() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ticket_assumir')
            .setLabel('Assumir atendimento')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('ticket_finalizar')
            .setLabel('Finalizar venda')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('ticket_cancelar')
            .setLabel('Cancelar')
            .setStyle(ButtonStyle.Danger)
    );
}

async function buscarJsonRoblox(url, opcoes = {}) {
    const resposta = await fetch(url, {
        ...opcoes,
        signal: AbortSignal.timeout(4500),
        headers: {
            Accept: 'application/json',
            ...(opcoes.body ? { 'Content-Type': 'application/json' } : {})
        }
    });
    if (!resposta.ok) {
        throw new Error(`Roblox HTTP ${resposta.status}`);
    }
    return resposta.json();
}

async function consultarPerfilRoblox(username) {
    const nomeDigitado = String(username || '').trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(nomeDigitado)) {
        return { encontrado: false, username: nomeDigitado, indisponivel: false };
    }

    try {
        const busca = await buscarJsonRoblox(
            'https://users.roblox.com/v1/usernames/users',
            {
                method: 'POST',
                body: JSON.stringify({
                    usernames: [nomeDigitado],
                    excludeBannedUsers: false
                })
            }
        );

        const usuario = Array.isArray(busca?.data)
            ? busca.data.find(item => Number.isSafeInteger(Number(item?.id)))
            : null;

        if (!usuario) {
            return { encontrado: false, username: nomeDigitado, indisponivel: false };
        }

        const id = Number(usuario.id);
        const [detalhes, miniatura] = await Promise.allSettled([
            buscarJsonRoblox(`https://users.roblox.com/v1/users/${id}`),
            buscarJsonRoblox(
                `https://thumbnails.roblox.com/v1/users/avatar?userIds=${id}&size=420x420&format=Png&isCircular=false`
            )
        ]);

        const dados = detalhes.status === 'fulfilled' ? detalhes.value : null;
        const imagem = miniatura.status === 'fulfilled'
            ? miniatura.value?.data?.[0]?.imageUrl
            : null;
        const avatarUrl = typeof imagem === 'string' &&
            /^https:\/\/[^/]+\.rbxcdn\.com\//i.test(imagem)
                ? imagem
                : null;

        return {
            encontrado: true,
            id,
            username: String(dados?.name || usuario.name || nomeDigitado),
            displayName: String(dados?.displayName || usuario.displayName || usuario.name || nomeDigitado),
            criadoEm: dados?.created || null,
            avatarUrl,
            indisponivel: false
        };
    } catch (erro) {
        console.warn('[InovareSale | Roblox] Falha na consulta do perfil:', erro.message);
        return { encontrado: false, username: nomeDigitado, indisponivel: true };
    }
}

function formatarCriacaoRoblox(data) {
    if (!data) return 'Não disponível';
    const milissegundos = Date.parse(data);
    if (!Number.isFinite(milissegundos)) return 'Não disponível';
    const timestamp = Math.floor(milissegundos / 1000);
    return `<t:${timestamp}:F> (<t:${timestamp}:R>)`;
}

function criarPainelPerfilRoblox(perfil = {}) {
    const confirmado = perfil.encontrado === true &&
        Number.isSafeInteger(Number(perfil.id)) && Number(perfil.id) > 0;
    const usuario = textoSeguro(perfil.username || 'Não informado', 30);
    const display = textoSeguro(perfil.displayName || perfil.username || 'Não informado', 60);

    const linhas = confirmado
        ? [
            '**Informações do usuário:**',
            `• **Roblox ID:** \`${Number(perfil.id)}\``,
            `• **Roblox username:** \`@${usuario}\``,
            `• **Roblox display name:** ${display}`,
            `• **Criada em:** ${formatarCriacaoRoblox(perfil.criadoEm)}`
        ]
        : [
            `**Username informado:** \`@${usuario}\``,
            perfil.indisponivel
                ? 'A consulta ao Roblox está temporariamente indisponível. A equipe deve conferir o perfil.'
                : 'Não foi possível localizar esse username no Roblox. Confirme o nome com a equipe.'
        ];

    const titulo = new TextDisplayBuilder().setContent(
        `# Usuário no Roblox — @${usuario}\n${linhas.join('\n')}`
    );
    const container = new ContainerBuilder().setAccentColor(COR_PRINCIPAL);

    if (confirmado && perfil.avatarUrl) {
        container.addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(titulo)
                .setThumbnailAccessory(
                    new ThumbnailBuilder()
                        .setURL(perfil.avatarUrl)
                        .setDescription('Avatar do usuário Roblox')
                )
        );
    } else {
        container.addTextDisplayComponents(titulo);
    }

    if (confirmado) {
        const id = Number(perfil.id);
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
        container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Ver grupos')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`https://www.roblox.com/users/${id}/profile#!/groups`),
                new ButtonBuilder()
                    .setLabel('Ver perfil')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`https://www.roblox.com/users/${id}/profile`)
            )
        );
    }

    return {
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] }
    };
}

function criarPainelTicket(ticket = {}, usuarioRoblox = null, orcamento = {}) {
    const pedidoId = formatarPedido(ticket.id || 0);
    const clienteId = String(ticket.cliente_id || '');
    const cliente = /^\d{15,22}$/.test(clienteId) ? `<@${clienteId}>` : 'Não informado';
    const usuario = textoSeguro(usuarioRoblox || ticket.usuario_roblox || 'Não informado', 30);
    const quantidade = formatarRobux(ticket.quantidade_robux);
    const recebido = orcamento.recebido ?? ticket.quantidade_robux;
    const gamepass = orcamento.gamepass ?? null;
    const estado = nomeStatus(ticket.status || 'aberto');

    const informacoes = [
        '**Informações da compra:**',
        `• **Cliente:** ${cliente}`,
        `• **Usuário Roblox:** \`@${usuario}\``,
        `• **Quantidade solicitada:** ${quantidade} Robux`,
        `• **Robux a receber:** ${formatarRobux(recebido)} Robux`,
        `• **Modalidade:** ${nomeMetodo(ticket.modalidade)}`,
        `• **Pagamento escolhido:** ${nomePagamento(ticket.pagamento)}`
    ];

    if (gamepass !== null && gamepass !== undefined && Number.isFinite(Number(gamepass))) {
        informacoes.push(`• **Gamepass necessária:** ${formatarRobux(gamepass)} Robux`);
    }

    const status = [
        `**Status do pedido:** ${estado}`,
        'Aguarde o atendimento da nossa equipe. O pagamento ainda não foi confirmado.',
        '',
        '**Segurança:** Nunca envie senhas ou códigos de verificação.',
        'Aguarde as instruções da equipe antes de efetuar qualquer pagamento.'
    ];

    if (ticket.pagamento === 'mm') {
        status.push('', '**Intermediário solicitado:** A equipe organizará a intermediação. Não faça pagamentos antecipados.');
    }

    const container = new ContainerBuilder()
        .setAccentColor(COR_PRINCIPAL)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# Pedido ${pedidoId}\nAtendimento InovareSale`)
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(informacoes.join('\n'))
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(status.join('\n'))
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addActionRowComponents(criarBotoesTicket());

    return {
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] }
    };
}

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
module.exports = {
    criarPainelModalidades,
    criarPainelPagamento,
    criarPainelTicket,
    criarPainelPerfilRoblox,
    consultarPerfilRoblox,
    criarBotoesTicket,
    criarAvisoMM,
    formatarPedido,
    nomeMetodo,
    nomePagamento
};
