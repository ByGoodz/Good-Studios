
'use strict';

// ==========================================
// INOVARESALE BOT 3.0
// SERVIÇO COMPLETO DE VENDAS
// ==========================================

// FUNCIONALIDADES:
//
// - Registrar vendas manuais
// - Registrar vendas feitas por tickets
// - Preservar histórico antigo de compras
// - Impedir venda duplicada por ticket
// - Atualizar perfil do cliente
// - Atualizar cargos de fidelidade
// - Publicar vendas no canal configurado
// - Gerar imagem personalizada da compra
// - Utilizar letras bitmap sem fontes
// - Registrar vendas nos logs do sistema
// - Salvar situação das publicações
// - Preservar compatibilidade com o Bot 2.0
//
// IMPORTANTE:
//
// O histórico principal continua em:
//
// tabela: dados
// chave: sales
//
// Os tickets continuam protegidos por:
//
// tabela: vendas_tickets
//
// Este arquivo NÃO apaga compras antigas.

// ==========================================
// IMPORTAÇÕES
// ==========================================

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

const {
    createCanvas,
    loadImage
} = require('@napi-rs/canvas');

const {
    db
} = require('../database/db');

const {
    getConfig,
    getSales,
    saveSales
} = require('../utils/storage');

const {
    obterCargoIdeal,
    atualizarCargo
} = require('../utils/roles');

const {
    registrarLogSistema,
    TIPOS_LOG
} = require('./logsService');

// ==========================================
// CONFIGURAÇÕES
// ==========================================

const COR = 0x9951CB;

const LARGURA_IMAGEM = 1672;
const ALTURA_IMAGEM = 941;

const CAMINHO_MODELO_COMPRA =
    path.join(
        __dirname,
        '..',
        'assets',
        'compra-base.png'
    );

const MODALIDADES = Object.freeze({
    viaPlus: 'Via Plus',
    semTaxa: 'Robux Sem Taxa',
    taxado: 'Robux Taxado',
    viaGrupo: 'Robux Via Grupo',
    outro: 'Outra modalidade'
});

const PAGAMENTOS = Object.freeze({
    pix: 'PIX',
    mm: 'Solicitar MM',
    outro: 'Outro'
});

// ==========================================
// TABELAS AUXILIARES
// ==========================================

// São tabelas novas.
//
// Não alteram a tabela "dados",
// a tabela de tickets nem as
// vendas antigas.
//
// A tabela de operações permite
// identificar cada venda nova.
//
// A tabela de publicações registra
// o estado do anúncio enviado
// ao Discord.
//
// Se o envio ficar incerto,
// não tentaremos publicá-lo
// automaticamente uma segunda vez.

db.exec(`
    CREATE TABLE IF NOT EXISTS
        vendas_operacoes_v3 (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            servidor_id TEXT NOT NULL,
            cliente_id TEXT NOT NULL,

            atendente_id TEXT NOT NULL,

            origem TEXT NOT NULL,

            ticket_id INTEGER,

            chave_evento TEXT,

            valor_centavos INTEGER NOT NULL,
            quantidade_robux INTEGER NOT NULL,

            modalidade TEXT NOT NULL,
            pagamento TEXT NOT NULL,

            usuario_roblox TEXT NOT NULL
                DEFAULT '',

            registrado_em TEXT NOT NULL,

            UNIQUE (
                servidor_id,
                chave_evento
            )
        );

    CREATE UNIQUE INDEX IF NOT EXISTS
        idx_vendas_operacoes_ticket_v3
    ON vendas_operacoes_v3 (
        ticket_id
    )
    WHERE ticket_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS
        vendas_publicacoes_v3 (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            servidor_id TEXT NOT NULL,

            referencia TEXT NOT NULL,

            canal_id TEXT,
            mensagem_id TEXT,

            status TEXT NOT NULL
                DEFAULT 'pendente',

            erro TEXT,

            criado_em TEXT NOT NULL
                DEFAULT CURRENT_TIMESTAMP,

            atualizado_em TEXT NOT NULL
                DEFAULT CURRENT_TIMESTAMP,

            UNIQUE (
                servidor_id,
                referencia
            )
        );
`);

// ==========================================
// CONSULTAS PREPARADAS
// ==========================================

const SQL = {
    buscarVendaTicket: db.prepare(`
        SELECT *
        FROM vendas_tickets
        WHERE ticket_id = ?
    `),

    buscarOperacaoChave: db.prepare(`
        SELECT *
        FROM vendas_operacoes_v3

        WHERE servidor_id = ?
          AND chave_evento = ?
    `),

    buscarOperacaoTicket: db.prepare(`
        SELECT *
        FROM vendas_operacoes_v3
        WHERE ticket_id = ?
    `),

    inserirOperacao: db.prepare(`
        INSERT INTO vendas_operacoes_v3 (
            servidor_id,
            cliente_id,
            atendente_id,
            origem,
            ticket_id,
            chave_evento,
            valor_centavos,
            quantidade_robux,
            modalidade,
            pagamento,
            usuario_roblox,
            registrado_em
        )

        VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?
        )
    `),

    criarPublicacao: db.prepare(`
        INSERT OR IGNORE INTO
            vendas_publicacoes_v3 (
                servidor_id,
                referencia,
                status
            )

        VALUES (?, ?, 'pendente')
    `),

    buscarPublicacao: db.prepare(`
        SELECT *
        FROM vendas_publicacoes_v3

        WHERE servidor_id = ?
          AND referencia = ?
    `),

    alterarPublicacao: db.prepare(`
        UPDATE vendas_publicacoes_v3

        SET status = ?,
            canal_id = ?,
            mensagem_id = ?,
            erro = ?,
            atualizado_em = CURRENT_TIMESTAMP

        WHERE servidor_id = ?
          AND referencia = ?
    `)
};

// ==========================================
// VALIDAÇÕES
// ==========================================

function validarSnowflake(
    valor,
    nome = 'ID'
) {
    const id = String(
        valor ?? ''
    ).trim();

    if (!/^\d{15,22}$/.test(id)) {
        throw new Error(
            `${nome} inválido.`
        );
    }

    return id;
}

function validarValor(valor) {
    const numero = Number(valor);

    if (
        !Number.isFinite(numero) ||
        numero <= 0
    ) {
        throw new Error(
            'O valor da venda deve ser maior que zero.'
        );
    }

    const centavos =
        Math.round(
            numero * 100
        );

    if (
        !Number.isSafeInteger(centavos) ||
        centavos <= 0 ||
        Math.abs(
            numero * 100 - centavos
        ) > 0.00001
    ) {
        throw new Error(
            'Informe um valor válido ' +
            'com até duas casas decimais.'
        );
    }

    return centavos;
}

