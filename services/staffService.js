
'use strict';

const { GatewayIntentBits } = require('discord.js');
const { db } = require('../database/db');
const { getConfig } = require('../utils/storage');

const LIMITE_RANKING = 25;
const LIMITE_HISTORICO = 50;
const LIMITE_CONSULTAS = 100;
const SERVIDORES_SINCRONIZADOS = new Set();
const FILAS_SERVIDORES = new Map();

db.exec(`
    CREATE TABLE IF NOT EXISTS staff_voz_sessoes_v3 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        servidor_id TEXT NOT NULL,
        membro_id TEXT NOT NULL,
        canal_inicial_id TEXT NOT NULL,
        canal_atual_id TEXT NOT NULL,
        iniciada_em INTEGER NOT NULL,
        ultima_observacao_em INTEGER NOT NULL,
        encerrada_em INTEGER,
        motivo_encerramento TEXT,
        CHECK (encerrada_em IS NULL OR encerrada_em >= iniciada_em)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_voz_sessao_aberta_v3
        ON staff_voz_sessoes_v3 (servidor_id, membro_id)
        WHERE encerrada_em IS NULL;
    CREATE INDEX IF NOT EXISTS idx_staff_voz_historico_v3
        ON staff_voz_sessoes_v3 (servidor_id, membro_id, id);
    CREATE INDEX IF NOT EXISTS idx_staff_voz_ranking_v3
        ON staff_voz_sessoes_v3 (servidor_id, membro_id);
    CREATE INDEX IF NOT EXISTS idx_staff_voz_periodo_v31
        ON staff_voz_sessoes_v3 (servidor_id, iniciada_em, encerrada_em);
    CREATE TABLE IF NOT EXISTS staff_voz_trechos_v31 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessao_id INTEGER NOT NULL,
        servidor_id TEXT NOT NULL,
        membro_id TEXT NOT NULL,
        canal_id TEXT NOT NULL,
        iniciada_em INTEGER NOT NULL,
        ultima_observacao_em INTEGER NOT NULL,
        encerrada_em INTEGER,
        CHECK (encerrada_em IS NULL OR encerrada_em >= iniciada_em)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_voz_trecho_aberto_v31
        ON staff_voz_trechos_v31 (sessao_id)
        WHERE encerrada_em IS NULL;
    CREATE INDEX IF NOT EXISTS idx_staff_voz_trecho_periodo_v31
        ON staff_voz_trechos_v31 (servidor_id, canal_id, iniciada_em);
`);

