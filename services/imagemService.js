const fs = require('fs');
const path = require('path');
const {
    createCanvas,
    loadImage,
    GlobalFonts
} = require('@napi-rs/canvas');

const { AttachmentBuilder } = require('discord.js');

const {
    calcularPreco,
    calcularSemTaxa,
    calcularTaxado,
    calcularPorReais,
    formatarDinheiro,
    formatarRobux
} = require('../utils/calculator');


// ==========================================
// CAMINHOS
// ==========================================

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const CALCULADORA_BASE = path.join(ASSETS_DIR, 'calculadora-base.png');


// ==========================================
// FONTES
// ==========================================

function registrarFontes() {
    const fontesPossiveis = [
        path.join(process.cwd(), 'assets', 'Montserrat-Bold.ttf'),
        path.join(process.cwd(), 'assets', 'Montserrat-Regular.ttf'),
        path.join(process.cwd(), 'assets', 'Poppins-Bold.ttf'),
        path.join(process.cwd(), 'assets', 'Poppins-Regular.ttf')
    ];

    for (const fonte of fontesPossiveis) {
        if (fs.existsSync(fonte)) {
            try {
                GlobalFonts.registerFromPath(fonte, path.basename(fonte, '.ttf'));
            } catch (_) {}
        }
    }
}

registrarFontes();


// ==========================================
// HELPERS
// ==========================================

function metodoAtivo(valor) {
    return (
        valor !== null &&
        valor !== undefined &&
        valor !== false &&
        Number(valor) > 0
    );
}

function textoCentralizado(ctx, texto, x, y, largura) {
    const medidas = ctx.measureText(texto);
    const posX = x + ((largura - medidas.width) / 2);
    ctx.fillText(texto, posX, y);
}

function textoLimitado(ctx, texto, x, y, larguraMax) {
    let finalTexto = String(texto);

    while (ctx.measureText(finalTexto).width > larguraMax && finalTexto.length > 0) {
        finalTexto = finalTexto.slice(0, -1);
    }

    if (finalTexto !== texto) {
        finalTexto = finalTexto.slice(0, -3) + '...';
    }

    ctx.fillText(finalTexto, x, y);
}

function criarLinhasPorRobux(robux, config) {
    const calc = config.calculadora || {};
    const linhas = [];

    if (metodoAtivo(calc.viaPlus)) {
        const preco = calcularPreco(robux, calc.viaPlus);

        linhas.push({
            titulo: `Via Plus • K${calc.viaPlus}`,
            valor: formatarDinheiro(preco),
            extra: `${formatarRobux(robux)} Robux`
        });
    }

    if (metodoAtivo(calc.viaGrupo)) {
        const preco = calcularPreco(robux, calc.viaGrupo);

        linhas.push({
            titulo: `Via Grupo • K${calc.viaGrupo}`,
            valor: formatarDinheiro(preco),
            extra: `${formatarRobux(robux)} Robux`
        });
    }

    if (metodoAtivo(calc.semTaxa)) {
        const resultado = calcularSemTaxa(robux, calc.semTaxa);

        linhas.push({
            titulo: `Robux Sem Taxa • K${calc.semTaxa}`,
            valor: formatarDinheiro(resultado.preco),
            extra: `Recebe ${formatarRobux(resultado.robuxRecebido)} • Gamepass ${formatarRobux(resultado.robuxGamepass)}`
        });
    }

    if (metodoAtivo(calc.taxado)) {
        const resultado = calcularTaxado(robux, calc.taxado);

        linhas.push({
            titulo: `Robux Taxado • K${calc.taxado}`,
            valor: formatarDinheiro(resultado.preco),
            extra: `Recebe ${formatarRobux(resultado.robuxRecebido)} • Gamepass ${formatarRobux(resultado.robuxGamepass)}`
        });
    }

    return linhas.slice(0, 4);
}

function criarLinhasPorReais(valorReais, config) {
    const calc = config.calculadora || {};
    const linhas = [];

    if (metodoAtivo(calc.viaPlus)) {
        const robux = Math.floor((valorReais / Number(calc.viaPlus)) * 1000);

        linhas.push({
            titulo: `Via Plus • K${calc.viaPlus}`,
            valor: `${formatarRobux(robux)} Robux`,
            extra: `Com ${formatarDinheiro(valorReais)}`
        });
    }

    if (metodoAtivo(calc.viaGrupo)) {
        const robux = Math.floor((valorReais / Number(calc.viaGrupo)) * 1000);

        linhas.push({
            titulo: `Via Grupo • K${calc.viaGrupo}`,
            valor: `${formatarRobux(robux)} Robux`,
            extra: `Com ${formatarDinheiro(valorReais)}`
        });
    }

    if (metodoAtivo(calc.semTaxa)) {
        const resultado = calcularPorReais(valorReais, calc.semTaxa);

        linhas.push({
            titulo: `Robux Sem Taxa • K${calc.semTaxa}`,
            valor: `${formatarRobux(resultado.robuxRecebido)} Robux`,
            extra: `Gamepass ${formatarRobux(resultado.robuxGamepass)}`
        });
    }

    if (metodoAtivo(calc.taxado)) {
        const resultado = calcularPorReais(valorReais, calc.taxado);

        linhas.push({
            titulo: `Robux Taxado • K${calc.taxado}`,
            valor: `${formatarRobux(resultado.robuxRecebido)} Robux`,
            extra: `Gamepass ${formatarRobux(resultado.robuxGamepass)}`
        });
    }

    return linhas.slice(0, 4);
}


