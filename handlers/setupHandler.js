
'use strict';

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelType,
    PermissionFlagsBits,
    MessageFlags
} = require('discord.js');

const {
    getConfig,
    saveConfig
} = require('../utils/storage');

const {
    criarPublicacaoSetup
} = require('../panels/setupPanel');

const {
    criarPainelPedidos
} = require('../panels/pedidosPanel');

// ==========================================
// INOVARESALE BOT 3.0
// CENTRAL ADMINISTRATIVA
// ==========================================

const COR = 0x9951CB;

const MODALIDADES = {
    viaPlus: 'Via Plus',
    semTaxa: 'Robux Sem Taxa',
    taxado: 'Robux Taxado',
    viaGrupo: 'Robux Via Grupo'
};

const NIVEIS = {
    primeiraCompra: 'Primeira compra',
    cliente100: 'Cliente R$ 100',
    cliente300: 'Cliente R$ 300',
    cliente500: 'Cliente R$ 500',
    cliente1000: 'Cliente R$ 1.000',
    cliente5000: 'Cliente R$ 5.000',
    cliente10000: 'Cliente R$ 10.000'
};

// ==========================================
// CARREGAR CONFIGURAÇÕES
// ==========================================

function carregarConfig() {
    const config = getConfig();

    config.calculadora ??= {};
    config.estoque ??= {};
    config.vendas ??= {};
    config.cargos ??= {};
    config.setup ??= {};
    config.tickets ??= {};

    config.tickets.categorias ??= {};
    config.tickets.bloqueados ??= {};

    config.limiteds ??= {};
    config.logs ??= {};
    config.status ??= {};
    config.staff ??= {};

    for (const metodo of Object.keys(MODALIDADES)) {
        if (!(metodo in config.tickets.bloqueados)) {
            config.tickets.bloqueados[metodo] =
                metodo === 'viaGrupo';
        }

        config.tickets.categorias[metodo] ??= null;
    }

    return config;
}

// ==========================================
// FORMATAÇÕES
// ==========================================

function canalTexto(id) {
    return /^\d{17,20}$/.test(String(id || ''))
        ? `<#${id}>`
        : 'Não configurado';
}

function cargoTexto(id) {
    return /^\d{17,20}$/.test(String(id || ''))
        ? `<@&${id}>`
        : 'Não configurado';
}

function valorK(valor) {
    if (
        valor === null ||
        valor === undefined ||
        valor === false
    ) {
        return 'Desativado';
    }

    const numero = Number(valor);

    return Number.isFinite(numero) && numero > 0
        ? `K${numero.toLocaleString('pt-BR', {
            maximumFractionDigits: 2
        })}`
        : 'Desativado';
}

// ==========================================
// COMPONENTES VISUAIS
// ==========================================

function criarEmbed(titulo, descricao) {
    return new EmbedBuilder()
        .setColor(COR)
        .setTitle(
            `INOVARESALE | ${titulo.toUpperCase()}`
        )
        .setDescription(descricao)
        .setFooter({
            text:
                'InovareSale • Central Administrativa 3.0'
        });
}

function botao(
    id,
    rotulo,
    estilo = ButtonStyle.Secondary
) {
    return new ButtonBuilder()
        .setCustomId(id)
        .setLabel(rotulo)
        .setStyle(estilo);
}

function voltar(destino = 'setup_voltar') {
    return new ActionRowBuilder()
        .addComponents(
            botao(destino, 'Voltar')
        );
}

function canalMenu(
    id,
    texto,
    tipo = ChannelType.GuildText
) {
    return new ActionRowBuilder()
        .addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId(id)
                .setPlaceholder(texto)
                .setMinValues(1)
                .setMaxValues(1)
                .setChannelTypes(tipo)
        );
}

function cargoMenu(id, texto) {
    return new ActionRowBuilder()
        .addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId(id)
                .setPlaceholder(texto)
                .setMinValues(1)
                .setMaxValues(1)
        );
}

// ==========================================
// PAINEL DA CALCULADORA
// ==========================================

