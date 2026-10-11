
'use strict';

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    EmbedBuilder
} = require('discord.js');

const {
    TIPOS,
    registrarAcaoModeracaoComLog
} = require('../services/moderacaoService');

// ==========================================
// INOVARESALE BOT 3.0
// COMANDO /BAN
// ==========================================

// Funcionalidades:
//
// - Banir usuários do servidor
// - Exigir permissão de banimento
// - Verificar permissões do próprio bot
// - Impedir autobanimento
// - Proteger o dono do servidor
// - Respeitar a hierarquia de cargos
// - Salvar o banimento no SQLite
// - Registrar a ação no canal de logs
// - Evitar registros repetidos da interação
//
// IMPORTANTE:
//
// O banimento é realizado primeiro
// no Discord.
//
// Somente depois de confirmado,
// a ação é registrada no SQLite.
//
// Se o envio do log falhar,
// o banimento não será desfeito.

// ==========================================
// CONFIGURAÇÕES
// ==========================================

const COR = 0x9951CB;

const LIMITE_MOTIVO = 450;

// ==========================================
// VALIDAR MOTIVO
// ==========================================

function obterMotivo(interaction) {
    const motivo = String(
        interaction.options.getString(
            'motivo'
        ) || 'Não informado'
    )
        .replace(/\u0000/g, '')
        .trim();

    if (!motivo) {
        return 'Não informado';
    }

    return motivo.slice(
        0,
        LIMITE_MOTIVO
    );
}

// ==========================================
// RESPONDER PRIVADAMENTE
// ==========================================

async function responderPrivado(
    interaction,
    dados
) {
    const payload =
        typeof dados === 'string'
            ? { content: dados }
            : dados;

    const resposta = {
        ...payload,

        allowedMentions: {
            parse: []
        }
    };

    if (interaction.deferred) {
        return interaction.editReply(
            resposta
        );
    }

    if (interaction.replied) {
        return interaction.followUp({
            ...resposta,
            flags: MessageFlags.Ephemeral
        });
    }

    return interaction.reply({
        ...resposta,
        flags: MessageFlags.Ephemeral
    });
}

// ==========================================
// VERIFICAR PERMISSÕES
// ==========================================

async function verificarPermissoes(
    interaction,
    usuario
) {
    const guild =
        interaction.guild;

    const moderador =
        interaction.user;

    // ======================================
    // SERVIDOR OBRIGATÓRIO
    // ======================================

    if (!guild) {
        throw new Error(
            'O comando /ban só pode ser ' +
            'utilizado dentro de um servidor.'
        );
    }

    // ======================================
    // PERMISSÃO DO MODERADOR
    // ======================================

    if (
        !interaction.memberPermissions?.has(
            PermissionFlagsBits.BanMembers
        )
    ) {
        throw new Error(
            'Você não possui permissão ' +
            'para banir usuários.'
        );
    }

    // ======================================
    // IMPEDIR AUTOBANIMENTO
    // ======================================

    if (
        usuario.id === moderador.id
    ) {
        throw new Error(
            'Você não pode banir a si mesmo.'
        );
    }

    // ======================================
    // PROTEGER O BOT
    // ======================================

    if (
        usuario.id ===
        interaction.client.user.id
    ) {
        throw new Error(
            'Não é possível banir o próprio bot.'
        );
    }

    // ======================================
    // PROTEGER O DONO DO SERVIDOR
    // ======================================

    if (
        usuario.id ===
        guild.ownerId
    ) {
        throw new Error(
            'Não é possível banir o dono do servidor.'
        );
    }

    // ======================================
    // PERMISSÃO DO BOT
    // ======================================

    const botMembro =
        guild.members.me ||
        await guild.members.fetchMe();

    if (
        !botMembro.permissions.has(
            PermissionFlagsBits.BanMembers
        )
    ) {
        throw new Error(
            'O bot não possui a permissão ' +
            '"Banir membros" neste servidor.'
        );
    }

    // ======================================
    // BUSCAR MEMBRO ALVO
    // ======================================

    // O Discord permite banir usuários
    // que já saíram do servidor.
    //
    // Nesse caso, não existe cargo
    // dentro do servidor para comparar.

    const membroAlvo =
        await guild.members.fetch(
            usuario.id
        ).catch(erro => {
            // Discord: membro desconhecido.
            //
            // Outros erros não devem
            // ser interpretados como
            // ausência do usuário.

            if (
                erro.code === 10007
            ) {
                return null;
            }

            throw erro;
        });

    if (!membroAlvo) {
        return;
    }

    // ======================================
    // HIERARQUIA DO BOT
    // ======================================

    if (
        !membroAlvo.bannable
    ) {
        throw new Error(
            'Não consigo banir esse usuário. ' +
            'Verifique a hierarquia dos cargos do bot.'
        );
    }

    // ======================================
    // HIERARQUIA DO MODERADOR
    // ======================================

    // O dono do servidor não está
    // limitado pela hierarquia de cargos.
    //
    // Outros moderadores só podem banir
    // pessoas abaixo do cargo mais alto.

    if (
        moderador.id !==
        guild.ownerId
    ) {
        const membroModerador =
            await guild.members.fetch(
                moderador.id
            );

        const comparacao =
            membroModerador.roles.highest
                .comparePositionTo(
                    membroAlvo.roles.highest
                );

        if (comparacao <= 0) {
            throw new Error(
                'Você não pode banir um usuário ' +
                'com cargo igual ou superior ao seu.'
            );
        }
    }
}

