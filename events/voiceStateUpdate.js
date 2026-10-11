
'use strict';

const {
    Events
} = require('discord.js');

// ==========================================
// INOVARESALE BOT 3.0
// EVENTO DE CANAIS DE VOZ
// ==========================================

// Detecta:
//
// - Funcionário entrando em call
// - Funcionário saindo de call
// - Funcionário mudando de canal
//
// Utiliza o cargo da equipe definido
// na Central Administrativa.
//
// Ignora alterações de microfone,
// áudio, transmissão e câmera.
//
// As sessões são registradas no SQLite
// pelo services/staffService.js.
//
// As atividades são registradas pelo
// services/logsService.js.

// ==========================================
// IMPORTAR SERVIÇO DE EQUIPE
// ==========================================

const {
    processarMudancaVoz,
    formatarTempoVoz
} = require('../services/staffService');

// ==========================================
// IMPORTAR SERVIÇO DE LOGS
// ==========================================

const {
    registrarLogSistema,
    TIPOS_LOG
} = require('../services/logsService');

// ==========================================
// FORMATAR CANAL
// ==========================================

function mencionarCanal(canalId) {
    if (
        !canalId ||
        !/^\d{15,22}$/.test(
            String(canalId)
        )
    ) {
        return 'Nenhum canal';
    }

    return `<#${canalId}>`;
}

// ==========================================
// IDENTIFICAR SESSÃO
// ==========================================

function obterIdSessao(resultado) {
    const id =
        resultado?.sessaoId ||
        resultado?.sessao?.id;

    return Number.isSafeInteger(
        Number(id)
    )
        ? Number(id)
        : null;
}

// ==========================================
// MONTAR REGISTRO DA ATIVIDADE
// ==========================================

function criarDadosLog({
    guild,
    membroId,
    canalAnterior,
    canalAtual,
    resultado
}) {
    const sessaoId =
        obterIdSessao(resultado);

    const dadosBase = {
        guild,

        autorId: null,

        alvoId: membroId,

        referencia:
            sessaoId
                ? `Sessão de voz #${sessaoId}`
                : 'Equipe em canal de voz'
    };

    // ======================================
    // ENTRADA EM CANAL DE VOZ
    // ======================================

    if (resultado.acao === 'entrada') {
        return {
            ...dadosBase,

            tipo:
                TIPOS_LOG.STAFF_ENTRADA_VOZ,

            titulo:
                'Funcionário entrou em call',

            detalhes:
                `Funcionário: <@${membroId}>\n` +
                `Canal: ${mencionarCanal(canalAtual)}`,

            chaveEvento:
                sessaoId
                    ? `staff_voz_entrada_${sessaoId}`
                    : null
        };
    }

    // ======================================
    // SAÍDA DO CANAL DE VOZ
    // ======================================

    if (resultado.acao === 'saida') {
        const segundos = Math.max(
            0,
            Number(resultado.segundos || 0)
        );

        return {
            ...dadosBase,

            tipo:
                TIPOS_LOG.STAFF_SAIDA_VOZ,

            titulo:
                'Funcionário saiu da call',

            detalhes:
                `Funcionário: <@${membroId}>\n` +
                `Canal anterior: ${
                    mencionarCanal(canalAnterior)
                }\n` +
                `Duração da sessão: ${
                    formatarTempoVoz(segundos)
                }`,

            chaveEvento:
                sessaoId
                    ? `staff_voz_saida_${sessaoId}`
                    : null
        };
    }

    // ======================================
    // TROCA DE CANAL DE VOZ
    // ======================================

    if (
        resultado.acao ===
        'mudanca_de_canal'
    ) {
        return {
            ...dadosBase,

            tipo:
                'staff_troca_voz',

            titulo:
                'Funcionário mudou de call',

            detalhes:
                `Funcionário: <@${membroId}>\n` +
                `Canal anterior: ${
                    mencionarCanal(canalAnterior)
                }\n` +
                `Novo canal: ${
                    mencionarCanal(canalAtual)
                }`,

            // Uma sessão pode ter várias
            // mudanças legítimas de canal.
            //
            // Por isso, não utilizamos
            // uma chave única por sessão
            // para esse tipo de evento.
            chaveEvento: null
        };
    }

    return null;
}