function painelCalculadora(config) {
    const calculadora = config.calculadora;

    const embed = criarEmbed(
        'Calculadora',
        `Canal: ${canalTexto(calculadora.canalId)}\n` +
        'Selecione um botão para alterar o preço K.'
    ).addFields(
        {
            name: 'Via Plus',
            value: valorK(calculadora.viaPlus),
            inline: true
        },
        {
            name: 'Sem Taxa',
            value: valorK(calculadora.semTaxa),
            inline: true
        },
        {
            name: 'Taxado',
            value: valorK(calculadora.taxado),
            inline: true
        },
        {
            name: 'Via Grupo',
            value: valorK(calculadora.viaGrupo),
            inline: true
        }
    );

    const botoes = Object.entries(MODALIDADES)
        .map(([chave, nome]) =>
            botao(`setup_k_${chave}`, nome)
        );

    return {
        embeds: [embed],
        components: [
            canalMenu(
                'setup_canal_calculadora',
                'Canal da calculadora'
            ),
            new ActionRowBuilder()
                .addComponents(...botoes),
            voltar()
        ]
    };
}

// ==========================================
// PAINEL DO ESTOQUE
// ==========================================

function painelEstoque(config) {
    const estoque = config.estoque;

    const embed = criarEmbed(
        'Estoque',
        'Configure os canais e o preço K ' +
        'utilizado na publicação do estoque.'
    ).addFields(
        {
            name: 'Canal de estoque',
            value: canalTexto(estoque.canalId),
            inline: true
        },
        {
            name: 'Canal de compra',
            value: canalTexto(estoque.canalCompraId),
            inline: true
        },
        {
            name: 'Preço por K',
            value: valorK(estoque.precoK),
            inline: true
        }
    );

    return {
        embeds: [embed],
        components: [
            canalMenu(
                'setup_canal_estoque',
                'Canal do estoque'
            ),
            canalMenu(
                'setup_canal_compra',
                'Canal de compras'
            ),
            new ActionRowBuilder()
                .addComponents(
                    botao(
                        'setup_estoque_preco',
                        'Alterar preço K',
                        ButtonStyle.Primary
                    ),
                    botao(
                        'setup_voltar',
                        'Voltar'
                    )
                )
        ]
    };
}

// ==========================================
// PAINEL DE VENDAS E LIMITEDS 3.0
// ==========================================

function painelVendas(config) {
    const embed = criarEmbed(
        'Vendas e Limiteds',
        'Configure o canal de vendas, os anúncios ' +
        'de Limiteds e a equipe autorizada.\n\n' +
        'Use **Gerenciar Limiteds** para cadastrar, ' +
        'editar, publicar, pausar ou arquivar produtos.\n\n' +
        'O atendimento e o registro de compras de ' +
        'Limiteds serão integrados posteriormente.'
    ).addFields(
        {
            name: 'Vendas concluídas',
            value: canalTexto(
                config.vendas.canalId
            ),
            inline: true
        },
        {
            name: 'Canal de Limiteds',
            value: canalTexto(
                config.limiteds.canalId
            ),
            inline: true
        },
        {
            name: 'Equipe de Limiteds',
            value: cargoTexto(
                config.limiteds.cargoEquipeId
            ),
            inline: false
        }
    );

    return {
        embeds: [embed],
        components: [
            canalMenu(
                'setup_canal_vendas',
                'Canal de vendas concluídas'
            ),

            canalMenu(
                'setup_canal_limiteds',
                'Canal de anúncios de Limiteds'
            ),

            cargoMenu(
                'setup_role_limiteds_equipe',
                'Equipe autorizada para Limiteds'
            ),

            // ==================================
            // NOVO BOTÃO DA VERSÃO 3.0
            // ==================================
            //
            // O ID limiteds_gerenciar será
            // encaminhado automaticamente ao
            // handlers/limitedsHandler.js pelo
            // events/interactionCreate.js.
            //
            // O setup continua restrito a
            // administradores.

            new ActionRowBuilder()
                .addComponents(
                    botao(
                        'limiteds_gerenciar',
                        'Gerenciar Limiteds',
                        ButtonStyle.Primary
                    ),
                    botao(
                        'setup_voltar',
                        'Voltar'
                    )
                )
        ]
    };
}

