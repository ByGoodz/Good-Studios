
'use strict';

const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    EmbedBuilder,
    ChannelType,
    PermissionFlagsBits,
    MessageFlags
} = require('discord.js');

const { db } = require('../database/db');
const { getConfig } = require('../utils/storage');

const {
    STATUS,
    formatarPreco,
    converterReaisParaCentavos,
    nomeStatus,
    podeGerenciarLimiteds,
    criarLimited,
    buscarLimited,
    listarLimiteds,
    editarLimited,
    alterarEstoqueLimited,
    baixarEstoqueLimited,
    definirStatusLimited,
    criarEmbedLimited,
    publicarLimited
} = require('../services/limitedsService');

const {
    registrarLogSistema,
    TIPOS_LOG
} = require('../services/logsService');

// ==========================================
// INOVARESALE BOT 3.0
// HANDLER DE LIMITEDS
// ==========================================
//
// - Painel administrativo
// - Cadastro de produtos
// - Edição de produtos
// - Controle de estoque
// - Pausar e reativar anúncios
// - Publicar com botão de compra
// - Criar atendimento privado
// - Confirmar entrega
// - Impedir entrega duplicada
// - Atualizar anúncio após entrega
// - Salvar pedidos e logs no SQLite
//
// Não apaga Limiteds anteriores.
//
// Não registra pagamentos automaticamente.
//
// Não mistura compras de Limiteds com
// o histórico de vendas de Robux.

// ==========================================
// CONFIGURAÇÕES
// ==========================================

const COR = 0x9951CB;
const LIMITE_PAGINA = 5;

const PEDIDO = Object.freeze({
    CRIANDO: 'criando',
    ABERTO: 'aberto',
    ENTREGUE: 'entregue',
    CANCELADO: 'cancelado'
});

const CRIACOES_EM_ANDAMENTO = new Set();

// ==========================================
// TABELA DOS PEDIDOS DE LIMITEDS
// ==========================================

db.exec(`
    CREATE TABLE IF NOT EXISTS limiteds_pedidos_v3 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        servidor_id TEXT NOT NULL,
        produto_id INTEGER NOT NULL,
        cliente_id TEXT NOT NULL,

        quantidade INTEGER NOT NULL DEFAULT 1
            CHECK (quantidade > 0),

        status TEXT NOT NULL DEFAULT 'criando'
            CHECK (
                status IN (
                    'criando',
                    'aberto',
                    'entregue',
                    'cancelado'
                )
            ),

        canal_id TEXT,

        atendente_id TEXT,

        criado_em TEXT NOT NULL
            DEFAULT CURRENT_TIMESTAMP,

        atualizado_em TEXT NOT NULL
            DEFAULT CURRENT_TIMESTAMP,

        encerrado_em TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS
        idx_limiteds_pedidos_abertos_v3

    ON limiteds_pedidos_v3 (
        servidor_id,
        produto_id,
        cliente_id
    )

    WHERE status IN ('criando', 'aberto');

    CREATE INDEX IF NOT EXISTS
        idx_limiteds_pedidos_canal_v3

    ON limiteds_pedidos_v3 (
        servidor_id,
        canal_id
    );
`);

// ==========================================
// CONSULTAS SQLITE
// ==========================================

const SQL = {
    buscarPedido: db.prepare(`
        SELECT *
        FROM limiteds_pedidos_v3

        WHERE id = ?
          AND servidor_id = ?
    `),

    buscarPedidoAberto: db.prepare(`
        SELECT *
        FROM limiteds_pedidos_v3

        WHERE servidor_id = ?
          AND produto_id = ?
          AND cliente_id = ?
          AND status IN ('criando', 'aberto')

        LIMIT 1
    `),

    inserirPedido: db.prepare(`
        INSERT INTO limiteds_pedidos_v3 (
            servidor_id,
            produto_id,
            cliente_id,
            quantidade,
            status
        )

        VALUES (?, ?, ?, 1, 'criando')
    `),

    abrirPedido: db.prepare(`
        UPDATE limiteds_pedidos_v3

        SET canal_id = ?,
            status = 'aberto',
            atualizado_em = CURRENT_TIMESTAMP

        WHERE id = ?
          AND servidor_id = ?
          AND status = 'criando'
    `),

    entregarPedido: db.prepare(`
        UPDATE limiteds_pedidos_v3

        SET status = 'entregue',
            atendente_id = ?,
            atualizado_em = CURRENT_TIMESTAMP,
            encerrado_em = CURRENT_TIMESTAMP

        WHERE id = ?
          AND servidor_id = ?
          AND status = 'aberto'
    `),

    cancelarPedido: db.prepare(`
        UPDATE limiteds_pedidos_v3

        SET status = 'cancelado',
            atendente_id = ?,
            atualizado_em = CURRENT_TIMESTAMP,
            encerrado_em = CURRENT_TIMESTAMP

        WHERE id = ?
          AND servidor_id = ?
          AND status IN ('criando', 'aberto')
    `)
};

// ==========================================
// FUNÇÕES AUXILIARES
// ==========================================

function numeroProduto(valor) {
    const id = Number(valor);

    if (
        !Number.isSafeInteger(id) ||
        id <= 0
    ) {
        throw new Error(
            'ID de Limited inválido.'
        );
    }

    return id;
}

function numeroPedido(valor) {
    const id = Number(valor);

    if (
        !Number.isSafeInteger(id) ||
        id <= 0
    ) {
        throw new Error(
            'ID de pedido inválido.'
        );
    }

    return id;
}

