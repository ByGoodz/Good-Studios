'use strict';
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelType,
    PermissionFlagsBits,
    MessageFlags
} = require('discord.js');
const {
    db
} = require('../database/db');
const {
    getConfig
} = require('../utils/storage');
const {
    calcularPreco,
    calcularSemTaxa,
    calcularTaxado,
    formatarDinheiro,
    formatarRobux
} = require('../utils/calculator');
const {
    criarRegistroTicket,
    vincularCanalTicket,
    descartarTicketEmCriacao,
    assumirTicket,
    iniciarFinalizacao,
    confirmarFinalizacao,
    reverterFinalizacao,
    cancelarTicket,
    buscarTicketPorCanal,
    buscarTicket
} = require('../services/ticketService');
const {
    registrarVenda
} = require('../services/vendaService');
const {
    registrarLogSistema,
    TIPOS_LOG
} = require('../services/logsService');
const {
    criarPainelTicket,
    criarPainelPerfilRoblox,
    consultarPerfilRoblox
} = require('../panels/ticketPanel');
const TEMPO_RASCUNHO =
    30 * 60 * 1000;
const TEMPO_FECHAMENTO =
    7000;
const METODOS = Object.freeze({
    viaPlus: 'Via Plus',
    semTaxa: 'Robux Sem Taxa',
    taxado: 'Robux Taxado',
    viaGrupo: 'Robux Via Grupo'
});
const PAGAMENTOS = Object.freeze({
    pix: 'PIX',
    mm: 'Solicitar MM'
});
const TICKETS_EM_CRIACAO =
    new Set();
