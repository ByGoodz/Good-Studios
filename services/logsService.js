
'use strict';

const {
    EmbedBuilder,
    ChannelType
} = require('discord.js');

const {
    db
} = require('../database/db');

const {
    getConfig
} = require('../utils/storage');

// ==========================================
// INOVARESALE BOT 3.0
// SERVIÇO CENTRAL DE LOGS
// ==========================================

// FUNCIONALIDADES:
//
// - Registrar ações no SQLite
// - Publicar logs no canal configurado
// - Aceitar eventos de todos os sistemas
// - Impedir duplicação por chaveEvento
// - Preservar logs antigos
// - Manter registros pendentes
// - Registrar falhas de publicação
// - Recuperar logs ainda não enviados
// - Consultar histórico
// - Fornecer estatísticas
//
// O serviço não apaga registros.
//
// Logs de tickets, vendas e moderação
// continuam sendo independentes dos
// registros operacionais desses sistemas.
//
// Uma falha no canal do Discord não
// apaga um log já salvo no SQLite.

// ==========================================
// CONFIGURAÇÕES
// ==========================================

const COR_PRINCIPAL = 0x9951CB;

const LIMITE_HISTORICO = 100;

const STATUS = Object.freeze({
    PENDENTE: 'pendente',
    ENVIANDO: 'enviando',
    ENVIADO: 'enviado',
    FALHA: 'falha'
});

// ==========================================
// TIPOS DE LOG
// ==========================================

// Inclui os nomes utilizados pelos
// serviços e eventos da versão 3.0.
//
// O serviço também aceita tipos
// personalizados em formato de texto.

const TIPOS_LOG = Object.freeze({
    // Sistema
    BOT_ONLINE: 'bot_online',
    BOT_OFFLINE: 'bot_offline',
    SISTEMA: 'sistema',
    ERRO_SISTEMA: 'erro_sistema',

    // Tickets
    TICKET_CRIADO: 'ticket_criado',
    TICKET_ABERTO: 'ticket_criado',
    TICKET_ASSUMIDO: 'ticket_assumido',
    TICKET_ATENDIMENTO: 'ticket_assumido',
    TICKET_FINALIZANDO: 'ticket_finalizando',
    TICKET_FINALIZADO: 'ticket_finalizado',
    TICKET_CANCELADO: 'ticket_cancelado',

    // Vendas
    VENDA_REGISTRADA: 'venda_registrada',
    VENDA_FINALIZADA: 'venda_finalizada',
    VENDA_MANUAL: 'venda_manual',

    // Estoque
    ESTOQUE_CRIADO: 'estoque_criado',
    ESTOQUE_ATUALIZADO: 'estoque_atualizado',
    ESTOQUE_EDITADO: 'estoque_editado',
    ESTOQUE_BAIXADO: 'estoque_baixado',
    ESTOQUE_REMOVIDO: 'estoque_removido',

    // Limiteds
    LIMITED_CRIADO: 'limited_criado',
    LIMITED_EDITADO: 'limited_editado',
    LIMITED_ATUALIZADO: 'limited_atualizado',
    LIMITED_ESTOQUE: 'limited_estoque',
    LIMITED_ESTOQUE_ALTERADO: 'limited_estoque',
    LIMITED_PUBLICADO: 'limited_publicado',
    LIMITED_VENDIDO: 'limited_vendido',
    LIMITED_CANCELADO: 'limited_cancelado',

    // Equipe em voz
    STAFF_ENTRADA_VOZ: 'staff_entrada_voz',
    STAFF_SAIDA_VOZ: 'staff_saida_voz',
    STAFF_TROCA_VOZ: 'staff_troca_voz',

    // Convites e membros
    CONVITE_CRIADO: 'convite_criado',
    CONVITE_EXCLUIDO: 'convite_excluido',
    CONVITE_REMOVIDO: 'convite_excluido',
    CONVITE_UTILIZADO: 'convite_utilizado',
    MEMBRO_ENTRADA: 'membro_entrada',
    MEMBRO_SAIDA: 'membro_saida',

    // Moderação
    BAN: 'ban',
    UNBAN: 'unban',
    WARN: 'warn',
    UNWARN: 'unwarn',
    TIMEOUT: 'timeout',
    UNTIMEOUT: 'untimeout',

    // Setup
    SETUP_ATUALIZADO: 'setup_atualizado',
    CONFIGURACAO_ALTERADA: 'configuracao_alterada'
});