// ==========================================
// MONTAR EMBED DE CONFIRMAÇÃO
// ==========================================

function criarEmbedBan({
    usuario,
    moderador,
    motivo,
    casoId,
    logPublicado
}) {
    const embed =
        new EmbedBuilder()
            .setColor(COR)
            .setTitle(
                'INOVARESALE | BANIMENTO'
            )
            .setDescription(
                '🔨 **Usuário banido com sucesso!**'
            )
            .addFields(
                {
                    name: 'Usuário',
                    value:
                        `<@${usuario.id}>`,
                    inline: true
                },

                {
                    name: 'Moderador',
                    value:
                        `<@${moderador.id}>`,
                    inline: true
                },

                {
                    name: 'ID do usuário',
                    value:
                        `\`${usuario.id}\``,
                    inline: false
                },

                {
                    name: 'Motivo',
                    value:
                        motivo,
                    inline: false
                }
            )
            .setFooter({
                text:
                    'InovareSale • Moderação 3.0'
            })
            .setTimestamp();

    if (casoId) {
        embed.addFields({
            name: 'Caso registrado',
            value:
                `#${casoId}`,
            inline: true
        });
    }

    if (logPublicado === true) {
        embed.addFields({
            name: 'Log',
            value:
                'Registro processado',
            inline: true
        });
    }

    return embed;
}

// ==========================================
// REGISTRAR BANIMENTO
// ==========================================

async function registrarBanimento(
    interaction,
    usuario,
    motivo
) {
    return registrarAcaoModeracaoComLog({
        guild:
            interaction.guild,

        tipo:
            TIPOS.BAN,

        moderadorId:
            interaction.user.id,

        usuarioId:
            usuario.id,

        motivo,

        // ID da interação é único.
        //
        // Isso impede registrar dois
        // casos para a mesma execução.

        chaveEvento:
            `ban_${interaction.id}`
    });
}

// ==========================================
// COMANDO PRINCIPAL
// ==========================================