function validarRobux(valor) {
    const numero = Number(valor);

    if (
        !Number.isSafeInteger(numero) ||
        numero < 1 ||
        numero > 50000000
    ) {
        throw new Error(
            'A quantidade deve ficar entre ' +
            '1 e 50.000.000 Robux.'
        );
    }

    return numero;
}

function validarTicketId(valor) {
    if (
        valor === null ||
        valor === undefined
    ) {
        return null;
    }

    const id = Number(valor);

    if (
        !Number.isSafeInteger(id) ||
        id < 1
    ) {
        throw new Error(
            'ID de ticket inválido.'
        );
    }

    return id;
}

function normalizarTexto(
    valor,
    limite = 100
) {
    return String(
        valor ?? ''
    )
        .replace(/\u0000/g, '')
        .trim()
        .slice(0, limite);
}

function validarChaveEvento(valor) {
    if (
        valor === null ||
        valor === undefined ||
        valor === ''
    ) {
        return null;
    }

    const chave =
        String(valor).trim();

    if (
        chave.length < 1 ||
        chave.length > 140
    ) {
        throw new Error(
            'Chave da operação de venda inválida.'
        );
    }

    return chave;
}

// ==========================================
// FORMATAÇÕES
// ==========================================

function formatarDinheiro(valor) {
    const numero = Number(valor);

    if (!Number.isFinite(numero)) {
        throw new Error(
            'Valor monetário inválido.'
        );
    }

    return numero.toLocaleString(
        'pt-BR',
        {
            style: 'currency',
            currency: 'BRL'
        }
    );
}

function formatarRobux(valor) {
    const numero = Number(valor);

    if (!Number.isFinite(numero)) {
        throw new Error(
            'Quantidade de Robux inválida.'
        );
    }

    return Math.floor(numero)
        .toLocaleString('pt-BR');
}

// ==========================================
// COPIAR DADOS DO CLIENTE
// ==========================================

// Mantém todas as propriedades
// que já existiam no perfil.
//
// Não substitui o cliente por
// um objeto vazio.
//
// O histórico anterior é copiado,
// preservando as compras passadas.

function copiarDadosCliente(dados = {}) {
    if (
        !dados ||
        typeof dados !== 'object' ||
        Array.isArray(dados)
    ) {
        throw new Error(
            'Dados antigos do cliente inválidos.'
        );
    }

    const historico =
        dados.historico;

    if (
        historico !== undefined &&
        !Array.isArray(historico)
    ) {
        throw new Error(
            'O histórico antigo do cliente ' +
            'está inválido. Gravação bloqueada.'
        );
    }

    const totalGasto =
        Number(dados.totalGasto || 0);

    const totalRobux =
        Number(dados.totalRobux || 0);

    const quantidadeCompras =
        Number(
            dados.quantidadeCompras || 0
        );

    if (
        !Number.isFinite(totalGasto) ||
        totalGasto < 0 ||
        !Number.isSafeInteger(totalRobux) ||
        totalRobux < 0 ||
        !Number.isSafeInteger(quantidadeCompras) ||
        quantidadeCompras < 0
    ) {
        throw new Error(
            'Totais antigos do cliente inválidos. ' +
            'Gravação bloqueada.'
        );
    }

    return {
        ...dados,

        totalGasto,
        totalRobux,
        quantidadeCompras,

        historico:
            Array.isArray(historico)
                ? [...historico]
                : []
    };
}

// ==========================================
// VALIDAR TICKET
// ==========================================

function validarTicketParaVenda(
    ticketId,
    servidorId,
    clienteId
) {
    const id =
        validarTicketId(ticketId);

    if (id === null) {
        return null;
    }

    const ticket =
        db.prepare(`
            SELECT *
            FROM tickets
            WHERE id = ?
        `).get(id);

    if (
        !ticket ||
        ticket.servidor_id !== servidorId ||
        ticket.cliente_id !== clienteId
    ) {
        throw new Error(
            'Ticket não corresponde ao ' +
            'cliente ou servidor informado.'
        );
    }

    return ticket;
}

// ==========================================
// IDENTIFICAR VENDA EXISTENTE
// ==========================================

function verificarVendaExistente({
    servidorId,
    clienteId,
    ticket,
    chaveEvento,
    centavos,
    robux
}) {
    let existente = null;

    if (ticket) {
        existente =
            SQL.buscarVendaTicket.get(
                ticket.id
            );

        if (existente) {
            if (
                existente.cliente_id !== clienteId
            ) {
                throw new Error(
                    'A venda existente pertence ' +
                    'a outro cliente.'
                );
            }

            return {
                jaRegistrada: true,
                operacao:
                    SQL.buscarOperacaoTicket.get(
                        ticket.id
                    ) || null,

                vendaTicket:
                    existente
            };
        }
    }

    if (chaveEvento) {
        const operacao =
            SQL.buscarOperacaoChave.get(
                servidorId,
                chaveEvento
            );

        if (operacao) {
            if (
                operacao.cliente_id !== clienteId ||
                Number(
                    operacao.valor_centavos
                ) !== centavos ||
                Number(
                    operacao.quantidade_robux
                ) !== robux
            ) {
                throw new Error(
                    'A chave desta venda já foi ' +
                    'utilizada com outros dados.'
                );
            }

            return {
                jaRegistrada: true,
                operacao,
                vendaTicket: null
            };
        }
    }

    return null;
}

// ==========================================
// REFERÊNCIA ÚNICA DA PUBLICAÇÃO
// ==========================================

function referenciaPublicacao(
    operacao,
    ticketId
) {
    if (ticketId) {
        return `ticket_${ticketId}`;
    }

    return `manual_${operacao.id}`;
}

// ==========================================
// PREPARAR PUBLICAÇÃO NO SQLITE
// ==========================================

function prepararPublicacao(
    servidorId,
    referencia
) {
    SQL.criarPublicacao.run(
        servidorId,
        referencia
    );

    return SQL.buscarPublicacao.get(
        servidorId,
        referencia
    );
}

// ==========================================
// CONTROLE DE PUBLICAÇÃO
// ==========================================

// O anúncio pode ter sido enviado
// pelo Discord, mas a conexão pode
// cair antes da confirmação.
//
// Nessa situação, o status pode
// permanecer "enviando".
//
// Não publicamos automaticamente
// outra cópia enquanto houver
// possibilidade de anúncio anterior.
//
// Assim evitamos duplicações visuais.

