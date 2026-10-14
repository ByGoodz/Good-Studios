
'use strict';

const fs = require('fs');
const path = require('path');

const {
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SeparatorBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder,
    MessageFlags
} = require('discord.js');

const PASTA_ASSETS = path.join(__dirname, '..', 'assets');

const ASSINATURA_PNG = Buffer.from([
    137, 80, 78, 71, 13, 10, 26, 10
]);

const EMOJI_COMPRA = {
    id: '1559819924606816366',
    name: 'ticket'
};

const EMOJI_CALCULADORA = {
    id: '1559819896995450900',
    name: 'money'
};

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

function temModalidadeDisponivel(config = {}) {
    return obterStatusModalidades(config)
        .some(modalidade => modalidade.disponivel);
}

function criarBotaoCompra(config = {}) {
    return new ButtonBuilder()
        .setCustomId('ticket_abrir')
        .setLabel('Comprar Robux')
        .setEmoji(EMOJI_COMPRA)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!temModalidadeDisponivel(config));
}

function criarBotaoCalculadora(config = {}, guildId) {
    const idServidor = String(guildId || '');

    const idCanal = String(
        config.calculadora?.canalId || ''
    );

    if (
        /^\d{17,20}$/.test(idServidor) &&
        /^\d{17,20}$/.test(idCanal)
    ) {
        return new ButtonBuilder()
            .setLabel('Calcular valores')
            .setEmoji(EMOJI_CALCULADORA)
            .setStyle(ButtonStyle.Link)
            .setURL(
                `https://discord.com/channels/${idServidor}/${idCanal}`
            );
    }

    return new ButtonBuilder()
        .setCustomId('ticket_calculadora_indisponivel')
        .setLabel('Calcular valores')
        .setEmoji(EMOJI_CALCULADORA)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true);
}

function criarContainerPedidos(config = {}, imagens = {}) {
    const container = new ContainerBuilder();

    const cabecalho = new TextDisplayBuilder()
        .setContent(
            '# INOVARESALE | CENTRAL DE PEDIDOS\n' +
            'Seja bem-vindo à **InovareSale**!\n' +
            'Adquira seus Robux com praticidade ' +
            'e atendimento especializado.'
        );

    if (imagens.logo) {
        container.addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(cabecalho)
                .setThumbnailAccessory(
                    new ThumbnailBuilder()
                        .setURL('attachment://logo.png')
                        .setDescription('InovareSale')
                )
        );
    } else {
        container.addTextDisplayComponents(cabecalho);
    }

    container
        .addSeparatorComponents(
            new SeparatorBuilder()
                .setDivider(true)
        )
        .addTextDisplayComponents(
            new TextDisplayBuilder()
                .setContent(
                    '**Compra de Robux**\n' +
                    'Escolha a quantidade e a modalidade ' +
                    'de entrega desejada.\n\n' +
                    '**Consulta de valores**\n' +
                    'Confira os preços atualizados ' +
                    'em nossa calculadora.'
                )
        );

    if (!temModalidadeDisponivel(config)) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder()
                .setContent(
                    '**Disponibilidade**\n' +
                    'No momento, não há modalidades ' +
                    'liberadas para novos pedidos.'
                )
        );
    }

    container
        .addSeparatorComponents(
            new SeparatorBuilder()
                .setDivider(true)
        )
        .addTextDisplayComponents(
            new TextDisplayBuilder()
                .setContent(
                    '**Como continuar?**\n' +
                    'Selecione uma das opções abaixo ' +
                    'para iniciar sua compra ou ' +
                    'consultar os valores.'
                )
        );

    if (imagens.banner) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder()
                .addItems(
                    new MediaGalleryItemBuilder()
                        .setURL('attachment://banner.png')
                        .setDescription(
                            'InovareSale • Robux Store'
                        )
                )
        );
    }

    return container;
}

function criarEmbedPedidos(config = {}) {
    return criarContainerPedidos(config);
}

function criarPainelPedidos(
    config = {},
    guildId = null
) {
    const logo = carregarImagem('logo.png');
    const banner = carregarImagem('banner.png');

    const arquivos = [
        logo,
        banner
    ].filter(Boolean);

    const container = criarContainerPedidos(
        config,
        {
            logo: Boolean(logo),
            banner: Boolean(banner)
        }
    );

    container
        .addSeparatorComponents(
            new SeparatorBuilder()
                .setDivider(true)
        )
        .addActionRowComponents(
            new ActionRowBuilder()
                .addComponents(
                    criarBotaoCompra(config),
                    criarBotaoCalculadora(
                        config,
                        guildId
                    )
                )
        );

    return {
        components: [container],
        files: arquivos,
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: {
            parse: []
        }
    };
}

module.exports = {
    criarPainelPedidos,
    criarEmbedPedidos,
    obterStatusModalidades
};
