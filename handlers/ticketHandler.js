const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    EmbedBuilder, ChannelType, PermissionFlagsBits,
    MessageFlags, AttachmentBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const { db, registrarLog } = require('../database/db');
const { getConfig } = require('../utils/storage');
const {
    calcularPreco, calcularSemTaxa, calcularTaxado,
    formatarDinheiro, formatarRobux
} = require('../utils/calculator');

const METODOS = {
    viaPlus: 'Via Plus',
    semTaxa: 'Robux Sem Taxa',
    taxado: 'Robux Taxado',
    viaGrupo: 'Robux Via Grupo'
};

// Mantém a compra em andamento mesmo se o bot reiniciar.
db.exec(`
    CREATE TABLE IF NOT EXISTS rascunhos_tickets (
        servidor_id TEXT NOT NULL,
        cliente_id TEXT NOT NULL,
        quantidade_robux INTEGER NOT NULL,
        modalidade TEXT,
        usuario_roblox TEXT,
        atualizado_em INTEGER NOT NULL,
        PRIMARY KEY (servidor_id, cliente_id)
    );
`);

const TEMPO_RASCUNHO = 30 * 60 * 1000;
const criando = new Set();

function responder(interaction, content) {
    if (interaction.deferred || interaction.replied) {
        return interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

function interpretarQuantidade(texto) {
    const s = String(texto || '').trim().toLowerCase().replace(/\s/g, '');
    let numero;
    if (/^\d+(?:[.,]\d+)?k$/.test(s)) {
        numero = Number(s.slice(0, -1).replace(',', '.')) * 1000;
    } else if (/^\d{1,3}(?:\.\d{3})+$/.test(s)) {
        numero = Number(s.replace(/\./g, ''));
    } else if (/^\d+$/.test(s)) {
        numero = Number(s);
    } else {
        return null;
    }
    return Number.isSafeInteger(numero) && numero >= 1 && numero <= 50000000
        ? numero : null;
}

function formatarReaisCentavos(centavos) {
    return formatarDinheiro(centavos / 100);
}

function interpretarValorPago(texto) {
    const limpo = String(texto || '')
        .replace(/R\$/gi, '').replace(/\s/g, '')
        .replace(/\./g, '').replace(',', '.');
    if (!/^\d+(?:\.\d{1,2})?$/.test(limpo)) return null;
    const centavos = Math.round(Number(limpo) * 100);
    return Number.isSafeInteger(centavos) && centavos > 0 ? centavos : null;
}

function obterRascunho(interaction) {
    const r = db.prepare(`
        SELECT * FROM rascunhos_tickets
        WHERE servidor_id = ? AND cliente_id = ?
    `).get(interaction.guildId, interaction.user.id);
    if (!r || Date.now() - r.atualizado_em > TEMPO_RASCUNHO) return null;
    return r;
}

function salvarRascunho(interaction, quantidade, modalidade = null, usuario = null) {
    db.prepare(`
        INSERT INTO rascunhos_tickets
          (servidor_id, cliente_id, quantidade_robux, modalidade, usuario_roblox, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(servidor_id, cliente_id) DO UPDATE SET
          quantidade_robux = excluded.quantidade_robux,
          modalidade = excluded.modalidade,
          usuario_roblox = excluded.usuario_roblox,
          atualizado_em = excluded.atualizado_em
    `).run(interaction.guildId, interaction.user.id,
        quantidade, modalidade, usuario, Date.now());
}

function metodoLiberado(config, metodo) {
    return Boolean(
        METODOS[metodo] &&
        !config.tickets?.bloqueados?.[metodo] &&
        Number(config.calculadora?.[metodo]) > 0
    );
}

function calcularPedido(config, metodo, quantidade) {
    const k = Number(config.calculadora?.[metodo]);
    let preco;
    let recebido = quantidade;
    let gamepass = null;

    if (metodo === 'semTaxa') {
        const r = calcularSemTaxa(quantidade, k);
        preco = r.preco;
        recebido = r.robuxRecebido;
        gamepass = r.robuxGamepass;
    } else if (metodo === 'taxado') {
        const r = calcularTaxado(quantidade, k);
        preco = r.preco;
        recebido = r.robuxRecebido;
        gamepass = r.robuxGamepass;
    } else {
        preco = calcularPreco(quantidade, k);
    }

    const centavos = Math.round(preco * 100);
    if (!Number.isSafeInteger(centavos) || centavos <= 0) {
        throw new Error('Preço inválido. Verifique o valor K.');
    }
    return { centavos, recebido, gamepass };
}

function podeAtender(interaction, config) {
    if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return true;
    }
    const cargoId = config.tickets?.cargoEquipeId;
    const roles = interaction.member?.roles;
    return Boolean(cargoId && (
        roles?.cache?.has?.(cargoId) ||
        (Array.isArray(roles) && roles.includes(cargoId))
    ));
}

function montarModal(id, titulo, campos) {
    const modal = new ModalBuilder().setCustomId(id).setTitle(titulo);
    for (const campo of campos) {
        const input = new TextInputBuilder()
            .setCustomId(campo.id)
            .setLabel(campo.label)
            .setStyle(campo.paragrafo ? TextInputStyle.Paragraph : TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(campo.max || 80);
        if (campo.placeholder) input.setPlaceholder(campo.placeholder);
        if (campo.valor) input.setValue(campo.valor);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
    }
    return modal;
}

function linhaMetodos(config) {
    return new ActionRowBuilder().addComponents(
        ...Object.entries(METODOS).map(([chave, nome]) => {
            const ativo = metodoLiberado(config, chave);
            return new ButtonBuilder()
                .setCustomId(`ticket_metodo_${chave}`)
                .setLabel(nome)
                .setStyle(ativo ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(!ativo);
        })
    );
}

function painelTicket(ticket, usuario, quote) {
    const pedidoId = `INV-${String(ticket.id).padStart(4, '0')}`;
    const modalidade = METODOS[ticket.modalidade] || 'Nao informada';
    const pagamento = ticket.pagamento === 'pix' ? 'PIX' : 'Solicitar MM';
    const username = String(usuario || 'Nao informado')
        .replace(/[`\r\n]/g, '')
        .slice(0, 30);

    const embed = new EmbedBuilder()
        .setColor(0xC0C0C0)
        .setTitle(`InovareSale | Pedido ${pedidoId}`)
        .setDescription(
            'Seu pedido foi criado. Confira os dados abaixo e aguarde a equipe.\n\n' +
            `**Cliente:** <@${ticket.cliente_id}>\n` +
            `**Usuario Roblox:** \`${username}\`\n` +
            `**Quantidade solicitada:** ${formatarRobux(ticket.quantidade_robux)} Robux\n` +
            `**Modalidade:** ${modalidade}\n` +
            `**Valor estimado:** ${formatarReaisCentavos(ticket.preco_centavos)}\n` +
            `**Pagamento:** ${pagamento}\n` +
            `**Robux a receber:** ${formatarRobux(quote.recebido)}` +
            (quote.gamepass == null ? '' :
                `\n**Gamepass necessaria:** ${formatarRobux(quote.gamepass)} Robux`) +
            '\n\n**Status:** Aguardando atendimento.\n' +
            'Nunca compartilhe senhas nem pague sem confirmacao da equipe.'
        )
        .setFooter({ text: `InovareSale • ${pedidoId}` })
        .setTimestamp();

    const botoes = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ticket_assumir')
            .setLabel('Assumir atendimento')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('ticket_finalizar')
            .setLabel('Finalizar venda')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('ticket_cancelar')
            .setLabel('Cancelar')
            .setStyle(ButtonStyle.Danger)
    );

    const resposta = {
        embeds: [embed],
        components: [botoes],
        allowedMentions: { parse: [] }
    };

    // Usar o PNG original que ja esta em assets/banner.png.
    const caminhoBanner = path.join(__dirname, '..', 'assets', 'banner.png');
    const assinaturaPNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    if (!fs.existsSync(caminhoBanner)) {
        console.error('[InovareSale] Nao encontrei assets/banner.png.');
        return resposta;
    }

    try {
        const dados = fs.readFileSync(caminhoBanner);
        if (dados.length < 100 || !dados.subarray(0, 8).equals(assinaturaPNG)) {
            throw new Error('assets/banner.png nao e um PNG valido.');
        }
        embed.setImage('attachment://banner.png');
        resposta.files = [new AttachmentBuilder(dados, { name: 'banner.png' })];
    } catch (erro) {
        console.error('[InovareSale] Falha ao carregar banner do ticket:', erro);
    }

    return resposta;
}

async function criarTicket(interaction, rascunho) {
    const config = getConfig();
    const metodo = rascunho.modalidade;
    if (!metodoLiberado(config, metodo)) {
        throw new Error('Essa modalidade está indisponível no momento.');
    }

    const categoriaId = config.tickets?.categorias?.[metodo];
    const cargoEquipeId = config.tickets?.cargoEquipeId;
    if (!categoriaId || !cargoEquipeId) {
        throw new Error('A equipe ainda não configurou a categoria ou o cargo de atendimento.');
    }

    const categoria = await interaction.guild.channels.fetch(categoriaId);
    const equipe = await interaction.guild.roles.fetch(cargoEquipeId);
    if (categoria?.type !== ChannelType.GuildCategory || !equipe) {
        throw new Error('Categoria ou cargo de equipe inválido no /setup.');
    }

    const existente = db.prepare(`
        SELECT * FROM tickets
        WHERE servidor_id = ? AND cliente_id = ?
          AND status IN ('criando', 'aberto', 'em_atendimento', 'finalizando')
        ORDER BY id DESC LIMIT 1
    `).get(interaction.guildId, interaction.user.id);
    if (existente) {
        throw new Error(existente.canal_id
            ? `Você já tem um pedido aberto: <#${existente.canal_id}>`
            : 'Seu pedido anterior ainda está sendo criado. Aguarde.');
    }

    const quote = calcularPedido(config, metodo, rascunho.quantidade_robux);
    const inserido = db.prepare(`
        INSERT INTO tickets
          (servidor_id, cliente_id, modalidade, quantidade_robux,
           preco_centavos, usuario_roblox, pagamento, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'criando')
    `).run(interaction.guildId, interaction.user.id, metodo,
        rascunho.quantidade_robux, quote.centavos,
        rascunho.usuario_roblox, rascunho.pagamento);
    const ticketId = Number(inserido.lastInsertRowid);

    let canal;
    try {
        canal = await interaction.guild.channels.create({
            name: `🟢・${rascunho.quantidade_robux}x-robux`,
            type: ChannelType.GuildText,
            parent: categoriaId,
            topic: `Pedido INV-${ticketId} | Cliente ${interaction.user.id} | ${METODOS[metodo]}`,
            permissionOverwrites: [
                { id: interaction.guild.roles.everyone.id,
                    deny: [PermissionFlagsBits.ViewChannel] },
                { id: interaction.user.id,
                    allow: [PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.AttachFiles] },
                { id: cargoEquipeId,
                    allow: [PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory] },
                { id: interaction.client.user.id,
                    allow: [PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.EmbedLinks,
                        PermissionFlagsBits.ManageChannels] }
            ]
        });

        db.prepare(`
            UPDATE tickets SET canal_id = ?, status = 'aberto',
              atualizado_em = CURRENT_TIMESTAMP WHERE id = ?
        `).run(canal.id, ticketId);

        registrarLog(ticketId, interaction.user.id, 'abertura',
            `Modalidade: ${metodo}; pagamento: ${rascunho.pagamento}`);

        await canal.send(painelTicket({
            id: ticketId, cliente_id: interaction.user.id,
            quantidade_robux: rascunho.quantidade_robux,
            modalidade: metodo, preco_centavos: quote.centavos,
            pagamento: rascunho.pagamento
        }, rascunho.usuario_roblox, quote));

        if (rascunho.pagamento === 'mm') {
            await canal.send({
                content: '🤝 **Solicitação de MM:** aguarde a equipe organizar a intermediação. Não faça pagamentos antecipados.',
                allowedMentions: { parse: [] }
            });
        }

        db.prepare(`
            DELETE FROM rascunhos_tickets WHERE servidor_id = ? AND cliente_id = ?
        `).run(interaction.guildId, interaction.user.id);
        return canal;
    } catch (erro) {
        // Se o canal já foi criado, preservá-lo para recuperação manual.
        if (!canal) {
            db.prepare(`DELETE FROM tickets WHERE id = ? AND status = 'criando'`).run(ticketId);
        }
        throw erro;
    }
}

function ticketDesteCanal(interaction) {
    return db.prepare(`SELECT * FROM tickets WHERE canal_id = ?`)
        .get(interaction.channelId) || null;
}

async function fecharCanal(interaction) {
    const canal = interaction.channel;
    setTimeout(() => {
        canal.delete('Pedido encerrado pela equipe InovareSale')
            .catch(erro => console.error('Erro ao excluir ticket:', erro));
    }, 7000);
}

async function handleTicketInteraction(interaction) {
    const id = interaction.customId || '';
    if (!id.startsWith('ticket_')) return false;

    if (!interaction.inGuild()) {
        await responder(interaction, '❌ Abra os pedidos dentro do servidor.');
        return true;
    }

    try {
        // 1. Abrir compra: pedir quantidade.
        if (interaction.isButton() && id === 'ticket_abrir') {
            await interaction.showModal(montarModal(
                'ticket_quantidade', 'Comprar Robux', [{
                    id: 'quantidade', label: 'Quantos Robux deseja comprar?',
                    placeholder: 'Exemplo: 5000 ou 5k', max: 30
                }]
            ));
            return true;
        }

        // 2. Receber quantidade e mostrar modalidades.
        if (interaction.isModalSubmit() && id === 'ticket_quantidade') {
            const qtd = interpretarQuantidade(
                interaction.fields.getTextInputValue('quantidade'));
            if (!qtd) {
                await responder(interaction, '❌ Quantidade inválida. Exemplo: `5000` ou `5k`.');
                return true;
            }
            salvarRascunho(interaction, qtd);
            await interaction.reply({
                content: `💎 **${formatarRobux(qtd)} Robux**. Escolha uma modalidade:`,
                components: [linhaMetodos(getConfig())],
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        // 3. Escolher método; pedir usuário Roblox.
        if (interaction.isButton() && id.startsWith('ticket_metodo_')) {
            const metodo = id.slice('ticket_metodo_'.length);
            const r = obterRascunho(interaction);
            if (!r) {
                await responder(interaction, '⌛ Sua solicitação expirou. Clique em Comprar novamente.');
                return true;
            }
            if (!metodoLiberado(getConfig(), metodo)) {
                await responder(interaction, '🔒 Essa modalidade está bloqueada.');
                return true;
            }
            salvarRascunho(interaction, r.quantidade_robux, metodo);
            await interaction.showModal(montarModal(
                'ticket_usuario', 'Usuário do Roblox', [{
                    id: 'usuario', label: 'Seu nome de usuário do Roblox',
                    placeholder: 'Apenas o username, nunca sua senha', max: 20
                }]
            ));
            return true;
        }

        // 4. Usuário Roblox; escolher PIX ou MM.
        if (interaction.isModalSubmit() && id === 'ticket_usuario') {
            const r = obterRascunho(interaction);
            if (!r?.modalidade) {
                await responder(interaction, '⌛ Pedido expirado. Comece novamente.');
                return true;
            }
            const usuario = interaction.fields.getTextInputValue('usuario').trim();
            if (!/^[A-Za-z0-9_]{3,20}$/.test(usuario)) {
                await responder(interaction, '❌ Digite um username Roblox válido (3 a 20 letras, números ou _).');
                return true;
            }
            salvarRascunho(interaction, r.quantidade_robux, r.modalidade, usuario);
            const quote = calcularPedido(getConfig(), r.modalidade, r.quantidade_robux);
            const linha = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('ticket_pagamento_pix')
                    .setLabel('PIX').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('ticket_pagamento_mm')
                    .setLabel('Solicitar MM').setStyle(ButtonStyle.Secondary)
            );
            await interaction.reply({
                content: `🛒 **${METODOS[r.modalidade]}** — ${formatarRobux(r.quantidade_robux)} Robux\n` +
                    `💰 **Preço estimado:** ${formatarReaisCentavos(quote.centavos)}\n` +
                    'Escolha o pagamento para abrir seu ticket:',
                components: [linha], flags: MessageFlags.Ephemeral
            });
            return true;
        }

        // 5. Criar ticket na categoria configurada.
        if (interaction.isButton() && /^ticket_pagamento_(pix|mm)$/.test(id)) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const r = obterRascunho(interaction);
            if (!r?.modalidade || !r.usuario_roblox) {
                await interaction.editReply('⌛ Solicitação expirada. Comece novamente.');
                return true;
            }
            const chave = `${interaction.guildId}:${interaction.user.id}`;
            if (criando.has(chave)) {
                await interaction.editReply('⏳ Já estou criando seu ticket. Aguarde.');
                return true;
            }
            criando.add(chave);
            try {
                const canal = await criarTicket(interaction, {
                    ...r, pagamento: id.endsWith('_pix') ? 'pix' : 'mm'
                });
                await interaction.editReply(`✅ Seu ticket foi criado: <#${canal.id}>`);
            } finally {
                criando.delete(chave);
            }
            return true;
        }

        // Botões da equipe, usados apenas dentro do ticket.
        if (interaction.isButton() &&
            ['ticket_assumir', 'ticket_finalizar', 'ticket_cancelar'].includes(id)) {
            const ticket = ticketDesteCanal(interaction);
            if (!ticket) {
                await responder(interaction, '❌ Este canal não está vinculado a um ticket.');
                return true;
            }
            if (!podeAtender(interaction, getConfig())) {
                await responder(interaction, '❌ Apenas a equipe de atendimento pode usar este botão.');
                return true;
            }
            if (!['aberto', 'em_atendimento'].includes(ticket.status)) {
                await responder(interaction, '❌ Este ticket não está mais aberto.');
                return true;
            }

            if (id === 'ticket_assumir') {
                db.prepare(`UPDATE tickets SET atendente_id = ?, status = 'em_atendimento',
                    atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`)
                    .run(interaction.user.id, ticket.id);
                registrarLog(ticket.id, interaction.user.id, 'assumir');
                await interaction.reply({
                    content: `🙋 Atendimento assumido por <@${interaction.user.id}>.`,
                    allowedMentions: { parse: [] }
                });
                return true;
            }

            if (id === 'ticket_cancelar') {
                db.prepare(`UPDATE tickets SET status = 'cancelado',
                    encerrado_em = CURRENT_TIMESTAMP WHERE id = ?`).run(ticket.id);
                registrarLog(ticket.id, interaction.user.id, 'cancelamento');
                await interaction.reply({
                    content: '❌ Pedido cancelado. Nenhuma venda será registrada. Este canal será fechado em 7 segundos.',
                    allowedMentions: { parse: [] }
                });
                await fecharCanal(interaction);
                return true;
            }

            await interaction.showModal(montarModal(
                `ticket_concluir_${ticket.id}`,
                'Finalizar venda', [{
                    id: 'valor_pago', label: 'Valor realmente pago (R$)',
                    valor: (ticket.preco_centavos / 100).toFixed(2).replace('.', ','),
                    placeholder: 'Exemplo: 210,00', max: 30
                }]
            ));
            return true;
        }

        // Finalizar: salvar compra, publicar venda e solicitar avaliação.
        if (interaction.isModalSubmit() && id.startsWith('ticket_concluir_')) {
            const ticketId = Number(id.slice('ticket_concluir_'.length));
            const ticket = ticketDesteCanal(interaction);
            if (!ticket || ticket.id !== ticketId ||
                !podeAtender(interaction, getConfig())) {
                await responder(interaction, '❌ Você não pode finalizar este pedido.');
                return true;
            }
            const centavos = interpretarValorPago(
                interaction.fields.getTextInputValue('valor_pago'));
            if (!centavos) {
                await responder(interaction, '❌ Informe o valor pago, como `210,00`.');
                return true;
            }
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const claim = db.prepare(`
                UPDATE tickets SET status = 'finalizando', atualizado_em = CURRENT_TIMESTAMP
                WHERE id = ? AND status IN ('aberto', 'em_atendimento')
            `).run(ticket.id);
            if (!claim.changes) {
                await interaction.editReply('❌ Este pedido já está sendo finalizado.');
                return true;
            }
            try {
                // Será implementado em services/vendaService.js.
                // Esse serviço deve impedir venda duplicada pelo ticketId.
                const { registrarVenda } = require('../services/vendaService');
                // Quantidade efetivamente entregue não depende de mudanças futuras no K.
                const robuxEntregues = ticket.modalidade === 'semTaxa'
                    ? Math.floor(ticket.quantidade_robux * 0.70)
                    : ticket.quantidade_robux;
                await registrarVenda({
                    guild: interaction.guild,
                    clienteId: ticket.cliente_id,
                    valor: centavos / 100,
                    robux: robuxEntregues,
                    registradoPorId: interaction.user.id,
                    modalidade: ticket.modalidade,
                    usuarioRoblox: ticket.usuario_roblox,
                    pagamento: ticket.pagamento,
                    origem: 'ticket',
                    ticketId: ticket.id
                });
                db.prepare(`UPDATE tickets SET status = 'finalizado',
                    preco_centavos = ?, encerrado_em = CURRENT_TIMESTAMP WHERE id = ?`)
                    .run(centavos, ticket.id);
                registrarLog(ticket.id, interaction.user.id, 'venda_finalizada',
                    `Valor pago: ${formatarReaisCentavos(centavos)}`);
                await interaction.editReply('✅ Venda registrada! O ticket será fechado em 7 segundos.');
                await interaction.channel.send({
                    content: '✅ **Compra concluída!** Obrigado por comprar na InovareSale. 💎',
                    allowedMentions: { parse: [] }
                }).catch(() => {});
                const { solicitarAvaliacao } = require('./avaliacaoHandler');
                await solicitarAvaliacao(interaction.client, {
                    ...ticket, status: 'finalizado'
                }).catch(() => {});
                await fecharCanal(interaction);
            } catch (erro) {
                // O serviço de vendas precisa ser idempotente:
                // uma tentativa repetida não pode gerar uma segunda compra.
                db.prepare(`UPDATE tickets SET status = 'aberto' WHERE id = ?
                    AND status = 'finalizando'`).run(ticket.id);
                console.error('Erro ao finalizar venda do ticket:', erro);
                await interaction.editReply(
                    '❌ Não consegui confirmar a venda. Verifique os registros antes de tentar novamente.'
                );
            }
            return true;
        }

        return false;
    } catch (erro) {
        console.error('Erro no ticketHandler:', erro);
        const mensagem = erro instanceof Error ? erro.message : 'Erro inesperado.';
        try {
            if (interaction.deferred) {
                await interaction.editReply(`❌ ${mensagem}`);
            } else {
                await responder(interaction, `❌ ${mensagem}`);
            }
        } catch {}
        return true;
    }
}

module.exports = {
    handleTicketInteraction,
    interpretarQuantidade,
    calcularPedido
};
