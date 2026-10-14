
'use strict';

const { db } = require('../database/db');
const { registrarLogSistema, TIPOS_LOG } = require('./logsService');

const TIPOS = Object.freeze({
    BAN: 'ban',
    UNBAN: 'unban',
    WARN: 'warn',
    UNWARN: 'unwarn',
    TIMEOUT: 'timeout',
    UNTIMEOUT: 'untimeout'
});

const LIMITE_TIMEOUT_SEGUNDOS = 28 * 24 * 60 * 60;
const LIMITE_HISTORICO = 100;

db.exec(`
    CREATE TABLE IF NOT EXISTS moderacao_acoes_v3 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        servidor_id TEXT NOT NULL,
        tipo TEXT NOT NULL CHECK (tipo IN ('ban', 'unban', 'warn', 'unwarn', 'timeout', 'untimeout')),
        moderador_id TEXT NOT NULL,
        usuario_id TEXT NOT NULL,
        motivo TEXT NOT NULL DEFAULT 'Não informado',
        duracao_segundos INTEGER,
        advertencia_origem_id INTEGER,
        advertencia_ativa INTEGER CHECK (advertencia_ativa IS NULL OR advertencia_ativa IN (0, 1)),
        chave_evento TEXT,
        criado_em INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE (servidor_id, chave_evento)
    );
    CREATE INDEX IF NOT EXISTS idx_moderacao_servidor_v3
        ON moderacao_acoes_v3 (servidor_id, id);
    CREATE INDEX IF NOT EXISTS idx_moderacao_usuario_v3
        ON moderacao_acoes_v3 (servidor_id, usuario_id, id);
    CREATE INDEX IF NOT EXISTS idx_moderacao_tipo_v3
        ON moderacao_acoes_v3 (servidor_id, tipo);
    CREATE INDEX IF NOT EXISTS idx_moderacao_advertencias_v3
        ON moderacao_acoes_v3 (servidor_id, usuario_id, advertencia_ativa)
        WHERE tipo = 'warn';
    CREATE INDEX IF NOT EXISTS idx_moderacao_ranking_periodo_v3
        ON moderacao_acoes_v3 (servidor_id, criado_em, moderador_id, tipo)
        WHERE tipo IN ('warn', 'ban');
`);

