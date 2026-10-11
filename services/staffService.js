
'use strict';

const {
    GatewayIntentBits
} = require('discord.js');

const {
    db
} = require('../database/db');

const {
    getConfig
} = require('../utils/storage');

// ==========================================
// INOVARESALE BOT 3.0
// SERVIÇO DE EQUIPE EM VOZ
// ==========================================

// FUNCIONALIDADES:
//
// - Identificar funcionários pelo cargo
// - Registrar entradas em call
// - Registrar saídas de call
// - Registrar mudanças de canal
// - Armazenar sessões no SQLite
// - Calcular tempo observado em voz
// - Criar ranking da equipe
// - Consultar histórico individual
// - Reconciliar sessões após reinícios
// - Evitar contar períodos offline
// - Proteger contra eventos simultâneos
//
// IMPORTANTE:
//
// Este serviço não apaga históricos.
//
// Ele utiliza a tabela:
// staff_voz_sessoes_v3
//
// Ao reiniciar o bot:
//
// 1. Fecha as sessões antigas no último
//    horário observado antes do reinício.
//
// 2. Abre novas sessões para os membros
//    que continuam em canais de voz.
//
// Assim, o tempo em que o bot ficou
// desligado não entra na contagem.
//
// A sincronização periódica de 5 minutos
// permanece configurada no index.js.

// ==========================================
// CONSTANTES
// ==========================================

const LIMITE_RANKING = 25;

const LIMITE_HISTORICO = 50;

const LIMITE_CONSULTAS = 100;

// Servidores já reconciliados neste
// processo do bot.

const SERVIDORES_SINCRONIZADOS =
    new Set();

// Fila por servidor.
//
// Impede que uma sincronização e um
// evento de voz alterem as mesmas
// sessões ao mesmo tempo.

const FILAS_SERVIDORES =
    new Map();

// ==========================================
// CRIAR TABELA SQLITE
// ==========================================

// O nome e as colunas são os mesmos
// da versão anterior do staffService.
//
// CREATE TABLE IF NOT EXISTS não
// substitui registros existentes.

db.exec(`
    CREATE TABLE IF NOT EXISTS
        staff_voz_sessoes_v3 (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            servidor_id TEXT NOT NULL,

            membro_id TEXT NOT NULL,

            canal_inicial_id TEXT NOT NULL,

            canal_atual_id TEXT NOT NULL,

            iniciada_em INTEGER NOT NULL,

            ultima_observacao_em INTEGER NOT NULL,

            encerrada_em INTEGER,

            motivo_encerramento TEXT,

            CHECK (
                encerrada_em IS NULL
                OR encerrada_em >= iniciada_em
            )
        );

    CREATE UNIQUE INDEX IF NOT EXISTS
        idx_staff_voz_sessao_aberta_v3
    ON staff_voz_sessoes_v3 (
        servidor_id,
        membro_id
    )
    WHERE encerrada_em IS NULL;

    CREATE INDEX IF NOT EXISTS
        idx_staff_voz_historico_v3
    ON staff_voz_sessoes_v3 (
        servidor_id,
        membro_id,
        id
    );

    CREATE INDEX IF NOT EXISTS
        idx_staff_voz_ranking_v3
    ON staff_voz_sessoes_v3 (
        servidor_id,
        membro_id
    );
`);

// ==========================================
// CONSULTAS PREPARADAS
// ==========================================

