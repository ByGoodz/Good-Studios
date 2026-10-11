
'use strict';

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    EmbedBuilder,
    escapeMarkdown
} = require('discord.js');

const {
    registrarAdvertenciaComLog,
    listarAdvertenciasAtivas
} = require('../services/moderacaoService');

// ==========================================
// INOVARESALE BOT 3.0
// COMANDO /WARN
// ==========================================

// FUNCIONALIDADES:
//
// - Aplicar advertências a membros
// - Exigir permissão de moderação
// - Proteger o dono do servidor
// - Respeitar a hierarquia de cargos
// - Impedir advertências contra si mesmo
// - Impedir advertências contra bots
// - Salvar advertências no SQLite
// - Gerar número de caso
// - Contabilizar advertências ativas
// - Enviar registros ao canal de logs
// - Evitar registros duplicados
//
// IMPORTANTE:
//
// Advertência é um registro interno
// do sistema de moderação.
//
// O Discord não possui um botão
// nativo para aplicar advertências.
//
// O comando /unwarn será conectado
// ao mesmo banco posteriormente.

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

            flags:
                MessageFlags.Ephemeral
        });
    }

    return interaction.reply({
        ...payload,

        flags:
            MessageFlags.Ephemeral
    });
}

// ==========================================
// VALIDAR MOTIVO
// ==========================================

function obterMotivo(interaction) {
    const texto =
        interaction.options.getString(
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

    if (
        motivo.length > LIMITE_MOTIVO
    ) {
        throw new ErroModeracao(
            'O motivo é muito longo.'
        );
    }

    return motivo;
}

// ==========================================
// VERIFICAR PERMISSÃO DO MODERADOR
// ==========================================

function verificarPermissaoModeracao(
    interaction
) {
    if (!interaction.inGuild()) {
        throw new ErroModeracao(
            'Esse comando só pode ser ' +
            'utilizado em servidores.'
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
            'aplicar advertências.'
        );
    }
}

// ==========================================
// BUSCAR MEMBRO ALVO
// ==========================================

async function buscarMembroAlvo(
    interaction,
    usuario
) {
    const guild =
        interaction.guild;

    // Apenas membros que ainda estão
    // no servidor podem receber
    // novas advertências.

    try {
        return await guild.members.fetch(
            usuario.id
        );

    } catch (erro) {
        if (
            erro.code === 10007
        ) {
            throw new ErroModeracao(
                'Esse usuário não está ' +
                'no servidor.'
            );
        }

        throw erro;
    }
}

// ==========================================
// VERIFICAR RESTRIÇÕES DO ALVO
// ==========================================

async function verificarMembroAlvo(
    interaction,
    usuario
) {
    const guild =
        interaction.guild;

    // ======================================
    // IMPEDIR ADVERTÊNCIA EM SI MESMO
    // ======================================

    if (
        usuario.id ===
        interaction.user.id
    ) {
        throw new ErroModeracao(
            'Você não pode advertir ' +
            'a si mesmo.'
        );
    }

    // ======================================
    // IMPEDIR ADVERTÊNCIA EM BOTS
    // ======================================

    if (usuario.bot) {
        throw new ErroModeracao(
            'Não é permitido advertir bots.'
        );
    }

    // ======================================
    // PROTEGER DONO DO SERVIDOR
    // ======================================

    if (
        usuario.id ===
        guild.ownerId
    ) {
        throw new ErroModeracao(
            'Não é possível advertir ' +
            'o dono do servidor.'
        );
    }

    // ======================================
    // CONSULTAR MEMBRO
    // ======================================

    const membroAlvo =
        await buscarMembroAlvo(
            interaction,
            usuario
        );

    // ======================================
    // HIERARQUIA DE CARGOS
    // ======================================

    // O dono do servidor pode
    // moderar qualquer membro.
    //
    // Os demais moderadores só
    // podem advertir membros com
    // cargo inferior ao seu.

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
                    membroAlvo.roles.highest
                );

        if (
            comparacao <= 0
        ) {
            throw new ErroModeracao(
                'Você não pode advertir ' +
                'um membro com cargo ' +
                'igual ou superior ao seu.'
            );
        }
    }

    return membroAlvo;
}

// ==========================================
// CRIAR EMBED DE ADVERTÊNCIA
// ==========================================

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
        .setTitle(
            'INOVARESALE | ADVERTÊNCIA'
        )
        .setDescription(
            '⚠️ **Advertência registrada com sucesso!**'
        )
        .addFields(
            {
                name: 'Membro advertido',
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
                name: 'Número do caso',
                value:
                    `#${caso.id}`,
                inline: true
            },

            {
                name: 'Motivo',
                value:
                    escapeMarkdown(
                        motivo
                    ),
                inline: false
            },

            {
                name: 'Advertências ativas',
                value: String(
                    quantidadeAtivas
                ),
                inline: true
            },

            {
                name: 'Situação',
                value:
                    '🟡 Advertência ativa',
                inline: true
            }
        )
        .setFooter({
            text:
                'InovareSale • Moderação 3.0'
        })
        .setTimestamp();

    if (logPublicado) {
        embed.addFields({
            name: 'Registro de logs',
            value:
                '✅ Processado',
            inline: true
        });
    }

    return embed;
}

