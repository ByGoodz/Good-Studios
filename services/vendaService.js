
'use strict';

const { EmbedBuilder, ChannelType } = require('discord.js');
const { db } = require('../database/db');
const { getConfig } = require('../utils/storage');
const { obterCargoIdeal, atualizarCargo } = require('../utils/roles');

// ==========================================
// INOVARESALE BOT 2.0 — SERVIÇO DE VENDAS
// ==========================================
// Histórico: dados.sales no SQLite.
// Ticket: vendas_tickets impede duplicidade.
// Não registra venda em arquivo JSON separado.

const MODALIDADES = {
    viaPlus: 'Via Plus',
    semTaxa: 'Robux Sem Taxa',
    taxado: 'Robux Taxado',
    viaGrupo: 'Robux Via Grupo',
    outro: 'Outra modalidade'
};

const PAGAMENTOS = {
    pix: 'PIX',
    mm: 'Solicitar MM',
    outro: 'Outro'
};

function validarSnowflake(id, nome) {
    const texto = String(id ?? '');
    if (!/^\d{15,22}$/.test(texto)) {
        throw new Error(`${nome} inválido.`);
    }
    return texto;
}

function validarValor(valor) {
    const numero = Number(valor);
    if (!Number.isFinite(numero) || numero <= 0) {
        throw new Error('O valor da venda precisa ser maior que zero.');
    }
    const centavos = Math.round(numero * 100);
    if (!Number.isSafeInteger(centavos) || centavos <= 0 ||
        Math.abs(numero * 100 - centavos) > 0.00001) {
        throw new Error('Informe um valor monetário válido, com até duas casas decimais.');
    }
    return centavos;
}

function validarRobux(valor) {
    const numero = Number(valor);
    if (!Number.isSafeInteger(numero) || numero <= 0 || numero > 50000000) {
        throw new Error('A quantidade de Robux deve ser um inteiro entre 1 e 50.000.000.');
    }
    return numero;
}

function normalizarTexto(texto, limite = 100) {
    return String(texto ?? '').trim().slice(0, limite);
}

function formatarDinheiro(valor) {
    return Number(valor).toLocaleString('pt-BR', {
        style: 'currency', currency: 'BRL'
    });
}

function formatarRobux(valor) {
    return Number(valor).toLocaleString('pt-BR');
}

function extrairSales() {
    // A migração precisa ser feita antes de utilizar o serviço.
    // Nunca iniciar um histórico vazio por engano: isso poderia
    // sobrescrever compras existentes ainda não migradas.
    const linha = db.prepare(
        'SELECT valor FROM dados WHERE chave = ?'
    ).get('sales');

    if (!linha) {
        throw new Error(
            'Histórico SQLite não encontrado. Execute a migração dos dados antes de registrar vendas.'
        );
    }

    const sales = JSON.parse(linha.valor);
    if (!sales || typeof sales !== 'object' || Array.isArray(sales)) {
        throw new Error('Histórico de vendas no SQLite está inválido.');
    }
    return sales;
}

function salvarSales(sales) {
    db.prepare('UPDATE dados SET valor = ? WHERE chave = ?')
        .run(JSON.stringify(sales), 'sales');
}

function copiarDadosCliente(dados = {}) {
    return {
        ...dados,
        totalGasto: Number(dados.totalGasto || 0),
        totalRobux: Number(dados.totalRobux || 0),
        quantidadeCompras: Number(dados.quantidadeCompras || 0),
        historico: Array.isArray(dados.historico)
            ? [...dados.historico]
            : []
    };
}

function validarTicketParaVenda(ticketId, guildId, clienteId) {
    if (ticketId === null || ticketId === undefined) {
        return null;
    }
    const id = Number(ticketId);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error('ID de ticket inválido.');
    }

    const ticket = db.prepare(
        'SELECT * FROM tickets WHERE id = ?'
    ).get(id);

    if (!ticket || ticket.servidor_id !== guildId ||
        ticket.cliente_id !== clienteId) {
        throw new Error('Ticket não corresponde ao cliente ou servidor informado.');
    }
    return ticket;
}

