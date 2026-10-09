
'use strict';

const { PermissionFlagsBits, ChannelType } = require('discord.js');

// ==========================================
// INOVARESALE BOT 2.0
// VALIDACOES E ENTRADAS DO SISTEMA
// ==========================================

const MAX_ROBUX = 50_000_000;
const MAX_REAIS = 1_000_000;

const MODALIDADES = Object.freeze({
    viaPlus: 'Via Plus',
    semTaxa: 'Robux Sem Taxa',
    taxado: 'Robux Taxado',
    viaGrupo: 'Robux Via Grupo'
});

const PAGAMENTOS = Object.freeze({
    pix: 'PIX',
    mm: 'Solicitar MM'
});

// ==========================================
// IDENTIFICADORES DO DISCORD
// ==========================================

function validarSnowflake(valor, descricao = 'ID do Discord') {
    const id = String(valor ?? '').trim();

    if (!/^\d{15,22}$/.test(id)) {
        throw new Error(`${descricao} inválido.`);
    }

    return id;
}

// ==========================================
// INTERPRETAR QUANTIDADE DE ROBUX
// Aceita 5000, 5k, 5,5k e 5.000.
// Não confunde quantidade com dinheiro.
// ==========================================

function interpretarQuantidadeRobux(entrada) {
    if (typeof entrada === 'number') {
        return validarQuantidadeRobux(entrada);
    }

    let texto = String(entrada ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '');

    if (!texto) {
        throw new Error('Informe a quantidade de Robux.');
    }

    let quantidade;

    if (texto.endsWith('k')) {
        const parte = texto.slice(0, -1);

        if (!/^\d+(?:[.,]\d{1,3})?$/.test(parte)) {
            throw new Error('Use um valor como 5k ou 5,5k.');
        }

        quantidade = Number(parte.replace(',', '.')) * 1000;
    } else {
        if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(texto)) {
            throw new Error('Use uma quantidade inteira, como 5000 ou 5.000.');
        }

        quantidade = Number(texto.replace(/\./g, ''));
    }

    return validarQuantidadeRobux(quantidade);
}

function validarQuantidadeRobux(valor) {
    const quantidade = Number(valor);

    if (
        !Number.isSafeInteger(quantidade) ||
        quantidade < 1 ||
        quantidade > MAX_ROBUX
    ) {
        throw new Error(
            `A quantidade deve ser um inteiro de 1 até ${MAX_ROBUX.toLocaleString('pt-BR')} Robux.`
        );
    }

    return quantidade;
}

// ==========================================
// INTERPRETAR DINHEIRO BRASILEIRO
// Aceita R$ 39, R$ 39,50 e R$ 1.000,50.
// O retorno é em reais, não em centavos.
// ==========================================

function interpretarValorReais(entrada) {
    if (typeof entrada === 'number') {
        return validarValorReais(entrada);
    }

    const texto = String(entrada ?? '')
        .trim()
        .replace(/^R\$\s*/i, '')
        .replace(/\s+/g, '');

    if (!texto) {
        throw new Error('Informe um valor em reais.');
    }

    let normalizado;

    if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(texto)) {
        normalizado = texto.replace(/\./g, '').replace(',', '.');
    } else if (/^\d+(?:,\d{1,2})?$/.test(texto)) {
        normalizado = texto.replace(',', '.');
    } else if (/^\d+\.\d{1,2}$/.test(texto)) {
        normalizado = texto;
    } else {
        throw new Error('Valor inválido. Exemplos: 39,50 ou R$ 100,00.');
    }

    return validarValorReais(Number(normalizado));
}

function validarValorReais(valor) {
    const reais = Number(valor);
    const centavos = Math.round(reais * 100);

    if (
        !Number.isFinite(reais) ||
        reais <= 0 ||
        reais > MAX_REAIS ||
        !Number.isSafeInteger(centavos) ||
        Math.abs(reais * 100 - centavos) > 0.00001
    ) {
        throw new Error('Informe um valor em reais positivo, com até duas casas decimais.');
    }

    return centavos / 100;
}

function converterParaCentavos(valor) {
    return Math.round(validarValorReais(valor) * 100);
}

// ==========================================
// CONFIGURACAO DO K
// ==========================================

