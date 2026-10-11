
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
// COMANDO /UNBAN
// ==========================================

// Funcionalidades:
//
// - Desbanir usuários pelo ID
// - Verificar permissão de moderação
// - Verificar permissão do próprio bot
// - Confirmar se o usuário está banido
// - Remover o banimento pelo Discord
// - Registrar a ação no SQLite
// - Enviar registro ao canal de logs
// - Impedir registros duplicados
// - Mostrar confirmação privada
//
// IMPORTANTE:
//
// A remoção do banimento acontece
// primeiro no Discord.
//
// O registro no SQLite só é criado
// após o Discord confirmar a ação.
//
// Se os logs falharem, o usuário
// permanece desbanido.

// ==========================================
// CONFIGURAÇÕES
// ==========================================

const COR = 0x9951CB;

const LIMITE_MOTIVO = 450;

// ==========================================
// VALIDAR ID DO USUÁRIO
// ==========================================

// Usuários banidos podem não estar
// presentes no servidor.
//
// Por isso, o comando utiliza o ID
// do Discord em uma opção de texto.

function validarUsuarioId(valor) {
    const id = String(
        valor ?? ''
    ).trim();

    if (!/^\d{17,22}$/.test(id)) {
        throw new Error(
            'Informe um ID válido do Discord. ' +
            'Exemplo: 123456789012345678.'
        );
    }

    return id;
}

// ==========================================
// VALIDAR MOTIVO
// ==========================================

function obterMotivo(interaction) {
    const texto = String(
        interaction.options.getString(
            'motivo'
        ) || 'Não informado'
    )
        .replace(/\u0000/g, '')
        .trim();

    if (!texto) {
        return 'Não informado';
    }

    return texto.slice(
        0,
        LIMITE_MOTIVO
    );
}

// ==========================================
// RESPONDER PRIVADAMENTE
// ==========================================

async function responderPrivado(
    interaction,
    conteudo
) {
    const payload =
        typeof conteudo === 'string'
            ? { content: conteudo }
            : conteudo;

    const dados = {
        ...payload,
        allowedMentions: {
            parse: []
        }
    };

    if (interaction.deferred) {
        return interaction.editReply(
            dados
        );
    }

    if (interaction.replied) {
        return interaction.followUp({
            ...dados,
            flags: MessageFlags.Ephemeral
        });
    }

    return interaction.reply({
        ...dados,
        flags: MessageFlags.Ephemeral
    });
}

// ==========================================
// VERIFICAR PERMISSÕES
// ==========================================

async function verificarPermissoes(
    interaction
) {
    const guild =
        interaction.guild;

    // ======================================
    // EXIGIR SERVIDOR
    // ======================================

    if (!guild) {
        throw new Error(
            'O comando /unban só pode ser ' +
            'utilizado em um servidor.'
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
            'Você precisa da permissão ' +
            '"Banir membros" para desbanir usuários.'
        );
    }

    // ======================================
    // PERMISSÃO DO BOT
    // ======================================

    const membroBot =
        guild.members.me ||
        await guild.members.fetchMe();

    if (
        !membroBot.permissions.has(
            PermissionFlagsBits.BanMembers
        )
    ) {
        throw new Error(
            'O bot não possui permissão ' +
            '"Banir membros" neste servidor.'
        );
    }
}

// ==========================================
// CONSULTAR BANIMENTO EXISTENTE
// ==========================================

async function buscarBanimento(
    guild,
    usuarioId
) {
    try {
        return await guild.bans.fetch(
            usuarioId
        );

    } catch (erro) {
        // Erro 10026:
        // Unknown Ban.
        //
        // Esse usuário não está
        // banido no servidor.
        //
        // Outros erros não são
        // tratados como ausência
        // de banimento.

        if (
            erro.code === 10026
        ) {
            return null;
        }

        throw erro;
    }
}

// ==========================================
// CRIAR EMBED DE CONFIRMAÇÃO
// ==========================================

function criarEmbedUnban({
    usuarioId,
    nomeUsuario,
    moderadorId,
    motivo,
    casoId,
    logPublicado
}) {
    const nome = String(
        nomeUsuario || 'Usuário'
    )
        .replace(/[\r\n]/g, ' ')
        .slice(0, 100);

    const embed =
        new EmbedBuilder()
            .setColor(COR)
            .setTitle(
                'INOVARESALE | DESBANIMENTO'
            )
            .setDescription(
                '✅ **Banimento removido com sucesso!**'
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
                    name: 'ID do usuário',
                    value:
                        `\`${usuarioId}\``,
                    inline: false
                },

                {
                    name: 'Motivo',
                    value:
                        motivo.slice(0, 1000),
                    inline: false
                }
            )
            .setFooter({
                text:
                    'InovareSale • Moderação 3.0'
            })
            .setTimestamp();

    if (
        nome &&
        nome !== 'Usuário'
    ) {
        embed.addFields({
            name: 'Nome',
            value: nome,
            inline: true
        });
    }

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
// REGISTRAR DESBANIMENTO
// ==========================================

// Chave baseada no ID da interação.
//
// Se a mesma interação for
// processada novamente, não
// cria um segundo caso SQLite.

async function registrarDesbanimento(
    interaction,
    usuarioId,
    motivo
) {
    return registrarAcaoModeracaoComLog({
        guild:
            interaction.guild,

        tipo:
            TIPOS.UNBAN,

        moderadorId:
            interaction.user.id,

        usuarioId,

        motivo,

        chaveEvento:
            `unban_${interaction.id}`
    });
}

