
'use strict';

const fs = require('fs');
const path = require('path');

const {
    EmbedBuilder,
    AttachmentBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    ChannelType
} = require('discord.js');

const {
    getConfig,
    saveConfig
} = require('../utils/storage');

// ==========================================
// INOVARESALE BOT 3.0
// GERENCIADOR DE ESTOQUE
// ==========================================

const COR = 0x9951CB;
const LIMITE_ROBUX = 50000000;

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

    if (
        !Number.isFinite(numero) ||
        numero <= 0
    ) {
        return 'Não configurado';
    }

    return `K${numero.toLocaleString(
        'pt-BR',
        {
            maximumFractionDigits: 2
        }
    )}`;
}

function formatarCanal(canalId) {
    return /^\d{17,20}$/.test(
        String(canalId || '')
    )
        ? `<#${canalId}>`
        : 'Não configurado';
}

// ==========================================
// VALIDAR QUANTIDADE
// ==========================================

function interpretarQuantidade(texto) {
    const entrada = String(texto || '')
        .trim()
        .toLowerCase()
        .replace(/\s/g, '');

    let quantidade;

    if (/^\d+(?:[.,]\d+)?k$/.test(entrada)) {
        quantidade = Number(
            entrada
                .slice(0, -1)
                .replace(',', '.')
        ) * 1000;

    } else if (
        /^\d{1,3}(?:\.\d{3})+$/.test(entrada)
    ) {
        quantidade = Number(
            entrada.replace(/\./g, '')
        );

    } else if (/^\d+$/.test(entrada)) {
        quantidade = Number(entrada);

    } else {
        return null;
    }

    if (
        !Number.isSafeInteger(quantidade) ||
        quantidade <= 0 ||
        quantidade > LIMITE_ROBUX
    ) {
        return null;
    }

    return quantidade;
}

// ==========================================
// VERIFICAR PERMISSÃO ADMINISTRATIVA
// ==========================================

function usuarioPodeGerenciar(interaction) {
    return Boolean(
        interaction.inGuild() &&
        interaction.memberPermissions?.has(
            PermissionFlagsBits.Administrator
        )
    );
}

// ==========================================
// OBTER CONFIGURAÇÃO ATUAL
// ==========================================

function obterConfiguracaoEstoque() {
    const config = getConfig();

    config.estoque ??= {};

    return config;
}

// ==========================================
// OBTER CANAL DO ESTOQUE
// ==========================================

async function obterCanalEstoque(
    guild,
    config
) {
    if (!guild) {
        throw new Error(
            'Servidor não informado.'
        );
    }

    const canalId =
        config.estoque?.canalId;

    if (!canalId) {
        throw new Error(
            'Configure o canal do estoque no /setup.'
        );
    }

    const canal =
        await guild.channels.fetch(canalId);

    if (
        !canal ||
        canal.type !== ChannelType.GuildText ||
        typeof canal.send !== 'function'
    ) {
        throw new Error(
            'O canal do estoque é inválido ou inacessível.'
        );
    }

    return canal;
}

// ==========================================
// CARREGAR IMAGENS
// ==========================================

function carregarImagem(nome) {
    const caminho = path.join(
        PASTA_ASSETS,
        nome
    );

    try {
        if (!fs.existsSync(caminho)) {
            console.warn(
                `[Estoque] Imagem não encontrada: ${nome}`
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
                `[Estoque] PNG inválido: ${nome}`
            );

            return null;
        }

        return new AttachmentBuilder(dados, {
            name: nome
        });

    } catch (erro) {
        console.error(
            `[Estoque] Erro ao carregar ${nome}:`,
            erro.message
        );

        return null;
    }
}

// ==========================================
// CRIAR TEXTO COMPATÍVEL
// ==========================================

// Mantemos esta função porque outros
// arquivos podem utilizá-la.
//
// O anúncio principal da versão 3.0
// será publicado por criarPublicacaoEstoque.

function criarMensagemEstoque(config = {}) {
    const estoque = config.estoque || {};

    if (estoque.status !== 'ON') {
        return (
            '🔴 **LOJA OFF!**\n\n' +
            'As vendas estão temporariamente pausadas.\n' +
            'Aguarde o retorno da InovareSale.'
        );
    }

    return (
        '🟢 **LOJA ON!**\n\n' +
        `**Estoque:** ${
            formatarRobux(estoque.quantidade)
        } Robux\n` +
        `**Preço:** ${
            formatarK(estoque.precoK)
        }\n` +
        `**Comprar:** ${
            formatarCanal(estoque.canalCompraId)
        }`
    );
}

// ==========================================
// CRIAR EMBED DO ANÚNCIO 3.0
// ==========================================