function atualizarSituacaoPublicacao({
    servidorId,
    referencia,
    status,
    canalId = null,
    mensagemId = null,
    erro = null
}) {
    SQL.alterarPublicacao.run(
        status,
        canalId,
        mensagemId,
        erro
            ? String(erro).slice(0, 500)
            : null,
        servidorId,
        referencia
    );

    return SQL.buscarPublicacao.get(
        servidorId,
        referencia
    );
}

// ==========================================
// FONTES BITMAP 5X7
// ==========================================

// NÃO usa:
//
// ctx.font
// ctx.fillText
// ctx.strokeText
//
// Todos os caracteres são
// desenhados com fillRect.
//
// Isso evita depender de fontes
// instaladas na Railway.

const FONT5X7 = Object.freeze({
    'A': [
        '01110',
        '10001',
        '10001',
        '11111',
        '10001',
        '10001',
        '10001'
    ],

    'B': [
        '11110',
        '10001',
        '10001',
        '11110',
        '10001',
        '10001',
        '11110'
    ],

    'C': [
        '01111',
        '10000',
        '10000',
        '10000',
        '10000',
        '10000',
        '01111'
    ],

    'D': [
        '11110',
        '10001',
        '10001',
        '10001',
        '10001',
        '10001',
        '11110'
    ],

    'E': [
        '11111',
        '10000',
        '10000',
        '11110',
        '10000',
        '10000',
        '11111'
    ],

    'F': [
        '11111',
        '10000',
        '10000',
        '11110',
        '10000',
        '10000',
        '10000'
    ],

    'G': [
        '01111',
        '10000',
        '10000',
        '10111',
        '10001',
        '10001',
        '01111'
    ],

    'H': [
        '10001',
        '10001',
        '10001',
        '11111',
        '10001',
        '10001',
        '10001'
    ],

    'I': [
        '11111',
        '00100',
        '00100',
        '00100',
        '00100',
        '00100',
        '11111'
    ],

    'J': [
        '00111',
        '00010',
        '00010',
        '00010',
        '10010',
        '10010',
        '01100'
    ],

    'K': [
        '10001',
        '10010',
        '10100',
        '11000',
        '10100',
        '10010',
        '10001'
    ],

    'L': [
        '10000',
        '10000',
        '10000',
        '10000',
        '10000',
        '10000',
        '11111'
    ],

    'M': [
        '10001',
        '11011',
        '10101',
        '10101',
        '10001',
        '10001',
        '10001'
    ],

    'N': [
        '10001',
        '11001',
        '10101',
        '10011',
        '10001',
        '10001',
        '10001'
    ],

    'O': [
        '01110',
        '10001',
        '10001',
        '10001',
        '10001',
        '10001',
        '01110'
    ],

    'P': [
        '11110',
        '10001',
        '10001',
        '11110',
        '10000',
        '10000',
        '10000'
    ],

    'Q': [
        '01110',
        '10001',
        '10001',
        '10001',
        '10101',
        '10010',
        '01101'
    ],

    'R': [
        '11110',
        '10001',
        '10001',
        '11110',
        '10100',
        '10010',
        '10001'
    ],

    'S': [
        '01111',
        '10000',
        '10000',
        '01110',
        '00001',
        '00001',
        '11110'
    ],

    'T': [
        '11111',
        '00100',
        '00100',
        '00100',
        '00100',
        '00100',
        '00100'
    ],

    'U': [
        '10001',
        '10001',
        '10001',
        '10001',
        '10001',
        '10001',
        '01110'
    ],

    'V': [
        '10001',
        '10001',
        '10001',
        '10001',
        '10001',
        '01010',
        '00100'
    ],

    'W': [
        '10001',
        '10001',
        '10001',
        '10101',
        '10101',
        '10101',
        '01010'
    ],

    'X': [
        '10001',
        '10001',
        '01010',
        '00100',
        '01010',
        '10001',
        '10001'
    ],

    'Y': [
        '10001',
        '10001',
        '01010',
        '00100',
        '00100',
        '00100',
        '00100'
    ],

    'Z': [
        '11111',
        '00001',
        '00010',
        '00100',
        '01000',
        '10000',
        '11111'
    ],

    '0': [
        '01110',
        '10001',
        '10011',
        '10101',
        '11001',
        '10001',
        '01110'
    ],

    '1': [
        '00100',
        '01100',
        '00100',
        '00100',
        '00100',
        '00100',
        '01110'
    ],

    '2': [
        '01110',
        '10001',
        '00001',
        '00010',
        '00100',
        '01000',
        '11111'
    ],

    '3': [
        '11110',
        '00001',
        '00001',
        '01110',
        '00001',
        '00001',
        '11110'
    ],

    '4': [
        '00010',
        '00110',
        '01010',
        '10010',
        '11111',
        '00010',
        '00010'
    ],

    '5': [
        '11111',
        '10000',
        '10000',
        '11110',
        '00001',
        '00001',
        '11110'
    ],

    '6': [
        '01110',
        '10000',
        '10000',
        '11110',
        '10001',
        '10001',
        '01110'
    ],

    '7': [
        '11111',
        '00001',
        '00010',
        '00100',
        '01000',
        '01000',
        '01000'
    ],

    '8': [
        '01110',
        '10001',
        '10001',
        '01110',
        '10001',
        '10001',
        '01110'
    ],

    '9': [
        '01110',
        '10001',
        '10001',
        '01111',
        '00001',
        '00001',
        '01110'
    ],

    ' ': [
        '00000',
        '00000',
        '00000',
        '00000',
        '00000',
        '00000',
        '00000'
    ],

    '.': [
        '00000',
        '00000',
        '00000',
        '00000',
        '00000',
        '00100',
        '00100'
    ],

    ',': [
        '00000',
        '00000',
        '00000',
        '00000',
        '00100',
        '00100',
        '01000'
    ],

    ':': [
        '00000',
        '00100',
        '00100',
        '00000',
        '00100',
        '00100',
        '00000'
    ],

    '-': [
        '00000',
        '00000',
        '00000',
        '11111',
        '00000',
        '00000',
        '00000'
    ],

    '/': [
        '00001',
        '00001',
        '00010',
        '00100',
        '01000',
        '10000',
        '10000'
    ],

    '$': [
        '00100',
        '01111',
        '10100',
        '01110',
        '00101',
        '11110',
        '00100'
    ],

    '#': [
        '01010',
        '11111',
        '01010',
        '01010',
        '11111',
        '01010',
        '00000'
    ],

    '?': [
        '01110',
        '10001',
        '00001',
        '00010',
        '00100',
        '00000',
        '00100'
    ]
});

// ==========================================
// NORMALIZAR TEXTO BITMAP
// ==========================================

