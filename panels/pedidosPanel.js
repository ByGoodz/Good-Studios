
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
// PAINEL PUBLICO DE PEDIDOS
// ==========================================

const COR_PRINCIPAL = 0xC0C0C0;

const PASTA_ASSETS = path.join(
    __dirname,
    '..',
    'assets'
);

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
// CARREGAR IMAGEM PNG
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
                `[InovareSale] Imagem ausente ou inválida: ${nome}`
            );

            return null;
        }

        // Conferir se é um PNG verdadeiro.
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

        const assinaturaPng = Buffer.from([
            137, 80, 78, 71,
            13, 10, 26, 10
        ]);

        if (!assinatura.equals(assinaturaPng)) {
            console.warn(
                `[InovareSale] ${nome} não é um PNG verdadeiro.`
            );

            return null;
        }

        return new AttachmentBuilder(
            caminho,
            {
                name: nome
            }
        );

    } catch (erro) {
        console.warn(
            `[InovareSale] Não foi possível carregar ${nome}:`,
            erro.message
        );

        return null;
    }
}

// ==========================================
// VERIFICAR MODALIDADES DISPONIVEIS
// ==========================================

function obterStatusModalidades(config = {}) {
    const bloqueados =
        config.tickets?.bloqueados || {};

    const calculadora =
        config.calculadora || {};

    return MODALIDADES.map(metodo => {
        const chave = metodo.chave;

        const valorK = calculadora[chave];

        const precoValido =
            valorK !== null &&
            valorK !== undefined &&
            valorK !== false &&
            Number.isFinite(Number(valorK)) &&
            Number(valorK) > 0;

        // Via Grupo começa bloqueado.
        const bloqueado =
            chave === 'viaGrupo'
                ? bloqueados.viaGrupo !== false
                : bloqueados[chave] === true;

        return {
            ...metodo,
            disponivel: precoValido && !bloqueado,
            precoK: precoValido
                ? Number(valorK)
                : null
        };
    });
}

// ==========================================
// CRIAR EMBED DE PEDIDOS
// ==========================================

function criarEmbedPedidos(config = {}) {
    const modalidades =
        obterStatusModalidades(config);

    const lista = modalidades
        .map(metodo => {
            const status = metodo.disponivel
                ? 'Disponível'
                : 'Indisponível';

            return (
                `**${metodo.nome}**\n` +
                `↳ ${status}`
            );
        })
        .join('\n\n');

    const embed = new EmbedBuilder()
        .setColor(COR_PRINCIPAL)

        .setTitle(
            'CENTRAL DE PEDIDOS | INOVARESALE'
        )

        .setDescription(
            '**BEM-VINDO À INOVARESALE**\n\n' +

            'Sua central de compras de Robux, ' +
            'com atendimento organizado e privado.\n\n' +

            '━━━━━━━━━━━━━━━━━━━━\n\n' +

            '**COMO REALIZAR SUA COMPRA**\n\n' +

            'Clique no botão **Comprar quantia específica** ' +
            'para começar seu pedido.\n\n' +

            'Você poderá informar a quantidade de Robux, ' +
            'escolher a modalidade, preencher seu usuário ' +
            'do Roblox e selecionar o pagamento.\n\n' +

            'Ao confirmar, um ticket privado será criado ' +
            'para você conversar com nossa equipe.\n\n' +

            '━━━━━━━━━━━━━━━━━━━━\n\n' +

            '**MODALIDADES DE COMPRA**\n\n' +

            `${lista}\n\n` +

            '━━━━━━━━━━━━━━━━━━━━\n\n' +

            '**CONSULTAR VALORES**\n\n' +

            'Quer saber quanto vai pagar antes de comprar?\n' +
            'Use o botão **Calcular valores** para acessar ' +
            'a calculadora da loja.\n\n' +

            '━━━━━━━━━━━━━━━━━━━━\n\n' +

            '**INFORMAÇÕES IMPORTANTES**\n\n' +

            '• O valor será calculado conforme a modalidade escolhida.\n' +
            '• O atendimento acontece em um ticket privado.\n' +
            '• Nunca compartilhe sua senha do Roblox.\n' +
            '• Realize o pagamento somente após orientação da equipe.'
        )

        .setFooter({
            text: 'INOVARESALE • CENTRAL DE COMPRAS'
        });

    return embed;
}

// ==========================================
// BOTAO COMPRAR
// ==========================================

function criarBotaoComprar(config = {}) {
    const modalidades =
        obterStatusModalidades(config);

    const algumaDisponivel =
        modalidades.some(
            metodo => metodo.disponivel
        );

    return new ButtonBuilder()
        .setCustomId('ticket_abrir')
        .setLabel('Comprar quantia específica')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!algumaDisponivel);
}

// ==========================================
// BOTAO CALCULAR VALORES
// ==========================================

function criarBotaoCalcular(
    config = {},
    guildId = null
) {
    const canalId =
        config.calculadora?.canalId;

    if (
        guildId &&
        /^\d{15,22}$/.test(String(guildId)) &&
        canalId &&
        /^\d{15,22}$/.test(String(canalId))
    ) {
        return new ButtonBuilder()
            .setLabel('Calcular valores')
            .setStyle(ButtonStyle.Link)
            .setURL(
                `https://discord.com/channels/` +
                `${guildId}/${canalId}`
            );
    }

    return new ButtonBuilder()
        .setCustomId(
            'ticket_calculadora_indisponivel'
        )
        .setLabel('Calcular valores')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true);
}

// ==========================================
// MONTAR PAINEL COMPLETO
// ==========================================

function criarPainelPedidos(
    config = {},
    guildId = null
) {
    const embed = criarEmbedPedidos(config);

    const arquivos = [];

    // ======================================
    // LOGO
    // ======================================

    const logo = carregarImagem('logo.png');

    if (logo) {
        arquivos.push(logo);

        embed.setThumbnail(
            'attachment://logo.png'
        );
    }

    // ======================================
    // BANNER PRINCIPAL
    // ======================================

    const banner = carregarImagem('banner.png');

    if (banner) {
        arquivos.push(banner);

        embed.setImage(
            'attachment://banner.png'
        );
    }

    // ======================================
    // BOTOES
    // ======================================

    const botoes = new ActionRowBuilder()
        .addComponents(
            criarBotaoComprar(config),
            criarBotaoCalcular(
                config,
                guildId
            )
        );

    // ======================================
    // RETORNO PARA O DISCORD
    // ======================================

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
    criarPainelPedidos,
    criarEmbedPedidos,
    obterStatusModalidades,
    criarBotaoComprar,
    criarBotaoCalcular
};