// ==========================================
// CONTROLE DE PUBLICAÇÕES SIMULTÂNEAS
// ==========================================

const LOGS_EM_PUBLICACAO = new Set();

// ==========================================
// CRIAR TABELA SQLITE
// ==========================================

// Mantém o mesmo nome de tabela
// utilizado na versão 3.0.
//
// CREATE TABLE IF NOT EXISTS
// não remove nem recria registros.
//
// O índice por chaveEvento garante
// que o mesmo evento não seja
// duplicado no mesmo servidor.

db.exec(`
    CREATE TABLE IF NOT EXISTS
        logs_sistema_v3 (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            servidor_id TEXT NOT NULL,

            tipo TEXT NOT NULL,

            titulo TEXT NOT NULL,

            detalhes TEXT NOT NULL DEFAULT '',

            autor_id TEXT,

            alvo_id TEXT,

            referencia TEXT,

            chave_evento TEXT,

            status TEXT NOT NULL DEFAULT 'pendente',

            canal_id TEXT,

            mensagem_id TEXT,

            erro TEXT,

            criado_em TEXT NOT NULL
                DEFAULT CURRENT_TIMESTAMP,

            enviado_em TEXT,

            UNIQUE (
                servidor_id,
                chave_evento
            )
        );

    CREATE INDEX IF NOT EXISTS
        idx_logs_sistema_status_v3
    ON logs_sistema_v3 (
        servidor_id,
        status,
        id
    );

    CREATE INDEX IF NOT EXISTS
        idx_logs_sistema_tipo_v3
    ON logs_sistema_v3 (
        servidor_id,
        tipo,
        id
    );
`);

// ==========================================
// COMPATIBILIDADE DE COLUNAS
// ==========================================

// Se a tabela foi criada por uma
// revisão anterior do Bot 3.0,
// acrescentamos apenas as colunas
// auxiliares que ainda faltarem.
//
// Nenhum registro antigo é removido.

function garantirColunasLogs() {
    const existentes = new Set(
        db.prepare(`
            PRAGMA table_info(
                logs_sistema_v3
            )
        `).all().map(
            coluna => coluna.name
        )
    );

    const colunas = {
        tipo: "TEXT NOT NULL DEFAULT 'sistema'",
        titulo: "TEXT NOT NULL DEFAULT 'Atividade registrada'",
        detalhes: "TEXT NOT NULL DEFAULT ''",
        autor_id: 'TEXT',
        alvo_id: 'TEXT',
        referencia: 'TEXT',
        chave_evento: 'TEXT',
        status: "TEXT NOT NULL DEFAULT 'pendente'",
        canal_id: 'TEXT',
        mensagem_id: 'TEXT',
        erro: 'TEXT',
        criado_em: 'TEXT',
        enviado_em: 'TEXT'
    };

    for (
        const [nome, definicao]
        of Object.entries(colunas)
    ) {
        if (existentes.has(nome)) {
            continue;
        }

        db.exec(
            `ALTER TABLE logs_sistema_v3 ` +
            `ADD COLUMN ${nome} ${definicao}`
        );
    }
}

garantirColunasLogs();

// ==========================================
// CONSULTAS PREPARADAS
// ==========================================