function normalizarBitmap(texto) {
    return String(
        texto ?? ''
    )
        .normalize('NFD')
        .replace(
            /[\u0300-\u036f]/g,
            ''
        )
        .replace(
            /[^A-Za-z0-9 .,:\-/$#?]/g,
            '?'
        )
        .toUpperCase();
}

// ==========================================
// DESENHAR TEXTO EM PIXELS
// ==========================================

function escreverPixels(
    ctx,
    texto,
    x,
    y,
    escala = 4,
    cor = '#FFFFFF',
    larguraMaxima = 700
) {
    const textoFinal =
        normalizarBitmap(texto);

    const tamanho =
        Math.max(
            1,
            Math.floor(escala)
        );

    const passo =
        6 * tamanho;

    const maximoCaracteres =
        Math.max(
            0,
            Math.floor(
                larguraMaxima / passo
            )
        );

    const exibicao =
        textoFinal.slice(
            0,
            maximoCaracteres
        );

    ctx.fillStyle = cor;

    let posicaoX = x;

    for (
        const caractere
        of exibicao
    ) {
        const desenho =
            FONT5X7[caractere] ||
            FONT5X7['?'];

        for (
            let linha = 0;
            linha < 7;
            linha++
        ) {
            for (
                let coluna = 0;
                coluna < 5;
                coluna++
            ) {
                if (
                    desenho[linha][coluna] === '1'
                ) {
                    ctx.fillRect(
                        posicaoX +
                            coluna * tamanho,

                        y + linha * tamanho,

                        tamanho,
                        tamanho
                    );
                }
            }
        }

        posicaoX += passo;
    }
}

// ==========================================
// RETÂNGULO ARREDONDADO
// ==========================================

function caixaArredondada(
    ctx,
    x,
    y,
    largura,
    altura,
    raio
) {
    const r = Math.min(
        raio,
        largura / 2,
        altura / 2
    );

    ctx.beginPath();

    ctx.moveTo(
        x + r,
        y
    );

    ctx.lineTo(
        x + largura - r,
        y
    );

    ctx.quadraticCurveTo(
        x + largura,
        y,
        x + largura,
        y + r
    );

    ctx.lineTo(
        x + largura,
        y + altura - r
    );

    ctx.quadraticCurveTo(
        x + largura,
        y + altura,
        x + largura - r,
        y + altura
    );

    ctx.lineTo(
        x + r,
        y + altura
    );

    ctx.quadraticCurveTo(
        x,
        y + altura,
        x,
        y + altura - r
    );

    ctx.lineTo(
        x,
        y + r
    );

    ctx.quadraticCurveTo(
        x,
        y,
        x + r,
        y
    );

    ctx.closePath();
}

// ==========================================
// CONFERIR IMAGEM BASE
// ==========================================

function imagemBaseDisponivel() {
    try {
        const info =
            fs.statSync(
                CAMINHO_MODELO_COMPRA
            );

        if (
            !info.isFile() ||
            info.size < 100 ||
            info.size > 8 * 1024 * 1024
        ) {
            return false;
        }

        const assinatura =
            Buffer.alloc(8);

        const arquivo =
            fs.openSync(
                CAMINHO_MODELO_COMPRA,
                'r'
            );

        try {
            fs.readSync(
                arquivo,
                assinatura,
                0,
                8,
                0
            );

        } finally {
            fs.closeSync(
                arquivo
            );
        }

        return assinatura.equals(
            Buffer.from([
                137,
                80,
                78,
                71,
                13,
                10,
                26,
                10
            ])
        );

    } catch {
        return false;
    }
}

// ==========================================
// DESENHAR FUNDO ALTERNATIVO
// ==========================================

// Se o modelo PNG estiver ausente,
// a venda ainda poderá publicar
// uma imagem simples.
//
// A ausência de um asset nunca
// deve impedir registrar uma compra.

function desenharFundoAlternativo(
    ctx
) {
    ctx.fillStyle = '#090611';

    ctx.fillRect(
        0,
        0,
        LARGURA_IMAGEM,
        ALTURA_IMAGEM
    );

    ctx.fillStyle = '#1A1029';

    ctx.fillRect(
        0,
        0,
        LARGURA_IMAGEM,
        135
    );

    ctx.fillStyle = '#9951CB';

    ctx.fillRect(
        0,
        125,
        LARGURA_IMAGEM,
        10
    );

    escreverPixels(
        ctx,
        'INOVARESALE',
        80,
        52,
        7,
        '#FFFFFF',
        800
    );
}

// ==========================================
// DESENHAR LINHA DA VENDA
// ==========================================

function desenharLinhaVenda(
    ctx,
    rotulo,
    valor,
    y
) {
    escreverPixels(
        ctx,
        rotulo,
        550,
        y,
        3,
        '#BEA2D9',
        300
    );

    escreverPixels(
        ctx,
        valor,
        860,
        y,
        3,
        '#FFFFFF',
        400
    );

    ctx.fillStyle =
        '#45305B';

    ctx.fillRect(
        550,
        y + 31,
        715,
        2
    );
}

// ==========================================
// GERAR IMAGEM DA VENDA
// ==========================================

// Preserva o modelo compra-base.png
// sempre que estiver disponível.
//
// A área dos dados de exemplo
// é coberta antes de escrever
// os dados reais.
//
// Letras renderizadas em pixels.
//
// Sem Arial, fontes externas,
// fillText ou strokeText.

async function gerarImagemVenda(
    guild,
    dados
) {
    const canvas =
        createCanvas(
            LARGURA_IMAGEM,
            ALTURA_IMAGEM
        );

    const ctx =
        canvas.getContext('2d');

    let modeloCarregado = false;

    if (
        imagemBaseDisponivel()
    ) {
        try {
            const fundo =
                await loadImage(
                    CAMINHO_MODELO_COMPRA
                );

            ctx.drawImage(
                fundo,
                0,
                0,
                LARGURA_IMAGEM,
                ALTURA_IMAGEM
            );

            modeloCarregado = true;

        } catch (erro) {
            console.warn(
                '[InovareSale | Venda] ' +
                'Imagem base indisponível:',
                erro.message
            );
        }
    }

    if (!modeloCarregado) {
        desenharFundoAlternativo(
            ctx
        );
    }

    // ======================================
    // COBRIR DADOS DE EXEMPLO
    // ======================================

    caixaArredondada(
        ctx,
        514,
        269,
        797,
        509,
        18
    );

    ctx.fillStyle =
        '#090711';

    ctx.fill();

    ctx.strokeStyle =
        '#9951CB';

    ctx.lineWidth = 2;

    ctx.stroke();

    // ======================================
    // BUSCAR CLIENTE
    // ======================================

    let usuario = null;

    try {
        usuario =
            await guild.client.users.fetch(
                dados.clienteId
            );

    } catch (erro) {
        console.warn(
            '[InovareSale | Venda] ' +
            'Avatar do cliente indisponível:',
            erro.message
        );
    }

    const nomeCliente =
        normalizarTexto(
            usuario?.globalName ||
            usuario?.username ||
            'Cliente Discord',
            50
        );

    const dataCompra =
        new Date(
            dados.registradoEm ||
            Date.now()
        ).toLocaleString(
            'pt-BR',
            {
                timeZone:
                    'America/Sao_Paulo',

                dateStyle:
                    'short',

                timeStyle:
                    'short'
            }
        );

    // ======================================
    // TÍTULO
    // ======================================

    escreverPixels(
        ctx,
        'COMPRA REALIZADA',
        546,
        297,
        6,
        '#FFFFFF',
        730
    );

    escreverPixels(
        ctx,
        `CLIENTE: ${nomeCliente}`,
        548,
        362,
        4,
        '#D8B5FF',
        718
    );

    escreverPixels(
        ctx,
        dataCompra,
        550,
        405,
        3,
        '#BEB4CB',
        700
    );

    ctx.fillStyle =
        '#9951CB';

    ctx.fillRect(
        548,
        443,
        718,
        3
    );

    // ======================================
    // DADOS DA COMPRA
    // ======================================

    desenharLinhaVenda(
        ctx,
        'USUARIO ROBLOX',
        dados.usuarioRoblox ||
            'Nao informado',
        477
    );

    desenharLinhaVenda(
        ctx,
        'ROBUX',
        `${formatarRobux(
            dados.robux
        )} ROBUX`,
        528
    );

    desenharLinhaVenda(
        ctx,
        'MODALIDADE',
        MODALIDADES[
            dados.modalidade
        ] || 'Nao informada',
        579
    );

    desenharLinhaVenda(
        ctx,
        'VALOR PAGO',
        formatarDinheiro(
            dados.valor
        ),
        630
    );

    desenharLinhaVenda(
        ctx,
        'PAGAMENTO',
        PAGAMENTOS[
            dados.pagamento
        ] || 'Nao informado',
        681
    );

    // ======================================
    // IDENTIFICADOR DO PEDIDO
    // ======================================

    const referencia =
        dados.ticketId
            ? (
                'PEDIDO INV-' +
                String(
                    dados.ticketId
                ).padStart(4, '0')
            )
            : 'VENDA REGISTRADA';

    escreverPixels(
        ctx,
        referencia,
        550,
        738,
        3,
        '#D8B5FF',
        700
    );

    // ======================================
    // RODAPÉ DA IMAGEM
    // ======================================

    caixaArredondada(
        ctx,
        523,
        786,
        570,
        78,
        14
    );

    ctx.fillStyle =
        '#171022';

    ctx.fill();

    ctx.strokeStyle =
        '#9951CB';

    ctx.stroke();

    escreverPixels(
        ctx,
        'OBRIGADO PELA COMPRA',
        548,
        809,
        4,
        '#FFFFFF',
        516
    );

    // ======================================
    // ÁREA DO AVATAR REAL
    // ======================================

    caixaArredondada(
        ctx,
        1333,
        266,
        219,
        231,
        18
    );

    ctx.fillStyle =
        '#0C0815';

    ctx.fill();

    ctx.strokeStyle =
        '#AD86DE';

    ctx.lineWidth = 3;

    ctx.stroke();

    let avatarDesenhado = false;

    if (
        usuario &&
        typeof fetch === 'function'
    ) {
        try {
            const url =
                usuario.displayAvatarURL({
                    extension: 'png',
                    size: 256
                });

            const resposta =
                await fetch(
                    url,
                    {
                        signal:
                            AbortSignal.timeout(
                                5000
                            )
                    }
                );

            if (!resposta.ok) {
                throw new Error(
                    `HTTP ${resposta.status}`
                );
            }

            const buffer =
                Buffer.from(
                    await resposta.arrayBuffer()
                );

            const avatar =
                await loadImage(
                    buffer
                );

            ctx.save();

            caixaArredondada(
                ctx,
                1343,
                276,
                199,
                211,
                13
            );

            ctx.clip();

            ctx.drawImage(
                avatar,
                1343,
                276,
                199,
                211
            );

            ctx.restore();

            avatarDesenhado = true;

        } catch (erro) {
            console.warn(
                '[InovareSale | Venda] ' +
                'Não foi possível desenhar avatar:',
                erro.message
            );
        }
    }

    if (!avatarDesenhado) {
        escreverPixels(
            ctx,
            'INOVARE',
            1350,
            365,
            4,
            '#D8B5FF',
            192
        );

        escreverPixels(
            ctx,
            'SALE',
            1350,
            406,
            4,
            '#FFFFFF',
            192
        );
    }

    return canvas.encode(
        'png'
    );
}

// ==========================================
// CRIAR EMBED DE VENDA
// ==========================================

function criarEmbedVenda(dados) {
    const modalidade =
        MODALIDADES[
            dados.modalidade
        ] || 'Não informada';

    const pagamento =
        PAGAMENTOS[
            dados.pagamento
        ] || 'Não informado';

    const embed =
        new EmbedBuilder()
            .setColor(COR)
            .setTitle(
                '💎 INOVARESALE | COMPRA REALIZADA'
            )
            .setDescription(
                '🎉 **Mais uma compra concluída!**'
            )
            .addFields(
                {
                    name: '👤 Cliente',
                    value:
                        `<@${dados.clienteId}>`,
                    inline: true
                },

                {
                    name: '💎 Robux',
                    value:
                        formatarRobux(
                            dados.robux
                        ),
                    inline: true
                },

                {
                    name: '💰 Valor pago',
                    value:
                        formatarDinheiro(
                            dados.valor
                        ),
                    inline: true
                },

                {
                    name: '📦 Modalidade',
                    value:
                        modalidade,
                    inline: true
                },

                {
                    name: '💳 Pagamento',
                    value:
                        pagamento,
                    inline: true
                }
            )
            .setFooter({
                text:
                    'InovareSale Bot 3.0'
            })
            .setTimestamp(
                new Date(
                    dados.registradoEm ||
                    Date.now()
                )
            );

    if (dados.ticketId) {
        embed.addFields({
            name: '🎫 Pedido',
            value:
                `INV-${String(
                    dados.ticketId
                ).padStart(4, '0')}`,
            inline: true
        });
    }

    return embed;
}

// ==========================================
// OBTER LINK DE COMPRA
// ==========================================

function obterLinkCompra(
    guild,
    config
) {
    const canalId =
        config.tickets?.painelPublicadoCanalId ||
        config.tickets?.painelCanalId ||
        config.estoque?.canalCompraId;

    if (
        !/^\d{15,22}$/.test(
            String(canalId || '')
        )
    ) {
        return null;
    }

    const mensagemId =
        config.tickets?.painelMensagemId;

    const base =
        `https://discord.com/channels/` +
        `${guild.id}/${canalId}`;

    if (
        /^\d{15,22}$/.test(
            String(mensagemId || '')
        )
    ) {
        return (
            `${base}/${mensagemId}`
        );
    }

    return base;
}

// ==========================================
// PUBLICAR VENDA
// ==========================================

// Retorna:
//
// {
//   url,
//   erro,
//   canalId,
//   mensagemId
// }
//
// Uma falha de imagem gera
// um anúncio com embed.
//
// Uma falha no canal NÃO
// desfaz o registro da venda.
//
// A publicação aqui é uma
// tentativa individual.
// O controle de repetição é
// feito por registrarVenda().

async function publicarVenda(
    guild,
    dados
) {
    let config;

    try {
        config =
            getConfig();

    } catch (erro) {
        return {
            url: null,

            erro:
                'Configurações indisponíveis.',

            canalId: null,
            mensagemId: null
        };
    }

    const canalId =
        config.vendas?.canalId;

    if (!canalId) {
        return {
            url: null,

            erro:
                'Canal de vendas não configurado.',

            canalId: null,
            mensagemId: null
        };
    }

    try {
        const canal =
            await guild.channels.fetch(
                canalId
            );

        if (
            !canal ||
            canal.type !==
                ChannelType.GuildText
        ) {
            return {
                url: null,

                erro:
                    'Canal de vendas inválido.',

                canalId: null,
                mensagemId: null
            };
        }

        const embed =
            criarEmbedVenda(
                dados
            );

        const arquivos = [];

        // ==================================
        // GERAR IMAGEM
        // ==================================

        try {
            const png =
                await gerarImagemVenda(
                    guild,
                    dados
                );

            arquivos.push(
                new AttachmentBuilder(
                    png,
                    {
                        name:
                            'inovaresale-compra.png'
                    }
                )
            );

            embed.setImage(
                'attachment://inovaresale-compra.png'
            );

        } catch (erro) {
            console.error(
                '[InovareSale | Venda] ' +
                'Falha ao gerar imagem:',
                erro
            );
        }

        // ==================================
        // BOTÃO PARA COMPRAR
        // ==================================

        const componentes = [];

        const urlCompra =
            obterLinkCompra(
                guild,
                config
            );

        if (urlCompra) {
            componentes.push(
                new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setLabel(
                                'Comprar também'
                            )
                            .setStyle(
                                ButtonStyle.Link
                            )
                            .setURL(
                                urlCompra
                            )
                    )
            );
        }

        // ==================================
        // ENVIAR ANÚNCIO
        // ==================================

        const mensagem =
            await canal.send({
                embeds: [embed],

                files:
                    arquivos,

                components:
                    componentes,

                allowedMentions: {
                    parse: []
                }
            });

        return {
            url:
                mensagem.url,

            erro: null,

            canalId:
                canal.id,

            mensagemId:
                mensagem.id
        };

    } catch (erro) {
        console.error(
            '[InovareSale | Venda] ' +
            'Falha ao publicar anúncio:',
            erro
        );

        return {
            url: null,

            erro:
                String(
                    erro.message ||
                    'Falha ao publicar venda'
                ).slice(0, 500),

            canalId:
                canalId || null,

            mensagemId: null
        };
    }
}