const SQL = {
    buscar: db.prepare(`
        SELECT * FROM moderacao_acoes_v3
        WHERE id = ? AND servidor_id = ?
    `),
    buscarChave: db.prepare(`
        SELECT * FROM moderacao_acoes_v3
        WHERE servidor_id = ? AND chave_evento = ?
    `),
    inserir: db.prepare(`
        INSERT INTO moderacao_acoes_v3 (
            servidor_id, tipo, moderador_id, usuario_id, motivo,
            duracao_segundos, advertencia_origem_id, advertencia_ativa,
            chave_evento, criado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    removerAdvertencia: db.prepare(`
        UPDATE moderacao_acoes_v3
        SET advertencia_ativa = 0
        WHERE id = ? AND servidor_id = ? AND tipo = 'warn' AND advertencia_ativa = 1
    `),
    buscarRemocao: db.prepare(`
        SELECT * FROM moderacao_acoes_v3
        WHERE servidor_id = ? AND tipo = 'unwarn' AND advertencia_origem_id = ?
        ORDER BY id DESC LIMIT 1
    `),
    listarHistorico: db.prepare(`
        SELECT * FROM moderacao_acoes_v3
        WHERE servidor_id = ?
          AND (? IS NULL OR usuario_id = ?)
          AND (? IS NULL OR id < ?)
        ORDER BY id DESC LIMIT ?
    `),
    listarAdvertencias: db.prepare(`
        SELECT * FROM moderacao_acoes_v3
        WHERE servidor_id = ? AND usuario_id = ?
          AND tipo = 'warn' AND advertencia_ativa = 1
        ORDER BY id DESC LIMIT ?
    `),
    estatisticas: db.prepare(`
        SELECT COUNT(*) AS total_acoes,
            COALESCE(SUM(CASE WHEN tipo = 'ban' THEN 1 ELSE 0 END), 0) AS bans,
            COALESCE(SUM(CASE WHEN tipo = 'unban' THEN 1 ELSE 0 END), 0) AS unbans,
            COALESCE(SUM(CASE WHEN tipo = 'warn' THEN 1 ELSE 0 END), 0) AS warns,
            COALESCE(SUM(CASE WHEN tipo = 'warn' AND advertencia_ativa = 1 THEN 1 ELSE 0 END), 0) AS advertencias_ativas,
            COALESCE(SUM(CASE WHEN tipo = 'unwarn' THEN 1 ELSE 0 END), 0) AS unwarns,
            COALESCE(SUM(CASE WHEN tipo = 'timeout' THEN 1 ELSE 0 END), 0) AS timeouts,
            COALESCE(SUM(CASE WHEN tipo = 'untimeout' THEN 1 ELSE 0 END), 0) AS untimeouts
        FROM moderacao_acoes_v3 WHERE servidor_id = ?
    `),
    rankingPeriodo: db.prepare(`
        SELECT moderador_id,
            SUM(CASE WHEN tipo = 'warn' THEN 1 ELSE 0 END) AS warns,
            SUM(CASE WHEN tipo = 'ban' THEN 1 ELSE 0 END) AS bans,
            COUNT(*) AS total_acoes
        FROM moderacao_acoes_v3
        WHERE servidor_id = ? AND criado_em >= ? AND criado_em < ?
          AND tipo IN ('warn', 'ban')
        GROUP BY moderador_id
        ORDER BY total_acoes DESC, bans DESC, warns DESC, moderador_id ASC
        LIMIT ?
    `),
    funcionarioPeriodo: db.prepare(`
        SELECT
            COALESCE(SUM(CASE WHEN tipo = 'warn' THEN 1 ELSE 0 END), 0) AS warns,
            COALESCE(SUM(CASE WHEN tipo = 'ban' THEN 1 ELSE 0 END), 0) AS bans,
            COUNT(*) AS total_acoes
        FROM moderacao_acoes_v3
        WHERE servidor_id = ? AND moderador_id = ?
          AND criado_em >= ? AND criado_em < ?
          AND tipo IN ('warn', 'ban')
    `)
};

function validarIdDiscord(valor, nome = 'ID') {
    const id = String(valor ?? '').trim();
    if (!/^\d{15,22}$/.test(id)) throw new Error(`${nome} inválido.`);
    return id;
}

function validarCasoId(valor) {
    const id = Number(valor);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error('ID do caso de moderação inválido.');
    }
    return id;
}

function validarTipo(tipo) {
    const texto = String(tipo ?? '').trim().toLowerCase();
    if (!Object.values(TIPOS).includes(texto)) {
        throw new Error('Tipo de moderação inválido.');
    }
    return texto;
}

function validarMotivo(valor) {
    const motivo = String(valor ?? '').replace(/\u0000/g, '').trim();
    if (!motivo) return 'Não informado';
    if (motivo.length > 1000) {
        throw new Error('O motivo deve ter no máximo 1.000 caracteres.');
    }
    return motivo;
}

function validarChaveEvento(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    const chave = String(valor).trim();
    if (chave.length < 1 || chave.length > 150) {
        throw new Error('Chave de evento inválida.');
    }
    return chave;
}

function validarDuracaoTimeout(valor) {
    const segundos = Number(valor);
    if (!Number.isSafeInteger(segundos) || segundos < 1 || segundos > LIMITE_TIMEOUT_SEGUNDOS) {
        throw new Error('O timeout deve ter duração entre 1 segundo e 28 dias.');
    }
    return segundos;
}

function validarLimite(valor, padrao = 20) {
    const numero = Number(valor);
    if (!Number.isSafeInteger(numero) || numero < 1) return padrao;
    return Math.min(numero, LIMITE_HISTORICO);
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
        throw new Error('Período inválido. Informe início e fim em segundos Unix.');
    }
    return { inicio, fim };
}

function formatarDuracaoPunicao(segundos) {
    const total = Math.max(0, Math.floor(Number(segundos) || 0));
    const dias = Math.floor(total / 86400);
    const horas = Math.floor((total % 86400) / 3600);
    const minutos = Math.floor((total % 3600) / 60);
    const partes = [];
    if (dias) partes.push(`${dias}d`);
    if (horas) partes.push(`${horas}h`);
    if (minutos) partes.push(`${minutos}min`);
    if (!partes.length) partes.push(`${total}s`);
    return partes.join(' ');
}

function buscarCasoModeracao(servidorId, casoId) {
    return SQL.buscar.get(
        validarCasoId(casoId),
        validarIdDiscord(servidorId, 'Servidor')
    ) || null;
}

function verificarCasoRepetido(servidorId, chave, tipo, moderadorId, usuarioId) {
    if (!chave) return null;
    const existente = SQL.buscarChave.get(servidorId, chave);
    if (!existente) return null;
    if (
        existente.tipo !== tipo ||
        existente.moderador_id !== moderadorId ||
        existente.usuario_id !== usuarioId
    ) {
        throw new Error('Esta chave de evento já pertence a outra ação de moderação.');
    }
    return existente;
}

function inserirCaso({
    servidorId, tipo, moderadorId, usuarioId, motivo,
    duracaoSegundos = null, advertenciaOrigemId = null,
    advertenciaAtiva = null, chaveEvento = null
}) {
    const resultado = SQL.inserir.run(
        servidorId, tipo, moderadorId, usuarioId, motivo,
        duracaoSegundos, advertenciaOrigemId, advertenciaAtiva,
        chaveEvento, Math.floor(Date.now() / 1000)
    );
    const caso = buscarCasoModeracao(servidorId, Number(resultado.lastInsertRowid));
    if (!caso) throw new Error('Não foi possível recuperar o caso de moderação salvo.');
    return caso;
}

function registrarAcaoModeracao({
    servidorId, tipo, moderadorId, usuarioId,
    motivo = 'Não informado', duracaoSegundos = null,
    chaveEvento = null
}) {
    const servidor = validarIdDiscord(servidorId, 'Servidor');
    const moderador = validarIdDiscord(moderadorId, 'Moderador');
    const usuario = validarIdDiscord(usuarioId, 'Usuário');
    const tipoFinal = validarTipo(tipo);
    if (tipoFinal === TIPOS.WARN || tipoFinal === TIPOS.UNWARN) {
        throw new Error('Para advertências, utilize registrarAdvertencia() ou removerAdvertencia().');
    }
    const motivoFinal = validarMotivo(motivo);
    const duracaoFinal = tipoFinal === TIPOS.TIMEOUT
        ? validarDuracaoTimeout(duracaoSegundos)
        : null;
    const chave = validarChaveEvento(chaveEvento);
    return db.transaction(() => {
        const existente = verificarCasoRepetido(
            servidor, chave, tipoFinal, moderador, usuario
        );
        if (existente) return { novo: false, caso: existente };
        const caso = inserirCaso({
            servidorId: servidor,
            tipo: tipoFinal,
            moderadorId: moderador,
            usuarioId: usuario,
            motivo: motivoFinal,
            duracaoSegundos: duracaoFinal,
            chaveEvento: chave
        });
        return { novo: true, caso };
    })();
}

function registrarAdvertencia({
    servidorId, moderadorId, usuarioId,
    motivo = 'Não informado', chaveEvento = null
}) {
    const servidor = validarIdDiscord(servidorId, 'Servidor');
    const moderador = validarIdDiscord(moderadorId, 'Moderador');
    const usuario = validarIdDiscord(usuarioId, 'Usuário');
    const motivoFinal = validarMotivo(motivo);
    const chave = validarChaveEvento(chaveEvento);
    return db.transaction(() => {
        const existente = verificarCasoRepetido(
            servidor, chave, TIPOS.WARN, moderador, usuario
        );
        if (existente) return { novo: false, caso: existente };
        const caso = inserirCaso({
            servidorId: servidor,
            tipo: TIPOS.WARN,
            moderadorId: moderador,
            usuarioId: usuario,
            motivo: motivoFinal,
            advertenciaAtiva: 1,
            chaveEvento: chave
        });
        return { novo: true, caso };
    })();
}

function removerAdvertencia({
    servidorId, advertenciaId, moderadorId,
    motivo = 'Advertência removida', chaveEvento = null
}) {
    const servidor = validarIdDiscord(servidorId, 'Servidor');
    const id = validarCasoId(advertenciaId);
    const moderador = validarIdDiscord(moderadorId, 'Moderador');
    const motivoFinal = validarMotivo(motivo);
    const chave = validarChaveEvento(chaveEvento);
    return db.transaction(() => {
        const advertencia = buscarCasoModeracao(servidor, id);
        if (!advertencia || advertencia.tipo !== TIPOS.WARN) {
            throw new Error('Advertência não encontrada neste servidor.');
        }
        const remocaoAnterior = SQL.buscarRemocao.get(servidor, id);
        if (advertencia.advertencia_ativa !== 1) {
            return {
                novo: false,
                removida: false,
                jaRemovida: true,
                advertencia,
                caso: remocaoAnterior || null
            };
        }
        const eventoAnterior = verificarCasoRepetido(
            servidor, chave, TIPOS.UNWARN, moderador, advertencia.usuario_id
        );
        if (eventoAnterior) {
            if (eventoAnterior.advertencia_origem_id !== id) {
                throw new Error('Esta chave já pertence à remoção de outra advertência.');
            }
            return {
                novo: false,
                removida: false,
                jaRemovida: true,
                advertencia,
                caso: eventoAnterior
            };
        }
        const atualizacao = SQL.removerAdvertencia.run(id, servidor);
        if (atualizacao.changes !== 1) {
            throw new Error('Não foi possível remover a advertência.');
        }
        const caso = inserirCaso({
            servidorId: servidor,
            tipo: TIPOS.UNWARN,
            moderadorId: moderador,
            usuarioId: advertencia.usuario_id,
            motivo: motivoFinal,
            advertenciaOrigemId: id,
            chaveEvento: chave
        });
        return {
            novo: true,
            removida: true,
            jaRemovida: false,
            advertencia: buscarCasoModeracao(servidor, id),
            caso
        };
    })();
}

function listarAdvertenciasAtivas(servidorId, usuarioId, limite = 25) {
    return SQL.listarAdvertencias.all(
        validarIdDiscord(servidorId, 'Servidor'),
        validarIdDiscord(usuarioId, 'Usuário'),
        validarLimite(limite, 25)
    );
}

function listarHistoricoModeracao(servidorId, {
    usuarioId = null,
    ultimoCasoId = null,
    limite = 20
} = {}) {
    const servidor = validarIdDiscord(servidorId, 'Servidor');
    const usuario = usuarioId ? validarIdDiscord(usuarioId, 'Usuário') : null;
    const ultimo = ultimoCasoId ? validarCasoId(ultimoCasoId) : null;
    return SQL.listarHistorico.all(
        servidor, usuario, usuario, ultimo, ultimo, validarLimite(limite, 20)
    );
}

function obterEstatisticasModeracao(servidorId) {
    const servidor = validarIdDiscord(servidorId, 'Servidor');
    const resumo = SQL.estatisticas.get(servidor);
    return {
        totalAcoes: Number(resumo?.total_acoes || 0),
        bans: Number(resumo?.bans || 0),
        unbans: Number(resumo?.unbans || 0),
        warns: Number(resumo?.warns || 0),
        advertenciasAtivas: Number(resumo?.advertencias_ativas || 0),
        unwarns: Number(resumo?.unwarns || 0),
        timeouts: Number(resumo?.timeouts || 0),
        untimeouts: Number(resumo?.untimeouts || 0)
    };
}

function obterResumoModeracao(servidorId) {
    const dados = obterEstatisticasModeracao(servidorId);
    const totalPunicoes = dados.bans + dados.warns + dados.timeouts;
    return {
        disponivel: true,
        quantidade: totalPunicoes,
        descricao: `${totalPunicoes} punição(ões) registrada(s)`,
        banimentos: dados.bans,
        advertencias: dados.warns,
        advertenciasAtivas: dados.advertenciasAtivas,
        timeouts: dados.timeouts,
        acoesTotais: dados.totalAcoes
    };
}

function obterRankingModeracaoPeriodo(servidorId, inicioEm, fimEm, limite = 100) {
    const servidor = validarIdDiscord(servidorId, 'Servidor');
    const { inicio, fim } = validarPeriodo(inicioEm, fimEm);
    return SQL.rankingPeriodo.all(
        servidor, inicio, fim, validarLimite(limite, 100)
    ).map(linha => ({
        moderadorId: linha.moderador_id,
        warns: Number(linha.warns || 0),
        bans: Number(linha.bans || 0),
        totalAcoes: Number(linha.total_acoes || 0)
    }));
}

function obterModeracaoFuncionarioPeriodo(servidorId, moderadorId, inicioEm, fimEm) {
    const servidor = validarIdDiscord(servidorId, 'Servidor');
    const moderador = validarIdDiscord(moderadorId, 'Moderador');
    const { inicio, fim } = validarPeriodo(inicioEm, fimEm);
    const linha = SQL.funcionarioPeriodo.get(servidor, moderador, inicio, fim);
    return {
        moderadorId: moderador,
        warns: Number(linha?.warns || 0),
        bans: Number(linha?.bans || 0),
        totalAcoes: Number(linha?.total_acoes || 0)
    };
}

function obterTipoLog(tipo) {
    const tipos = {
        ban: TIPOS_LOG.BAN,
        unban: TIPOS_LOG.UNBAN,
        warn: TIPOS_LOG.WARN,
        unwarn: TIPOS_LOG.UNWARN,
        timeout: TIPOS_LOG.TIMEOUT,
        untimeout: TIPOS_LOG.UNTIMEOUT
    };
    return tipos[tipo] || 'moderacao_acao';
}

function obterTituloLog(tipo) {
    const titulos = {
        ban: 'Usuário banido',
        unban: 'Banimento removido',
        warn: 'Advertência aplicada',
        unwarn: 'Advertência removida',
        timeout: 'Timeout aplicado',
        untimeout: 'Timeout removido'
    };
    return titulos[tipo] || 'Ação de moderação';
}

function criarDescricaoLogModeracao(caso) {
    const linhas = [
        `**Caso:** #${caso.id}`,
        `**Tipo:** ${caso.tipo}`,
        `**Usuário:** <@${caso.usuario_id}>`,
        `**Moderador:** <@${caso.moderador_id}>`,
        `**Motivo:** ${caso.motivo}`
    ];
    if (caso.tipo === TIPOS.TIMEOUT && caso.duracao_segundos) {
        linhas.push(`**Duração:** ${formatarDuracaoPunicao(caso.duracao_segundos)}`);
    }
    if (caso.advertencia_origem_id) {
        linhas.push(`**Advertência original:** #${caso.advertencia_origem_id}`);
    }
    return linhas.join('\n');
}

