
const {
    PermissionFlagsBits
} = require('discord.js');

const {
    getConfig,
    saveConfig
} = require('../utils/storage');

// ==========================================
// INOVARESALE BOT 2.0
// GERENCIADOR DE ESTOQUE
// ==========================================

// ==========================================
// FORMATAÇÕES
// ==========================================

function formatarRobux(valor) {
    return Number(valor || 0).toLocaleString(
        'pt-BR'
    );
}

function formatarK(valor) {
    return `K${Number(valor).toLocaleString(
        'pt-BR',
        {
            maximumFractionDigits: 2
        }
    )}`;
}

// ==========================================
// VALIDAR QUANTIDADE DE ROBUX
// ==========================================

function interpretarQuantidade(texto) {
    let valor = String(texto || '')
        .trim()
        .toLowerCase()
        .replace(/\s/g, '');

    if (valor.endsWith('k')) {
        const numero = Number(
            valor.slice(0, -1).replace(',', '.')
        );

        if (
            !Number.isFinite(numero) ||
            numero <= 0
        ) {
            return null;
        }

        const quantidade = Math.floor(
            numero * 1000
        );

        return Number.isSafeInteger(quantidade)
            && quantidade > 0
            ? quantidade
            : null;
    }

    if (!/^[\d.,]+$/.test(valor)) {
        return null;
    }

    valor = valor
        .replace(/\./g, '')
        .replace(',', '.');

    const numero = Number(valor);

    if (
        !Number.isFinite(numero) ||
        numero <= 0
    ) {
        return null;
    }

    const quantidade = Math.floor(numero);

    return Number.isSafeInteger(quantidade)
        && quantidade > 0
        ? quantidade
        : null;
}

// ==========================================
// VERIFICAR PERMISSÃO ADMINISTRATIVA
// ==========================================

function usuarioPodeGerenciar(interaction) {
    return Boolean(
        interaction.memberPermissions?.has(
            PermissionFlagsBits.Administrator
        )
    );
}

// ==========================================
// VERIFICAR CONFIGURAÇÃO
// ==========================================

function obterConfiguracaoEstoque() {
    const config = getConfig();

    if (!config.estoque) {
        config.estoque = {};
    }

    return config;
}

// ==========================================
// BUSCAR CANAL DE ESTOQUE
// ==========================================

async function obterCanalEstoque(guild, config) {
    if (!guild) {
        throw new Error(
            'Servidor não informado.'
        );
    }

    const canalId = config.estoque?.canalId;

    if (!canalId) {
        throw new Error(
            'Configure o canal do estoque no /setup.'
        );
    }

    const canal = await guild.channels.fetch(
        canalId
    );

    if (
        !canal ||
        !canal.isTextBased() ||
        !canal.messages ||
        typeof canal.send !== 'function'
    ) {
        throw new Error(
            'Canal de estoque inválido ou inacessível.'
        );
    }

    return canal;
}

// ==========================================
// IDENTIFICAR PUBLICAÇÕES ANTIGAS
// ==========================================

function ehPublicacaoEstoque(mensagem, botId) {
    if (!mensagem || !botId) {
        return false;
    }

    if (mensagem.author?.id !== botId) {
        return false;
    }

    const conteudo = mensagem.content || '';

    return (
        conteudo.includes('𝐋𝐎𝐉𝐀 𝐎𝐍') ||
        conteudo.includes('𝐋𝐎𝐉𝐀 𝐎𝐅𝐅') ||
        conteudo.includes('LOJA ON!') ||
        conteudo.includes('LOJA OFF!')
    );
}

// ==========================================
// ENCONTRAR ÚLTIMA MENSAGEM
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
                mensagem.author?.id === botId
            ) {
                return mensagem;
            }

        } catch {
            // Mensagem excluída ou inacessível.
        }
    }

    // Compatibilidade com estoques antigos.
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
// CRIAR TEXTO DO ESTOQUE
// ==========================================