// ==========================================
// PAINEL DOS CARGOS DE CLIENTE
// ==========================================

function painelCargos(config) {
    const embed = criarEmbed(
        'Cargos de cliente',
        'Selecione o nível para definir ' +
        'o cargo correspondente.'
    );

    for (const [chave, nome] of Object.entries(NIVEIS)) {
        embed.addFields({
            name: nome,
            value: cargoTexto(
                config.cargos[chave]
            ),
            inline: true
        });
    }

    const menu = new StringSelectMenuBuilder()
        .setCustomId(
            'setup_selecionar_nivel_cargo'
        )
        .setPlaceholder(
            'Selecione o nível do cliente'
        )
        .addOptions(
            Object.entries(NIVEIS)
                .map(([chave, nome]) => ({
                    label: nome,
                    value: chave
                }))
        );

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder()
                .addComponents(menu),
            voltar()
        ]
    };
}

// ==========================================
// SELECIONAR CARGO DE CLIENTE
// ==========================================

function painelSelecionarCargo(config, nivel) {
    const embed = criarEmbed(
        'Selecionar cargo',
        `**Nível:** ${NIVEIS[nivel]}\n` +
        `**Cargo atual:** ${
            cargoTexto(config.cargos[nivel])
        }`
    );

    return {
        embeds: [embed],
        components: [
            cargoMenu(
                `setup_role_${nivel}`,
                'Escolha o cargo'
            ),
            voltar('setup_cargos')
        ]
    };
}

// ==========================================
// PAINEL DE PEDIDOS E TICKETS
// ==========================================

function painelTickets(config) {
    const tickets = config.tickets;

    const embed = criarEmbed(
        'Pedidos e Tickets',
        `**Equipe:** ${
            cargoTexto(tickets.cargoEquipeId)
        }\n\n` +
        'Configure os atendentes e as ' +
        'categorias dos tickets.'
    );

    for (
        const [chave, nome]
        of Object.entries(MODALIDADES)
    ) {
        embed.addFields({
            name: nome,
            value: canalTexto(
                tickets.categorias[chave]
            ),
            inline: true
        });
    }

    const menu = new StringSelectMenuBuilder()
        .setCustomId(
            'setup_ticket_escolher_categoria'
        )
        .setPlaceholder(
            'Configurar categoria por modalidade'
        )
        .addOptions(
            Object.entries(MODALIDADES)
                .map(([chave, nome]) => ({
                    label: nome,
                    value: chave
                }))
        );

    return {
        embeds: [embed],
        components: [
            cargoMenu(
                'setup_ticket_equipe',
                'Cargo da equipe de tickets'
            ),

            new ActionRowBuilder()
                .addComponents(menu),

            new ActionRowBuilder()
                .addComponents(
                    botao(
                        'setup_pedidos',
                        'Central de Pedidos',
                        ButtonStyle.Primary
                    ),
                    botao(
                        'setup_bloqueios',
                        'Bloqueios'
                    ),
                    botao(
                        'setup_voltar',
                        'Voltar'
                    )
                )
        ]
    };
}

// ==========================================
// CATEGORIA DE TICKETS POR MODALIDADE
// ==========================================

function painelCategoria(config, metodo) {
    const embed = criarEmbed(
        'Categoria de Tickets',
        `**Modalidade:** ${MODALIDADES[metodo]}\n` +
        `**Categoria atual:** ${
            canalTexto(
                config.tickets.categorias[metodo]
            )
        }`
    );

    return {
        embeds: [embed],
        components: [
            canalMenu(
                `setup_ticket_categoria_${metodo}`,
                'Selecione a categoria',
                ChannelType.GuildCategory
            ),
            voltar('setup_tickets')
        ]
    };
}

// ==========================================
// PAINEL DE BLOQUEIOS
// ==========================================

