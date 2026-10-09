
'use strict';

const fs = require('fs');
const path = require('path');

const {
    createCanvas,
    loadImage
} = require('@napi-rs/canvas');

const {
    calcularPreco,
    calcularSemTaxa,
    calcularTaxado,
    calcularPorReais,
    formatarDinheiro,
    formatarRobux
} = require('../utils/calculator');

// ==========================================
// INOVARESALE BOT 2.0
// CALCULADORA COM TEXTO EM PIXELS
// NAO DEPENDE DE FONTES DA RAILWAY
// ==========================================

const LETRAS = {
    A: ['01110','10001','10001','11111','10001','10001','10001'],
    B: ['11110','10001','10001','11110','10001','10001','11110'],
    C: ['01111','10000','10000','10000','10000','10000','01111'],
    D: ['11110','10001','10001','10001','10001','10001','11110'],
    E: ['11111','10000','10000','11110','10000','10000','11111'],
    F: ['11111','10000','10000','11110','10000','10000','10000'],
    G: ['01111','10000','10000','10111','10001','10001','01111'],
    H: ['10001','10001','10001','11111','10001','10001','10001'],
    I: ['11111','00100','00100','00100','00100','00100','11111'],
    J: ['00111','00010','00010','00010','10010','10010','01100'],
    K: ['10001','10010','10100','11000','10100','10010','10001'],
    L: ['10000','10000','10000','10000','10000','10000','11111'],
    M: ['10001','11011','10101','10101','10001','10001','10001'],
    N: ['10001','11001','10101','10011','10001','10001','10001'],
    O: ['01110','10001','10001','10001','10001','10001','01110'],
    P: ['11110','10001','10001','11110','10000','10000','10000'],
    Q: ['01110','10001','10001','10001','10101','10010','01101'],
    R: ['11110','10001','10001','11110','10100','10010','10001'],
    S: ['01111','10000','10000','01110','00001','00001','11110'],
    T: ['11111','00100','00100','00100','00100','00100','00100'],
    U: ['10001','10001','10001','10001','10001','10001','01110'],
    V: ['10001','10001','10001','10001','10001','01010','00100'],
    W: ['10001','10001','10001','10101','10101','10101','01010'],
    X: ['10001','10001','01010','00100','01010','10001','10001'],
    Y: ['10001','10001','01010','00100','00100','00100','00100'],
    Z: ['11111','00001','00010','00100','01000','10000','11111'],

    '0': ['01110','10011','10101','10101','11001','10001','01110'],
    '1': ['00100','01100','00100','00100','00100','00100','01110'],
    '2': ['01110','10001','00001','00010','00100','01000','11111'],
    '3': ['11110','00001','00001','01110','00001','00001','11110'],
    '4': ['00010','00110','01010','10010','11111','00010','00010'],
    '5': ['11111','10000','10000','11110','00001','00001','11110'],
    '6': ['01110','10000','10000','11110','10001','10001','01110'],
    '7': ['11111','00001','00010','00100','01000','01000','01000'],
    '8': ['01110','10001','10001','01110','10001','10001','01110'],
    '9': ['01110','10001','10001','01111','00001','00001','01110'],

    '.': ['00000','00000','00000','00000','00000','01100','01100'],
    ',': ['00000','00000','00000','00000','01100','01100','00100'],
    ':': ['00000','01100','01100','00000','01100','01100','00000'],
    '$': ['00100','01111','10100','01110','00101','11110','00100'],
    '/': ['00001','00001','00010','00100','01000','10000','10000'],
    '-': ['00000','00000','00000','11111','00000','00000','00000'],
    '+': ['00000','00100','00100','11111','00100','00100','00000'],
    '%': ['11001','11001','00010','00100','01000','10011','10011'],
    '(': ['00010','00100','01000','01000','01000','00100','00010'],
    ')': ['01000','00100','00010','00010','00010','00100','01000'],
    ' ': ['00000','00000','00000','00000','00000','00000','00000']
};

// ==========================================
// TEXTO SEM USAR FONTES
// ==========================================

function normalizar(texto) {
    return String(texto)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();
}

