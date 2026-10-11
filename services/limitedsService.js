
'use strict';

const {
    EmbedBuilder,
    ChannelType,
    PermissionFlagsBits,
    escapeMarkdown
} = require('discord.js');

const {
    db
} = require('../database/db');

const {
    getConfig
} = require('../utils/storage');

// ==========================================
// INOVARESALE BOT 3.0
// SERVIÇO DE LIMITEDS
// ==========================================

// Sistema de produtos Limiteds.
//
// Este arquivo gerencia:
// - Cadastro de Limiteds
// - Preços e quantidades
// - Estoque disponível
// - Status dos produtos
// - Publicações no Discord
// - Estatísticas de produtos
//
// O atendimento das compras será
// conectado posteriormente pelo
// handlers/limitedsHandler.js.
//
// NÃO registra vendas de Robux.
// NÃO altera o histórico antigo.
// NÃO apaga produtos automaticamente.

// ==========================================
// CONFIGURAÇÕES
// ==========================================

const COR_PRINCIPAL = 0x9951CB;

const STATUS = Object.freeze({
    ATIVO: 'ativo',
    PAUSADO: 'pausado',
    ESGOTADO: 'esgotado',
    ARQUIVADO: 'arquivado'
});

const LIMITE_ESTOQUE = 100000;
const LIMITE_PRECO_CENTAVOS = 1000000000;

// ==========================================
// CRIAR TABELA SQLITE
// ==========================================

// CREATE TABLE IF NOT EXISTS:
// preserva qualquer registro existente.
//
// Esta tabela é independente da tabela
// de tickets e do histórico de Robux.

db.exec(`
    CREATE TABLE IF NOT EXISTS limiteds_produtos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        servidor_id TEXT NOT NULL,

        nome TEXT NOT NULL,
        descricao TEXT NOT NULL DEFAULT '',

        preco_centavos INTEGER NOT NULL
            CHECK (preco_centavos > 0),

        quantidade INTEGER NOT NULL DEFAULT 1
            CHECK (quantidade >= 0),

        imagem_url TEXT,

        status TEXT NOT NULL DEFAULT 'ativo'
            CHECK (
                status IN (
                    'ativo',
                    'pausado',
                    'esgotado',
                    'arquivado'
                )
            ),

        criado_por TEXT,

        canal_publicacao_id TEXT,
        mensagem_publicacao_id TEXT,

        criado_em TEXT NOT NULL
            DEFAULT CURRENT_TIMESTAMP,

        atualizado_em TEXT NOT NULL
            DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS
        idx_limiteds_produtos_servidor
    ON limiteds_produtos(
        servidor_id,
        status
    );
`);

// ==========================================
// CONSULTAS PREPARADAS
// ==========================================