const SQL = {
    buscarAberta: db.prepare(`
        SELECT *
        FROM staff_voz_sessoes_v3
        WHERE servidor_id = ?
          AND membro_id = ?
          AND encerrada_em IS NULL
        LIMIT 1
    `),

    listarAbertas: db.prepare(`
        SELECT *
        FROM staff_voz_sessoes_v3
        WHERE servidor_id = ?
          AND encerrada_em IS NULL
        ORDER BY id ASC
    `),

    inserir: db.prepare(`
        INSERT INTO staff_voz_sessoes_v3 (
            servidor_id,
            membro_id,
            canal_inicial_id,
            canal_atual_id,
            iniciada_em,
            ultima_observacao_em
        )
        VALUES (?, ?, ?, ?, ?, ?)
    `),

    atualizarObservacao: db.prepare(`
        UPDATE staff_voz_sessoes_v3
        SET
            canal_atual_id = ?,
            ultima_observacao_em = ?
        WHERE id = ?
          AND encerrada_em IS NULL
    `),

    encerrar: db.prepare(`
        UPDATE staff_voz_sessoes_v3
        SET
            ultima_observacao_em = ?,
            encerrada_em = ?,
            motivo_encerramento = ?
        WHERE id = ?
          AND encerrada_em IS NULL
    `),

    buscarPorId: db.prepare(`
        SELECT *
        FROM staff_voz_sessoes_v3
        WHERE id = ?
    `),

    historico: db.prepare(`
        SELECT *
        FROM staff_voz_sessoes_v3
        WHERE servidor_id = ?
          AND membro_id = ?
        ORDER BY id DESC
        LIMIT ?
    `),

    ranking: db.prepare(`
        SELECT
            membro_id,

            COUNT(*) AS total_sessoes,

            SUM(
                MAX(
                    0,
                    COALESCE(
                        encerrada_em,
                        ultima_observacao_em
                    ) - iniciada_em
                )
            ) AS tempo_total

        FROM staff_voz_sessoes_v3

        WHERE servidor_id = ?

        GROUP BY membro_id

        ORDER BY
            tempo_total DESC,
            membro_id ASC

        LIMIT ?
    `),

    estatisticas: db.prepare(`
        SELECT
            COUNT(*) AS total_sessoes,

            COUNT(
                DISTINCT membro_id
            ) AS funcionarios_registrados,

            COALESCE(SUM(
                CASE
                    WHEN encerrada_em IS NULL
                    THEN 1 ELSE 0
                END
            ), 0) AS sessoes_abertas,

            COALESCE(SUM(
                CASE
                    WHEN encerrada_em IS NOT NULL
                    THEN 1 ELSE 0
                END
            ), 0) AS sessoes_encerradas,

            COALESCE(SUM(
                MAX(
                    0,
                    COALESCE(
                        encerrada_em,
                        ultima_observacao_em
                    ) - iniciada_em
                )
            ), 0) AS tempo_total

        FROM staff_voz_sessoes_v3

        WHERE servidor_id = ?
    `)
};

// ==========================================
// HORÁRIO ATUAL
// ==========================================

function agoraSegundos() {
    return Math.floor(
        Date.now() / 1000
    );
}

// ==========================================
// VALIDAR IDENTIFICADORES
// ==========================================

function validarId(
    valor,
    nome = 'ID'
) {
    const texto = String(
        valor ?? ''
    ).trim();

    if (
        !/^\d{15,22}$/.test(
            texto
        )
    ) {
        throw new Error(
            `${nome} inválido.`
        );
    }

    return texto;
}

function idOpcional(valor) {
    const texto = String(
        valor ?? ''
    ).trim();

    return /^\d{15,22}$/.test(texto)
        ? texto
        : null;
}

function validarLimite(
    limite,
    padrao
) {
    const numero = Number(limite);

    if (
        !Number.isSafeInteger(numero) ||
        numero < 1
    ) {
        return padrao;
    }

    return Math.min(
        numero,
        LIMITE_CONSULTAS
    );
}

// ==========================================
// FORMATAR TEMPO DE VOZ
// ==========================================

function formatarTempoVoz(
    segundos
) {
    const total = Math.max(
        0,
        Math.floor(
            Number(segundos) || 0
        )
    );

    const dias = Math.floor(
        total / 86400
    );

    const horas = Math.floor(
        (total % 86400) / 3600
    );

    const minutos = Math.floor(
        (total % 3600) / 60
    );

    const restantes =
        total % 60;

    const partes = [];

    if (dias > 0) {
        partes.push(
            `${dias}d`
        );
    }

    if (horas > 0) {
        partes.push(
            `${horas}h`
        );
    }

    if (minutos > 0) {
        partes.push(
            `${minutos}min`
        );
    }

    if (!partes.length) {
        partes.push(
            `${restantes}s`
        );
    }

    return partes.join(' ');
}

// ==========================================
// CONFIGURAÇÃO DA EQUIPE
// ==========================================

function obterIdCargoEquipe(
    config = null
) {
    const configuracao =
        config || getConfig();

    return idOpcional(
        configuracao.staff?.cargoId
    );
}

// ==========================================
// OBTER CARGO DA EQUIPE
// ==========================================

function obterCargoEquipe(
    guild,
    config = null
) {
    if (!guild?.id) {
        return null;
    }

    const cargoId =
        obterIdCargoEquipe(
            config
        );

    if (!cargoId) {
        return null;
    }

    return guild.roles.cache.get(
        cargoId
    ) || null;
}

// ==========================================
// VERIFICAR FUNCIONÁRIO
// ==========================================