// ==========================================
// PUBLICAR VENDA UMA ÚNICA VEZ
// ==========================================

async function publicarVendaRegistrada(
    guild,
    dados,
    referencia
) {
    const servidorId =
        guild.id;

    const existente =
        SQL.buscarPublicacao.get(
            servidorId,
            referencia
        );

    if (!existente) {
        return {
            url: null,
            erro:
                'Referência de publicação ausente.'
        };
    }

    // ======================================
    // NÃO REPUBLICAR AUTOMATICAMENTE
    // ======================================

    if (
        existente.status !==
        'pendente'
    ) {
        return {
            url:
                existente.canal_id &&
                existente.mensagem_id
                    ? (
                        `https://discord.com/channels/` +
                        `${servidorId}/` +
                        `${existente.canal_id}/` +
                        `${existente.mensagem_id}`
                    )
                    : null,

            erro:
                existente.status === 'enviado'
                    ? null
                    : (
                        'Publicação já tentada. ' +
                        'Aguarda verificação administrativa.'
                    )
        };
    }

    // ======================================
    // MARCAR COMO EM ENVIO
    // ======================================

    atualizarSituacaoPublicacao({
        servidorId,
        referencia,
        status:
            'enviando'
    });

    // ======================================
    // ENVIAR AO DISCORD
    // ======================================

    let resultado;

    try {
        resultado =
            await publicarVenda(
                guild,
                dados
            );

    } catch (erro) {
        resultado = {
            url: null,
            erro:
                erro.message ||
                'Falha inesperada na publicação',

            canalId: null,
            mensagemId: null
        };
    }

    // ======================================
    // GUARDAR O RESULTADO
    // ======================================

    try {
        atualizarSituacaoPublicacao({
            servidorId,
            referencia,

            status:
                resultado.mensagemId
                    ? 'enviado'
                    : 'falha',

            canalId:
                resultado.canalId,

            mensagemId:
                resultado.mensagemId,

            erro:
                resultado.erro
        });

    } catch (erro) {
        console.error(
            '[InovareSale | Venda] ' +
            'Publicação tentada, mas não foi ' +
            'possível salvar seu estado:',
            erro
        );

        return {
            ...resultado,

            erro:
                'Publicação com estado incerto. ' +
                'Verifique o canal antes de reenviar.'
        };
    }

    return resultado;
}

