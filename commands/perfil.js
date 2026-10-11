
'use strict';

const fs = require('fs');
const path = require('path');

const {
    SlashCommandBuilder,
    AttachmentBuilder,
    EmbedBuilder
} = require('discord.js');

const {
    createCanvas,
    loadImage
} = require('@napi-rs/canvas');

const {
    getSales
} = require('../utils/storage');

// ==========================================
// INOVARESALE BOT 3.0
// COMANDO /PERFIL
// ==========================================

// Correção definitiva da escrita:
// não utiliza ctx.fillText().
//
// Todas as letras são desenhadas com
// ctx.fillRect(), sem fontes externas.
//
// Preserva o visual original do perfil.

const W = 1440;
const H = 1024;

const BASE_CANDIDATAS = [
    path.join(
        __dirname,
        '..',
        'assets',
        'perfil-base.png'
    ),

    path.join(
        __dirname,
        '..',
        'assets',
        'perfil-base.png.png'
    ),

    path.join(
        __dirname,
        '..',
        'assets',
        'Dashboard futurista INOVARESALE em roxo e preto.png'
    )
];

// ==========================================
// NÍVEIS DO CLIENTE
// ==========================================

const NIVEIS = [
    {
        minimo: 10000,
        nome: 'SUPREMO',
        cor: '#f3d989'
    },
    {
        minimo: 5000,
        nome: 'ESMERALDA',
        cor: '#76e3b4'
    },
    {
        minimo: 1000,
        nome: 'PLATINA',
        cor: '#bfe2ff'
    },
    {
        minimo: 500,
        nome: 'DIAMANTE',
        cor: '#c7b6ff'
    },
    {
        minimo: 300,
        nome: 'OURO',
        cor: '#ffd67c'
    },
    {
        minimo: 100,
        nome: 'PRATA',
        cor: '#e0e3ef'
    },
    {
        minimo: 0.01,
        nome: 'BRONZE',
        cor: '#dfaa87'
    }
];

// ==========================================
// FONTE PIXEL 5x7
// ==========================================

// Cada caractere é formado por sete linhas
// de cinco pixels.
//
// "1" = pixel aceso.
// "0" = pixel apagado.
//
// Funciona mesmo sem Arial ou outras
// fontes instaladas na Railway.