const SQL = {
    buscarId: db.prepare(`
        SELECT *
        FROM logs_sistema_v3
        WHERE id = ?
    `),

    buscarChave: db.prepare(`
        SELECT *
        FROM logs_sistema_v3
        WHERE servidor_id = ?
          AND chave_evento = ?
        LIMIT 1
    `),

    inserir: db.prepare(`
        INSERT INTO logs_sistema_v3 (
            servidor_id,
            tipo,
            titulo,
            detalhes,
            autor_id,
            alvo_id,
            referencia,
            chave_evento,
            status
        )

        VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, 'pendente'
        )
    `),

    marcarEnviando: db.prepare(`
        UPDATE logs_sistema_v3
        SET status = 'enviando',
            erro = NULL

        WHERE id = ?
          AND status = 'pendente'
    `),

    marcarEnviado: db.prepare(`
        UPDATE logs_sistema_v3

        SET status = 'enviado',
            canal_id = ?,
            mensagem_id = ?,
            erro = NULL,
            enviado_em = CURRENT_TIMESTAMP

        WHERE id = ?
          AND status = 'enviando'
    `),

    marcarFalha: db.prepare(`
        UPDATE logs_sistema_v3

        SET status = 'falha',
            erro = ?

        WHERE id = ?
          AND status = 'enviando'
    `),

    listar: db.prepare(`
        SELECT *
        FROM logs_sistema_v3

        WHERE servidor_id = ?
          AND (
              ? IS NULL
              OR status = ?
          )

        ORDER BY id DESC

        LIMIT ?
    `),

    listarPendentes: db.prepare(`
        SELECT *
        FROM logs_sistema_v3

        WHERE servidor_id = ?
          AND status = 'pendente'

        ORDER BY id ASC

        LIMIT ?
    `),

    estatisticas: db.prepare(`
        SELECT
            COUNT(*) AS total,

            COALESCE(SUM(
                CASE
                    WHEN status = 'pendente'
                    THEN 1 ELSE 0
                END
            ), 0) AS pendentes,

            COALESCE(SUM(
                CASE
                    WHEN status = 'enviando'
                    THEN 1 ELSE 0
                END
            ), 0) AS enviando,

            COALESCE(SUM(
                CASE
                    WHEN status = 'enviado'
                    THEN 1 ELSE 0
                END
            ), 0) AS enviados,

            COALESCE(SUM(
                CASE
                    WHEN status = 'falha'
                    THEN 1 ELSE 0
                END
            ), 0) AS falhas

        FROM logs_sistema_v3

        WHERE servidor_id = ?
    `)
};

// ==========================================
// VALIDAR SERVIDOR
// ==========================================

function validarServidorId(valor) {
    const id = String(
        valor ?? ''
    ).trim();

    if (
        !/^\d{15,22}$/.test(id)
    ) {
        throw new Error(
            'ID do servidor inválido.'
        );
    }

    return id;
}

// ==========================================
// VALIDAR ID OPCIONAL
// ==========================================

function idOpcional(valor) {
    const texto = String(
        valor ?? ''
    ).trim();

    return /^\d{15,22}$/.test(texto)
        ? texto
        : null;
}

// ==========================================
// NORMALIZAR TEXTOS
// ==========================================

function normalizarTexto(
    valor,
    limite = 1000
) {
    return String(
        valor ?? ''
    )
        .replace(/\u0000/g, '')
        .trim()
        .slice(0, limite);
}

// ==========================================
// NORMALIZAR TIPO
// ==========================================

function normalizarTipo(valor) {
    const tipo = String(
        valor ?? ''
    )
        .trim()
        .toLowerCase();

    if (
        !/^[a-z0-9_]{2,80}$/.test(tipo)
    ) {
        throw new Error(
            'Tipo de log inválido.'
        );
    }

    return tipo;
}

// ==========================================
// NORMALIZAR CHAVE DE EVENTO
// ==========================================

function normalizarChaveEvento(valor) {
    if (
        valor === null ||
        valor === undefined ||
        valor === ''
    ) {
        return null;
    }

    const chave = String(
        valor
    ).trim();

    if (
        !chave ||
        chave.length > 180
    ) {
        throw new Error(
            'Chave de evento inválida.'
        );
    }

    return chave;
}

// ==========================================
// NORMALIZAR DADOS DO LOG
// ==========================================