function criarEmbedEstoque(config = {}) {
    const estoque = config.estoque || {};

    const lojaAtiva =
        estoque.status === 'ON';

    const quantidade = formatarRobux(
        estoque.quantidade
    );

    const preco = formatarK(
        estoque.precoK
    );

    const status = lojaAtiva
        ? '🟢 Loja ON'
        : '🔴 Loja OFF';

    const embed = new EmbedBuilder()
        .setColor(COR)
        .setTitle(
            'INOVARESALE | ESTOQUE DE ROBUX'
        )
        .setDescription(
            lojaAtiva
                ? (
                    'Nossa loja está disponível para ' +
                    'novos pedidos! Confira o estoque ' +
                    'e inicie sua compra.'
                )
                : (
                    'As vendas estão temporariamente ' +
                    'pausadas.\n\n' +
                    'Aguarde uma nova atualização ' +
                    'da equipe InovareSale.'
                )
        )
        .addFields(
            {
                name: 'Status da loja',
                value: status,
                inline: true
            },
            {
                name: 'Robux disponíveis',
                value: `${quantidade} Robux`,
                inline: true
            },
            {
                name: 'Preço por K',
                value: preco,
                inline: true
            }
        );

    if (lojaAtiva) {
        embed.addFields({
            name: 'Central de Pedidos',
            value: formatarCanal(
                estoque.canalCompraId
            ),
            inline: false
        });
    }

    embed.setFooter({
        text:
            'InovareSale • Sua loja de Robux'
    });

    embed.setTimestamp();

    return embed;
}

// ==========================================
// CRIAR PUBLICAÇÃO COMPLETA
// ==========================================

function criarPublicacaoEstoque(
    config = {},
    guildId = null
) {
    const embed = criarEmbedEstoque(config);
    const arquivos = [];

    const logo = carregarImagem('logo.png');

    if (logo) {
        arquivos.push(logo);

        embed.setThumbnail(
            'attachment://logo.png'
        );
    }

    const banner = carregarImagem('banner.png');

    if (banner) {
        arquivos.push(banner);

        embed.setImage(
            'attachment://banner.png'
        );
    }

    const componentes = [];

    const canalCompraId = String(
        config.estoque?.canalCompraId || ''
    );

    const servidorId = String(
        guildId || ''
    );

    if (
        config.estoque?.status === 'ON' &&
        /^\d{17,20}$/.test(servidorId) &&
        /^\d{17,20}$/.test(canalCompraId)
    ) {
        componentes.push(
            new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('Comprar Robux')
                        .setEmoji('🛒')
                        .setStyle(ButtonStyle.Link)
                        .setURL(
                            `https://discord.com/channels/${servidorId}/${canalCompraId}`
                        )
                )
        );
    }

    return {
        embeds: [embed],
        components: componentes,
        files: arquivos,
        allowedMentions: {
            parse: []
        }
    };
}

// ==========================================
// IDENTIFICAR ANÚNCIO DE ESTOQUE
// ==========================================

function ehPublicacaoEstoque(
    mensagem,
    botId
) {
    if (
        !mensagem ||
        mensagem.author?.id !== botId
    ) {
        return false;
    }

    const conteudo = String(
        mensagem.content || ''
    );

    const textosAntigos = [
        '𝐋𝐎𝐉𝐀 𝐎𝐍',
        '𝐋𝐎𝐉𝐀 𝐎𝐅𝐅',
        'LOJA ON!',
        'LOJA OFF!'
    ];

    if (
        textosAntigos.some(texto =>
            conteudo.includes(texto)
        )
    ) {
        return true;
    }

    // Identifica os embeds do modelo 3.0.
    const embeds = mensagem.embeds || [];

    return embeds.some(embed =>
        String(embed.title || '').includes(
            'INOVARESALE | ESTOQUE DE ROBUX'
        )
    );
}

// ==========================================
// BUSCAR ÚLTIMO ANÚNCIO
// ==========================================

async function buscarUltimaPublicacao(
    canal,
    config,
    botId
) {
    const mensagemId =
        config.estoque?.ultimaMensagemId;

    if (mensagemId) {
        try {
            const mensagem =
                await canal.messages.fetch(
                    mensagemId
                );

            if (
                ehPublicacaoEstoque(
                    mensagem,
                    botId
                )
            ) {
                return mensagem;
            }

        } catch {
            // Publicação antiga removida.
        }
    }

    // Compatibilidade com anúncios
    // das versões anteriores.
    const mensagens =
        await canal.messages.fetch({
            limit: 100
        });

    return mensagens.find(
        mensagem => ehPublicacaoEstoque(
            mensagem,
            botId
        )
    ) || null;
}

// ==========================================
// PUBLICAR NOVO ESTOQUE
// ==========================================

