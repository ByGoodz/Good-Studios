
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

const COR = 0x9951CB;
const LIMITE_MOTIVO = 450;

class ErroModeracao extends Error {
    constructor(mensagem) {
        super(mensagem);
        this.name = 'ErroModeracao';
    }
}

async function responderPrivado(interaction, dados) {
    const conteudo = typeof dados === 'string'
        ? { content: dados }
        : dados;

    const payload = {
        ...conteudo,
        allowedMentions: {
            parse: []
        }
    };

    if (interaction.deferred) {
        return interaction.editReply(payload);
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

function obterMotivo(interaction) {
    const motivo = String(
        interaction.options.getString('motivo') ||
        'Não informado'
    )
        .replace(/\u0000/g, '')
        .trim();

    return motivo
        ? motivo.slice(0, LIMITE_MOTIVO)
        : 'Não informado';
}

async function verificarPermissoes(interaction, usuario) {
    const guild = interaction.guild;
    const moderador = interaction.user;

    if (!guild || !interaction.inGuild()) {
        throw new ErroModeracao(
            'O comando /ban só pode ser utilizado em servidores.'
        );
    }

    if (
        !interaction.memberPermissions?.has(
            PermissionFlagsBits.BanMembers
        )
    ) {
        throw new ErroModeracao(
            'Você não possui permissão para banir usuários.'
        );
    }

    if (usuario.id === moderador.id) {
        throw new ErroModeracao(
            'Você não pode banir a si mesmo.'
        );
    }

    if (usuario.id === interaction.client.user.id) {
        throw new ErroModeracao(
            'Não é possível banir o próprio bot.'
        );
    }

    if (usuario.id === guild.ownerId) {
        throw new ErroModeracao(
            'Não é possível banir o dono do servidor.'
        );
    }

    const botMembro =
        guild.members.me ||
        await guild.members.fetchMe();

    if (
        !botMembro.permissions.has(
            PermissionFlagsBits.BanMembers
        )
    ) {
        throw new ErroModeracao(
            'O bot não possui a permissão "Banir membros".'
        );
    }

    let membroAlvo;

    try {
        membroAlvo = await guild.members.fetch({
            user: usuario.id,
            force: true
        });
    } catch (erro) {
        if (erro.code !== 10007) {
            throw erro;
        }

        membroAlvo = null;
    }

    if (!membroAlvo) {
        return;
    }

    if (!membroAlvo.bannable) {
        throw new ErroModeracao(
            'Não consigo banir esse usuário. Verifique a hierarquia dos cargos do bot.'
        );
    }

    if (moderador.id !== guild.ownerId) {
        const membroModerador =
            await guild.members.fetch({
                user: moderador.id,
                force: true
            });

        const comparacao =
            membroModerador.roles.highest
                .comparePositionTo(
                    membroAlvo.roles.highest
                );

        if (comparacao <= 0) {
            throw new ErroModeracao(
                'Você não pode banir um usuário com cargo igual ou superior ao seu.'
            );
        }
    }
}

async function verificarBanimentoExistente(guild, usuarioId) {
    try {
        const banimento = await guild.bans.fetch(
            usuarioId
        );

        return Boolean(banimento);
    } catch (erro) {
        if (erro.code === 10026) {
            return false;
        }

        throw erro;
    }
}

function criarEmbedBan({
    usuario,
    moderador,
    motivo,
    casoId,
    logPublicado
}) {
    const embed = new EmbedBuilder()
        .setColor(COR)
        .setTitle('INOVARESALE | BANIMENTO')
        .setDescription(
            '🔨 **Usuário banido com sucesso!**'
        )
        .addFields(
            {
                name: 'Usuário',
                value: `<@${usuario.id}>`,
                inline: true
            },
            {
                name: 'Moderador',
                value: `<@${moderador.id}>`,
                inline: true
            },
            {
                name: 'ID do usuário',
                value: `\`${usuario.id}\``,
                inline: false
            },
            {
                name: 'Motivo',
                value: escapeMarkdown(motivo),
                inline: false
            }
        )
        .setFooter({
            text: 'InovareSale • Moderação 3.1'
        })
        .setTimestamp();

    if (casoId) {
        embed.addFields({
            name: 'Caso registrado',
            value: `#${casoId}`,
            inline: true
        });
    }

    if (logPublicado) {
        embed.addFields({
            name: 'Log',
            value: '✅ Registro processado',
            inline: true
        });
    }

    return embed;
}

async function registrarBanimento(
    interaction,
    usuario,
    motivo
) {
    return registrarAcaoModeracaoComLog({
        guild: interaction.guild,
        tipo: TIPOS.BAN,
        moderadorId: interaction.user.id,
        usuarioId: usuario.id,
        motivo,
        chaveEvento: `ban_${interaction.id}`
    });
}

function mensagemErro(erro) {
    if (erro instanceof ErroModeracao) {
        return `❌ ${erro.message}`;
    }

    if (
        erro.code === 50013 ||
        erro.code === 50001
    ) {
        return (
            '❌ O Discord recusou a operação. ' +
            'Confira as permissões e a hierarquia dos cargos.'
        );
    }

    if (erro.code === 10013) {
        return '❌ Usuário não encontrado.';
    }

    if (erro.code === 10026) {
        return '❌ Não foi possível consultar o banimento.';
    }

    return (
        '❌ Não foi possível concluir o banimento. ' +
        'Verifique os logs do bot.'
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription(
            'Bane um usuário do servidor.'
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.BanMembers
        )
        .setDMPermission(false)
        .addUserOption(opcao =>
            opcao
                .setName('usuario')
                .setDescription(
                    'Usuário que será banido'
                )
                .setRequired(true)
        )
        .addStringOption(opcao =>
            opcao
                .setName('motivo')
                .setDescription(
                    'Motivo do banimento'
                )
                .setMaxLength(LIMITE_MOTIVO)
                .setRequired(false)
        ),

    async execute(interaction) {
        let banimentoExecutado = false;

        try {
            const usuario =
                interaction.options.getUser(
                    'usuario',
                    true
                );

            const motivo = obterMotivo(
                interaction
            );

            await interaction.deferReply({
                flags: MessageFlags.Ephemeral
            });

            await verificarPermissoes(
                interaction,
                usuario
            );

            const jaBanido =
                await verificarBanimentoExistente(
                    interaction.guild,
                    usuario.id
                );

            if (jaBanido) {
                await responderPrivado(
                    interaction,
                    '⚠️ Esse usuário já está banido do servidor.'
                );

                return;
            }

            await interaction.guild.members.ban(
                usuario.id,
                {
                    reason: `InovareSale | ${motivo}`,
                    deleteMessageSeconds: 0
                }
            );

            banimentoExecutado = true;

            let registro = null;
            let erroRegistro = null;

            try {
                registro = await registrarBanimento(
                    interaction,
                    usuario,
                    motivo
                );
            } catch (erro) {
                erroRegistro = erro;

                console.error(
                    '[InovareSale | Ban] Banimento executado, mas não registrado no SQLite:',
                    erro
                );
            }

            const embed = criarEmbedBan({
                usuario,
                moderador: interaction.user,
                motivo,
                casoId: registro?.caso?.id || null,
                logPublicado: Boolean(
                    registro?.log?.publicado
                )
            });

            let aviso = null;

            if (erroRegistro) {
                aviso =
                    '⚠️ O banimento foi realizado no Discord, ' +
                    'mas houve uma falha ao salvar o histórico. ' +
                    'Verifique os logs do bot.';
            } else if (
                registro?.erroLog ||
                registro?.log?.publicado === false
            ) {
                aviso =
                    'ℹ️ O banimento foi registrado no SQLite, ' +
                    'mas o envio ao canal de logs está pendente.';
            }

            const resposta = {
                embeds: [embed]
            };

            if (aviso) {
                resposta.content = aviso;
            }

            await responderPrivado(
                interaction,
                resposta
            );

            console.log(
                `[InovareSale | Ban] Usuário ${usuario.id} banido pelo moderador ${interaction.user.id}.`
            );
        } catch (erro) {
            console.error(
                '[InovareSale | Ban] Erro:',
                erro
            );

            const mensagem = banimentoExecutado
                ? (
                    '⚠️ O usuário foi banido, mas ocorreu ' +
                    'uma falha ao enviar a confirmação. ' +
                    'Verifique o histórico e os logs.'
                )
                : mensagemErro(erro);

            try {
                await responderPrivado(
                    interaction,
                    mensagem
                );
            } catch (erroResposta) {
                console.error(
                    '[InovareSale | Ban] Falha ao responder:',
                    erroResposta
                );
            }
        }
    }
};
