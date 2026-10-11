
'use strict';

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    EmbedBuilder
} = require('discord.js');

const {
    registrarVenda,
    formatarDinheiro,
    formatarRobux
} = require('../services/vendaService');

// ==========================================
// INOVARESALE BOT 3.0
// COMANDO /VENDA
// ==========================================

// FUNCIONALIDADES:
//
// - Registrar vendas manualmente
// - Permitir uso apenas por administradores
// - Identificar o cliente
// - Registrar valor pago em reais
// - Registrar quantidade de Robux
// - Preservar histórico das compras
// - Atualizar o perfil do cliente
// - Atualizar cargos de fidelidade
// - Publicar anúncio no canal de vendas
// - Registrar a ação nos logs
// - Impedir duplicidade da mesma interação
// - Responder privadamente ao administrador
//
// IMPORTANTE:
//
// Não registra vendas de ticket.
//
// Este comando é usado para vendas
// adicionadas manualmente pela equipe.
//
// O vendaService.js cuida do SQLite,
// dos cargos e da publicação.
//
// Não executar operações financeiras
// diretamente neste arquivo.

// ==========================================
// CONFIGURAÇÕES
// ==========================================

const COR = 0x9951CB;

const VALOR_MAXIMO = 10000000;

const ROBUX_MAXIMO = 50000000;

// ==========================================
// ERROS CONTROLADOS
// ==========================================