function criarEmbedVenda({
    clienteId, registradoPorId, valor, robux,
    modalidade, usuarioRoblox, pagamento, ticketId,
    totalCompras
}) {
    const embed = new EmbedBuilder()
        .setColor(0xC0C0C0)
        .setTitle('💎 VENDA CONCLUÍDA — INOVARESALE')
        .setDescription(
            'Uma nova compra foi registrada com sucesso!\n\n' +
            `👤 **Cliente:** <@${clienteId}>\n` +
            `💎 **Robux adquiridos:** ${formatarRobux(robux)}\n` +
            `💰 **Valor pago:** ${formatarDinheiro(valor)}\n` +
            `📦 **Modalidade:** ${MODALIDADES[modalidade] || 'Não informada'}\n` +
            `💳 **Pagamento:** ${PAGAMENTOS[pagamento] || 'Não informado'}\n` +
            (usuarioRoblox
                ? `🎮 **Roblox:** \`${normalizarTexto(usuarioRoblox, 50).replace(/`/g, '')}\`\n`
                : '') +
            (ticketId
                ? `🎫 **Pedido:** INV-${String(ticketId).padStart(4, '0')}\n`
                : '') +
            `🛍️ **Compras do cliente:** ${totalCompras}\n\n` +
            '✨ Obrigado por escolher a InovareSale!'
        )
        .setFooter({
            text: `Venda registrada pela equipe • ${registradoPorId}`
        })
        .setTimestamp();

    return embed;
}

async function publicarVenda(guild, dados) {
    const config = getConfig() || {};
    const canalId = config.vendas?.canalId;
    if (!canalId) {
        return { url: null, erro: 'Canal de vendas não configurado.' };
    }

    try {
        const canal = await guild.channels.fetch(canalId);
        if (!canal || canal.type !== ChannelType.GuildText) {
            return { url: null, erro: 'Canal de vendas inválido.' };
        }

        const mensagem = await canal.send({
            embeds: [criarEmbedVenda(dados)],
            allowedMentions: { parse: [] }
        });
        return { url: mensagem.url, erro: null };
    } catch (erro) {
        console.error('❌ Não foi possível publicar a venda:', erro);
        return { url: null, erro: erro.message };
    }
}

async function atualizarCargoCliente(guild, clienteId, totalGasto) {
    const config = getConfig() || {};
    const cargos = config.cargos || {};
    const cargoId = obterCargoIdeal(totalGasto, cargos) || null;

    try {
        const membro = await guild.members.fetch(clienteId);
        if (!membro) {
            return { cargoId, erroCargo: 'Cliente não encontrado no servidor.' };
        }

        await atualizarCargo(membro, totalGasto, cargos);
        return { cargoId, erroCargo: null };
    } catch (erro) {
        console.error('❌ Falha ao atualizar cargo do cliente:', erro);
        return { cargoId, erroCargo: erro.message };
    }
}

// ==========================================
// REGISTRAR VENDA
// ==========================================
// O comando /venda chama sem ticketId.
// O ticketHandler chama com origem='ticket' e ticketId.
// Tudo que altera o histórico é gravado numa transação SQLite.

