
const {
    SlashCommandBuilder,
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
// FORMATAR DINHEIRO E ROBUX
// ==========================================

function formatarDinheiro(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });
}

function formatarRobux(valor) {
    return Math.floor(
        Number(valor || 0)
    ).toLocaleString('pt-BR');
}

// ==========================================
// IDENTIFICAR NÍVEL DO CLIENTE
// ==========================================

const NIVEIS = [
    { minimo: 10000, nome: '👑 Cliente Supremo' },
    { minimo: 5000, nome: '💚 Cliente Esmeralda' },
    { minimo: 1000, nome: '💠 Cliente Platina' },
    { minimo: 500, nome: '💎 Cliente Diamante' },
    { minimo: 300, nome: '🥇 Cliente Ouro' },
    { minimo: 100, nome: '🥈 Cliente Prata' },
    { minimo: 0.01, nome: '🥉 Cliente Bronze' }
];

function obterNivel(totalGasto) {
    for (const nivel of NIVEIS) {
        if (totalGasto >= nivel.minimo) {
            return nivel.nome;
        }
    }

    return '🌟 Visitante';
}

// ==========================================
// FORMATAR ÚLTIMAS COMPRAS
// ==========================================

function obterUltimasCompras(historico) {
    if (!Array.isArray(historico) || historico.length === 0) {
        return 'Nenhuma compra registrada ainda.';
    }

    return historico
        .slice(-3)
        .reverse()
        .map((compra, indice) => {
            const numero = historico.length - indice;

            const robux = formatarRobux(
                compra.robux
            );

            const valor = formatarDinheiro(
                compra.valor
            );

            let data = '';

            if (compra.data) {
                const timestamp = new Date(
                    compra.data
                ).getTime();

                if (Number.isFinite(timestamp)) {
                    data =
                        `\n<t:${Math.floor(timestamp / 1000)}:d>`;
                }
            }

            return (
                `**Compra #${numero}**\n` +
                `💎 ${robux} Robux • ${valor}` +
                data
            );
        })
        .join('\n\n');
}

// ==========================================
// COMANDO /PERFIL
// ==========================================

module.exports = {

    data: new SlashCommandBuilder()
        .setName('perfil')
        .setDescription(
            'Consulte seu perfil de cliente da InovareSale.'
        )
        .addUserOption(option =>
            option
                .setName('cliente')
                .setDescription(
                    'Cliente que deseja consultar (opcional)'
                )
                .setRequired(false)
        ),

    async execute(interaction) {

        await interaction.deferReply();

        try {
            // ==============================
            // IDENTIFICAR CLIENTE
            // ==============================

            const cliente =
                interaction.options.getUser('cliente') ||
                interaction.user;

            const guildId = interaction.guildId;

            // ==============================
            // CARREGAR VENDAS
            // ==============================

            const sales = getSales();

            const dados =
                sales?.[guildId]?.[cliente.id] || {};

            const totalGasto = Number(
                dados.totalGasto || 0
            );

            const totalRobux = Number(
                dados.totalRobux || 0
            );

            const quantidadeCompras = Number(
                dados.quantidadeCompras || 0
            );

            const historico =
                Array.isArray(dados.historico)
                    ? dados.historico
                    : [];

            // ==============================
            // IDENTIFICAR NÍVEL
            // ==============================

            const nivel = obterNivel(totalGasto);

            const config = getConfig();

            const cargoIdeal = obterCargoIdeal(
                totalGasto,
                config.cargos || {}
            );

            let cargoAtual = '`Não atribuído`';

            if (cargoIdeal) {
                try {
                    const membro =
                        await interaction.guild.members.fetch(
                            cliente.id
                        );

                    if (
                        membro.roles.cache.has(cargoIdeal)
                    ) {
                        cargoAtual = `<@&${cargoIdeal}>`;
                    }
                } catch (erro) {
                    console.log(
                        'Não foi possível consultar o cargo do cliente.'
                    );
                }
            }

            // ==============================
            // MONTAR PERFIL
            // ==============================

            const embed = new EmbedBuilder()
                .setColor(0xC0C0C0)

                .setAuthor({
                    name: 'InovareSale • Perfil de Cliente',
                    iconURL:
                        interaction.client.user.displayAvatarURL()
                })

                .setTitle(
                    `👤 Perfil de ${cliente.username}`
                )

                .setDescription(
                    `Bem-vindo ao perfil de compras da **InovareSale**!\n\n` +
                    `🏆 **Classificação:** ${nivel}\n` +
                    `🎖️ **Cargo no servidor:** ${cargoAtual}`
                )

                .setThumbnail(
                    cliente.displayAvatarURL({
                        size: 256
                    })
                )

                .addFields(
                    {
                        name: '🛍️ Compras realizadas',
                        value: `**${quantidadeCompras}**`,
                        inline: true
                    },
                    {
                        name: '💰 Total gasto',
                        value:
                            `**${formatarDinheiro(totalGasto)}**`,
                        inline: true
                    },
                    {
                        name: '💎 Robux comprados',
                        value:
                            `**${formatarRobux(totalRobux)}**`,
                        inline: true
                    },
                    {
                        name: '📜 Últimas compras',
                        value: obterUltimasCompras(
                            historico
                        ),
                        inline: false
                    }
                )

                .setFooter({
                    text:
                        'InovareSale • Seu histórico, suas conquistas'
                })

                .setTimestamp();

            await interaction.editReply({
                embeds: [embed],
                allowedMentions: {
                    parse: []
                }
            });

        } catch (erro) {
            console.error(
                'Erro no comando /perfil:',
                erro
            );

            await interaction.editReply({
                content:
                    '❌ Não foi possível consultar este perfil.'
            });
        }
    }
};
