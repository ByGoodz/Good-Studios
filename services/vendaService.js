'use strict';

const {
    EmbedBuilder,
    ChannelType,
    AttachmentBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
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

// ==========================================
// MODELO VISUAL DA VENDA
// Imagem: assets/compra-base.png
// Todos os dados mostrados sao reais, vindos da venda.
// ==========================================

const CAMINHO_MODELO_COMPRA = path.join(
    __dirname, '..', 'assets', 'compra-base.png'
);

function nomeSeguro(valor, limite = 60) {
    return String(valor || 'Nao informado')
        .replace(/[\r\n\t]/g, ' ')
        .replace(/[@<>`]/g, '')
        .trim()
        .slice(0, limite);
}

function caixaArredondada(ctx, x, y, largura, altura, raio) {
    const r = Math.min(raio, largura / 2, altura / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + largura - r, y);
    ctx.quadraticCurveTo(x + largura, y, x + largura, y + r);
    ctx.lineTo(x + largura, y + altura - r);
    ctx.quadraticCurveTo(x + largura, y + altura, x + largura - r, y + altura);
    ctx.lineTo(x + r, y + altura);
    ctx.quadraticCurveTo(x, y + altura, x, y + altura - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function escreverTexto(ctx, texto, x, y, largura, tamanho = 26, cor = '#FFFFFF') {
    ctx.font = `600 ${tamanho}px Arial`;
    ctx.fillStyle = cor;
    ctx.textAlign = 'left';
    ctx.fillText(String(texto), x, y, largura);
}

function desenharLinha(ctx, rotulo, valor, y) {
    escreverTexto(ctx, rotulo.toUpperCase(), 554, y, 305, 19, '#B4B2C4');
    escreverTexto(ctx, valor, 865, y + 1, 405, 25, '#F5F2FF');
    ctx.strokeStyle = 'rgba(180, 149, 223, 0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(550, y + 16);
    ctx.lineTo(1266, y + 16);
    ctx.stroke();
}

function validarArquivoPNG(caminho) {
    const info = fs.statSync(caminho);
    if (!info.isFile() || info.size < 100 || info.size > 8 * 1024 * 1024) {
        throw new Error('compra-base.png esta vazio ou ultrapassa 8 MB.');
    }

    const assinatura = Buffer.alloc(8);
    const fd = fs.openSync(caminho, 'r');
    try {
        fs.readSync(fd, assinatura, 0, 8, 0);
    } finally {
        fs.closeSync(fd);
    }

    if (!assinatura.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        throw new Error('compra-base.png nao e um PNG verdadeiro.');
    }
}

async function gerarImagemVenda(guild, dados) {
    validarArquivoPNG(CAMINHO_MODELO_COMPRA);

    const fundo = await loadImage(CAMINHO_MODELO_COMPRA);
    const canvas = createCanvas(1672, 941);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(fundo, 0, 0, 1672, 941);

    // Cobre integralmente os dados FALSOS impressos no modelo.
    // O personagem e a moldura originais permanecem visiveis.
    caixaArredondada(ctx, 514, 269, 797, 509, 18);
    ctx.fillStyle = 'rgba(5, 5, 12, 0.985)';
    ctx.fill();
    ctx.strokeStyle = '#715094';
    ctx.lineWidth = 2;
    ctx.stroke();

    let usuario = null;
    try {
        usuario = await guild.client.users.fetch(dados.clienteId);
    } catch (erro) {
        console.warn('[InovareSale] Nao consegui obter o avatar do comprador:', erro.message);
    }

    const nomeComprador = nomeSeguro(
        usuario?.globalName || usuario?.username || `Usuario ${dados.clienteId}`,
        42
    );
    const dataCompra = new Date(dados.registradoEm || Date.now()).toLocaleString(
        'pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }
    );

    escreverTexto(ctx, 'COMPRA REALIZADA', 546, 334, 735, 43, '#FFFFFF');
    escreverTexto(ctx, `Cliente: ${nomeComprador}`, 548, 377, 724, 25, '#CFA9FF');
    escreverTexto(ctx, dataCompra, 550, 410, 700, 19, '#C6C0D0');

    ctx.strokeStyle = '#A976E9';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(548, 430);
    ctx.lineTo(1267, 430);
    ctx.stroke();

    desenharLinha(ctx, 'Usuario Roblox', nomeSeguro(dados.usuarioRoblox || 'Nao informado', 30), 475);
    desenharLinha(ctx, 'Robux comprados', `${formatarRobux(dados.robux)} Robux`, 528);
    desenharLinha(ctx, 'Modalidade', MODALIDADES[dados.modalidade] || 'Nao informada', 581);
    desenharLinha(ctx, 'Valor pago', formatarDinheiro(dados.valor), 634);
    desenharLinha(ctx, 'Pagamento', PAGAMENTOS[dados.pagamento] || 'Nao informado', 687);

    const pedido = dados.ticketId
        ? `Pedido INV-${String(dados.ticketId).padStart(4, '0')}`
        : 'Venda registrada pela equipe';
    escreverTexto(ctx, pedido, 554, 752, 600, 21, '#CFA9FF');

    // O botao DESENHADO na imagem nao e clicavel.
    // O botao verdadeiro sera enviado como componente do Discord.
    caixaArredondada(ctx, 523, 784, 570, 82, 14);
    ctx.fillStyle = 'rgba(7, 6, 14, 0.99)';
    ctx.fill();
    ctx.strokeStyle = '#A976E9';
    ctx.lineWidth = 2;
    ctx.stroke();
    escreverTexto(ctx, 'OBRIGADO PELA COMPRA', 552, 834, 512, 27, '#FFFFFF');

    // Substitui a foto de exemplo pela foto real do Discord.
    caixaArredondada(ctx, 1333, 266, 219, 231, 18);
    ctx.fillStyle = '#090A13';
    ctx.fill();
    ctx.strokeStyle = '#AD86DE';
    ctx.lineWidth = 3;
    ctx.stroke();

    if (usuario) {
        try {
            const avatarUrl = usuario.displayAvatarURL({ extension: 'png', size: 256 });
            const resposta = await fetch(avatarUrl, { signal: AbortSignal.timeout(5000) });
            if (!resposta.ok) throw new Error(`Avatar HTTP ${resposta.status}`);
            const avatar = await loadImage(Buffer.from(await resposta.arrayBuffer()));
            ctx.save();
            caixaArredondada(ctx, 1343, 276, 199, 211, 13);
            ctx.clip();
            ctx.drawImage(avatar, 1343, 276, 199, 211);
            ctx.restore();
        } catch (erro) {
            escreverTexto(ctx, 'INOVARESALE', 1352, 391, 182, 22, '#CFA9FF');
        }
    } else {
        escreverTexto(ctx, 'INOVARESALE', 1352, 391, 182, 22, '#CFA9FF');
    }

    return canvas.encode('png');
}

// Embed minimo usado junto da imagem; tambem serve de alternativa
// quando o arquivo da imagem estiver ausente ou invalido.
function criarEmbedVenda(dados) {
    return new EmbedBuilder()
        .setColor(0xA976E9)
        .setTitle('Compra realizada — InovareSale')
        .setDescription(
            `Cliente: <@${dados.clienteId}>\n` +
            `Robux: **${formatarRobux(dados.robux)}**\n` +
            `Valor: **${formatarDinheiro(dados.valor)}**\n` +
            `Modalidade: **${MODALIDADES[dados.modalidade] || 'Nao informada'}**\n` +
            (dados.ticketId ? `Pedido: **INV-${String(dados.ticketId).padStart(4, '0')}**` : 'Venda concluida')
        )
        .setTimestamp();
}

function obterLinkCompra(guild, config) {
    const canalId =
        config.tickets?.painelPublicadoCanalId ||
        config.tickets?.painelCanalId ||
        config.estoque?.canalCompraId;

    if (!canalId || !/^\d{15,22}$/.test(String(canalId))) return null;
    const mensagemId = config.tickets?.painelMensagemId;
    const base = `https://discord.com/channels/${guild.id}/${canalId}`;
    return mensagemId && /^\d{15,22}$/.test(String(mensagemId))
        ? `${base}/${mensagemId}`
        : base;
}

async function publicarVenda(guild, dados) {
    const config = getConfig() || {};
    const canalId = config.vendas?.canalId;
    if (!canalId) {
        return { url: null, erro: 'Canal de vendas nao configurado.' };
    }

    try {
        const canal = await guild.channels.fetch(canalId);
        if (!canal || canal.type !== ChannelType.GuildText) {
            return { url: null, erro: 'Canal de vendas invalido.' };
        }

        const embed = criarEmbedVenda(dados);
        const arquivos = [];
        try {
            const png = await gerarImagemVenda(guild, dados);
            arquivos.push(new AttachmentBuilder(png, { name: 'inovaresale-compra.png' }));
            embed.setImage('attachment://inovaresale-compra.png');
        } catch (erroImagem) {
            // Uma falha na imagem NUNCA deve cancelar a venda salva.
            console.error('[InovareSale] Falha ao criar imagem da venda:', erroImagem);
        }

        const componentes = [];
        const urlCompra = obterLinkCompra(guild, config);
        if (urlCompra) {
            componentes.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Comprar tambem')
                    .setStyle(ButtonStyle.Link)
                    .setURL(urlCompra)
            ));
        }

        const mensagem = await canal.send({
            embeds: [embed],
            files: arquivos,
            components: componentes,
            allowedMentions: { parse: [] }
        });
        return { url: mensagem.url, erro: null };
    } catch (erro) {
        console.error('[InovareSale] Nao foi possivel publicar a venda:', erro);
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
            totalCompras: dadosCliente.quantidadeCompras,
            registradoEm: agora
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
    formatarRobux,
    gerarImagemVenda,
    publicarVenda
};
