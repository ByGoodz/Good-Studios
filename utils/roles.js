
'use strict';

const { PermissionFlagsBits } = require('discord.js');

// ==========================================
// INOVARESALE BOT 2.0
// CARGOS AUTOMÁTICOS DOS CLIENTES
// ==========================================
// O valor minimo representa o total gasto
// em reais, considerando todas as compras.

const NIVEIS = Object.freeze([
    { chave: 'cliente10000', minimo: 10000, nome: 'Cliente Supremo' },
    { chave: 'cliente5000', minimo: 5000, nome: 'Cliente Esmeralda' },
    { chave: 'cliente1000', minimo: 1000, nome: 'Cliente Platina' },
    { chave: 'cliente500', minimo: 500, nome: 'Cliente Diamante' },
    { chave: 'cliente300', minimo: 300, nome: 'Cliente Ouro' },
    { chave: 'cliente100', minimo: 100, nome: 'Cliente Prata' },
    { chave: 'primeiraCompra', minimo: 0.01, nome: 'Cliente Bronze' }
]);

// ==========================================
// VALIDAR TOTAL GASTO
// ==========================================

function normalizarTotalGasto(totalGasto) {
    const numero = Number(totalGasto);

    if (!Number.isFinite(numero) || numero < 0) {
        return 0;
    }

    return numero;
}

// ==========================================
// NORMALIZAR ID DE CARGO
// ==========================================

function normalizarCargoId(cargoId) {
    if (cargoId === null || cargoId === undefined) {
        return null;
    }

    const id = String(cargoId).trim();
    return /^\d{15,22}$/.test(id) ? id : null;
}

// ==========================================
// IDENTIFICAR NÍVEL PELO TOTAL DE COMPRAS
// ==========================================

function obterNivelCliente(totalGasto) {
    const total = normalizarTotalGasto(totalGasto);

    return NIVEIS.find(
        nivel => total >= nivel.minimo
    ) || null;
}

// ==========================================
// ENCONTRAR O CARGO IDEAL CONFIGURADO
// ==========================================
// Se o cargo do nivel mais alto ainda nao
// estiver configurado, usa um nivel inferior
// que esteja configurado e ja tenha sido atingido.

function obterCargoIdeal(
    totalGasto,
    cargosConfigurados = {}
) {
    const total = normalizarTotalGasto(totalGasto);

    if (
        !cargosConfigurados ||
        typeof cargosConfigurados !== 'object'
    ) {
        return null;
    }

    for (const nivel of NIVEIS) {
        if (total < nivel.minimo) {
            continue;
        }

        const cargoId = normalizarCargoId(
            cargosConfigurados[nivel.chave]
        );

        if (cargoId) {
            return cargoId;
        }
    }

    return null;
}

// ==========================================
// LISTAR TODOS OS CARGOS CONFIGURADOS
// ==========================================

function listarCargosConfigurados(
    cargosConfigurados = {}
) {
    if (
        !cargosConfigurados ||
        typeof cargosConfigurados !== 'object'
    ) {
        return [];
    }

    return [...new Set(
        NIVEIS
            .map(nivel =>
                normalizarCargoId(
                    cargosConfigurados[nivel.chave]
                )
            )
            .filter(Boolean)
    )];
}

// ==========================================
// ATUALIZAR CARGO AUTOMATICAMENTE
// ==========================================
// Mantem somente o cargo de nivel mais alto
// configurado para o cliente. Outros cargos
// do servidor nao sao alterados.

async function atualizarCargo(
    member,
    totalGasto,
    cargosConfigurados = {}
) {
    if (!member?.guild || !member?.roles) {
        throw new Error(
            'Membro do Discord inválido.'
        );
    }

    const cargoIdealId = obterCargoIdeal(
        totalGasto,
        cargosConfigurados
    );

    const cargosDeNivel =
        listarCargosConfigurados(
            cargosConfigurados
        ).filter(
            id => id !== member.guild.id
        );

    // Nenhum cargo configurado:
    // nao alterar os cargos do membro.
    if (cargosDeNivel.length === 0) {
        return null;
    }

    const bot = member.guild.members.me ||
        await member.guild.members.fetchMe();

    if (
        !bot.permissions.has(
            PermissionFlagsBits.ManageRoles
        )
    ) {
        throw new Error(
            'O bot precisa da permissão Gerenciar Cargos.'
        );
    }

    // Validar o cargo antes de modificar
    // os cargos atuais do cliente.
    if (cargoIdealId) {
        const cargoIdeal =
            await member.guild.roles.fetch(
                cargoIdealId
            ).catch(() => null);

        if (!cargoIdeal) {
            throw new Error(
                'O cargo configurado não existe mais no servidor.'
            );
        }

        if (
            cargoIdeal.managed ||
            bot.roles.highest.comparePositionTo(
                cargoIdeal
            ) <= 0
        ) {
            throw new Error(
                'O cargo do bot precisa estar acima do cargo de cliente no Discord.'
            );
        }

        // Adicionar o novo cargo.
        if (
            !member.roles.cache.has(
                cargoIdealId
            )
        ) {
            await member.roles.add(
                cargoIdealId,
                'InovareSale: atualização automática do nível do cliente'
            );
        }
    }

    // Remover somente cargos de níveis
    // configurados que nao sejam o atual.
    const cargosParaRemover =
        cargosDeNivel.filter(
            id =>
                id !== cargoIdealId &&
                member.roles.cache.has(id)
        );

    if (cargosParaRemover.length > 0) {
        await member.roles.remove(
            cargosParaRemover,
            'InovareSale: substituição de cargo de nível antigo'
        );
    }

    return cargoIdealId;
}

// ==========================================
// EXPORTAÇÕES
// ==========================================

module.exports = {
    NIVEIS,
    obterNivelCliente,
    obterCargoIdeal,
    listarCargosConfigurados,
    atualizarCargo
};
