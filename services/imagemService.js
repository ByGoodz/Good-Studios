
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
// GERADOR DE IMAGENS DA CALCULADORA
// ==========================================

const LARGURA = 1600;
const ALTURA = 900;

const CAMINHO_BASE = path.join(
    __dirname,
    '..',
    'assets',
    'calculadora-base.png'
);

const METODOS = [
    {
        chave: 'viaPlus',
        nome: 'VIA PLUS'
    },
    {
        chave: 'semTaxa',
        nome: 'ROBUX SEM TAXA'
    },
    {
        chave: 'taxado',
        nome: 'ROBUX TAXADO'
    },
    {
        chave: 'viaGrupo',
        nome: 'VIA GRUPO'
    }
];

// ==========================================
// VERIFICAR VALOR K
// ==========================================

function metodoAtivo(valor) {
    return (
        valor !== null &&
        valor !== undefined &&
        valor !== false &&
        Number.isFinite(Number(valor)) &&
        Number(valor) > 0
    );
}

// ==========================================
// FORMATAR VALORES
// ==========================================

function dinheiro(valor) {
    return formatarDinheiro(
        Number(valor)
    );
}

function robux(valor) {
    return formatarRobux(
        Number(valor)
    );
}

// ==========================================
// CALCULAR PREÇOS
// ==========================================

function calcularModalidades({
    quantidadeRobux,
    valorReais,
    config
}) {
    const calc = config.calculadora || {};

    const bloqueados =
        config.tickets?.bloqueados || {};

    const resultado = [];

    for (const metodo of METODOS) {
        const chave = metodo.chave;
        const k = calc[chave];

        const bloqueado =
            bloqueados[chave] === true;

        const ativo = metodoAtivo(k);

        const item = {
            chave,
            nome: metodo.nome,
            k,
            disponivel: ativo && !bloqueado,
            preco: null,
            quantidade: null,
            descricao: ''
        };

        if (!item.disponivel) {
            item.descricao =
                'Modalidade indisponível';

            resultado.push(item);
            continue;
        }

        // ==================================
        // CÁLCULO POR QUANTIDADE DE ROBUX
        // ==================================

        if (quantidadeRobux !== null) {

            if (
                chave === 'viaPlus' ||
                chave === 'viaGrupo'
            ) {
                item.preco = calcularPreco(
                    quantidadeRobux,
                    k
                );

                item.quantidade =
                    quantidadeRobux;

                item.descricao =
                    `Você recebe ${robux(quantidadeRobux)} Robux`;
            }

            if (chave === 'semTaxa') {
                const dados = calcularSemTaxa(
                    quantidadeRobux,
                    k
                );

                item.preco = dados.preco;

                item.quantidade =
                    dados.robuxRecebido;

                item.descricao =
                    `Recebe ${robux(dados.robuxRecebido)} | ` +
                    `Gamepass ${robux(dados.robuxGamepass)}`;
            }

            if (chave === 'taxado') {
                const dados = calcularTaxado(
                    quantidadeRobux,
                    k
                );

                item.preco = dados.preco;

                item.quantidade =
                    dados.robuxRecebido;

                item.descricao =
                    `Recebe ${robux(dados.robuxRecebido)} | ` +
                    `Gamepass ${robux(dados.robuxGamepass)}`;
            }
        }

        // ==================================
        // CÁLCULO A PARTIR DE REAIS
        // ==================================

        if (valorReais !== null) {

            item.preco = valorReais;

            if (
                chave === 'viaPlus' ||
                chave === 'viaGrupo'
            ) {
                item.quantidade = Math.floor(
                    (valorReais / Number(k)) * 1000
                );

                item.descricao =
                    `Você recebe ${robux(item.quantidade)} Robux`;
            }

            if (
                chave === 'semTaxa' ||
                chave === 'taxado'
            ) {
                const dados = calcularPorReais(
                    valorReais,
                    k
                );

                item.quantidade =
                    dados.robuxRecebido;

                item.descricao =
                    `Recebe ${robux(dados.robuxRecebido)} | ` +
                    `Gamepass ${robux(dados.robuxGamepass)}`;
            }
        }

        resultado.push(item);
    }

    return resultado;
}