function nomeSeguro(valor, limite = 80) {
    return String(valor ?? '')
        .replace(/[@<>`\r\n]/g, '')
        .trim()
        .slice(0, limite);
}

async function responder(interaction, mensagem) {
    const payload =
        typeof mensagem === 'string'
            ? { content: mensagem }
            : { ...mensagem };

    payload.allowedMentions = {
        parse: []
    };

    if (interaction.deferred) {
        return interaction.editReply(payload);
    }

    if (interaction.replied) {
        return interaction.followUp({
            ...payload,
            flags: MessageFlags.Ephemeral
        });
    }

    return interaction.reply({
        ...payload,
        flags: MessageFlags.Ephemeral
    });
}

function exigirEquipe(interaction) {
    if (
        !podeGerenciarLimiteds(
            interaction,
            getConfig()
        )
    ) {
        throw new Error(
            'Apenas a equipe autorizada de ' +
            'Limiteds pode realizar esta ação.'
        );
    }
}

function buscarProdutoObrigatorio(
    interaction,
    produtoId
) {
    const produto = buscarLimited(
        interaction.guildId,
        numeroProduto(produtoId)
    );

    if (!produto) {
        throw new Error(
            'Este Limited não foi encontrado.'
        );
    }

    return produto;
}

function criarBotao(
    id,
    nome,
    estilo = ButtonStyle.Secondary,
    desativado = false
) {
    return new ButtonBuilder()
        .setCustomId(id)
        .setLabel(nome)
        .setStyle(estilo)
        .setDisabled(desativado);
}

function campoModal({
    id,
    nome,
    valor,
    obrigatorio = true,
    tamanho = 100,
    paragrafo = false
}) {
    const campo = new TextInputBuilder()
        .setCustomId(id)
        .setLabel(nome)
        .setRequired(obrigatorio)
        .setMaxLength(tamanho)
        .setStyle(
            paragrafo
                ? TextInputStyle.Paragraph
                : TextInputStyle.Short
        );

    if (
        valor !== null &&
        valor !== undefined &&
        String(valor).length
    ) {
        campo.setValue(
            String(valor).slice(0, tamanho)
        );
    }

    return new ActionRowBuilder()
        .addComponents(campo);
}

function criarModal(id, titulo, campos) {
    const modal = new ModalBuilder()
        .setCustomId(id)
        .setTitle(titulo);

    for (const campo of campos) {
        modal.addComponents(
            campoModal(campo)
        );
    }

    return modal;
}

// ==========================================
// LOGS
// ==========================================

async function logLimited(
    interaction,
    tipo,
    titulo,
    detalhes,
    chave
) {
    try {
        await registrarLogSistema({
            guild: interaction.guild,
            tipo: TIPOS_LOG?.[tipo] ||
                tipo.toLowerCase(),
            titulo,
            detalhes,
            autorId: interaction.user.id,
            chaveEvento: chave
        });
    } catch (erro) {
        console.error(
            '[InovareSale | Limiteds] ' +
            'Erro ao registrar log:',
            erro
        );
    }
}

// ==========================================
// BOTÃO DE COMPRA DO ANÚNCIO
// ==========================================

function criarLinhaCompraLimited(produto) {
    const disponivel =
        produto.status === STATUS.ATIVO &&
        Number(produto.quantidade) > 0;

    return new ActionRowBuilder()
        .addComponents(
            criarBotao(
                `limiteds_comprar_${produto.id}`,
                disponivel
                    ? 'Solicitar compra'
                    : 'Indisponível',
                ButtonStyle.Success,
                !disponivel
            )
        );
}

// ==========================================
// SINCRONIZAR ANÚNCIO EXISTENTE
// ==========================================

// Atualiza imagem, preço, estoque,
// status e botão na mesma mensagem.
//
// Nunca cria uma nova publicação
// durante esta sincronização.

async function atualizarAnuncioLimited(
    guild,
    produtoId
) {
    const produto = buscarLimited(
        guild.id,
        produtoId
    );

    if (
        !produto?.canal_publicacao_id ||
        !produto?.mensagem_publicacao_id
    ) {
        return false;
    }

    try {
        const canal =
            await guild.channels.fetch(
                produto.canal_publicacao_id
            );

        if (!canal?.messages) {
            return false;
        }

        const mensagem =
            await canal.messages.fetch(
                produto.mensagem_publicacao_id
            );

        if (
            mensagem.author?.id !==
            guild.client.user?.id
        ) {
            return false;
        }

        await mensagem.edit({
            embeds: [
                criarEmbedLimited(produto)
            ],
            components: [
                criarLinhaCompraLimited(produto)
            ],
            allowedMentions: {
                parse: []
            }
        });

        return true;

    } catch (erro) {
        console.warn(
            '[InovareSale | Limiteds] ' +
            'Não foi possível atualizar anúncio:',
            erro.message
        );

        return false;
    }
}

// ==========================================
// PUBLICAR LIMITED COM BOTÃO
// ==========================================

// Usa a função do serviço existente.
//
// Depois conecta o botão de compra.
//
// O produto permanece na tabela
// original limiteds_produtos.

async function publicarLimitedComBotao(
    guild,
    produtoId
) {
    const resultado =
        await publicarLimited(
            guild,
            produtoId
        );

    const produto =
        resultado.produto;

    await resultado.mensagem.edit({
        embeds: [
            criarEmbedLimited(produto)
        ],
        components: [
            criarLinhaCompraLimited(produto)
        ],
        allowedMentions: {
            parse: []
        }
    });

    return resultado;
}

// ==========================================
// PAINEL ADMINISTRATIVO
// ==========================================

function criarPainelGerenciamentoLimiteds(
    guildId = null
) {
    const embed = new EmbedBuilder()
        .setColor(COR)
        .setTitle(
            '💠 INOVARESALE | GERENCIAR LIMITEDS'
        )
        .setDescription(
            '**Central de produtos Limiteds**\n\n' +
            'Cadastre, edite, publique e ' +
            'controle o estoque dos produtos.\n\n' +
            'As alterações são armazenadas ' +
            'no SQLite e preservam os ' +
            'produtos anteriores.'
        );

    if (guildId) {
        embed.setFooter({
            text:
                `InovareSale • Servidor ${guildId}`
        });
    }

    const linha = new ActionRowBuilder()
        .addComponents(
            criarBotao(
                'limiteds_admin_criar',
                'Cadastrar Limited',
                ButtonStyle.Success
            ),
            criarBotao(
                'limiteds_admin_listar',
                'Ver produtos',
                ButtonStyle.Primary
            ),
            criarBotao(
                'limiteds_admin_buscar',
                'Buscar por ID'
            )
        );

    return {
        embeds: [embed],
        components: [linha],
        allowedMentions: {
            parse: []
        }
    };
}

// ==========================================
// LISTA ADMINISTRATIVA
// ==========================================

function criarListaAdministrativa(
    servidorId,
    pagina = 0
) {
    const produtos = listarLimiteds(
        servidorId,
        { limite: 100 }
    );

    const paginas =
        Math.max(
            1,
            Math.ceil(
                produtos.length / LIMITE_PAGINA
            )
        );

    const indice =
        Math.max(
            0,
            Math.min(
                pagina,
                paginas - 1
            )
        );

    const exibidos = produtos.slice(
        indice * LIMITE_PAGINA,
        (indice + 1) * LIMITE_PAGINA
    );

    const descricao = exibidos.length
        ? exibidos.map(produto =>
            `**#${produto.id} — ${
                nomeSeguro(produto.nome, 55)
            }**\n` +
            `${formatarPreco(produto.preco_centavos)} • ` +
            `${nomeStatus(produto.status)} • ` +
            `${produto.quantidade} unidade(s)`
        ).join('\n\n')
        : 'Nenhum Limited cadastrado.';

    const embed = new EmbedBuilder()
        .setColor(COR)
        .setTitle('💠 Produtos Limiteds')
        .setDescription(descricao)
        .setFooter({
            text:
                `Página ${indice + 1}/${paginas}`
        });

    const components = [];

    if (exibidos.length) {
        components.push(
            new ActionRowBuilder()
                .addComponents(
                    exibidos.map(produto =>
                        criarBotao(
                            `limiteds_admin_ver_${produto.id}`,
                            `Gerenciar #${produto.id}`,
                            ButtonStyle.Secondary
                        )
                    )
                )
        );
    }

    components.push(
        new ActionRowBuilder()
            .addComponents(
                criarBotao(
                    `limiteds_admin_pagina_${indice - 1}`,
                    '◀ Anterior',
                    ButtonStyle.Secondary,
                    indice === 0
                ),
                criarBotao(
                    `limiteds_admin_pagina_${indice + 1}`,
                    'Próxima ▶',
                    ButtonStyle.Secondary,
                    indice >= paginas - 1
                ),
                criarBotao(
                    'limiteds_admin_buscar',
                    'Buscar ID',
                    ButtonStyle.Primary
                )
            )
    );

    return {
        embeds: [embed],
        components,
        allowedMentions: {
            parse: []
        }
    };
}