// ==========================================
// REGISTRAR ADVERTÊNCIA
// ==========================================

async function registrarWarn(
    interaction,
    usuario,
    motivo
) {
    return registrarAdvertenciaComLog({
        guild:
            interaction.guild,

        moderadorId:
            interaction.user.id,

        usuarioId:
            usuario.id,

        motivo,

        // Cada interação do Discord
        // possui um ID único.
        //
        // Esse identificador evita
        // duplicar advertências caso
        // o processamento seja repetido.

        chaveEvento:
            `warn_${interaction.id}`
    });
}

// ==========================================
// CONSULTAR ADVERTÊNCIAS ATIVAS
// ==========================================

function contarAdvertenciasAtivas(
    interaction,
    usuario
) {
    // O serviço retorna no máximo
    // 100 registros por consulta.
    //
    // Aqui usamos o resultado apenas
    // como uma estimativa limitada.
    //
    // Uma contagem exata de históricos
    // maiores será incluída na revisão
    // do serviço de moderação.

    return listarAdvertenciasAtivas(
        interaction.guildId,
        usuario.id,
        100
    ).length;
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
            '❌ O Discord recusou a operação. ' +
            'Verifique suas permissões.'
        );
    }

    return (
        '❌ Não foi possível registrar ' +
        'a advertência. Avise a administração.'
    );
}

// ==========================================
// COMANDO /WARN
// ==========================================

module.exports = {
    data:
        new SlashCommandBuilder()
            .setName('warn')
            .setDescription(
                'Aplica uma advertência a um membro.'
            )

            // Somente quem possui permissão
            // para moderar membros.

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
                        'Membro que receberá a advertência'
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
                        'Motivo da advertência'
                    )
                    .setRequired(true)
                    .setMinLength(1)
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
            // VALIDAR SERVIDOR E MODERADOR
            // ==================================

            verificarPermissaoModeracao(
                interaction
            );

            // ==================================
            // LER OPÇÕES DO COMANDO
            // ==================================

            const usuario =
                interaction.options.getUser(
                    'usuario',
                    true
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
            // VERIFICAR MEMBRO E HIERARQUIA
            // ==================================

            await verificarMembroAlvo(
                interaction,
                usuario
            );

            // ==================================
            // SALVAR ADVERTÊNCIA NO SQLITE
            // ==================================

            const resultado =
                await registrarWarn(
                    interaction,
                    usuario,
                    motivo
                );

            if (
                !resultado?.caso
            ) {
                throw new Error(
                    'O serviço não retornou ' +
                    'a advertência registrada.'
                );
            }

            // ==================================
            // CONTAR ADVERTÊNCIAS ATIVAS
            // ==================================

            let quantidadeAtivas = null;

            try {
                quantidadeAtivas =
                    contarAdvertenciasAtivas(
                        interaction,
                        usuario
                    );

            } catch (erro) {
                console.warn(
                    '[InovareSale | Warn] ' +
                    'Não foi possível consultar ' +
                    'as advertências ativas:',
                    erro.message
                );
            }

            // ==================================
            // MONTAR EMBED
            // ==================================

            const embed =
                criarEmbedAdvertencia({
                    usuario,

                    moderador:
                        interaction.user,

                    motivo,

                    caso:
                        resultado.caso,

                    quantidadeAtivas:
                        quantidadeAtivas === null
                            ? 'Não disponível'
                            : quantidadeAtivas,

                    logPublicado:
                        Boolean(
                            resultado.log?.publicado
                        )
                });

            // ==================================
            // AVISAR SOBRE LOGS PENDENTES
            // ==================================

            let aviso = null;

            if (
                resultado.erroLog ||
                resultado.log?.publicado === false
            ) {
                aviso =
                    'ℹ️ A advertência foi salva ' +
                    'no SQLite, mas a publicação ' +
                    'no canal de logs está pendente.';
            }

            // ==================================
            // CONFIRMAR AO MODERADOR
            // ==================================

            await responderPrivado(
                interaction,
                {
                    content: aviso,
                    embeds: [embed]
                }
            );

            console.log(
                '[InovareSale | Warn] ' +
                `Advertência #${resultado.caso.id} ` +
                `aplicada ao usuário ${usuario.id}.`
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
                    '[InovareSale | Warn] ' +
                    'Falha ao responder:',
                    erroResposta
                );
            }
        }
    }
};
