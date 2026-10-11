
'use strict';

const fs = require('fs');
const path = require('path');

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder
} = require('discord.js');

// ==========================================
// INOVARESALE BOT 3.0
// PAINEL ADMINISTRATIVO DE ESTOQUE
// ==========================================

const CONFIG = {
    nome: 'InovareSale',
    versao: '3.0.0',
    cor: 0x9951CB
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
// FORMATAÇÕES
// ==========================================

function formatarRobux(valor) {
    const numero = Number(valor || 0);

    if (!Number.isFinite(numero)) {
        return '0';
    }

    return Math.floor(
        Math.max(0, numero)
    ).toLocaleString('pt-BR');
}

function formatarK(valor) {
    const numero = Number(valor ?? 39);

    if (!Number.isFinite(numero)) {
        return 'Não configurado';
    }

    return `K${numero.toLocaleString('pt-BR', {
        maximumFractionDigits: 2
    })}`;
}

function formatarCanal(canalId) {
    const id = String(canalId || '');

    if (!/^\d{17,20}$/.test(id)) {
        return 'Não configurado';
    }

    return `<#${id}>`;
}

// ==========================================
// CARREGAR IMAGENS DO PROJETO
// ==========================================

function carregarImagem(nome) {
    const caminho = path.join(
        PASTA_ASSETS,
        nome
    );

    try {
        if (!fs.existsSync(caminho)) {
            console.warn(
                `[EstoquePanel] Imagem não encontrada: ${nome}`
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
                `[EstoquePanel] PNG inválido: ${nome}`
            );

            return null;
        }

        return new AttachmentBuilder(dados, {
            name: nome
        });

    } catch (erro) {
        console.warn(
            `[EstoquePanel] Erro ao carregar ${nome}:`,
            erro.message
        );

        return null;
    }
}

// ==========================================
// OBTER INFORMAÇÕES DO ESTOQUE
// ==========================================

function obterDadosEstoque(config = {}) {
    const estoque = config.estoque || {};

    const lojaAtiva =
        String(estoque.status || '').toUpperCase() === 'ON';

    return {
        lojaAtiva,
        status: lojaAtiva
            ? '🟢 Loja ON'
            : '🔴 Loja OFF',

        quantidade: formatarRobux(
            estoque.quantidade
        ),

        preco: formatarK(
            estoque.precoK
        ),

        canalEstoque: formatarCanal(
            estoque.canalId
        ),

        canalCompra: formatarCanal(
            estoque.canalCompraId
        )
    };
}

// ==========================================
// CRIAR EMBED DO ESTOQUE 3.0
// ==========================================

function criarEmbedEstoque(config = {}) {
    const dados = obterDadosEstoque(config);

    const embed = new EmbedBuilder()
        .setColor(CONFIG.cor)

        .setTitle(
            'INOVARESALE | GERENCIAMENTO DE ESTOQUE'
        )

        .setDescription(
            'Gerencie a disponibilidade de Robux ' +
            'e as publicações da loja pelo painel abaixo.'
        )

        // Informações principais lado a lado.
        .addFields(
            {
                name: 'Status atual',
                value: dados.status,
                inline: true
            },
            {
                name: 'Robux disponíveis',
                value: `${dados.quantidade} Robux`,
                inline: true
            },
            {
                name: 'Preço por K',
                value: dados.preco,
                inline: true
            }
        )

        // Canais configurados lado a lado.
        .addFields(
            {
                name: 'Canal de estoque',
                value: dados.canalEstoque,
                inline: true
            },
            {
                name: 'Central de Pedidos',
                value: dados.canalCompra,
                inline: true
            }
        )

        .addFields({
            name: 'Gerenciamento',
            value:
                'Utilize os botões abaixo para ativar, ' +
                'pausar ou editar a publicação do estoque.',
            inline: false
        })

        .setFooter({
            text:
                'InovareSale • Administração de Estoque'
        })

        .setTimestamp();

    return embed;
}

// ==========================================
// CRIAR BOTÕES ADMINISTRATIVOS
// ==========================================

function criarBotoesEstoque() {
    const botaoOn = new ButtonBuilder()
        .setCustomId('estoque_v2_on')
        .setLabel('Loja ON')
        .setEmoji('🟢')
        .setStyle(ButtonStyle.Success);

    const botaoOff = new ButtonBuilder()
        .setCustomId('estoque_v2_off')
        .setLabel('Loja OFF')
        .setEmoji('🔴')
        .setStyle(ButtonStyle.Danger);

    const botaoEditar = new ButtonBuilder()
        .setCustomId('estoque_v2_editar_botao')
        .setLabel('Editar anúncio')
        .setEmoji('✏️')
        .setStyle(ButtonStyle.Secondary);

    return new ActionRowBuilder()
        .addComponents(
            botaoOn,
            botaoOff,
            botaoEditar
        );
}

// ==========================================
// GERAR PAINEL DE ESTOQUE COMPLETO
// ==========================================

function criarPainelEstoque(config = {}) {
    const embed = criarEmbedEstoque(config);

    const arquivos = [];

    // ==================================
    // LOGO NO CANTO SUPERIOR DO EMBED
    // ==================================

    const logo = carregarImagem('logo.png');

    if (logo) {
        arquivos.push(logo);

        embed.setThumbnail(
            'attachment://logo.png'
        );
    }

    // ==================================
    // BANNER NA PARTE INFERIOR DO EMBED
    // ==================================

    const banner = carregarImagem('banner.png');

    if (banner) {
        arquivos.push(banner);

        embed.setImage(
            'attachment://banner.png'
        );
    }

    // ==================================
    // BOTÕES DE GERENCIAMENTO
    // ==================================

    const botoes = criarBotoesEstoque();

    // ==================================
    // RETORNAR PAINEL
    // ==================================

    return {
        embeds: [embed],
        components: [botoes],
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
    criarPainelEstoque
};
