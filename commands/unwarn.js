
'use strict';

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    EmbedBuilder,
    escapeMarkdown
} = require('discord.js');

const {
    TIPOS,
    buscarCasoModeracao,
    removerAdvertenciaComLog
} = require('../services/moderacaoService');

// ==========================================
// INOVARESALE BOT 3.0
// COMANDO /UNWARN
// ==========================================

// FUNCIONALIDADES:
//
// - Remover advertências pelo ID do caso
// - Exigir permissão de moderação
// - Verificar se a advertência existe
// - Impedir remoções duplicadas
// - Respeitar a hierarquia de cargos
// - Preservar o histórico original
// - Registrar quem removeu a advertência
// - Guardar o motivo da remoção
// - Gerar novo caso de moderação
// - Enviar a ação para os logs
//
// IMPORTANTE:
//
// O comando não apaga a advertência
// original do SQLite.
//
// O registro original passa para
// advertencia_ativa = 0.
//
// Um novo caso "unwarn" registra:
// - Quem removeu
// - Qual advertência foi removida
// - Motivo
// - Data da remoção

// ==========================================
// CONFIGURAÇÕES
// ==========================================

const COR = 0x9951CB;

const LIMITE_MOTIVO = 450;

// ==========================================
// ERROS CONTROLADOS
// ==========================================

class ErroModeracao extends Error {
    constructor(mensagem) {
        super(mensagem);

        this.name = 'ErroModeracao';
    }
}

// ==========================================
// RESPONDER PRIVADAMENTE
// ==========================================