// ==========================================
// PAINEL DE UM PRODUTO
// ==========================================

function criarPainelProduto(produto) {
    const embed =
        criarEmbedLimited(produto);

    const primeiraLinha =
        new ActionRowBuilder()
            .addComponents(
                criarBotao(
                    `limiteds_admin_editar_${produto.id}`,
                    'Editar'
                ),
                criarBotao(
                    `limiteds_admin_estoque_${produto.id}`,
                    'Estoque'
                ),
                criarBotao(
                    `limiteds_admin_publicar_${produto.id}`,
                    'Publicar',
                    ButtonStyle.Success,
                    produto.status === STATUS.ARQUIVADO
                )
            );

    const segundaLinha =
        new ActionRowBuilder()
            .addComponents(
                criarBotao(
                    `limiteds_admin_status_${produto.id}_ativo`,
                    'Ativar',
                    ButtonStyle.Success,
                    produto.status === STATUS.ATIVO ||
                    produto.quantidade === 0
                ),
                criarBotao(
                    `limiteds_admin_status_${produto.id}_pausado`,
                    'Pausar',
                    ButtonStyle.Secondary,
                    produto.status === STATUS.PAUSADO
                ),
                criarBotao(
                    `limiteds_admin_status_${produto.id}_arquivado`,
                    'Arquivar',
                    ButtonStyle.Danger,
                    produto.status === STATUS.ARQUIVADO
                ),
                criarBotao(
                    'limiteds_admin_listar',
                    'Voltar'
                )
            );

    return {
        embeds: [embed],
        components: [
            primeiraLinha,
            segundaLinha
        ],
        allowedMentions: {
            parse: []
        }
    };
}