function normalizarDadosLog(dados) {
    if (
        !dados ||
        typeof dados !== 'object'
    ) {
        throw new Error(
            'Dados do log não informados.'
        );
    }

    const servidorId =
        validarServidorId(
            dados.guild?.id ||
            dados.servidorId ||
            dados.guildId
        );

    return {
        servidorId,

        tipo:
            normalizarTipo(
                dados.tipo || TIPOS_LOG.SISTEMA
            ),

        titulo:
            normalizarTexto(
                dados.titulo ||
                'Atividade registrada',
                250
            ),

        detalhes:
            normalizarTexto(
                dados.detalhes,
                3900
            ),

        autorId:
            idOpcional(
                dados.autorId
            ),

        alvoId:
            idOpcional(
                dados.alvoId
            ),

        referencia:
            normalizarTexto(
                dados.referencia,
                150
            ) || null,

        chaveEvento:
            normalizarChaveEvento(
                dados.chaveEvento
            )
    };
}

// ==========================================
// BUSCAR LOG PELO ID
// ==========================================

function buscarLogSistema(logId) {
    const id = Number(logId);

    if (
        !Number.isSafeInteger(id) ||
        id <= 0
    ) {
        return null;
    }

    return SQL.buscarId.get(id) || null;
}

// ==========================================
// SALVAR LOG NO SQLITE
// ==========================================

// Retorna:
//
// {
//   salvo: true,
//   novo: true/false,
//   registro: {...}
// }
//
// Se chaveEvento já existir,
// retornamos o registro antigo.
//
// O registro duplicado não substitui
// título, detalhes nem autor anterior.

function salvarLogSistema(dados) {
    const log =
        normalizarDadosLog(
            dados
        );

    return db.transaction(() => {
        // ==================================
        // VERIFICAR EVENTO REPETIDO
        // ==================================

        if (log.chaveEvento) {
            const existente =
                SQL.buscarChave.get(
                    log.servidorId,
                    log.chaveEvento
                );

            if (existente) {
                if (
                    existente.tipo !== log.tipo
                ) {
                    throw new Error(
                        'A chave do log já pertence ' +
                        'a outro tipo de evento.'
                    );
                }

                return {
                    salvo: true,
                    novo: false,
                    registro: existente
                };
            }
        }

        // ==================================
        // REGISTRAR EVENTO
        // ==================================

        const insercao =
            SQL.inserir.run(
                log.servidorId,
                log.tipo,
                log.titulo,
                log.detalhes,
                log.autorId,
                log.alvoId,
                log.referencia,
                log.chaveEvento
            );

        const registro =
            buscarLogSistema(
                Number(
                    insercao.lastInsertRowid
                )
            );

        if (!registro) {
            throw new Error(
                'Não foi possível recuperar ' +
                'o log salvo no SQLite.'
            );
        }

        return {
            salvo: true,
            novo: true,
            registro
        };
    })();
}

// ==========================================
// IDENTIFICAR EMOJI DO LOG
// ==========================================

function obterEmojiLog(tipo) {
    if (
        tipo.startsWith('ticket_')
    ) {
        return '🎫';
    }

    if (
        tipo.startsWith('venda_')
    ) {
        return '💰';
    }

    if (
        tipo.startsWith('estoque_')
    ) {
        return '📦';
    }

    if (
        tipo.startsWith('limited_')
    ) {
        return '💠';
    }

    if (
        tipo.startsWith('convite_') ||
        tipo.startsWith('membro_')
    ) {
        return '🔗';
    }

    if (
        tipo.startsWith('staff_')
    ) {
        return '🎙️';
    }

    if (
        [
            'ban',
            'unban',
            'warn',
            'unwarn',
            'timeout',
            'untimeout'
        ].includes(tipo)
    ) {
        return '🛡️';
    }

    if (
        tipo.startsWith('setup_') ||
        tipo.startsWith('configuracao_')
    ) {
        return '⚙️';
    }

    return '📋';
}

// ==========================================
// CRIAR EMBED DO LOG
// ==========================================