function ehMembroEquipe(
    membro,
    config = null
) {
    if (
        !membro ||
        membro.user?.bot
    ) {
        return false;
    }

    const cargoId =
        obterIdCargoEquipe(
            config
        );

    if (!cargoId) {
        return false;
    }

    return Boolean(
        membro.roles?.cache?.has(
            cargoId
        )
    );
}

// ==========================================
// VERIFICAR INTENT DE VOZ
// ==========================================

function possuiIntentVoz(
    guildOuClient
) {
    const client =
        guildOuClient?.client ||
        guildOuClient;

    return Boolean(
        client?.options?.intents?.has(
            GatewayIntentBits.GuildVoiceStates
        )
    );
}

// ==========================================
// FILA DE OPERAÇÕES DO SERVIDOR
// ==========================================

async function executarEmFila(
    servidorId,
    tarefa
) {
    const servidor =
        validarId(
            servidorId,
            'Servidor'
        );

    const anterior =
        FILAS_SERVIDORES.get(
            servidor
        ) || Promise.resolve();

    const atual = anterior
        .catch(() => {})
        .then(tarefa);

    FILAS_SERVIDORES.set(
        servidor,
        atual
    );

    try {
        return await atual;

    } finally {
        if (
            FILAS_SERVIDORES.get(
                servidor
            ) === atual
        ) {
            FILAS_SERVIDORES.delete(
                servidor
            );
        }
    }
}

// ==========================================
// TEMPO DE UMA SESSÃO
// ==========================================

// Para sessão finalizada:
// encerrada_em - iniciada_em
//
// Para sessão aberta:
// ultima_observacao_em - iniciada_em
//
// Nunca utilizamos Date.now() para
// estender automaticamente uma sessão
// sem observação do Discord.
//
// Isso impede contar horas de um
// período em que o bot esteve offline.

function calcularSegundosSessao(
    sessao
) {
    if (!sessao) {
        return 0;
    }

    const inicio = Number(
        sessao.iniciada_em
    );

    const fim = Number(
        sessao.encerrada_em ??
        sessao.ultima_observacao_em
    );

    if (
        !Number.isFinite(inicio) ||
        !Number.isFinite(fim)
    ) {
        return 0;
    }

    return Math.max(
        0,
        Math.floor(
            fim - inicio
        )
    );
}

// ==========================================
// BUSCAR SESSÃO ABERTA
// ==========================================

function buscarSessaoAberta(
    servidorId,
    membroId
) {
    return SQL.buscarAberta.get(
        validarId(
            servidorId,
            'Servidor'
        ),

        validarId(
            membroId,
            'Membro'
        )
    ) || null;
}

// ==========================================
// ENCERRAR SESSÃO INTERNA
// ==========================================

// A função recebe o horário final.
//
// Para uma saída confirmada pelo
// Discord, usamos o horário do evento.
//
// Para recuperar sessões após
// reinícios, usamos a última
// observação salva.
//
// Essa diferença impede somar
// os períodos offline.

function encerrarSessaoInterna(
    sessao,
    motivo,
    horarioFinal
) {
    if (!sessao) {
        return null;
    }

    const inicio = Number(
        sessao.iniciada_em
    );

    const ultimo = Number(
        sessao.ultima_observacao_em
    );

    const finalDesejado = Number(
        horarioFinal
    );

    const final = Math.max(
        inicio,
        ultimo,
        Number.isFinite(finalDesejado)
            ? Math.floor(finalDesejado)
            : ultimo
    );

    const resultado =
        SQL.encerrar.run(
            final,
            final,
            String(motivo || 'saida'),
            sessao.id
        );

    if (
        resultado.changes !== 1
    ) {
        return null;
    }

    return SQL.buscarPorId.get(
        sessao.id
    ) || null;
}

// ==========================================
// REGISTRAR ENTRADA EM VOZ
// ==========================================

// Uso:
//
// registrarEntradaVoz(
//     servidorId,
//     membroId,
//     canalId
// );
//
// Esta função cria uma sessão aberta.
//
// Se já existe uma sessão para
// o funcionário, não cria outra.

