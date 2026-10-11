
'use strict';

const {
    db
} = require('../database/db');

// ==========================================
// INOVARESALE BOT 3.0
// SERVIÇO DE CONVITES
// ==========================================

// FUNCIONALIDADES:
//
// - Persistir convites no SQLite
// - Sincronizar os usos dos links
// - Registrar novos membros
// - Evitar contar o mesmo membro duas vezes
// - Detectar entradas próximas
// - Tratar convites de uso único
// - Tratar links removidos ou expirados
// - Evitar atribuições sem confirmação
// - Recuperar a base após falhas da API
// - Criar ranking de convites confirmados
// - Preservar todo o histórico anterior
//
// IMPORTANTE:
//
// O Discord não informa diretamente
// qual link cada novo membro utilizou.
//
// Só é possível inferir o convite
// comparando os contadores de uso.
//
// Portanto, este sistema prioriza
// a precisão e não inventa resultados.
//
// Convites ambíguos NÃO entram no ranking.

// ==========================================
// STATUS DE ENTRADA
// ==========================================

const STATUS_ENTRADA = Object.freeze({
    CONFIRMADO: 'confirmado',

    NAO_IDENTIFICADO: 'nao_identificado',

    AMBIGUO: 'ambiguo',

    SEM_BASE: 'sem_base',

    SEM_ACESSO: 'sem_acesso'
});

// ==========================================
// CONFIGURAÇÕES
// ==========================================

const LIMITE_RANKING = 25;

const LIMITE_HISTORICO = 50;

// Aguarda um pequeno intervalo para
// detectar entradas muito próximas.
//
// Não garante identificar todas as
// entradas simultâneas, mas reduz
// o risco de uma atribuição errada.

const ESPERA_ENTRADA_MS = 2200;

const JANELA_PROXIMIDADE_MS = 2000;

const DURACAO_RISCO_MS = 10000;

// Um convite removido recentemente
// pode ter sido utilizado e esgotado.
//
// Durante esse intervalo, evitamos
// atribuir outro link sem segurança.

const JANELA_REMOCAO_MS = 10000;

// ==========================================
// CONTROLES EM MEMÓRIA
// ==========================================

const FILAS_SERVIDORES = new Map();

const ENTRADAS_RECENTES = new Map();

const REMOCOES_RECENTES = new Map();

// Quando a lista de convites muda
// enquanto aguardamos uma consulta,
// sua revisão é incrementada.
//
// Assim, uma comparação antiga
// não é tratada como confirmação.

const REVISOES_SERVIDORES = new Map();

// ==========================================
// TABELAS SQLITE
// ==========================================

// Mantemos exatamente os nomes das
// tabelas da versão anterior.
//
// Não apagamos linhas nem recriamos
// o banco de dados.
//
// A tabela de estado identifica se
// existe uma captura confiável para
// comparar futuras entradas.

db.exec(`
    CREATE TABLE IF NOT EXISTS
        convites_estado_v3 (

            servidor_id TEXT PRIMARY KEY,

            inicializado_em TEXT NOT NULL
                DEFAULT CURRENT_TIMESTAMP,

            atualizado_em TEXT NOT NULL
                DEFAULT CURRENT_TIMESTAMP
        );

    CREATE TABLE IF NOT EXISTS
        convites_codigos_v3 (

            servidor_id TEXT NOT NULL,

            codigo TEXT NOT NULL,

            convidador_id TEXT,

            canal_id TEXT,

            usos INTEGER NOT NULL DEFAULT 0
                CHECK (usos >= 0),

            usos_maximos INTEGER NOT NULL DEFAULT 0
                CHECK (usos_maximos >= 0),

            ativo INTEGER NOT NULL DEFAULT 1
                CHECK (ativo IN (0, 1)),

            criado_em TEXT NOT NULL
                DEFAULT CURRENT_TIMESTAMP,

            atualizado_em TEXT NOT NULL
                DEFAULT CURRENT_TIMESTAMP,

            PRIMARY KEY (
                servidor_id,
                codigo
            )
        );

    CREATE INDEX IF NOT EXISTS
        idx_convites_codigos_v3_convidador

    ON convites_codigos_v3 (
        servidor_id,
        convidador_id
    );

    CREATE TABLE IF NOT EXISTS
        convites_entradas_v3 (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            servidor_id TEXT NOT NULL,

            membro_id TEXT NOT NULL,

            convidador_id TEXT,

            codigo TEXT,

            status TEXT NOT NULL,

            observacao TEXT NOT NULL DEFAULT '',

            entrada_em TEXT NOT NULL
                DEFAULT CURRENT_TIMESTAMP,

            UNIQUE (
                servidor_id,
                membro_id
            )
        );

    CREATE INDEX IF NOT EXISTS
        idx_convites_entradas_v3_servidor

    ON convites_entradas_v3 (
        servidor_id,
        status
    );

    CREATE INDEX IF NOT EXISTS
        idx_convites_entradas_v3_convidador

    ON convites_entradas_v3 (
        servidor_id,
        convidador_id
    );
`);