function desenharTexto(
    ctx,
    conteudo,
    x,
    y,
    tamanho,
    cor,
    larguraMax = Infinity,
    alinhar = 'esquerda'
) {
    const letras = normalizar(conteudo);

    let escala = tamanho;

    while (
        letras.length * 6 * escala > larguraMax &&
        escala > 2
    ) {
        escala--;
    }

    const largura = letras.length * 6 * escala;

    const inicio =
        alinhar === 'direita'
            ? x - largura
            : alinhar === 'centro'
                ? x - largura / 2
                : x;

    ctx.fillStyle = cor;

    for (let i = 0; i < letras.length; i++) {
        const linhas =
            LETRAS[letras[i]] || LETRAS[' '];

        for (let linha = 0; linha < 7; linha++) {
            for (let coluna = 0; coluna < 5; coluna++) {
                if (linhas[linha][coluna] === '1') {
                    ctx.fillRect(
                        inicio + (i * 6 + coluna) * escala,
                        y + linha * escala,
                        escala,
                        escala
                    );
                }
            }
        }
    }
}

// ==========================================
// VERIFICAR PRECO K E BLOQUEIOS
// ==========================================

function obterPrecoK(config, chave) {
    const bruto = config?.calculadora?.[chave];

    if (
        bruto === null ||
        bruto === undefined ||
        bruto === '' ||
        bruto === false
    ) {
        return null;
    }

    const preco = Number(bruto);
    const bloqueios = config?.tickets?.bloqueados || {};

    if (
        chave === 'viaGrupo' &&
        bloqueios.viaGrupo !== false
    ) {
        return null;
    }

    if (
        chave !== 'viaGrupo' &&
        bloqueios[chave] === true
    ) {
        return null;
    }

    if (!Number.isFinite(preco) || preco <= 0) {
        return null;
    }

    return preco;
}

// ==========================================
// CALCULAR AS QUATRO MODALIDADES
// ==========================================

function criarLinhas(tipo, valor, config) {
    const metodos = [
        ['viaPlus', 'VIA PLUS'],
        ['semTaxa', 'ROBUX SEM TAXA'],
        ['taxado', 'ROBUX TAXADO'],
        ['viaGrupo', 'VIA GRUPO']
    ];

    return metodos.map(([chave, nome]) => {
        const k = obterPrecoK(config, chave);

        if (!k) {
            return {
                nome,
                k: 'DESATIVADO',
                principal: 'INDISPONIVEL',
                detalhe: 'CONFIGURE NO /SETUP'
            };
        }

        let principal;
        let detalhe;

        if (tipo === 'robux') {
            if (chave === 'semTaxa') {
                const r = calcularSemTaxa(valor, k);

                principal = formatarDinheiro(r.preco);
                detalhe =
                    `RECEBE ${formatarRobux(r.robuxRecebido)} ROBUX`;

            } else if (chave === 'taxado') {
                const r = calcularTaxado(valor, k);

                principal = formatarDinheiro(r.preco);
                detalhe =
                    `GAMEPASS ${formatarRobux(r.robuxGamepass)} ROBUX`;

            } else {
                principal = formatarDinheiro(
                    calcularPreco(valor, k)
                );

                detalhe =
                    `${formatarRobux(valor)} ROBUX`;
            }

        } else {
            if (
                chave === 'semTaxa' ||
                chave === 'taxado'
            ) {
                const r = calcularPorReais(valor, k);

                principal =
                    `${formatarRobux(r.robuxRecebido)} ROBUX`;

                detalhe =
                    `GAMEPASS ${formatarRobux(r.robuxGamepass)}`;

            } else {
                const quantidade = Math.floor(
                    valor / k * 1000
                );

                principal =
                    `${formatarRobux(quantidade)} ROBUX`;

                detalhe =
                    `POR ${formatarDinheiro(valor)}`;
            }
        }

        return {
            nome,
            k: `K ${k.toLocaleString('pt-BR')}`,
            principal,
            detalhe
        };
    });
}

// ==========================================
// GERAR IMAGEM FINAL
// ==========================================