module.exports = {
    data:
        new SlashCommandBuilder()
            .setName('ban')
            .setDescription(
                'Bane um usuário do servidor.'
            )
            .setDefaultMemberPermissions(
                PermissionFlagsBits.BanMembers
            )
            .setDMPermission(false)

            // ==================================
            // USUÁRIO
            // ==================================

            .addUserOption(opcao =>
                opcao
                    .setName('usuario')
                    .setDescription(
                        'Usuário que será banido'
                    )
                    .setRequired(true)
            )

            // ==================================
            // MOTIVO
            // ==================================

            .addStringOption(opcao =>
                opcao
                    .setName('motivo')
                    .setDescription(
                        'Motivo do banimento'
                    )
                    .setMaxLength(
                        LIMITE_MOTIVO
                    )
                    .setRequired(false)
            ),

    // ======================================
    // EXECUTAR COMANDO
    // ======================================

    async execute(interaction) {
        const usuario =
            interaction.options.getUser(
                'usuario',
                true
            );

        const motivo =
            obterMotivo(interaction);

        try {
            // ==================================
            // VERIFICAR PERMISSÕES
            // ==================================

            await verificarPermissoes(
                interaction,
                usuario
            );

            // ==================================
            // ADIAR RESPOSTA
            // ==================================

            await interaction.deferReply({
                flags: MessageFlags.Ephemeral
            });

            // ==================================
            // VERIFICAR BANIMENTO EXISTENTE
            // ==================================

            let banimentoExistente = null;

            try {
                banimentoExistente =
                    await interaction.guild.bans.fetch(
                        usuario.id
                    );

            } catch (erro) {
                // Código 10026:
                // banimento desconhecido.
                //
                // Qualquer outro erro
                // precisa ser tratado.

                if (
                    erro.code !== 10026
                ) {
                    throw erro;
                }
            }

            if (banimentoExistente) {
                await responderPrivado(
                    interaction,
                    '⚠️ Esse usuário já está ' +
                    'banido do servidor.'
                );

                return;
            }

            // ==================================
            // EXECUTAR BANIMENTO NO DISCORD
            // ==================================

            await interaction.guild.members.ban(
                usuario.id,
                {
                    reason:
                        `InovareSale | ${motivo}`,

                    // Não apagar mensagens
                    // anteriores automaticamente.
                    deleteMessageSeconds: 0
                }
            );

            // ==================================
            // REGISTRAR NO SQLITE
            // ==================================

            let registro = null;
            let erroRegistro = null;

            try {
                registro =
                    await registrarBanimento(
                        interaction,
                        usuario,
                        motivo
                    );

            } catch (erro) {
                erroRegistro = erro;

                console.error(
                    '[InovareSale | Ban] ' +
                    'Banimento concluído, mas ' +
                    'não registrado no SQLite:',
                    erro
                );
            }

            // ==================================
            // EMBED DE CONFIRMAÇÃO
            // ==================================

            const embed = criarEmbedBan({
                usuario,

                moderador:
                    interaction.user,

                motivo,

                casoId:
                    registro?.caso?.id ||
                    null,

                logPublicado:
                    registro?.log?.publicado ||
                    false
            });

            // ==================================
            // AVISAR FALHA DE REGISTRO
            // ==================================

            let aviso = null;

            if (erroRegistro) {
                aviso =
                    '⚠️ O banimento foi realizado ' +
                    'no Discord, mas houve uma ' +
                    'falha ao salvar o histórico. ' +
                    'Verifique o console do bot.';

            } else if (
                registro?.erroLog ||
                registro?.log?.publicado === false
            ) {
                aviso =
                    'ℹ️ Banimento registrado no ' +
                    'SQLite. A publicação do log ' +
                    'está pendente.';
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

        } catch (erro) {
            console.error(
                '[InovareSale | Ban] Erro:',
                erro
            );

            // ==================================
            // TRATAR FALHA DE PERMISSÃO
            // ==================================

            let mensagem =
                '❌ Não foi possível banir ' +
                'esse usuário.';

            if (
                erro.code === 50013 ||
                erro.code === 50001
            ) {
                mensagem =
                    '❌ O Discord recusou a ação. ' +
                    'Confira as permissões e a ' +
                    'hierarquia dos cargos.';

            } else if (
                erro.code === 10013
            ) {
                mensagem =
                    '❌ Usuário não encontrado.';

            } else if (
                !erro.code &&
                erro.message
            ) {
                mensagem =
                    `❌ ${String(
                        erro.message
                    ).slice(0, 500)}`;
            }

            try {
                await responderPrivado(
                    interaction,
                    mensagem
                );

            } catch (erroResposta) {
                console.error(
                    '[InovareSale | Ban] ' +
                    'Falha ao responder:',
                    erroResposta
                );
            }
        }
    }
};
