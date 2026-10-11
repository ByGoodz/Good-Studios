
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
    registrarAcaoModeracaoComLog,
    formatarDuracaoPunicao
} = require('../services/moderacaoService');

// ==========================================
// INOVARESALE BOT 3.0
// COMANDO /TIMEOUT
// ==========================================

// Funcionalidades:
//
// - Aplicar castigo temporário
// - Aceitar segundos, minutos, horas e dias
// - Permitir durações combinadas
// - Limite máximo de 28 dias
// - Verificar permissões
// - Verificar hierarquia de cargos
// - Proteger dono e administradores
// - Registrar punição no SQLite
// - Enviar registro para os logs
// - Confirmar a ação ao moderador
//
// IMPORTANTE:
//
// Primeiro aplica o timeout no Discord.
// Depois registra a ação no SQLite.
//
// Se o registro falhar, o timeout
// aplicado não é desfeito.

// ==========================================
// CONFIGURAÇÕES
// ==========================================

const COR = 0x9951CB;

const MAXIMO_SEGUNDOS =
    28 * 24 * 60 * 60;

const LIMITE_MOTIVO = 450;

// ==========================================
// ERRO CONTROLADO
// ==========================================

class ErroTimeout extends Error {
    constructor(mensagem) {
        super(mensagem);

        this.name = 'ErroTimeout';
    }
}

// ==========================================
// FORMATAR RESPOSTA PRIVADA
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
// CONVERTER DURAÇÃO
// ==========================================

// Exemplos aceitos:
//
// 30s       = 30 segundos
// 10m       = 10 minutos
// 2h        = 2 horas
// 1d        = 1 dia
// 1h30m     = 1 hora e 30 minutos
// 2d 4h 5m  = 2 dias, 4 horas, 5 min
//
// Unidades:
//
// s = segundos
// m = minutos
// h = horas
// d = dias
//
// Não aceita valores sem unidade.

function converterDuracao(
    entrada
) {
    const texto = String(
        entrada ?? ''
    )
        .toLowerCase()
        .trim();

    if (!texto) {
        throw new ErroTimeout(
            'Informe uma duração. ' +
            'Exemplo: 10m, 2h ou 1d.'
        );
    }

    const fatores = {
        s: 1,
        m: 60,
        h: 3600,
        d: 86400
    };

    const expressao =
        /(\d+)\s*(d|h|m|s)/g;

    let total = 0;
    let posicao = 0;
    let encontrou = false;

    for (
        const resultado
        of texto.matchAll(expressao)
    ) {
        const inicio =
            resultado.index;

        // Só aceitamos espaços entre
        // as partes da duração.

        if (
            texto.slice(
                posicao,
                inicio
            ).trim()
        ) {
            throw new ErroTimeout(
                'Formato de duração inválido. ' +
                'Use 10m, 2h, 1d ou 1h30m.'
            );
        }

        const quantidade =
            Number(
                resultado[1]
            );

        const unidade =
            resultado[2];

        if (
            !Number.isSafeInteger(quantidade) ||
            quantidade < 0
        ) {
            throw new ErroTimeout(
                'A duração contém um número inválido.'
            );
        }

        const segundos =
            quantidade * fatores[unidade];

        if (
            !Number.isSafeInteger(segundos)
        ) {
            throw new ErroTimeout(
                'A duração informada é muito grande.'
            );
        }

        total += segundos;

        if (
            !Number.isSafeInteger(total) ||
            total > MAXIMO_SEGUNDOS
        ) {
            throw new ErroTimeout(
                'O timeout não pode ultrapassar 28 dias.'
            );
        }

        encontrou = true;

        posicao =
            inicio + resultado[0].length;
    }

    if (
        !encontrou ||
        texto.slice(posicao).trim()
    ) {
        throw new ErroTimeout(
            'Formato de duração inválido. ' +
            'Use 10m, 2h, 1d ou 1h30m.'
        );
    }

    if (total < 1) {
        throw new ErroTimeout(
            'O timeout deve durar pelo menos 1 segundo.'
        );
    }

    return {
        segundos: total,

        milissegundos:
            total * 1000,

        formatado:
            formatarDuracaoPunicao(
                total
            )
    };
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

    return texto
        ? texto.slice(0, LIMITE_MOTIVO)
        : 'Não informado';
}

// ==========================================
// VERIFICAR PERMISSÃO INICIAL
// ==========================================