// ==========================================
// CONSULTAS PREPARADAS
// ==========================================

const SQL = {
    estado: db.prepare(`
        SELECT *
        FROM convites_estado_v3
        WHERE servidor_id = ?
    `),

    marcarInicializado: db.prepare(`
        INSERT INTO convites_estado_v3 (
            servidor_id
        )
        VALUES (?)

        ON CONFLICT(servidor_id)
        DO UPDATE SET
            atualizado_em = CURRENT_TIMESTAMP
    `),

    invalidarEstado: db.prepare(`
        DELETE FROM convites_estado_v3
        WHERE servidor_id = ?
    `),

    listarCodigos: db.prepare(`
        SELECT *
        FROM convites_codigos_v3
        WHERE servidor_id = ?
    `),

    buscarCodigo: db.prepare(`
        SELECT *
        FROM convites_codigos_v3
        WHERE servidor_id = ?
          AND codigo = ?
    `),

    desativarCodigos: db.prepare(`
        UPDATE convites_codigos_v3
        SET ativo = 0,
            atualizado_em = CURRENT_TIMESTAMP

        WHERE servidor_id = ?
          AND ativo = 1
    `),

    salvarCodigo: db.prepare(`
        INSERT INTO convites_codigos_v3 (
            servidor_id,
            codigo,
            convidador_id,
            canal_id,
            usos,
            usos_maximos,
            ativo
        )

        VALUES (?, ?, ?, ?, ?, ?, 1)

        ON CONFLICT(servidor_id, codigo)
        DO UPDATE SET

            convidador_id = COALESCE(
                excluded.convidador_id,
                convites_codigos_v3.convidador_id
            ),

            canal_id = COALESCE(
                excluded.canal_id,
                convites_codigos_v3.canal_id
            ),

            usos = excluded.usos,

            usos_maximos = excluded.usos_maximos,

            ativo = 1,

            atualizado_em = CURRENT_TIMESTAMP
    `),

    excluirCodigo: db.prepare(`
        UPDATE convites_codigos_v3

        SET ativo = 0,
            atualizado_em = CURRENT_TIMESTAMP

        WHERE servidor_id = ?
          AND codigo = ?
          AND ativo = 1
    `),

    buscarEntrada: db.prepare(`
        SELECT *
        FROM convites_entradas_v3

        WHERE servidor_id = ?
          AND membro_id = ?
    `),

    inserirEntrada: db.prepare(`
        INSERT OR IGNORE INTO
            convites_entradas_v3 (
                servidor_id,
                membro_id,
                convidador_id,
                codigo,
                status,
                observacao
            )

        VALUES (?, ?, ?, ?, ?, ?)
    `),

    listarEntradas: db.prepare(`
        SELECT *
        FROM convites_entradas_v3

        WHERE servidor_id = ?

        ORDER BY id DESC

        LIMIT ?
    `),

    ranking: db.prepare(`
        SELECT
            convidador_id,

            COUNT(*) AS total

        FROM convites_entradas_v3

        WHERE servidor_id = ?
          AND status = 'confirmado'
          AND convidador_id IS NOT NULL

        GROUP BY convidador_id

        ORDER BY
            total DESC,
            convidador_id ASC

        LIMIT ?
    `),

    estatisticas: db.prepare(`
        SELECT
            COUNT(*) AS total,

            COALESCE(SUM(
                CASE
                    WHEN status = 'confirmado'
                    THEN 1 ELSE 0
                END
            ), 0) AS confirmados,

            COALESCE(SUM(
                CASE
                    WHEN status != 'confirmado'
                    THEN 1 ELSE 0
                END
            ), 0) AS naoIdentificados

        FROM convites_entradas_v3

        WHERE servidor_id = ?
    `),

    quantidadeLinks: db.prepare(`
        SELECT COUNT(*) AS total

        FROM convites_codigos_v3

        WHERE servidor_id = ?
          AND ativo = 1
    `)
};

// ==========================================
// VALIDAÇÕES
// ==========================================