db.exec(`
    CREATE TABLE IF NOT EXISTS
        rascunhos_tickets (
            servidor_id TEXT NOT NULL,
            cliente_id TEXT NOT NULL,
            quantidade_robux INTEGER NOT NULL,
            modalidade TEXT,
            usuario_roblox TEXT,
            atualizado_em INTEGER NOT NULL,
            PRIMARY KEY (
                servidor_id,
                cliente_id
            )
        );
`);
class ErroTicket extends Error {
    constructor(mensagem) {
        super(mensagem);
        this.name = 'ErroTicket';
    }
}
async function responder(
    interaction,
    conteudo
) {
    const dados =
        typeof conteudo === 'string'
            ? { content: conteudo }
            : conteudo;
    const payload = {
        ...dados,
        allowedMentions: {
            parse: []
        }
    };
    if (interaction.deferred) {
        return interaction.editReply(
            payload
        );
    }
    if (interaction.replied) {
        return interaction.followUp({
            ...payload,
            flags:
                MessageFlags.Ephemeral
        });
    }
    return interaction.reply({
        ...payload,
        flags:
            MessageFlags.Ephemeral
    });
}
function numeroPedido(ticketId) {
    return (
        'INV-' +
        String(ticketId).padStart(4, '0')
    );
}
function interpretarQuantidade(valor) {
    const texto = String(
        valor ?? ''
    )
        .trim()
        .toLowerCase()
        .replace(/\s/g, '');
    let quantidade;
    if (
        /^\d+(?:[.,]\d+)?k$/.test(texto)
    ) {
        quantidade =
            Number(
                texto
                    .slice(0, -1)
                    .replace(',', '.')
            ) * 1000;
    } else if (
        /^\d{1,3}(?:\.\d{3})+$/.test(texto)
    ) {
        quantidade =
            Number(
                texto.replace(/\./g, '')
            );
    } else if (
        /^\d+$/.test(texto)
    ) {
        quantidade =
            Number(texto);
    } else {
        return null;
    }
    if (
        !Number.isSafeInteger(quantidade) ||
        quantidade < 1 ||
        quantidade > 50000000
    ) {
        return null;
    }
    return quantidade;
}
function interpretarValorPago(valor) {
    const texto = String(
        valor ?? ''
    )
        .replace(/R\$/gi, '')
        .replace(/\s/g, '')
        .trim();
    let normalizado;
    if (
        /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(
            texto
        )
    ) {
        normalizado = texto
            .replace(/\./g, '')
            .replace(',', '.');
    } else if (
        /^\d+(?:,\d{1,2})?$/.test(texto)
    ) {
        normalizado =
            texto.replace(',', '.');
    } else if (
        /^\d+\.\d{1,2}$/.test(texto)
    ) {
        normalizado = texto;
    } else {
        return null;
    }
    const centavos =
        Math.round(
            Number(normalizado) * 100
        );
    if (
        !Number.isSafeInteger(centavos) ||
        centavos <= 0
    ) {
        return null;
    }
    return centavos;
}
function obterRascunho(interaction) {
    const registro = db.prepare(`
        SELECT *
        FROM rascunhos_tickets
        WHERE servidor_id = ?
          AND cliente_id = ?
    `).get(
        interaction.guildId,
        interaction.user.id
    );
    if (!registro) {
        return null;
    }
    if (
        Date.now() -
        Number(registro.atualizado_em) >
        TEMPO_RASCUNHO
    ) {
        return null;
    }
    return registro;
}
function salvarRascunho(
    interaction,
    quantidade,
    modalidade = null,
    usuario = null
) {
    db.prepare(`
        INSERT INTO rascunhos_tickets (
            servidor_id,
            cliente_id,
            quantidade_robux,
            modalidade,
            usuario_roblox,
            atualizado_em
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(
            servidor_id,
            cliente_id
        )
        DO UPDATE SET
            quantidade_robux =
                excluded.quantidade_robux,
            modalidade =
                excluded.modalidade,
            usuario_roblox =
                excluded.usuario_roblox,
            atualizado_em =
                excluded.atualizado_em
    `).run(
        interaction.guildId,
        interaction.user.id,
        quantidade,
        modalidade,
        usuario,
        Date.now()
    );
}
function limparRascunho(interaction) {
    db.prepare(`
        DELETE FROM rascunhos_tickets
        WHERE servidor_id = ?
          AND cliente_id = ?
    `).run(
        interaction.guildId,
        interaction.user.id
    );
}
function metodoLiberado(
    config,
    metodo
) {
    if (!METODOS[metodo]) {
        return false;
    }
    if (
        config.tickets?.bloqueados?.[metodo]
    ) {
        return false;
    }
    if (
        metodo === 'viaGrupo' &&
        config.tickets?.bloqueados?.viaGrupo
            !== false
    ) {
        return false;
    }
    const precoK =
        Number(
            config.calculadora?.[metodo]
        );
    return (
        Number.isFinite(precoK) &&
        precoK > 0
    );
}
function calcularPedido(
    config,
    metodo,
    quantidade
) {
    if (!metodoLiberado(config, metodo)) {
        throw new ErroTicket(
            'Essa modalidade está indisponível.'
        );
    }
    const k =
        Number(
            config.calculadora[metodo]
        );
    let preco;
    let recebido = quantidade;
    let gamepass = null;
    if (metodo === 'semTaxa') {
        const resultado =
            calcularSemTaxa(
                quantidade,
                k
            );
        preco =
            resultado.preco;
        recebido =
            resultado.robuxRecebido;
        gamepass =
            resultado.robuxGamepass;
    } else if (
        metodo === 'taxado'
    ) {
        const resultado =
            calcularTaxado(
                quantidade,
                k
            );
        preco =
            resultado.preco;
        recebido =
            resultado.robuxRecebido;
        gamepass =
            resultado.robuxGamepass;
    } else {
        preco =
            calcularPreco(
                quantidade,
                k
            );
    }
    const centavos =
        Math.round(preco * 100);
    if (
        !Number.isSafeInteger(centavos) ||
        centavos <= 0
    ) {
        throw new ErroTicket(
            'Preço inválido. Verifique ' +
            'a configuração da calculadora.'
        );
    }
    return {
        centavos,
        recebido,
        gamepass
    };
}
function obterRobuxTicket(ticket) {
    const quantidade =
        Number(
            ticket.quantidade_robux
        );
    if (
        ticket.modalidade === 'semTaxa'
    ) {
        return {
            recebido:
                Math.floor(
                    quantidade * 0.7
                ),
            gamepass:
                quantidade
        };
    }
    if (
        ticket.modalidade === 'taxado'
    ) {
        return {
            recebido:
                quantidade,
            gamepass:
                Math.ceil(
                    quantidade * 10 / 7
                )
        };
    }
    return {
        recebido:
            quantidade,
        gamepass:
            null
    };
}
function podeAtender(
    interaction,
    config
) {
    if (
        interaction.memberPermissions?.has(
            PermissionFlagsBits.Administrator
        )
    ) {
        return true;
    }
    const cargoId =
        config.tickets?.cargoEquipeId ||
        config.staff?.cargoId;
    if (!cargoId) {
        return false;
    }
    const cargos =
        interaction.member?.roles;
    return Boolean(
        cargos?.cache?.has?.(
            cargoId
        ) ||
        (
            Array.isArray(cargos) &&
            cargos.includes(cargoId)
        )
    );
}
function montarModal(
    id,
    titulo,
    campos
) {
    const modal =
        new ModalBuilder()
            .setCustomId(id)
            .setTitle(titulo);
    for (const campo of campos) {
        const input =
            new TextInputBuilder()
                .setCustomId(
                    campo.id
                )
                .setLabel(
                    campo.label
                )
                .setStyle(
                    campo.paragrafo
                        ? TextInputStyle.Paragraph
                        : TextInputStyle.Short
                )
                .setRequired(true)
                .setMaxLength(
                    campo.max || 80
                );
        if (campo.placeholder) {
            input.setPlaceholder(
                campo.placeholder
            );
        }
        if (
            campo.valor !== null &&
            campo.valor !== undefined
        ) {
            input.setValue(
                String(campo.valor)
            );
        }
        modal.addComponents(
            new ActionRowBuilder()
                .addComponents(input)
        );
    }
    return modal;
}
function linhaMetodos(config) {
    const botoes =
        Object.entries(METODOS).map(
            ([metodo, nome]) => {
                const ativo =
                    metodoLiberado(
                        config,
                        metodo
                    );
                return new ButtonBuilder()
                    .setCustomId(
                        `ticket_metodo_${metodo}`
                    )
                    .setLabel(nome)
                    .setStyle(
                        ativo
                            ? ButtonStyle.Primary
                            : ButtonStyle.Secondary
                    )
                    .setDisabled(!ativo);
            }
        );
    return new ActionRowBuilder()
        .addComponents(botoes);
}
async function registrarLogTicket({
    guild,
    ticket,
    tipo,
    titulo,
    detalhes,
    autorId = null,
    chave
}) {
    try {
        await registrarLogSistema({
            guild,
            tipo:
                TIPOS_LOG?.[tipo] ||
                tipo.toLowerCase(),
            titulo,
            detalhes,
            autorId,
            alvoId:
                ticket.cliente_id,
            referencia:
                numeroPedido(ticket.id),
            chaveEvento:
                `ticket_${ticket.id}_${chave}`
        });
    } catch (erro) {
        console.error(
            '[InovareSale | Ticket] ' +
            'Falha ao registrar log:',
            erro
        );
    }
}
async function obterDestinoTicket(
    guild,
    metodo,
    config
) {
    const categoriaId =
        config.tickets?.categorias?.[metodo];
    const equipeId =
        config.tickets?.cargoEquipeId;
    if (
        !categoriaId ||
        !equipeId
    ) {
        throw new ErroTicket(
            'Configure a categoria e o cargo ' +
            'da equipe no /setup.'
        );
    }
    const [
        categoria,
        equipe
    ] = await Promise.all([
        guild.channels.fetch(
            categoriaId
        ),
        guild.roles.fetch(
            equipeId
        )
    ]);
    if (
        categoria?.type !==
        ChannelType.GuildCategory
    ) {
        throw new ErroTicket(
            'A categoria configurada ' +
            'não é válida.'
        );
    }
    if (!equipe) {
        throw new ErroTicket(
            'O cargo de atendimento ' +
            'não foi encontrado.'
        );
    }
    return {
        categoriaId,
        equipeId
    };
}
async function criarTicket(
    interaction,
    rascunho
) {
    const guild =
        interaction.guild;
    const config =
        getConfig();
    const metodo =
        rascunho.modalidade;
    if (
        !metodoLiberado(
            config,
            metodo
        )
    ) {
        throw new ErroTicket(
            'Essa modalidade está indisponível.'
        );
    }
    const destino =
        await obterDestinoTicket(
            guild,
            metodo,
            config
        );
    const quote =
        calcularPedido(
            config,
            metodo,
            rascunho.quantidade_robux
        );
    const ticket =
        criarRegistroTicket({
            servidorId:
                guild.id,
            clienteId:
                interaction.user.id,
            modalidade:
                metodo,
            quantidadeRobux:
                rascunho.quantidade_robux,
            precoCentavos:
                quote.centavos,
            usuarioRoblox:
                rascunho.usuario_roblox,
            pagamento:
                rascunho.pagamento
        });
    let canal = null;
    try {
        canal =
            await guild.channels.create({
                name:
                    `${rascunho.quantidade_robux}x-robux`,
                type:
                    ChannelType.GuildText,
                parent:
                    destino.categoriaId,
                topic:
                    `Pedido ${
                        numeroPedido(
                            ticket.id
                        )
                    } | Cliente ${
                        interaction.user.id
                    }`,
                permissionOverwrites: [
                    {
                        id:
                            guild.roles.everyone.id,
                        deny: [
                            PermissionFlagsBits.ViewChannel
                        ]
                    },
                    {
                        id:
                            interaction.user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.AttachFiles
                        ]
                    },
                    {
                        id:
                            destino.equipeId,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory
                        ]
                    },
                    {
                        id:
                            interaction.client.user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.EmbedLinks,
                            PermissionFlagsBits.ManageChannels
                        ]
                    }
                ]
            });
        const vinculado =
            vincularCanalTicket(
                ticket.id,
                canal.id
            );
        const perfilRoblox = await consultarPerfilRoblox(
            rascunho.usuario_roblox
        );
        await canal.send(criarPainelPerfilRoblox(perfilRoblox));
        await canal.send(criarPainelTicket(
            vinculado,
            rascunho.usuario_roblox,
            quote
        ));
        limparRascunho(
            interaction
        );
        await registrarLogTicket({
            guild,
            ticket: vinculado,
            tipo:
                'TICKET_CRIADO',
            titulo:
                'Novo ticket de compra',
            detalhes:
                `Pedido: ${
                    numeroPedido(ticket.id)
                }\n` +
                `Cliente: <@${ticket.cliente_id}>\n` +
                `Modalidade: ${
                    METODOS[ticket.modalidade]
                }\n` +
                `Quantidade: ${
                    formatarRobux(
                        ticket.quantidade_robux
                    )
                } Robux`,
            autorId:
                interaction.user.id,
            chave:
                'criado'
        });
        return canal;
    } catch (erro) {
        if (!canal) {
            try {
                descartarTicketEmCriacao(
                    ticket.id,
                    'Falha ao criar o canal'
                );
            } catch (erroBanco) {
                console.error(
                    '[InovareSale | Ticket] ' +
                    'Falha ao cancelar ticket em criação:',
                    erroBanco
                );
            }
        } else {
            console.error(
                '[InovareSale | Ticket] ' +
                'Canal criado, mas ocorreu ' +
                'falha na preparação do ticket:',
                {
                    ticketId: ticket.id,
                    canalId: canal.id,
                    erro
                }
            );
        }
        throw erro;
    }
}
function ticketDesteCanal(
    interaction
) {
    return buscarTicketPorCanal(
        interaction.channelId
    );
}
function fecharCanal(
    canal
) {
    if (!canal?.id) {
        return;
    }
    const timer = setTimeout(
        async () => {
            try {
                const ticket =
                    db.prepare(`
                        SELECT *
                        FROM tickets
                        WHERE canal_id = ?
                    `).get(canal.id);
                if (
                    !ticket ||
                    ![
                        'finalizado',
                        'cancelado'
                    ].includes(
                        ticket.status
                    )
                ) {
                    return;
                }
                if (
                    canal.deletable
                ) {
                    await canal.delete(
                        'Pedido encerrado pela InovareSale'
                    );
                }
            } catch (erro) {
                console.error(
                    '[InovareSale | Ticket] ' +
                    'Erro ao fechar canal:',
                    erro
                );
            }
        },
        TEMPO_FECHAMENTO
    );
    timer.unref?.();
}
function buscarVendaTicket(
    ticketId
) {
    return db.prepare(`
        SELECT *
        FROM vendas_tickets
        WHERE ticket_id = ?
        LIMIT 1
    `).get(ticketId) || null;
}
async function finalizarVendaTicket(
    interaction,
    ticket,
    centavos
) {
    const iniciou =
        iniciarFinalizacao(
            ticket.id,
            interaction.user.id
        );
    if (!iniciou) {
        throw new ErroTicket(
            'O pedido já está sendo finalizado ' +
            'ou não está mais aberto.'
        );
    }
    let resultadoVenda = null;
    try {
        const robux =
            obterRobuxTicket(
                ticket
            ).recebido;
        resultadoVenda =
            await registrarVenda({
                guild:
                    interaction.guild,
                clienteId:
                    ticket.cliente_id,
                valor:
                    centavos / 100,
                robux,
                registradoPorId:
                    interaction.user.id,
                modalidade:
                    ticket.modalidade,
                usuarioRoblox:
                    ticket.usuario_roblox,
                pagamento:
                    ticket.pagamento,
                origem:
                    'ticket',
                ticketId:
                    ticket.id
            });
    } catch (erro) {
        let vendaRegistrada;
        try {
            vendaRegistrada =
                buscarVendaTicket(
                    ticket.id
                );
        } catch (erroConsulta) {
            console.error(
                '[InovareSale | Ticket] ' +
                'Falha ao verificar venda:',
                erroConsulta
            );
            throw new ErroTicket(
                'Não foi possível confirmar o ' +
                'registro da venda. O pedido ' +
                'permanece em finalização para ' +
                'verificação da administração.'
            );
        }
        if (vendaRegistrada) {
            try {
                confirmarFinalizacao(
                    ticket.id,
                    interaction.user.id,
                    vendaRegistrada.valor_centavos
                );
            } catch (erroConfirmacao) {
                console.error(
                    '[InovareSale | Ticket] ' +
                    'Venda salva, mas falhou a confirmação:',
                    erroConfirmacao
                );
                throw new ErroTicket(
                    'A venda já está salva no SQLite, ' +
                    'mas o encerramento do ticket ' +
                    'precisa de verificação da equipe. ' +
                    'Não registre a venda novamente.'
                );
            }
            return {
                recuperada: true,
                resultadoVenda: null
            };
        }
        reverterFinalizacao(
            ticket.id
        );
        console.error(
            '[InovareSale | Ticket] ' +
            'Falha antes do registro da venda:',
            erro
        );
        throw new ErroTicket(
            'A venda não foi registrada. ' +
            'O pedido voltou para aberto. ' +
            'Confira o atendimento antes ' +
            'de tentar novamente.'
        );
    }
    try {
        confirmarFinalizacao(
            ticket.id,
            interaction.user.id,
            centavos
        );
    } catch (erro) {
        console.error(
            '[InovareSale | Ticket] ' +
            'Venda salva, mas ticket não finalizado:',
            erro
        );
        throw new ErroTicket(
            'A venda foi salva no SQLite, mas ' +
            'o status do ticket precisa de ' +
            'verificação da administração. ' +
            'Não finalize uma segunda vez.'
        );
    }
    return {
        recuperada: false,
        resultadoVenda
    };
}
async function aposFinalizar(
    interaction,
    ticket
) {
    const finalizado =
        buscarTicket(
            ticket.id
        );
    if (
        finalizado?.status !== 'finalizado'
    ) {
        return;
    }
    await registrarLogTicket({
        guild:
            interaction.guild,
        ticket:
            finalizado,
        tipo:
            'VENDA_FINALIZADA',
        titulo:
            'Venda de ticket finalizada',
        detalhes:
            `Pedido: ${
                numeroPedido(finalizado.id)
            }\n` +
            `Cliente: <@${finalizado.cliente_id}>\n` +
            `Modalidade: ${
                METODOS[finalizado.modalidade]
            }\n` +
            `Quantidade solicitada: ${
                formatarRobux(
                    finalizado.quantidade_robux
                )
            } Robux`,
        autorId:
            interaction.user.id,
        chave:
            'venda_finalizada'
    });
    await interaction.channel.send({
        content:
            '✅ **Compra concluída!**\n' +
            'Obrigado por comprar na InovareSale! 💜',
        allowedMentions: {
            parse: []
        }
    }).catch(erro => {
        console.warn(
            '[InovareSale | Ticket] ' +
            'Não foi possível enviar mensagem final:',
            erro.message
        );
    });
    try {
        const {
            solicitarAvaliacao
        } = require('./avaliacaoHandler');
        await solicitarAvaliacao(
            interaction.client,
            finalizado
        );
    } catch (erro) {
        console.warn(
            '[InovareSale | Ticket] ' +
            'Não foi possível solicitar avaliação:',
            erro.message
        );
    }
    fecharCanal(
        interaction.channel
    );
}
async function executarAssumir(
    interaction,
    ticket
) {
    const atualizado =
        assumirTicket(
            ticket.id,
            interaction.user.id
        );
    await responder(
        interaction,
        `✅ Atendimento do pedido ${
            numeroPedido(ticket.id)
        } assumido.`
    );
    await interaction.channel.send({
        content:
            `🎧 Atendimento assumido por ` +
            `<@${interaction.user.id}>.`,
        allowedMentions: {
            parse: []
        }
    }).catch(() => {});
    await registrarLogTicket({
        guild:
            interaction.guild,
        ticket:
            atualizado,
        tipo:
            'TICKET_ASSUMIDO',
        titulo:
            'Atendimento assumido',
        detalhes:
            `Pedido: ${
                numeroPedido(ticket.id)
            }\n` +
            `Funcionário: <@${interaction.user.id}>`,
        autorId:
            interaction.user.id,
        chave:
            `assumido_${interaction.user.id}`
    });
}
async function executarCancelar(
    interaction,
    ticket
) {
    const cancelado =
        cancelarTicket(
            ticket.id,
            interaction.user.id
        );
    await responder(
        interaction,
        '❌ Pedido cancelado. ' +
        'Nenhuma venda será criada pelo cancelamento.'
    );
    await registrarLogTicket({
        guild:
            interaction.guild,
        ticket:
            cancelado,
        tipo:
            'TICKET_CANCELADO',
        titulo:
            'Ticket cancelado',
        detalhes:
            `Pedido: ${
                numeroPedido(ticket.id)
            }\n` +
            `Cliente: <@${ticket.cliente_id}>\n` +
            `Cancelado por: <@${interaction.user.id}>`,
        autorId:
            interaction.user.id,
        chave:
            'cancelado'
    });
    await interaction.channel.send({
        content:
            '❌ **Pedido cancelado.**\n' +
            'Este canal será fechado em alguns segundos.',
        allowedMentions: {
            parse: []
        }
    }).catch(() => {});
    fecharCanal(
        interaction.channel
    );
}
async function abrirModalFinalizacao(
    interaction,
    ticket
) {
    const precoSugerido =
        (
            Number(
                ticket.preco_centavos
            ) / 100
        )
            .toFixed(2)
            .replace('.', ',');
    await interaction.showModal(
        montarModal(
            `ticket_concluir_${ticket.id}`,
            'Finalizar venda',
            [
                {
                    id:
                        'valor_pago',
                    label:
                        'Valor realmente pago (R$)',
                    valor:
                        precoSugerido,
                    placeholder:
                        'Exemplo: 210,00',
                    max: 30
                }
            ]
        )
    );
}
async function concluirPedido(
    interaction,
    ticketId
) {
    const ticket =
        ticketDesteCanal(
            interaction
        );
    if (
        !ticket ||
        ticket.id !== ticketId
    ) {
        throw new ErroTicket(
            'Este formulário não pertence ' +
            'ao ticket atual.'
        );
    }
    if (
        !podeAtender(
            interaction,
            getConfig()
        )
    ) {
        throw new ErroTicket(
            'Apenas a equipe pode ' +
            'finalizar pedidos.'
        );
    }
    const centavos =
        interpretarValorPago(
            interaction.fields.getTextInputValue(
                'valor_pago'
            )
        );
    if (!centavos) {
        throw new ErroTicket(
            'Informe um valor válido, ' +
            'como 210,00.'
        );
    }
    await interaction.deferReply({
        flags:
            MessageFlags.Ephemeral
    });
    const atual =
        buscarTicket(
            ticket.id
        );
    if (
        atual.status === 'finalizado'
    ) {
        await responder(
            interaction,
            '✅ Este pedido já foi finalizado.'
        );
        return;
    }
    if (
        atual.status === 'cancelado'
    ) {
        throw new ErroTicket(
            'Este pedido foi cancelado ' +
            'e não pode ser finalizado.'
        );
    }
    if (
        atual.status === 'finalizando'
    ) {
        const venda =
            buscarVendaTicket(
                ticket.id
            );
        if (venda) {
            throw new ErroTicket(
                'A venda já está registrada, ' +
                'mas o ticket aguarda recuperação ' +
                'administrativa. Não registre ' +
                'outra venda.'
            );
        }
        throw new ErroTicket(
            'O ticket já está em finalização. ' +
            'Aguarde ou solicite uma verificação.'
        );
    }
    const resultado =
        await finalizarVendaTicket(
            interaction,
            atual,
            centavos
        );
    await responder(
        interaction,
        resultado.recuperada
            ? '✅ A venda existente foi ' +
              'recuperada e o ticket finalizado.'
            : '✅ Venda registrada e ticket finalizado!'
    );
    try {
        await aposFinalizar(
            interaction,
            atual
        );
    } catch (erro) {
        console.error(
            '[InovareSale | Ticket] ' +
            'Falha após finalizar venda:',
            erro
        );
        fecharCanal(
            interaction.channel
        );
    }
}
async function handleTicketInteraction(
    interaction
) {
    const id =
        interaction.customId || '';
    if (
        !id.startsWith(
            'ticket_'
        )
    ) {
        return false;
    }
    if (
        !interaction.inGuild()
    ) {
        await responder(
            interaction,
            '❌ Abra os pedidos dentro do servidor.'
        );
        return true;
    }
    try {
        if (
            interaction.isButton() &&
            id === 'ticket_abrir'
        ) {
            await interaction.showModal(
                montarModal(
                    'ticket_quantidade',
                    'Comprar Robux',
                    [
                        {
                            id:
                                'quantidade',
                            label:
                                'Quantos Robux deseja comprar?',
                            placeholder:
                                'Exemplo: 5000 ou 5k',
                            max: 30
                        }
                    ]
                )
            );
            return true;
        }
        if (
            interaction.isModalSubmit() &&
            id === 'ticket_quantidade'
        ) {
            const quantidade =
                interpretarQuantidade(
                    interaction.fields.getTextInputValue(
                        'quantidade'
                    )
                );
            if (!quantidade) {
                throw new ErroTicket(
                    'Quantidade inválida. ' +
                    'Use 5000 ou 5k.'
                );
            }
            salvarRascunho(
                interaction,
                quantidade
            );
            await responder(
                interaction,
                {
                    content:
                        `💎 **${
                            formatarRobux(
                                quantidade
                            )
                        } Robux**\n` +
                        'Escolha a modalidade desejada:',
                    components: [
                        linhaMetodos(
                            getConfig()
                        )
                    ]
                }
            );
            return true;
        }
        if (
            interaction.isButton() &&
            id.startsWith(
                'ticket_metodo_'
            )
        ) {
            const metodo =
                id.slice(
                    'ticket_metodo_'.length
                );
            const rascunho =
                obterRascunho(
                    interaction
                );
            if (!rascunho) {
                throw new ErroTicket(
                    'Sua solicitação expirou. ' +
                    'Clique em Comprar novamente.'
                );
            }
            if (
                !metodoLiberado(
                    getConfig(),
                    metodo
                )
            ) {
                throw new ErroTicket(
                    'Essa modalidade está bloqueada.'
                );
            }
            salvarRascunho(
                interaction,
                rascunho.quantidade_robux,
                metodo
            );
            await interaction.showModal(
                montarModal(
                    'ticket_usuario',
                    'Usuário do Roblox',
                    [
                        {
                            id:
                                'usuario',
                            label:
                                'Seu username do Roblox',
                            placeholder:
                                'Nunca informe sua senha',
                            max: 20
                        }
                    ]
                )
            );
            return true;
        }
        if (
            interaction.isModalSubmit() &&
            id === 'ticket_usuario'
        ) {
            const rascunho =
                obterRascunho(
                    interaction
                );
            if (
                !rascunho?.modalidade
            ) {
                throw new ErroTicket(
                    'Pedido expirado. Comece novamente.'
                );
            }
            const usuario =
                interaction.fields.getTextInputValue(
                    'usuario'
                ).trim();
            if (
                !/^[A-Za-z0-9_]{3,20}$/.test(
                    usuario
                )
            ) {
                throw new ErroTicket(
                    'Digite um username Roblox válido ' +
                    'de 3 a 20 caracteres.'
                );
            }
            salvarRascunho(
                interaction,
                rascunho.quantidade_robux,
                rascunho.modalidade,
                usuario
            );
            const quote =
                calcularPedido(
                    getConfig(),
                    rascunho.modalidade,
                    rascunho.quantidade_robux
                );
            const botoes =
                new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(
                                'ticket_pagamento_pix'
                            )
                            .setLabel('PIX')
                            .setStyle(
                                ButtonStyle.Success
                            ),
                        new ButtonBuilder()
                            .setCustomId(
                                'ticket_pagamento_mm'
                            )
                            .setLabel('Solicitar MM')
                            .setStyle(
                                ButtonStyle.Secondary
                            )
                    );
            await responder(
                interaction,
                {
                    content:
                        `🛒 **${
                            METODOS[
                                rascunho.modalidade
                            ]
                        }**\n` +
                        `💎 ${
                            formatarRobux(
                                rascunho.quantidade_robux
                            )
                        } Robux\n` +
                        `💰 **Preço estimado:** ${
                            formatarDinheiro(
                                quote.centavos / 100
                            )
                        }\n\n` +
                        'Escolha como deseja pagar ' +
                        'para abrir seu ticket:',
                    components: [
                        botoes
                    ]
                }
            );
            return true;
        }
        if (
            interaction.isButton() &&
            /^ticket_pagamento_(pix|mm)$/.test(
                id
            )
        ) {
            await interaction.deferReply({
                flags:
                    MessageFlags.Ephemeral
            });
            const rascunho =
                obterRascunho(
                    interaction
                );
            if (
                !rascunho?.modalidade ||
                !rascunho?.usuario_roblox
            ) {
                throw new ErroTicket(
                    'Solicitação expirada. ' +
                    'Comece novamente.'
                );
            }
            const chave =
                `${interaction.guildId}:` +
                interaction.user.id;
            if (
                TICKETS_EM_CRIACAO.has(
                    chave
                )
            ) {
                await responder(
                    interaction,
                    '⏳ Seu ticket já está ' +
                    'sendo criado. Aguarde.'
                );
                return true;
            }
            TICKETS_EM_CRIACAO.add(
                chave
            );
            try {
                const canal =
                    await criarTicket(
                        interaction,
                        {
                            ...rascunho,
                            pagamento:
                                id.endsWith('_pix')
                                    ? 'pix'
                                    : 'mm'
                        }
                    );
                await responder(
                    interaction,
                    `✅ Seu ticket foi criado: ` +
                    `<#${canal.id}>`
                );
            } finally {
                TICKETS_EM_CRIACAO.delete(
                    chave
                );
            }
            return true;
        }
        if (
            interaction.isButton() &&
            [
                'ticket_assumir',
                'ticket_finalizar',
                'ticket_cancelar'
            ].includes(id)
        ) {
            const ticket =
                ticketDesteCanal(
                    interaction
                );
            if (!ticket) {
                throw new ErroTicket(
                    'Este canal não está ' +
                    'vinculado a um ticket.'
                );
            }
            if (
                !podeAtender(
                    interaction,
                    getConfig()
                )
            ) {
                throw new ErroTicket(
                    'Apenas a equipe de atendimento ' +
                    'pode utilizar este botão.'
                );
            }
            if (
                ![
                    'aberto',
                    'em_atendimento'
                ].includes(
                    ticket.status
                )
            ) {
                throw new ErroTicket(
                    'Este ticket não está mais aberto.'
                );
            }
            if (
                id === 'ticket_assumir'
            ) {
                await interaction.deferReply({
                    flags:
                        MessageFlags.Ephemeral
                });
                await executarAssumir(
                    interaction,
                    ticket
                );
                return true;
            }
            if (
                id === 'ticket_cancelar'
            ) {
                await interaction.deferReply({
                    flags:
                        MessageFlags.Ephemeral
                });
                await executarCancelar(
                    interaction,
                    ticket
                );
                return true;
            }
            await abrirModalFinalizacao(
                interaction,
                ticket
            );
            return true;
        }
        if (
            interaction.isModalSubmit() &&
            id.startsWith(
                'ticket_concluir_'
            )
        ) {
            const ticketId =
                Number(
                    id.slice(
                        'ticket_concluir_'.length
                    )
                );
            if (
                !Number.isSafeInteger(ticketId) ||
                ticketId <= 0
            ) {
                throw new ErroTicket(
                    'Número do ticket inválido.'
                );
            }
            await concluirPedido(
                interaction,
                ticketId
            );
            return true;
        }
        return false;
    } catch (erro) {
        console.error(
            '[InovareSale | Ticket] Erro:',
            erro
        );
        const mensagem =
            erro instanceof ErroTicket
                ? `❌ ${erro.message}`
                : (
                    '❌ Não foi possível concluir ' +
                    'esta ação. Avise a equipe ' +
                    'se o problema continuar.'
                );
        try {
            await responder(
                interaction,
                mensagem
            );
        } catch (erroResposta) {
            console.error(
                '[InovareSale | Ticket] ' +
                'Falha ao responder interação:',
                erroResposta
            );
        }
        return true;
    }
}
module.exports = {
    handleTicketInteraction,
    interpretarQuantidade,
    calcularPedido
};