// ==========================================
// SALVAR ATIVIDADE NOS LOGS
// ==========================================

async function registrarAtividade(
    guild,
    membroId,
    canalAnterior,
    canalAtual,
    resultado
) {
    const dados = criarDadosLog({
        guild,
        membroId,
        canalAnterior,
        canalAtual,
        resultado
    });

    if (!dados) {
        return;
    }

    try {
        const log =
            await registrarLogSistema(
                dados
            );

        // O registro continua salvo
        // no SQLite mesmo quando o
        // canal de logs não está
        // configurado.

        if (
            log?.salvo &&
            !log?.publicado
        ) {
            console.log(
                '[InovareSale | Voz] ' +
                'Atividade salva; publicação ' +
                'do log pendente.'
            );
        }

    } catch (erro) {
        // Falhar no envio do log não
        // deve interferir no registro
        // da presença do funcionário.
        console.error(
            '[InovareSale | Voz] ' +
            'Falha ao registrar log:',
            erro
        );
    }
}

// ==========================================
// EVENTO PRINCIPAL
// ==========================================

module.exports = {
    name: Events.VoiceStateUpdate,

    once: false,

    async execute(
        estadoAnterior,
        estadoAtual,
        client
    ) {
        // ==================================
        // IDENTIFICAR SERVIDOR
        // ==================================

        const guild =
            estadoAtual?.guild ||
            estadoAnterior?.guild;

        if (!guild?.id) {
            return;
        }

        // ==================================
        // IDENTIFICAR FUNCIONÁRIO
        // ==================================

        const membroId =
            estadoAtual?.id ||
            estadoAnterior?.id;

        if (!membroId) {
            return;
        }

        // ==================================
        // IDENTIFICAR CANAIS
        // ==================================

        const canalAnterior =
            estadoAnterior?.channelId ||
            null;

        const canalAtual =
            estadoAtual?.channelId ||
            null;

        // ==================================
        // IGNORAR MUDANÇAS SEM TROCA DE CANAL
        // ==================================

        // O Discord também emite este
        // evento quando alguém:
        //
        // - Silencia o microfone
        // - Ativa o áudio
        // - Desativa o áudio
        // - Liga a câmera
        // - Inicia uma transmissão
        //
        // Essas ações não devem
        // criar novas sessões.

        if (
            canalAnterior === canalAtual
        ) {
            return;
        }

        // ==================================
        // PROCESSAR PRESENÇA NO SQLITE
        // ==================================

        let resultado;

        try {
            resultado =
                await processarMudancaVoz(
                    estadoAnterior,
                    estadoAtual
                );

        } catch (erro) {
            console.error(
                '[InovareSale | Voz] ' +
                `Erro ao processar funcionário ${membroId}:`,
                erro
            );

            return;
        }

        // ==================================
        // IGNORAR QUEM NÃO É DA EQUIPE
        // ==================================

        if (
            !resultado ||
            !resultado.tratado
        ) {
            return;
        }

        // ==================================
        // MOSTRAR ATIVIDADE NO CONSOLE
        // ==================================

        switch (resultado.acao) {
            case 'entrada':
                console.log(
                    '🎙️ [InovareSale] ' +
                    `Funcionário ${membroId} ` +
                    'entrou em call.'
                );
                break;

            case 'saida':
                console.log(
                    '🎙️ [InovareSale] ' +
                    `Funcionário ${membroId} ` +
                    'saiu da call.'
                );
                break;

            case 'mudanca_de_canal':
                console.log(
                    '🎙️ [InovareSale] ' +
                    `Funcionário ${membroId} ` +
                    'mudou de canal de voz.'
                );
                break;

            default:
                return;
        }

        // ==================================
        // REGISTRAR EVENTO NOS LOGS
        // ==================================

        await registrarAtividade(
            guild,
            membroId,
            canalAnterior,
            canalAtual,
            resultado
        );

        // ==================================
        // PAINEL DE STATUS
        // ==================================

        // O statusService.js atualiza o
        // painel automaticamente a cada
        // 60 minutos.
        //
        // Não enviamos mensagens de status
        // novas a cada movimentação da
        // equipe para evitar spam.
    }
};