// ==========================================
// FORMULÁRIO DE CADASTRO / EDIÇÃO
// ==========================================

function criarModalProduto(
    produto = null
) {
    const editar = Boolean(produto);

    return criarModal(
        editar
            ? `limiteds_modal_editar_${produto.id}`
            : 'limiteds_modal_criar',

        editar
            ? `Editar Limited #${produto.id}`
            : 'Cadastrar Limited',

        [
            {
                id: 'nome',
                nome: 'Nome do Limited',
                valor: produto?.nome,
                tamanho: 100
            },
            {
                id: 'descricao',
                nome: 'Descrição',
                valor: produto?.descricao,
                obrigatorio: false,
                tamanho: 1000,
                paragrafo: true
            },
            {
                id: 'preco',
                nome: 'Preço em reais (ex.: 39,90)',
                valor: produto
                    ? (
                        produto.preco_centavos / 100
                    ).toFixed(2).replace('.', ',')
                    : null,
                tamanho: 30
            },
            {
                id: 'quantidade',
                nome: 'Quantidade em estoque',
                valor: produto?.quantidade,
                tamanho: 12
            },
            {
                id: 'imagem',
                nome: 'Link da imagem (opcional)',
                valor: produto?.imagem_url,
                obrigatorio: false,
                tamanho: 1500
            }
        ]
    );
}

// ==========================================
// SALVAR DADOS DO MODAL
// ==========================================

function lerCamposProduto(interaction) {
    const campo = nome =>
        interaction.fields
            .getTextInputValue(nome)
            .trim();

    const quantidade =
        Number(
            campo('quantidade')
        );

    if (
        !Number.isSafeInteger(quantidade) ||
        quantidade < 0 ||
        quantidade > 100000
    ) {
        throw new Error(
            'A quantidade precisa ser um ' +
            'número inteiro de 0 a 100.000.'
        );
    }

    return {
        nome: campo('nome'),
        descricao: campo('descricao'),
        precoCentavos:
            converterReaisParaCentavos(
                campo('preco')
            ),
        quantidade,
        imagemUrl:
            campo('imagem') || null
    };
}

// ==========================================
// SALVAR NOVO LIMITED
// ==========================================

async function executarCriacao(interaction) {
    exigirEquipe(interaction);

    const dados =
        lerCamposProduto(interaction);

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    const produto = criarLimited({
        servidorId: interaction.guildId,
        ...dados,
        criadoPorId: interaction.user.id
    });

    await responder(interaction, {
        content:
            `✅ Limited **#${produto.id}** cadastrado!`,
        ...criarPainelProduto(produto)
    });

    await logLimited(
        interaction,
        'LIMITED_CRIADO',
        'Limited cadastrado',
        `Produto #${produto.id}: ${produto.nome}`,
        `limited_criado_${produto.id}`
    );
}

// ==========================================
// SALVAR EDIÇÃO
// ==========================================

async function executarEdicao(
    interaction,
    produtoId
) {
    exigirEquipe(interaction);

    buscarProdutoObrigatorio(
        interaction,
        produtoId
    );

    const alteracoes =
        lerCamposProduto(interaction);

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    const produto = editarLimited(
        interaction.guildId,
        produtoId,
        alteracoes
    );

    const sincronizado =
        await atualizarAnuncioLimited(
            interaction.guild,
            produto.id
        );

    await responder(interaction, {
        content:
            '✅ Produto atualizado no SQLite.' +
            (
                produto.mensagem_publicacao_id &&
                !sincronizado
                    ? '\n⚠️ Revise o anúncio do produto.'
                    : ''
            ),
        ...criarPainelProduto(produto)
    });

    await logLimited(
        interaction,
        'LIMITED_EDITADO',
        'Limited editado',
        `Produto #${produto.id}: ${produto.nome}`,
        `limited_editado_${produto.id}_${interaction.id}`
    );
}

// ==========================================
// ALTERAR ESTOQUE
// ==========================================

async function executarEstoque(
    interaction,
    produtoId
) {
    exigirEquipe(interaction);

    const texto = interaction.fields
        .getTextInputValue('quantidade');

    const quantidade = Number(texto);

    if (
        !Number.isSafeInteger(quantidade) ||
        quantidade < 0 ||
        quantidade > 100000
    ) {
        throw new Error(
            'Informe uma quantidade inteira ' +
            'entre 0 e 100.000.'
        );
    }

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    const produto =
        alterarEstoqueLimited(
            interaction.guildId,
            produtoId,
            quantidade
        );

    const sincronizado =
        await atualizarAnuncioLimited(
            interaction.guild,
            produto.id
        );

    await responder(interaction, {
        content:
            `✅ Estoque de **${nomeSeguro(produto.nome)}** ` +
            `atualizado para **${produto.quantidade}** unidade(s).` +
            (
                produto.mensagem_publicacao_id &&
                !sincronizado
                    ? '\n⚠️ O anúncio precisa de revisão.'
                    : ''
            ),
        ...criarPainelProduto(produto)
    });

    await logLimited(
        interaction,
        'LIMITED_ESTOQUE',
        'Estoque de Limited alterado',
        `Produto #${produto.id}: ${quantidade} unidade(s)`,
        `limited_estoque_${produto.id}_${interaction.id}`
    );
}

// ==========================================
// ALTERAR STATUS
// ==========================================