// ==========================================
// DESENHAR RETÂNGULO ARREDONDADO
// ==========================================

function retangulo(
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
// DESENHAR UMA LINHA DE PREÇO
// ==========================================

function desenharModalidade(
    ctx,
    item,
    indice
) {
    const x = 520;
    const y = 375 + indice * 91;

    const largura = 1030;
    const altura = 80;

    // Fundo da modalidade
    retangulo(
        ctx,
        x,
        y,
        largura,
        altura,
        15
    );

    ctx.fillStyle =
        item.disponivel
            ? 'rgba(0, 0, 0, 0.86)'
            : 'rgba(22, 22, 22, 0.88)';

    ctx.fill();

    // Borda prateada
    ctx.lineWidth = 1.5;

    ctx.strokeStyle =
        item.disponivel
            ? 'rgba(210, 216, 225, 0.65)'
            : 'rgba(100, 100, 100, 0.35)';

    ctx.stroke();

    // Detalhe metálico lateral
    ctx.fillStyle =
        item.disponivel
            ? '#D5D9E0'
            : '#666666';

    ctx.fillRect(
        x + 18,
        y + 17,
        4,
        45
    );

    // Nome da modalidade
    ctx.textAlign = 'left';

    ctx.font = 'bold 27px Arial';

    ctx.fillStyle =
        item.disponivel
            ? '#FFFFFF'
            : '#888888';

    ctx.fillText(
        item.nome,
        x + 43,
        y + 34,
        450
    );

    // Descrição
    ctx.font = '18px Arial';

    ctx.fillStyle =
        item.disponivel
            ? '#BFC3CB'
            : '#777777';

    ctx.fillText(
        item.descricao,
        x + 43,
        y + 60,
        620
    );

    // Valor em destaque
    ctx.textAlign = 'right';

    ctx.font = 'bold 35px Arial';

    ctx.fillStyle =
        item.disponivel
            ? '#FFFFFF'
            : '#808080';

    ctx.fillText(
        item.disponivel
            ? dinheiro(item.preco)
            : 'INDISPONÍVEL',
        x + largura - 24,
        y + 48,
        360
    );

    ctx.textAlign = 'left';
}

// ==========================================
// DESENHAR QUANTIDADE OU ORÇAMENTO
// ==========================================

function desenharQuantidade(
    ctx,
    quantidadeRobux,
    valorReais
) {
    const porRobux =
        quantidadeRobux !== null;

    const titulo = porRobux
        ? 'ROBUX SELECIONADO'
        : 'ORÇAMENTO INFORMADO';

    const valor = porRobux
        ? robux(quantidadeRobux)
        : dinheiro(valorReais);

    // Cobre os campos fixos da base
    // para inserir os valores dinâmicos.
    retangulo(
        ctx,
        77,
        657,
        383,
        132,
        15
    );

    ctx.fillStyle =
        'rgba(0, 0, 0, 0.94)';

    ctx.fill();

    // Título
    ctx.textAlign = 'center';

    ctx.fillStyle = '#D9DDE5';
    ctx.font = 'bold 21px Arial';

    ctx.fillText(
        titulo,
        268,
        691,
        365
    );

    // Quantidade principal
    let tamanho = 76;

    ctx.font = `bold ${tamanho}px Arial`;

    while (
        ctx.measureText(valor).width > 355 &&
        tamanho > 30
    ) {
        tamanho -= 2;
        ctx.font =
            `bold ${tamanho}px Arial`;
    }

    ctx.shadowColor =
        'rgba(255, 255, 255, 0.35)';

    ctx.shadowBlur = 13;

    ctx.fillStyle = '#FFFFFF';

    ctx.fillText(
        valor,
        268,
        765,
        360
    );

    ctx.shadowBlur = 0;

    ctx.textAlign = 'left';
}

// ==========================================
// DESENHAR CABEÇALHO DA TABELA
// ==========================================

function desenharCabecalho(ctx) {
    ctx.fillStyle =
        'rgba(0, 0, 0, 0.83)';

    retangulo(
        ctx,
        520,
        332,
        1030,
        35,
        9
    );

    ctx.fill();

    ctx.fillStyle = '#E9ECF2';
    ctx.font = 'bold 23px Arial';

    ctx.fillText(
        'COMO VOCÊ QUER RECEBER?',
        540,
        357
    );

    ctx.textAlign = 'right';

    ctx.font = '15px Arial';
    ctx.fillStyle = '#ACB2BC';

    ctx.fillText(
        'VALORES ESTIMADOS',
        1528,
        355
    );

    ctx.textAlign = 'left';
}

// ==========================================
// GERAR IMAGEM
// ==========================================

async function gerarImagemCalculadora({
    quantidadeRobux = null,
    valorReais = null,
    config
}) {
    if (!config?.calculadora) {
        throw new Error(
            'Configuração da calculadora não encontrada.'
        );
    }

    const temRobux =
        quantidadeRobux !== null &&
        quantidadeRobux !== undefined;

    const temReais =
        valorReais !== null &&
        valorReais !== undefined;

    if (temRobux === temReais) {
        throw new Error(
            'Informe somente Robux ou somente reais.'
        );
    }

    const quantidade = temRobux
        ? Number(quantidadeRobux)
        : null;

    const reais = temReais
        ? Number(valorReais)
        : null;

    const entrada = temRobux
        ? quantidade
        : reais;

    if (
        !Number.isFinite(entrada) ||
        entrada <= 0
    ) {
        throw new Error(
            'Informe um valor positivo válido.'
        );
    }

    if (
        temRobux &&
        !Number.isSafeInteger(quantidade)
    ) {
        throw new Error(
            'Quantidade de Robux inválida.'
        );
    }

    if (!fs.existsSync(CAMINHO_BASE)) {
        throw new Error(
            'Imagem calculadora-base.png não encontrada na pasta assets.'
        );
    }

    // ======================================
    // CRIAR CANVAS
    // ======================================

    const canvas = createCanvas(
        LARGURA,
        ALTURA
    );

    const ctx = canvas.getContext('2d');

    // ======================================
    // CARREGAR FUNDO PERSONALIZADO
    // ======================================

    const fundo = await loadImage(
        CAMINHO_BASE
    );

    ctx.drawImage(
        fundo,
        0,
        0,
        LARGURA,
        ALTURA
    );

    // ======================================
    // DESENHAR INFORMAÇÕES
    // ======================================

    desenharCabecalho(ctx);

    desenharQuantidade(
        ctx,
        quantidade,
        reais
    );

    const modalidades = calcularModalidades({
        quantidadeRobux: quantidade,
        valorReais: reais,
        config
    });

    for (
        let i = 0;
        i < modalidades.length;
        i++
    ) {
        desenharModalidade(
            ctx,
            modalidades[i],
            i
        );
    }

    // ======================================
    // GERAR PNG
    // ======================================

    return await canvas.encode('png');
}

// ==========================================
// FUNÇÕES DE CONVENIÊNCIA
// ==========================================

async function gerarImagemPorRobux(
    quantidade,
    config
) {
    return gerarImagemCalculadora({
        quantidadeRobux: quantidade,
        config
    });
}

async function gerarImagemPorReais(
    valor,
    config
) {
    return gerarImagemCalculadora({
        valorReais: valor,
        config
    });
}

// ==========================================
// EXPORTAR FUNÇÕES
// ==========================================

module.exports = {
    gerarImagemCalculadora,
    gerarImagemPorRobux,
    gerarImagemPorReais,
    calcularModalidades
};
