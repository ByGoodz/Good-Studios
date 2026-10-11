
'use strict';

const fs = require('fs');
const path = require('path');

const {
    EmbedBuilder,
    AttachmentBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder
} = require('discord.js');

// ==========================================
// INOVARESALE BOT 3.0
// CENTRAL ADMINISTRATIVA
// ==========================================

const CONFIG = {
    nome: 'InovareSale',
    versao: '3.0.0',
    cor: 0x9951CB,
    menuId: 'setup_menu_principal'
};

const PASTA_ASSETS = path.join(
    __dirname,
    '..',
    'assets'
);

const ASSINATURA_PNG = Buffer.from([
    137, 80, 78, 71, 13, 10, 26, 10
]);

// ==========================================
// CARREGAR IMAGEM PNG
// ==========================================

function carregarImagem(nome) {
    const caminho = path.join(
        PASTA_ASSETS,
        nome
    );

    try {
        if (!fs.existsSync(caminho)) {
            console.warn(
                `[Setup] Imagem não encontrada: ${nome}`
            );
            return null;
        }

        const dados = fs.readFileSync(caminho);

        if (
            dados.length < 100 ||
            dados.length > 8 * 1024 * 1024 ||
            !dados.subarray(0, 8).equals(ASSINATURA_PNG)
        ) {
            console.warn(
                `[Setup] Imagem PNG inválida: ${nome}`
            );
            return null;
        }

        return new AttachmentBuilder(dados, {
            name: nome
        });

    } catch (erro) {
        console.warn(
            `[Setup] Não foi possível carregar ${nome}:`,
            erro.message
        );
        return null;
    }
}

// ==========================================
// OPÇÕES DA CENTRAL ADMINISTRATIVA
// ==========================================

const OPCOES = [
    {
        label: 'Calculadora',
        description: 'Preços por K e canal da calculadora',
        value: 'calculadora',
        emoji: '🧮'
    },
    {
        label: 'Estoque',
        description: 'Disponibilidade e publicação da loja',
        value: 'estoque',
        emoji: '📦'
    },
    {
        label: 'Pedidos e Tickets',
        description: 'Compras, categorias e atendimento',
        value: 'pedidos_tickets',
        emoji: '🎫'
    },
    {
        label: 'Vendas e Limiteds',
        description: 'Anúncios, vendas e itens limitados',
        value: 'vendas_limiteds',
        emoji: '🛍️'
    },
    {
        label: 'Registros e Logs',
        description: 'Canais e histórico de atividades',
        value: 'logs',
        emoji: '📋'
    },
    {
        label: 'Status e Equipe',
        description: 'Monitoramento, voz e convites',
        value: 'status_equipe',
        emoji: '📊'
    },
    {
        label: 'Moderação',
        description: 'Permissões e registros de punições',
        value: 'moderacao',
        emoji: '🛡️'
    },
    {
        label: 'Cargos de Cliente',
        description: 'Classificação e recompensas',
        value: 'cargos',
        emoji: '🏆'
    }
];

// ==========================================
// CRIAR EMBED DO PAINEL CENTRAL
// ==========================================

function criarEmbedSetup(config = {}) {
    const embed = new EmbedBuilder()
        .setColor(CONFIG.cor)
        .setTitle(
            'INOVARESALE | CENTRAL ADMINISTRATIVA'
        )
        .setDescription(
            'Bem-vindo ao painel de gerenciamento ' +
            'da **InovareSale**.\n\n' +
            'Configure os sistemas da loja e acompanhe ' +
            'suas operações pelo menu abaixo.'
        )
        .addFields(
            {
                name: 'Status do bot',
                value: '🟢 Operacional',
                inline: true
            },
            {
                name: 'Versão atual',
                value: `**${CONFIG.versao}**`,
                inline: true
            }
        )
        .addFields({
            name: 'Gerenciamento',
            value:
                'Selecione o sistema que deseja ' +
                'configurar ou administrar.',
            inline: false
        })
        .setFooter({
            text:
                'InovareSale • Acesso restrito à administração'
        });

    return embed;
}

// ==========================================
// CRIAR MENU DE SELEÇÃO PRINCIPAL
// ==========================================

function criarMenuPrincipal() {
    const menu = new StringSelectMenuBuilder()
        .setCustomId(CONFIG.menuId)
        .setPlaceholder(
            'Selecione um gerenciamento...'
        )
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(OPCOES);

    return new ActionRowBuilder()
        .addComponents(menu);
}

// ==========================================
// GERAR PUBLICAÇÃO COMPLETA DO SETUP
// ==========================================

function criarPublicacaoSetup(config = {}) {
    const embed = criarEmbedSetup(config);

    const arquivos = [];

    // ==================================
    // LOGO DO SERVIDOR
    // ==================================

    const logo = carregarImagem('logo.png');

    if (logo) {
        arquivos.push(logo);

        embed.setThumbnail(
            'attachment://logo.png'
        );
    }

    // ==================================
    // BANNER CENTRAL
    // ==================================

    // A imagem ficará abaixo do texto
    // do embed e acima do menu de seleção.

    const banner = carregarImagem('banner.png');

    if (banner) {
        arquivos.push(banner);

        embed.setImage(
            'attachment://banner.png'
        );
    }

    // ==================================
    // MENU PRINCIPAL
    // ==================================

    const menu = criarMenuPrincipal();

    return {
        embeds: [embed],
        components: [menu],
        files: arquivos,

        allowedMentions: {
            parse: []
        }
    };
}

// ==========================================
// EXPORTAÇÕES
// ==========================================

module.exports = {
    criarPublicacaoSetup,
    criarEmbedSetup,
    criarMenuPrincipal,
    OPCOES
};