const SQL = {
    buscarAberta: db.prepare(`
        SELECT * FROM staff_voz_sessoes_v3
        WHERE servidor_id = ? AND membro_id = ?
          AND encerrada_em IS NULL LIMIT 1
    `),
    listarAbertas: db.prepare(`
        SELECT * FROM staff_voz_sessoes_v3
        WHERE servidor_id = ? AND encerrada_em IS NULL
        ORDER BY id ASC
    `),
    inserir: db.prepare(`
        INSERT INTO staff_voz_sessoes_v3 (
            servidor_id, membro_id, canal_inicial_id,
            canal_atual_id, iniciada_em, ultima_observacao_em
        ) VALUES (?, ?, ?, ?, ?, ?)
    `),
    atualizarObservacao: db.prepare(`
        UPDATE staff_voz_sessoes_v3
        SET canal_atual_id = ?, ultima_observacao_em = ?
        WHERE id = ? AND encerrada_em IS NULL
    `),
    encerrar: db.prepare(`
        UPDATE staff_voz_sessoes_v3
        SET ultima_observacao_em = ?, encerrada_em = ?,
            motivo_encerramento = ?
        WHERE id = ? AND encerrada_em IS NULL
    `),
    buscarPorId: db.prepare(`
        SELECT * FROM staff_voz_sessoes_v3 WHERE id = ?
    `),
    historico: db.prepare(`
        SELECT * FROM staff_voz_sessoes_v3
        WHERE servidor_id = ? AND membro_id = ?
        ORDER BY id DESC LIMIT ?
    `),
    ranking: db.prepare(`
        SELECT membro_id, COUNT(*) AS total_sessoes,
            COALESCE(SUM(MAX(0,
                COALESCE(encerrada_em, ultima_observacao_em)
                - iniciada_em
            )), 0) AS tempo_total
        FROM staff_voz_sessoes_v3
        WHERE servidor_id = ?
        GROUP BY membro_id
        ORDER BY tempo_total DESC, membro_id ASC
        LIMIT ?
    `),
    estatisticas: db.prepare(`
        SELECT COUNT(*) AS total_sessoes,
            COUNT(DISTINCT membro_id) AS funcionarios_registrados,
            COALESCE(SUM(
                CASE WHEN encerrada_em IS NULL
                THEN 1 ELSE 0 END
            ), 0) AS sessoes_abertas,
            COALESCE(SUM(
                CASE WHEN encerrada_em IS NOT NULL
                THEN 1 ELSE 0 END
            ), 0) AS sessoes_encerradas,
            COALESCE(SUM(MAX(0,
                COALESCE(encerrada_em, ultima_observacao_em)
                - iniciada_em
            )), 0) AS tempo_total
        FROM staff_voz_sessoes_v3
        WHERE servidor_id = ?
    `),
    buscarTrechoAberto: db.prepare(`
        SELECT * FROM staff_voz_trechos_v31
        WHERE sessao_id = ? AND encerrada_em IS NULL
        LIMIT 1
    `),
    inserirTrecho: db.prepare(`
        INSERT INTO staff_voz_trechos_v31 (
            sessao_id, servidor_id, membro_id, canal_id,
            iniciada_em, ultima_observacao_em
        ) VALUES (?, ?, ?, ?, ?, ?)
    `),
    observarTrecho: db.prepare(`
        UPDATE staff_voz_trechos_v31
        SET ultima_observacao_em = ?
        WHERE id = ? AND encerrada_em IS NULL
    `),
    encerrarTrecho: db.prepare(`
        UPDATE staff_voz_trechos_v31
        SET ultima_observacao_em = ?, encerrada_em = ?
        WHERE id = ? AND encerrada_em IS NULL
    `),
    rankingPeriodo: db.prepare(`
        SELECT membro_id, COUNT(*) AS total_sessoes,
            COALESCE(SUM(MAX(0,
                MIN(
                    COALESCE(encerrada_em, ultima_observacao_em),
                    ?
                ) - MAX(iniciada_em, ?)
            )), 0) AS tempo_total
        FROM staff_voz_sessoes_v3
        WHERE servidor_id = ?
          AND iniciada_em < ?
          AND COALESCE(
              encerrada_em, ultima_observacao_em
          ) > ?
        GROUP BY membro_id
        ORDER BY tempo_total DESC, membro_id ASC
        LIMIT ?
    `),
    funcionarioPeriodo: db.prepare(`
        SELECT COUNT(*) AS total_sessoes,
            COALESCE(SUM(MAX(0,
                MIN(
                    COALESCE(encerrada_em, ultima_observacao_em),
                    ?
                ) - MAX(iniciada_em, ?)
            )), 0) AS tempo_total
        FROM staff_voz_sessoes_v3
        WHERE servidor_id = ? AND membro_id = ?
          AND iniciada_em < ?
          AND COALESCE(
              encerrada_em, ultima_observacao_em
          ) > ?
    `)
};

function agoraSegundos() {
    return Math.floor(Date.now() / 1000);
}

function validarId(valor, nome = 'ID') {
    const texto = String(valor ?? '').trim();

    if (!/^\d{15,22}$/.test(texto)) {
        throw new Error(`${nome} inválido.`);
    }

    return texto;
}

function idOpcional(valor) {
    const texto = String(valor ?? '').trim();
    return /^\d{15,22}$/.test(texto) ? texto : null;
}