async function responderPrivado(
    interaction,
    conteudo
) {
    const dados =
        typeof conteudo === 'string'
            ? { content: conteudo }
            : conteudo;

    const payload = {
        ...dados,

        allowedMentions: {
            parse: []
        }
    };

    if (interaction.deferred) {
        return interaction.editReply(
            payload
        );
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

// ==========================================
// VALIDAR NÚMERO DO CASO
// ==========================================

function obterNumeroCaso(interaction) {
    const numero =
        interaction.options.getInteger(
            'caso',
            true
        );

    if (
        !Number.isSafeInteger(numero) ||
        numero < 1
    ) {
        throw new ErroModeracao(
            'Informe um número de caso válido.'
        );
    }

    return numero;
}

// ==========================================
// OBTER MOTIVO DA REMOÇÃO
// ==========================================

function obterMotivo(interaction) {
    const texto =
        interaction.options.getString(
            'motivo'
        );

    const motivo = String(
        texto || 'Advertência removida pela equipe'
    )
        .replace(/\u0000/g, '')
        .trim();

    if (!motivo) {
        return 'Advertência removida pela equipe';
    }

    return motivo.slice(
        0,
        LIMITE_MOTIVO
    );
}

// ==========================================
// VERIFICAR PERMISSÃO
// ==========================================

function verificarPermissao(interaction) {
    if (!interaction.inGuild()) {
        throw new ErroModeracao(
            'O comando /unwarn só pode ' +
            'ser usado em servidores.'
        );
    }

    if (
        !interaction.memberPermissions?.has(
            PermissionFlagsBits.ModerateMembers
        )
    ) {
        throw new ErroModeracao(
            'Você precisa da permissão ' +
            '"Moderar membros" para ' +
            'remover advertências.'
        );
    }
}

// ==========================================
// BUSCAR ADVERTÊNCIA ORIGINAL
// ==========================================

// Confirma que:
//
// - O caso pertence ao servidor
// - O caso é uma advertência
// - O registro ainda está ativo
//
// Casos de ban, timeout e unwarn
// não podem ser removidos com /unwarn.

function obterAdvertencia(
    interaction,
    numeroCaso
) {
    const caso =
        buscarCasoModeracao(
            interaction.guildId,
            numeroCaso
        );

    if (!caso) {
        throw new ErroModeracao(
            `A advertência #${numeroCaso} ` +
            'não foi encontrada neste servidor.'
        );
    }

    if (
        caso.tipo !== TIPOS.WARN
    ) {
        throw new ErroModeracao(
            `O caso #${numeroCaso} ` +
            'não é uma advertência.'
        );
    }

    return caso;
}

// ==========================================
// VERIFICAR HIERARQUIA DE CARGOS
// ==========================================

// O comando /warn impede aplicar
// advertências a pessoas com cargos
// iguais ou superiores.
//
// O /unwarn também seguirá essa regra.
//
// Se o usuário já saiu do servidor,
// a hierarquia atual não está disponível.
// Nesse caso, a remoção pode ser feita
// por um moderador autorizado.
//
// Isso não concede uma nova punição;
// apenas remove um registro existente.

async function verificarHierarquia(
    interaction,
    advertencia
) {
    const guild =
        interaction.guild;

    const moderadorId =
        interaction.user.id;

    // ======================================
    // DONO DO SERVIDOR
    // ======================================

    if (
        moderadorId === guild.ownerId
    ) {
        return;
    }

    // ======================================
    // BUSCAR MODERADOR
    // ======================================

    const membroModerador =
        await guild.members.fetch(
            moderadorId
        );

    // ======================================
    // BUSCAR ALVO DA ADVERTÊNCIA
    // ======================================

    let membroAlvo = null;

    try {
        membroAlvo =
            await guild.members.fetch(
                advertencia.usuario_id
            );

    } catch (erro) {
        if (
            erro.code !== 10007
        ) {
            throw erro;
        }
    }

    // ======================================
    // USUÁRIO FORA DO SERVIDOR
    // ======================================

    if (!membroAlvo) {
        return;
    }

    // ======================================
    // PROTEGER DONO DO SERVIDOR
    // ======================================

    if (
        membroAlvo.id === guild.ownerId
    ) {
        throw new ErroModeracao(
            'Você não pode alterar ' +
            'advertências do dono do servidor.'
        );
    }

    // ======================================
    // COMPARAR CARGOS
    // ======================================

    const comparacao =
        membroModerador.roles.highest
            .comparePositionTo(
                membroAlvo.roles.highest
            );

    if (comparacao <= 0) {
        throw new ErroModeracao(
            'Você não pode remover advertências ' +
            'de um membro com cargo igual ' +
            'ou superior ao seu.'
        );
    }
}

// ==========================================
// REMOVER ADVERTÊNCIA DO SQLITE
// ==========================================

// O serviço fará uma transação:
//
// 1. Confirma que está ativa
// 2. Marca como removida
// 3. Cria o caso de remoção
// 4. Preserva o registro original
// 5. Encaminha o novo caso aos logs
//
// Se a advertência já estiver removida,
// não será removida uma segunda vez.

async function executarRemocao(
    interaction,
    numeroCaso,
    motivo
) {
    return removerAdvertenciaComLog({
        guild:
            interaction.guild,

        advertenciaId:
            numeroCaso,

        moderadorId:
            interaction.user.id,

        motivo,

        // Cada interação do Discord
        // possui um identificador único.
        //
        // Isso evita duplicidade
        // ao processar a mesma ação.

        chaveEvento:
            `unwarn_${interaction.id}`
    });
}

// ==========================================
// CRIAR EMBED DE CONFIRMAÇÃO
// ==========================================

function criarEmbedRemocao({
    advertencia,
    remocao,
    moderadorId,
    motivo,
    logPublicado
}) {
    const embed = new EmbedBuilder()
        .setColor(COR)
        .setTitle(
            'INOVARESALE | REMOÇÃO DE WARN'
        )
        .setDescription(
            '✅ **Advertência removida com sucesso!**'
        )
        .addFields(
            {
                name: 'Usuário',
                value:
                    `<@${advertencia.usuario_id}>`,
                inline: true
            },

            {
                name: 'Moderador',
                value:
                    `<@${moderadorId}>`,
                inline: true
            },

            {
                name: 'Advertência original',
                value:
                    `#${advertencia.id}`,
                inline: true
            },

            {
                name: 'Novo caso de remoção',
                value:
                    remocao
                        ? `#${remocao.id}`
                        : 'Não disponível',
                inline: true
            },

            {
                name: 'Situação',
                value:
                    '🟢 Advertência removida',
                inline: true
            },

            {
                name: 'Motivo da remoção',
                value:
                    escapeMarkdown(
                        motivo
                    ),
                inline: false
            },

            {
                name: 'Histórico',
                value:
                    'O registro original foi preservado no SQLite.',
                inline: false
            }
        )
        .setFooter({
            text:
                'InovareSale • Moderação 3.0'
        })
        .setTimestamp();

    if (logPublicado) {
        embed.addFields({
            name: 'Log',
            value:
                '✅ Processado',
            inline: true
        });
    }

    return embed;
}

// ==========================================
// TRATAR ERROS
// ==========================================

function mensagemErro(erro) {
    if (
        erro instanceof ErroModeracao
    ) {
        return `❌ ${erro.message}`;
    }

    if (
        erro.code === 50013 ||
        erro.code === 50001
    ) {
        return (
            '❌ Não foi possível confirmar ' +
            'as permissões no Discord.'
        );
    }

    return (
        '❌ Não foi possível remover ' +
        'a advertência. Verifique o caso ' +
        'e avise a administração.'
    );
}

// ==========================================
// COMANDO /UNWARN
// ==========================================

module.exports = {
    data:
        new SlashCommandBuilder()
            .setName('unwarn')
            .setDescription(
                'Remove uma advertência pelo número do caso.'
            )

            // Apenas moderadores com
            // permissão para moderar membros.

            .setDefaultMemberPermissions(
                PermissionFlagsBits.ModerateMembers
            )

            .setDMPermission(false)

            // ==================================
            // OPÇÃO: CASO
            // ==================================

            .addIntegerOption(opcao =>
                opcao
                    .setName('caso')
                    .setDescription(
                        'Número da advertência que será removida'
                    )
                    .setRequired(true)
                    .setMinValue(1)
            )

            // ==================================
            // OPÇÃO: MOTIVO
            // ==================================

            .addStringOption(opcao =>
                opcao
                    .setName('motivo')
                    .setDescription(
                        'Motivo para remover a advertência'
                    )
                    .setRequired(false)
                    .setMaxLength(
                        LIMITE_MOTIVO
                    )
            ),

    // ======================================
    // EXECUTAR COMANDO
    // ======================================

    async execute(interaction) {
        try {
            // ==================================
            // VERIFICAR PERMISSÃO
            // ==================================

            verificarPermissao(
                interaction
            );

            // ==================================
            // LER OPÇÕES
            // ==================================

            const numeroCaso =
                obterNumeroCaso(
                    interaction
                );

            const motivo =
                obterMotivo(
                    interaction
                );

            // ==================================
            // ADIAR RESPOSTA PRIVADA
            // ==================================

            await interaction.deferReply({
                flags:
                    MessageFlags.Ephemeral
            });

            // ==================================
            // BUSCAR ADVERTÊNCIA
            // ==================================

            const advertencia =
                obterAdvertencia(
                    interaction,
                    numeroCaso
                );

            // ==================================
            // VERIFICAR SE JÁ FOI REMOVIDA
            // ==================================

            if (
                advertencia.advertencia_ativa !== 1
            ) {
                await responderPrivado(
                    interaction,
                    `⚠️ A advertência #${numeroCaso} ` +
                    'já foi removida anteriormente.'
                );

                return;
            }

            // ==================================
            // VERIFICAR HIERARQUIA
            // ==================================

            await verificarHierarquia(
                interaction,
                advertencia
            );

            // ==================================
            // REMOVER E REGISTRAR NO SQLITE
            // ==================================

            const resultado =
                await executarRemocao(
                    interaction,
                    numeroCaso,
                    motivo
                );

            // ==================================
            // VERIFICAR RESULTADO
            // ==================================

            if (
                !resultado?.removida
            ) {
                if (
                    resultado?.jaRemovida
                ) {
                    await responderPrivado(
                        interaction,
                        `⚠️ A advertência #${numeroCaso} ` +
                        'já foi removida por outra operação.'
                    );

                    return;
                }

                throw new Error(
                    'A remoção não foi confirmada pelo serviço.'
                );
            }

            // ==================================
            // MONTAR EMBED
            // ==================================

            const embed =
                criarEmbedRemocao({
                    advertencia,

                    remocao:
                        resultado.caso,

                    moderadorId:
                        interaction.user.id,

                    motivo,

                    logPublicado:
                        Boolean(
                            resultado.log?.publicado
                        )
                });

            // ==================================
            // VERIFICAR PUBLICAÇÃO DO LOG
            // ==================================

            let aviso = null;

            if (
                resultado.erroLog ||
                resultado.log?.publicado === false
            ) {
                aviso =
                    'ℹ️ A advertência foi removida ' +
                    'e o histórico foi salvo no SQLite. ' +
                    'A publicação do log está pendente.';
            }

            // ==================================
            // RESPONDER AO MODERADOR
            // ==================================

            await responderPrivado(
                interaction,
                {
                    content: aviso,

                    embeds: [embed]
                }
            );

            // ==================================
            // REGISTRAR NO CONSOLE
            // ==================================

            console.log(
                '[InovareSale | Unwarn] ' +
                `Advertência #${numeroCaso} ` +
                `removida por ${interaction.user.id}. ` +
                `Novo caso: #${resultado.caso.id}.`
            );

        } catch (erro) {
            console.error(
                '[InovareSale | Unwarn] Erro:',
                erro
            );

            // ==================================
            // RESPONDER SOBRE O ERRO
            // ==================================

            try {
                await responderPrivado(
                    interaction,
                    mensagemErro(erro)
                );

            } catch (erroResposta) {
                console.error(
                    '[InovareSale | Unwarn] ' +
                    'Falha ao responder:',
                    erroResposta
                );
            }
        }
    }
};