function criarMensagemEstoque(config) {
    const estoque = config.estoque || {};

    if (estoque.status === 'OFF') {
        return (
            '🔴 **𝐋𝐎𝐉𝐀 𝐎𝐅𝐅!**\n\n' +

            '📦 Nossas vendas estão ' +
            'temporariamente pausadas.\n\n' +

            '🔔 Assim que a loja estiver ' +
            'disponível novamente, avisaremos.\n\n' +

            '💎 **InovareSale • Sua loja de Robux**'
        );
    }

    const quantidade = formatarRobux(
        estoque.quantidade
    );

    const preco = formatarK(
        estoque.precoK ?? 39
    );

    const canalCompra = estoque.canalCompraId
        ? `<#${estoque.canalCompraId}>`
        : 'Canal não configurado';

    return (
        '🟢 **𝐋𝐎𝐉𝐀 𝐎𝐍!**\n\n' +

        `📦 **Estoque disponível:** ${quantidade} Robux\n\n` +

        `💸 **Preço:** ${preco}\n\n` +

        '🛒 **Para comprar, acesse:**\n' +
        `${canalCompra}\n\n` +

        '💬 **Dúvidas?** Nossa equipe ' +
        'está disponível pelos tickets.\n\n' +

        '⚠️ **Realize o pagamento somente ' +
        'após autorização da equipe.**\n\n' +

        '💎 **InovareSale • Sua loja de Robux**'
    );
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
            'Cliente do Discord indisponível.'
        );
    }

    if (!['ON', 'OFF'].includes(status)) {
        throw new Error(
            'Status de estoque inválido.'
        );
    }

    if (
        status === 'ON' &&
        (
            !Number.isSafeInteger(quantidade) ||
            quantidade <= 0
        )
    ) {
        throw new Error(
            'Informe uma quantidade válida de Robux.'
        );
    }

    const config = obterConfiguracaoEstoque();

    const canal = await obterCanalEstoque(
        guild,
        config
    );

    // Preparar novos valores.
    const configAtualizada = {
        ...config,
        estoque: {
            ...config.estoque,
            status,
            quantidade:
                status === 'OFF' ? 0 : quantidade
        }
    };

    // ======================================
    // ENVIAR NOVA PUBLICAÇÃO
    // ======================================

    const novaMensagem = await canal.send({
        content: criarMensagemEstoque(
            configAtualizada
        ),
        allowedMentions: {
            parse: []
        }
    });

    const mensagemAnteriorId =
        config.estoque.ultimaMensagemId;

    configAtualizada.estoque.ultimaMensagemId =
        novaMensagem.id;

    saveConfig(configAtualizada);

    // ======================================
    // LOCALIZAR PUBLICAÇÕES ANTIGAS
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
                anterior.author.id === client.user.id
            ) {
                mensagensAntigas.set(
                    anterior.id,
                    anterior
                );
            }

        } catch {
            // Já pode ter sido removida.
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
        console.error(
            'Erro ao procurar estoques antigos:',
            erro
        );
    }

    // ======================================
    // APAGAR PUBLICAÇÕES ANTIGAS
    // ======================================

    let apagadas = 0;
    let falhas = 0;

    for (const mensagem of mensagensAntigas.values()) {
        try {
            await mensagem.delete();
            apagadas++;

        } catch (erro) {
            falhas++;

            console.error(
                'Não consegui apagar estoque antigo:',
                mensagem.id,
                erro
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
// EDITAR ÚLTIMA PUBLICAÇÃO
// ==========================================

async function editarUltimoEstoque({
    guild,
    client,
    novoTexto
}) {
    if (!client?.user?.id) {
        throw new Error(
            'Cliente do Discord indisponível.'
        );
    }

    const texto = String(novoTexto || '').trim();

    if (
        texto.length < 1 ||
        texto.length > 2000
    ) {
        throw new Error(
            'A mensagem deve ter entre 1 e 2000 caracteres.'
        );
    }

    const config = obterConfiguracaoEstoque();

    const canal = await obterCanalEstoque(
        guild,
        config
    );

    const mensagem = await buscarUltimaPublicacao(
        canal,
        config,
        client.user.id
    );

    if (!mensagem) {
        throw new Error(
            'Nenhuma publicação de estoque encontrada.'
        );
    }

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
    const config = obterConfiguracaoEstoque();

    return {
        status: config.estoque.status || 'OFF',
        quantidade:
            Number(config.estoque.quantidade || 0),
        precoK:
            Number(config.estoque.precoK ?? 39),
        canalId:
            config.estoque.canalId || null,
        canalCompraId:
            config.estoque.canalCompraId || null,
        ultimaMensagemId:
            config.estoque.ultimaMensagemId || null
    };
}

// ==========================================
// EXPORTAR FUNÇÕES
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
    consultarEstoque
};
