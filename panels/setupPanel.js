
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
// PAINEL CENTRAL DE CONFIGURAÇÕES
// ==========================================

const COR_PRINCIPAL = 0xC0C0C0;

const PASTA_ASSETS = path.join(
    __dirname,
    '..',
    'assets'
);

// ==========================================
// CARREGAR IMAGENS
// ==========================================

function buscarImagem(nome) {
    const caminho = path.join(
        PASTA_ASSETS,
        nome
    );

    try {
        const info = fs.statSync(caminho);

        if (
            !info.isFile() ||
            info.size === 0 ||
            info.size > 8 * 1024 * 1024
        ) {
            return null;
        }

        return new AttachmentBuilder(caminho, {
            name: nome
        });

    } catch {
        return null;
    }
}

// ==========================================
// FORMATAR INFORMAÇÕES
// ==========================================

function formatarCanal(canalId) {
    return canalId
        ? `<#${canalId}>`
        : '`Não configurado`';
}

function formatarStatus(status) {
    return status === 'ON'
        ? '🟢 Aberta'
        : '🔴 Fechada';
}

function contarModalidades(config) {
    const bloqueados =
        config.tickets?.bloqueados || {};

    const metodos = [
        'viaPlus',
        'semTaxa',
        'taxado',
        'viaGrupo'
    ];

    return metodos.filter(metodo => {
        if (metodo === 'viaGrupo') {
            return bloqueados[metodo] === false;
        }

        return bloqueados[metodo] !== true;
    }).length;
}

// ==========================================
// CRIAR EMBED PRINCIPAL
// ==========================================

function criarEmbedSetup(config = {}) {
    const estoque = config.estoque || {};
    const calculadora = config.calculadora || {};
    const vendas = config.vendas || {};
    const tickets = config.tickets || {};

    const modalidadesAtivas =
        contarModalidades(config);

    const embed = new EmbedBuilder()
        .setColor(COR_PRINCIPAL)

        .setTitle(
            '⚙️ CENTRAL ADMINISTRATIVA — INOVARESALE'
        )

        .setDescription(
            '💎 **Bem-vindo ao Painel Central 2.0!**\n\n' +

            'Gerencie todas as funcionalidades ' +
            'da InovareSale diretamente pelo Discord.\n\n' +

            '━━━━━━━━━━━━━━━━━━━━\n\n' +

            '🧮 **CALCULADORA**\n' +
            'Configure os valores K, modalidades ' +
            'e canal de cálculos.\n\n' +

            '📦 **ESTOQUE**\n' +
            'Gerencie o status da loja, os canais ' +
            'e o preço exibido.\n\n' +

            '💰 **VENDAS**\n' +
            'Configure o canal das vendas ' +
            'e acompanhe os registros.\n\n' +

            '🏆 **CARGOS**\n' +
            'Gerencie os níveis de clientes ' +
            'e as recompensas automáticas.\n\n' +

            '🎫 **TICKETS**\n' +
            'Configure equipe de atendimento, ' +
            'categorias e permissões.\n\n' +

            '🔐 **BLOQUEIOS**\n' +
            'Libere ou bloqueie novas compras ' +
            'por modalidade.\n\n' +

            '🛒 **CENTRAL DE PEDIDOS**\n' +
            'Configure e publique o painel ' +
            'onde os clientes iniciam suas compras.\n\n' +

            '━━━━━━━━━━━━━━━━━━━━\n\n' +

            '🛡️ **ACESSO RESTRITO**\n' +
            'Somente administradores podem ' +
            'alterar as configurações.'
        )

        .addFields(
            {
                name: '🏪 Status da loja',
                value: formatarStatus(
                    estoque.status
                ),
                inline: true
            },
            {
                name: '🎫 Modalidades liberadas',
                value:
                    `**${modalidadesAtivas}/4**`,
                inline: true
            },
            {
                name: '🧮 Canal da calculadora',
                value: formatarCanal(
                    calculadora.canalId
                ),
                inline: false
            },
            {
                name: '📢 Canal de vendas',
                value: formatarCanal(
                    vendas.canalId
                ),
                inline: false
            },
            {
                name: '🛒 Central de Pedidos',
                value: formatarCanal(
                    tickets.painelCanalId
                ),
                inline: false
            }
        )

        .setFooter({
            text:
                'InovareSale Bot 2.0 • Painel Administrativo'
        })

        .setTimestamp();

    return embed;
}

// ==========================================
// BOTÕES DA PRIMEIRA LINHA
// ==========================================

function criarLinhaPrincipal() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(
                    'setup_calculadora'
                )
                .setLabel('Calculadora')
                .setEmoji('🧮')
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId(
                    'setup_estoque'
                )
                .setLabel('Estoque')
                .setEmoji('📦')
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId(
                    'setup_vendas'
                )
                .setLabel('Vendas')
                .setEmoji('💰')
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId(
                    'setup_cargos'
                )
                .setLabel('Cargos')
                .setEmoji('🏆')
                .setStyle(ButtonStyle.Secondary)
        );
}

// ==========================================
// BOTÕES DA SEGUNDA LINHA
// ==========================================

function criarLinhaAvancada() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(
                    'setup_tickets'
                )
                .setLabel('Tickets')
                .setEmoji('🎫')
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId(
                    'setup_bloqueios'
                )
                .setLabel('Bloqueios')
                .setEmoji('🔐')
                .setStyle(ButtonStyle.Danger),

            new ButtonBuilder()
                .setCustomId(
                    'setup_pedidos'
                )
                .setLabel('Central de Pedidos')
                .setEmoji('🛒')
                .setStyle(ButtonStyle.Secondary)
        );
}

// ==========================================
// CRIAR PAINEL SEM ANEXAR IMAGENS
//
// Útil para atualizar mensagens existentes
// ou mostrar submenus administrativos.
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
// CRIAR PAINEL COM LOGO E BANNER
//
// Usado para publicar uma mensagem nova.
// ==========================================

function criarPublicacaoSetup(config = {}) {
    const embed = criarEmbedSetup(config);

    const arquivos = [];

    const logo = buscarImagem('logo.png');

    if (logo) {
        arquivos.push(logo);

        embed.setThumbnail(
            'attachment://logo.png'
        );
    }

    const banner = buscarImagem('banner.png');

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
// EXPORTAR FUNÇÕES
// ==========================================

module.exports = {
    criarPainelSetup,
    criarPublicacaoSetup,
    criarEmbedSetup,
    criarLinhaPrincipal,
    criarLinhaAvancada
};