// ==========================================
// ATUALIZAR CARGO DO CLIENTE
// ==========================================

// Erros de permissões ou cargo
// não desfazem a compra.
//
// O total utilizado é o total
// acumulado no SQLite.

async function atualizarCargoCliente(
    guild,
    clienteId,
    totalGasto
) {
    let config;

    try {
        config = getConfig();

    } catch (erro) {
        return {
            cargoId: null,
            erroCargo:
                'Configuração de cargos indisponível.'
        };
    }

    const cargos =
        config.cargos || {};

    const cargoId =
        obterCargoIdeal(
            totalGasto,
            cargos
        ) || null;

    try {
        const membro =
            await guild.members.fetch(
                clienteId
            );

        if (!membro) {
            return {
                cargoId,
                erroCargo:
                    'Cliente não está no servidor.'
            };
        }

        await atualizarCargo(
            membro,
            totalGasto,
            cargos
        );

        return {
            cargoId,
            erroCargo: null
        };

    } catch (erro) {
        console.warn(
            '[InovareSale | Venda] ' +
            'Não foi possível atualizar cargo:',
            erro.message
        );

        return {
            cargoId,
            erroCargo:
                erro.message
        };
    }
}

// ==========================================
// REGISTRAR LOG DA VENDA
// ==========================================