function registrarEntradaVoz(
    servidorId,
    membroId,
    canalId
) {
    const servidor = validarId(
        servidorId,
        'Servidor'
    );

    const membro = validarId(
        membroId,
        'Membro'
    );

    const canal = validarId(
        canalId,
        'Canal'
    );

    const horario =
        agoraSegundos();

    return db.transaction(() => {
        const existente =
            buscarSessaoAberta(
                servidor,
                membro
            );

        if (existente) {
            return {
                tratado: false,
                criada: false,

                acao:
                    'sessao_ja_aberta',

                sessao:
                    existente,

                sessaoId:
                    existente.id
            };
        }

        const resultado =
            SQL.inserir.run(
                servidor,
                membro,
                canal,
                canal,
                horario,
                horario
            );

        const sessao =
            SQL.buscarPorId.get(
                Number(
                    resultado.lastInsertRowid
                )
            );

        return {
            tratado: true,
            criada: true,

            acao: 'entrada',

            sessao,
            sessaoId:
                sessao.id,

            membroId: membro,
            canalId: canal
        };
    })();
}

// ==========================================
// REGISTRAR SAÍDA EM VOZ
// ==========================================

// A saída é confirmada pelo evento
// voiceStateUpdate.
//
// Ela usa o horário atual, pois
// a saída foi observada de verdade.

function registrarSaidaVoz(
    servidorId,
    membroId,
    motivo = 'saida_da_voz'
) {
    const servidor = validarId(
        servidorId,
        'Servidor'
    );

    const membro = validarId(
        membroId,
        'Membro'
    );

    return db.transaction(() => {
        const aberta =
            buscarSessaoAberta(
                servidor,
                membro
            );

        if (!aberta) {
            return {
                tratado: false,
                encerrada: false,
                motivo:
                    'Nenhuma sessão aberta'
            };
        }

        const encerrada =
            encerrarSessaoInterna(
                aberta,
                motivo,
                agoraSegundos()
            );

        if (!encerrada) {
            return {
                tratado: false,
                encerrada: false,
                motivo:
                    'Não foi possível encerrar a sessão'
            };
        }

        return {
            tratado: true,
            encerrada: true,

            acao: 'saida',

            sessao:
                encerrada,

            sessaoId:
                encerrada.id,

            membroId: membro,

            segundos:
                calcularSegundosSessao(
                    encerrada
                )
        };
    })();
}

// ==========================================
// CONSULTAR MEMBRO ATUALIZADO
// ==========================================

// Não confundir erro de consulta
// com remoção do cargo da equipe.
//
// Se a consulta falhar, retornamos
// null e preservamos a sessão aberta.
//
// Isso evita perder dados por
// instabilidade temporária da API.

async function buscarMembroAtualizado(
    guild,
    membroId
) {
    try {
        return await guild.members.fetch({
            user: membroId,
            force: true
        });

    } catch (erro) {
        console.warn(
            '[InovareSale | Staff] ' +
            `Não foi possível consultar ${membroId}:`,
            erro.message
        );

        return null;
    }
}

// ==========================================
// ATUALIZAR CANAL DE SESSÃO ABERTA
// ==========================================

function atualizarCanalSessao(
    sessao,
    canalId,
    horario = agoraSegundos()
) {
    const canal =
        validarId(
            canalId,
            'Canal'
        );

    const horarioSeguro = Math.max(
        Number(
            sessao.iniciada_em
        ),

        Number(
            sessao.ultima_observacao_em
        ),

        Math.floor(horario)
    );

    SQL.atualizarObservacao.run(
        canal,
        horarioSeguro,
        sessao.id
    );

    return SQL.buscarPorId.get(
        sessao.id
    );
}

// ==========================================
// PROCESSAR MUDANÇA DE CANAL
// ==========================================

// Utilizado pelo evento:
//
// events/voiceStateUpdate.js
//
// Casos:
//
// 1. Entrou em call
// 2. Saiu da call
// 3. Mudou de canal
// 4. Perdeu o cargo da equipe
//
// Mudanças de microfone ou câmera
// são ignoradas pelo evento.
//
// Este serviço também verifica
// se o canal realmente mudou.