async function executarStatus(
    interaction,
    produtoId,
    status
) {
    exigirEquipe(interaction);

    if (
        ![
            STATUS.ATIVO,
            STATUS.PAUSADO,
            STATUS.ARQUIVADO
        ].includes(status)
    ) {
        throw new Error(
            'Status inválido.'
        );
    }

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    const produto = definirStatusLimited(
        interaction.guildId,
        produtoId,
        status
    );

    await atualizarAnuncioLimited(
        interaction.guild,
        produto.id
    );

    await responder(interaction, {
        content:
            `✅ Status atualizado: ${nomeStatus(produto.status)}`,
        ...criarPainelProduto(produto)
    });

    await logLimited(
        interaction,
        'LIMITED_ATUALIZADO',
        'Status do Limited alterado',
        `Produto #${produto.id}: ${produto.status}`,
        `limited_status_${produto.id}_${interaction.id}`
    );
}

// ==========================================
// PUBLICAR PRODUTO
// ==========================================

async function executarPublicacao(
    interaction,
    produtoId
) {
    exigirEquipe(interaction);

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    const resultado =
        await publicarLimitedComBotao(
            interaction.guild,
            produtoId
        );

    await responder(
        interaction,
        '✅ Anúncio publicado ou atualizado:\n' +
        resultado.mensagem.url
    );

    await logLimited(
        interaction,
        'LIMITED_PUBLICADO',
        'Limited publicado',
        `Produto #${produtoId}`,
        `limited_publicado_${produtoId}_${interaction.id}`
    );
}

// ==========================================
// BUSCAR PEDIDO DE LIMITED
// ==========================================

function buscarPedido(
    servidorId,
    pedidoId
) {
    return SQL.buscarPedido.get(
        numeroPedido(pedidoId),
        servidorId
    ) || null;
}

// ==========================================
// CRIAR SOLICITAÇÃO DE COMPRA
// ==========================================

// IMPORTANTE:
//
// Solicitar compra NÃO desconta estoque.
//
// Também NÃO confirma pagamento.
//
// O estoque só será baixado
// após confirmação da entrega
// pelo funcionário autorizado.