async function gerarImagem(tipo, valor, config = {}) {
    const quantidade = Number(valor);

    if (
        !Number.isFinite(quantidade) ||
        quantidade <= 0 ||
        (
            tipo === 'robux' &&
            !Number.isSafeInteger(quantidade)
        )
    ) {
        throw new Error(
            'Valor invalido para a calculadora.'
        );
    }

    const caminho = path.join(
        __dirname,
        '..',
        'assets',
        'calculadora-base.png'
    );

    if (!fs.existsSync(caminho)) {
        throw new Error(
            'Arquivo assets/calculadora-base.png nao encontrado.'
        );
    }

    const fundo = await loadImage(caminho);

    const canvas = createCanvas(
        fundo.width,
        fundo.height
    );

    const ctx = canvas.getContext('2d');

    // Desenhar a imagem original.
    ctx.drawImage(
        fundo,
        0,
        0,
        canvas.width,
        canvas.height
    );

    // Ajustar coordenadas para o modelo.
    ctx.save();

    ctx.scale(
        canvas.width / 1672,
        canvas.height / 941
    );

    const linhas = criarLinhas(
        tipo,
        quantidade,
        config
    );

    // ======================================
    // QUATRO LINHAS DA CALCULADORA
    // ======================================

    for (let i = 0; i < linhas.length; i++) {
        const linha = linhas[i];

        const y = 355 + i * 94;

        // Fundo escuro da modalidade.
        ctx.fillStyle = 'rgba(6, 7, 10, 0.90)';
        ctx.fillRect(
            520,
            y,
            1032,
            87
        );

        // Moldura prateada.
        ctx.strokeStyle =
            'rgba(213, 213, 230, 0.44)';

        ctx.lineWidth = 2;

        ctx.strokeRect(
            520,
            y,
            1032,
            87
        );

        // Detalhe lateral.
        ctx.fillStyle = '#e7e7ef';

        ctx.fillRect(
            532,
            y + 12,
            4,
            62
        );

        // Nome da modalidade.
        desenharTexto(
            ctx,
            linha.nome,
            554,
            y + 12,
            4,
            '#ffffff',
            500
        );

        // Preco K.
        desenharTexto(
            ctx,
            linha.k,
            554,
            y + 56,
            3,
            '#b6b6c7',
            240
        );

        // Preco ou quantidade principal.
        desenharTexto(
            ctx,
            linha.principal,
            1534,
            y + 12,
            5,
            '#f5f5ff',
            470,
            'direita'
        );

        // Detalhe da entrega.
        desenharTexto(
            ctx,
            linha.detalhe,
            1534,
            y + 58,
            3,
            '#d1d1df',
            725,
            'direita'
        );
    }

    // ======================================
    // QUANTIDADE ESCOLHIDA
    // ======================================

    ctx.fillStyle =
        'rgba(5, 5, 7, 0.95)';

    ctx.fillRect(
        82,
        705,
        374,
        88
    );

    ctx.strokeStyle =
        'rgba(190, 190, 200, 0.6)';

    ctx.lineWidth = 2;

    ctx.strokeRect(
        82,
        705,
        374,
        88
    );

    const selecionado =
        tipo === 'reais'
            ? formatarDinheiro(quantidade)
            : `${formatarRobux(quantidade)} ROBUX`;

    desenharTexto(
        ctx,
        selecionado,
        269,
        724,
        6,
        '#ffffff',
        344,
        'centro'
    );

    ctx.restore();

    // IMPORTANTE:
    // Retorna Buffer, compatível com
    // events/messageCreate.js.
    const png = Buffer.from(
        await canvas.encode('png')
    );

    if (png.length < 1000) {
        throw new Error(
            'Falha ao codificar PNG da calculadora.'
        );
    }

    return png;
}

// ==========================================
// FUNCOES UTILIZADAS PELO MESSAGECREATE
// ==========================================

async function gerarImagemPorRobux(
    robux,
    config
) {
    return gerarImagem(
        'robux',
        robux,
        config
    );
}

async function gerarImagemPorReais(
    reais,
    config
) {
    return gerarImagem(
        'reais',
        reais,
        config
    );
}

async function gerarImagemCalculadora({
    tipo,
    valor,
    config
}) {
    return gerarImagem(
        tipo,
        valor,
        config
    );
}

module.exports = {
    gerarImagemPorRobux,
    gerarImagemPorReais,
    gerarImagemCalculadora
};
    