async function processarMudancaVoz(
    estadoAnterior,
    estadoAtual
) {
    const guild =
        estadoAtual?.guild ||
        estadoAnterior?.guild;

    if (!guild?.id) {
        return {
            tratado: false,
            motivo:
                'Servidor inválido'
        };
    }

    const servidorId =
        guild.id;

    const membroId =
        estadoAtual?.id ||
        estadoAnterior?.id;

    if (!idOpcional(membroId)) {
        return {
            tratado: false,
            motivo:
                'Membro inválido'
        };
    }

    const canalAnterior =
        idOpcional(
            estadoAnterior?.channelId
        );

    const canalAtual =
        idOpcional(
            estadoAtual?.channelId
        );

    // ======================================
    // IGNORAR ALTERAÇÕES SEM TROCA
    // ======================================

    if (
        canalAnterior === canalAtual
    ) {
        return {
            tratado: false,
            motivo:
                'Canal de voz não mudou'
        };
    }

    return executarEmFila(
        servidorId,
        async () => {
            // ==================================
            // CONFIGURAÇÃO DA EQUIPE
            // ==================================

            const config =
                getConfig();

            const cargoId =
                obterIdCargoEquipe(
                    config
                );

            if (!cargoId) {
                return {
                    tratado: false,
                    motivo:
                        'Cargo da equipe não configurado'
                };
            }

            // ==================================
            // SESSÃO ANTERIOR
            // ==================================

            const aberta =
                buscarSessaoAberta(
                    servidorId,
                    membroId
                );

            // ==================================
            // SAÍDA DE CANAL
            // ==================================

            if (
                canalAnterior &&
                !canalAtual
            ) {
                if (!aberta) {
                    return {
                        tratado: false,
                        motivo:
                            'Membro sem sessão aberta'
                    };
                }

                return registrarSaidaVoz(
                    servidorId,
                    membroId,
                    'saida_da_voz'
                );
            }

            // ==================================
            // VERIFICAR MEMBRO
            // ==================================

            let membro =
                await buscarMembroAtualizado(
                    guild,
                    membroId
                );

            // Se falhar a consulta e já
            // existir uma sessão, podemos
            // processar uma mudança de
            // canal sem apagar o histórico.
            //
            // Para uma nova entrada,
            // exigimos confirmação de
            // que o membro é da equipe.

            if (!membro && !aberta) {
                return {
                    tratado: false,
                    motivo:
                        'Não foi possível validar o cargo do membro'
                };
            }

            // ==================================
            // VERIFICAR CARGO DA EQUIPE
            // ==================================

            if (
                membro &&
                !ehMembroEquipe(
                    membro,
                    config
                )
            ) {
                if (aberta) {
                    // O membro perdeu o cargo
                    // da equipe enquanto
                    // possuía uma sessão.
                    //
                    // A sessão é encerrada
                    // sem registrar nova
                    // entrada de funcionário.

                    encerrarSessaoInterna(
                        aberta,
                        'cargo_equipe_removido',
                        agoraSegundos()
                    );
                }

                return {
                    tratado: false,
                    motivo:
                        'Membro não pertence à equipe'
                };
            }

            // ==================================
            // ENTRADA EM CANAL
            // ==================================

            if (
                !canalAnterior &&
                canalAtual
            ) {
                // Se havia sessão antiga
                // aberta, não assumimos
                // que o membro esteve
                // online durante todo
                // o intervalo desconhecido.

                if (aberta) {
                    encerrarSessaoInterna(
                        aberta,
                        'nova_entrada_apos_sessao_anterior',
                        aberta.ultima_observacao_em
                    );
                }

                return registrarEntradaVoz(
                    servidorId,
                    membroId,
                    canalAtual
                );
            }

            // ==================================
            // MUDANÇA DE CANAL
            // ==================================

            if (
                canalAnterior &&
                canalAtual
            ) {
                if (aberta) {
                    const sessao =
                        atualizarCanalSessao(
                            aberta,
                            canalAtual
                        );

                    return {
                        tratado: true,

                        acao:
                            'mudanca_de_canal',

                        criada: false,

                        sessao,
                        sessaoId:
                            sessao.id,

                        membroId,

                        canalAnterior,
                        canalAtual
                    };
                }

                // Um funcionário pode
                // entrar no monitoramento
                // já estando em call.
                //
                // Iniciamos a contagem
                // apenas a partir
                // desta observação.

                const entrada =
                    registrarEntradaVoz(
                        servidorId,
                        membroId,
                        canalAtual
                    );

                return {
                    ...entrada,

                    acao:
                        'mudanca_de_canal',

                    canalAnterior,
                    canalAtual
                };
            }

            return {
                tratado: false,
                motivo:
                    'Mudança de voz não reconhecida'
            };
        }
    );
}

// ==========================================
// BUSCAR FUNCIONÁRIOS EM VOZ
// ==========================================

// Utiliza o estado de voz atual
// fornecido pelo Discord.
//
// Caso não consiga obter os dados de
// algum membro, não o classifica
// como não pertencente à equipe.
//
// A sincronização precisa ser
// confiável antes de encerrar
// sessões de outros membros.