async function solicitarCompraLimited(
    interaction,
    produtoId
) {
    const produto =
        buscarProdutoObrigatorio(
            interaction,
            produtoId
        );

    if (
        produto.status !== STATUS.ATIVO ||
        produto.quantidade < 1
    ) {
        throw new Error(
            'Este Limited está indisponível.'
        );
    }

    if (interaction.user.bot) {
        throw new Error(
            'Bots não podem solicitar compras.'
        );
    }

    const config = getConfig();

    const equipeId =
        config.limiteds?.cargoEquipeId;

    if (
        !equipeId ||
        !/^\d{15,22}$/.test(
            String(equipeId)
        )
    ) {
        throw new Error(
            'A equipe de Limiteds ainda ' +
            'não foi configurada no /setup.'
        );
    }

    const equipe =
        await interaction.guild.roles.fetch(
            equipeId
        );

    if (!equipe) {
        throw new Error(
            'O cargo da equipe de Limiteds ' +
            'não foi encontrado.'
        );
    }

    const chave =
        `${interaction.guildId}:` +
        `${produto.id}:` +
        `${interaction.user.id}`;

    if (
        CRIACOES_EM_ANDAMENTO.has(chave)
    ) {
        throw new Error(
            'Já estou criando sua solicitação. Aguarde.'
        );
    }

    CRIACOES_EM_ANDAMENTO.add(chave);

    try {
        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        // ==================================
        // RESERVAR PEDIDO NO SQLITE
        // ==================================

        const reserva = db.transaction(() => {
            const existente =
                SQL.buscarPedidoAberto.get(
                    interaction.guildId,
                    produto.id,
                    interaction.user.id
                );

            if (existente) {
                return {
                    novo: false,
                    pedido: existente
                };
            }

            // Conferir estoque de novo
            // antes de criar o pedido.

            const atual = buscarLimited(
                interaction.guildId,
                produto.id
            );

            if (
                !atual ||
                atual.status !== STATUS.ATIVO ||
                atual.quantidade < 1
            ) {
                throw new Error(
                    'O Limited ficou indisponível.'
                );
            }

            const insercao =
                SQL.inserirPedido.run(
                    interaction.guildId,
                    produto.id,
                    interaction.user.id
                );

            return {
                novo: true,
                pedido: buscarPedido(
                    interaction.guildId,
                    Number(
                        insercao.lastInsertRowid
                    )
                )
            };
        })();

        // ==================================
        // PEDIDO JÁ EXISTENTE
        // ==================================

        if (!reserva.novo) {
            await responder(
                interaction,
                reserva.pedido.canal_id
                    ? (
                        'ℹ️ Você já possui uma solicitação: ' +
                        `<#${reserva.pedido.canal_id}>`
                    )
                    : (
                        '⏳ Sua solicitação anterior ' +
                        'ainda está sendo preparada. ' +
                        'Peça ajuda à equipe se persistir.'
                    )
            );

            return;
        }

        const pedido =
            reserva.pedido;

        let canal = null;

        // ==================================
        // CRIAR CANAL PRIVADO
        // ==================================

        try {
            const categoriaId =
                config.limiteds?.categoriaId;

            const categoria =
                categoriaId
                    ? await interaction.guild.channels
                        .fetch(categoriaId)
                        .catch(() => null)
                    : null;

            canal =
                await interaction.guild.channels.create({
                    name:
                        `limited-${produto.id}-pedido-${pedido.id}`,

                    type:
                        ChannelType.GuildText,

                    parent:
                        categoria?.type ===
                        ChannelType.GuildCategory
                            ? categoria.id
                            : null,

                    topic:
                        `Limited #${produto.id} | ` +
                        `Pedido #${pedido.id} | ` +
                        `Cliente ${interaction.user.id}`,

                    permissionOverwrites: [
                        {
                            id:
                                interaction.guild.roles.everyone.id,
                            deny: [
                                PermissionFlagsBits.ViewChannel
                            ]
                        },
                        {
                            id: interaction.user.id,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.ReadMessageHistory,
                                PermissionFlagsBits.AttachFiles
                            ]
                        },
                        {
                            id: equipeId,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.ReadMessageHistory
                            ]
                        },
                        {
                            id: interaction.client.user.id,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.ReadMessageHistory,
                                PermissionFlagsBits.EmbedLinks,
                                PermissionFlagsBits.ManageChannels
                            ]
                        }
                    ]
                });

            // ==================================
            // ABRIR PEDIDO NO BANCO
            // ==================================

            const abertura =
                SQL.abrirPedido.run(
                    canal.id,
                    pedido.id,
                    interaction.guildId
                );

            if (abertura.changes !== 1) {
                throw new Error(
                    'Não foi possível vincular ' +
                    'o canal ao pedido no SQLite.'
                );
            }

            // ==================================
            // PAINEL PRIVADO
            // ==================================

            const embed =
                new EmbedBuilder()
                    .setColor(COR)
                    .setTitle(
                        `💠 Pedido de Limited #${pedido.id}`
                    )
                    .setDescription(
                        `👤 **Cliente:** <@${interaction.user.id}>\n` +
                        `📦 **Produto:** ${nomeSeguro(produto.nome)}\n` +
                        `🔖 **ID do produto:** #${produto.id}\n` +
                        `💎 **Quantidade solicitada:** 1 unidade\n` +
                        `📋 **Situação:** Aguardando atendimento\n\n` +
                        'A equipe confirmará a disponibilidade, ' +
                        'o pagamento e a entrega.\n\n' +
                        '⚠️ **Solicitar não reserva estoque e ' +
                        'não confirma pagamento.**'
                    );

            const botoes =
                new ActionRowBuilder()
                    .addComponents(
                        criarBotao(
                            `limiteds_pedido_entregar_${pedido.id}`,
                            'Confirmar entrega',
                            ButtonStyle.Success
                        ),
                        criarBotao(
                            `limiteds_pedido_cancelar_${pedido.id}`,
                            'Cancelar solicitação',
                            ButtonStyle.Danger
                        )
                    );

            await canal.send({
                embeds: [embed],
                components: [botoes],
                allowedMentions: {
                    parse: []
                }
            });

            await responder(
                interaction,
                `✅ Sua solicitação foi aberta: <#${canal.id}>`
            );

            await logLimited(
                interaction,
                'LIMITED_CRIADO',
                'Solicitação de Limited criada',
                `Pedido #${pedido.id} | Produto #${produto.id} | ` +
                `Cliente ${interaction.user.id}`,
                `limited_pedido_criado_${pedido.id}`
            );

        } catch (erro) {
            // Se ainda não houve canal,
            // libera o cliente para tentar
            // novamente sem apagar produto.

            if (!canal) {
                SQL.cancelarPedido.run(
                    interaction.user.id,
                    pedido.id,
                    interaction.guildId
                );
            } else {
                console.error(
                    '[InovareSale | Limiteds] ' +
                    'Canal criado, mas pedido requer recuperação:',
                    {
                        pedidoId: pedido.id,
                        canalId: canal.id,
                        erro
                    }
                );
            }

            throw erro;
        }

    } finally {
        CRIACOES_EM_ANDAMENTO.delete(chave);
    }
}

// ==========================================
// VALIDAR PEDIDO NO CANAL
// ==========================================

function pedidoDoCanal(
    interaction,
    pedidoId
) {
    const pedido =
        buscarPedido(
            interaction.guildId,
            pedidoId
        );

    if (
        !pedido ||
        pedido.canal_id !==
        interaction.channelId
    ) {
        throw new Error(
            'Este botão não pertence ' +
            'ao pedido deste canal.'
        );
    }

    return pedido;
}

// ==========================================
// CONFIRMAR ENTREGA
// ==========================================

// A equipe só deve clicar após
// a entrega REAL do produto.
//
// A operação é atômica:
//
// 1. Marcar pedido como entregue
// 2. Baixar uma unidade de estoque
//
// Se a baixa falhar, a transação
// desfaz a alteração do pedido.
//
// A mesma solicitação não pode
// descontar estoque duas vezes.