// ==========================================
// TRATAR ERROS DO DISCORD
// ==========================================

function mensagemErro(erro) {
    if (
        erro.code === 50013 ||
        erro.code === 50001
    ) {
        return (
            '❌ O Discord recusou o desbanimento. ' +
            'Confira as permissões do bot.'
        );
    }

    if (
        erro.code === 10026
    ) {
        return (
            '⚠️ Esse usuário não está ' +
            'banido neste servidor.'
        );
    }

    if (
        erro.code === 10013
    ) {
        return (
            '❌ O usuário não foi encontrado ' +
            'pelo Discord.'
        );
    }

    // Mostrar erros de validação
    // controlados pelo próprio comando.

    const mensagensConhecidas = [
        'Informe um ID válido',
        'O comando /unban só pode',
        'Você precisa da permissão',
        'O bot não possui permissão'
    ];

    const mensagem = String(
        erro.message || ''
    );

    if (
        mensagensConhecidas.some(
            inicio =>
                mensagem.startsWith(inicio)
        )
    ) {
        return `❌ ${mensagem}`;
    }

    return (
        '❌ Não foi possível desbanir ' +
        'esse usuário. Verifique o ID, ' +
        'as permissões e tente novamente.'
    );
}

// ==========================================
// COMANDO /UNBAN
// ==========================================

module.exports = {
    data:
        new SlashCommandBuilder()
            .setName('unban')
            .setDescription(
                'Remove o banimento de um usuário.'
            )

            // Apenas moderadores com
            // permissão para banir membros.

            .setDefaultMemberPermissions(
                PermissionFlagsBits.BanMembers
            )

            // Comando disponível somente
            // dentro de servidores.

            .setDMPermission(false)

            // ==================================
            // ID DO USUÁRIO
            // ==================================

            .addStringOption(opcao =>
                opcao
                    .setName('usuario_id')
                    .setDescription(
                        'ID do usuário que será desbanido'
                    )
                    .setRequired(true)
                    .setMinLength(17)
                    .setMaxLength(22)
            )

            // ==================================
            // MOTIVO
            // ==================================

            .addStringOption(opcao =>
                opcao
                    .setName('motivo')
                    .setDescription(
                        'Motivo da remoção do banimento'
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
        try {
            // ==================================
            // LER OPÇÕES
            // ==================================

            const usuarioId =
                validarUsuarioId(
                    interaction.options.getString(
                        'usuario_id',
                        true
                    )
                );

            const motivo =
                obterMotivo(
                    interaction
                );

            // ==================================
            // VERIFICAR PERMISSÕES
            // ==================================

            await verificarPermissoes(
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
            // VERIFICAR BANIMENTO
            // ==================================

            const banimento =
                await buscarBanimento(
                    interaction.guild,
                    usuarioId
                );

            if (!banimento) {
                await responderPrivado(
                    interaction,
                    '⚠️ Esse usuário não está ' +
                    'banido neste servidor.'
                );

                return;
            }

            // ==================================
            // IDENTIFICAR USUÁRIO
            // ==================================

            const nomeUsuario =
                banimento.user?.username ||
                banimento.user?.tag ||
                'Usuário';

            // ==================================
            // REMOVER BANIMENTO NO DISCORD
            // ==================================

            await interaction.guild.members.unban(
                usuarioId,
                `InovareSale | ${motivo}`
            );

            // ==================================
            // SALVAR NO SQLITE E NOS LOGS
            // ==================================

            // O Discord já confirmou
            // que o usuário foi desbanido.
            //
            // A falha de um serviço de
            // registro não pode transformar
            // o resultado em "não desbanido".

            let registro = null;
            let erroRegistro = null;

            try {
                registro =
                    await registrarDesbanimento(
                        interaction,
                        usuarioId,
                        motivo
                    );

            } catch (erro) {
                erroRegistro = erro;

                console.error(
                    '[InovareSale | Unban] ' +
                    'Desbanimento realizado, ' +
                    'mas houve falha ao registrar:',
                    erro
                );
            }

            // ==================================
            // MONTAR CONFIRMAÇÃO
            // ==================================

            const embed =
                criarEmbedUnban({
                    usuarioId,

                    nomeUsuario,

                    moderadorId:
                        interaction.user.id,

                    motivo,

                    casoId:
                        registro?.caso?.id ||
                        null,

                    logPublicado:
                        registro?.log?.publicado ||
                        false
                });

            // ==================================
            // AVISAR PROBLEMAS DE REGISTRO
            // ==================================

            let aviso = null;

            if (erroRegistro) {
                aviso =
                    '⚠️ O desbanimento foi realizado ' +
                    'no Discord, mas houve uma ' +
                    'falha ao salvar o histórico. ' +
                    'Verifique o console do bot.';

            } else if (
                registro?.erroLog ||
                registro?.log?.publicado === false
            ) {
                aviso =
                    'ℹ️ Desbanimento salvo no SQLite. ' +
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

        } catch (erro) {
            console.error(
                '[InovareSale | Unban] Erro:',
                erro
            );

            try {
                await responderPrivado(
                    interaction,
                    mensagemErro(erro)
                );

            } catch (erroResposta) {
                console.error(
                    '[InovareSale | Unban] ' +
                    'Falha ao responder:',
                    erroResposta
                );
            }
        }
    }
};