async function registrarLogVenda(
    guild,
    dados,
    referencia
) {
    try {
        return await registrarLogSistema({
            guild,

            tipo:
                TIPOS_LOG?.VENDA_REGISTRADA ||
                TIPOS_LOG?.VENDA_FINALIZADA ||
                'venda_registrada',

            titulo:
                'Venda registrada',

            detalhes:
                `Cliente: <@${dados.clienteId}>\n` +
                `Atendente: <@${dados.registradoPorId}>\n` +
                `Robux: ${
                    formatarRobux(dados.robux)
                }\n` +
                `Valor: ${
                    formatarDinheiro(dados.valor)
                }\n` +
                `Modalidade: ${
                    MODALIDADES[dados.modalidade]
                }\n` +
                `Origem: ${dados.origem}`,

            autorId:
                dados.registradoPorId,

            alvoId:
                dados.clienteId,

            referencia:
                referencia,

            chaveEvento:
                `venda_${referencia}`
        });

    } catch (erro) {
        console.error(
            '[InovareSale | Venda] ' +
            'Falha ao registrar log:',
            erro
        );

        return null;
    }
}

// ==========================================
// REGISTRAR VENDA
// ==========================================

// COMPATIBILIDADE:
//
// commands/venda.js:
//
// registrarVenda({
//   guild,
//   clienteId,
//   valor,
//   robux,
//   registradoPorId
// });
//
// handlers/ticketHandler.js:
//
// registrarVenda({
//   guild,
//   clienteId,
//   valor,
//   robux,
//   registradoPorId,
//   modalidade,
//   usuarioRoblox,
//   pagamento,
//   origem: 'ticket',
//   ticketId
// });
//
// Para vendas manuais, também é
// possível enviar "chaveEvento".
//
// Quando essa chave é fornecida,
// repetição da mesma operação
// não registra outra compra.
//
// Vendas por ticket são protegidas
// pelo próprio ticketId.