function painelBloqueios(config) {
    const bloqueados =
        config.tickets.bloqueados;

    const embed = criarEmbed(
        'Bloqueios',
        'Bloqueie ou libere novas compras ' +
        'por modalidade.'
    );

    for (
        const [chave, nome]
        of Object.entries(MODALIDADES)
    ) {
        embed.addFields({
            name: nome,
            value: bloqueados[chave]
                ? 'Bloqueada'
                : 'Liberada',
            inline: true
        });
    }

    const botoes = Object.entries(MODALIDADES)
        .map(([chave, nome]) =>
            botao(
                `setup_bloqueio_${chave}`,
                nome,
                bloqueados[chave]
                    ? ButtonStyle.Danger
                    : ButtonStyle.Success
            )
        );

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder()
                .addComponents(...botoes),
            voltar('setup_tickets')
        ]
    };
}

// ==========================================
// PAINEL DA CENTRAL DE PEDIDOS
// ==========================================

function painelPedidos(config) {
    const embed = criarEmbed(
        'Central de Pedidos',
        `**Canal configurado:** ${
            canalTexto(
                config.tickets.painelCanalId
            )
        }\n\n` +
        'A publicação utilizará o banner ' +
        'e os botões **Comprar Robux** e ' +
        '**Calcular valores**.\n\n' +
        'Selecione um canal e publique a central.'
    );

    return {
        embeds: [embed],
        components: [
            canalMenu(
                'setup_pedidos_canal',
                'Canal da Central de Pedidos'
            ),

            new ActionRowBuilder()
                .addComponents(
                    botao(
                        'setup_pedidos_publicar',
                        'Publicar Central',
                        ButtonStyle.Success
                    ),
                    botao(
                        'setup_tickets',
                        'Voltar'
                    )
                )
        ]
    };
}

// ==========================================
// PAINEL DE REGISTROS E LOGS
// ==========================================

function painelLogs(config) {
    const embed = criarEmbed(
        'Registros e Logs',
        'Defina o canal responsável pelos ' +
        'registros de tickets e atividades.\n\n' +
        'O envio automático será integrado ' +
        'quando criarmos o serviço de logs.'
    ).addFields({
        name: 'Canal configurado',
        value: canalTexto(
            config.logs.canalId
        ),
        inline: true
    });

    return {
        embeds: [embed],
        components: [
            canalMenu(
                'setup_canal_logs',
                'Canal de registros e logs'
            ),
            voltar()
        ]
    };
}

// ==========================================
// PAINEL DE STATUS E EQUIPE
// ==========================================

function painelStatus(config) {
    const embed = criarEmbed(
        'Status e Equipe',
        'Configure o monitoramento do bot ' +
        'e o cargo da equipe.\n\n' +
        'As atualizações automáticas e as ' +
        'estatísticas serão implementadas ' +
        'nos serviços de status e equipe.'
    ).addFields(
        {
            name: 'Canal de status',
            value: canalTexto(
                config.status.canalId
            ),
            inline: true
        },
        {
            name: 'Cargo da equipe',
            value: cargoTexto(
                config.staff.cargoId
            ),
            inline: true
        }
    );

    return {
        embeds: [embed],
        components: [
            canalMenu(
                'setup_canal_status',
                'Canal de status do bot'
            ),
            cargoMenu(
                'setup_role_staff',
                'Cargo da equipe monitorada'
            ),
            voltar()
        ]
    };
}

// ==========================================
// PAINEL DE MODERAÇÃO
// ==========================================

function painelModeracao(config) {
    const embed = criarEmbed(
        'Moderação',
        'Gerencie as ações de moderação ' +
        'pelos comandos do bot.\n\n' +
        '**Comandos disponíveis:**\n' +
        '`/ban`, `/unban`, `/warn`, `/unwarn`, ' +
        '`/timeout` e `/untimeout`.\n\n' +
        `**Canal de logs:** ${
            canalTexto(config.logs.canalId)
        }\n\n` +
        'O envio dos registros ao canal ' +
        'será conectado posteriormente.'
    );

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder()
                .addComponents(
                    botao(
                        'setup_logs',
                        'Configurar logs',
                        ButtonStyle.Primary
                    ),
                    botao(
                        'setup_voltar',
                        'Voltar'
                    )
                )
        ]
    };
}

