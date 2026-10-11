
'use strict';

const {
    EmbedBuilder,
    escapeMarkdown
} = require('discord.js');

const {
    getSales,
    getConfig
} = require('../utils/storage');

const {
    obterCargoIdeal
} = require('../utils/roles');

// ==========================================
// INOVARESALE BOT 3.0
// SERVIÇO DE PERFIS DOS CLIENTES
// ==========================================

const CONFIG = {
    nome: 'InovareSale',
    versao: '3.0.0',
    cor: 0x9951CB,
    limiteHistorico: 5
};

// ==========================================
// NÍVEIS DE CLIENTES
// ==========================================

// Os valores são os mesmos utilizados
// pelo sistema de cargos da InovareSale.
//
// Não alterar as chaves: elas são usadas
// no /setup e nas configurações salvas.

const NIVEIS = Object.freeze([
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
]);

// ==========================================
// FORMATAR NÚMEROS
// ==========================================

function numeroSeguro(valor) {
    const numero = Number(valor);

    if (
        !Number.isFinite(numero) ||
        numero < 0
    ) {
        return 0;
    }

    return numero;
}

function formatarDinheiro(valor) {
    return numeroSeguro(valor).toLocaleString(
        'pt-BR',
        {
            style: 'currency',
            currency: 'BRL',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }
    );
}