const SQL = {
    buscar: db.prepare(`
        SELECT *
        FROM limiteds_produtos
        WHERE id = ?
          AND servidor_id = ?
    `),

    listar: db.prepare(`
        SELECT *
        FROM limiteds_produtos
        WHERE servidor_id = ?
        ORDER BY id DESC
        LIMIT ?
    `),

    listarAtivos: db.prepare(`
        SELECT *
        FROM limiteds_produtos
        WHERE servidor_id = ?
          AND status = 'ativo'
          AND quantidade > 0
        ORDER BY id DESC
        LIMIT ?
    `),

    inserir: db.prepare(`
        INSERT INTO limiteds_produtos (
            servidor_id,
            nome,
            descricao,
            preco_centavos,
            quantidade,
            imagem_url,
            status,
            criado_por
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),

    editar: db.prepare(`
        UPDATE limiteds_produtos
        SET nome = ?,
            descricao = ?,
            preco_centavos = ?,
            quantidade = ?,
            imagem_url = ?,
            status = ?,
            atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ?
          AND servidor_id = ?
    `),

    definirStatus: db.prepare(`
        UPDATE limiteds_produtos
        SET status = ?,
            atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ?
          AND servidor_id = ?
    `),

    alterarEstoque: db.prepare(`
        UPDATE limiteds_produtos
        SET quantidade = ?,
            status = ?,
            atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ?
          AND servidor_id = ?
    `),

    baixarEstoque: db.prepare(`
        UPDATE limiteds_produtos
        SET quantidade = quantidade - ?,
            status = CASE
                WHEN quantidade - ? = 0
                THEN 'esgotado'
                ELSE status
            END,
            atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ?
          AND servidor_id = ?
          AND status = 'ativo'
          AND quantidade >= ?
    `),

    salvarPublicacao: db.prepare(`
        UPDATE limiteds_produtos
        SET canal_publicacao_id = ?,
            mensagem_publicacao_id = ?,
            atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ?
          AND servidor_id = ?
    `),

    estatisticas: db.prepare(`
        SELECT
            COUNT(*) AS total,
            SUM(CASE
                WHEN status = 'ativo'
                THEN 1 ELSE 0
            END) AS ativos,
            SUM(CASE
                WHEN status = 'pausado'
                THEN 1 ELSE 0
            END) AS pausados,
            SUM(CASE
                WHEN status = 'esgotado'
                THEN 1 ELSE 0
            END) AS esgotados,
            SUM(CASE
                WHEN status = 'arquivado'
                THEN 1 ELSE 0
            END) AS arquivados,
            COALESCE(SUM(
                CASE
                    WHEN status = 'ativo'
                    THEN quantidade ELSE 0
                END
            ), 0) AS unidadesDisponiveis
        FROM limiteds_produtos
        WHERE servidor_id = ?
    `)
};

// ==========================================
// VALIDAÇÕES
// ==========================================

function validarIdDiscord(valor, nome) {
    const id = String(valor ?? '').trim();

    if (!/^\d{15,22}$/.test(id)) {
        throw new Error(
            `${nome} inválido.`
        );
    }

    return id;
}

function validarIdProduto(valor) {
    const id = Number(valor);

    if (
        !Number.isSafeInteger(id) ||
        id <= 0
    ) {
        throw new Error(
            'ID do Limited inválido.'
        );
    }

    return id;
}

function validarNome(valor) {
    const nome = String(valor ?? '').trim();

    if (
        nome.length < 2 ||
        nome.length > 100
    ) {
        throw new Error(
            'O nome do Limited deve ter ' +
            'entre 2 e 100 caracteres.'
        );
    }

    return nome;
}

function validarDescricao(valor) {
    const descricao = String(
        valor ?? ''
    ).trim();

    if (descricao.length > 1000) {
        throw new Error(
            'A descrição deve ter no máximo ' +
            '1.000 caracteres.'
        );
    }

    return descricao;
}

function validarPrecoCentavos(valor) {
    const numero = Number(valor);

    if (
        !Number.isSafeInteger(numero) ||
        numero <= 0 ||
        numero > LIMITE_PRECO_CENTAVOS
    ) {
        throw new Error(
            'Informe um preço válido em centavos.'
        );
    }

    return numero;
}

function validarQuantidade(valor) {
    const quantidade = Number(valor);

    if (
        !Number.isSafeInteger(quantidade) ||
        quantidade < 0 ||
        quantidade > LIMITE_ESTOQUE
    ) {
        throw new Error(
            'A quantidade deve ser um número ' +
            'inteiro entre 0 e 100.000.'
        );
    }

    return quantidade;
}

function validarImagemUrl(valor) {
    if (
        valor === null ||
        valor === undefined ||
        String(valor).trim() === ''
    ) {
        return null;
    }

    const texto = String(valor).trim();

    if (texto.length > 1500) {
        throw new Error(
            'O link da imagem é muito grande.'
        );
    }

    try {
        const url = new URL(texto);

        if (
            url.protocol !== 'https:' &&
            url.protocol !== 'http:'
        ) {
            throw new Error(
                'Protocolo não permitido.'
            );
        }

        return url.href;

    } catch {
        throw new Error(
            'Informe um link HTTP ou HTTPS ' +
            'válido para a imagem.'
        );
    }
}

// ==========================================
// FORMATAR PREÇO
// ==========================================

function formatarPreco(centavos) {
    return (
        Number(centavos || 0) / 100
    ).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

// ==========================================
// CONVERTER REAIS PARA CENTAVOS
// ==========================================

// Exemplo:
// "39,90" -> 3990
// "R$ 39,90" -> 3990
//
// O banco guarda valores inteiros
// para evitar erros de arredondamento.

function converterReaisParaCentavos(valor) {
    let texto = String(valor ?? '')
        .trim()
        .replace(/R\$/gi, '')
        .replace(/\s/g, '');

    if (texto.includes(',')) {
        texto = texto
            .replace(/\./g, '')
            .replace(',', '.');
    }

    if (!/^\d+(?:\.\d{1,2})?$/.test(texto)) {
        throw new Error(
            'Preço inválido. Exemplo: 39,90.'
        );
    }

    const centavos = Math.round(
        Number(texto) * 100
    );

    return validarPrecoCentavos(
        centavos
    );
}

// ==========================================
// IDENTIFICAR STATUS DO PRODUTO
// ==========================================

function nomeStatus(status) {
    const nomes = {
        ativo: '🟢 Disponível',
        pausado: '🟡 Vendas pausadas',
        esgotado: '🔴 Esgotado',
        arquivado: '⚫ Arquivado'
    };

    return nomes[status] ||
        'Status desconhecido';
}

// ==========================================
// VERIFICAR PERMISSÃO DA EQUIPE
// ==========================================

// O futuro limitedsHandler.js deve
// chamar esta função antes de permitir
// cadastro, edição ou publicação.

function podeGerenciarLimiteds(
    interaction,
    config = null
) {
    if (!interaction.inGuild?.()) {
        return false;
    }

    if (
        interaction.memberPermissions?.has(
            PermissionFlagsBits.Administrator
        )
    ) {
        return true;
    }

    const configuracao =
        config || getConfig();

    const cargoId =
        configuracao.limiteds?.cargoEquipeId;

    if (!cargoId) {
        return false;
    }

    const cargos = interaction.member?.roles;

    return Boolean(
        cargos?.cache?.has?.(cargoId) ||
        (
            Array.isArray(cargos) &&
            cargos.includes(cargoId)
        )
    );
}

// ==========================================
// BUSCAR UM LIMITED
// ==========================================

function buscarLimited(
    servidorId,
    produtoId
) {
    const servidor = validarIdDiscord(
        servidorId,
        'Servidor'
    );

    const id = validarIdProduto(
        produtoId
    );

    return SQL.buscar.get(
        id,
        servidor
    ) || null;
}

// ==========================================
// LISTAR LIMITEDS DO SERVIDOR
// ==========================================

function listarLimiteds(
    servidorId,
    {
        apenasAtivos = false,
        limite = 25
    } = {}
) {
    const servidor = validarIdDiscord(
        servidorId,
        'Servidor'
    );

    const quantidade = Math.min(
        100,
        Math.max(
            1,
            Math.floor(Number(limite) || 25)
        )
    );

    if (apenasAtivos) {
        return SQL.listarAtivos.all(
            servidor,
            quantidade
        );
    }

    return SQL.listar.all(
        servidor,
        quantidade
    );
}

// ==========================================
// CADASTRAR NOVO LIMITED
// ==========================================

function criarLimited({
    servidorId,
    nome,
    descricao = '',
    precoCentavos,
    quantidade = 1,
    imagemUrl = null,
    criadoPorId = null
}) {
    const servidor = validarIdDiscord(
        servidorId,
        'Servidor'
    );

    const nomeFinal = validarNome(
        nome
    );

    const descricaoFinal = validarDescricao(
        descricao
    );

    const precoFinal = validarPrecoCentavos(
        precoCentavos
    );

    const estoqueFinal = validarQuantidade(
        quantidade
    );

    const imagemFinal = validarImagemUrl(
        imagemUrl
    );

    const autor = criadoPorId
        ? validarIdDiscord(
            criadoPorId,
            'Administrador'
        )
        : null;

    const statusInicial =
        estoqueFinal > 0
            ? STATUS.ATIVO
            : STATUS.ESGOTADO;

    const resultado = SQL.inserir.run(
        servidor,
        nomeFinal,
        descricaoFinal,
        precoFinal,
        estoqueFinal,
        imagemFinal,
        statusInicial,
        autor
    );

    return buscarLimited(
        servidor,
        Number(resultado.lastInsertRowid)
    );
}

// ==========================================
// EDITAR UM LIMITED EXISTENTE
// ==========================================

// Permite atualizar somente os campos
// informados pelo handler.
//
// Campos não informados continuam iguais.
//
// Não apaga ou recria o produto.

function editarLimited(
    servidorId,
    produtoId,
    alteracoes = {}
) {
    const produto = buscarLimited(
        servidorId,
        produtoId
    );

    if (!produto) {
        throw new Error(
            'Limited não encontrado.'
        );
    }

    const nome = Object.prototype.hasOwnProperty.call(
        alteracoes,
        'nome'
    )
        ? validarNome(alteracoes.nome)
        : produto.nome;

    const descricao = Object.prototype.hasOwnProperty.call(
        alteracoes,
        'descricao'
    )
        ? validarDescricao(alteracoes.descricao)
        : produto.descricao;

    const preco = Object.prototype.hasOwnProperty.call(
        alteracoes,
        'precoCentavos'
    )
        ? validarPrecoCentavos(
            alteracoes.precoCentavos
        )
        : produto.preco_centavos;

    const quantidade = Object.prototype.hasOwnProperty.call(
        alteracoes,
        'quantidade'
    )
        ? validarQuantidade(
            alteracoes.quantidade
        )
        : produto.quantidade;

    const imagemUrl = Object.prototype.hasOwnProperty.call(
        alteracoes,
        'imagemUrl'
    )
        ? validarImagemUrl(
            alteracoes.imagemUrl
        )
        : produto.imagem_url;

    let status = produto.status;

    // Produto sem unidades fica esgotado,
    // exceto quando estiver arquivado.
    if (
        quantidade === 0 &&
        status !== STATUS.ARQUIVADO
    ) {
        status = STATUS.ESGOTADO;
    }

    // Reativar automaticamente um Limited
    // esgotado quando a equipe repuser
    // o estoque.
    if (
        quantidade > 0 &&
        status === STATUS.ESGOTADO
    ) {
        status = STATUS.ATIVO;
    }

    SQL.editar.run(
        nome,
        descricao,
        preco,
        quantidade,
        imagemUrl,
        status,
        produto.id,
        produto.servidor_id
    );

    return buscarLimited(
        produto.servidor_id,
        produto.id
    );
}

// ==========================================
// ALTERAR ESTOQUE
// ==========================================

function alterarEstoqueLimited(
    servidorId,
    produtoId,
    quantidade
) {
    const produto = buscarLimited(
        servidorId,
        produtoId
    );

    if (!produto) {
        throw new Error(
            'Limited não encontrado.'
        );
    }

    const estoque = validarQuantidade(
        quantidade
    );

    let status = produto.status;

    if (
        estoque === 0 &&
        status !== STATUS.ARQUIVADO
    ) {
        status = STATUS.ESGOTADO;
    }

    if (
        estoque > 0 &&
        status === STATUS.ESGOTADO
    ) {
        status = STATUS.ATIVO;
    }

    SQL.alterarEstoque.run(
        estoque,
        status,
        produto.id,
        produto.servidor_id
    );

    return buscarLimited(
        produto.servidor_id,
        produto.id
    );
}

// ==========================================
// BAIXAR ESTOQUE DEPOIS DA ENTREGA
// ==========================================

// Use somente quando a equipe confirmar
// que as unidades foram realmente vendidas.
//
// Esta função NÃO registra pagamento
// e NÃO adiciona compras ao histórico.
//
// A alteração é atômica no SQLite,
// impedindo estoque negativo.

function baixarEstoqueLimited(
    servidorId,
    produtoId,
    quantidade = 1
) {
    const produto = buscarLimited(
        servidorId,
        produtoId
    );

    if (!produto) {
        throw new Error(
            'Limited não encontrado.'
        );
    }

    const unidades = validarQuantidade(
        quantidade
    );

    if (unidades < 1) {
        throw new Error(
            'Informe pelo menos uma unidade.'
        );
    }

    const resultado = SQL.baixarEstoque.run(
        unidades,
        unidades,
        produto.id,
        produto.servidor_id,
        unidades
    );

    if (resultado.changes !== 1) {
        throw new Error(
            'Estoque insuficiente ou ' +
            'Limited indisponível.'
        );
    }

    return buscarLimited(
        produto.servidor_id,
        produto.id
    );
}

// ==========================================
// ALTERAR STATUS
// ==========================================

function definirStatusLimited(
    servidorId,
    produtoId,
    novoStatus
) {
    const produto = buscarLimited(
        servidorId,
        produtoId
    );

    if (!produto) {
        throw new Error(
            'Limited não encontrado.'
        );
    }

    const permitidos = [
        STATUS.ATIVO,
        STATUS.PAUSADO,
        STATUS.ESGOTADO,
        STATUS.ARQUIVADO
    ];

    if (!permitidos.includes(novoStatus)) {
        throw new Error(
            'Status de Limited inválido.'
        );
    }

    if (
        novoStatus === STATUS.ATIVO &&
        produto.quantidade === 0
    ) {
        throw new Error(
            'Não é possível ativar um ' +
            'Limited sem estoque.'
        );
    }

    if (
        novoStatus === STATUS.ESGOTADO &&
        produto.quantidade > 0
    ) {
        throw new Error(
            'Para marcar como esgotado, ' +
            'ajuste o estoque para zero.'
        );
    }

    SQL.definirStatus.run(
        novoStatus,
        produto.id,
        produto.servidor_id
    );

    return buscarLimited(
        produto.servidor_id,
        produto.id
    );
}

// ==========================================
// CRIAR EMBED DO LIMITED
// ==========================================

function criarEmbedLimited(produto) {
    if (!produto) {
        throw new Error(
            'Produto Limited não informado.'
        );
    }

    const nome = escapeMarkdown(
        String(produto.nome || 'Limited')
    );

    const descricao = escapeMarkdown(
        String(
            produto.descricao ||
            'Entre em contato com nossa equipe ' +
            'para consultar a compra deste Limited.'
        )
    );

    const embed = new EmbedBuilder()
        .setColor(COR_PRINCIPAL)
        .setTitle(
            'INOVARESALE | LIMITEDS'
        )
        .setDescription(
            `**${nome}**\n\n${descricao}`
        )
        .addFields(
            {
                name: 'Preço',
                value: formatarPreco(
                    produto.preco_centavos
                ),
                inline: true
            },
            {
                name: 'Disponibilidade',
                value: nomeStatus(
                    produto.status
                ),
                inline: true
            },
            {
                name: 'Unidades',
                value: String(
                    produto.quantidade
                ),
                inline: true
            }
        )
        .setFooter({
            text:
                `InovareSale • Limited #${produto.id}`
        })
        .setTimestamp();

    if (produto.imagem_url) {
        embed.setImage(
            produto.imagem_url
        );
    }

    return embed;
}