function validarIdDiscord(
    valor,
    nome = 'ID'
) {
    const texto = String(
        valor ?? ''
    ).trim();

    if (!/^\d{15,22}$/.test(texto)) {
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

function validarCodigo(valor) {
    const codigo = String(
        valor ?? ''
    ).trim();

    if (
        !/^[A-Za-z0-9_-]{2,64}$/.test(
            codigo
        )
    ) {
        throw new Error(
            'Código de convite inválido.'
        );
    }

    return codigo;
}

function validarLimite(
    valor,
    padrao,
    maximo = 100
) {
    const numero = Number(valor);

    if (
        !Number.isSafeInteger(numero) ||
        numero < 1
    ) {
        return padrao;
    }

    return Math.min(
        numero,
        maximo
    );
}

function normalizarContador(valor) {
    const numero = Number(valor);

    if (
        !Number.isSafeInteger(numero) ||
        numero < 0
    ) {
        return 0;
    }

    return numero;
}

// ==========================================
// AGUARDAR ENTRADAS PRÓXIMAS
// ==========================================

function aguardar(milissegundos) {
    return new Promise(resolve => {
        setTimeout(
            resolve,
            milissegundos
        );
    });
}

// ==========================================
// FILA POR SERVIDOR
// ==========================================

// Serializa as consultas e gravações
// realizadas por entradas de membros.
//
// Evita que duas entradas atualizem
// a mesma captura simultaneamente.
//
// Funciona dentro de um único
// processo Node.js do bot.

async function executarEmFila(
    servidorId,
    tarefa
) {
    const servidor =
        validarIdDiscord(
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
// REVISÃO DA CAPTURA
// ==========================================

function obterRevisao(servidorId) {
    return (
        REVISOES_SERVIDORES.get(
            String(servidorId)
        ) || 0
    );
}

function incrementarRevisao(
    servidorId
) {
    const servidor =
        String(servidorId);

    REVISOES_SERVIDORES.set(
        servidor,
        obterRevisao(servidor) + 1
    );
}

// ==========================================
// CONTROLAR ENTRADAS PRÓXIMAS
// ==========================================

// Se duas entradas forem detectadas
// em um intervalo muito pequeno,
// não presumimos a ordem de uso
// dos convites.
//
// Esse controle reduz erros,
// mas não garante identificação
// em todos os cenários.
//
// O Discord não vincula diretamente
// o convite ao evento de entrada.

function registrarProximidadeEntrada(
    servidorId
) {
    const servidor =
        String(servidorId);

    const agora =
        Date.now();

    const anterior =
        ENTRADAS_RECENTES.get(
            servidor
        ) || {
            ultimaEntradaEm: 0,
            riscoAte: 0
        };

    if (
        agora -
        anterior.ultimaEntradaEm <=
        JANELA_PROXIMIDADE_MS
    ) {
        anterior.riscoAte =
            agora + DURACAO_RISCO_MS;
    }

    anterior.ultimaEntradaEm =
        agora;

    ENTRADAS_RECENTES.set(
        servidor,
        anterior
    );
}

function existeProximidadeAmbigua(
    servidorId
) {
    const dados =
        ENTRADAS_RECENTES.get(
            String(servidorId)
        );

    return Boolean(
        dados &&
        Date.now() <
        dados.riscoAte
    );
}

// ==========================================
// CONTROLAR CONVITES REMOVIDOS
// ==========================================

// Um convite pode desaparecer após
// atingir seu limite de usos.
//
// A exclusão também pode ocorrer
// manualmente ou por expiração.
//
// Por isso, o desaparecimento
// isolado não confirma quem
// utilizou aquele link.

function registrarRemocaoRecente(
    servidorId,
    codigo
) {
    const servidor =
        String(servidorId);

    let registros =
        REMOCOES_RECENTES.get(
            servidor
        );

    if (!registros) {
        registros = new Map();

        REMOCOES_RECENTES.set(
            servidor,
            registros
        );
    }

    registros.set(
        codigo,
        Date.now()
    );
}

function existemRemocoesRecentes(
    servidorId
) {
    const servidor =
        String(servidorId);

    const registros =
        REMOCOES_RECENTES.get(
            servidor
        );

    if (!registros) {
        return false;
    }

    const agora =
        Date.now();

    for (
        const [codigo, momento]
        of registros
    ) {
        if (
            agora - momento >
            JANELA_REMOCAO_MS
        ) {
            registros.delete(
                codigo
            );
        }
    }

    if (!registros.size) {
        REMOCOES_RECENTES.delete(
            servidor
        );

        return false;
    }

    return true;
}

// ==========================================
// NORMALIZAR CONVITE DO DISCORD
// ==========================================

function normalizarConvite(
    convite
) {
    if (!convite?.code) {
        throw new Error(
            'Convite do Discord inválido.'
        );
    }

    return {
        codigo:
            validarCodigo(
                convite.code
            ),

        convidadorId:
            idOpcional(
                convite.inviter?.id
            ),

        canalId:
            idOpcional(
                convite.channelId ||
                convite.channel?.id
            ),

        usos:
            normalizarContador(
                convite.uses
            ),

        usosMaximos:
            normalizarContador(
                convite.maxUses
            )
    };
}

// ==========================================
// BUSCAR CONVITES DO DISCORD
// ==========================================

// Normalmente o bot precisa da
// permissão "Gerenciar Servidor".
//
// O intent GuildInvites também
// deve estar habilitado no index.js.
//
// Uma falha na consulta nunca
// será interpretada como ausência
// de convites.

async function buscarConvitesDiscord(
    guild
) {
    if (!guild?.id) {
        throw new Error(
            'Servidor não informado.'
        );
    }

    const colecao =
        await guild.invites.fetch();

    return Array.from(
        colecao.values()
    ).map(
        normalizarConvite
    );
}

// ==========================================
// SALVAR CAPTURA NO SQLITE
// ==========================================

// Os códigos que desapareceram
// ficam inativos.
//
// Seus registros continuam
// preservados no banco.
//
// A captura substitui somente
// os contadores observados.
//
// Não altera o histórico de
// entradas de membros.

function salvarCapturaConvites(
    servidorId,
    convites
) {
    const servidor =
        validarIdDiscord(
            servidorId,
            'Servidor'
        );

    if (
        !Array.isArray(
            convites
        )
    ) {
        throw new Error(
            'Lista de convites inválida.'
        );
    }

    const resultado = db.transaction(
        () => {
            SQL.desativarCodigos.run(
                servidor
            );

            for (
                const convite
                of convites
            ) {
                SQL.salvarCodigo.run(
                    servidor,

                    convite.codigo,

                    convite.convidadorId,

                    convite.canalId,

                    convite.usos,

                    convite.usosMaximos
                );
            }

            SQL.marcarInicializado.run(
                servidor
            );

            return {
                servidorId:
                    servidor,

                quantidade:
                    convites.length,

                inicializado: true
            };
        }
    )();

    incrementarRevisao(
        servidor
    );

    return resultado;
}

// ==========================================
// INVALIDAR BASE DESATUALIZADA
// ==========================================

// Se uma entrada acontecer enquanto
// o Discord não permite consultar
// os convites, não sabemos quantos
// usos ocorreram.
//
// A base é invalidada até que
// seja possível obter uma nova
// captura completa.
//
// Isso impede atribuir o incremento
// de uma entrada antiga a uma pessoa
// que entrar depois.
//
// Não apaga códigos ou históricos.
// Apenas remove o marcador de
// captura confiável.

function invalidarBaseConvites(
    servidorId
) {
    const servidor =
        validarIdDiscord(
            servidorId,
            'Servidor'
        );

    SQL.invalidarEstado.run(
        servidor
    );

    incrementarRevisao(
        servidor
    );
}

// ==========================================
// SINCRONIZAR SERVIDOR
// ==========================================

// Chamado no início pelo index.js.
//
// Primeiro busca a lista completa
// no Discord.
//
// Somente após sucesso atualiza
// a captura no SQLite.
//
// Se falhar, mantém os códigos
// salvos, mas invalida a referência
// de comparação.
//
// A primeira captura após iniciar
// serve como ponto de partida;
// ela não atribui entradas antigas.

async function sincronizarConvitesGuild(
    guild
) {
    if (!guild?.id) {
        throw new Error(
            'Servidor não informado.'
        );
    }

    return executarEmFila(
        guild.id,
        async () => {
            let convites;

            try {
                convites =
                    await buscarConvitesDiscord(
                        guild
                    );

            } catch (erro) {
                invalidarBaseConvites(
                    guild.id
                );

                throw erro;
            }

            return salvarCapturaConvites(
                guild.id,
                convites
            );
        }
    );
}

// ==========================================
// BUSCAR CONVITE SALVO
// ==========================================

function buscarConvite(
    servidorId,
    codigo
) {
    return SQL.buscarCodigo.get(
        validarIdDiscord(
            servidorId,
            'Servidor'
        ),

        validarCodigo(
            codigo
        )
    ) || null;
}

// ==========================================
// REGISTRAR CONVITE CRIADO
// ==========================================

// Chamado pelo inviteCreate.js.
//
// Criar um link não conta como
// entrada de membro.
//
// Se o Discord não informar o
// criador, ele fica desconhecido.
//
// A função não inventa um
// responsável pelo convite.

function registrarConviteCriado(
    convite
) {
    const servidor =
        validarIdDiscord(
            convite?.guild?.id,
            'Servidor'
        );

    const dados =
        normalizarConvite(
            convite
        );

    SQL.salvarCodigo.run(
        servidor,
        dados.codigo,
        dados.convidadorId,
        dados.canalId,
        dados.usos,
        dados.usosMaximos
    );

    incrementarRevisao(
        servidor
    );

    return buscarConvite(
        servidor,
        dados.codigo
    );
}

// ==========================================
// REGISTRAR CONVITE REMOVIDO
// ==========================================

// Chamado pelo inviteDelete.js.
//
// O registro continua salvo,
// mas o código fica inativo.
//
// Um convite removido pode ter
// expirado ou atingido o limite
// de usos.
//
// Não assumimos que houve
// uma entrada de membro.

function registrarConviteExcluido(
    convite
) {
    const servidor =
        validarIdDiscord(
            convite?.guild?.id,
            'Servidor'
        );

    const codigo =
        validarCodigo(
            convite?.code
        );

    const resultado =
        SQL.excluirCodigo.run(
            servidor,
            codigo
        );

    registrarRemocaoRecente(
        servidor,
        codigo
    );

    incrementarRevisao(
        servidor
    );

    return {
        servidorId:
            servidor,

        codigo,

        atualizado:
            resultado.changes > 0
    };
}

// ==========================================
// RESPOSTA DE IDENTIFICAÇÃO
// ==========================================

function resultadoIdentificacao(
    status,
    observacao,
    codigo = null,
    convidadorId = null
) {
    return {
        status,
        codigo,
        convidadorId,
        observacao
    };
}

// ==========================================
// IDENTIFICAR CONVITE UTILIZADO
// ==========================================

// Compara os contadores anteriores
// com os contadores atuais.
//
// Só confirma quando:
//
// 1. Havia captura anterior.
// 2. Um único código conhecido
//    aumentou exatamente um uso.
// 3. Nenhum outro código mostrou
//    um incremento.
// 4. Nenhum link relevante
//    desapareceu durante a captura.
// 5. Nenhuma mudança inesperada
//    foi identificada.
// 6. O criador está identificado.
// 7. O membro não é o próprio criador.
//
// Se a comparação estiver ambígua,
// o resultado NÃO será confirmado.
//
// Esta função não consegue provar
// uma relação individual que o
// Discord não fornece. Ela apenas
// aceita um cenário de incremento
// único e sem conflitos conhecidos.

function identificarConviteUtilizado(
    antigos,
    atuais,
    membroId = null
) {
    const anteriores =
        new Map();

    for (
        const anterior
        of antigos || []
    ) {
        if (
            Number(
                anterior.ativo ?? 1
            ) !== 1
        ) {
            continue;
        }

        anteriores.set(
            anterior.codigo,
            anterior
        );
    }

    const atuaisMapa =
        new Map();

    for (
        const atual
        of atuais || []
    ) {
        atuaisMapa.set(
            atual.codigo,
            atual
        );
    }

    const candidatos = [];

    const desaparecidos = [];

    const alteracoesInesperadas = [];

    // ======================================
    // COMPARAR CONVITES ANTIGOS
    // ======================================

    for (
        const [codigo, anterior]
        of anteriores
    ) {
        const atual =
            atuaisMapa.get(
                codigo
            );

        if (!atual) {
            desaparecidos.push(
                anterior
            );

            continue;
        }

        const usosAntigos =
            normalizarContador(
                anterior.usos
            );

        const usosAtuais =
            normalizarContador(
                atual.usos
            );

        const diferenca =
            usosAtuais - usosAntigos;

        if (diferenca < 0) {
            alteracoesInesperadas.push(
                codigo
            );

            continue;
        }

        if (diferenca > 0) {
            candidatos.push({
                codigo,

                diferenca,

                convidadorId:
                    atual.convidadorId ||
                    anterior.convidador_id ||
                    null
            });
        }
    }

    // ======================================
    // CONVITES NOVOS COM USOS
    // ======================================

    // Um código pode ter sido criado
    // e utilizado entre duas capturas.
    //
    // Nesse caso, não sabemos
    // quando seus usos aconteceram.

    for (
        const atual
        of atuais || []
    ) {
        if (
            anteriores.has(
                atual.codigo
            )
        ) {
            continue;
        }

        if (
            normalizarContador(
                atual.usos
            ) > 0
        ) {
            alteracoesInesperadas.push(
                atual.codigo
            );
        }
    }

    // ======================================
    // CONVITES DESAPARECIDOS
    // ======================================

    // Especialmente importante
    // para links de uso único.
    //
    // O desaparecimento pode
    // significar utilização,
    // expiração ou remoção manual.
    //
    // Portanto, não confirma
    // uma atribuição.

    if (desaparecidos.length) {
        return resultadoIdentificacao(
            STATUS_ENTRADA.AMBIGUO,

            'Um ou mais convites desapareceram ' +
            'entre as capturas. Pode ter ocorrido ' +
            'uso único, expiração ou exclusão.'
        );
    }

    // ======================================
    // ALTERAÇÕES INESPERADAS
    // ======================================

    if (
        alteracoesInesperadas.length
    ) {
        return resultadoIdentificacao(
            STATUS_ENTRADA.AMBIGUO,

            'A captura contém códigos novos com ' +
            'usos ou alterações incompatíveis ' +
            'com uma comparação segura.'
        );
    }

    // ======================================
    // MAIS DE UM INCREMENTO
    // ======================================

    if (
        candidatos.length > 1
    ) {
        return resultadoIdentificacao(
            STATUS_ENTRADA.AMBIGUO,

            'Mais de um convite apresentou ' +
            'incremento de uso.'
        );
    }

    // ======================================
    // NENHUM INCREMENTO
    // ======================================

    if (!candidatos.length) {
        return resultadoIdentificacao(
            STATUS_ENTRADA.NAO_IDENTIFICADO,

            'Nenhum incremento de convite foi ' +
            'identificado. A entrada pode ter ' +
            'ocorrido por link personalizado, ' +
            'convite expirado ou outra origem.'
        );
    }

    const candidato =
        candidatos[0];

    // ======================================
    // MAIS DE UM USO
    // ======================================

    if (
        candidato.diferenca !== 1
    ) {
        return resultadoIdentificacao(
            STATUS_ENTRADA.AMBIGUO,

            'O convite ganhou mais de um uso ' +
            'entre as capturas.'
        );
    }

    // ======================================
    // CRIADOR DESCONHECIDO
    // ======================================

    if (
        !idOpcional(
            candidato.convidadorId
        )
    ) {
        return resultadoIdentificacao(
            STATUS_ENTRADA.NAO_IDENTIFICADO,

            'O convite apresentou um uso, mas ' +
            'o criador não foi identificado.',

            candidato.codigo
        );
    }

    // ======================================
    // NÃO ATRIBUIR AO PRÓPRIO MEMBRO
    // ======================================

    if (
        candidato.convidadorId ===
        membroId
    ) {
        return resultadoIdentificacao(
            STATUS_ENTRADA.NAO_IDENTIFICADO,

            'O criador registrado coincide com ' +
            'o próprio membro que entrou.',

            candidato.codigo
        );
    }

    // ======================================
    // INCREMENTO ÚNICO
    // ======================================

    return resultadoIdentificacao(
        STATUS_ENTRADA.CONFIRMADO,

        'Um único incremento de uso foi ' +
        'identificado em um convite conhecido, ' +
        'sem conflitos na captura.',

        candidato.codigo,

        candidato.convidadorId
    );
}

// ==========================================
// REGISTRAR ENTRADA NO SQLITE
// ==========================================

// Cada membro tem apenas um
// registro de entrada por servidor.
//
// Isso impede que sair e voltar
// várias vezes aumente o ranking.
//
// Não removemos nem sobrescrevemos
// uma atribuição antiga.
//
// Entradas já registradas
// continuam preservadas.

function salvarEntradaMembro({
    servidorId,
    membroId,
    status,
    codigo = null,
    convidadorId = null,
    observacao = ''
}) {
    const servidor =
        validarIdDiscord(
            servidorId,
            'Servidor'
        );

    const membro =
        validarIdDiscord(
            membroId,
            'Membro'
        );

    if (
        !Object.values(
            STATUS_ENTRADA
        ).includes(status)
    ) {
        throw new Error(
            'Status de entrada inválido.'
        );
    }

    const resultado =
        SQL.inserirEntrada.run(
            servidor,

            membro,

            idOpcional(
                convidadorId
            ),

            codigo
                ? validarCodigo(codigo)
                : null,

            status,

            String(
                observacao || ''
            ).slice(0, 400)
        );

    return {
        novo:
            resultado.changes === 1,

        registro:
            SQL.buscarEntrada.get(
                servidor,
                membro
            )
    };
}

// ==========================================
// CONVERTER RESULTADO PARA O EVENTO
// ==========================================

// Formato utilizado pelo:
//
// events/guildMemberAdd.js

function criarResultadoEntrada(
    salvo
) {
    const registro =
        salvo.registro;

    return {
        novo:
            salvo.novo,

        status:
            registro.status,

        convidadorId:
            registro.convidador_id,

        codigo:
            registro.codigo,

        observacao:
            registro.observacao,

        registro
    };
}

// ==========================================
// PROCESSAR ENTRADA DE NOVO MEMBRO
// ==========================================

// Chamado por:
//
// events/guildMemberAdd.js
//
// Fluxo:
//
// 1. Detecta entrada no servidor.
// 2. Aguarda a pequena janela.
// 3. Entra na fila do servidor.
// 4. Consulta a captura anterior.
// 5. Busca os convites no Discord.
// 6. Analisa incrementos e conflitos.
// 7. Salva a entrada no SQLite.
// 8. Atualiza a captura de convites.
//
// Uma falha da API invalida a base,
// impedindo atribuições posteriores
// com uma captura desatualizada.

async function processarEntradaMembro(
    membro
) {
    const guild =
        membro?.guild;

    if (!guild?.id) {
        throw new Error(
            'Servidor do membro não encontrado.'
        );
    }

    const servidorId =
        validarIdDiscord(
            guild.id,
            'Servidor'
        );

    const membroId =
        validarIdDiscord(
            membro.id,
            'Membro'
        );

    // ======================================
    // DETECTAR ENTRADAS PRÓXIMAS
    // ======================================

    const jaRegistrado =
        SQL.buscarEntrada.get(
            servidorId,
            membroId
        );

    if (!jaRegistrado) {
        registrarProximidadeEntrada(
            servidorId
        );

        // As esperas acontecem antes
        // da fila, para que entradas
        // próximas não sejam forçadas
        // a aguardar uma pela outra.

        await aguardar(
            ESPERA_ENTRADA_MS
        );
    }

    // ======================================
    // FILA POR SERVIDOR
    // ======================================

    return executarEmFila(
        servidorId,
        async () => {
            const existente =
                SQL.buscarEntrada.get(
                    servidorId,
                    membroId
                );

            const inicializado =
                Boolean(
                    SQL.estado.get(
                        servidorId
                    )
                );

            // ==================================
            // CAPTURA ANTERIOR
            // ==================================

            const antigos =
                SQL.listarCodigos.all(
                    servidorId
                ).filter(
                    item =>
                        Number(item.ativo) === 1
                );

            const revisaoInicial =
                obterRevisao(
                    servidorId
                );

            // ==================================
            // BUSCAR CAPTURA ATUAL
            // ==================================

            let atuais;

            try {
                atuais =
                    await buscarConvitesDiscord(
                        guild
                    );

            } catch (erro) {
                console.warn(
                    '[InovareSale | Convites] ' +
                    `Não foi possível consultar ` +
                    `os convites de ${servidorId}:`,
                    erro.message
                );

                // Se o membro já possuía
                // uma entrada registrada,
                // o histórico original
                // não é alterado.

                invalidarBaseConvites(
                    servidorId
                );

                if (existente) {
                    return criarResultadoEntrada({
                        novo: false,

                        registro:
                            existente
                    });
                }

                const salvo =
                    salvarEntradaMembro({
                        servidorId,
                        membroId,

                        status:
                            STATUS_ENTRADA.SEM_ACESSO,

                        observacao:
                            'Não foi possível consultar os ' +
                            'convites do Discord. A base ' +
                            'de comparação foi invalidada.'
                    });

                return criarResultadoEntrada(
                    salvo
                );
            }

            // ==================================
            // VERIFICAR MUDANÇA DURANTE CONSULTA
            // ==================================

            const baseAlterada =
                obterRevisao(
                    servidorId
                ) !== revisaoInicial;

            // ==================================
            // REGISTRO ANTIGO
            // ==================================

            // Um membro que retornou ao
            // servidor não deve ganhar
            // uma segunda atribuição.
            //
            // Atualizamos a captura para
            // manter os contadores em dia,
            // mas preservamos a primeira
            // entrada registrada.

            if (existente) {
                salvarCapturaConvites(
                    servidorId,
                    atuais
                );

                return criarResultadoEntrada({
                    novo: false,

                    registro:
                        existente
                });
            }

            // ==================================
            // IDENTIFICAÇÃO DO CONVITE
            // ==================================

            let identificacao;

            if (!inicializado) {
                identificacao =
                    resultadoIdentificacao(
                        STATUS_ENTRADA.SEM_BASE,

                        'A captura anterior não estava ' +
                        'disponível. Esta entrada não ' +
                        'pode receber uma atribuição segura.'
                    );

            } else if (
                baseAlterada
            ) {
                identificacao =
                    resultadoIdentificacao(
                        STATUS_ENTRADA.AMBIGUO,

                        'A lista de convites mudou ' +
                        'durante a consulta.'
                    );

            } else if (
                existeProximidadeAmbigua(
                    servidorId
                )
            ) {
                identificacao =
                    resultadoIdentificacao(
                        STATUS_ENTRADA.AMBIGUO,

                        'Entradas muito próximas foram ' +
                        'detectadas. A ordem de utilização ' +
                        'dos convites não pôde ser confirmada.'
                    );

            } else if (
                existemRemocoesRecentes(
                    servidorId
                )
            ) {
                identificacao =
                    resultadoIdentificacao(
                        STATUS_ENTRADA.AMBIGUO,

                        'Um convite foi removido ou expirou ' +
                        'recentemente. Pode ter sido um ' +
                        'convite de uso único.'
                    );

            } else {
                identificacao =
                    identificarConviteUtilizado(
                        antigos,
                        atuais,
                        membroId
                    );
            }

            // ==================================
            // SALVAR ENTRADA E CAPTURA
            // ==================================

            // As duas operações são
            // incluídas na mesma transação.
            //
            // Se a gravação da captura
            // falhar, a entrada não
            // fica parcialmente registrada.

            const salvo =
                db.transaction(() => {
                    const entrada =
                        salvarEntradaMembro({
                            servidorId,
                            membroId,

                            ...identificacao
                        });

                    salvarCapturaConvites(
                        servidorId,
                        atuais
                    );

                    return entrada;
                })();

            return criarResultadoEntrada(
                salvo
            );
        }
    );
}

// ==========================================
// LISTAR HISTÓRICO DE ENTRADAS
// ==========================================

function listarEntradasConvites(
    servidorId,
    limite = LIMITE_HISTORICO
) {
    return SQL.listarEntradas.all(
        validarIdDiscord(
            servidorId,
            'Servidor'
        ),

        validarLimite(
            limite,
            LIMITE_HISTORICO
        )
    );
}

// ==========================================
// RANKING DE CONVITES
// ==========================================

// Apenas entradas confirmadas.
//
// Entradas ambíguas, sem acesso,
// sem base ou não identificadas
// não aumentam o ranking.
//
// Cada membro pode contribuir
// no máximo uma vez ao ranking,
// graças à restrição UNIQUE.

function obterRankingConvites(
    servidorId,
    limite = LIMITE_RANKING
) {
    const linhas =
        SQL.ranking.all(
            validarIdDiscord(
                servidorId,
                'Servidor'
            ),

            validarLimite(
                limite,
                LIMITE_RANKING
            )
        );

    return linhas.map(
        (linha, indice) => ({
            posicao:
                indice + 1,

            convidadorId:
                linha.convidador_id,

            total:
                Number(
                    linha.total || 0
                )
        })
    );
}

// ==========================================
// ESTATÍSTICAS DE CONVITES
// ==========================================

function obterEstatisticasConvites(
    servidorId
) {
    const servidor =
        validarIdDiscord(
            servidorId,
            'Servidor'
        );

    const resumo =
        SQL.estatisticas.get(
            servidor
        );

    const links =
        SQL.quantidadeLinks.get(
            servidor
        );

    const inicializado =
        Boolean(
            SQL.estado.get(
                servidor
            )
        );

    return {
        inicializado,

        totalEntradas:
            Number(
                resumo?.total || 0
            ),

        convitesConfirmados:
            Number(
                resumo?.confirmados || 0
            ),

        entradasNaoIdentificadas:
            Number(
                resumo?.naoIdentificados || 0
            ),

        linksAtivos:
            Number(
                links?.total || 0
            ),

        ranking:
            obterRankingConvites(
                servidor,
                10
            )
    };
}

// ==========================================
// RESUMO PARA O STATUS DO BOT
// ==========================================

// Utilizado pelo:
//
// services/statusService.js
//
// Mostra somente atribuições
// de convite confirmadas.
//
// Os demais registros ficam
// separados para não distorcer
// as estatísticas.

function obterResumoConvites(
    servidorId
) {
    const dados =
        obterEstatisticasConvites(
            servidorId
        );

    if (
        !dados.inicializado
    ) {
        return {
            disponivel: false,

            quantidade: null,

            descricao:
                'Aguardando captura confiável de convites',

            linksAtivos: null,

            naoIdentificados:
                dados.entradasNaoIdentificadas
        };
    }

    return {
        disponivel: true,

        quantidade:
            dados.convitesConfirmados,

        descricao:
            `${dados.convitesConfirmados} ` +
            'convite(s) confirmado(s)',

        linksAtivos:
            dados.linksAtivos,

        naoIdentificados:
            dados.entradasNaoIdentificadas
    };
}

// ==========================================
// EXPORTAÇÕES
// ==========================================

// Mantemos todas as exportações
// utilizadas pelos eventos existentes:
//
// - guildMemberAdd.js
// - inviteCreate.js
// - inviteDelete.js
// - index.js
// - statusService.js

module.exports = {
    STATUS_ENTRADA,

    buscarConvitesDiscord,

    sincronizarConvitesGuild,

    buscarConvite,

    registrarConviteCriado,

    registrarConviteExcluido,

    identificarConviteUtilizado,

    processarEntradaMembro,

    listarEntradasConvites,

    obterRankingConvites,

    obterEstatisticasConvites,

    obterResumoConvites
};
