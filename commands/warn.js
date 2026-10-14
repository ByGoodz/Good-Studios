
'use strict';

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    EmbedBuilder,
    escapeMarkdown
} = require('discord.js');

const {
    registrarAdvertenciaComLog
} = require('../services/moderacaoService');

const { db } = require('../database/db');

const COR = 0x9951CB;
const LIMITE_MOTIVO = 450;

const SQL_ADVERTENCIAS_ATIVAS = db.prepare(`
    SELECT COUNT(*) AS total
    FROM moderacao_acoes_v3
    WHERE servidor_id = ?
      AND usuario_id = ?
      AND tipo = 'warn'
      AND advertencia_ativa = 1
`);

class ErroModeracao extends Error {
    constructor(mensagem) {
        super(mensagem);
        this.name = 'ErroModeracao';
    }
}

async function responderPrivado(interaction, conteudo) {
    const dados = typeof conteudo === 'string'
        ? { content: conteudo }
        : conteudo;

    const payload = {
        ...dados,
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
    const texto = interaction.options.getString(
        'motivo',
        true
    );

    const motivo = String(texto || '')
        .replace(/\u0000/g, '')
        .trim();

    if (!motivo) {
        throw new ErroModeracao(
            'Informe o motivo da advertência.'
        );
    }

    if (motivo.length > LIMITE_MOTIVO) {
        throw new ErroModeracao(
            `O motivo deve ter no máximo ${LIMITE_MOTIVO} caracteres.`
        );
    }

    return motivo;
}

function verificarPermissaoModeracao(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
        throw new ErroModeracao(
            'Esse comando só pode ser utilizado em servidores.'
        );
    }

    if (
        !interaction.memberPermissions?.has(
            PermissionFlagsBits.ModerateMembers
        )
    ) {
        throw new ErroModeracao(
            'Você precisa da permissão "Moderar membros" para aplicar advertências.'
        );
    }
}

async function buscarMembroAlvo(interaction, usuario) {
    try {
        return await interaction.guild.members.fetch({
            user: usuario.id,
            force: true
        });
    } catch (erro) {
        if (erro.code === 10007) {
            throw new ErroModeracao(
                'Esse usuário não está no servidor.'
            );
        }

        throw erro;
    }
}

async function verificarMembroAlvo(interaction, usuario) {
    const guild = interaction.guild;

    if (usuario.id === interaction.user.id) {
        throw new ErroModeracao(
            'Você não pode advertir a si mesmo.'
        );
    }

    if (usuario.bot) {
        throw new ErroModeracao(
            'Não é permitido advertir bots.'
        );
    }

    if (usuario.id === guild.ownerId) {
        throw new ErroModeracao(
            'Não é possível advertir o dono do servidor.'
        );
    }

    const membroAlvo = await buscarMembroAlvo(
        interaction,
        usuario
    );

    if (interaction.user.id !== guild.ownerId) {
        const moderador = await guild.members.fetch({
            user: interaction.user.id,
            force: true
        });

        const comparacao = moderador.roles.highest
            .comparePositionTo(
                membroAlvo.roles.highest
            );

        if (comparacao <= 0) {
            throw new ErroModeracao(
                'Você não pode advertir um membro com cargo igual ou superior ao seu.'
            );
        }
    }

    return membroAlvo;
}

function contarAdvertenciasAtivas(servidorId, usuarioId) {
    const resultado = SQL_ADVERTENCIAS_ATIVAS.get(
        servidorId,
        usuarioId
    );

    return Number(resultado?.total || 0);
}