function validarLimite(limite, padrao) {
    const numero = Number(limite);

    return Number.isSafeInteger(numero) && numero > 0
        ? Math.min(numero, LIMITE_CONSULTAS)
        : padrao;
}

function validarPeriodo(inicioEm, fimEm) {
    const inicio = Number(inicioEm);
    const fim = Number(fimEm);

    if (
        !Number.isSafeInteger(inicio) ||
        !Number.isSafeInteger(fim) ||
        inicio < 0 ||
        fim <= inicio ||
        fim > 99999999999
    ) {
        throw new Error(
            'Período inválido. Use timestamps Unix em segundos.'
        );
    }

    return { inicio, fim };
}

function formatarTempoVoz(segundos) {
    const total = Math.max(
        0,
        Math.floor(Number(segundos) || 0)
    );

    const dias = Math.floor(total / 86400);
    const horas = Math.floor((total % 86400) / 3600);
    const minutos = Math.floor((total % 3600) / 60);
    const partes = [];

    if (dias) partes.push(`${dias}d`);
    if (horas) partes.push(`${horas}h`);
    if (minutos) partes.push(`${minutos}min`);

    return partes.join(' ') || `${total % 60}s`;
}

function obterIdCargoEquipe(config = null) {
    return idOpcional(
        (config || getConfig()).staff?.cargoId
    );
}

function obterCargoEquipe(guild, config = null) {
    if (!guild?.id) return null;

    const cargoId = obterIdCargoEquipe(config);

    return cargoId
        ? guild.roles.cache.get(cargoId) || null
        : null;
}

function ehMembroEquipe(membro, config = null) {
    if (!membro || membro.user?.bot) return false;

    const cargoId = obterIdCargoEquipe(config);

    return Boolean(
        cargoId && membro.roles?.cache?.has(cargoId)
    );
}

function possuiIntentVoz(guildOuClient) {
    const client = guildOuClient?.client || guildOuClient;

    return Boolean(
        client?.options?.intents?.has(
            GatewayIntentBits.GuildVoiceStates
        )
    );
}

async function executarEmFila(servidorId, tarefa) {
    const servidor = validarId(servidorId, 'Servidor');
    const anterior =
        FILAS_SERVIDORES.get(servidor) || Promise.resolve();

    const atual = anterior
        .catch(() => {})
        .then(tarefa);

    FILAS_SERVIDORES.set(servidor, atual);

    try {
        return await atual;
    } finally {
        if (FILAS_SERVIDORES.get(servidor) === atual) {
            FILAS_SERVIDORES.delete(servidor);
        }
    }
}

function calcularSegundosSessao(sessao) {
    if (!sessao) return 0;

    const inicio = Number(sessao.iniciada_em);
    const fim = Number(
        sessao.encerrada_em ??
        sessao.ultima_observacao_em
    );

    return Number.isFinite(inicio) && Number.isFinite(fim)
        ? Math.max(0, Math.floor(fim - inicio))
        : 0;
}

function buscarSessaoAberta(servidorId, membroId) {
    return SQL.buscarAberta.get(
        validarId(servidorId, 'Servidor'),
        validarId(membroId, 'Membro')
    ) || null;
}

function observarTrechoSessao(
    sessao,
    canalId,
    horario,
    criarSeAusente = true
) {
    const atual = SQL.buscarTrechoAberto.get(sessao.id);
    const canal = validarId(canalId, 'Canal');

    const observado = Math.max(
        Number(sessao.iniciada_em),
        Number(sessao.ultima_observacao_em),
        Math.floor(horario)
    );

    if (atual && atual.canal_id === canal) {
        SQL.observarTrecho.run(
            Math.max(
                Number(atual.ultima_observacao_em),
                observado
            ),
            atual.id
        );
        return;
    }

    if (atual) {
        const encerrado = Math.max(
            Number(atual.iniciada_em),
            Number(atual.ultima_observacao_em),
            observado
        );

        SQL.encerrarTrecho.run(
            encerrado,
            encerrado,
            atual.id
        );
    }

    if (criarSeAusente) {
        SQL.inserirTrecho.run(
            sessao.id,
            sessao.servidor_id,
            sessao.membro_id,
            canal,
            observado,
            observado
        );
    }
}

