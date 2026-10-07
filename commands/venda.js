const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    MessageFlags
} = require('discord.js');

const {
    getConfig,
    getSales,
    saveSales
} = require('../utils/storage');

const {
    atualizarCargo
} = require('../utils/roles');


// ==========================================
// FORMATAR DINHEIRO
// ==========================================

function formatarDinheiro(valor) {
    return Number(valor).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });
}


// ==========================================
// FORMATAR ROBUX
// ==========================================

function formatarRobux(valor) {
    return Number(valor).toLocaleString('pt-BR');
}


// ==========================================
// COMANDO /VENDA
// ==========================================

module.exports = {

    data: new SlashCommandBuilder()

        .setName('venda')

        .setDescription(
            'Registra uma venda da InovareSale.'
        )

        .setDefaultMemberPermissions(
            PermissionFlagsBits.Administrator
        )

        .addUserOption(option =>

            option
                .setName('cliente')
                .setDescription(
                    'Cliente que realizou a compra'
                )
                .setRequired(true)
        )

        .addNumberOption(option =>

            option
                .setName('valor')
                .setDescription(
                    'Valor pago em reais'
                )
                .setMinValue(0.01)
                .setRequired(true)
        )

        .addIntegerOption(option =>

            option
                .setName('robux')
                .setDescription(
                    'Quantidade de Robux da venda'
                )
                .setMinValue(1)
                .setRequired(true)
        ),


    async execute(interaction) {

        // ==================================
        // PEGAR DADOS
        // ==================================

        const cliente =
            interaction.options.getUser(
                'cliente'
            );

        const valor =
            interaction.options.getNumber(
                'valor'
            );

        const robux =
            interaction.options.getInteger(
                'robux'
            );


        // ==================================
        // IMPEDIR VENDA PARA BOT
        // ==================================

        if (cliente.bot) {

            await interaction.reply({

                content:
                    '❌ Você não pode registrar uma venda para um bot.',

                flags:
                    MessageFlags.Ephemeral
            });

            return;
        }


        // ==================================
        // CONFIGURAÇÃO
        // ==================================

        const config =
            getConfig();


        if (!config.vendas?.canalId) {

            await interaction.reply({

                content:
                    '❌ O canal de vendas ainda não foi configurado.\nUse `/setup` primeiro.',

                flags:
                    MessageFlags.Ephemeral
            });

            return;
        }


        // ==================================
        // BUSCAR CANAL DE VENDAS
        // ==================================

        const canal =
            await interaction.guild.channels.fetch(
                config.vendas.canalId
            );


        if (!canal?.isTextBased()) {

            await interaction.reply({

                content:
                    '❌ Não consegui encontrar o canal de vendas configurado.',

                flags:
                    MessageFlags.Ephemeral
            });

            return;
        }


        // ==================================
        // BUSCAR MEMBRO
        // ==================================

        let membro;

        try {

            membro =
                await interaction.guild.members.fetch(
                    cliente.id
                );

        } catch {

            await interaction.reply({

                content:
                    '❌ Não consegui encontrar esse usuário no servidor.',

                flags:
                    MessageFlags.Ephemeral
            });

            return;
        }


        // ==================================
        // CARREGAR HISTÓRICO
        // ==================================

        const sales =
            getSales();


        const guildId =
            interaction.guild.id;


        if (!sales[guildId]) {
            sales[guildId] = {};
        }


        if (!sales[guildId][cliente.id]) {

            sales[guildId][cliente.id] = {

                totalGasto: 0,

                totalRobux: 0,

                quantidadeCompras: 0,

                historico: []
            };
        }


        const dadosCliente =
            sales[guildId][cliente.id];


        // ==================================
        // ATUALIZAR TOTAL
        // ==================================

        dadosCliente.totalGasto =
            Number(
                (
                    Number(dadosCliente.totalGasto || 0) +
                    valor
                ).toFixed(2)
            );


        dadosCliente.totalRobux =
            Number(dadosCliente.totalRobux || 0) +
            robux;


        dadosCliente.quantidadeCompras =
            Number(
                dadosCliente.quantidadeCompras || 0
            ) + 1;


        // ==================================
        // SALVAR VENDA NO HISTÓRICO
        // ==================================

        const venda = {

            valor,

            robux,

            data:
                new Date().toISOString(),

            registradoPor:
                interaction.user.id
        };


        dadosCliente.historico.push(
            venda
        );


        saveSales(
            sales
        );


        // ==================================
        // ATUALIZAR CARGO
        // ==================================

        let novoCargo = null;

        let erroCargo = false;


        try {

            novoCargo =
                await atualizarCargo(

                    membro,

                    dadosCliente.totalGasto,

                    config.cargos || {}
                );

        } catch (erro) {

            console.error(
                'Erro ao atualizar cargo:',
                erro
            );

            erroCargo = true;
        }


        // ==================================
        // DATA E HORÁRIO
        // ==================================

        const timestamp =
            Math.floor(
                Date.now() / 1000
            );


        // ==================================
        // EMBED DA VENDA
        // ==================================

        const embed =
            new EmbedBuilder()

                .setColor(
                    0xC0C0C0
                )

                .setTitle(
                    '🛍️ ━ Venda concluída!'
                )

                .setDescription(
                    'Uma nova venda foi registrada na **InovareSale**.\n\u200B'
                )

                .addFields(

                    {
                        name:
                            '💵 Valor',
                        value:
                            `**${formatarDinheiro(valor)}**`,
                        inline:
                            true
                    },

                    {
                        name:
                            '💎 Robux',
                        value:
                            `**${formatarRobux(robux)} Robux**`,
                        inline:
                            true
                    },

                    {
                        name:
                            '👤 Cliente',
                        value:
                            `<@${cliente.id}>`,
                        inline:
                            false
                    },

                    {
                        name:
                            '💰 Total gasto pelo cliente',
                        value:
                            `**${formatarDinheiro(
                                dadosCliente.totalGasto
                            )}**`,
                        inline:
                            true
                    },

                    {
                        name:
                            '🛒 Compras realizadas',
                        value:
                            `**${dadosCliente.quantidadeCompras}**`,
                        inline:
                            true
                    },

                    {
                        name:
                            '🕐 Horário',
                        value:
                            `<t:${timestamp}:F>`,
                        inline:
                            false
                    }
                )

                .setFooter({
                    text:
                        'InovareSale • Registro de Venda'
                })

                .setTimestamp();


        // ==================================
        // PUBLICAR
        // ==================================

        await canal.send({

            content:
                `🎉 Venda para <@${cliente.id}> registrada com sucesso!`,

            embeds: [
                embed
            ],

            allowedMentions: {
                users: [
                    cliente.id
                ]
            }
        });


        // ==================================
        // RESPOSTA PARA O ADMIN
        // ==================================

        let resposta =

            `✅ **Venda registrada!**\n\n` +

            `👤 Cliente: <@${cliente.id}>\n` +

            `💵 Valor: **${formatarDinheiro(valor)}**\n` +

            `💎 Robux: **${formatarRobux(robux)}**\n` +

            `💰 Total acumulado: **${formatarDinheiro(
                dadosCliente.totalGasto
            )}**`;


        if (novoCargo) {

            resposta +=
                `\n🏆 Cargo atual: <@&${novoCargo}>`;
        }


        if (erroCargo) {

            resposta +=
                '\n\n⚠️ A venda foi registrada, mas não consegui atualizar o cargo do cliente.';
        }


        await interaction.reply({

            content:
                resposta,

            flags:
                MessageFlags.Ephemeral
        });
    }
};