function verificarPermissaoInicial(
    interaction
) {
    if (
        !interaction.inGuild() ||
        !interaction.guild
    ) {
        throw new ErroTimeout(
            'Este comando só funciona em servidores.'
        );
    }

    if (
        !interaction.memberPermissions?.has(
            PermissionFlagsBits.ModerateMembers
        )
    ) {
        throw new ErroTimeout(
            'Você precisa da permissão ' +
            '"Moderar membros" para aplicar timeouts.'
        );
    }
}

// ==========================================
// VERIFICAR MEMBRO E HIERARQUIA
// ==========================================

async function validarMembroAlvo(
    interaction,
    usuario
) {
    const guild =
        interaction.guild;

    const moderadorId =
        interaction.user.id;

    // ======================================
    // IMPEDIR AUTOPUNIÇÃO
    // ======================================

    if (
        usuario.id === moderadorId
    ) {
        throw new ErroTimeout(
            'Você não pode aplicar timeout em si mesmo.'
        );
    }

    // ======================================
    // PROTEGER BOTS
    // ======================================

    if (usuario.bot) {
        throw new ErroTimeout(
            'Não é possível aplicar timeout em bots.'
        );
    }

    // ======================================
    // PROTEGER DONO
    // ======================================

    if (
        usuario.id === guild.ownerId
    ) {
        throw new ErroTimeout(
            'Não é possível aplicar timeout ' +
            'no dono do servidor.'
        );
    }

    // ======================================
    // BUSCAR MEMBRO
    // ======================================

    let alvo;

    try {
        alvo = await guild.members.fetch(
            usuario.id
        );

    } catch (erro) {
        if (
            erro.code === 10007
        ) {
            throw new ErroTimeout(
                'Esse usuário não está no servidor.'
            );
        }

        throw erro;
    }

    // ======================================
    // CONFERIR PERMISSÃO DO BOT
    // ======================================

    const membroBot =
        guild.members.me ||
        await guild.members.fetchMe();

    if (
        !membroBot.permissions.has(
            PermissionFlagsBits.ModerateMembers
        )
    ) {
        throw new ErroTimeout(
            'O bot precisa da permissão ' +
            '"Moderar membros".'
        );
    }

    // ======================================
    // VERIFICAR SE O BOT PODE MODERAR
    // ======================================

    // moderatable considera restrições
    // impostas pelo Discord, incluindo
    // hierarquia e membros administradores.

    if (!alvo.moderatable) {
        throw new ErroTimeout(
            'O bot não pode aplicar timeout ' +
            'nesse membro. Verifique os cargos ' +
            'e as permissões.'
        );
    }

    // ======================================
    // VERIFICAR HIERARQUIA DO MODERADOR
    // ======================================

    if (
        moderadorId !== guild.ownerId
    ) {
        const moderador =
            await guild.members.fetch(
                moderadorId
            );

        const comparacao =
            moderador.roles.highest
                .comparePositionTo(
                    alvo.roles.highest
                );

        if (comparacao <= 0) {
            throw new ErroTimeout(
                'Você não pode aplicar timeout ' +
                'em um membro com cargo igual ' +
                'ou superior ao seu.'
            );
        }
    }

    return alvo;
}

// ==========================================
// CRIAR EMBED
// ==========================================