function encerrarSessaoInterna(
    sessao,
    motivo,
    horarioFinal
) {
    if (!sessao) return null;

    const inicio = Number(sessao.iniciada_em);
    const ultimo = Number(sessao.ultima_observacao_em);
    const desejado = Number(horarioFinal);

    const final = Math.max(
        inicio,
        ultimo,
        Number.isFinite(desejado)
            ? Math.floor(desejado)
            : ultimo
    );

    const resultado = SQL.encerrar.run(
        final,
        final,
        String(motivo || 'saida'),
        sessao.id
    );

    if (resultado.changes !== 1) return null;

    const trecho = SQL.buscarTrechoAberto.get(sessao.id);

    if (trecho) {
        const fimTrecho = Math.max(
            Number(trecho.iniciada_em),
            Number(trecho.ultima_observacao_em),
            final
        );

        SQL.encerrarTrecho.run(
            fimTrecho,
            fimTrecho,
            trecho.id
        );
    }

    return SQL.buscarPorId.get(sessao.id) || null;
}

function registrarEntradaVoz(
    servidorId,
    membroId,
    canalId
) {
    const servidor = validarId(servidorId, 'Servidor');
    const membro = validarId(membroId, 'Membro');
    const canal = validarId(canalId, 'Canal');
    const horario = agoraSegundos();

    return db.transaction(() => {
        const existente = buscarSessaoAberta(
            servidor,
            membro
        );

        if (existente) {
            return {
                tratado: false,
                criada: false,
                acao: 'sessao_ja_aberta',
                sessao: existente,
                sessaoId: existente.id
            };
        }

        const resultado = SQL.inserir.run(
            servidor,
            membro,
            canal,
            canal,
            horario,
            horario
        );

        const sessao = SQL.buscarPorId.get(
            Number(resultado.lastInsertRowid)
        );

        observarTrechoSessao(
            sessao,
            canal,
            horario
        );

        return {
            tratado: true,
            criada: true,
            acao: 'entrada',
            sessao,
            sessaoId: sessao.id,
            membroId: membro,
            canalId: canal
        };
    })();
}

function registrarSaidaVoz(
    servidorId,
    membroId,
    motivo = 'saida_da_voz'
) {
    const servidor = validarId(servidorId, 'Servidor');
    const membro = validarId(membroId, 'Membro');

    return db.transaction(() => {
        const aberta = buscarSessaoAberta(
            servidor,
            membro
        );

        if (!aberta) {
            return {
                tratado: false,
                encerrada: false,
                motivo: 'Nenhuma sessão aberta'
            };
        }

        const encerrada = encerrarSessaoInterna(
            aberta,
            motivo,
            agoraSegundos()
        );

        if (!encerrada) {
            return {
                tratado: false,
                encerrada: false,
                motivo: 'Não foi possível encerrar a sessão'
            };
        }

        return {
            tratado: true,
            encerrada: true,
            acao: 'saida',
            sessao: encerrada,
            sessaoId: encerrada.id,
            membroId: membro,
            segundos: calcularSegundosSessao(encerrada)
        };
    })();
}

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
            `[InovareSale | Staff] Não foi possível consultar ${membroId}:`,
            erro.message
        );

        return null;
    }
}