function criarEmbedLog(registro) {
    if (!registro?.id) {
        throw new Error(
            'Registro de log inválido.'
        );
    }

    const emoji =
        obterEmojiLog(
            registro.tipo
        );

    const titulo =
        normalizarTexto(
            registro.titulo ||
            'Atividade registrada',
            240
        );

    const detalhes =
        normalizarTexto(
            registro.detalhes,
            3900
        ) ||
        'Nenhum detalhe informado.';

    const embed =
        new EmbedBuilder()
            .setColor(
                COR_PRINCIPAL
            )
            .setTitle(
                `${emoji} ${titulo}`
            )
            .setDescription(
                detalhes
            )
            .addFields({
                name:
                    'Tipo de atividade',

                value:
                    `\`${normalizarTipo(
                        registro.tipo
                    )}\``,

                inline:
                    true
            })
            .setFooter({
                text:
                    `InovareSale Bot 3.0 • Log #${registro.id}`
            });

    // ======================================
    // AUTOR
    // ======================================

    if (registro.autor_id) {
        embed.addFields({
            name: 'Responsável',
            value:
                `<@${registro.autor_id}>`,
            inline: true
        });
    }

    // ======================================
    // ALVO
    // ======================================

    if (registro.alvo_id) {
        embed.addFields({
            name: 'Usuário envolvido',
            value:
                `<@${registro.alvo_id}>`,
            inline: true
        });
    }

    // ======================================
    // REFERÊNCIA
    // ======================================

    if (registro.referencia) {
        embed.addFields({
            name: 'Referência',

            value:
                normalizarTexto(
                    registro.referencia,
                    1000
                ),

            inline: false
        });
    }

    // ======================================
    // DATA DO REGISTRO
    // ======================================

    if (registro.criado_em) {
        let data;

        const valor =
            registro.criado_em;

        if (
            typeof valor === 'number'
        ) {
            data = new Date(
                valor < 1e12
                    ? valor * 1000
                    : valor
            );

        } else {
            const texto =
                String(valor);

            data = new Date(
                /^\d+$/.test(texto)
                    ? (
                        Number(texto) < 1e12
                            ? Number(texto) * 1000
                            : Number(texto)
                    )
                    : texto.replace(
                        ' ',
                        'T'
                    ) + (
                        texto.includes('T')
                            ? ''
                            : 'Z'
                    )
            );
        }

        if (
            Number.isFinite(
                data.getTime()
            )
        ) {
            embed.setTimestamp(
                data
            );
        }
    }

    return embed;
}

// ==========================================
// OBTER CANAL DE LOGS
// ==========================================

// O canal vem de:
//
// getConfig().logs.canalId
//
// Sem configuração, retornamos null.
//
// Nenhuma mensagem é enviada para
// um canal escolhido por suposição.

async function obterCanalLogs(
    guild,
    config = null
) {
    if (!guild?.id) {
        return null;
    }

    const configuracao =
        config || getConfig();

    const canalId =
        idOpcional(
            configuracao.logs?.canalId
        );

    if (!canalId) {
        return null;
    }

    let canal =
        guild.channels.cache.get(
            canalId
        );

    if (!canal) {
        try {
            canal =
                await guild.channels.fetch(
                    canalId
                );

        } catch (erro) {
            console.warn(
                '[InovareSale | Logs] ' +
                'Canal indisponível:',
                erro.message
            );

            return null;
        }
    }

    if (
        !canal ||
        ![
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement
        ].includes(
            canal.type
        ) ||
        typeof canal.send !== 'function'
    ) {
        return null;
    }

    return canal;
}

// ==========================================
// PUBLICAR LOG NO DISCORD
// ==========================================

// Uso:
//
// await publicarLogSistema(
//     guild,
//     logId
// );
//
// A publicação só começa quando
// status = 'pendente'.
//
// O status muda para 'enviando'
// antes de chamar a API do Discord.
//
// Se o resultado do envio for incerto,
// não realizamos uma segunda tentativa
// automática, evitando possíveis
// mensagens duplicadas.

