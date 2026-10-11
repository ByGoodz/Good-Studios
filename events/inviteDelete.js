
'use strict';

const {
    Events
} = require('discord.js');

// ==========================================
// INOVARESALE BOT 3.0
// EVENTO: CONVITE REMOVIDO
// ==========================================

// Responsabilidades:
//
// - Detectar convites removidos
// - Identificar o servidor
// - Buscar informações já salvas
// - Marcar o convite como inativo
// - Preservar seu histórico no SQLite
// - Registrar o evento nos logs
// - Evitar registros de log duplicados
//
// IMPORTANTE:
//
// O Discord pode emitir InviteDelete
// quando um convite é removido
// manualmente OU quando expira.
//
// Portanto, não afirmamos que alguém
// excluiu o convite manualmente.
//
// O evento também não informa,
// necessariamente, quem fez a remoção.

// ==========================================
// IMPORTAR SERVIÇO DE CONVITES
// ==========================================

const {
    buscarConvite,
    registrarConviteExcluido
} = require('../services/convitesService');

// ==========================================
// IMPORTAR SERVIÇO DE LOGS
// ==========================================

const {
    registrarLogSistema,
    TIPOS_LOG
} = require('../services/logsService');

// ==========================================
// FORMATAR MENÇÃO DE USUÁRIO
// ==========================================

function mencionarUsuario(id) {
    const texto = String(
        id ?? ''
    ).trim();

    if (!/^\d{15,22}$/.test(texto)) {
        return 'Não identificado';
    }

    return `<@${texto}>`;
}

// ==========================================
// FORMATAR MENÇÃO DE CANAL
// ==========================================

function mencionarCanal(id) {
    const texto = String(
        id ?? ''
    ).trim();

    if (!/^\d{15,22}$/.test(texto)) {
        return 'Não identificado';
    }

    return `<#${texto}>`;
}

// ==========================================
// FORMATAR CÓDIGO DO CONVITE
// ==========================================

function formatarCodigo(codigo) {
    const texto = String(
        codigo ?? ''
    ).trim();

    if (
        !/^[A-Za-z0-9_-]{2,64}$/.test(
            texto
        )
    ) {
        return 'Desconhecido';
    }

    return `\`${texto}\``;
}

// ==========================================
// OBTER INFORMAÇÕES DO CONVITE
// ==========================================

// Preferimos os dados já armazenados
// no SQLite, pois o objeto entregue
// pelo Discord pode estar incompleto.

function obterInformacoesConvite(
    convite,
    registroAnterior
) {
    const codigo = String(
        convite.code || ''
    ).trim();

    const criadorId =
        registroAnterior?.convidador_id ||
        convite.inviter?.id ||
        null;

    const canalId =
        registroAnterior?.canal_id ||
        convite.channelId ||
        convite.channel?.id ||
        null;

    const usosRegistrados =
        registroAnterior
            ? Number(
                registroAnterior.usos || 0
            )
            : null;

    return {
        codigo,
        criadorId,
        canalId,
        usosRegistrados,
        encontradoNoBanco:
            Boolean(registroAnterior)
    };
}

// ==========================================
// CRIAR DESCRIÇÃO DO LOG
// ==========================================

function criarDescricaoRemocao(
    informacoes
) {
    const linhas = [
        '**Um convite deixou de estar disponível.**',
        '',
        `**Código:** ${
            formatarCodigo(
                informacoes.codigo
            )
        }`,
        `**Criador do convite:** ${
            mencionarUsuario(
                informacoes.criadorId
            )
        }`,
        `**Canal:** ${
            mencionarCanal(
                informacoes.canalId
            )
        }`
    ];

    // ======================================
    // USOS CONHECIDOS
    // ======================================

    if (
        informacoes.usosRegistrados !==
        null
    ) {
        linhas.push(
            `**Última contagem conhecida:** ${
                informacoes.usosRegistrados
                    .toLocaleString('pt-BR')
            } uso(s)`
        );
    }

    // ======================================
    // SITUAÇÃO DO REGISTRO
    // ======================================

    linhas.push('');

    if (
        informacoes.encontradoNoBanco
    ) {
        linhas.push(
            '**Banco de dados:** ' +
            'Convite marcado como inativo. ' +
            'Histórico preservado.'
        );

    } else {
        linhas.push(
            '**Banco de dados:** ' +
            'O código não estava na lista ' +
            'de convites anteriormente registrados.'
        );
    }

    // ======================================
    // AVISO SOBRE A REMOÇÃO
    // ======================================

    linhas.push(
        '',
        '*A remoção pode ter ocorrido por ' +
        'exclusão manual, expiração ou ' +
        'limite de usos atingido.*'
    );

    return linhas.join('\n');
}

