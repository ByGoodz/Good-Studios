
'use strict';

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder
} = require('discord.js');

const fs = require('fs');
const path = require('path');

// ==========================================
// INOVARESALE BOT 2.0
// PAINEL CENTRAL ADMINISTRATIVO
// ==========================================

const COR_PRATA = 0xC0C0C0;

const PASTA_ASSETS = path.join(
    __dirname,
    '..',
    'assets'
);

// ==========================================
// CARREGAR AS IMAGENS ORIGINAIS
// ==========================================

function carregarImagem(nome) {
    const caminho = path.join(
        PASTA_ASSETS,
        nome
    );

    try {
        const info = fs.statSync(caminho);

        if (
            !info.isFile() ||
            info.size <= 0 ||
            info.size > 8 * 1024 * 1024
        ) {
            console.warn(
                `[InovareSale] Imagem inválida: ${nome}`
            );

            return null;
        }

        const assinatura = Buffer.alloc(8);

        const arquivo = fs.openSync(
            caminho,
            'r'
        );

        try {
            fs.readSync(
                arquivo,
                assinatura,
                0,
                8,
                0
            );
        } finally {
            fs.closeSync(arquivo);
        }

        const png = Buffer.from([
            137, 80, 78, 71,
            13, 10, 26, 10
        ]);

        if (!assinatura.equals(png)) {
            console.warn(
                `[InovareSale] ${nome} não é PNG válido.`
            );

            return null;
        }

        return new AttachmentBuilder(
            caminho,
            { name: nome }
        );

    } catch (erro) {
        console.warn(
            `[InovareSale] Falha ao carregar ${nome}:`,
            erro.message
        );

        return null;
    }
}

// ==========================================
// FORMATAR OS DADOS
// ==========================================

function formatarCanal(id) {
    return id
        ? `<#${id}>`
        : '`Não configurado`';
}

function formatarStatus(status) {
    return status === 'ON'
        ? 'ONLINE'
        : 'OFFLINE';
}

function contarModalidades(config = {}) {
    const bloqueados =
        config.tickets?.bloqueados || {};

    const calc =
        config.calculadora || {};

    const metodos = [
        'viaPlus',
        'semTaxa',
        'taxado',
        'viaGrupo'
    ];

    return metodos.filter(chave => {
        const preco = calc[chave];

        const valido =
            preco !== null &&
            preco !== undefined &&
            Number.isFinite(Number(preco)) &&
            Number(preco) > 0;

        const bloqueado =
            chave === 'viaGrupo'
                ? bloqueados.viaGrupo !== false
                : bloqueados[chave] === true;

        return valido && !bloqueado;
    }).length;
}

// ==========================================
// EMBED PRINCIPAL
// ==========================================

