
const {
    SlashCommandBuilder,
    EmbedBuilder,
    AttachmentBuilder
} = require('discord.js');

const fs = require('fs');
const path = require('path');

// ==========================================
// INFORMAÇÕES DO BOT
// ==========================================

const NOME_BOT = 'InovareSale Bot';

// Troque pelo nome do criador quando decidir
const CRIADOR = 'A definir';

const VERSAO = '2.0.0';

// ==========================================
// BUSCAR IMAGENS
// ==========================================

function carregarImagem(nome) {
    const caminho = path.join(
        __dirname,
        '..',
        'assets',
        nome
    );

    if (!fs.existsSync(caminho)) {
        return null;
    }

    if (fs.statSync(caminho).size === 0) {
        return null;
    }

    return new AttachmentBuilder(caminho, {
        name: nome
    });
}

// ==========================================
// COMANDO /APRESENTAÇÃO
// ==========================================

module.exports = {

    data: new SlashCommandBuilder()
        .setName('apresentação')
        .setDescription(
            'Conheça o bot oficial da InovareSale.'
        ),

    async execute(interaction) {

        const embed = new EmbedBuilder()

            .setColor(0xC0C0C0)

            .setTitle(
                '💎 INOVARESALE — BOT OFICIAL'
            )

            .setDescription(
                'Olá! 👋\n\n' +

                `Eu sou o **${NOME_BOT}**, ` +
                'o assistente oficial da **InovareSale**!\n\n' +

                'Fui desenvolvido para facilitar ' +
                'suas compras de Robux e oferecer ' +
                'uma experiência rápida, organizada ' +
                'e prática dentro do Discord.\n\n' +

                '━━━━━━━━━━━━━━━━━━━━\n\n' +

                '🧮 **CALCULADORA DE ROBUX**\n' +
                'Calcule automaticamente os preços ' +
                'dos Robux em diferentes modalidades.\n\n' +

                '🎫 **TICKETS DE COMPRA**\n' +
                'Abra pedidos, escolha sua modalidade ' +
                'e acompanhe o atendimento da equipe.\n\n' +

                '📦 **ESTOQUE DA LOJA**\n' +
                'Consulte a disponibilidade de Robux ' +
                'e o status da loja.\n\n' +

                '💰 **REGISTRO DE VENDAS**\n' +
                'Histórico organizado das compras ' +
                'realizadas na InovareSale.\n\n' +

                '🏆 **PERFIL E RECOMPENSAS**\n' +
                'Acompanhe suas compras, seus gastos ' +
                'e seus cargos de cliente.\n\n' +

                '━━━━━━━━━━━━━━━━━━━━\n\n' +

                '👑 **SOBRE MEU CRIADOR**\n' +
                `Desenvolvido por **${CRIADOR}**.\n\n` +

                '⚙️ **SOBRE MIM**\n' +
                `Versão: **${VERSAO}**\n` +
                'Plataforma: **Discord**\n' +
                'Linguagem: **JavaScript / Node.js**\n' +
                'Biblioteca: **discord.js**\n\n' +

                '✨ **InovareSale — Tecnologia, ' +
                'inovação e Robux em um só lugar!**'
            )

            .setFooter({
                text: 'InovareSale • Sua loja de Robux'
            })

            .setTimestamp();

        // ==================================
        // LOGO E BANNER
        // ==================================

        const arquivos = [];

        const logo = carregarImagem('logo.png');
        const banner = carregarImagem('banner.png');

        if (logo) {
            arquivos.push(logo);

            embed.setThumbnail(
                'attachment://logo.png'
            );
        }

        if (banner) {
            arquivos.push(banner);

            embed.setImage(
                'attachment://banner.png'
            );
        }

        // ==================================
        // ENVIAR APRESENTAÇÃO
        // ==================================

        await interaction.reply({
            embeds: [embed],
            files: arquivos,
            allowedMentions: {
                parse: []
            }
        });
    }
};