// ==========================================
// PUBLICAÇÃO PÚBLICA DE PEDIDOS
// ==========================================

function criarCentralPublica(config, guildId) {
    return criarPainelPedidos(
        config,
        guildId
    );
}

async function publicarCentral(interaction) {
    const config = carregarConfig();

    const canalId =
        config.tickets.painelCanalId;

    if (!canalId) {
        return responderPrivado(
            interaction,
            'Configure primeiro o canal ' +
            'da Central de Pedidos.'
        );
    }

    if (!config.tickets.cargoEquipeId) {
        return responderPrivado(
            interaction,
            'Configure primeiro o cargo ' +
            'da equipe de tickets.'
        );
    }

    if (
        !interaction.deferred &&
        !interaction.replied
    ) {
        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });
    }

    const canal =
        await interaction.guild.channels.fetch(
            canalId
        );

    if (
        !canal ||
        canal.type !== ChannelType.GuildText
    ) {
        throw new Error(
            'O canal da Central de Pedidos é inválido.'
        );
    }

    const anteriorCanalId =
        config.tickets.painelPublicadoCanalId;

    const anteriorMensagemId =
        config.tickets.painelMensagemId;

    // Publica a nova central primeiro.
    const nova = await canal.send(
        criarCentralPublica(
            config,
            interaction.guildId
        )
    );

    // Salva os IDs no SQLite.
    config.tickets.painelPublicadoCanalId =
        canal.id;

    config.tickets.painelMensagemId =
        nova.id;

    saveConfig(config);

    // Remove a publicação anterior
    // somente se for uma mensagem do bot.
    if (
        anteriorCanalId &&
        anteriorMensagemId &&
        anteriorMensagemId !== nova.id
    ) {
        try {
            const canalAntigo =
                await interaction.guild.channels.fetch(
                    anteriorCanalId
                );

            const anterior =
                await canalAntigo?.messages?.fetch(
                    anteriorMensagemId
                );

            if (
                anterior?.author.id ===
                interaction.client.user.id
            ) {
                await anterior.delete();
            }

        } catch (erro) {
            console.warn(
                '[Setup] Central anterior não removida:',
                erro.message
            );
        }
    }

    return interaction.editReply({
        content:
            'Central de Pedidos publicada com sucesso!\n' +
            `[Abrir painel](${nova.url})`
    });
}

// ==========================================
// MODAL DE PREÇOS K
// ==========================================

function mostrarModalPreco(
    interaction,
    id,
    titulo,
    atual
) {
    const modal = new ModalBuilder()
        .setCustomId(id)
        .setTitle(titulo);

    const entrada = new TextInputBuilder()
        .setCustomId('valor_k')
        .setLabel('Valor K ou OFF')
        .setPlaceholder(
            'Exemplo: 39, 42,50 ou OFF'
        )
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    if (
        atual !== null &&
        atual !== undefined
    ) {
        entrada.setValue(
            String(atual)
        );
    }

    modal.addComponents(
        new ActionRowBuilder()
            .addComponents(entrada)
    );

    return interaction.showModal(modal);
}

// ==========================================
// VALIDAR PREÇO K
// ==========================================

function interpretarPrecoK(
    texto,
    permitirOff
) {
    const entrada = String(texto || '')
        .trim()
        .toUpperCase();

    if (
        entrada === 'OFF' &&
        permitirOff
    ) {
        return null;
    }

    const numero = Number(
        entrada
            .replace(/^K/, '')
            .replace(',', '.')
    );

    if (
        !Number.isFinite(numero) ||
        numero <= 0
    ) {
        throw new Error(
            'Informe um valor K válido ' +
            'e maior que zero.'
        );
    }

    return numero;
}

// ==========================================
// RESPOSTAS PRIVADAS
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
        return interaction.editReply(dados);
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
// VERIFICAR PAINEL PRIVADO
// ==========================================

function mensagemEphemeral(interaction) {
    return Boolean(
        interaction.message?.flags?.has?.(
            MessageFlags.Ephemeral
        )
    );
}

// ==========================================
// MOSTRAR SUBPAINEL
// ==========================================