async function publicarLogSistema(
    guild,
    logOuId
) {
    if (!guild?.id) {
        throw new Error(
            'Servidor não informado para o log.'
        );
    }

    const id =
        typeof logOuId === 'object'
            ? Number(logOuId?.id)
            : Number(logOuId);

    const registro =
        buscarLogSistema(id);

    if (!registro) {
        return {
            salvo: false,
            publicado: false,
            motivo:
                'Registro não encontrado'
        };
    }

    if (
        registro.servidor_id !==
        guild.id
    ) {
        throw new Error(
            'O log pertence a outro servidor.'
        );
    }

    if (
        registro.status ===
        STATUS.ENVIADO
    ) {
        return {
            salvo: true,
            publicado: true,
            duplicado: true,
            registroId: id,
            mensagemId:
                registro.mensagem_id
        };
    }

    if (
        registro.status !==
        STATUS.PENDENTE
    ) {
        return {
            salvo: true,
            publicado: false,
            registroId: id,
            status:
                registro.status,

            motivo:
                'Publicação já tentada ou ' +
                'aguardando verificação'
        };
    }

    if (
        LOGS_EM_PUBLICACAO.has(id)
    ) {
        return {
            salvo: true,
            publicado: false,
            ocupado: true,
            registroId: id
        };
    }

    LOGS_EM_PUBLICACAO.add(id);

    try {
        // ==================================
        // IDENTIFICAR CANAL CONFIGURADO
        // ==================================

        const canal =
            await obterCanalLogs(
                guild
            );

        if (!canal) {
            return {
                salvo: true,
                publicado: false,
                pendente: true,
                registroId: id,

                motivo:
                    'Canal de logs não configurado ' +
                    'ou indisponível'
            };
        }

        // ==================================
        // RESERVAR PUBLICAÇÃO
        // ==================================

        const reserva =
            SQL.marcarEnviando.run(
                id
            );

        if (
            reserva.changes !== 1
        ) {
            const atual =
                buscarLogSistema(id);

            return {
                salvo: true,
                publicado:
                    atual?.status ===
                    STATUS.ENVIADO,

                registroId: id,
                status:
                    atual?.status
            };
        }

        // ==================================
        // ENVIAR LOG
        // ==================================

        try {
            const mensagem =
                await canal.send({
                    embeds: [
                        criarEmbedLog(
                            registro
                        )
                    ],

                    allowedMentions: {
                        parse: []
                    }
                });

            // ==================================
            // CONFIRMAR NO SQLITE
            // ==================================

            SQL.marcarEnviado.run(
                canal.id,
                mensagem.id,
                id
            );

            return {
                salvo: true,
                publicado: true,

                registroId: id,

                canalId:
                    canal.id,

                mensagemId:
                    mensagem.id,

                url:
                    mensagem.url,

                status:
                    STATUS.ENVIADO
            };

        } catch (erro) {
            // A API pode ter recebido a
            // mensagem mesmo quando
            // a resposta falhar.
            //
            // Marcamos a tentativa como
            // falha para revisão manual.
            //
            // Não reenviamos
            // automaticamente.

            try {
                SQL.marcarFalha.run(
                    normalizarTexto(
                        erro.message ||
                        'Falha no Discord',
                        500
                    ),
                    id
                );

            } catch (erroBanco) {
                console.error(
                    '[InovareSale | Logs] ' +
                    'Falha ao salvar erro de envio:',
                    erroBanco
                );
            }

            console.error(
                '[InovareSale | Logs] ' +
                `Falha ao publicar log #${id}:`,
                erro
            );

            return {
                salvo: true,
                publicado: false,
                registroId: id,
                status:
                    STATUS.FALHA,
                erro:
                    erro.message
            };
        }

    } finally {
        LOGS_EM_PUBLICACAO.delete(
            id
        );
    }
}

// ==========================================
// REGISTRAR LOG COMPLETO
// ==========================================

// Função utilizada pelos outros
// serviços da InovareSale.
//
// Exemplo:
//
// await registrarLogSistema({
//     guild,
//     tipo: TIPOS_LOG.TICKET_CRIADO,
//     titulo: 'Ticket criado',
//     detalhes: 'Pedido INV-0015',
//     autorId: usuarioId,
//     alvoId: clienteId,
//     referencia: 'INV-0015',
//     chaveEvento: 'ticket_15_criado'
// });
//
// Primeiro salva.
// Depois tenta publicar.
//
// Se a publicação falhar,
// o log permanece no SQLite.

