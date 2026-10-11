
'use strict';

const fs = require('fs');
const path = require('path');

const {
    SlashCommandBuilder,
    EmbedBuilder,
    AttachmentBuilder
} = require('discord.js');

// ==========================================
// INOVARESALE BOT 3.0
// COMANDO /APRESENTAÇÃO
// ==========================================

const CONFIG = {
    nome: 'InovareSale Bot',
    versao: '3.0.0',
    cor: 0x9951CB,

    criador: {
        nome: 'Good',
        usuario: 'usercriminal',
        id: '1335053578443685918'
    }
};

// ==========================================
// CARREGAR IMAGENS DO PROJETO
// ==========================================

function carregarImagem(nome) {
    const caminho = path.join(
        __dirname,
        '..',
        'assets',
        nome
    );

    try {
        if (!fs.existsSync(caminho)) {
            console.warn(
                `[Apresentação] Imagem não encontrada: ${nome}`
            );
            return null;
        }

        const informacoes = fs.statSync(caminho);

        if (!informacoes.isFile() || informacoes.size === 0) {
            console.warn(
                `[Apresentação] Imagem inválida ou vazia: ${nome}`
            );
            return null;
        }

        return new AttachmentBuilder(caminho, {
            name: nome
        });

    } catch (erro) {
        console.warn(
            `[Apresentação] Erro ao carregar ${nome}:`,
            erro.message
        );

        return null;
    }
}

// ==========================================
// CRIAR EMBED DE APRESENTAÇÃO
// ==========================================

function criarEmbedApresentacao() {
    return new EmbedBuilder()
        .setColor(CONFIG.cor)

        .setTitle('INOVARESALE | BOT OFICIAL')

        .setDescription(
            `Olá! Eu sou o **${CONFIG.nome}**, ` +
            'o assistente oficial da **InovareSale**.\n\n' +

            'Fui desenvolvido para tornar suas compras ' +
            'de Robux mais práticas, organizadas e seguras ' +
            'dentro do nosso servidor.\n\n' +

            '**Conheça minhas funcionalidades:**'
        )

        .addFields(
            {
                name: 'Central de Pedidos',
                value:
                    'Compre Robux e acompanhe seu atendimento.',
                inline: true
            },
            {
                name: 'Calculadora',
                value:
                    'Consulte os valores de cada modalidade.',
                inline: true
            },
            {
                name: 'Estoque',
                value:
                    'Confira a disponibilidade da loja.',
                inline: true
            },
            {
                name: 'Perfil de Cliente',
                value:
                    'Acompanhe compras, conquistas e emblemas.',
                inline: true
            },
            {
                name: 'Sistema de Vendas',
                value:
                    'Registro e confirmação de compras.',
                inline: true
            },
            {
                name: 'Administração',
                value:
                    'Ferramentas de gestão, equipe e moderação.',
                inline: true
            }
        )

        .addFields(
            {
                name: 'DESENVOLVIMENTO',
                value:
                    `**Criador:** ${CONFIG.criador.nome}\n` +
                    `**Discord:** @${CONFIG.criador.usuario}\n` +
                    `**Perfil:** <@${CONFIG.criador.id}>\n` +
                    `**Versão:** ${CONFIG.versao}`,
                inline: false
            }
        )

        .setFooter({
            text:
                'InovareSale • Inovação e praticidade em cada compra'
        })

        .setTimestamp();
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
        try {
            const embed = criarEmbedApresentacao();
            const arquivos = [];

            // Logo no topo direito do embed.
            const logo = carregarImagem('logo.png');

            if (logo) {
                arquivos.push(logo);

                embed.setThumbnail(
                    'attachment://logo.png'
                );
            }

            // Banner na parte inferior do embed.
            const banner = carregarImagem('banner.png');

            if (banner) {
                arquivos.push(banner);

                embed.setImage(
                    'attachment://banner.png'
                );
            }

            await interaction.reply({
                embeds: [embed],
                files: arquivos,

                // Impede notificações indesejadas.
                allowedMentions: {
                    parse: [],
                    users: []
                }
            });

        } catch (erro) {
            console.error(
                '[InovareSale] Erro no comando /apresentação:',
                erro
            );

            const resposta = {
                content:
                    'Não foi possível carregar a apresentação agora. ' +
                    'Tente novamente em alguns instantes.',
                ephemeral: true
            };

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(resposta);
            } else {
                await interaction.reply(resposta);
            }
        }
    }
};