function criarEmbedSetup(config = {}) {
    const estoque = config.estoque || {};
    const calculadora = config.calculadora || {};
    const vendas = config.vendas || {};
    const tickets = config.tickets || {};

    const status = formatarStatus(
        estoque.status
    );

    const modalidades = contarModalidades(
        config
    );

    const embed = new EmbedBuilder()
        .setColor(COR_PRATA)

        .setTitle(
            'INOVARESALE  |  CENTRAL ADMINISTRATIVA'
        )

        .setDescription(
            '**PAINEL DE CONTROLE — VERSÃO 2.0**\n\n' +

            'Gerencie sua loja, pedidos e atendimento ' +
            'diretamente por este painel.\n\n' +

            '━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +

            '**GERENCIAMENTO DA LOJA**\n\n' +

            '**Calculadora**\n' +
            'Configure os preços K e o canal de cálculos.\n\n' +

            '**Estoque**\n' +
            'Gerencie os canais, o preço e o estoque disponível.\n\n' +

            '**Vendas**\n' +
            'Defina onde as compras concluídas serão anunciadas.\n\n' +

            '**Cargos**\n' +
            'Configure as classificações automáticas dos clientes.\n\n' +

            '━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +

            '**ATENDIMENTO E COMPRAS**\n\n' +

            '**Tickets**\n' +
            'Configure a equipe e as categorias de atendimento.\n\n' +

            '**Bloqueios**\n' +
            'Libere ou interrompa compras por modalidade.\n\n' +

            '**Central de Pedidos**\n' +
            'Publique o painel de compras com o banner da loja.\n\n' +

            '━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +

            '**ACESSO ADMINISTRATIVO**\n' +
            'O painel pode ser visualizado por todos, ' +
            'mas somente administradores podem alterar ' +
            'as configurações.'
        )

        .addFields(
            {
                name: 'STATUS DA LOJA',
                value: `**${status}**`,
                inline: true
            },
            {
                name: 'MODALIDADES ATIVAS',
                value: `**${modalidades}/4**`,
                inline: true
            },
            {
                name: 'CANAL DA CALCULADORA',
                value: formatarCanal(
                    calculadora.canalId
                ),
                inline: false
            },
            {
                name: 'CANAL DE VENDAS',
                value: formatarCanal(
                    vendas.canalId
                ),
                inline: false
            },
            {
                name: 'CENTRAL DE PEDIDOS',
                value: formatarCanal(
                    tickets.painelCanalId
                ),
                inline: false
            }
        )

        .setFooter({
            text:
                'INOVARESALE • PAINEL DE CONTROLE'
        });

    return embed;
}

// ==========================================
// PRIMEIRA LINHA DE BOTÕES
// ==========================================

function criarLinhaPrincipal() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('setup_calculadora')
                .setLabel('Calculadora')
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId('setup_estoque')
                .setLabel('Estoque')
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId('setup_vendas')
                .setLabel('Vendas')
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId('setup_cargos')
                .setLabel('Cargos')
                .setStyle(ButtonStyle.Secondary)
        );
}

// ==========================================
// SEGUNDA LINHA DE BOTÕES
// ==========================================

function criarLinhaAvancada() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('setup_tickets')
                .setLabel('Tickets')
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId('setup_bloqueios')
                .setLabel('Bloqueios')
                .setStyle(ButtonStyle.Danger),

            new ButtonBuilder()
                .setCustomId('setup_pedidos')
                .setLabel('Central de Pedidos')
                .setStyle(ButtonStyle.Secondary)
        );
}

// ==========================================
// PAINEL SEM NOVOS ANEXOS
//
// Usado nos submenus administrativos.
// ==========================================

function criarPainelSetup(
    config = {},
    imagens = {}
) {
    const embed = criarEmbedSetup(config);

    if (imagens.logo) {
        embed.setThumbnail(imagens.logo);
    }

    if (imagens.banner) {
        embed.setImage(imagens.banner);
    }

    return {
        embeds: [embed],

        components: [
            criarLinhaPrincipal(),
            criarLinhaAvancada()
        ],

        allowedMentions: {
            parse: []
        }
    };
}

// ==========================================
// PUBLICAÇÃO COMPLETA COM AS IMAGENS
//
// Usada ao executar /setup.
// ==========================================

function criarPublicacaoSetup(config = {}) {
    const embed = criarEmbedSetup(config);

    const arquivos = [];

    // Logo original da InovareSale.
    const logo = carregarImagem('logo.png');

    if (logo) {
        arquivos.push(logo);

        embed.setThumbnail(
            'attachment://logo.png'
        );
    }

    // Banner original da InovareSale.
    const banner = carregarImagem('banner.png');

    if (banner) {
        arquivos.push(banner);

        embed.setImage(
            'attachment://banner.png'
        );
    }

    return {
        embeds: [embed],

        components: [
            criarLinhaPrincipal(),
            criarLinhaAvancada()
        ],

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
    criarEmbedSetup,
    criarPainelSetup,
    criarPublicacaoSetup,
    criarLinhaPrincipal,
    criarLinhaAvancada
};