const FONTE = {
    A: [
        '01110',
        '10001',
        '10001',
        '11111',
        '10001',
        '10001',
        '10001'
    ],

    B: [
        '11110',
        '10001',
        '10001',
        '11110',
        '10001',
        '10001',
        '11110'
    ],

    C: [
        '01111',
        '10000',
        '10000',
        '10000',
        '10000',
        '10000',
        '01111'
    ],

    D: [
        '11110',
        '10001',
        '10001',
        '10001',
        '10001',
        '10001',
        '11110'
    ],

    E: [
        '11111',
        '10000',
        '10000',
        '11110',
        '10000',
        '10000',
        '11111'
    ],

    F: [
        '11111',
        '10000',
        '10000',
        '11110',
        '10000',
        '10000',
        '10000'
    ],

    G: [
        '01111',
        '10000',
        '10000',
        '10111',
        '10001',
        '10001',
        '01111'
    ],

    H: [
        '10001',
        '10001',
        '10001',
        '11111',
        '10001',
        '10001',
        '10001'
    ],

    I: [
        '11111',
        '00100',
        '00100',
        '00100',
        '00100',
        '00100',
        '11111'
    ],

    J: [
        '00111',
        '00010',
        '00010',
        '00010',
        '10010',
        '10010',
        '01100'
    ],

    K: [
        '10001',
        '10010',
        '10100',
        '11000',
        '10100',
        '10010',
        '10001'
    ],

    L: [
        '10000',
        '10000',
        '10000',
        '10000',
        '10000',
        '10000',
        '11111'
    ],

    M: [
        '10001',
        '11011',
        '10101',
        '10101',
        '10001',
        '10001',
        '10001'
    ],

    N: [
        '10001',
        '11001',
        '10101',
        '10011',
        '10001',
        '10001',
        '10001'
    ],

    O: [
        '01110',
        '10001',
        '10001',
        '10001',
        '10001',
        '10001',
        '01110'
    ],

    P: [
        '11110',
        '10001',
        '10001',
        '11110',
        '10000',
        '10000',
        '10000'
    ],

    Q: [
        '01110',
        '10001',
        '10001',
        '10001',
        '10101',
        '10010',
        '01101'
    ],

    R: [
        '11110',
        '10001',
        '10001',
        '11110',
        '10100',
        '10010',
        '10001'
    ],

    S: [
        '01111',
        '10000',
        '10000',
        '01110',
        '00001',
        '00001',
        '11110'
    ],

    T: [
        '11111',
        '00100',
        '00100',
        '00100',
        '00100',
        '00100',
        '00100'
    ],

    U: [
        '10001',
        '10001',
        '10001',
        '10001',
        '10001',
        '10001',
        '01110'
    ],

    V: [
        '10001',
        '10001',
        '10001',
        '10001',
        '10001',
        '01010',
        '00100'
    ],

    W: [
        '10001',
        '10001',
        '10001',
        '10101',
        '10101',
        '10101',
        '01010'
    ],

    X: [
        '10001',
        '10001',
        '01010',
        '00100',
        '01010',
        '10001',
        '10001'
    ],

    Y: [
        '10001',
        '10001',
        '01010',
        '00100',
        '00100',
        '00100',
        '00100'
    ],

    Z: [
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
        '01111',
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
        '11110'
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
        '01100',
        '01100'
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
        '01100',
        '01100',
        '00000',
        '01100',
        '01100',
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

    '_': [
        '00000',
        '00000',
        '00000',
        '00000',
        '00000',
        '00000',
        '11111'
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

    '+': [
        '00000',
        '00100',
        '00100',
        '11111',
        '00100',
        '00100',
        '00000'
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
        '01010',
        '11111',
        '01010',
        '11111',
        '01010',
        '01010'
    ],

    '(': [
        '00010',
        '00100',
        '01000',
        '01000',
        '01000',
        '00100',
        '00010'
    ],

    ')': [
        '01000',
        '00100',
        '00010',
        '00010',
        '00010',
        '00100',
        '01000'
    ],

    '!': [
        '00100',
        '00100',
        '00100',
        '00100',
        '00100',
        '00000',
        '00100'
    ],

    '?': [
        '01110',
        '10001',
        '00001',
        '00010',
        '00100',
        '00000',
        '00100'
    ],

    "'": [
        '00100',
        '00100',
        '01000',
        '00000',
        '00000',
        '00000',
        '00000'
    ],

    '&': [
        '01100',
        '10010',
        '10100',
        '01000',
        '10101',
        '10010',
        '01101'
    ],

    '@': [
        '01110',
        '10001',
        '10111',
        '10101',
        '10111',
        '10000',
        '01111'
    ],

    '=': [
        '00000',
        '11111',
        '00000',
        '11111',
        '00000',
        '00000',
        '00000'
    ]
};

// ==========================================
// NORMALIZAR TEXTO
// ==========================================

// Remove acentos para desenhar letras
// usando a fonte pixel.
//
// Exemplo:
// ESTATÍSTICAS -> ESTATISTICAS
//
// Nomes com símbolos não disponíveis
// usam um ponto de interrogação.

function normalizarTexto(texto) {
    return String(texto ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .split('')
        .map(letra =>
            FONTE[letra] ? letra : '?'
        )
        .join('');
}

// ==========================================
// DESENHAR TEXTO PIXEL
// ==========================================

// A função conserva a assinatura
// do escrever() antigo.
//
// O argumento peso é mantido para
// compatibilidade com o layout.
//
// Nenhuma fonte do sistema é utilizada.

function escrever(
    ctx,
    texto,
    x,
    y,
    tamanho,
    cor = '#ffffff',
    peso = 'normal',
    maxWidth = 0
) {
    const conteudo = normalizarTexto(texto);

    if (!conteudo.length) {
        return;
    }

    const larguraNatural =
        conteudo.length * 6 - 1;

    if (larguraNatural <= 0) {
        return;
    }

    const escalaAltura = tamanho / 7;

    const escalaLargura =
        maxWidth > 0
            ? maxWidth / larguraNatural
            : escalaAltura;

    const escala = Math.min(
        escalaAltura,
        escalaLargura
    );

    if (
        !Number.isFinite(escala) ||
        escala <= 0
    ) {
        return;
    }

    const topo = y - 7 * escala;

    ctx.save();

    ctx.fillStyle = cor;

    for (
        let indice = 0;
        indice < conteudo.length;
        indice++
    ) {
        const letra = conteudo[indice];

        const pixels = FONTE[letra] ||
            FONTE['?'];

        const inicioX =
            x + indice * 6 * escala;

        for (let linha = 0; linha < 7; linha++) {
            for (
                let coluna = 0;
                coluna < 5;
                coluna++
            ) {
                if (
                    pixels[linha][coluna] === '1'
                ) {
                    ctx.fillRect(
                        inicioX + coluna * escala,
                        topo + linha * escala,
                        escala,
                        escala
                    );
                }
            }
        }
    }

    ctx.restore();
}

// ==========================================
// CENTRALIZAR TEXTO PIXEL
// ==========================================

function centralizar(
    ctx,
    texto,
    x,
    y,
    tamanho,
    cor = '#ffffff',
    peso = 'normal',
    maxWidth = 0
) {
    const conteudo = normalizarTexto(texto);

    const larguraNatural =
        Math.max(0, conteudo.length * 6 - 1);

    if (!larguraNatural) {
        return;
    }

    const escala = Math.min(
        tamanho / 7,
        maxWidth > 0
            ? maxWidth / larguraNatural
            : tamanho / 7
    );

    const larguraReal =
        larguraNatural * escala;

    escrever(
        ctx,
        conteudo,
        x - larguraReal / 2,
        y,
        tamanho,
        cor,
        peso,
        maxWidth
    );
}

// ==========================================
// FORMATAÇÕES
// ==========================================

function dinheiro(valor) {
    const numero = Number(valor || 0);

    return (
        Number.isFinite(numero)
            ? numero
            : 0
    ).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function numero(valor) {
    const n = Number(valor || 0);

    return Math.floor(
        Number.isFinite(n) ? n : 0
    ).toLocaleString('pt-BR');
}

// ==========================================
// LOCALIZAR IMAGEM-BASE
// ==========================================

function acharBase() {
    for (const caminho of BASE_CANDIDATAS) {
        if (fs.existsSync(caminho)) {
            return caminho;
        }
    }

    return null;
}

// ==========================================
// CONSULTAR DADOS REAIS DO CLIENTE
// ==========================================

function obterDadosPerfil(guildId, userId) {
    const vendas = getSales() || {};

    const usuario =
        vendas?.[guildId]?.[userId] || {};

    const historico =
        Array.isArray(usuario.historico)
            ? usuario.historico
            : [];

    const agora = new Date();

    const vendasDoMes = historico.filter(
        item => {
            const data = new Date(item.data);

            return (
                !Number.isNaN(data.getTime()) &&
                data.getFullYear() === agora.getFullYear() &&
                data.getMonth() === agora.getMonth()
            );
        }
    );

    const maiorCompra = historico.reduce(
        (maior, item) => {
            return Math.max(
                maior,
                Number(item.valor || 0)
            );
        },
        0
    );

    return {
        totalGasto: Number(
            usuario.totalGasto || 0
        ),

        totalRobux: Number(
            usuario.totalRobux || 0
        ),

        quantidadeCompras: Number(
            usuario.quantidadeCompras ||
            historico.length ||
            0
        ),

        maiorCompra,

        gastoMensal: vendasDoMes.reduce(
            (total, item) =>
                total + Number(item.valor || 0),
            0
        )
    };
}

// ==========================================
// IDENTIFICAR NÍVEL
// ==========================================

function obterNivel(totalGasto) {
    return NIVEIS.find(
        nivel => totalGasto >= nivel.minimo
    ) || {
        nome: 'VISITANTE',
        cor: '#b7b7c9'
    };
}

function obterProximoNivel(totalGasto) {
    const ordenado = [...NIVEIS]
        .sort((a, b) => a.minimo - b.minimo);

    return ordenado.find(
        nivel => totalGasto < nivel.minimo
    ) || null;
}

// ==========================================
// RETÂNGULO ARREDONDADO
// ==========================================

function arredondado(
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

    ctx.moveTo(x + r, y);
    ctx.lineTo(x + largura - r, y);

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

    ctx.lineTo(x + r, y + altura);

    ctx.quadraticCurveTo(
        x,
        y + altura,
        x,
        y + altura - r
    );

    ctx.lineTo(x, y + r);

    ctx.quadraticCurveTo(
        x,
        y,
        x + r,
        y
    );

    ctx.closePath();
}

// ==========================================
// DESENHAR CARTÃO DE ESTATÍSTICA
// ==========================================

function desenharCard(
    ctx,
    x,
    y,
    largura,
    altura,
    titulo,
    valor,
    corValor = '#f3efff'
) {
    const gradiente = ctx.createLinearGradient(
        x,
        y,
        x + largura,
        y + altura
    );

    gradiente.addColorStop(
        0,
        '#1e1329'
    );

    gradiente.addColorStop(
        1,
        '#0d0a14'
    );

    arredondado(
        ctx,
        x,
        y,
        largura,
        altura,
        18
    );

    ctx.fillStyle = gradiente;
    ctx.fill();

    ctx.strokeStyle = '#7b4db0';
    ctx.lineWidth = 2;
    ctx.stroke();

    arredondado(
        ctx,
        x + 18,
        y + 18,
        5,
        altura - 36,
        3
    );

    ctx.fillStyle = '#b05cff';
    ctx.fill();

    escrever(
        ctx,
        titulo,
        x + 38,
        y + 46,
        20,
        '#c9bed8',
        'bold',
        largura - 60
    );

    escrever(
        ctx,
        valor,
        x + 38,
        y + 98,
        34,
        corValor,
        'bold',
        largura - 65
    );
}

// ==========================================
// CARREGAR AVATAR REAL
// ==========================================

async function carregarAvatar(usuario) {
    try {
        const url = usuario.displayAvatarURL({
            extension: 'png',
            size: 256
        });

        const resposta = await fetch(url, {
            signal: AbortSignal.timeout(
                10000
            )
        });

        if (!resposta.ok) {
            return null;
        }

        return await loadImage(
            Buffer.from(
                await resposta.arrayBuffer()
            )
        );

    } catch (erro) {
        console.warn(
            '[InovareSale | Perfil] Avatar indisponível:',
            erro.message
        );

        return null;
    }
}

// ==========================================
// FUNDO RESERVA
// ==========================================

function desenharFundoFallback(ctx) {
    const gradiente = ctx.createLinearGradient(
        0,
        0,
        W,
        H
    );

    gradiente.addColorStop(0, '#1d1230');
    gradiente.addColorStop(0.5, '#090811');
    gradiente.addColorStop(1, '#160d24');

    ctx.fillStyle = gradiente;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle =
        'rgba(176, 92, 255, 0.06)';

    for (let i = 0; i < 20; i++) {
        ctx.fillRect(
            40 + i * 70,
            0,
            1,
            H
        );
    }

    for (let i = 0; i < 15; i++) {
        ctx.fillRect(
            0,
            40 + i * 60,
            W,
            1
        );
    }
}

// ==========================================
// DESENHAR LOSANGO DOS EMBLEMAS
// ==========================================

// Substitui o símbolo "◆" que antes
// dependia de uma fonte instalada.

function desenharLosango(
    ctx,
    centroX,
    centroY,
    tamanho,
    conquistado
) {
    const metade = tamanho / 2;

    ctx.save();

    ctx.beginPath();

    ctx.moveTo(
        centroX,
        centroY - metade
    );

    ctx.lineTo(
        centroX + metade,
        centroY
    );

    ctx.lineTo(
        centroX,
        centroY + metade
    );

    ctx.lineTo(
        centroX - metade,
        centroY
    );

    ctx.closePath();

    if (conquistado) {
        ctx.fillStyle = '#dab0ff';
        ctx.fill();

        ctx.strokeStyle = '#f3ddff';
        ctx.lineWidth = 2;
        ctx.stroke();

    } else {
        ctx.strokeStyle = '#62516f';
        ctx.lineWidth = 4;
        ctx.stroke();
    }

    ctx.restore();
}

// ==========================================
// GERAR IMAGEM DO PERFIL
// ==========================================

async function gerarImagemPerfil(
    usuario,
    dados
) {
    const canvas = createCanvas(
        W,
        H
    );

    const ctx = canvas.getContext('2d');

    // ======================================
    // IMAGEM-BASE ORIGINAL
    // ======================================

    const basePath = acharBase();

    if (basePath) {
        try {
            const base = await loadImage(
                basePath
            );

            ctx.drawImage(
                base,
                0,
                0,
                W,
                H
            );

        } catch (erro) {
            console.warn(
                '[Perfil] Não foi possível carregar a imagem-base:',
                erro.message
            );

            desenharFundoFallback(ctx);
        }

    } else {
        desenharFundoFallback(ctx);
    }

    // Escurece textos de exemplo
    // presentes na imagem original.
    ctx.fillStyle =
        'rgba(7, 5, 12, 0.70)';

    ctx.fillRect(
        0,
        0,
        W,
        H
    );

    // ======================================
    // MOLDURA ROXA
    // ======================================

    arredondado(
        ctx,
        32,
        31,
        W - 64,
        H - 62,
        30
    );

    ctx.strokeStyle = '#a34cff';
    ctx.lineWidth = 4;
    ctx.stroke();

    arredondado(
        ctx,
        47,
        47,
        W - 94,
        H - 94,
        24
    );

    ctx.strokeStyle = '#5c3e76';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // ======================================
    // CABEÇALHO
    // ======================================

    arredondado(
        ctx,
        68,
        69,
        W - 136,
        255,
        22
    );

    ctx.fillStyle = '#0c0914';
    ctx.fill();

    ctx.strokeStyle = '#70459d';
    ctx.lineWidth = 2;
    ctx.stroke();

    const nivel = obterNivel(
        dados.totalGasto
    );

    const proximoNivel =
        obterProximoNivel(
            dados.totalGasto
        );

    // ======================================
    // AVATAR DO CLIENTE
    // ======================================

    const avatar = await carregarAvatar(
        usuario
    );

    ctx.save();

    ctx.beginPath();
    ctx.arc(
        192,
        193,
        92,
        0,
        Math.PI * 2
    );
    ctx.closePath();
    ctx.clip();

    if (avatar) {
        ctx.drawImage(
            avatar,
            100,
            101,
            184,
            184
        );

    } else {
        ctx.fillStyle = '#241630';
        ctx.fillRect(
            100,
            101,
            184,
            184
        );

        centralizar(
            ctx,
            '?',
            192,
            225,
            90,
            '#e9dcfb',
            'bold'
        );
    }

    ctx.restore();

    ctx.beginPath();
    ctx.arc(
        192,
        193,
        94,
        0,
        Math.PI * 2
    );

    ctx.strokeStyle = '#c06cff';
    ctx.lineWidth = 7;
    ctx.stroke();

    // ======================================
    // NOME DO CLIENTE
    // ======================================

    escrever(
        ctx,
        String(
            usuario.username || 'Cliente'
        ).slice(0, 22),
        322,
        156,
        48,
        '#ffffff',
        'bold',
        520
    );

    // ======================================
    // ID DO DISCORD
    // ======================================

    escrever(
        ctx,
        `ID: ${usuario.id}`,
        325,
        201,
        20,
        '#b6a8c9',
        'normal',
        530
    );

    // ======================================
    // CLASSIFICAÇÃO DO CLIENTE
    // ======================================

    arredondado(
        ctx,
        323,
        225,
        330,
        66,
        14
    );

    ctx.fillStyle = '#191221';
    ctx.fill();

    ctx.strokeStyle = nivel.cor;
    ctx.lineWidth = 2;
    ctx.stroke();

    escrever(
        ctx,
        `CLIENTE ${nivel.nome}`,
        344,
        267,
        27,
        nivel.cor,
        'bold',
        290
    );

    // ======================================
    // IDENTIDADE DA LOJA
    // ======================================

    escrever(
        ctx,
        'INOVARESALE',
        935,
        162,
        44,
        '#f6f2fb',
        'bold',
        390
    );

    escrever(
        ctx,
        'PERFIL DE COMPRAS',
        986,
        206,
        19,
        '#cf8eff',
        'bold',
        270
    );

    // ======================================
    // TÍTULO DAS ESTATÍSTICAS
    // ======================================

    escrever(
        ctx,
        'SUAS ESTATÍSTICAS',
        78,
        381,
        28,
        '#ffffff',
        'bold'
    );

    // ======================================
    // SEIS CARTÕES DE ESTATÍSTICAS
    // ======================================

    const xs = [
        76,
        520,
        964
    ];

    desenharCard(
        ctx,
        xs[0],
        412,
        400,
        145,
        'TOTAL GASTO',
        dinheiro(
            dados.totalGasto
        ),
        '#d083ff'
    );

    desenharCard(
        ctx,
        xs[1],
        412,
        400,
        145,
        'COMPRAS REALIZADAS',
        numero(
            dados.quantidadeCompras
        )
    );

    desenharCard(
        ctx,
        xs[2],
        412,
        400,
        145,
        'MAIOR COMPRA',
        dinheiro(
            dados.maiorCompra
        )
    );

    desenharCard(
        ctx,
        xs[0],
        574,
        400,
        145,
        'ROBUX COMPRADOS',
        `${numero(dados.totalRobux)} Robux`,
        '#d083ff'
    );

    desenharCard(
        ctx,
        xs[1],
        574,
        400,
        145,
        'GASTO NESTE MÊS',
        dinheiro(
            dados.gastoMensal
        )
    );

    desenharCard(
        ctx,
        xs[2],
        574,
        400,
        145,
        'PRÓXIMO NÍVEL',
        proximoNivel
            ? (
                'Faltam ' +
                dinheiro(
                    Math.max(
                        0,
                        proximoNivel.minimo -
                        dados.totalGasto
                    )
                )
            )
            : 'NÍVEL MÁXIMO',
        '#dfb7ff'
    );

    // ======================================
    // TÍTULO DOS EMBLEMAS
    // ======================================

    escrever(
        ctx,
        'EMBLEMAS',
        78,
        777,
        28,
        '#ffffff',
        'bold'
    );

    // ======================================
    // SETE EMBLEMAS
    // ======================================

    const emblemas = [
        {
            minimo: 0.01,
            titulo: 'BRONZE'
        },
        {
            minimo: 100,
            titulo: 'PRATA'
        },
        {
            minimo: 300,
            titulo: 'OURO'
        },
        {
            minimo: 500,
            titulo: 'DIAMANTE'
        },
        {
            minimo: 1000,
            titulo: 'PLATINA'
        },
        {
            minimo: 5000,
            titulo: 'ESMERALDA'
        },
        {
            minimo: 10000,
            titulo: 'SUPREMO'
        }
    ];

    for (
        let i = 0;
        i < emblemas.length;
        i++
    ) {
        const emblema = emblemas[i];

        const bx =
            75 + i * 184;

        const conquistado =
            dados.totalGasto >=
            emblema.minimo;

        // Fundo do emblema.
        arredondado(
            ctx,
            bx,
            808,
            166,
            143,
            16
        );

        ctx.fillStyle = conquistado
            ? '#26153a'
            : '#0d0a14';

        ctx.fill();

        ctx.strokeStyle = conquistado
            ? '#b663fd'
            : '#463555';

        ctx.lineWidth = 2;
        ctx.stroke();

        // Símbolo desenhado sem fontes.
        desenharLosango(
            ctx,
            bx + 83,
            862,
            48,
            conquistado
        );

        // Nome do emblema em pixels.
        centralizar(
            ctx,
            emblema.titulo,
            bx + 83,
            925,
            21,
            conquistado
                ? '#e9dfff'
                : '#796a87',
            'bold',
            145
        );
    }

    // ======================================
    // EXPORTAR IMAGEM
    // ======================================

    return await canvas.encode('png');
}

// ==========================================
// COMANDO /PERFIL
// ==========================================

module.exports = {

    data: new SlashCommandBuilder()
        .setName('perfil')
        .setDescription(
            'Veja o perfil de compras de um cliente'
        )
        .setDMPermission(false)
        .addUserOption(option =>
            option
                .setName('usuario')
                .setDescription(
                    'Cliente que terá o perfil exibido'
                )
                .setRequired(false)
        ),

    async execute(interaction) {
        if (!interaction.inGuild()) {
            return interaction.reply({
                content:
                    'Este comando só pode ser usado no servidor.',
                ephemeral: true
            });
        }

        await interaction.deferReply();

        const usuario =
            interaction.options.getUser('usuario') ||
            interaction.user;

        try {
            // ==================================
            // BUSCAR COMPRAS REAIS
            // ==================================

            const dados = obterDadosPerfil(
                interaction.guildId,
                usuario.id
            );

            // ==================================
            // GERAR IMAGEM SEM FONTES
            // ==================================

            const imagem = await gerarImagemPerfil(
                usuario,
                dados
            );

            const arquivo = new AttachmentBuilder(
                imagem,
                {
                    name: 'perfil-inovaresale.png'
                }
            );

            // ==================================
            // ENVIAR PERFIL
            // ==================================

            await interaction.editReply({
                files: [arquivo],
                allowedMentions: {
                    parse: []
                }
            });

        } catch (erro) {
            console.error(
                '[InovareSale | Perfil] Erro:',
                erro
            );

            // ==================================
            // EMBED DE ERRO
            // ==================================

            const embed = new EmbedBuilder()
                .setColor(0x9951CB)
                .setTitle(
                    'INOVARESALE | PERFIL'
                )
                .setDescription(
                    'Não foi possível gerar a imagem ' +
                    'do perfil neste momento.\n' +
                    'Tente novamente mais tarde.'
                );

            await interaction.editReply({
                embeds: [embed]
            });
        }
    }
};