async function listarEquipeEmVoz(
    guild,
    config = null
) {
    if (!guild?.id) {
        throw new Error(
            'Servidor inválido.'
        );
    }

    if (!possuiIntentVoz(guild)) {
        throw new Error(
            'Intent GuildVoiceStates não habilitado.'
        );
    }

    const configuracao =
        config || getConfig();

    const cargoId =
        obterIdCargoEquipe(
            configuracao
        );

    if (!cargoId) {
        return [];
    }

    const membros = [];

    for (
        const estado
        of guild.voiceStates.cache.values()
    ) {
        if (!estado.channelId) {
            continue;
        }

        let membro =
            estado.member ||
            guild.members.cache.get(
                estado.id
            );

        if (!membro) {
            membro =
                await buscarMembroAtualizado(
                    guild,
                    estado.id
                );

            if (!membro) {
                throw new Error(
                    'Não foi possível consultar ' +
                    `o membro ${estado.id}. ` +
                    'A sincronização será adiada.'
                );
            }
        }

        if (
            !ehMembroEquipe(
                membro,
                configuracao
            )
        ) {
            continue;
        }

        membros.push({
            membroId:
                membro.id,

            canalId:
                estado.channelId,

            membro
        });
    }

    return membros;
}

// ==========================================
// SINCRONIZAR EQUIPE EM VOZ
// ==========================================

// Chamado pelo index.js:
//
// - Uma vez na inicialização
// - Depois, a cada cinco minutos
//
// PRIMEIRA SINCRONIZAÇÃO:
//
// Encerra sessões herdadas do
// processo anterior exatamente
// no último horário observado.
//
// Isso evita contar o período
// durante o qual o bot esteve
// desligado.
//
// SINCRONIZAÇÕES POSTERIORES:
//
// Atualizam as observações de quem
// permanece em call.
//
// Sessões ausentes são encerradas
// no último horário observado.
//
// Se os dados de voz estiverem
// incompletos, a sincronização
// é adiada em vez de encerrar
// sessões por engano.