function criarEmbedTimeout({
    usuarioId,
    moderadorId,
    duracao,
    motivo,
    casoId,
    logPublicado
}) {
    const embed = new EmbedBuilder()
        .setColor(COR)
        .setTitle(
            'INOVARESALE | TIMEOUT'
        )
        .setDescription(
            '🔇 **Castigo temporário aplicado!**'
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
                name: 'Duração',
                value:
                    `\`${duracao}\``,
                inline: true
            },

            {
                name: 'Motivo',
                value:
                    escapeMarkdown(motivo),
                inline: false
            },

            {
                name: 'Situação',
                value:
                    '🔴 Timeout aplicado',
                inline: true
            }
        )
        .setFooter({
            text:
                'InovareSale • Moderação 3.0'
        })
        .setTimestamp();

    if (casoId) {
        embed.addFields({
            name: 'Número do caso',
            value:
                `#${casoId}`,
            inline: true
        });
    }

    if (logPublicado) {
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
// REGISTRAR TIMEOUT
// ==========================================

async function registrarTimeout(
    interaction,
    usuarioId,
    motivo,
    duracaoSegundos
) {
    return registrarAcaoModeracaoComLog({
        guild:
            interaction.guild,

        tipo:
            TIPOS.TIMEOUT,

        moderadorId:
            interaction.user.id,

        usuarioId,

        motivo,

        duracaoSegundos,

        chaveEvento:
            `timeout_${interaction.id}`
    });
}

// ==========================================
// TRATAR ERROS
// ==========================================

function mensagemErro(erro) {
    if (
        erro instanceof ErroTimeout
    ) {
        return `❌ ${erro.message}`;
    }

    if (
        erro.code === 50013 ||
        erro.code === 50001
    ) {
        return (
            '❌ O Discord recusou a ação. ' +
            'Confira as permissões e a ' +
            'hierarquia de cargos.'
        );
    }

    return (
        '❌ Não foi possível aplicar o timeout. ' +
        'Verifique as permissões e tente novamente.'
    );
}

// ==========================================
// COMANDO /TIMEOUT
// ==========================================

module.exports = {
    data:
        new SlashCommandBuilder()
            .setName('timeout')
            .setDescription(
                'Aplica um castigo temporário a um membro.'
            )
            .setDefaultMemberPermissions(
                PermissionFlagsBits.ModerateMembers
            )
            .setDMPermission(false)

            // ==================================
            // USUÁRIO
            // ==================================

            .addUserOption(opcao =>
                opcao
                    .setName('usuario')
                    .setDescription(
                        'Membro que receberá o timeout'
                    )
                    .setRequired(true)
            )

            // ==================================
            // DURAÇÃO
            // ==================================

            .addStringOption(opcao =>
                opcao
                    .setName('duracao')
                    .setDescription(
                        'Tempo: 10m, 2h, 1d ou 1h30m'
                    )
                    .setRequired(true)
                    .setMaxLength(60)
            )

            // ==================================
            // MOTIVO
            // ==================================

            .addStringOption(opcao =>
                opcao
                    .setName('motivo')
                    .setDescription(
                        'Motivo do castigo temporário'
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
            // LER DURAÇÃO
            // ==================================

            const duracao =
                converterDuracao(
                    interaction.options.getString(
                        'duracao',
                        true
                    )
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
                flags:
                    MessageFlags.Ephemeral
            });

            // ==================================
            // VERIFICAR ALVO E PERMISSÕES
            // ==================================

            const alvo =
                await validarMembroAlvo(
                    interaction,
                    usuario
                );

            // ==================================
            // APLICAR TIMEOUT NO DISCORD
            // ==================================

            await alvo.timeout(
                duracao.milissegundos,

                `InovareSale | ${motivo}`
            );

            // ==================================
            // REGISTRAR SQLITE E LOGS
            // ==================================

            let registro = null;
            let erroRegistro = null;

            try {
                registro =
                    await registrarTimeout(
                        interaction,
                        usuario.id,
                        motivo,
                        duracao.segundos
                    );

            } catch (erro) {
                erroRegistro = erro;

                console.error(
                    '[InovareSale | Timeout] ' +
                    'Timeout aplicado, mas houve ' +
                    'falha ao registrar o histórico:',
                    erro
                );
            }

            // ==================================
            // MONTAR EMBED
            // ==================================

            const embed =
                criarEmbedTimeout({
                    usuarioId:
                        usuario.id,

                    moderadorId:
                        interaction.user.id,

                    duracao:
                        duracao.formatado,

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
            // AVISO DE REGISTRO
            // ==================================

            let aviso = null;

            if (erroRegistro) {
                aviso =
                    '⚠️ O timeout foi aplicado no ' +
                    'Discord, mas houve erro ao ' +
                    'registrar o histórico no SQLite.';

            } else if (
                registro?.erroLog ||
                registro?.log?.publicado === false
            ) {
                aviso =
                    'ℹ️ Timeout salvo no SQLite. ' +
                    'A publicação do log está pendente.';
            }

            // ==================================
            // RESPONDER
            // ==================================

            await responderPrivado(
                interaction,
                {
                    content: aviso,
                    embeds: [embed]
                }
            );

            console.log(
                '[InovareSale | Timeout] ' +
                `Usuário ${usuario.id} recebeu ` +
                `${duracao.formatado} de timeout.`
            );

        } catch (erro) {
            console.error(
                '[InovareSale | Timeout] Erro:',
                erro
            );

            try {
                await responderPrivado(
                    interaction,
                    mensagemErro(erro)
                );

            } catch (erroResposta) {
                console.error(
                    '[InovareSale | Timeout] ' +
                    'Falha ao responder:',
                    erroResposta
                );
            }
        }
    }
};