// ==========================================
// MONTAR DADOS DO LOG
// ==========================================

function criarDadosLogRemocao(
    guild,
    informacoes
) {
    return {
        guild,

        tipo:
            TIPOS_LOG.CONVITE_EXCLUIDO,

        titulo:
            'Convite removido ou expirado',

        detalhes:
            criarDescricaoRemocao(
                informacoes
            ),

        // O Discord não informa
        // necessariamente quem
        // removeu o convite.
        //
        // Não atribuímos essa ação
        // ao criador do link.

        autorId: null,
        alvoId: null,

        referencia:
            `Convite ${informacoes.codigo}`,

        // Evita duplicar o log se
        // o mesmo evento for recebido
        // novamente no mesmo servidor.
        chaveEvento:
            `convite_removido_${informacoes.codigo}`
    };
}

// ==========================================
// REGISTRAR LOG DA REMOÇÃO
// ==========================================

async function registrarLogRemocao(
    guild,
    informacoes
) {
    try {
        const dados =
            criarDadosLogRemocao(
                guild,
                informacoes
            );

        const resultado =
            await registrarLogSistema(
                dados
            );

        if (
            resultado.salvo &&
            resultado.publicado
        ) {
            console.log(
                '[InovareSale | Convites] ' +
                `Log de remoção do convite ` +
                `${informacoes.codigo} processado.`
            );

        } else if (
            resultado.salvo
        ) {
            console.log(
                '[InovareSale | Convites] ' +
                'Remoção salva nos logs; ' +
                'publicação pendente.'
            );
        }

        return resultado;

    } catch (erro) {
        // Uma falha no canal de logs
        // não desfaz a atualização
        // feita no SQLite.

        console.error(
            '[InovareSale | Convites] ' +
            'Erro ao registrar log de remoção:',
            erro
        );

        return null;
    }
}

// ==========================================
// EVENTO PRINCIPAL
// ==========================================

module.exports = {
    name: Events.InviteDelete,

    once: false,

    async execute(convite, client) {
        // ==================================
        // VALIDAR DADOS RECEBIDOS
        // ==================================

        if (
            !convite ||
            !convite.guild?.id ||
            !convite.code
        ) {
            return;
        }

        const guild =
            convite.guild;

        const codigo =
            String(
                convite.code
            ).trim();

        // ==================================
        // VALIDAR SERVIDOR
        // ==================================

        if (
            client &&
            !client.guilds.cache.has(
                guild.id
            )
        ) {
            return;
        }

        // ==================================
        // BUSCAR HISTÓRICO DO CONVITE
        // ==================================

        let anterior = null;

        try {
            anterior = buscarConvite(
                guild.id,
                codigo
            );

        } catch (erro) {
            console.error(
                '[InovareSale | Convites] ' +
                'Não foi possível consultar ' +
                'o convite anterior:',
                erro
            );

            return;
        }

        // ==================================
        // GUARDAR INFORMAÇÕES ANTIGAS
        // ==================================

        const informacoes =
            obterInformacoesConvite(
                convite,
                anterior
            );

        // ==================================
        // MARCAR CONVITE COMO INATIVO
        // ==================================

        let resultado;

        try {
            resultado =
                registrarConviteExcluido(
                    convite
                );

        } catch (erro) {
            console.error(
                '[InovareSale | Convites] ' +
                `Falha ao registrar remoção ` +
                `do convite ${codigo}:`,
                erro
            );

            return;
        }

        // ==================================
        // REGISTRAR NO CONSOLE
        // ==================================

        if (
            resultado.atualizado
        ) {
            console.log(
                '🔗 [InovareSale | Convites] ' +
                `Convite ${codigo} marcado ` +
                'como inativo.'
            );

        } else {
            console.log(
                'ℹ️ [InovareSale | Convites] ' +
                `Convite ${codigo} removido, ` +
                'mas não havia um registro ' +
                'anterior para atualizar.'
            );
        }

        // ==================================
        // SALVAR LOG DO EVENTO
        // ==================================

        await registrarLogRemocao(
            guild,
            informacoes
        );

        // ==================================
        // PRESERVAR ESTATÍSTICAS
        // ==================================

        // Não removemos entradas de
        // membros já atribuídas a esse
        // convite.
        //
        // Não diminuímos o ranking.
        //
        // Não apagamos o registro
        // do criador do link.
        //
        // O statusService.js consultará
        // as estatísticas persistentes.
    }
};
