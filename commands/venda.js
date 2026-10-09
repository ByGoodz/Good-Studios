
const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require('discord.js');

const {
    registrarVenda
} = require('../services/vendaService');

// ==========================================
// FORMATAÇÃO
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
    return Number(valor || 0).toLocaleString(
        'pt-BR'
    );
}

// ==========================================
// NOMES DAS MODALIDADES
// ==========================================

const NOMES_MODALIDADES = {
    viaPlus: 'Via Plus',
    semTaxa: 'Robux Sem Taxa',
    taxado: 'Robux Taxado',
    viaGrupo: 'Robux Via Grupo',
    outro: 'Outra modalidade'
};

const NOMES_PAGAMENTOS = {
    pix: 'PIX',
    mm: 'Intermediário (MM)',
    outro: 'Outro'
};

// ==========================================
// COMANDO /VENDA
// ==========================================

module.exports = {

    data: new SlashCommandBuilder()

        .setName('venda')

        .setDescription(
            'Registra uma venda manual da InovareSale.'
        )

        .setDefaultMemberPermissions(
            PermissionFlagsBits.Administrator
        )

        // ==================================
        // CLIENTE
        // ==================================

        .addUserOption(option =>
            option
                .setName('cliente')
                .setDescription(
                    'Cliente que realizou a compra'
                )
                .setRequired(true)
        )

        // ==================================
        // VALOR EM REAIS
        // ==================================

        .addNumberOption(option =>
            option
                .setName('valor')
                .setDescription(
                    'Valor efetivamente pago em reais'
                )
                .setMinValue(0.01)
                .setRequired(true)
        )

        // ==================================
        // QUANTIDADE DE ROBUX
        // ==================================

        .addIntegerOption(option =>
            option
                .setName('robux')
                .setDescription(
                    'Quantidade de Robux comprados'
                )
                .setMinValue(1)
                .setRequired(true)
        )

        // ==================================
        // MODALIDADE
        // ==================================

        .addStringOption(option =>
            option
                .setName('modalidade')
                .setDescription(
                    'Modalidade utilizada na venda'
                )
                .setRequired(false)
                .addChoices(
                    {
                        name: 'Via Plus',
                        value: 'viaPlus'
                    },
                    {
                        name: 'Robux Sem Taxa',
                        value: 'semTaxa'
                    },
                    {
                        name: 'Robux Taxado',
                        value: 'taxado'
                    },
                    {
                        name: 'Robux Via Grupo',
                        value: 'viaGrupo'
                    },
                    {
                        name: 'Outra modalidade',
                        value: 'outro'
                    }
                )
        )

        // ==================================
        // USUÁRIO DO ROBLOX
        // ==================================

        .addStringOption(option =>
            option
                .setName('roblox')
                .setDescription(
                    'Username do cliente no Roblox'
                )
                .setMaxLength(50)
                .setRequired(false)
        )

        // ==================================
        // MÉTODO DE PAGAMENTO
        // ==================================

        .addStringOption(option =>
            option
                .setName('pagamento')
                .setDescription(
                    'Método de pagamento utilizado'
                )
                .setRequired(false)
                .addChoices(
                    {
                        name: 'PIX',
                        value: 'pix'
                    },
                    {
                        name: 'Solicitar MM',
                        value: 'mm'
                    },
                    {
                        name: 'Outro',
                        value: 'outro'
                    }
                )
        ),

    // ======================================
    // EXECUTAR COMANDO
    // ======================================

    async execute(interaction) {

        // Apenas administradores
        if (
            !interaction.memberPermissions?.has(
                PermissionFlagsBits.Administrator
            )
        ) {
            return interaction.reply({
                content:
                    '❌ Apenas administradores podem registrar vendas manualmente.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (!interaction.guild) {
            return interaction.reply({
                content:
                    '❌ Este comando só funciona dentro do servidor.',
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        try {

            // ==================================
            // OBTER DADOS DA VENDA
            // ==================================

            const cliente =
                interaction.options.getUser(
                    'cliente',
                    true
                );

            const valor =
                interaction.options.getNumber(
                    'valor',
                    true
                );

            const robux =
                interaction.options.getInteger(
                    'robux',
                    true
                );

            const modalidade =
                interaction.options.getString(
                    'modalidade'
                ) || 'outro';

            const usuarioRoblox =
                interaction.options.getString(
                    'roblox'
                )?.trim() || null;

            const pagamento =
                interaction.options.getString(
                    'pagamento'
                ) || 'outro';

            // ==================================
            // VALIDAR CLIENTE
            // ==================================

            if (cliente.bot) {
                return interaction.editReply({
                    content:
                        '❌ Você não pode registrar uma venda para um bot.'
                });
            }

            // ==================================
            // VALIDAR VALORES
            // ==================================

            if (
                !Number.isFinite(valor) ||
                valor <= 0 ||
                !Number.isSafeInteger(robux) ||
                robux <= 0
            ) {
                return interaction.editReply({
                    content:
                        '❌ Valor ou quantidade de Robux inválidos.'
                });
            }

            // ==================================
            // VERIFICAR SE CLIENTE ESTÁ
            // NO SERVIDOR
            // ==================================

            let membro;

            try {
                membro =
                    await interaction.guild.members.fetch(
                        cliente.id
                    );
            } catch {
                return interaction.editReply({
                    content:
                        '❌ Não encontrei esse cliente no servidor.'
                });
            }

            if (!membro) {
                return interaction.editReply({
                    content:
                        '❌ Cliente não encontrado.'
                });
            }

            // ==================================
            // REGISTRAR VENDA
            //
            // A MESMA FUNÇÃO SERÁ UTILIZADA
            // PELOS TICKETS AUTOMÁTICOS
            // ==================================

            const resultado = await registrarVenda({

                guild: interaction.guild,

                clienteId: cliente.id,

                valor: valor,

                robux: robux,

                registradoPorId:
                    interaction.user.id,

                modalidade: modalidade,

                usuarioRoblox: usuarioRoblox,

                pagamento: pagamento,

                origem: 'manual'

            });

            // ==================================
            // CONFIRMAR REGISTRO
            // ==================================

            const dadosCliente =
                resultado.dadosCliente;

            let resposta =
                '✅ **VENDA REGISTRADA COM SUCESSO!**\n\n' +

                `👤 **Cliente:** <@${cliente.id}>\n` +

                `💎 **Robux:** ${formatarRobux(robux)}\n` +

                `💰 **Valor:** ${formatarDinheiro(valor)}\n` +

                `🛒 **Modalidade:** ${NOMES_MODALIDADES[modalidade]}\n` +

                `💳 **Pagamento:** ${NOMES_PAGAMENTOS[pagamento]}\n`;

            if (usuarioRoblox) {
                resposta +=
                    `🎮 **Roblox:** ${usuarioRoblox}\n`;
            }

            resposta +=
                '\n━━━━━━━━━━━━━━━━━━\n\n' +

                `📦 **Compras realizadas:** ${dadosCliente.quantidadeCompras}\n` +

                `💵 **Total gasto:** ${formatarDinheiro(dadosCliente.totalGasto)}\n` +

                `💎 **Total de Robux:** ${formatarRobux(dadosCliente.totalRobux)}\n`;

            // ==================================
            // CARGO ATUALIZADO
            // ==================================

            if (resultado.cargoId) {
                resposta +=
                    `\n🏆 **Cargo:** <@&${resultado.cargoId}>\n`;
            }

            if (resultado.erroCargo) {
                resposta +=
                    '\n⚠️ A venda foi registrada, ' +
                    'mas não consegui atualizar o cargo do cliente.\n';
            }

            // ==================================
            // LINK DA PUBLICAÇÃO
            // ==================================

            if (resultado.publicacaoUrl) {
                resposta +=
                    '\n📢 **Publicação da venda:**\n' +
                    resultado.publicacaoUrl;
            } else {
                resposta +=
                    '\n⚠️ Verifique o canal de vendas: ' +
                    'a publicação não foi confirmada.';
            }

            await interaction.editReply({
                content: resposta,
                allowedMentions: {
                    parse: []
                }
            });

        } catch (erro) {

            console.error(
                '❌ Erro no comando /venda:',
                erro
            );

            await interaction.editReply({
                content:
                    '❌ Não consegui concluir o registro da venda.\n' +
                    'Verifique os registros do bot antes de tentar novamente.'
            });
        }
    }
};