// ==========================================
// FUNÇÃO PRINCIPAL
// ==========================================

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

    ticketId = null,

    chaveEvento = null
}) {
    if (!guild?.id) {
        throw new Error(
            'Servidor não informado.'
        );
    }

    // ======================================
    // VALIDAR DADOS
    // ======================================

    const servidorId =
        validarSnowflake(
            guild.id,
            'Servidor'
        );

    const idCliente =
        validarSnowflake(
            clienteId,
            'Cliente'
        );

    const idAtendente =
        validarSnowflake(
            registradoPorId,
            'Atendente'
        );

    const centavos =
        validarValor(
            valor
        );

    const quantidade =
        validarRobux(
            robux
        );

    if (
        !Object.prototype.hasOwnProperty.call(
            MODALIDADES,
            modalidade
        )
    ) {
        throw new Error(
            'Modalidade inválida.'
        );
    }

    if (
        !Object.prototype.hasOwnProperty.call(
            PAGAMENTOS,
            pagamento
        )
    ) {
        throw new Error(
            'Pagamento inválido.'
        );
    }

    if (
        ![
            'manual',
            'ticket'
        ].includes(
            origem
        )
    ) {
        throw new Error(
            'Origem de venda inválida.'
        );
    }

    const idTicket =
        validarTicketId(
            ticketId
        );

    if (
        origem === 'ticket' &&
        idTicket === null
    ) {
        throw new Error(
            'Vendas de ticket exigem um ticketId.'
        );
    }

    if (
        origem === 'manual' &&
        idTicket !== null
    ) {
        throw new Error(
            'Venda manual não pode utilizar ticketId.'
        );
    }

    const chave =
        idTicket
            ? `ticket_${idTicket}`
            : validarChaveEvento(
                chaveEvento
            );

    const reais =
        centavos / 100;

    const agora =
        new Date().toISOString();

    const username =
        normalizarTexto(
            usuarioRoblox,
            50
        );

    // ======================================
    // TRANSAÇÃO SQLITE
    // ======================================

    // Tudo o que altera a compra
    // é feito na mesma transação:
    //
    // - Salvar perfil do cliente
    // - Atualizar totais acumulados
    // - Acrescentar histórico
    // - Registrar venda do ticket
    // - Criar operação da venda
    // - Preparar anúncio
    //
    // Se uma dessas gravações falhar,
    // todas as alterações da transação
    // são desfeitas pelo SQLite.
    //
    // Não há await dentro da transação.

    const resultado =
        db.transaction(() => {
            // ==================================
            // CONSULTAR TICKET
            // ==================================

            const ticket =
                validarTicketParaVenda(
                    idTicket,
                    servidorId,
                    idCliente
                );

            // ==================================
            // EVITAR VENDA REPETIDA
            // ==================================

            const anterior =
                verificarVendaExistente({
                    servidorId,
                    clienteId:
                        idCliente,

                    ticket,

                    chaveEvento:
                        chave,

                    centavos,

                    robux:
                        quantidade
                });

            if (anterior) {
                const salesExistentes =
                    getSales();

                const dadosCliente =
                    copiarDadosCliente(
                        salesExistentes[
                            servidorId
                        ]?.[
                            idCliente
                        ] || {}
                    );

                return {
                    jaRegistrada: true,

                    operacao:
                        anterior.operacao,

                    ticket,

                    dadosCliente,

                    referencia:
                        anterior.operacao
                            ? referenciaPublicacao(
                                anterior.operacao,
                                idTicket
                            )
                            : (
                                idTicket
                                    ? `ticket_${idTicket}`
                                    : null
                            )
                };
            }

            // ==================================
            // VALIDAR ESTADO DO TICKET
            // ==================================

            if (
                ticket &&
                ticket.status !== 'finalizando'
            ) {
                throw new Error(
                    'O ticket precisa estar em ' +
                    'finalização para registrar a venda.'
                );
            }

            // ==================================
            // CARREGAR HISTÓRICO
            // ==================================

            const sales =
                getSales();

            sales[servidorId] ??= {};

            const cliente =
                copiarDadosCliente(
                    sales[servidorId][
                        idCliente
                    ] || {}
                );

            // ==================================
            // ATUALIZAR TOTAIS
            // ==================================

            const novoTotalRobux =
                cliente.totalRobux +
                quantidade;

            const novaQuantidadeCompras =
                cliente.quantidadeCompras +
                1;

            if (
                !Number.isSafeInteger(
                    novoTotalRobux
                ) ||
                !Number.isSafeInteger(
                    novaQuantidadeCompras
                )
            ) {
                throw new Error(
                    'Totais de compras excederam ' +
                    'o limite seguro.'
                );
            }

            cliente.totalGasto =
                Number(
                    (
                        cliente.totalGasto +
                        reais
                    ).toFixed(2)
                );

            cliente.totalRobux =
                novoTotalRobux;

            cliente.quantidadeCompras =
                novaQuantidadeCompras;

            // ==================================
            // PRESERVAR HISTÓRICO ANTERIOR
            // ==================================

            cliente.historico.push({
                valor:
                    reais,

                robux:
                    quantidade,

                data:
                    agora,

                registradoPor:
                    idAtendente,

                modalidade,

                usuarioRoblox:
                    username,

                pagamento,

                origem,

                ...(
                    ticket
                        ? {
                            ticketId:
                                ticket.id
                        }
                        : {}
                )
            });

            sales[servidorId][
                idCliente
            ] = cliente;

            // ==================================
            // SALVAR PERFIL COMPLETO
            // ==================================

            // saveSales() também verifica
            // se o histórico anterior
            // seria preservado.

            saveSales(
                sales
            );

            // ==================================
            // VINCULAR VENDA AO TICKET
            // ==================================

            if (ticket) {
                db.prepare(`
                    INSERT INTO vendas_tickets (
                        ticket_id,
                        cliente_id,
                        valor_centavos,
                        quantidade_robux,
                        registrado_por,
                        registrado_em
                    )

                    VALUES (
                        ?, ?, ?, ?, ?,
                        CURRENT_TIMESTAMP
                    )
                `).run(
                    ticket.id,

                    idCliente,

                    centavos,

                    quantidade,

                    idAtendente
                );
            }

            // ==================================
            // REGISTRAR OPERAÇÃO
            // ==================================

            const insercao =
                SQL.inserirOperacao.run(
                    servidorId,

                    idCliente,

                    idAtendente,

                    origem,

                    idTicket,

                    chave,

                    centavos,

                    quantidade,

                    modalidade,

                    pagamento,

                    username,

                    agora
                );

            const operacao = {
                id:
                    Number(
                        insercao.lastInsertRowid
                    )
            };

            // ==================================
            // PREPARAR ANÚNCIO
            // ==================================

            const referencia =
                referenciaPublicacao(
                    operacao,
                    idTicket
                );

            prepararPublicacao(
                servidorId,
                referencia
            );

            return {
                jaRegistrada: false,

                operacao,

                ticket,

                dadosCliente:
                    cliente,

                referencia
            };
        })();

    // ======================================
    // VENDA ANTERIOR
    // ======================================

    // Não repetimos publicação, logs
    // nem atualização financeira.
    //
    // O ticketHandler poderá continuar
    // a recuperação do status do pedido.

    if (resultado.jaRegistrada) {
        return {
            dadosCliente:
                resultado.dadosCliente,

            cargoId: null,

            erroCargo: null,

            publicacaoUrl: null,

            erroPublicacao: null,

            jaRegistrada: true,

            referencia:
                resultado.referencia,

            log: null,

            erroLog: null
        };
    }

    // ======================================
    // PREPARAR DADOS DO ANÚNCIO
    // ======================================

    const dadosPublicacao = {
        clienteId:
            idCliente,

        registradoPorId:
            idAtendente,

        valor:
            reais,

        robux:
            quantidade,

        modalidade,

        usuarioRoblox:
            username,

        pagamento,

        origem,

        ticketId:
            idTicket,

        totalCompras:
            resultado.dadosCliente
                .quantidadeCompras,

        registradoEm:
            agora
    };

    // ======================================
    // ATUALIZAR CARGO
    // ======================================

    // Um erro de cargo não desfaz
    // uma venda confirmada no SQLite.

    let cargo = {
        cargoId: null,
        erroCargo: null
    };

    try {
        cargo =
            await atualizarCargoCliente(
                guild,

                idCliente,

                resultado.dadosCliente
                    .totalGasto
            );

    } catch (erro) {
        cargo.erroCargo =
            erro.message;
    }

    // ======================================
    // PUBLICAR VENDA
    // ======================================

    let publicacao = {
        url: null,
        erro:
            'Publicação não realizada.'
    };

    try {
        publicacao =
            await publicarVendaRegistrada(
                guild,

                dadosPublicacao,

                resultado.referencia
            );

    } catch (erro) {
        console.error(
            '[InovareSale | Venda] ' +
            'Falha após registrar a compra:',
            erro
        );

        publicacao = {
            url: null,

            erro:
                'Venda salva, mas o anúncio ' +
                'precisa de verificação.'
        };
    }

    // ======================================
    // REGISTRAR LOG
    // ======================================

    let log = null;
    let erroLog = null;

    try {
        log =
            await registrarLogVenda(
                guild,

                dadosPublicacao,

                resultado.referencia
            );

        if (!log) {
            erroLog =
                'Log não pôde ser registrado.';
        }

    } catch (erro) {
        erroLog =
            erro.message;
    }

    // ======================================
    // RESULTADO FINAL
    // ======================================

    return {
        dadosCliente:
            resultado.dadosCliente,

        cargoId:
            cargo.cargoId,

        erroCargo:
            cargo.erroCargo,

        publicacaoUrl:
            publicacao.url,

        erroPublicacao:
            publicacao.erro,

        jaRegistrada: false,

        referencia:
            resultado.referencia,

        log,

        erroLog
    };
}

// ==========================================
// CONSULTAR SITUAÇÃO DE UM ANÚNCIO
// ==========================================

function buscarPublicacaoVenda(
    servidorId,
    referencia
) {
    const servidor =
        validarSnowflake(
            servidorId,
            'Servidor'
        );

    const chave =
        normalizarTexto(
            referencia,
            150
        );

    if (!chave) {
        throw new Error(
            'Referência de venda inválida.'
        );
    }

    return SQL.buscarPublicacao.get(
        servidor,
        chave
    ) || null;
}

// ==========================================
// EXPORTAÇÕES
// ==========================================

module.exports = {
    registrarVenda,

    criarEmbedVenda,

    formatarDinheiro,
    formatarRobux,

    gerarImagemVenda,

    publicarVenda,

    buscarPublicacaoVenda
};
