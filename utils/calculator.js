
'use strict';

// ==========================================
// INOVARESALE BOT 2.0
// CALCULADORA DE ROBUX
// ==========================================
// K = preço em reais a cada 1.000 Robux.
// Taxa Roblox: 30% nas modalidades por gamepass.

const TAXA_ROBLOX = 0.30;
const FATOR_RECEBIMENTO = 1 - TAXA_ROBLOX;

// ==========================================
// VALIDAÇÕES
// ==========================================

function validarQuantidade(valor, campo = 'Quantidade de Robux') {
    const numero = Number(valor);

    if (!Number.isSafeInteger(numero) || numero <= 0) {
        throw new Error(`${campo} deve ser um número inteiro maior que zero.`);
    }

    return numero;
}

function validarK(valor) {
    const numero = Number(valor);

    // null, undefined e zero representam modalidade desativada.
    if (valor === null || valor === undefined || valor === '') {
        throw new Error('Esta modalidade está sem preço K configurado.');
    }

    if (!Number.isFinite(numero) || numero <= 0) {
        throw new Error('O preço K deve ser um número maior que zero.');
    }

    return numero;
}

function validarReais(valor) {
    const numero = Number(valor);

    if (!Number.isFinite(numero) || numero <= 0) {
        throw new Error('O valor em reais deve ser maior que zero.');
    }

    return numero;
}

// ==========================================
// CÁLCULO BÁSICO
// Ex.: 5.000 Robux, K39 = R$ 195,00.
// ==========================================

function calcularPreco(quantidadeRobux, k) {
    const quantidade = validarQuantidade(quantidadeRobux);
    const precoK = validarK(k);

    return (quantidade / 1000) * precoK;
}

// ==========================================
// SEM TAXA
// Quantidade digitada = preço da gamepass.
// A pessoa recebe 70% após a taxa do Roblox.
// Ex.: gamepass 1.000 -> recebe 700 Robux.
// ==========================================

function calcularSemTaxa(robuxGamepass, k) {
    const gamepass = validarQuantidade(robuxGamepass);
    const preco = calcularPreco(gamepass, k);

    return {
        robuxGamepass: gamepass,
        robuxRecebido: Math.floor(gamepass * 7 / 10),
        preco
    };
}

// ==========================================
// TAXADO
// Quantidade digitada = quanto deseja RECEBER.
// O bot calcula a gamepass para cobrir 30% de taxa.
// Ex.: receber 700 -> gamepass 1.000.
// ==========================================

function calcularTaxado(robuxDesejado, k) {
    const desejado = validarQuantidade(robuxDesejado);
    const precoK = validarK(k);

    // 10/7 evita erros de arredondamento da divisão por 0.7.
    const gamepass = Math.ceil(desejado * 10 / 7);

    if (!Number.isSafeInteger(gamepass)) {
        throw new Error('Quantidade de gamepass fora do limite permitido.');
    }

    return {
        robuxGamepass: gamepass,
        robuxRecebido: desejado,
        preco: calcularPreco(gamepass, precoK)
    };
}

// ==========================================
// CALCULAR QUANTOS ROBUX CABEM EM UM ORÇAMENTO
// O retorno conserva os campos do bot anterior.
// ==========================================

function calcularPorReais(valorReais, k) {
    const valor = validarReais(valorReais);
    const precoK = validarK(k);

    const gamepass = Math.floor((valor / precoK) * 1000 + 1e-9);

    if (!Number.isSafeInteger(gamepass) || gamepass < 0) {
        throw new Error('O orçamento informado gerou uma quantidade inválida.');
    }

    return {
        robuxGamepass: gamepass,
        robuxRecebido: Math.floor(gamepass * 7 / 10),
        valor
    };
}

// ==========================================
// FORMATAÇÕES EM PORTUGUÊS DO BRASIL
// ==========================================

function formatarDinheiro(valor) {
    const numero = Number(valor);

    if (!Number.isFinite(numero)) {
        throw new Error('Valor monetário inválido.');
    }

    return numero.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function formatarRobux(valor) {
    const numero = Number(valor);

    if (!Number.isFinite(numero)) {
        throw new Error('Quantidade de Robux inválida.');
    }

    return Math.floor(numero).toLocaleString('pt-BR');
}

// ==========================================
// EXPORTAÇÕES COMPATÍVEIS COM O BOT ATUAL
// ==========================================

module.exports = {
    TAXA_ROBLOX,
    FATOR_RECEBIMENTO,
    calcularPreco,
    calcularSemTaxa,
    calcularTaxado,
    calcularPorReais,
    formatarDinheiro,
    formatarRobux
};