function atualizarCanalSessao(
    sessao,
    canalId,
    horario = agoraSegundos()
) {
    const canal = validarId(canalId, 'Canal');

    const observado = Math.max(
        Number(sessao.iniciada_em),
        Number(sessao.ultima_observacao_em),
        Math.floor(horario)
    );

    observarTrechoSessao(
        sessao,
        canal,
        observado
    );

    SQL.atualizarObservacao.run(
        canal,
        observado,
        sessao.id
    );

    return SQL.buscarPorId.get(sessao.id);
}

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
            motivo: 'Servidor inválido'
        };
    }

    const servidorId = guild.id;
    const membroId =
        estadoAtual?.id ||
        estadoAnterior?.id;

    if (!idOpcional(membroId)) {
        return {
            tratado: false,
            motivo: 'Membro inválido'
        };
    }

    const canalAnterior = idOpcional(
        estadoAnterior?.channelId
    );

    const canalAtual = idOpcional(
        estadoAtual?.channelId
    );

    if (canalAnterior === canalAtual) {
        return {
            tratado: false,
            motivo: 'Canal de voz não mudou'
        };
    }

    return executarEmFila(
        servidorId,
        async () => {
            const config = getConfig();

            if (!obterIdCargoEquipe(config)) {
                return {
                    tratado: false,
                    motivo: 'Cargo da equipe não configurado'
                };
            }

            const aberta = buscarSessaoAberta(
                servidorId,
                membroId
            );

            if (canalAnterior && !canalAtual) {
                return aberta
                    ? registrarSaidaVoz(
                        servidorId,
                        membroId,
                        'saida_da_voz'
                    )
                    : {
                        tratado: false,
                        motivo: 'Membro sem sessão aberta'
                    };
            }

            const membro = await buscarMembroAtualizado(
                guild,
                membroId
            );

            if (!membro && !aberta) {
                return {
                    tratado: false,
                    motivo: 'Não foi possível validar o cargo do membro'
                };
            }

            if (
                membro &&
                !ehMembroEquipe(membro, config)
            ) {
                if (aberta) {
                    encerrarSessaoInterna(
                        aberta,
                        'cargo_equipe_removido',
                        agoraSegundos()
                    );
                }

                return {
                    tratado: false,
                    motivo: 'Membro não pertence à equipe'
                };
            }

            if (!canalAnterior && canalAtual) {
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

            if (canalAnterior && canalAtual) {
                if (aberta) {
                    const sessao = atualizarCanalSessao(
                        aberta,
                        canalAtual
                    );

                    return {
                        tratado: true,
                        acao: 'mudanca_de_canal',
                        criada: false,
                        sessao,
                        sessaoId: sessao.id,
                        membroId,
                        canalAnterior,
                        canalAtual
                    };
                }

                const entrada = registrarEntradaVoz(
                    servidorId,
                    membroId,
                    canalAtual
                );

                return {
                    ...entrada,
                    acao: 'mudanca_de_canal',
                    canalAnterior,
                    canalAtual
                };
            }

            return {
                tratado: false,
                motivo: 'Mudança de voz não reconhecida'
            };
        }
    );
}

async function listarEquipeEmVoz(
    guild,
    config = null
) {
    if (!guild?.id) {
        throw new Error('Servidor inválido.');
    }

    if (!possuiIntentVoz(guild)) {
        throw new Error(
            'Intent GuildVoiceStates não habilitado.'
        );
    }

    const configuracao = config || getConfig();

    if (!obterIdCargoEquipe(configuracao)) {
        return [];
    }

    const membros = [];

    for (const estado of guild.voiceStates.cache.values()) {
        if (!estado.channelId) continue;

        let membro =
            estado.member ||
            guild.members.cache.get(estado.id);

        if (!membro) {
            membro = await buscarMembroAtualizado(
                guild,
                estado.id
            );

            if (!membro) {
                throw new Error(
                    `Não foi possível consultar o membro ${estado.id}. ` +
                    'A sincronização será adiada.'
                );
            }
        }

        if (ehMembroEquipe(membro, configuracao)) {
            membros.push({
                membroId: membro.id,
                canalId: estado.channelId,
                membro
            });
        }
    }

    return membros;
}