async function sincronizarEquipeEmVoz(
    guild
) {
    if (!guild?.id) {
        return {
            sincronizado: false,
            motivo:
                'Servidor inválido'
        };
    }

    return executarEmFila(
        guild.id,
        async () => {
            if (
                !possuiIntentVoz(guild)
            ) {
                return {
                    sincronizado: false,

                    motivo:
                        'Intent de voz não habilitado'
                };
            }

            const config =
                getConfig();

            const cargoId =
                obterIdCargoEquipe(
                    config
                );

            if (!cargoId) {
                return {
                    sincronizado: false,

                    motivo:
                        'Cargo da equipe não configurado'
                };
            }

            // ==================================
            // OBTER PRESENÇA ATUAL
            // ==================================

            let presentes;

            try {
                presentes =
                    await listarEquipeEmVoz(
                        guild,
                        config
                    );

            } catch (erro) {
                console.warn(
                    '[InovareSale | Staff] ' +
                    `Sincronização adiada em ${guild.id}:`,
                    erro.message
                );

                return {
                    sincronizado: false,
                    motivo:
                        'Dados de voz incompletos'
                };
            }

            // ==================================
            // PREPARAR MAPA DOS PRESENTES
            // ==================================

            const mapaPresentes =
                new Map();

            for (
                const membro
                of presentes
            ) {
                mapaPresentes.set(
                    membro.membroId,
                    membro.canalId
                );
            }

            const horario =
                agoraSegundos();

            const primeiraSincronizacao =
                !SERVIDORES_SINCRONIZADOS.has(
                    guild.id
                );

            // ==================================
            // EXECUTAR ALTERAÇÕES NO SQLITE
            // ==================================

            const resultado =
                db.transaction(() => {
                    const abertas =
                        SQL.listarAbertas.all(
                            guild.id
                        );

                    let encerradas = 0;
                    let iniciadas = 0;
                    let atualizadas = 0;

                    // ==================================
                    // PRIMEIRA SINCRONIZAÇÃO
                    // ==================================

                    if (
                        primeiraSincronizacao
                    ) {
                        for (
                            const sessao
                            of abertas
                        ) {
                            // Ponto principal da correção:
                            //
                            // NÃO fechar no horário atual.
                            //
                            // Fechar no último horário
                            // observado pela execução
                            // anterior do bot.

                            const finalizada =
                                encerrarSessaoInterna(
                                    sessao,
                                    'reinicio_bot',
                                    sessao.ultima_observacao_em
                                );

                            if (finalizada) {
                                encerradas++;
                            }
                        }

                        // Quem está em call agora
                        // inicia uma NOVA sessão.
                        //
                        // Não juntamos o período
                        // anterior ao atual.

                        for (
                            const presente
                            of presentes
                        ) {
                            const entrada =
                                registrarEntradaVoz(
                                    guild.id,
                                    presente.membroId,
                                    presente.canalId
                                );

                            if (entrada.criada) {
                                iniciadas++;
                            }
                        }

                        return {
                            iniciadas,
                            atualizadas,
                            encerradas
                        };
                    }

                    // ==================================
                    // SINCRONIZAÇÃO PERIÓDICA
                    // ==================================

                    for (
                        const sessao
                        of abertas
                    ) {
                        const canalAtual =
                            mapaPresentes.get(
                                sessao.membro_id
                            );

                        if (!canalAtual) {
                            // O funcionário não está
                            // presente na observação
                            // atual.
                            //
                            // Não sabemos o horário
                            // exato em que ele saiu.
                            //
                            // Por isso, encerramos
                            // no último horário
                            // conhecido, sem somar
                            // tempo não confirmado.

                            const finalizada =
                                encerrarSessaoInterna(
                                    sessao,
                                    'ausente_na_sincronizacao',
                                    sessao.ultima_observacao_em
                                );

                            if (finalizada) {
                                encerradas++;
                            }

                            continue;
                        }

                        atualizarCanalSessao(
                            sessao,
                            canalAtual,
                            horario
                        );

                        atualizadas++;
                    }

                    // ==================================
                    // NOVOS FUNCIONÁRIOS
                    // ==================================

                    for (
                        const presente
                        of presentes
                    ) {
                        const aberta =
                            buscarSessaoAberta(
                                guild.id,
                                presente.membroId
                            );

                        if (aberta) {
                            continue;
                        }

                        const entrada =
                            registrarEntradaVoz(
                                guild.id,
                                presente.membroId,
                                presente.canalId
                            );

                        if (entrada.criada) {
                            iniciadas++;
                        }
                    }

                    return {
                        iniciadas,
                        atualizadas,
                        encerradas
                    };
                })();

            // ==================================
            // MARCAR SERVIDOR SINCRONIZADO
            // ==================================

            SERVIDORES_SINCRONIZADOS.add(
                guild.id
            );

            return {
                sincronizado: true,

                primeiraSincronizacao,

                funcionariosEmVoz:
                    presentes.length,

                funcionarios:
                    presentes.map(
                        item => ({
                            membroId:
                                item.membroId,

                            canalId:
                                item.canalId
                        })
                    ),

                sessoesIniciadas:
                    resultado.iniciadas,

                sessoesAtualizadas:
                    resultado.atualizadas,

                sessoesEncerradas:
                    resultado.encerradas
            };
        }
    );
}

// ==========================================
// RANKING DA EQUIPE
// ==========================================

// O ranking considera TODAS as
// sessões de cada funcionário.
//
// Para sessões abertas, o limite
// é a última observação salva.
//
// Não conta um período offline
// após a última observação.

function obterRankingVoz(
    servidorId,
    limite = LIMITE_RANKING
) {
    const servidor =
        validarId(
            servidorId,
            'Servidor'
        );

    const quantidade =
        validarLimite(
            limite,
            LIMITE_RANKING
        );

    const linhas =
        SQL.ranking.all(
            servidor,
            quantidade
        );

    return linhas.map(
        (linha, indice) => {
            const segundos = Math.max(
                0,
                Number(
                    linha.tempo_total || 0
                )
            );

            return {
                posicao:
                    indice + 1,

                membroId:
                    linha.membro_id,

                totalSessoes:
                    Number(
                        linha.total_sessoes || 0
                    ),

                tempoTotalSegundos:
                    segundos,

                tempoFormatado:
                    formatarTempoVoz(
                        segundos
                    )
            };
        }
    );
}

// ==========================================
// HISTÓRICO DE UM FUNCIONÁRIO
// ==========================================