// ==========================================
// OBTER CANAL DE LIMITEDS
// ==========================================

async function obterCanalLimiteds(guild) {
    if (!guild?.id) {
        throw new Error(
            'Servidor não informado.'
        );
    }

    const config = getConfig();

    const canalId =
        config.limiteds?.canalId;

    if (!canalId) {
        throw new Error(
            'Configure o canal de Limiteds ' +
            'na Central Administrativa.'
        );
    }

    const canal = await guild.channels.fetch(
        canalId
    );

    if (
        !canal ||
        ![
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement
        ].includes(canal.type)
    ) {
        throw new Error(
            'O canal de Limiteds é inválido.'
        );
    }

    return canal;
}

// ==========================================
// PUBLICAR LIMITED NO DISCORD
// ==========================================

// Se já existe uma publicação no canal,
// tenta editar a mensagem existente.
//
// Se não existe, envia uma mensagem nova.
//
// O botão de compra será conectado no
// futuro limitedsHandler.js.
// Não criamos botões sem ação.

async function publicarLimited(
    guild,
    produtoId
) {
    if (!guild?.id) {
        throw new Error(
            'Servidor não informado.'
        );
    }

    const produto = buscarLimited(
        guild.id,
        produtoId
    );

    if (!produto) {
        throw new Error(
            'Limited não encontrado.'
        );
    }

    if (
        produto.status === STATUS.ARQUIVADO
    ) {
        throw new Error(
            'Limited arquivado não pode ' +
            'receber novas publicações.'
        );
    }

    const canal = await obterCanalLimiteds(
        guild
    );

    const embed = criarEmbedLimited(
        produto
    );

    let mensagem = null;

    // ======================================
    // TENTAR ATUALIZAR PUBLICAÇÃO ANTIGA
    // ======================================

    if (
        produto.canal_publicacao_id === canal.id &&
        produto.mensagem_publicacao_id
    ) {
        try {
            const anterior =
                await canal.messages.fetch(
                    produto.mensagem_publicacao_id
                );

            if (
                anterior.author.id ===
                guild.client.user.id
            ) {
                mensagem = await anterior.edit({
                    embeds: [embed],
                    allowedMentions: {
                        parse: []
                    }
                });
            }

        } catch (erro) {
            console.warn(
                '[Limiteds] Publicação antiga não encontrada:',
                erro.message
            );
        }
    }

    // ======================================
    // PUBLICAR NOVA MENSAGEM
    // ======================================

    if (!mensagem) {
        mensagem = await canal.send({
            embeds: [embed],
            allowedMentions: {
                parse: []
            }
        });
    }

    // ======================================
    // SALVAR ID DA PUBLICAÇÃO
    // ======================================

    SQL.salvarPublicacao.run(
        canal.id,
        mensagem.id,
        produto.id,
        guild.id
    );

    return {
        produto: buscarLimited(
            guild.id,
            produto.id
        ),
        mensagem
    };
}