async function sincronizarEquipeEmVoz(guild) {
    if (!guild?.id) {
        return {
            sincronizado: false,
            motivo: 'Servidor inválido'
        };
    }

    return executarEmFila(
        guild.id,
        async () => {
            if (!possuiIntentVoz(guild)) {
                return {
                    sincronizado: false,
                    motivo: 'Intent de voz não habilitado'
                };
            }

            const config = getConfig();

            if (!obterIdCargoEquipe(config)) {
                return {
                    sincronizado: false,
                    motivo: 'Cargo da equipe não configurado'
                };
            }

            let presentes;

            try {
                presentes = await listarEquipeEmVoz(
                    guild,
                    config
                );
            } catch (erro) {
                console.warn(
                    `[InovareSale | Staff] Sincronização adiada em ${guild.id}:`,
                    erro.message
                );

                return {
                    sincronizado: false,
                    motivo: 'Dados de voz incompletos'
                };
            }

            const mapaPresentes = new Map(
                presentes.map(membro => [
                    membro.membroId,
                    membro.canalId
                ])
            );

            const horario = agoraSegundos();

            const primeiraSincronizacao =
                !SERVIDORES_SINCRONIZADOS.has(guild.id);

            const resultado = db.transaction(() => {
                const abertas = SQL.listarAbertas.all(
                    guild.id
                );

                let encerradas = 0;
                let iniciadas = 0;
                let atualizadas = 0;

                if (primeiraSincronizacao) {
                    for (const sessao of abertas) {
                        if (
                            encerrarSessaoInterna(
                                sessao,
                                'reinicio_bot',
                                sessao.ultima_observacao_em
                            )
                        ) {
                            encerradas++;
                        }
                    }

                    for (const presente of presentes) {
                        if (
                            registrarEntradaVoz(
                                guild.id,
                                presente.membroId,
                                presente.canalId
                            ).criada
                        ) {
                            iniciadas++;
                        }
                    }
                } else {
                    for (const sessao of abertas) {
                        const canalAtual = mapaPresentes.get(
                            sessao.membro_id
                        );

                        if (!canalAtual) {
                            if (
                                encerrarSessaoInterna(
                                    sessao,
                                    'ausente_na_sincronizacao',
                                    sessao.ultima_observacao_em
                                )
                            ) {
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

                    for (const presente of presentes) {
                        if (
                            !buscarSessaoAberta(
                                guild.id,
                                presente.membroId
                            )
                        ) {
                            if (
                                registrarEntradaVoz(
                                    guild.id,
                                    presente.membroId,
                                    presente.canalId
                                ).criada
                            ) {
                                iniciadas++;
                            }
                        }
                    }
                }

                return {
                    iniciadas,
                    atualizadas,
                    encerradas
                };
            })();

            SERVIDORES_SINCRONIZADOS.add(guild.id);

            return {
                sincronizado: true,
                primeiraSincronizacao,
                funcionariosEmVoz: presentes.length,
                funcionarios: presentes.map(item => ({
                    membroId: item.membroId,
                    canalId: item.canalId
                })),
                sessoesIniciadas: resultado.iniciadas,
                sessoesAtualizadas: resultado.atualizadas,
                sessoesEncerradas: resultado.encerradas
            };
        }
    );
}

function obterRankingVoz(
    servidorId,
    limite = LIMITE_RANKING
) {
    const servidor = validarId(
        servidorId,
        'Servidor'
    );

    return SQL.ranking.all(
        servidor,
        validarLimite(limite, LIMITE_RANKING)
    ).map((linha, indice) => {
        const segundos = Math.max(
            0,
            Number(linha.tempo_total || 0)
        );

        return {
            posicao: indice + 1,
            membroId: linha.membro_id,
            totalSessoes: Number(
                linha.total_sessoes || 0
            ),
            tempoTotalSegundos: segundos,
            tempoFormatado: formatarTempoVoz(segundos)
        };
    });
}

function obterHistoricoVozMembro(
    servidorId,
    membroId,
    limite = LIMITE_HISTORICO
) {
    const servidor = validarId(
        servidorId,
        'Servidor'
    );

    const membro = validarId(
        membroId,
        'Membro'
    );

    return SQL.historico.all(
        servidor,
        membro,
        validarLimite(limite, LIMITE_HISTORICO)
    ).map(sessao => {
        const segundos = calcularSegundosSessao(sessao);

        return {
            ...sessao,
            aberta: sessao.encerrada_em === null,
            segundos,
            tempoFormatado: formatarTempoVoz(segundos)
        };
    });
}

function obterEstatisticasEquipe(servidorId) {
    const servidor = validarId(
        servidorId,
        'Servidor'
    );

    const linha = SQL.estatisticas.get(servidor);

    const tempoTotal = Math.max(
        0,
        Number(linha?.tempo_total || 0)
    );

    return {
        servidorId: servidor,
        funcionariosRegistrados: Number(
            linha?.funcionarios_registrados || 0
        ),
        totalSessoes: Number(
            linha?.total_sessoes || 0
        ),
        sessoesAbertas: Number(
            linha?.sessoes_abertas || 0
        ),
        sessoesEncerradas: Number(
            linha?.sessoes_encerradas || 0
        ),
        tempoTotalSegundos: tempoTotal,
        tempoTotalVozSegundos: tempoTotal,
        tempoTotalFormatado: formatarTempoVoz(
            tempoTotal
        )
    };
}

function obterCanaisAtendimento(config = null) {
    const canais =
        (config || getConfig()).staff?.canaisAtendimento;

    if (!Array.isArray(canais)) {
        return [];
    }

    return [
        ...new Set(
            canais.map(idOpcional).filter(Boolean)
        )
    ];
}

function obterSegundosAtendimentoPeriodo(
    servidorId,
    membroId,
    inicioEm,
    fimEm,
    canais = null
) {
    const servidor = validarId(
        servidorId,
        'Servidor'
    );

    const membro = validarId(
        membroId,
        'Membro'
    );

    const { inicio, fim } = validarPeriodo(
        inicioEm,
        fimEm
    );

    const canaisValidos = canais === null
        ? obterCanaisAtendimento()
        : [
            ...new Set(
                (Array.isArray(canais) ? canais : [])
                    .map(idOpcional)
                    .filter(Boolean)
            )
        ];

    if (!canaisValidos.length) {
        return 0;
    }

    const placeholders = canaisValidos
        .map(() => '?')
        .join(', ');

    const stmt = db.prepare(`
        SELECT COALESCE(SUM(MAX(0,
            MIN(
                COALESCE(encerrada_em, ultima_observacao_em),
                ?
            ) - MAX(iniciada_em, ?)
        )), 0) AS segundos
        FROM staff_voz_trechos_v31
        WHERE servidor_id = ?
          AND membro_id = ?
          AND canal_id IN (${placeholders})
          AND iniciada_em < ?
          AND COALESCE(
              encerrada_em, ultima_observacao_em
          ) > ?
    `);

    const linha = stmt.get(
        fim,
        inicio,
        servidor,
        membro,
        ...canaisValidos,
        fim,
        inicio
    );

    return Math.max(
        0,
        Number(linha?.segundos || 0)
    );
}

function obterRankingVozPeriodo(
    servidorId,
    inicioEm,
    fimEm,
    limite = LIMITE_RANKING,
    canais = null
) {
    const servidor = validarId(
        servidorId,
        'Servidor'
    );

    const { inicio, fim } = validarPeriodo(
        inicioEm,
        fimEm
    );

    const quantidade = validarLimite(
        limite,
        LIMITE_RANKING
    );

    const canaisValidos = canais === null
        ? obterCanaisAtendimento()
        : canais;

    const linhas = SQL.rankingPeriodo.all(
        fim,
        inicio,
        servidor,
        fim,
        inicio,
        LIMITE_CONSULTAS
    );

    return linhas
        .map(linha => {
            const tempoTotalSegundos = Math.max(
                0,
                Number(linha.tempo_total || 0)
            );

            const tempoAtendimentoSegundos =
                obterSegundosAtendimentoPeriodo(
                    servidor,
                    linha.membro_id,
                    inicio,
                    fim,
                    canaisValidos
                );

            return {
                membroId: linha.membro_id,
                totalSessoes: Number(
                    linha.total_sessoes || 0
                ),
                tempoTotalSegundos,
                tempoFormatado: formatarTempoVoz(
                    tempoTotalSegundos
                ),
                tempoAtendimentoSegundos,
                tempoAtendimentoFormatado:
                    formatarTempoVoz(
                        tempoAtendimentoSegundos
                    )
            };
        })
        .sort((a, b) =>
            b.tempoAtendimentoSegundos -
            a.tempoAtendimentoSegundos ||
            b.tempoTotalSegundos -
            a.tempoTotalSegundos ||
            a.membroId.localeCompare(b.membroId)
        )
        .slice(0, quantidade)
        .map((item, indice) => ({
            ...item,
            posicao: indice + 1
        }));
}

function obterVozFuncionarioPeriodo(
    servidorId,
    membroId,
    inicioEm,
    fimEm,
    canais = null
) {
    const servidor = validarId(
        servidorId,
        'Servidor'
    );

    const membro = validarId(
        membroId,
        'Membro'
    );

    const { inicio, fim } = validarPeriodo(
        inicioEm,
        fimEm
    );

    const linha = SQL.funcionarioPeriodo.get(
        fim,
        inicio,
        servidor,
        membro,
        fim,
        inicio
    );

    const tempoTotalSegundos = Math.max(
        0,
        Number(linha?.tempo_total || 0)
    );

    const tempoAtendimentoSegundos =
        obterSegundosAtendimentoPeriodo(
            servidor,
            membro,
            inicio,
            fim,
            canais
        );

    return {
        membroId: membro,
        totalSessoes: Number(
            linha?.total_sessoes || 0
        ),
        tempoTotalSegundos,
        tempoFormatado: formatarTempoVoz(
            tempoTotalSegundos
        ),
        tempoAtendimentoSegundos,
        tempoAtendimentoFormatado:
            formatarTempoVoz(
                tempoAtendimentoSegundos
            )
    };
}

async function obterResumoEquipe(guild) {
    if (!guild?.id) {
        return {
            disponivel: false,
            motivo: 'Servidor inválido',
            tempoTotalSegundos: null
        };
    }

    const estatisticas = obterEstatisticasEquipe(
        guild.id
    );

    const config = getConfig();

    if (!obterIdCargoEquipe(config)) {
        return {
            ...estatisticas,
            disponivel: false,
            configurado: false,
            motivo: 'Cargo da equipe não configurado',
            funcionariosEmVoz: null,
            quantidadeEmVoz: null,
            ranking: obterRankingVoz(guild.id, 10)
        };
    }

    try {
        const presentes = await listarEquipeEmVoz(
            guild,
            config
        );

        return {
            ...estatisticas,
            disponivel: true,
            configurado: true,
            funcionariosEmVoz: presentes.length,
            quantidadeEmVoz: presentes.length,
            membrosEmVoz: presentes.map(item => ({
                membroId: item.membroId,
                canalId: item.canalId
            })),
            ranking: obterRankingVoz(guild.id, 10)
        };
    } catch {
        return {
            ...estatisticas,
            disponivel: false,
            configurado: true,
            motivo:
                'Não foi possível consultar a presença em voz',
            funcionariosEmVoz: null,
            quantidadeEmVoz: null,
            ranking: obterRankingVoz(guild.id, 10)
        };
    }
}

module.exports = {
    obterCargoEquipe,
    ehMembroEquipe,
    possuiIntentVoz,
    formatarTempoVoz,
    buscarSessaoAberta,
    registrarEntradaVoz,
    registrarSaidaVoz,
    processarMudancaVoz,
    listarEquipeEmVoz,
    sincronizarEquipeEmVoz,
    obterRankingVoz,
    obterHistoricoVozMembro,
    obterEstatisticasEquipe,
    obterResumoEquipe,
    obterCanaisAtendimento,
    obterSegundosAtendimentoPeriodo,
    obterRankingVozPeriodo,
    obterVozFuncionarioPeriodo
};
