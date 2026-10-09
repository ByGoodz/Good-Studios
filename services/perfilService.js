
const {
    EmbedBuilder
} = require('discord.js');

const {
    getSales,
    getConfig
} = require('../utils/storage');

const {
    obterCargoIdeal
} = require('../utils/roles');

// ==========================================
// INOVARESALE BOT 2.0
// SERVIÇO DE PERFIS DOS CLIENTES
// ==========================================

const COR_PRINCIPAL = 0xC0C0C0;

// ==========================================
// NÍVEIS DOS CLIENTES
// ==========================================

const NIVEIS = [
    {
        minimo: 10000,
        nome: 'Cliente Supremo',
        emoji: '👑',
        chave: 'cliente10000'
    },
    {
        minimo: 5000,
        nome: 'Cliente Esmeralda',
        emoji: '💚',
        chave: 'cliente5000'
    },
    {
        minimo: 1000,
        nome: 'Cliente Platina',
        emoji: '💠',
        chave: 'cliente1000'
    },
    {
        minimo: 500,
        nome: 'Cliente Diamante',
        emoji: '💎',
        chave: 'cliente500'
    },
    {
        minimo: 300,
        nome: 'Cliente Ouro',
        emoji: '🥇',
        chave: 'cliente300'
    },
    {
        minimo: 100,
        nome: 'Cliente Prata',
        emoji: '🥈',
        chave: 'cliente100'
    },
    {
        minimo: 0.01,
        nome: 'Cliente Bronze',
        emoji: '🥉',
        chave: 'primeiraCompra'
    }
];

// ==========================================
// FORMATAÇÕES
// ==========================================

function formatarDinheiro(valor) {
    return Number(valor || 0).toLocaleString(
        'pt-BR',
        {
            style: 'currency',
            currency: 'BRL'
        }
    );
}

function formatarRobux(valor) {
    return Math.floor(
        Number(valor || 0)
    ).toLocaleString('pt-BR');
}

// ==========================================
// IDENTIFICAR NÍVEL DO CLIENTE
// ==========================================

function obterNivelCliente(totalGasto) {
    const total = Number(totalGasto || 0);

    for (const nivel of NIVEIS) {
        if (total >= nivel.minimo) {
            return nivel;
        }
    }

    return {
        minimo: 0,
        nome: 'Visitante',
        emoji: '🌟',
        chave: null
    };
}

// ==========================================
// PRÓXIMO NÍVEL
// ==========================================

function obterProximoNivel(totalGasto) {
    const total = Number(totalGasto || 0);

    const niveisCrescentes = [
        ...NIVEIS
    ].reverse();

    for (const nivel of niveisCrescentes) {
        if (total < nivel.minimo) {
            return {
                ...nivel,

                falta: Number(
                    (nivel.minimo - total).toFixed(2)
                )
            };
        }
    }

    return null;
}

// ==========================================
// FORMATAR HISTÓRICO DE COMPRAS
// ==========================================

function formatarHistorico(
    historico = [],
    limite = 5
) {
    if (
        !Array.isArray(historico) ||
        historico.length === 0
    ) {
        return 'Nenhuma compra registrada ainda.';
    }

    const compras = historico
        .slice(-limite)
        .reverse();

    return compras.map((compra, indice) => {
        const numero =
            historico.length - indice;

        const valor = formatarDinheiro(
            compra.valor
        );

        const robux = formatarRobux(
            compra.robux
        );

        let data = '';

        if (compra.data) {
            const timestamp = Date.parse(
                compra.data
            );

            if (Number.isFinite(timestamp)) {
                data =
                    ` • <t:${Math.floor(timestamp / 1000)}:d>`;
            }
        }

        const modalidade =
            compra.modalidade
                ? `\n📦 ${formatarModalidade(compra.modalidade)}`
                : '';

        return (
            `**Compra #${numero}**${data}\n` +
            `💎 ${robux} Robux • ${valor}` +
            modalidade
        );
    }).join('\n\n');
}

// ==========================================
// FORMATAR MODALIDADE
// ==========================================

function formatarModalidade(chave) {
    const modalidades = {
        viaPlus: 'Via Plus',
        semTaxa: 'Robux Sem Taxa',
        taxado: 'Robux Taxado',
        viaGrupo: 'Robux Via Grupo',
        outro: 'Outra modalidade'
    };

    return modalidades[chave] ||
        'Não informada';
}

// ==========================================
// BUSCAR DADOS DO CLIENTE
// ==========================================

function buscarDadosCliente(
    servidorId,
    clienteId
) {
    const sales = getSales() || {};

    const dados =
        sales?.[servidorId]?.[clienteId];

    if (!dados) {
        return {
            totalGasto: 0,
            totalRobux: 0,
            quantidadeCompras: 0,
            historico: []
        };
    }

    return {
        totalGasto: Number(
            dados.totalGasto || 0
        ),

        totalRobux: Number(
            dados.totalRobux || 0
        ),

        quantidadeCompras: Number(
            dados.quantidadeCompras || 0
        ),

        historico: Array.isArray(dados.historico)
            ? dados.historico
            : []
    };
}