function formatarRobux(valor) {
    return Math.floor(
        numeroSeguro(valor)
    ).toLocaleString('pt-BR');
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
// IDENTIFICAR NÍVEL DO CLIENTE
// ==========================================

function obterNivelCliente(totalGasto) {
    const total = numeroSeguro(
        totalGasto
    );

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
// IDENTIFICAR PRÓXIMO NÍVEL
// ==========================================

function obterProximoNivel(totalGasto) {
    const total = numeroSeguro(
        totalGasto
    );

    const niveisCrescentes = [
        ...NIVEIS
    ].reverse();

    for (const nivel of niveisCrescentes) {
        if (total < nivel.minimo) {
            return {
                ...nivel,

                falta: Number(
                    (
                        nivel.minimo - total
                    ).toFixed(2)
                )
            };
        }
    }

    // Já alcançou o nível máximo.
    return null;
}

// ==========================================
// FORMATAR HISTÓRICO DE COMPRAS
// ==========================================

function formatarHistorico(
    historico = [],
    limite = CONFIG.limiteHistorico
) {
    if (
        !Array.isArray(historico) ||
        historico.length === 0
    ) {
        return 'Nenhuma compra registrada ainda.';
    }

    const quantidade = Math.min(
        10,
        Math.max(
            1,
            Math.floor(Number(limite) || 5)
        )
    );

    const compras = historico
        .slice(-quantidade)
        .reverse();

    const linhas = compras.map(
        (compra, indice) => {
            const numeroCompra =
                historico.length - indice;

            const valor = formatarDinheiro(
                compra.valor
            );

            const robux = formatarRobux(
                compra.robux
            );

            // Data exibida no horário local
            // definido pelo próprio Discord.
            let data = '';

            if (compra.data) {
                const timestamp = Date.parse(
                    compra.data
                );

                if (Number.isFinite(timestamp)) {
                    data =
                        ` • <t:${Math.floor(
                            timestamp / 1000
                        )}:d>`;
                }
            }

            const modalidade =
                compra.modalidade
                    ? (
                        '\n📦 ' +
                        formatarModalidade(
                            compra.modalidade
                        )
                    )
                    : '';

            return (
                `**Compra #${numeroCompra}**${data}\n` +
                `💎 ${robux} Robux • ${valor}` +
                modalidade
            );
        }
    );

    const texto = linhas.join('\n\n');

    // Discord permite no máximo 1024
    // caracteres em um campo de embed.
    if (texto.length > 1024) {
        return texto.slice(0, 1020) + '...';
    }

    return texto;
}

// ==========================================
// BUSCAR COMPRAS SALVAS
// ==========================================

// A função getSales() utiliza o
// armazenamento atual do projeto.
//
// Não recriamos históricos e não
// sobrescrevemos o SQLite.

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
        totalGasto: numeroSeguro(
            dados.totalGasto
        ),

        totalRobux: numeroSeguro(
            dados.totalRobux
        ),

        quantidadeCompras: Math.floor(
            numeroSeguro(
                dados.quantidadeCompras
            )
        ),

        historico: Array.isArray(
            dados.historico
        )
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
    // VERIFICAR CARGO DO MEMBRO
    // ======================================

    let cargoAtualId = null;

    try {
        const membro =
            await guild.members.fetch(
                clienteId
            );

        if (
            cargoIdeal &&
            membro.roles.cache.has(
                cargoIdeal
            )
        ) {
            cargoAtualId = cargoIdeal;
        }

    } catch (erro) {
        console.warn(
            '[InovareSale | Perfil] ' +
            'Não foi possível consultar o cargo:',
            clienteId,
            erro.message
        );
    }

    // ======================================
    // RETORNAR DADOS COMPLETOS
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
// CRIAR EMBED DO PERFIL 3.0
// ==========================================

function criarEmbedPerfil(
    perfil,
    usuario
) {
    const nivel = perfil.nivel ||
        obterNivelCliente(
            perfil.totalGasto
        );

    const nomeUsuario = escapeMarkdown(
        String(
            usuario.globalName ||
            usuario.username ||
            'Cliente'
        ).slice(0, 60)
    );

    const embed = new EmbedBuilder()
        .setColor(CONFIG.cor)

        .setTitle(
            'INOVARESALE | PERFIL DO CLIENTE'
        )

        .setDescription(
            `**Cliente:** ${nomeUsuario}\n` +
            `**Classificação:** ${nivel.emoji} ${nivel.nome}`
        )

        .setThumbnail(
            usuario.displayAvatarURL({
                size: 256,
                extension: 'png'
            })
        );

    // ======================================
    // ESTATÍSTICAS LADO A LADO
    // ======================================

    embed.addFields(
        {
            name: 'Compras realizadas',
            value: String(
                perfil.quantidadeCompras || 0
            ),
            inline: true
        },
        {
            name: 'Total gasto',
            value: formatarDinheiro(
                perfil.totalGasto
            ),
            inline: true
        },
        {
            name: 'Robux comprados',
            value:
                `${formatarRobux(
                    perfil.totalRobux
                )} Robux`,
            inline: true
        }
    );

    // ======================================
    // CARGO DO CLIENTE
    // ======================================

    embed.addFields(
        {
            name: 'Cargo atual',
            value:
                perfil.cargoAtualId
                    ? `<@&${perfil.cargoAtualId}>`
                    : 'Não atribuído',
            inline: true
        },
        {
            name: 'Cargo correspondente',
            value:
                perfil.cargoIdealId
                    ? `<@&${perfil.cargoIdealId}>`
                    : 'Não configurado',
            inline: true
        }
    );

    // ======================================
    // PROGRESSO PARA O PRÓXIMO NÍVEL
    // ======================================

    if (perfil.proximoNivel) {
        embed.addFields({
            name: 'Próxima conquista',
            value:
                `${perfil.proximoNivel.emoji} ` +
                `**${perfil.proximoNivel.nome}**\n` +
                `Faltam **${formatarDinheiro(
                    perfil.proximoNivel.falta
                )}** em compras.`,
            inline: false
        });

    } else {
        embed.addFields({
            name: 'Nível máximo',
            value:
                '👑 Você alcançou a classificação ' +
                'máxima da InovareSale!',
            inline: false
        });
    }

    // ======================================
    // HISTÓRICO RECENTE
    // ======================================

    embed.addFields({
        name: 'Últimas compras',
        value: formatarHistorico(
            perfil.historico,
            CONFIG.limiteHistorico
        ),
        inline: false
    });

    // ======================================
    // RODAPÉ
    // ======================================

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
// EXPORTAÇÕES COMPATÍVEIS
// ==========================================

// Mantém os mesmos nomes usados
// por outras partes do projeto.

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
