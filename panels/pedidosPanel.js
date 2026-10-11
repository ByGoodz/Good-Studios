
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
// CENTRAL DE PEDIDOS
// ==========================================

const COR = 0x9951CB;

const PASTA_ASSETS = path.join(
    __dirname,
    '..',
    'assets'
);

const ASSINATURA_PNG = Buffer.from([
    137, 80, 78, 71, 13, 10, 26, 10
]);

// ==========================================
// MODALIDADES DA LOJA
// ==========================================

const MODALIDADES = [
    {
        chave: 'viaPlus',
        nome: 'Via Plus'
    },
    {
        chave: 'semTaxa',
        nome: 'Robux Sem Taxa'
    },
    {
        chave: 'taxado',
        nome: 'Robux Taxado'
    },
    {
        chave: 'viaGrupo',
        nome: 'Robux Via Grupo'
    }
];

// ==========================================
// CARREGAR IMAGENS PNG
// ==========================================

function carregarImagem(nome) {
    const caminho = path.join(
        PASTA_ASSETS,
        nome
    );

    try {
        if (!fs.existsSync(caminho)) {
            console.warn(
                `[Pedidos] Imagem não encontrada: ${nome}`
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
                `[Pedidos] PNG inválido ou muito grande: ${nome}`
            );

            return null;
        }

        return new AttachmentBuilder(dados, {
            name: nome
        });

    } catch (erro) {
        console.warn(
            `[Pedidos] Erro ao carregar ${nome}:`,
            erro.message
        );

        return null;
    }
}

// ==========================================
// CONSULTAR MODALIDADES DISPONÍVEIS
// ==========================================

function obterStatusModalidades(config = {}) {
    const bloqueados =
        config.tickets?.bloqueados || {};

    const calculadora =
        config.calculadora || {};

    return MODALIDADES.map(modalidade => {
        const precoK = calculadora[modalidade.chave];

        const possuiPreco =
            precoK !== null &&
            precoK !== undefined &&
            Number.isFinite(Number(precoK)) &&
            Number(precoK) > 0;

        // Preserva a regra anterior:
        // Via Grupo começa indisponível até
        // ser explicitamente liberada no setup.
        const bloqueado =
            modalidade.chave === 'viaGrupo'
                ? bloqueados.viaGrupo !== false
                : bloqueados[modalidade.chave] === true;

        return {
            ...modalidade,
            disponivel: possuiPreco && !bloqueado
        };
    });
}

// ==========================================
// VERIFICAR SE A LOJA RECEBE PEDIDOS
// ==========================================

function temModalidadeDisponivel(config = {}) {
    return obterStatusModalidades(config)
        .some(modalidade => modalidade.disponivel);
}

// ==========================================
// EMBED CENTRAL DE PEDIDOS 3.0
// ==========================================

function criarEmbedPedidos(config = {}) {
    const disponivel =
        temModalidadeDisponivel(config);

    const embed = new EmbedBuilder()
        .setColor(COR)
        .setTitle(
            'INOVARESALE | CENTRAL DE PEDIDOS'
        )
        .setDescription(
            'Seja bem-vindo à **InovareSale**!\n' +
            'Adquira seus Robux com praticidade e ' +
            'atendimento especializado.'
        )

        // Informações lado a lado.
        .addFields(
            {
                name: 'Compra de Robux',
                value:
                    'Escolha a quantidade e a ' +
                    'modalidade de entrega desejada.',
                inline: true
            },
            {
                name: 'Consulta de valores',
                value:
                    'Confira os preços atualizados ' +
                    'em nossa calculadora.',
                inline: true
            }
        );

    if (!disponivel) {
        embed.addFields({
            name: 'Disponibilidade',
            value:
                'No momento, não há modalidades ' +
                'liberadas para novos pedidos.',
            inline: false
        });
    }

    embed.addFields({
        name: 'Como continuar?',
        value:
            'Selecione uma das opções abaixo ' +
            'para iniciar sua compra ou consultar os valores.',
        inline: false
    });

    embed.setFooter({
        text:
            'InovareSale • Sua loja de Robux'
    });

    return embed;
}

// ==========================================
// BOTÃO DE COMPRA
// ==========================================

function criarBotaoCompra(config = {}) {
    const disponivel =
        temModalidadeDisponivel(config);

    return new ButtonBuilder()
        .setCustomId('ticket_abrir')
        .setLabel('Comprar Robux')
        .setEmoji('🛒')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!disponivel);
}

// ==========================================
// BOTÃO DA CALCULADORA
// ==========================================

function criarBotaoCalculadora(config = {}, guildId) {
    const canalId =
        config.calculadora?.canalId;

    const idServidor = String(guildId || '');
    const idCanal = String(canalId || '');

    if (
        /^\d{17,20}$/.test(idServidor) &&
        /^\d{17,20}$/.test(idCanal)
    ) {
        return new ButtonBuilder()
            .setLabel('Calcular valores')
            .setEmoji('🧮')
            .setStyle(ButtonStyle.Link)
            .setURL(
                `https://discord.com/channels/${idServidor}/${idCanal}`
            );
    }

    return new ButtonBuilder()
        .setCustomId(
            'ticket_calculadora_indisponivel'
        )
        .setLabel('Calcular valores')
        .setEmoji('🧮')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true);
}

// ==========================================
// GERAR PAINEL DE PEDIDOS COMPLETO
// ==========================================

function criarPainelPedidos(
    config = {},
    guildId = null
) {
    const embed = criarEmbedPedidos(config);

    const arquivos = [];

    // ==================================
    // LOGO NO CANTO SUPERIOR
    // ==================================

    const logo = carregarImagem('logo.png');

    if (logo) {
        arquivos.push(logo);

        embed.setThumbnail(
            'attachment://logo.png'
        );
    }

    // ==================================
    // BANNER DA INOVARESALE
    // ==================================

    // O Discord exibirá a imagem abaixo
    // das informações e acima dos botões.
    const banner = carregarImagem('banner.png');

    if (banner) {
        arquivos.push(banner);

        embed.setImage(
            'attachment://banner.png'
        );
    }

    // ==================================
    // BOTÕES PRINCIPAIS
    // ==================================

    const botoes = new ActionRowBuilder()
        .addComponents(
            criarBotaoCompra(config),
            criarBotaoCalculadora(
                config,
                guildId
            )
        );

    // ==================================
    // RETORNO DO PAINEL
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

// Mantemos os mesmos nomes de funções
// utilizados pelo restante do bot.

module.exports = {
    criarPainelPedidos,
    criarEmbedPedidos,
    obterStatusModalidades
};