class ErroVenda extends Error {
    constructor(mensagem) {
        super(mensagem);

        this.name = 'ErroVenda';
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
            ? {
                content: conteudo
            }
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
// VERIFICAR PERMISSÃO
// ==========================================

// Mesmo que o interactionCreate.js
// já verifique os administradores,
// mantemos a proteção aqui.
//
// Isso evita que o comando seja
// executado sem autorização caso
// o carregador seja alterado.

function verificarPermissao(
    interaction
) {
    if (
        !interaction.guild ||
        !interaction.inGuild()
    ) {
        throw new ErroVenda(
            'O comando /venda só pode ' +
            'ser usado em servidores.'
        );
    }

    if (
        !interaction.memberPermissions?.has(
            PermissionFlagsBits.Administrator
        )
    ) {
        throw new ErroVenda(
            'Apenas administradores podem ' +
            'registrar vendas manualmente.'
        );
    }
}

// ==========================================
// VALIDAR VALOR DA COMPRA
// ==========================================

function validarValorCompra(
    valor
) {
    const numero =
        Number(valor);

    if (
        !Number.isFinite(numero) ||
        numero <= 0 ||
        numero > VALOR_MAXIMO
    ) {
        throw new ErroVenda(
            'Informe um valor válido e ' +
            'maior que zero.'
        );
    }

    // O histórico monetário aceita
    // no máximo duas casas decimais.
    //
    // Usamos tolerância mínima para
    // evitar problemas de representação
    // de números decimais em JavaScript.

    const centavos =
        Math.round(
            numero * 100
        );

    if (
        !Number.isSafeInteger(centavos) ||
        Math.abs(
            numero * 100 - centavos
        ) > 0.00001
    ) {
        throw new ErroVenda(
            'O valor deve ter no máximo ' +
            'duas casas decimais.'
        );
    }

    return centavos / 100;
}

// ==========================================
// VALIDAR QUANTIDADE DE ROBUX
// ==========================================

function validarQuantidadeRobux(
    quantia
) {
    const numero =
        Number(quantia);

    if (
        !Number.isSafeInteger(numero) ||
        numero < 1 ||
        numero > ROBUX_MAXIMO
    ) {
        throw new ErroVenda(
            'A quantidade de Robux deve ' +
            'ser um número inteiro entre ' +
            '1 e 50.000.000.'
        );
    }

    return numero;
}

// ==========================================
// VALIDAR CLIENTE
// ==========================================

function validarCliente(
    interaction,
    usuario
) {
    if (!usuario?.id) {
        throw new ErroVenda(
            'Selecione um cliente válido.'
        );
    }

    if (usuario.bot) {
        throw new ErroVenda(
            'Não é permitido registrar ' +
            'vendas para bots.'
        );
    }

    if (
        usuario.id ===
        interaction.client.user?.id
    ) {
        throw new ErroVenda(
            'O bot não pode ser o cliente ' +
            'de uma venda.'
        );
    }

    return usuario;
}

// ==========================================
// CRIAR CHAVE ÚNICA DA VENDA
// ==========================================

// O ID de cada interação do Discord
// é único.
//
// Se a mesma interação for processada
// novamente, a chave será igual.
//
// O vendaService.js reconhecerá
// que a compra já foi registrada.
//
// Uma NOVA execução do /venda terá
// outro ID e representará uma nova
// operação administrativa.
//
// Isso impede duplicidade da mesma
// interação, mas não duas vendas
// distintas criadas por engano.

function criarChaveVenda(
    interaction
) {
    return (
        'venda_manual_' +
        interaction.id
    );
}

// ==========================================
// CRIAR EMBED DE CONFIRMAÇÃO
// ==========================================

function criarEmbedConfirmacao({
    clienteId,
    moderadorId,
    valor,
    robux,
    dadosCliente,
    publicacaoUrl,
    jaRegistrada
}) {
    const embed =
        new EmbedBuilder()
            .setColor(COR)
            .setTitle(
                '💎 INOVARESALE | VENDA REGISTRADA'
            )
            .setDescription(
                jaRegistrada
                    ? 'ℹ️ **Essa operação já estava registrada.**'
                    : '✅ **Venda registrada com sucesso!**'
            )
            .addFields(
                {
                    name: '👤 Cliente',
                    value:
                        `<@${clienteId}>`,
                    inline: true
                },

                {
                    name: '🛡️ Administrador',
                    value:
                        `<@${moderadorId}>`,
                    inline: true
                },

                {
                    name: '💰 Valor pago',
                    value:
                        formatarDinheiro(
                            valor
                        ),
                    inline: true
                },

                {
                    name: '💎 Robux comprados',
                    value:
                        formatarRobux(
                            robux
                        ),
                    inline: true
                },

                {
                    name: '🛒 Total de compras',
                    value:
                        formatarRobux(
                            dadosCliente.quantidadeCompras
                        ),
                    inline: true
                },

                {
                    name: '💵 Total gasto pelo cliente',
                    value:
                        formatarDinheiro(
                            dadosCliente.totalGasto
                        ),
                    inline: true
                },

                {
                    name: '📊 Total de Robux adquiridos',
                    value:
                        formatarRobux(
                            dadosCliente.totalRobux
                        ),
                    inline: false
                }
            )
            .setFooter({
                text:
                    'InovareSale Bot 3.0 • Histórico SQLite'
            })
            .setTimestamp();

    if (publicacaoUrl) {
        embed.addFields({
            name: '📢 Anúncio da compra',
            value:
                `[Ver publicação](${publicacaoUrl})`,
            inline: false
        });
    }

    return embed;
}

// ==========================================
// IDENTIFICAR AVISOS NÃO CRÍTICOS
// ==========================================

// Uma venda já registrada no SQLite
// nunca é desfeita porque faltou
// publicar um anúncio ou atualizar
// o cargo do cliente.
//
// Esses problemas são mostrados
// separadamente ao administrador.

function criarAvisos(
    resultado
) {
    const avisos = [];

    if (resultado.erroCargo) {
        avisos.push(
            '⚠️ A compra foi salva, mas ' +
            'o cargo de fidelidade não pôde ' +
            'ser atualizado.'
        );
    }

    if (resultado.erroPublicacao) {
        avisos.push(
            '⚠️ A compra foi salva, mas ' +
            'a publicação no canal de ' +
            'vendas precisa de verificação.'
        );
    }

    if (
        resultado.erroLog ||
        resultado.log?.publicado === false
    ) {
        avisos.push(
            'ℹ️ O registro de logs está ' +
            'pendente ou precisa de revisão.'
        );
    }

    return avisos.join('\n');
}

// ==========================================
// TRATAR ERROS
// ==========================================

function mensagemErro(
    erro
) {
    if (
        erro instanceof ErroVenda
    ) {
        return (
            '❌ ' +
            erro.message
        );
    }

    return (
        '❌ Não foi possível confirmar ' +
        'o registro da venda. Verifique ' +
        'o histórico do cliente antes ' +
        'de tentar novamente, para evitar ' +
        'uma compra duplicada.'
    );
}

// ==========================================
// COMANDO /VENDA
// ==========================================

module.exports = {
    data:
        new SlashCommandBuilder()
            .setName('venda')
            .setDescription(
                'Registra uma venda manual de Robux.'
            )

            // ==================================
            // APENAS ADMINISTRADORES
            // ==================================

            .setDefaultMemberPermissions(
                PermissionFlagsBits.Administrator
            )

            .setDMPermission(false)

            // ==================================
            // CLIENTE
            // ==================================

            .addUserOption(opcao =>
                opcao
                    .setName('usuario')
                    .setDescription(
                        'Cliente que realizou a compra'
                    )
                    .setRequired(true)
            )

            // ==================================
            // VALOR PAGO
            // ==================================

            .addNumberOption(opcao =>
                opcao
                    .setName('valor')
                    .setDescription(
                        'Valor pago em reais. Exemplo: 150'
                    )
                    .setRequired(true)
                    .setMinValue(0.01)
                    .setMaxValue(
                        VALOR_MAXIMO
                    )
            )

            // ==================================
            // QUANTIDADE DE ROBUX
            // ==================================

            .addIntegerOption(opcao =>
                opcao
                    .setName('quantia')
                    .setDescription(
                        'Quantidade de Robux comprados'
                    )
                    .setRequired(true)
                    .setMinValue(1)
                    .setMaxValue(
                        ROBUX_MAXIMO
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
            // OBTER CLIENTE
            // ==================================

            const usuario =
                validarCliente(
                    interaction,

                    interaction.options.getUser(
                        'usuario',
                        true
                    )
                );

            // ==================================
            // OBTER VALOR
            // ==================================

            const valor =
                validarValorCompra(
                    interaction.options.getNumber(
                        'valor',
                        true
                    )
                );

            // ==================================
            // OBTER ROBUX
            // ==================================

            const robux =
                validarQuantidadeRobux(
                    interaction.options.getInteger(
                        'quantia',
                        true
                    )
                );

            // ==================================
            // ADIAR RESPOSTA PRIVADA
            // ==================================

            await interaction.deferReply({
                flags:
                    MessageFlags.Ephemeral
            });

            // ==================================
            // GERAR CHAVE DA VENDA
            // ==================================

            const chaveEvento =
                criarChaveVenda(
                    interaction
                );

            // ==================================
            // REGISTRAR VENDA NO SERVIÇO
            // ==================================

            // O serviço realiza:
            //
            // - Transação SQLite
            // - Atualização dos totais
            // - Histórico do cliente
            // - Atualização dos cargos
            // - Publicação da compra
            // - Registro nos logs
            //
            // A mesma chaveEvento
            // protege contra repetição
            // dessa interação.

            const resultado =
                await registrarVenda({
                    guild:
                        interaction.guild,

                    clienteId:
                        usuario.id,

                    valor,

                    robux,

                    registradoPorId:
                        interaction.user.id,

                    modalidade:
                        'outro',

                    usuarioRoblox:
                        '',

                    pagamento:
                        'outro',

                    origem:
                        'manual',

                    ticketId:
                        null,

                    chaveEvento
                });

            // ==================================
            // CONFIRMAR DADOS
            // ==================================

            if (
                !resultado?.dadosCliente
            ) {
                throw new ErroVenda(
                    'O serviço não confirmou ' +
                    'os dados da venda.'
                );
            }

            // ==================================
            // CRIAR EMBED
            // ==================================

            const embed =
                criarEmbedConfirmacao({
                    clienteId:
                        usuario.id,

                    moderadorId:
                        interaction.user.id,

                    valor,

                    robux,

                    dadosCliente:
                        resultado.dadosCliente,

                    publicacaoUrl:
                        resultado.publicacaoUrl,

                    jaRegistrada:
                        Boolean(
                            resultado.jaRegistrada
                        )
                });

            // ==================================
            // CRIAR AVISOS
            // ==================================

            const aviso =
                criarAvisos(
                    resultado
                );

            // ==================================
            // RESPONDER AO ADMINISTRADOR
            // ==================================

            await responderPrivado(
                interaction,
                {
                    content:
                        aviso || null,

                    embeds: [embed]
                }
            );

            // ==================================
            // REGISTRAR NO CONSOLE
            // ==================================

            if (
                resultado.jaRegistrada
            ) {
                console.log(
                    '[InovareSale | Venda] ' +
                    'Operação repetida detectada: ' +
                    chaveEvento
                );

            } else {
                console.log(
                    '[InovareSale | Venda] ' +
                    `Venda manual registrada | ` +
                    `Cliente: ${usuario.id} | ` +
                    `Robux: ${robux} | ` +
                    `Valor: ${valor} | ` +
                    `Administrador: ${
                        interaction.user.id
                    }`
                );
            }

        } catch (erro) {
            console.error(
                '[InovareSale | Venda] Erro:',
                erro
            );

            try {
                await responderPrivado(
                    interaction,
                    mensagemErro(
                        erro
                    )
                );

            } catch (erroResposta) {
                console.error(
                    '[InovareSale | Venda] ' +
                    'Falha ao responder:',
                    erroResposta
                );
            }
        }
    }
};