function criarEmbedAdvertencia({
    usuario,
    moderador,
    motivo,
    caso,
    quantidadeAtivas,
    logPublicado
}) {
    const embed = new EmbedBuilder()
        .setColor(COR)
        .setTitle('INOVARESALE | ADVERTÊNCIA')
        .setDescription(
            '⚠️ **Advertência registrada com sucesso!**'
        )
        .addFields(
            {
                name: 'Membro advertido',
                value: `<@${usuario.id}>`,
                inline: true
            },
            {
                name: 'Moderador',
                value: `<@${moderador.id}>`,
                inline: true
            },
            {
                name: 'Número do caso',
                value: `#${caso.id}`,
                inline: true
            },
            {
                name: 'Motivo',
                value: escapeMarkdown(motivo),
                inline: false
            },
            {
                name: 'Advertências ativas',
                value: String(quantidadeAtivas),
                inline: true
            },
            {
                name: 'Situação',
                value: '🟡 Advertência ativa',
                inline: true
            }
        )
        .setFooter({
            text: 'InovareSale • Moderação 3.1'
        })
        .setTimestamp();

    if (logPublicado) {
        embed.addFields({
            name: 'Registro de logs',
            value: '✅ Processado',
            inline: true
        });
    }

    return embed;
}

async function registrarWarn(interaction, usuario, motivo) {
    return registrarAdvertenciaComLog({
        guild: interaction.guild,
        moderadorId: interaction.user.id,
        usuarioId: usuario.id,
        motivo,
        chaveEvento: `warn_${interaction.id}`
    });
}

function mensagemErro(erro) {
    if (erro instanceof ErroModeracao) {
        return `❌ ${erro.message}`;
    }

    if (erro.code === 50013 || erro.code === 50001) {
        return (
            '❌ O Discord recusou a operação. ' +
            'Verifique suas permissões.'
        );
    }

    return (
        '❌ Não foi possível registrar a advertência. ' +
        'Avise a administração.'
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription(
            'Aplica uma advertência a um membro.'
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ModerateMembers
        )
        .setDMPermission(false)
        .addUserOption(opcao =>
            opcao
                .setName('usuario')
                .setDescription(
                    'Membro que receberá a advertência'
                )
                .setRequired(true)
        )
        .addStringOption(opcao =>
            opcao
                .setName('motivo')
                .setDescription(
                    'Motivo da advertência'
                )
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(LIMITE_MOTIVO)
        ),

    async execute(interaction) {
        try {
            verificarPermissaoModeracao(interaction);

            const usuario = interaction.options.getUser(
                'usuario',
                true
            );

            const motivo = obterMotivo(interaction);

            await interaction.deferReply({
                flags: MessageFlags.Ephemeral
            });

            await verificarMembroAlvo(
                interaction,
                usuario
            );

            const resultado = await registrarWarn(
                interaction,
                usuario,
                motivo
            );

            if (!resultado?.caso) {
                throw new Error(
                    'O serviço não retornou a advertência registrada.'
                );
            }

            let quantidadeAtivas = null;

            try {
                quantidadeAtivas = contarAdvertenciasAtivas(
                    interaction.guildId,
                    usuario.id
                );
            } catch (erro) {
                console.warn(
                    '[InovareSale | Warn] Falha ao consultar advertências ativas:',
                    erro
                );
            }

            const embed = criarEmbedAdvertencia({
                usuario,
                moderador: interaction.user,
                motivo,
                caso: resultado.caso,
                quantidadeAtivas:
                    quantidadeAtivas === null
                        ? 'Indisponível'
                        : quantidadeAtivas,
                logPublicado: Boolean(
                    resultado.log?.publicado
                )
            });

            const aviso =
                resultado.erroLog ||
                resultado.log?.publicado === false
                    ? (
                        'ℹ️ A advertência foi salva no SQLite, ' +
                        'mas a publicação no canal de logs está pendente.'
                    )
                    : null;

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
                `[InovareSale | Warn] Advertência #${resultado.caso.id} aplicada ao usuário ${usuario.id} pelo moderador ${interaction.user.id}.`
            );
        } catch (erro) {
            console.error(
                '[InovareSale | Warn] Erro:',
                erro
            );

            try {
                await responderPrivado(
                    interaction,
                    mensagemErro(erro)
                );
            } catch (erroResposta) {
                console.error(
                    '[InovareSale | Warn] Falha ao responder:',
                    erroResposta
                );
            }
        }
    }
};