async function publicarLogModeracao(guild, caso) {
    if (!guild?.id || !caso) {
        throw new Error('Servidor ou caso de moderação inválido.');
    }
    if (String(guild.id) !== String(caso.servidor_id)) {
        throw new Error('O caso pertence a outro servidor.');
    }
    return registrarLogSistema({
        guild,
        tipo: obterTipoLog(caso.tipo),
        titulo: obterTituloLog(caso.tipo),
        detalhes: criarDescricaoLogModeracao(caso),
        autorId: caso.moderador_id,
        alvoId: caso.usuario_id,
        referencia: `Moderação #${caso.id}`,
        chaveEvento: `moderacao_caso_${caso.id}`
    });
}

async function finalizarRegistroComLog(guild, resultado) {
    if (!resultado?.caso) {
        return {
            ...resultado,
            log: null,
            erroLog: 'Não existe um caso para publicar.'
        };
    }
    try {
        const log = await publicarLogModeracao(guild, resultado.caso);
        return { ...resultado, log, erroLog: null };
    } catch (erro) {
        console.error('[InovareSale | Moderação] Falha ao registrar log:', erro);
        return {
            ...resultado,
            log: null,
            erroLog: 'O caso foi salvo no SQLite, mas o log não pôde ser publicado.'
        };
    }
}