async function confirmarEntregaLimited(
    interaction,
    pedidoId
) {
    exigirEquipe(interaction);

    const pedido =
        pedidoDoCanal(
            interaction,
            pedidoId
        );

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    const resultado = db.transaction(() => {
        const atual =
            buscarPedido(
                interaction.guildId,
                pedido.id
            );

        if (
            !atual ||
            atual.status !== PEDIDO.ABERTO
        ) {
            throw new Error(
                'Este pedido já foi encerrado ' +
                'ou não está disponível.'
            );
        }

        const alteracao =
            SQL.entregarPedido.run(
                interaction.user.id,
                atual.id,
                interaction.guildId
            );

        if (alteracao.changes !== 1) {
            throw new Error(
                'A entrega já foi processada.'
            );
        }

        const produto =
            baixarEstoqueLimited(
                interaction.guildId,
                atual.produto_id,
                atual.quantidade
            );

        return {
            pedido: buscarPedido(
                interaction.guildId,
                atual.id
            ),
            produto
        };
    })();

    // ======================================
    // SINCRONIZAR ANÚNCIO
    // ======================================

    const sincronizado =
        await atualizarAnuncioLimited(
            interaction.guild,
            resultado.produto.id
        );

    await responder(
        interaction,
        '✅ Entrega confirmada e estoque atualizado.' +
        (
            resultado.produto.mensagem_publicacao_id &&
            !sincronizado
                ? '\n⚠️ Confira o anúncio público.'
                : ''
        )
    );

    await interaction.channel.send({
        content:
            `✅ **Limited entregue!**\n` +
            `Produto: **${nomeSeguro(resultado.produto.nome)}**\n` +
            `Confirmado por <@${interaction.user.id}>.\n\n` +
            'O pedido ficou registrado no SQLite.',

        allowedMentions: {
            parse: []
        }
    }).catch(() => {});

    await logLimited(
        interaction,
        'LIMITED_VENDIDO',
        'Entrega de Limited confirmada',
        `Pedido #${resultado.pedido.id} | ` +
        `Produto #${resultado.produto.id} | ` +
        `Cliente ${resultado.pedido.cliente_id}`,
        `limited_pedido_entregue_${resultado.pedido.id}`
    );
}

// ==========================================
// CANCELAR SOLICITAÇÃO
// ==========================================

async function cancelarSolicitacaoLimited(
    interaction,
    pedidoId
) {
    const pedido =
        pedidoDoCanal(
            interaction,
            pedidoId
        );

    const equipe =
        podeGerenciarLimiteds(
            interaction,
            getConfig()
        );

    const cliente =
        pedido.cliente_id ===
        interaction.user.id;

    if (!equipe && !cliente) {
        throw new Error(
            'Somente o cliente ou a equipe ' +
            'podem cancelar este pedido.'
        );
    }

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    const resultado =
        SQL.cancelarPedido.run(
            interaction.user.id,
            pedido.id,
            interaction.guildId
        );

    if (resultado.changes !== 1) {
        throw new Error(
            'Este pedido já foi encerrado.'
        );
    }

    await responder(
        interaction,
        '✅ Solicitação cancelada. ' +
        'Nenhuma unidade foi descontada.'
    );

    await interaction.channel.send({
        content:
            '❌ **Solicitação de Limited cancelada.**\n' +
            'Nenhuma entrega foi registrada.',

        allowedMentions: {
            parse: []
        }
    }).catch(() => {});

    await logLimited(
        interaction,
        'LIMITED_CANCELADO',
        'Solicitação de Limited cancelada',
        `Pedido #${pedido.id} | Produto #${pedido.produto_id}`,
        `limited_pedido_cancelado_${pedido.id}`
    );
}

// ==========================================
// HANDLER PRINCIPAL
// ==========================================