function validarPrecoK(valor, permitirDesativar = false) {
    if (
        valor === null ||
        valor === undefined ||
        String(valor).trim().toUpperCase() === 'OFF'
    ) {
        if (permitirDesativar) return null;
        throw new Error('O preço K não está configurado.');
    }

    const preco = Number(String(valor).trim().replace(',', '.').replace(/^K/i, ''));

    if (!Number.isFinite(preco) || preco <= 0 || preco > MAX_REAIS) {
        throw new Error('O preço K precisa ser maior que zero.');
    }

    return preco;
}

// ==========================================
// DADOS DA COMPRA
// ==========================================

function validarUsuarioRoblox(valor) {
    const usuario = String(valor ?? '').trim();

    if (!/^[A-Za-z0-9_]{3,20}$/.test(usuario)) {
        throw new Error(
            'Digite o nome de usuário do Roblox (3 a 20 caracteres, sem espaços).'
        );
    }

    return usuario;
}

function validarModalidade(valor) {
    if (!Object.prototype.hasOwnProperty.call(MODALIDADES, valor)) {
        throw new Error('Modalidade de compra inválida.');
    }

    return valor;
}

function validarPagamento(valor) {
    if (!Object.prototype.hasOwnProperty.call(PAGAMENTOS, valor)) {
        throw new Error('Método de pagamento inválido.');
    }

    return valor;
}

function modalidadeDisponivel(config, modalidade) {
    const chave = validarModalidade(modalidade);
    const bloqueados = config?.tickets?.bloqueados || {};

    // Via Grupo fica fechada por padrão.
    if (chave === 'viaGrupo' && bloqueados[chave] !== false) {
        return false;
    }

    if (bloqueados[chave] === true) {
        return false;
    }

    try {
        validarPrecoK(config?.calculadora?.[chave]);
        return true;
    } catch {
        return false;
    }
}

function validarConfiguracaoPedido(config, modalidade) {
    const chave = validarModalidade(modalidade);

    if (!modalidadeDisponivel(config, chave)) {
        throw new Error('Essa modalidade está indisponível no momento.');
    }

    const equipeId = config?.tickets?.cargoEquipeId;
    const categoriaId = config?.tickets?.categorias?.[chave];

    if (!equipeId) {
        throw new Error('O cargo da equipe não foi configurado no /setup.');
    }

    if (!categoriaId) {
        throw new Error('A categoria de tickets dessa modalidade não foi configurada.');
    }

    return {
        modalidade: chave,
        precoK: validarPrecoK(config.calculadora[chave]),
        cargoEquipeId: validarSnowflake(equipeId, 'Cargo da equipe'),
        categoriaId: validarSnowflake(categoriaId, 'Categoria do ticket')
    };
}

// ==========================================
// PERMISSOES E CANAIS DO DISCORD
// ==========================================

function membroTemCargo(membro, cargoId) {
    if (!membro || !cargoId) return false;

    const roles = membro.roles;

    if (roles?.cache?.has) {
        return roles.cache.has(cargoId);
    }

    if (Array.isArray(roles)) {
        return roles.includes(cargoId);
    }

    return false;
}

function usuarioEhEquipe(interaction, config = {}) {
    if (!interaction?.inGuild?.()) return false;

    const administrador = interaction.memberPermissions?.has(
        PermissionFlagsBits.Administrator
    );

    if (administrador) return true;

    return membroTemCargo(
        interaction.member,
        config.tickets?.cargoEquipeId
    );
}

function usuarioEhAdministrador(interaction) {
    return Boolean(
        interaction?.inGuild?.() &&
        interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    );
}

function validarCategoriaDiscord(canal) {
    if (!canal || canal.type !== ChannelType.GuildCategory) {
        throw new Error('A categoria de tickets configurada não é válida.');
    }

    return canal;
}

// ==========================================
// TEXTO SEGURO PARA NOMES DE CANAIS
// ==========================================

function criarNomeCanalTicket(quantidadeRobux) {
    const quantidade = validarQuantidadeRobux(quantidadeRobux);
    return `${quantidade}x-robux`;
}

module.exports = {
    MAX_ROBUX,
    MAX_REAIS,
    MODALIDADES,
    PAGAMENTOS,
    validarSnowflake,
    interpretarQuantidadeRobux,
    validarQuantidadeRobux,
    interpretarValorReais,
    validarValorReais,
    converterParaCentavos,
    validarPrecoK,
    validarUsuarioRoblox,
    validarModalidade,
    validarPagamento,
    modalidadeDisponivel,
    validarConfiguracaoPedido,
    membroTemCargo,
    usuarioEhEquipe,
    usuarioEhAdministrador,
    validarCategoriaDiscord,
    criarNomeCanalTicket
};