async function registrarVenda({
    guild,
    clienteId,
    valor,
    robux,
    registradoPorId,
    modalidade = 'outro',
    usuarioRoblox = '',
    pagamento = 'outro',
    origem = 'manual',
    ticketId = null
}) {
    if (!guild?.id) {
        throw new Error('Servidor não informado.');
    }

    const servidorId = validarSnowflake(guild.id, 'Servidor');
    const idCliente = validarSnowflake(clienteId, 'Cliente');
    const idAtendente = validarSnowflake(registradoPorId, 'Atendente');
    const centavos = validarValor(valor);
    const quantidade = validarRobux(robux);

    if (!Object.prototype.hasOwnProperty.call(MODALIDADES, modalidade)) {
        throw new Error('Modalidade inválida.');
    }
    if (!Object.prototype.hasOwnProperty.call(PAGAMENTOS, pagamento)) {
        throw new Error('Pagamento inválido.');
    }
    if (!['manual', 'ticket'].includes(origem)) {
        throw new Error('Origem da venda inválida.');
    }
    if (origem === 'ticket' && ticketId == null) {
        throw new Error('Uma venda por ticket precisa informar o ticketId.');
    }

    const agora = new Date().toISOString();
    const reais = centavos / 100;

    // Transação síncrona: não colocar awaits neste trecho.
    const resultado = db.transaction(() => {
        const ticket = validarTicketParaVenda(
            ticketId, servidorId, idCliente
        );

        // Verificar ANTES de atualizar valores do cliente.
        if (ticket) {
            const jaExiste = db.prepare(
                'SELECT * FROM vendas_tickets WHERE ticket_id = ?'
            ).get(ticket.id);

            if (jaExiste) {
                const salesAtual = extrairSales();
                return {
                    jaRegistrada: true,
                    dadosCliente: copiarDadosCliente(
                        salesAtual[servidorId]?.[idCliente]
                    )
                };
            }
            if (ticket.status !== 'finalizando') {
                throw new Error(
                    'O ticket precisa estar em finalização para registrar a venda.'
                );
            }
        }

        const sales = extrairSales();
        sales[servidorId] ??= {};
        const cliente = copiarDadosCliente(
            sales[servidorId][idCliente]
        );

        cliente.totalGasto = Number(
            (cliente.totalGasto + reais).toFixed(2)
        );
        cliente.totalRobux += quantidade;
        cliente.quantidadeCompras += 1;

        cliente.historico.push({
            valor: reais,
            robux: quantidade,
            data: agora,
            registradoPor: idAtendente,
            modalidade,
            usuarioRoblox: normalizarTexto(usuarioRoblox, 50),
            pagamento,
            origem,
            ...(ticket ? { ticketId: ticket.id } : {})
        });

        sales[servidorId][idCliente] = cliente;
        salvarSales(sales);

        if (ticket) {
            db.prepare(`
                INSERT INTO vendas_tickets (
                    ticket_id, cliente_id, valor_centavos,
                    quantidade_robux, registrado_por, registrado_em
                ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `).run(
                ticket.id, idCliente, centavos,
                quantidade, idAtendente
            );
        }

        return { jaRegistrada: false, dadosCliente: cliente };
    })();

    const dadosCliente = resultado.dadosCliente;

    // Falhas em cargos ou publicações não desfazem vendas salvas.
    // O handler pode ser repetido sem duplicar o histórico do ticket.
    const cargo = await atualizarCargoCliente(
        guild, idCliente, dadosCliente.totalGasto
    );

    let publicacaoUrl = null;
    let erroPublicacao = null;

    if (!resultado.jaRegistrada) {
        const publicacao = await publicarVenda(guild, {
            clienteId: idCliente,
            registradoPorId: idAtendente,
            valor: reais,
            robux: quantidade,
            modalidade,
            usuarioRoblox,
            pagamento,
            ticketId: ticketId == null ? null : Number(ticketId),
            totalCompras: dadosCliente.quantidadeCompras
        });
        publicacaoUrl = publicacao.url;
        erroPublicacao = publicacao.erro;
    }

    return {
        dadosCliente,
        cargoId: cargo.cargoId,
        erroCargo: cargo.erroCargo,
        publicacaoUrl,
        erroPublicacao,
        jaRegistrada: resultado.jaRegistrada
    };
}

module.exports = {
    registrarVenda,
    criarEmbedVenda,
    formatarDinheiro,
    formatarRobux
};