async function handleLimitedsInteraction(
    interaction
) {
    const id =
        interaction.customId || '';

    if (!id.startsWith('limiteds_')) {
        return false;
    }

    if (!interaction.inGuild()) {
        await responder(
            interaction,
            '❌ Os Limiteds são gerenciados no servidor.'
        );

        return true;
    }

    try {
        // ==================================
        // ABRIR PAINEL ADMINISTRATIVO
        // ==================================

        if (
            interaction.isButton() &&
            id === 'limiteds_painel'
        ) {
            exigirEquipe(interaction);

            await responder(
                interaction,
                criarPainelGerenciamentoLimiteds(
                    interaction.guildId
                )
            );

            return true;
        }

        // ==================================
        // CADASTRAR
        // ==================================

        if (
            interaction.isButton() &&
            id === 'limiteds_admin_criar'
        ) {
            exigirEquipe(interaction);

            await interaction.showModal(
                criarModalProduto()
            );

            return true;
        }

        if (
            interaction.isModalSubmit() &&
            id === 'limiteds_modal_criar'
        ) {
            await executarCriacao(interaction);
            return true;
        }

        // ==================================
        // LISTAR PRODUTOS
        // ==================================

        const pagina =
            id.match(
                /^limiteds_admin_pagina_(-?\d+)$/
            );

        if (
            interaction.isButton() &&
            (
                id === 'limiteds_admin_listar' ||
                pagina
            )
        ) {
            exigirEquipe(interaction);

            await responder(
                interaction,
                criarListaAdministrativa(
                    interaction.guildId,
                    pagina
                        ? Number(pagina[1])
                        : 0
                )
            );

            return true;
        }

        // ==================================
        // BUSCAR PRODUTO POR ID
        // ==================================

        if (
            interaction.isButton() &&
            id === 'limiteds_admin_buscar'
        ) {
            exigirEquipe(interaction);

            await interaction.showModal(
                criarModal(
                    'limiteds_modal_buscar',
                    'Buscar Limited',
                    [
                        {
                            id: 'produto_id',
                            nome: 'ID do produto',
                            tamanho: 12
                        }
                    ]
                )
            );

            return true;
        }

        if (
            interaction.isModalSubmit() &&
            id === 'limiteds_modal_buscar'
        ) {
            exigirEquipe(interaction);

            const produto =
                buscarProdutoObrigatorio(
                    interaction,
                    interaction.fields
                        .getTextInputValue(
                            'produto_id'
                        )
                );

            await responder(
                interaction,
                criarPainelProduto(produto)
            );

            return true;
        }

        // ==================================
        // GERENCIAR PRODUTO
        // ==================================

        const ver =
            id.match(
                /^limiteds_admin_ver_(\d+)$/
            );

        if (
            interaction.isButton() &&
            ver
        ) {
            exigirEquipe(interaction);

            const produto =
                buscarProdutoObrigatorio(
                    interaction,
                    ver[1]
                );

            await responder(
                interaction,
                criarPainelProduto(produto)
            );

            return true;
        }

        // ==================================
        // ABRIR EDIÇÃO
        // ==================================

        const editar =
            id.match(
                /^limiteds_admin_editar_(\d+)$/
            );

        if (
            interaction.isButton() &&
            editar
        ) {
            exigirEquipe(interaction);

            const produto =
                buscarProdutoObrigatorio(
                    interaction,
                    editar[1]
                );

            await interaction.showModal(
                criarModalProduto(produto)
            );

            return true;
        }

        // ==================================
        // SALVAR EDIÇÃO
        // ==================================

        const salvarEdicao =
            id.match(
                /^limiteds_modal_editar_(\d+)$/
            );

        if (
            interaction.isModalSubmit() &&
            salvarEdicao
        ) {
            await executarEdicao(
                interaction,
                numeroProduto(
                    salvarEdicao[1]
                )
            );

            return true;
        }

        // ==================================
        // ABRIR CONTROLE DE ESTOQUE
        // ==================================

        const estoque =
            id.match(
                /^limiteds_admin_estoque_(\d+)$/
            );

        if (
            interaction.isButton() &&
            estoque
        ) {
            exigirEquipe(interaction);

            const produto =
                buscarProdutoObrigatorio(
                    interaction,
                    estoque[1]
                );

            await interaction.showModal(
                criarModal(
                    `limiteds_modal_estoque_${produto.id}`,
                    `Estoque Limited #${produto.id}`,
                    [
                        {
                            id: 'quantidade',
                            nome: 'Nova quantidade total',
                            valor: produto.quantidade,
                            tamanho: 12
                        }
                    ]
                )
            );

            return true;
        }

        // ==================================
        // SALVAR ESTOQUE
        // ==================================

        const salvarEstoque =
            id.match(
                /^limiteds_modal_estoque_(\d+)$/
            );

        if (
            interaction.isModalSubmit() &&
            salvarEstoque
        ) {
            await executarEstoque(
                interaction,
                numeroProduto(
                    salvarEstoque[1]
                )
            );

            return true;
        }

        // ==================================
        // ALTERAR STATUS
        // ==================================

        const status =
            id.match(
                /^limiteds_admin_status_(\d+)_(ativo|pausado|arquivado)$/
            );

        if (
            interaction.isButton() &&
            status
        ) {
            await executarStatus(
                interaction,
                numeroProduto(status[1]),
                status[2]
            );

            return true;
        }

        // ==================================
        // PUBLICAR PRODUTO
        // ==================================

        const publicar =
            id.match(
                /^limiteds_admin_publicar_(\d+)$/
            );

        if (
            interaction.isButton() &&
            publicar
        ) {
            await executarPublicacao(
                interaction,
                numeroProduto(publicar[1])
            );

            return true;
        }

        // ==================================
        // COMPRAR LIMITED
        // ==================================

        const comprar =
            id.match(
                /^limiteds_comprar_(\d+)$/
            );

        if (
            interaction.isButton() &&
            comprar
        ) {
            await solicitarCompraLimited(
                interaction,
                numeroProduto(comprar[1])
            );

            return true;
        }

        // ==================================
        // CONFIRMAR ENTREGA
        // ==================================

        const entregar =
            id.match(
                /^limiteds_pedido_entregar_(\d+)$/
            );

        if (
            interaction.isButton() &&
            entregar
        ) {
            await confirmarEntregaLimited(
                interaction,
                numeroPedido(entregar[1])
            );

            return true;
        }

        // ==================================
        // CANCELAR SOLICITAÇÃO
        // ==================================

        const cancelar =
            id.match(
                /^limiteds_pedido_cancelar_(\d+)$/
            );

        if (
            interaction.isButton() &&
            cancelar
        ) {
            await cancelarSolicitacaoLimited(
                interaction,
                numeroPedido(cancelar[1])
            );

            return true;
        }

        return false;

    } catch (erro) {
        console.error(
            '[InovareSale | Limiteds] Erro:',
            erro
        );

        const mensagem =
            '❌ ' +
            String(
                erro.message ||
                'Não foi possível realizar esta ação.'
            ).slice(0, 1500);

        try {
            await responder(
                interaction,
                mensagem
            );
        } catch (erroResposta) {
            console.error(
                '[InovareSale | Limiteds] ' +
                'Erro ao responder:',
                erroResposta
            );
        }

        return true;
    }
}

// ==========================================
// EXPORTAÇÕES
// ==========================================

module.exports = {
    handleLimitedsInteraction,

    criarPainelGerenciamentoLimiteds,

    criarLinhaCompraLimited,

    publicarLimitedComBotao,

    atualizarAnuncioLimited,

    buscarPedido
};
