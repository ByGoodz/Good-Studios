
'use strict';

const {
    Events
} = require('discord.js');

// ==========================================
// INOVARESALE BOT 3.0
// EVENTO: NOVO MEMBRO NO SERVIDOR
// ==========================================

// Responsabilidades:
//
// - Detectar novas entradas no servidor
// - Consultar o sistema de convites
// - Identificar o convidador, se possível
// - Registrar a entrada no SQLite
// - Evitar registrar o mesmo membro duas vezes
// - Enviar informações para o sistema de logs
// - Não atribuir convites sem confirmação
//
// IMPORTANTE:
//
// O serviço de convites compara os
// usos anteriores e atuais dos links.
//
// Se não houver dados suficientes para
// identificar quem convidou o membro,
// a entrada permanece como desconhecida.
//
// Este arquivo NÃO envia mensagem
// pública de boas-vindas.

// ==========================================
// SERVIÇO DE CONVITES
// ==========================================

const {
    processarEntradaMembro,
    STATUS_ENTRADA
} = require('../services/convitesService');

// ==========================================
// SERVIÇO DE LOGS
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
// FORMATAR CÓDIGO DE CONVITE
// ==========================================

function formatarCodigo(codigo) {
    const texto = String(
        codigo ?? ''
    ).trim();

    if (!/^[A-Za-z0-9_-]{2,64}$/.test(texto)) {
        return 'Desconhecido';
    }

    return `\`${texto}\``;
}

// ==========================================
// IDENTIFICAR RESULTADO
// ==========================================

function obterNomeStatus(status) {
    switch (status) {
        case STATUS_ENTRADA.CONFIRMADO:
            return 'Convite identificado';

        case STATUS_ENTRADA.AMBIGUO:
            return 'Convite ambíguo';

        case STATUS_ENTRADA.SEM_BASE:
            return 'Sem histórico de comparação';

        case STATUS_ENTRADA.SEM_ACESSO:
            return 'Sem acesso aos convites';

        case STATUS_ENTRADA.NAO_IDENTIFICADO:
            return 'Convite não identificado';

        default:
            return 'Origem desconhecida';
    }
}

// ==========================================
// MONTAR DESCRIÇÃO DO REGISTRO
// ==========================================

function criarDescricaoEntrada(
    membro,
    resultado
) {
    const linhas = [
        `**Novo membro:** ${
            mencionarUsuario(membro.id)
        }`,

        `**Usuário:** ${
            String(
                membro.user?.username ||
                'Desconhecido'
            ).slice(0, 80)
        }`,

        `**Resultado:** ${
            obterNomeStatus(resultado.status)
        }`
    ];

    // ======================================
    // CONVITE CONFIRMADO
    // ======================================

    if (
        resultado.status ===
        STATUS_ENTRADA.CONFIRMADO
    ) {
        linhas.push(
            `**Convidado por:** ${
                mencionarUsuario(
                    resultado.convidadorId
                )
            }`
        );

        linhas.push(
            `**Código utilizado:** ${
                formatarCodigo(
                    resultado.codigo
                )
            }`
        );
    }

    // ======================================
    // CONVITE NÃO IDENTIFICADO
    // ======================================

    else {
        linhas.push(
            '**Convidado por:** Não identificado'
        );

        if (resultado.codigo) {
            linhas.push(
                `**Código observado:** ${
                    formatarCodigo(
                        resultado.codigo
                    )
                }`
            );
        }
    }

    // ======================================
    // INFORMAÇÕES ADICIONAIS
    // ======================================

    if (resultado.observacao) {
        linhas.push(
            '',
            '**Observação:**',
            String(
                resultado.observacao
            ).slice(0, 400)
        );
    }

    return linhas.join('\n');
}

// ==========================================
// GERAR DADOS DO LOG
// ==========================================

function criarDadosLogEntrada(
    membro,
    resultado
) {
    const confirmado =
        resultado.status ===
        STATUS_ENTRADA.CONFIRMADO;

    const titulo = confirmado
        ? 'Novo membro por convite'
        : 'Novo membro no servidor';

    const tipo = confirmado
        ? TIPOS_LOG.CONVITE_UTILIZADO
        : 'membro_entrada';

    return {
        guild: membro.guild,

        tipo,

        titulo,

        detalhes: criarDescricaoEntrada(
            membro,
            resultado
        ),

        autorId: confirmado
            ? resultado.convidadorId
            : null,

        alvoId: membro.id,

        referencia:
            confirmado
                ? (
                    'Convite ' +
                    String(resultado.codigo)
                )
                : 'Entrada de membro',

        // Chave fixa por servidor/membro.
        //
        // Se o evento chegar repetido,
        // o sistema de logs não criará
        // dois registros iguais.
        chaveEvento:
            `membro_entrada_${membro.id}`
    };
}

