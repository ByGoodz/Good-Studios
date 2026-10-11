
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
    registrarAcaoModeracaoComLog
} = require('../services/moderacaoService');

// ==========================================
// INOVARESALE BOT 3.0
// COMANDO /UNTIMEOUT
// ==========================================

// FUNCIONALIDADES:
//
// - Remover timeouts ativos
// - Verificar permissões do moderador
// - Verificar permissões do bot
// - Respeitar a hierarquia de cargos
// - Identificar timeouts ativos
// - Remover a punição pelo Discord
// - Registrar a remoção no SQLite
// - Enviar registro ao canal de logs
// - Evitar casos duplicados
// - Preservar o histórico anterior
// - Responder privadamente ao moderador
//
// IMPORTANTE:
//
// Primeiro o Discord confirma
// a remoção do timeout.
//
// Depois a ação é registrada no SQLite.
//
// Se o registro falhar, o timeout
// não será aplicado novamente.

// ==========================================
// CONFIGURAÇÕES
// ==========================================

const COR = 0x9951CB;

const LIMITE_MOTIVO = 450;

// ==========================================
// ERROS CONTROLADOS
// ==========================================

class ErroUntimeout extends Error {
    constructor(mensagem) {
        super(mensagem);

        this.name = 'ErroUntimeout';
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
// OBTER MOTIVO
// ==========================================

function obterMotivo(interaction) {
    const texto = String(
        interaction.options.getString(
            'motivo'
        ) ||
        'Remoção do timeout pela equipe'
    )
        .replace(/\u0000/g, '')
        .trim();

    return texto
        ? texto.slice(0, LIMITE_MOTIVO)
        : 'Remoção do timeout pela equipe';
}

// ==========================================
// VERIFICAR PERMISSÃO DO MODERADOR
// ==========================================

function verificarPermissaoInicial(
    interaction
) {
    if (
        !interaction.inGuild() ||
        !interaction.guild
    ) {
        throw new ErroUntimeout(
            'Este comando só pode ser ' +
            'utilizado em servidores.'
        );
    }

    if (
        !interaction.memberPermissions?.has(
            PermissionFlagsBits.ModerateMembers
        )
    ) {
        throw new ErroUntimeout(
            'Você precisa da permissão ' +
            '"Moderar membros" para remover timeouts.'
        );
    }
}

// ==========================================
// CONSULTAR MEMBRO ALVO
// ==========================================

async function buscarMembroAlvo(
    interaction,
    usuario
) {
    const guild =
        interaction.guild;

    // ======================================
    // PROTEGER DONO DO SERVIDOR
    // ======================================

    if (
        usuario.id === guild.ownerId
    ) {
        throw new ErroUntimeout(
            'Não é possível alterar punições ' +
            'do dono do servidor.'
        );
    }

    // ======================================
    // CONSULTAR MEMBRO NO DISCORD
    // ======================================

    let alvo;

    try {
        alvo =
            await guild.members.fetch({
                user: usuario.id,
                force: true
            });

    } catch (erro) {
        if (
            erro.code === 10007
        ) {
            throw new ErroUntimeout(
                'Esse usuário não está no servidor.'
            );
        }

        throw erro;
    }

    // ======================================
    // PROTEGER O PRÓPRIO BOT
    // ======================================

    if (
        alvo.id ===
        interaction.client.user.id
    ) {
        throw new ErroUntimeout(
            'Não é possível alterar ' +
            'o timeout do próprio bot.'
        );
    }

    // ======================================
    // VERIFICAR PERMISSÃO DO BOT
    // ======================================

    const membroBot =
        guild.members.me ||
        await guild.members.fetchMe();

    if (
        !membroBot.permissions.has(
            PermissionFlagsBits.ModerateMembers
        )
    ) {
        throw new ErroUntimeout(
            'O bot não possui a permissão ' +
            '"Moderar membros".'
        );
    }

    // ======================================
    // VERIFICAR SE O BOT PODE MODERAR
    // ======================================

    if (!alvo.moderatable) {
        throw new ErroUntimeout(
            'O bot não pode alterar o timeout ' +
            'desse membro. Verifique a hierarquia ' +
            'dos cargos e as permissões.'
        );
    }

    // ======================================
    // VERIFICAR HIERARQUIA DO MODERADOR
    // ======================================

    if (
        interaction.user.id !==
        guild.ownerId
    ) {
        const moderador =
            await guild.members.fetch(
                interaction.user.id
            );

        const comparacao =
            moderador.roles.highest
                .comparePositionTo(
                    alvo.roles.highest
                );

        if (
            comparacao <= 0
        ) {
            throw new ErroUntimeout(
                'Você não pode remover o timeout ' +
                'de um membro com cargo igual ' +
                'ou superior ao seu.'
            );
        }
    }

    return alvo;
}

// ==========================================
// VERIFICAR TIMEOUT ATIVO
// ==========================================

function possuiTimeoutAtivo(membro) {
    // Consulta quando o timeout
    // está programado para terminar.
    //
    // Caso a data já tenha passado,
    // o membro não possui punição ativa.

    const terminaEm = Number(
        membro.communicationDisabledUntilTimestamp
        || 0
    );

    return (
        Number.isFinite(terminaEm) &&
        terminaEm > Date.now()
    );
}

// ==========================================
// CRIAR EMBED DE CONFIRMAÇÃO
// ==========================================

function criarEmbedUntimeout({
    usuarioId,
    moderadorId,
    motivo,
    casoId,
    logPublicado
}) {
    const embed =
        new EmbedBuilder()
            .setColor(COR)
            .setTitle(
                'INOVARESALE | UNTIMEOUT'
            )
            .setDescription(
                '🔊 **Timeout removido com sucesso!**'
            )
            .addFields(
                {
                    name: 'Usuário',
                    value:
                        `<@${usuarioId}>`,
                    inline: true
                },

                {
                    name: 'Moderador',
                    value:
                        `<@${moderadorId}>`,
                    inline: true
                },

                {
                    name: 'Motivo da remoção',
                    value:
                        escapeMarkdown(motivo),
                    inline: false
                },

                {
                    name: 'Situação',
                    value:
                        '🟢 Timeout removido',
                    inline: true
                },

                {
                    name: 'Histórico',
                    value:
                        'A punição original foi ' +
                        'preservada no SQLite.',
                    inline: false
                }
            )
            .setFooter({
                text:
                    'InovareSale • Moderação 3.0'
            })
            .setTimestamp();

    // ======================================
    // CASO DE MODERAÇÃO
    // ======================================

    if (casoId) {
        embed.addFields({
            name: 'Número do caso',
            value:
                `#${casoId}`,
            inline: true
        });
    }

    // ======================================
    // STATUS DO LOG
    // ======================================

    if (logPublicado) {
        embed.addFields({
            name: 'Log',
            value:
                '✅ Registro publicado',
            inline: true
        });
    }

    return embed;
}

// ==========================================
// REGISTRAR REMOÇÃO NO SQLITE
// ==========================================

async function registrarRemocaoTimeout(
    interaction,
    usuarioId,
    motivo
) {
    return registrarAcaoModeracaoComLog({
        guild:
            interaction.guild,

        tipo:
            TIPOS.UNTIMEOUT,

        moderadorId:
            interaction.user.id,

        usuarioId,

        motivo,

        // Cada interação possui ID único.
        //
        // A chave impede registros
        // duplicados para a mesma ação.

        chaveEvento:
            `untimeout_${interaction.id}`
    });
}

// ==========================================
// TRATAR ERROS
// ==========================================

function mensagemErro(erro) {
    if (
        erro instanceof ErroUntimeout
    ) {
        return `❌ ${erro.message}`;
    }

    if (
        erro.code === 50013 ||
        erro.code === 50001
    ) {
        return (
            '❌ O Discord recusou a remoção. ' +
            'Confira as permissões do bot ' +
            'e a hierarquia dos cargos.'
        );
    }

    return (
        '❌ Não foi possível remover o timeout. ' +
        'Verifique o usuário e as permissões.'
    );
}

// ==========================================
// COMANDO /UNTIMEOUT
// ==========================================

module.exports = {
    data:
        new SlashCommandBuilder()
            .setName('untimeout')
            .setDescription(
                'Remove o timeout ativo de um membro.'
            )
            .setDefaultMemberPermissions(
                PermissionFlagsBits.ModerateMembers
            )
            .setDMPermission(false)

            // ==================================
            // OPÇÃO: USUÁRIO
            // ==================================

            .addUserOption(opcao =>
                opcao
                    .setName('usuario')
                    .setDescription(
                        'Membro que terá o timeout removido'
                    )
                    .setRequired(true)
            )

            // ==================================
            // OPÇÃO: MOTIVO
            // ==================================

            .addStringOption(opcao =>
                opcao
                    .setName('motivo')
                    .setDescription(
                        'Motivo da remoção do timeout'
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
            // VALIDAR PERMISSÃO
            // ==================================

            verificarPermissaoInicial(
                interaction
            );

            // ==================================
            // LER USUÁRIO
            // ==================================

            const usuario =
                interaction.options.getUser(
                    'usuario',
                    true
                );

            // ==================================
            // LER MOTIVO
            // ==================================

            const motivo =
                obterMotivo(
                    interaction
                );

            // ==================================
            // ADIAR RESPOSTA PRIVADA
            // ==================================

            await interaction.deferReply({
                flags: MessageFlags.Ephemeral
            });

            // ==================================
            // VERIFICAR MEMBRO E HIERARQUIA
            // ==================================

            const alvo =
                await buscarMembroAlvo(
                    interaction,
                    usuario
                );

            // ==================================
            // VERIFICAR TIMEOUT ATIVO
            // ==================================

            if (
                !possuiTimeoutAtivo(alvo)
            ) {
                await responderPrivado(
                    interaction,
                    '⚠️ Esse membro não possui ' +
                    'um timeout ativo para remover.'
                );

                return;
            }

            // ==================================
            // REMOVER TIMEOUT NO DISCORD
            // ==================================

            // Passar null remove o timeout
            // atualmente aplicado ao membro.

            await alvo.timeout(
                null,

                `InovareSale | ${motivo}`
            );

            // ==================================
            // SALVAR NO SQLITE E NOS LOGS
            // ==================================

            let registro = null;
            let erroRegistro = null;

            try {
                registro =
                    await registrarRemocaoTimeout(
                        interaction,
                        usuario.id,
                        motivo
                    );

            } catch (erro) {
                erroRegistro = erro;

                console.error(
                    '[InovareSale | Untimeout] ' +
                    'Timeout removido, mas houve ' +
                    'falha ao salvar o histórico:',
                    erro
                );
            }

            // ==================================
            // MONTAR EMBED
            // ==================================

            const embed =
                criarEmbedUntimeout({
                    usuarioId:
                        usuario.id,

                    moderadorId:
                        interaction.user.id,

                    motivo,

                    casoId:
                        registro?.caso?.id ||
                        null,

                    logPublicado:
                        Boolean(
                            registro?.log?.publicado
                        )
                });

            // ==================================
            // AVISAR PROBLEMAS DE REGISTRO
            // ==================================

            let aviso = null;

            if (erroRegistro) {
                aviso =
                    '⚠️ O timeout foi removido no ' +
                    'Discord, mas houve uma falha ' +
                    'ao salvar o histórico no SQLite.';

            } else if (
                registro?.erroLog ||
                registro?.log?.publicado === false
            ) {
                aviso =
                    'ℹ️ A remoção foi salva no SQLite. ' +
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
                '[InovareSale | Untimeout] ' +
                `Timeout do usuário ${usuario.id} ` +
                'removido por ' +
                `${interaction.user.id}.`
            );

        } catch (erro) {
            console.error(
                '[InovareSale | Untimeout] Erro:',
                erro
            );

            try {
                await responderPrivado(
                    interaction,
                    mensagemErro(erro)
                );

            } catch (erroResposta) {
                console.error(
                    '[InovareSale | Untimeout] ' +
                    'Falha ao responder:',
                    erroResposta
                );
            }
        }
    }
};