function obterHistoricoVozMembro(
    servidorId,
    membroId,
    limite = LIMITE_HISTORICO
) {
    const servidor =
        validarId(
            servidorId,
            'Servidor'
        );

    const membro =
        validarId(
            membroId,
            'Membro'
        );

    const quantidade =
        validarLimite(
            limite,
            LIMITE_HISTORICO
        );

    const sessoes =
        SQL.historico.all(
            servidor,
            membro,
            quantidade
        );

    return sessoes.map(
        sessao => {
            const segundos =
                calcularSegundosSessao(
                    sessao
                );

            return {
                ...sessao,

                aberta:
                    sessao.encerrada_em === null,

                segundos,

                tempoFormatado:
                    formatarTempoVoz(
                        segundos
                    )
            };
        }
    );
}

// ==========================================
// ESTATÍSTICAS GERAIS DA EQUIPE
// ==========================================

// A soma é feita diretamente pelo
// SQLite sobre TODAS as sessões.
//
// Não usamos a soma de apenas
// 10 ou 25 posições do ranking.
//
// Isso evita perder tempo acumulado
// por funcionários que não estejam
// entre os primeiros colocados.

function obterEstatisticasEquipe(
    servidorId
) {
    const servidor =
        validarId(
            servidorId,
            'Servidor'
        );

    const linha =
        SQL.estatisticas.get(
            servidor
        );

    const tempoTotal =
        Math.max(
            0,
            Number(
                linha?.tempo_total || 0
            )
        );

    return {
        servidorId:
            servidor,

        funcionariosRegistrados:
            Number(
                linha?.funcionarios_registrados || 0
            ),

        totalSessoes:
            Number(
                linha?.total_sessoes || 0
            ),

        sessoesAbertas:
            Number(
                linha?.sessoes_abertas || 0
            ),

        sessoesEncerradas:
            Number(
                linha?.sessoes_encerradas || 0
            ),

        tempoTotalSegundos:
            tempoTotal,

        tempoTotalVozSegundos:
            tempoTotal,

        tempoTotalFormatado:
            formatarTempoVoz(
                tempoTotal
            )
    };
}

// ==========================================
// RESUMO PARA O PAINEL DE STATUS
// ==========================================

// Utilizado por:
//
// services/statusService.js
//
// Fornece:
//
// - Tempo observado no SQLite
// - Quantidade de sessões
// - Funcionários atualmente em voz
// - Ranking dos funcionários
//
// A contagem atual só é considerada
// disponível quando o cargo da equipe
// está configurado e o Discord
// permite consultar a presença.

async function obterResumoEquipe(
    guild
) {
    if (!guild?.id) {
        return {
            disponivel: false,
            motivo:
                'Servidor inválido',

            tempoTotalSegundos: null
        };
    }

    const estatisticas =
        obterEstatisticasEquipe(
            guild.id
        );

    const config =
        getConfig();

    const cargoId =
        obterIdCargoEquipe(
            config
        );

    if (!cargoId) {
        return {
            ...estatisticas,

            disponivel: false,
            configurado: false,

            motivo:
                'Cargo da equipe não configurado',

            funcionariosEmVoz: null,
            quantidadeEmVoz: null,

            ranking:
                obterRankingVoz(
                    guild.id,
                    10
                )
        };
    }

    try {
        const presentes =
            await listarEquipeEmVoz(
                guild,
                config
            );

        return {
            ...estatisticas,

            disponivel: true,
            configurado: true,

            funcionariosEmVoz:
                presentes.length,

            quantidadeEmVoz:
                presentes.length,

            membrosEmVoz:
                presentes.map(
                    item => ({
                        membroId:
                            item.membroId,

                        canalId:
                            item.canalId
                    })
                ),

            ranking:
                obterRankingVoz(
                    guild.id,
                    10
                )
        };

    } catch (erro) {
        return {
            ...estatisticas,

            disponivel: false,
            configurado: true,

            motivo:
                'Não foi possível consultar a presença em voz',

            funcionariosEmVoz: null,
            quantidadeEmVoz: null,

            ranking:
                obterRankingVoz(
                    guild.id,
                    10
                )
        };
    }
}

// ==========================================
// EXPORTAÇÕES
// ==========================================

module.exports = {
    // Configuração e permissões.
    obterCargoEquipe,
    ehMembroEquipe,
    possuiIntentVoz,

    // Formatação.
    formatarTempoVoz,

    // Sessões de voz.
    buscarSessaoAberta,
    registrarEntradaVoz,
    registrarSaidaVoz,
    processarMudancaVoz,

    // Presença e recuperação.
    listarEquipeEmVoz,
    sincronizarEquipeEmVoz,

    // Ranking e histórico.
    obterRankingVoz,
    obterHistoricoVozMembro,

    // Estatísticas.
    obterEstatisticasEquipe,
    obterResumoEquipe
};