// ==========================================
// SINCRONIZAR ANÚNCIO COM O ESTOQUE
// ==========================================

// Após editar, pausar ou baixar estoque,
// o handler poderá chamar esta função
// para atualizar o anúncio existente.
//
// A função NÃO cria novas publicações.

async function sincronizarPublicacaoLimited(
    guild,
    produtoId
) {
    const produto = buscarLimited(
        guild.id,
        produtoId
    );

    if (!produto) {
        throw new Error(
            'Limited não encontrado.'
        );
    }

    if (
        !produto.canal_publicacao_id ||
        !produto.mensagem_publicacao_id
    ) {
        return false;
    }

    try {
        const canal = await guild.channels.fetch(
            produto.canal_publicacao_id
        );

        if (!canal?.messages) {
            return false;
        }

        const mensagem = await canal.messages.fetch(
            produto.mensagem_publicacao_id
        );

        if (
            mensagem.author.id !==
            guild.client.user.id
        ) {
            return false;
        }

        await mensagem.edit({
            embeds: [
                criarEmbedLimited(produto)
            ],
            allowedMentions: {
                parse: []
            }
        });

        return true;

    } catch (erro) {
        console.warn(
            '[Limiteds] Não foi possível atualizar o anúncio:',
            erro.message
        );

        return false;
    }
}

// ==========================================
// ESTATÍSTICAS DOS LIMITEDS
// ==========================================

function obterEstatisticasLimiteds(
    servidorId
) {
    const servidor = validarIdDiscord(
        servidorId,
        'Servidor'
    );

    const resumo = SQL.estatisticas.get(
        servidor
    );

    return {
        total: Number(
            resumo?.total || 0
        ),

        ativos: Number(
            resumo?.ativos || 0
        ),

        pausados: Number(
            resumo?.pausados || 0
        ),

        esgotados: Number(
            resumo?.esgotados || 0
        ),

        arquivados: Number(
            resumo?.arquivados || 0
        ),

        unidadesDisponiveis: Number(
            resumo?.unidadesDisponiveis || 0
        )
    };
}

// ==========================================
// EXPORTAÇÕES
// ==========================================

module.exports = {
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
    obterCanalLimiteds,
    publicarLimited,
    sincronizarPublicacaoLimited,

    obterEstatisticasLimiteds
};
