const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Abre o painel de configuração da InovareSale.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {

        const embed = new EmbedBuilder()
            .setTitle('⚙️ Painel de Configuração — InovareSale')
            .setDescription(
                'Configure todas as funções do bot diretamente pelo Discord.\n\n' +
                '🧮 **Calculadora**\n' +
                'Configure preços, métodos e canal da calculadora.\n\n' +

                '📦 **Estoque**\n' +
                'Configure o canal onde serão publicadas as atualizações de estoque.\n\n' +

                '💰 **Vendas**\n' +
                'Configure o canal onde as vendas serão publicadas.\n\n' +

                '🏆 **Cargos**\n' +
                'Configure os cargos automáticos por valor gasto.'
            )
            .setFooter({
                text: 'InovareSale • Painel Administrativo'
            });

        const linha = new ActionRowBuilder()
            .addComponents(

                new ButtonBuilder()
                    .setCustomId('setup_calculadora')
                    .setLabel('Calculadora')
                    .setEmoji('🧮')
                    .setStyle(ButtonStyle.Primary),

                new ButtonBuilder()
                    .setCustomId('setup_estoque')
                    .setLabel('Estoque')
                    .setEmoji('📦')
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId('setup_vendas')
                    .setLabel('Vendas')
                    .setEmoji('💰')
                    .setStyle(ButtonStyle.Success),

                new ButtonBuilder()
                    .setCustomId('setup_cargos')
                    .setLabel('Cargos')
                    .setEmoji('🏆')
                    .setStyle(ButtonStyle.Secondary)
            );

        await interaction.reply({
            embeds: [embed],
            components: [linha],
            flags: MessageFlags.Ephemeral
        });
    }
};