// ==========================================
// GERAR IMAGEM PRINCIPAL
// ==========================================

async function gerarImagemCalculadora({
    tipo,
    valor,
    config
}) {
    if (!fs.existsSync(CALCULADORA_BASE)) {
        throw new Error('[InovareSale] calculadora-base.png não encontrado em /assets');
    }

    const base = await loadImage(CALCULADORA_BASE);

    const canvas = createCanvas(base.width, base.height);
    const ctx = canvas.getContext('2d');

    // ======================================
    // PASSO 1: DESENHAR A BASE PRIMEIRO
    // ======================================
    // Esse é o ponto principal da correção.
    ctx.drawImage(base, 0, 0, base.width, base.height);

    const w = canvas.width;
    const h = canvas.height;

    // ======================================
    // ESTILOS
    // ======================================
    const corPrincipal = '#ffffff';
    const corSecundaria = '#cfcfe6';
    const corDestaque = '#ffffff';

    // Caixa esquerda (robux selecionado)
    ctx.fillStyle = corPrincipal;
    ctx.font = `bold ${Math.floor(w * 0.030)}px Arial`;

    const textoSelecionado =
        tipo === 'reais'
            ? formatarDinheiro(valor)
            : `${formatarRobux(valor)}`;

    textoCentralizado(
        ctx,
        textoSelecionado,
        w * 0.055,
        h * 0.835,
        w * 0.205
    );

    // Subtexto da esquerda
    ctx.fillStyle = corSecundaria;
    ctx.font = `${Math.floor(w * 0.013)}px Arial`;

    const subtituloSelecionado =
        tipo === 'reais'
            ? 'VALOR INFORMADO'
            : 'ROBUX INFORMADO';

    textoCentralizado(
        ctx,
        subtituloSelecionado,
        w * 0.055,
        h * 0.885,
        w * 0.205
    );

    // ======================================
    // LINHAS PRINCIPAIS
    // ======================================
    const linhas =
        tipo === 'reais'
            ? criarLinhasPorReais(valor, config)
            : criarLinhasPorRobux(valor, config);

    const posicoesY = [
        h * 0.405,
        h * 0.500,
        h * 0.595,
        h * 0.690
    ];

    for (let i = 0; i < linhas.length; i++) {
        const linha = linhas[i];
        const yBase = posicoesY[i];

        // título da modalidade
        ctx.fillStyle = corPrincipal;
        ctx.font = `bold ${Math.floor(w * 0.020)}px Arial`;
        textoLimitado(
            ctx,
            linha.titulo,
            w * 0.375,
            yBase,
            w * 0.40
        );

        // valor principal
        ctx.fillStyle = corDestaque;
        ctx.font = `bold ${Math.floor(w * 0.026)}px Arial`;
        textoLimitado(
            ctx,
            linha.valor,
            w * 0.375,
            yBase + (h * 0.040),
            w * 0.26
        );

        // detalhe extra
        ctx.fillStyle = corSecundaria;
        ctx.font = `${Math.floor(w * 0.014)}px Arial`;
        textoLimitado(
            ctx,
            linha.extra,
            w * 0.375,
            yBase + (h * 0.073),
            w * 0.41
        );
    }

    // Se tiver menos de 4 linhas, preenche aviso
    if (linhas.length === 0) {
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.floor(w * 0.022)}px Arial`;
        textoLimitado(
            ctx,
            'Nenhuma modalidade ativa no /setup',
            w * 0.375,
            h * 0.48,
            w * 0.40
        );
    }

    const buffer = await canvas.encode('png');

    return new AttachmentBuilder(buffer, {
        name: 'calculadora.png'
    });
}


// ==========================================
// WRAPPERS
// ==========================================

async function gerarImagemPorRobux(robux, config) {
    return gerarImagemCalculadora({
        tipo: 'robux',
        valor: robux,
        config
    });
}

async function gerarImagemPorReais(valorReais, config) {
    return gerarImagemCalculadora({
        tipo: 'reais',
        valor: valorReais,
        config
    });
}


// ==========================================
// EXPORTS
// ==========================================

module.exports = {
    gerarImagemCalculadora,
    gerarImagemPorRobux,
    gerarImagemPorReais
};