async function publicarEstoque({
    guild,
    client,
    status,
    quantidade = 0
}) {
    if (!client?.user?.id) {
        throw new Error(
            'Bot indisponível.'
        );
    }

    if (!['ON', 'OFF'].includes(status)) {
        throw new Error(
            'Status do estoque inválido.'
        );
    }

    if (
        status === 'ON' &&
        (
            !Number.isSafeInteger(quantidade) ||
            quantidade <= 0 ||
            quantidade > LIMITE_ROBUX
        )
    ) {
        throw new Error(
            'Informe uma quantidade válida de Robux.'
        );
    }

    const config =
        obterConfiguracaoEstoque();

    const canal = await obterCanalEstoque(
        guild,
        config
    );

    // ======================================
    // PREPARAR NOVO ESTOQUE
    // ======================================

    const configAtualizada = {
        ...config,

        estoque: {
            ...config.estoque,

            status,

            quantidade:
                status === 'OFF'
                    ? 0
                    : quantidade
        }
    };

    // ======================================
    // PUBLICAR PRIMEIRO O ANÚNCIO NOVO
    // ======================================

    // Só atualizamos o banco depois
    // que o Discord confirmar o envio.

    const novaMensagem = await canal.send(
        criarPublicacaoEstoque(
            configAtualizada,
            guild.id
        )
    );

    const mensagemAnteriorId =
        config.estoque.ultimaMensagemId;

    // ======================================
    // SALVAR NO SQLITE
    // ======================================

    configAtualizada.estoque.ultimaMensagemId =
        novaMensagem.id;

    saveConfig(configAtualizada);

    // ======================================
    // IDENTIFICAR ANÚNCIOS ANTERIORES
    // ======================================

    const mensagensAntigas = new Map();

    if (
        mensagemAnteriorId &&
        mensagemAnteriorId !== novaMensagem.id
    ) {
        try {
            const anterior =
                await canal.messages.fetch(
                    mensagemAnteriorId
                );

            if (
                ehPublicacaoEstoque(
                    anterior,
                    client.user.id
                )
            ) {
                mensagensAntigas.set(
                    anterior.id,
                    anterior
                );
            }

        } catch {
            // Mensagem inexistente.
        }
    }

    try {
        const recentes =
            await canal.messages.fetch({
                limit: 100
            });

        for (const mensagem of recentes.values()) {
            if (
                mensagem.id !== novaMensagem.id &&
                ehPublicacaoEstoque(
                    mensagem,
                    client.user.id
                )
            ) {
                mensagensAntigas.set(
                    mensagem.id,
                    mensagem
                );
            }
        }

    } catch (erro) {
        console.warn(
            '[Estoque] Não foi possível consultar os anúncios antigos:',
            erro.message
        );
    }

    // ======================================
    // REMOVER SOMENTE ANÚNCIOS DE ESTOQUE
    // ======================================

    let apagadas = 0;
    let falhas = 0;

    for (
        const mensagem
        of mensagensAntigas.values()
    ) {
        try {
            await mensagem.delete();
            apagadas++;

        } catch (erro) {
            falhas++;

            console.error(
                '[Estoque] Não foi possível excluir a publicação:',
                mensagem.id,
                erro.message
            );
        }
    }

    return {
        mensagem: novaMensagem,
        status,

        quantidade:
            configAtualizada.estoque.quantidade,

        apagadas,
        falhas
    };
}

// ==========================================
// EDITAR ÚLTIMO ANÚNCIO
// ==========================================

// Mantém a mesma assinatura da versão 2.0.
//
// O texto informado será uma observação
// personalizada acima do embed de estoque.
//
// Assim preservamos o banner e os campos
// de status, Robux e preço por K.

async function editarUltimoEstoque({
    guild,
    client,
    novoTexto
}) {
    if (!client?.user?.id) {
        throw new Error(
            'Bot indisponível.'
        );
    }

    const texto = String(
        novoTexto || ''
    ).trim();

    if (
        texto.length < 1 ||
        texto.length > 2000
    ) {
        throw new Error(
            'A mensagem deve ter entre ' +
            '1 e 2.000 caracteres.'
        );
    }

    const config =
        obterConfiguracaoEstoque();

    const canal = await obterCanalEstoque(
        guild,
        config
    );

    const mensagem =
        await buscarUltimaPublicacao(
            canal,
            config,
            client.user.id
        );

    if (!mensagem) {
        throw new Error(
            'Nenhuma publicação de estoque foi encontrada.'
        );
    }

    // Edita apenas o texto.
    // Os embeds, botões e anexos
    // permanecem na mensagem.

    await mensagem.edit({
        content: texto,

        allowedMentions: {
            parse: []
        }
    });

    config.estoque.ultimaMensagemId =
        mensagem.id;

    saveConfig(config);

    return mensagem;
}

// ==========================================
// CONSULTAR ESTOQUE
// ==========================================

function consultarEstoque() {
    const config =
        obterConfiguracaoEstoque();

    return {
        status:
            config.estoque.status || 'OFF',

        quantidade: Number(
            config.estoque.quantidade || 0
        ),

        precoK: Number(
            config.estoque.precoK ?? 39
        ),

        canalId:
            config.estoque.canalId || null,

        canalCompraId:
            config.estoque.canalCompraId || null,

        ultimaMensagemId:
            config.estoque.ultimaMensagemId || null
    };
}

// ==========================================
// EXPORTAÇÕES COMPATÍVEIS
// ==========================================

module.exports = {
    interpretarQuantidade,
    formatarRobux,
    formatarK,
    usuarioPodeGerenciar,
    obterCanalEstoque,
    buscarUltimaPublicacao,
    criarMensagemEstoque,
    publicarEstoque,
    editarUltimoEstoque,
    consultarEstoque,

    // Novas funções do visual 3.0.
    criarEmbedEstoque,
    criarPublicacaoEstoque,
    ehPublicacaoEstoque
};