async function mostrarPainel(
    interaction,
    painel
) {
    const dados = {
        ...painel,
        allowedMentions: {
            parse: []
        }
    };

    // Navegação entre painéis privados.
    if (
        !interaction.replied &&
        !interaction.deferred &&
        mensagemEphemeral(interaction)
    ) {
        return interaction.update({
            content: null,
            ...dados
        });
    }

    // Ao clicar no painel público,
    // mostra o conteúdo somente ao admin.
    return responderPrivado(
        interaction,
        dados
    );
}

// ==========================================
// PAINEL PRINCIPAL DO SETUP
// ==========================================

function painelCentral(config) {
    return criarPublicacaoSetup(
        config
    );
}

// ==========================================
// ROTEADOR DO SETUP
// ==========================================

async function handleSetupInteraction(interaction) {
    const id =
        interaction.customId || '';

    const ehSetup =
        id.startsWith('setup_') ||
        id.startsWith('modal_k_') ||
        id === 'modal_estoque_preco';

    if (!ehSetup) {
        return false;
    }

    // ======================================
    // VERIFICAR PERMISSÕES
    // ======================================

    if (
        !interaction.inGuild() ||
        !interaction.memberPermissions?.has(
            PermissionFlagsBits.Administrator
        )
    ) {
        await responderPrivado(
            interaction,
            'Somente administradores podem ' +
            'gerenciar as configurações da InovareSale.'
        );

        return true;
    }

    try {
        const config = carregarConfig();

        // ==================================
        // MODAIS DE PREÇO
        // ==================================

        if (interaction.isModalSubmit()) {
            if (
                id.startsWith('modal_k_')
            ) {
                const metodo = id.slice(
                    'modal_k_'.length
                );

                if (!MODALIDADES[metodo]) {
                    throw new Error(
                        'Modalidade inválida.'
                    );
                }

                const valor = interpretarPrecoK(
                    interaction.fields.getTextInputValue(
                        'valor_k'
                    ),
                    true
                );

                config.calculadora[metodo] =
                    valor;

                saveConfig(config);

                await responderPrivado(
                    interaction,
                    `Preço de ${MODALIDADES[metodo]} ` +
                    `salvo: ${valorK(valor)}.`
                );

                return true;
            }

            if (
                id === 'modal_estoque_preco'
            ) {
                const valor = interpretarPrecoK(
                    interaction.fields.getTextInputValue(
                        'valor_k'
                    ),
                    false
                );

                config.estoque.precoK = valor;

                saveConfig(config);

                await responderPrivado(
                    interaction,
                    `Preço do estoque salvo: ${
                        valorK(valor)
                    }.`
                );

                return true;
            }

            return false;
        }

        // ==================================
        // SELEÇÃO DE CANAIS
        // ==================================

        if (
            interaction.isChannelSelectMenu()
        ) {
            const canalId =
                interaction.values[0];

            const campos = {
                setup_canal_calculadora: [
                    'calculadora',
                    'canalId',
                    painelCalculadora
                ],

                setup_canal_estoque: [
                    'estoque',
                    'canalId',
                    painelEstoque
                ],

                setup_canal_compra: [
                    'estoque',
                    'canalCompraId',
                    painelEstoque
                ],

                setup_canal_vendas: [
                    'vendas',
                    'canalId',
                    painelVendas
                ],

                setup_canal_limiteds: [
                    'limiteds',
                    'canalId',
                    painelVendas
                ],

                setup_canal_logs: [
                    'logs',
                    'canalId',
                    painelLogs
                ],

                setup_canal_status: [
                    'status',
                    'canalId',
                    painelStatus
                ],

                setup_pedidos_canal: [
                    'tickets',
                    'painelCanalId',
                    painelPedidos
                ]
            };

            if (campos[id]) {
                const [
                    secao,
                    campo,
                    painel
                ] = campos[id];

                const canal =
                    await interaction.guild.channels.fetch(
                        canalId
                    );

                if (
                    !canal ||
                    canal.type !== ChannelType.GuildText
                ) {
                    throw new Error(
                        'Selecione um canal de texto válido.'
                    );
                }

                config[secao][campo] =
                    canalId;

                saveConfig(config);

                await mostrarPainel(
                    interaction,
                    painel(config)
                );

                return true;
            }

            // Categorias dos tickets.
            const prefixo =
                'setup_ticket_categoria_';

            if (
                id.startsWith(prefixo)
            ) {
                const metodo = id.slice(
                    prefixo.length
                );

                if (!MODALIDADES[metodo]) {
                    throw new Error(
                        'Modalidade inválida.'
                    );
                }

                const categoria =
                    await interaction.guild.channels.fetch(
                        canalId
                    );

                if (
                    !categoria ||
                    categoria.type !==
                    ChannelType.GuildCategory
                ) {
                    throw new Error(
                        'Selecione uma categoria válida.'
                    );
                }

                config.tickets.categorias[metodo] =
                    canalId;

                saveConfig(config);

                await mostrarPainel(
                    interaction,
                    painelTickets(config)
                );

                return true;
            }

            return false;
        }

        // ==================================
        // SELEÇÃO DE CARGOS
        // ==================================

        if (
            interaction.isRoleSelectMenu()
        ) {
            const cargoId =
                interaction.values[0];

            const cargo =
                await interaction.guild.roles.fetch(
                    cargoId
                );

            if (!cargo) {
                throw new Error(
                    'Cargo não encontrado.'
                );
            }

            if (
                id === 'setup_ticket_equipe'
            ) {
                config.tickets.cargoEquipeId =
                    cargoId;

                saveConfig(config);

                await mostrarPainel(
                    interaction,
                    painelTickets(config)
                );

                return true;
            }

            // Cargo da equipe de Limiteds.
            if (
                id === 'setup_role_limiteds_equipe'
            ) {
                config.limiteds.cargoEquipeId =
                    cargoId;

                saveConfig(config);

                await mostrarPainel(
                    interaction,
                    painelVendas(config)
                );

                return true;
            }

            if (
                id === 'setup_role_staff'
            ) {
                config.staff.cargoId =
                    cargoId;

                saveConfig(config);

                await mostrarPainel(
                    interaction,
                    painelStatus(config)
                );

                return true;
            }

            if (
                id.startsWith('setup_role_')
            ) {
                const nivel = id.slice(
                    'setup_role_'.length
                );

                if (!NIVEIS[nivel]) {
                    throw new Error(
                        'Nível de cliente inválido.'
                    );
                }

                config.cargos[nivel] =
                    cargoId;

                saveConfig(config);

                await mostrarPainel(
                    interaction,
                    painelCargos(config)
                );

                return true;
            }

            return false;
        }

        // ==================================
        // MENUS DE SELEÇÃO
        // ==================================

        if (
            interaction.isStringSelectMenu()
        ) {
            // ==================================
            // MENU CENTRAL 3.0
            // ==================================

            if (
                id === 'setup_menu_principal'
            ) {
                const escolha =
                    interaction.values[0];

                const paineis = {
                    calculadora:
                        painelCalculadora,

                    estoque:
                        painelEstoque,

                    pedidos_tickets:
                        painelTickets,

                    vendas_limiteds:
                        painelVendas,

                    logs:
                        painelLogs,

                    status_equipe:
                        painelStatus,

                    moderacao:
                        painelModeracao,

                    cargos:
                        painelCargos
                };

                if (!paineis[escolha]) {
                    throw new Error(
                        'Opção de gerenciamento indisponível.'
                    );
                }

                await mostrarPainel(
                    interaction,
                    paineis[escolha](config)
                );

                return true;
            }

            // ==================================
            // NÍVEL DE CLIENTE
            // ==================================

            if (
                id ===
                'setup_selecionar_nivel_cargo'
            ) {
                const nivel =
                    interaction.values[0];

                if (!NIVEIS[nivel]) {
                    throw new Error(
                        'Nível inválido.'
                    );
                }

                await mostrarPainel(
                    interaction,
                    painelSelecionarCargo(
                        config,
                        nivel
                    )
                );

                return true;
            }

            // ==================================
            // CATEGORIA DE TICKET
            // ==================================

            if (
                id ===
                'setup_ticket_escolher_categoria'
            ) {
                const metodo =
                    interaction.values[0];

                if (!MODALIDADES[metodo]) {
                    throw new Error(
                        'Modalidade inválida.'
                    );
                }

                await mostrarPainel(
                    interaction,
                    painelCategoria(
                        config,
                        metodo
                    )
                );

                return true;
            }

            return false;
        }

        // ==================================
        // BOTÕES
        // ==================================

        if (!interaction.isButton()) {
            return false;
        }

        const paineis = {
            setup_calculadora:
                painelCalculadora,

            setup_estoque:
                painelEstoque,

            setup_vendas:
                painelVendas,

            setup_cargos:
                painelCargos,

            setup_tickets:
                painelTickets,

            setup_bloqueios:
                painelBloqueios,

            setup_pedidos:
                painelPedidos,

            setup_logs:
                painelLogs,

            setup_status:
                painelStatus,

            setup_moderacao:
                painelModeracao
        };

        // ==================================
        // VOLTAR À CENTRAL
        // ==================================

        if (
            id === 'setup_voltar'
        ) {
            await mostrarPainel(
                interaction,
                painelCentral(config)
            );

            return true;
        }

        // ==================================
        // ABRIR SUBPAINEL
        // ==================================

        if (paineis[id]) {
            await mostrarPainel(
                interaction,
                paineis[id](config)
            );

            return true;
        }

        // ==================================
        // BLOQUEAR OU LIBERAR MODALIDADE
        // ==================================

        if (
            id.startsWith('setup_bloqueio_')
        ) {
            const metodo = id.slice(
                'setup_bloqueio_'.length
            );

            if (!MODALIDADES[metodo]) {
                throw new Error(
                    'Modalidade inválida.'
                );
            }

            config.tickets.bloqueados[metodo] =
                !config.tickets.bloqueados[metodo];

            saveConfig(config);

            await mostrarPainel(
                interaction,
                painelBloqueios(config)
            );

            return true;
        }

        // ==================================
        // PREÇO K DA CALCULADORA
        // ==================================

        if (
            id.startsWith('setup_k_')
        ) {
            const metodo = id.slice(
                'setup_k_'.length
            );

            if (!MODALIDADES[metodo]) {
                throw new Error(
                    'Modalidade inválida.'
                );
            }

            await mostrarModalPreco(
                interaction,
                `modal_k_${metodo}`,
                `Preço: ${MODALIDADES[metodo]}`,
                config.calculadora[metodo]
            );

            return true;
        }

        // ==================================
        // PREÇO K DO ESTOQUE
        // ==================================

        if (
            id === 'setup_estoque_preco'
        ) {
            await mostrarModalPreco(
                interaction,
                'modal_estoque_preco',
                'Preço do estoque',
                config.estoque.precoK
            );

            return true;
        }

        // ==================================
        // PUBLICAR CENTRAL DE PEDIDOS
        // ==================================

        if (
            id === 'setup_pedidos_publicar'
        ) {
            await publicarCentral(
                interaction
            );

            return true;
        }

        // O botão limiteds_gerenciar
        // não é processado aqui.
        //
        // Ele vai diretamente para
        // handlers/limitedsHandler.js
        // através do roteador central.

        return false;

    } catch (erro) {
        console.error(
            '[InovareSale | Setup] Erro:',
            erro
        );

        try {
            await responderPrivado(
                interaction,
                'Não foi possível concluir esta configuração. ' +
                'Verifique as permissões e tente novamente.'
            );

        } catch (erroResposta) {
            console.error(
                '[InovareSale | Setup] Falha na resposta:',
                erroResposta
            );
        }

        return true;
    }
}

// ==========================================
// EXPORTAÇÕES COMPATÍVEIS
// ==========================================

module.exports = {
    handleSetupInteraction,
    carregarConfig,

    painelCalculadora,
    painelEstoque,
    painelVendas,
    painelCargos,
    painelTickets,
    painelBloqueios,
    painelPedidos,

    criarCentralPublica
};