// ==========================================
// REGISTRAR LOG DA ENTRADA
// ==========================================

// Os logs são independentes da
// contagem de convites.
//
// Se o Discord não permitir publicar
// a mensagem, o registro permanece
// salvo no SQLite para reenvio futuro.

async function registrarLogEntrada(
    membro,
    resultado
) {
    try {
        const dados = criarDadosLogEntrada(
            membro,
            resultado
        );

        const resposta =
            await registrarLogSistema(
                dados
            );

        if (
            resposta.salvo &&
            !resposta.publicado
        ) {
            console.log(
                '[InovareSale | Convites] ' +
                'Entrada registrada nos logs; ' +
                'publicação pendente.'
            );
        }

        return resposta;

    } catch (erro) {
        // Falha no canal de logs não
        // deve desfazer uma entrada
        // já salva no SQLite.

        console.error(
            '[InovareSale | Convites] ' +
            'Não foi possível registrar log:',
            erro
        );

        return null;
    }
}

// ==========================================
// MOSTRAR RESULTADO NO CONSOLE
// ==========================================

function informarResultado(
    membro,
    resultado
) {
    const usuario =
        membro.user?.tag ||
        membro.user?.username ||
        membro.id;

    if (
        resultado.status ===
        STATUS_ENTRADA.CONFIRMADO
    ) {
        console.log(
            '✅ [InovareSale | Convites] ' +
            `${usuario} entrou usando ` +
            `o convite ${resultado.codigo}, ` +
            `criado por ${resultado.convidadorId}.`
        );

        return;
    }

    console.log(
        'ℹ️ [InovareSale | Convites] ' +
        `${usuario} entrou no servidor. ` +
        `Status: ${
            obterNomeStatus(resultado.status)
        }.`
    );
}

// ==========================================
// EVENTO PRINCIPAL
// ==========================================

module.exports = {
    name: Events.GuildMemberAdd,

    once: false,

    async execute(membro, client) {
        // ==================================
        // VERIFICAR SERVIDOR
        // ==================================

        if (
            !membro ||
            !membro.guild?.id ||
            !membro.id
        ) {
            return;
        }

        // ==================================
        // IGNORAR ENTRADAS DE BOTS
        // ==================================

        // Bots podem entrar por OAuth
        // sem utilizar um convite normal.
        //
        // Não vamos misturar essas
        // entradas com o ranking de
        // convites de pessoas.

        if (membro.user?.bot) {
            return;
        }

        // ==================================
        // PROCESSAR ENTRADA NO SQLITE
        // ==================================

        let resultado;

        try {
            resultado =
                await processarEntradaMembro(
                    membro
                );

        } catch (erro) {
            console.error(
                '[InovareSale | Convites] ' +
                `Erro ao registrar entrada de ${
                    membro.id
                }:`,
                erro
            );

            // Não atribuímos o convite
            // por tentativa ou suposição
            // quando a consulta falha.

            return;
        }

        // ==================================
        // VERIFICAR RESULTADO
        // ==================================

        if (!resultado) {
            console.warn(
                '[InovareSale | Convites] ' +
                'O serviço não retornou ' +
                'um resultado para a entrada.'
            );

            return;
        }

        // ==================================
        // IGNORAR EVENTOS DUPLICADOS
        // ==================================

        if (!resultado.novo) {
            console.log(
                '[InovareSale | Convites] ' +
                `O membro ${membro.id} ` +
                'já possui entrada registrada.'
            );

            return;
        }

        // ==================================
        // MOSTRAR RESULTADO
        // ==================================

        informarResultado(
            membro,
            resultado
        );

        // ==================================
        // REGISTRAR NOS LOGS
        // ==================================

        await registrarLogEntrada(
            membro,
            resultado
        );

        // ==================================
        // SISTEMA DE STATUS
        // ==================================

        // O services/statusService.js
        // atualiza o painel uma vez
        // por hora.
        //
        // Não publicamos outro painel
        // quando um membro entra.
        //
        // Depois de conectar o
        // obterResumoConvites(),
        // o painel exibirá os dados
        // confirmados do SQLite.
    }
};