async function registrarLogSistema(
    dados
) {
    const salvo =
        salvarLogSistema(
            dados
        );

    const guild =
        dados.guild;

    if (!guild?.id) {
        return {
            salvo: true,
            novo:
                salvo.novo,

            publicado: false,
            pendente: true,

            registroId:
                salvo.registro.id,

            status:
                salvo.registro.status
        };
    }

    const publicacao =
        await publicarLogSistema(
            guild,
            salvo.registro.id
        );

    return {
        ...publicacao,

        salvo: true,

        novo:
            salvo.novo,

        registroId:
            salvo.registro.id,

        registro:
            buscarLogSistema(
                salvo.registro.id
            )
    };
}

// ==========================================
// REENVIAR LOGS PENDENTES
// ==========================================

// Reenvia apenas logs cujo envio
// ainda não foi iniciado.
//
// Logs com status "falha" ou
// "enviando" ficam aguardando
// revisão administrativa.
//
// Isso impede reenvio cego de
// mensagens cujo resultado pode
// ter sido incerto.
//
// Pode ser utilizado futuramente
// após configurar o canal de logs.

async function reenviarLogsPendentes(
    guild,
    limite = 20
) {
    if (!guild?.id) {
        throw new Error(
            'Servidor inválido.'
        );
    }

    const quantidade =
        Math.max(
            1,
            Math.min(
                100,
                Number.isSafeInteger(
                    Number(limite)
                )
                    ? Number(limite)
                    : 20
            )
        );

    const pendentes =
        SQL.listarPendentes.all(
            guild.id,
            quantidade
        );

    const resumo = {
        consultados:
            pendentes.length,

        enviados: 0,
        pendentes: 0,
        falhas: 0
    };

    for (
        const log
        of pendentes
    ) {
        const resultado =
            await publicarLogSistema(
                guild,
                log.id
            );

        if (resultado.publicado) {
            resumo.enviados++;

        } else if (
            resultado.status ===
            STATUS.FALHA
        ) {
            resumo.falhas++;

        } else {
            resumo.pendentes++;
        }
    }

    return resumo;
}

// ==========================================
// LISTAR HISTÓRICO DE LOGS
// ==========================================

// Uso:
//
// listarLogsSistema(
//     servidorId,
//     50
// );
//
// Ou:
//
// listarLogsSistema(
//     servidorId,
//     50,
//     'pendente'
// );

function listarLogsSistema(
    servidorId,
    limite = LIMITE_HISTORICO,
    status = null
) {
    const servidor =
        validarServidorId(
            servidorId
        );

    const quantidade =
        Number.isSafeInteger(
            Number(limite)
        ) &&
        Number(limite) > 0
            ? Math.min(
                Number(limite),
                100
            )
            : LIMITE_HISTORICO;

    if (
        status !== null &&
        !Object.values(
            STATUS
        ).includes(status)
    ) {
        throw new Error(
            'Status de log inválido.'
        );
    }

    return SQL.listar.all(
        servidor,
        status,
        status,
        quantidade
    );
}

// ==========================================
// ESTATÍSTICAS DOS LOGS
// ==========================================

function obterEstatisticasLogs(
    servidorId
) {
    const servidor =
        validarServidorId(
            servidorId
        );

    const linha =
        SQL.estatisticas.get(
            servidor
        );

    return {
        servidorId:
            servidor,

        total:
            Number(
                linha?.total || 0
            ),

        pendentes:
            Number(
                linha?.pendentes || 0
            ),

        enviando:
            Number(
                linha?.enviando || 0
            ),

        enviados:
            Number(
                linha?.enviados || 0
            ),

        falhas:
            Number(
                linha?.falhas || 0
            )
    };
}

// ==========================================
// EXPORTAÇÕES
// ==========================================

// Mantemos os nomes já utilizados
// pelos serviços da versão 3.0.

module.exports = {
    STATUS,
    TIPOS_LOG,

    salvarLogSistema,
    buscarLogSistema,

    criarEmbedLog,
    obterCanalLogs,

    publicarLogSistema,
    registrarLogSistema,

    reenviarLogsPendentes,

    listarLogsSistema,
    obterEstatisticasLogs
};