async function registrarAcaoModeracaoComLog({ guild, ...dados }) {
    if (!guild?.id) throw new Error('Servidor não informado.');
    const resultado = registrarAcaoModeracao({ ...dados, servidorId: guild.id });
    return finalizarRegistroComLog(guild, resultado);
}

async function registrarAdvertenciaComLog({ guild, ...dados }) {
    if (!guild?.id) throw new Error('Servidor não informado.');
    const resultado = registrarAdvertencia({ ...dados, servidorId: guild.id });
    return finalizarRegistroComLog(guild, resultado);
}

async function removerAdvertenciaComLog({ guild, ...dados }) {
    if (!guild?.id) throw new Error('Servidor não informado.');
    const resultado = removerAdvertencia({ ...dados, servidorId: guild.id });
    return finalizarRegistroComLog(guild, resultado);
}

module.exports = {
    TIPOS,
    formatarDuracaoPunicao,
    buscarCasoModeracao,
    registrarAcaoModeracao,
    registrarAdvertencia,
    removerAdvertencia,
    listarAdvertenciasAtivas,
    listarHistoricoModeracao,
    obterEstatisticasModeracao,
    obterResumoModeracao,
    obterRankingModeracaoPeriodo,
    obterModeracaoFuncionarioPeriodo,
    publicarLogModeracao,
    registrarAcaoModeracaoComLog,
    registrarAdvertenciaComLog,
    removerAdvertenciaComLog
};
