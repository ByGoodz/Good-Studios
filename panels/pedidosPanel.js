
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
// CENTRAL DE PEDIDOS
// ==========================================

const COR_PRINCIPAL = 0xC0C0C0;

// ==========================================
// BUSCAR IMAGENS
// ==========================================

function buscarImagem(nome) {
    const caminho = path.join(
        __dirname,
        '..',
        'assets',
        nome
    );

    try {
        const info = fs.statSync(caminho);

        if (
            !info.isFile() ||
            info.size <= 0 ||
            info.size > 8 * 1024 * 1024
        ) {
            return null;
        }

        return new AttachmentBuilder(
            caminho,
            { name: nome }
        );

    } catch {
        return null;
    }
}

// ==========================================
// FORMATAR CANAL
// ==========================================

function formatarCanal(canalId) {
    if (!canalId) {
        return 'Não configurado';
    }

    return `<#${canalId}>`;
}

// ==========================================
// CONSULTAR MODALIDADES
// ==========================================

function obterStatusModalidades(config) {
    const bloqueados =
        config.tickets?.bloqueados || {};

    const modalidades = [
        {
            chave: 'viaPlus',
            nome: 'Via Plus',
            emoji: '➕'
        },
        {
            chave: 'semTaxa',
            nome: 'Robux Sem Taxa',
            emoji: '💸'
        },
        {
            chave: 'taxado',
            nome: 'Robux Taxado',
            emoji: '💰'
        },
        {
            chave: 'viaGrupo',
            nome: 'Robux Via Grupo',
            emoji: '👥'
        }
    ];

    return modalidades.map(metodo => {
        const bloqueado =
            metodo.chave === 'viaGrupo'
                ? bloqueados[metodo.chave] !== false
                : bloqueados[metodo.chave] === true;

        return {
            ...metodo,
            bloqueado
        };
    });
}

// ==========================================
// CRIAR EMBED PÚBLICO
// ==========================================

function criarEmbedPedidos(config) {
    const modalidades =
        obterStatusModalidades(config);

    const lista = modalidades
        .map(metodo => {
            const status = metodo.bloqueado
                ? '🔴 Indisponível'
                : '🟢 Disponível';

            return (
                `${metodo.emoji} **${metodo.nome}**\n` +
                `↳ ${status}`
            );
        })
        .join('\n\n');

    return new EmbedBuilder()
        .setColor(COR_PRINCIPAL)

        .setTitle(
            '💎 CENTRAL DE PEDIDOS — INOVARESALE'
        )

        .setDescription(
            'Seja bem-vindo à **InovareSale**!\n\n' +

            'Nossa central de pedidos foi criada ' +
            'para facilitar sua compra de Robux.\n\n' +

            '━━━━━━━━━━━━━━━━━━━━\n\n' +

            '🛒 **COMPRE AGORA MESMO**\n\n' +

            'Escolha a quantidade de Robux, ' +
            'selecione a modalidade desejada ' +
            'e abra um ticket com nossa equipe.\n\n' +

            '━━━━━━━━━━━━━━━━━━━━\n\n' +

            '✨ **MODALIDADES DE COMPRA**\n\n' +

            `${lista}\n\n` +

            '━━━━━━━━━━━━━━━━━━━━\n\n' +

            '🧮 **QUER CONSULTAR OS PREÇOS?**\n\n' +

            'Clique em **Calcular valores** ' +
            'para acessar nossa calculadora.\n\n' +

            '🛡️ **SEGURANÇA**\n' +
            'Realize pagamentos somente após ' +
            'a confirmação da equipe.\n\n' +

            '💬 **ATENDIMENTO**\n' +
            'Ao abrir um pedido, você receberá ' +
            'um canal privado para conversar ' +
            'com nossos atendentes.'
        )

        .setFooter({
            text:
                'InovareSale • Sua loja de Robux'
        });
}

// ==========================================
// BOTÃO DE COMPRA
// ==========================================

function criarBotaoComprar(config) {
    const modalidades =
        obterStatusModalidades(config);

    const todasBloqueadas =
        modalidades.every(
            metodo => metodo.bloqueado
        );

    return new ButtonBuilder()
        .setCustomId('ticket_abrir')
        .setLabel('Comprar quantia específica')
        .setEmoji('🛒')
        .setStyle(ButtonStyle.Success)
        .setDisabled(todasBloqueadas);
}

// ==========================================
// BOTÃO DA CALCULADORA
// ==========================================

function criarBotaoCalcular(
    config,
    guildId
) {
    const canalId =
        config.calculadora?.canalId;

    if (canalId && guildId) {
        return new ButtonBuilder()
            .setLabel('Calcular valores')
            .setEmoji('🧮')
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
        .setEmoji('🧮')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true);
}

// ==========================================
// CRIAR PAINEL COMPLETO
// ==========================================

function criarPainelPedidos(
    config = {},
    guildId = null
) {
    const embed = criarEmbedPedidos(config);

    const arquivos = [];

    // Logo
    const logo = buscarImagem('logo.png');

    if (logo) {
        arquivos.push(logo);

        embed.setThumbnail(
            'attachment://logo.png'
        );
    }

    // Banner
    const banner = buscarImagem('banner.png');

    if (banner) {
        arquivos.push(banner);

        embed.setImage(
            'attachment://banner.png'
        );
    }

    // Botões
    const botoes = new ActionRowBuilder()
        .addComponents(
            criarBotaoComprar(config),
            criarBotaoCalcular(
                config,
                guildId
            )
        );

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
// EXPORTAR FUNÇÕES
// ==========================================

module.exports = {
    criarPainelPedidos,
    criarEmbedPedidos,
    obterStatusModalidades
};