// ==========================================
// CONSULTAR PERFIL COMPLETO
// ==========================================

async function obterPerfil({
    guild,
    clienteId
}) {
    if (!guild || !clienteId) {
        throw new Error(
            'Servidor ou cliente não informado.'
        );
    }

    const config = getConfig() || {};

    const dados = buscarDadosCliente(
        guild.id,
        clienteId
    );

    const nivel = obterNivelCliente(
        dados.totalGasto
    );

    const proximoNivel = obterProximoNivel(
        dados.totalGasto
    );

    const cargoIdeal = obterCargoIdeal(
        dados.totalGasto,
        config.cargos || {}
    );

    // ======================================
    // CONSULTAR CARGO NO SERVIDOR
    // ======================================

    let cargoAtualId = null;

    try {
        const membro = await guild.members.fetch(
            clienteId
        );

        if (
            cargoIdeal &&
            membro.roles.cache.has(cargoIdeal)
        ) {
            cargoAtualId = cargoIdeal;
        }

    } catch (erro) {
        console.log(
            'Não foi possível consultar o cargo:',
            clienteId
        );
    }

    // ======================================
    // RETORNAR PERFIL
    // ======================================

    return {
        servidorId: guild.id,
        clienteId,

        totalGasto: dados.totalGasto,
        totalRobux: dados.totalRobux,
        quantidadeCompras:
            dados.quantidadeCompras,

        historico: dados.historico,

        nivel,
        proximoNivel,

        cargoIdealId: cargoIdeal,
        cargoAtualId
    };
}

// ==========================================
// CRIAR EMBED DO PERFIL
// ==========================================

function criarEmbedPerfil(
    perfil,
    usuario
) {
    const nivel = perfil.nivel;

    const embed = new EmbedBuilder()
        .setColor(COR_PRINCIPAL)

        .setTitle(
            `👤 Perfil — ${usuario.username}`
        )

        .setDescription(
            '💎 **INOVARESALE — PERFIL DE CLIENTE**\n\n' +

            'Bem-vindo ao seu histórico ' +
            'de compras na InovareSale!\n\n' +

            '━━━━━━━━━━━━━━━━━━━━\n\n' +

            `🏆 **Classificação:** ` +
            `${nivel.emoji} ${nivel.nome}\n\n` +

            `🎖️ **Cargo atual:** ` +
            (
                perfil.cargoAtualId
                    ? `<@&${perfil.cargoAtualId}>`
                    : '`Não atribuído`'
            )
        )

        .setThumbnail(
            usuario.displayAvatarURL({
                size: 256
            })
        )

        .addFields(
            {
                name: '🛍️ Compras realizadas',
                value:
                    `**${perfil.quantidadeCompras}**`,
                inline: true
            },

            {
                name: '💰 Total gasto',
                value:
                    `**${formatarDinheiro(perfil.totalGasto)}**`,
                inline: true
            },

            {
                name: '💎 Robux comprados',
                value:
                    `**${formatarRobux(perfil.totalRobux)}**`,
                inline: true
            }
        );

    // ======================================
    // PROGRESSO PARA O PRÓXIMO NÍVEL
    // ======================================

    if (perfil.proximoNivel) {
        embed.addFields({
            name: '🚀 Próxima conquista',

            value:
                `${perfil.proximoNivel.emoji} ` +
                `**${perfil.proximoNivel.nome}**\n` +
                `Faltam **${formatarDinheiro(perfil.proximoNivel.falta)}** ` +
                'em compras para alcançar esse nível.',

            inline: false
        });

    } else {
        embed.addFields({
            name: '👑 Nível máximo',

            value:
                'Você alcançou a classificação ' +
                'máxima da InovareSale!',

            inline: false
        });
    }

    // ======================================
    // HISTÓRICO RECENTE
    // ======================================

    embed.addFields({
        name: '📜 Últimas compras',

        value: formatarHistorico(
            perfil.historico,
            5
        ),

        inline: false
    });

    embed.setFooter({
        text:
            'InovareSale • Seu histórico, suas conquistas'
    });

    embed.setTimestamp();

    return embed;
}

// ==========================================
// ESTATÍSTICAS RESUMIDAS
// ==========================================

function obterEstatisticasCliente(
    servidorId,
    clienteId
) {
    const dados = buscarDadosCliente(
        servidorId,
        clienteId
    );

    return {
        compras: dados.quantidadeCompras,
        gasto: dados.totalGasto,
        robux: dados.totalRobux,
        nivel: obterNivelCliente(
            dados.totalGasto
        ).nome
    };
}

// ==========================================
// EXPORTAR FUNÇÕES
// ==========================================

module.exports = {
    NIVEIS,

    formatarDinheiro,
    formatarRobux,
    formatarModalidade,
    formatarHistorico,

    obterNivelCliente,
    obterProximoNivel,

    buscarDadosCliente,
    obterPerfil,
    criarEmbedPerfil,
    obterEstatisticasCliente
};
