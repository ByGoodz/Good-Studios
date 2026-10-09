
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
    criarPainelSetup
} = require('../panels/setupPanel');

const {
    criarPainelPedidos
} = require('../panels/pedidosPanel');

// ==========================================
// INOVARESALE BOT 2.0
// GERENCIAMENTO DAS CONFIGURAÇÕES
// ==========================================

const COR_PRATA = 0xC0C0C0;

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
// FORMATAÇÃO
// ==========================================

function canalTexto(id) {
    return id ? `<#${id}>` : 'Não configurado';
}

function cargoTexto(id) {
    return id ? `<@&${id}>` : 'Não configurado';
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
        ? `K${numero.toLocaleString('pt-BR')}`
        : 'Desativado';
}

function criarEmbed(titulo, descricao) {
    return new EmbedBuilder()
        .setColor(COR_PRATA)
        .setTitle(titulo)
        .setDescription(descricao)
        .setFooter({
            text: 'INOVARESALE • Configurações'
        });
}

function linhaVoltar(destino = 'setup_voltar') {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(destino)
                .setLabel('Voltar')
                .setStyle(ButtonStyle.Secondary)
        );
}

// ==========================================
// RESPONDER DE FORMA PRIVADA
// ==========================================

async function responderPrivado(interaction, conteudo) {
    const dados = typeof conteudo === 'string'
        ? { content: conteudo }
        : conteudo;

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

async function mostrarPainel(interaction, painel) {
    const mensagemPrivada =
        interaction.message?.flags?.has(
            MessageFlags.Ephemeral
        );

    if (
        mensagemPrivada &&
        !interaction.replied &&
        !interaction.deferred
    ) {
        return interaction.update(painel);
    }

    return responderPrivado(interaction, painel);
}

// ==========================================
// PAINEL DA CALCULADORA
// ==========================================

function painelCalculadora(config) {
    const calc = config.calculadora;

    const descricao =
        `**Canal:** ${canalTexto(calc.canalId)}\n\n` +
        `**Via Plus:** ${valorK(calc.viaPlus)}\n` +
        `**Sem Taxa:** ${valorK(calc.semTaxa)}\n` +
        `**Taxado:** ${valorK(calc.taxado)}\n` +
        `**Via Grupo:** ${valorK(calc.viaGrupo)}\n\n` +
        'Selecione o canal ou altere os valores K.';

    const menu = new ChannelSelectMenuBuilder()
        .setCustomId('setup_canal_calculadora')
        .setPlaceholder('Canal da calculadora')
        .setChannelTypes(ChannelType.GuildText);

    const botoes = Object.entries(MODALIDADES)
        .map(([chave, nome]) =>
            new ButtonBuilder()
                .setCustomId(`setup_k_${chave}`)
                .setLabel(nome)
                .setStyle(ButtonStyle.Secondary)
        );

    return {
        embeds: [
            criarEmbed(
                'Calculadora • Configurações',
                descricao
            )
        ],
        components: [
            new ActionRowBuilder()
                .addComponents(menu),

            new ActionRowBuilder()
                .addComponents(...botoes),

            linhaVoltar()
        ]
    };
}

// ==========================================
// PAINEL DO ESTOQUE
// ==========================================

function painelEstoque(config) {
    const estoque = config.estoque;

    const embed = criarEmbed(
        'Estoque • Configurações',

        `**Canal do estoque:** ${canalTexto(estoque.canalId)}\n\n` +
        `**Canal de compras:** ${canalTexto(estoque.canalCompraId)}\n\n` +
        `**Preço atual:** ${valorK(estoque.precoK)}\n\n` +
        'Configure os canais e o preço do estoque.'
    );

    const canalEstoque =
        new ChannelSelectMenuBuilder()
            .setCustomId('setup_canal_estoque')
            .setPlaceholder('Canal do estoque')
            .setChannelTypes(ChannelType.GuildText);

    const canalCompra =
        new ChannelSelectMenuBuilder()
            .setCustomId('setup_canal_compra')
            .setPlaceholder('Canal de compras')
            .setChannelTypes(ChannelType.GuildText);

    const botoes = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('setup_estoque_preco')
                .setLabel('Alterar preço K')
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId('setup_voltar')
                .setLabel('Voltar')
                .setStyle(ButtonStyle.Secondary)
        );

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder()
                .addComponents(canalEstoque),

            new ActionRowBuilder()
                .addComponents(canalCompra),

            botoes
        ]
    };
}

// ==========================================
// PAINEL DE VENDAS
// ==========================================

function painelVendas(config) {
    const embed = criarEmbed(
        'Vendas • Configurações',

        `**Canal das vendas:** ` +
        `${canalTexto(config.vendas.canalId)}\n\n` +

        'As próximas compras concluídas serão ' +
        'publicadas neste canal.'
    );

    const menu = new ChannelSelectMenuBuilder()
        .setCustomId('setup_canal_vendas')
        .setPlaceholder('Canal das vendas')
        .setChannelTypes(ChannelType.GuildText);

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder()
                .addComponents(menu),

            linhaVoltar()
        ]
    };
}

// ==========================================
// PAINEL DE CARGOS
// ==========================================

function painelCargos(config) {
    const descricao = Object.entries(NIVEIS)
        .map(([chave, nome]) =>
            `**${nome}:** ${cargoTexto(config.cargos[chave])}`
        )
        .join('\n');

    const menu = new StringSelectMenuBuilder()
        .setCustomId('setup_selecionar_nivel_cargo')
        .setPlaceholder('Selecione o nível do cliente')
        .addOptions(
            Object.entries(NIVEIS)
                .map(([chave, nome]) => ({
                    label: nome,
                    value: chave
                }))
        );

    return {
        embeds: [
            criarEmbed(
                'Cargos • Configurações',

                `${descricao}\n\n` +
                'Selecione um nível para definir seu cargo.'
            )
        ],
        components: [
            new ActionRowBuilder()
                .addComponents(menu),

            linhaVoltar()
        ]
    };
}

function painelSelecionarCargo(config, nivel) {
    const menu = new RoleSelectMenuBuilder()
        .setCustomId(`setup_role_${nivel}`)
        .setPlaceholder('Escolha o cargo');

    return {
        embeds: [
            criarEmbed(
                'Selecionar cargo',

                `**Nível:** ${NIVEIS[nivel]}\n` +
                `**Cargo atual:** ${cargoTexto(config.cargos[nivel])}`
            )
        ],
        components: [
            new ActionRowBuilder()
                .addComponents(menu),

            linhaVoltar('setup_cargos')
        ]
    };
}

// ==========================================
// PAINEL DE TICKETS
// ==========================================

function painelTickets(config) {
    const tickets = config.tickets;

    const categorias = Object.entries(MODALIDADES)
        .map(([chave, nome]) =>
            `**${nome}:** ${canalTexto(tickets.categorias[chave])}`
        )
        .join('\n');

    const embed = criarEmbed(
        'Tickets • Configurações',

        `**Equipe:** ${cargoTexto(tickets.cargoEquipeId)}\n\n` +
        '**Categorias dos tickets**\n' +
        `${categorias}\n\n` +
        'Configure a equipe e a categoria ' +
        'de cada modalidade.'
    );

    const equipe = new RoleSelectMenuBuilder()
        .setCustomId('setup_ticket_equipe')
        .setPlaceholder('Cargo da equipe');

    const modalidades = new StringSelectMenuBuilder()
        .setCustomId('setup_ticket_escolher_categoria')
        .setPlaceholder('Configurar categoria')
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
            new ActionRowBuilder()
                .addComponents(equipe),

            new ActionRowBuilder()
                .addComponents(modalidades),

            linhaVoltar()
        ]
    };
}

function painelCategoria(config, metodo) {
    const atual =
        config.tickets.categorias[metodo];

    const menu = new ChannelSelectMenuBuilder()
        .setCustomId(
            `setup_ticket_categoria_${metodo}`
        )
        .setPlaceholder('Selecione a categoria')
        .setChannelTypes(ChannelType.GuildCategory);

    return {
        embeds: [
            criarEmbed(
                'Categoria de tickets',

                `**Modalidade:** ${MODALIDADES[metodo]}\n` +
                `**Categoria atual:** ${canalTexto(atual)}`
            )
        ],
        components: [
            new ActionRowBuilder()
                .addComponents(menu),

            linhaVoltar('setup_tickets')
        ]
    };
}

// ==========================================
// PAINEL DE BLOQUEIOS
// ==========================================

function painelBloqueios(config) {
    const bloqueados =
        config.tickets.bloqueados;

    const descricao = Object.entries(MODALIDADES)
        .map(([chave, nome]) =>
            `**${nome}:** ` +
            (bloqueados[chave] ? 'Bloqueado' : 'Liberado')
        )
        .join('\n');

    const botoes = Object.entries(MODALIDADES)
        .map(([chave, nome]) =>
            new ButtonBuilder()
                .setCustomId(`setup_bloqueio_${chave}`)
                .setLabel(nome)
                .setStyle(
                    bloqueados[chave]
                        ? ButtonStyle.Danger
                        : ButtonStyle.Success
                )
        );

    return {
        embeds: [
            criarEmbed(
                'Bloqueios de modalidades',

                `${descricao}\n\n` +
                'Clique para bloquear ou liberar novas compras.'
            )
        ],
        components: [
            new ActionRowBuilder()
                .addComponents(...botoes),

            linhaVoltar()
        ]
    };
}

// ==========================================
// PAINEL DE PEDIDOS
// ==========================================

function painelPedidos(config) {
    const tickets = config.tickets;

    const embed = criarEmbed(
        'Central de Pedidos • Configurações',

        `**Canal escolhido:** ` +
        `${canalTexto(tickets.painelCanalId)}\n\n` +

        'A mensagem pública utilizará o ' +
        '**banner.png** e a **logo.png** ' +
        'da InovareSale.\n\n' +

        'O painel terá dois botões:\n' +
        '• Comprar quantia específica\n' +
        '• Calcular valores\n\n' +

        'Escolha o canal e clique em ' +
        '**Publicar Central**.'
    );

    const menu = new ChannelSelectMenuBuilder()
        .setCustomId('setup_pedidos_canal')
        .setPlaceholder('Canal da Central de Pedidos')
        .setChannelTypes(ChannelType.GuildText);

    const botoes = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('setup_pedidos_publicar')
                .setLabel('Publicar Central')
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId('setup_voltar')
                .setLabel('Voltar')
                .setStyle(ButtonStyle.Secondary)
        );

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder()
                .addComponents(menu),

            botoes
        ]
    };
}

// ==========================================
// PUBLICAR A NOVA CENTRAL COM BANNER
// ==========================================

function criarCentralPublica(config, guildId) {
    return criarPainelPedidos(config, guildId);
}

async function publicarCentral(interaction) {
    const config = carregarConfig();

    const canalId =
        config.tickets.painelCanalId;

    if (!canalId) {
        return responderPrivado(
            interaction,
            'Configure o canal da Central de Pedidos primeiro.'
        );
    }

    if (!config.tickets.cargoEquipeId) {
        return responderPrivado(
            interaction,
            'Configure o cargo da equipe de tickets primeiro.'
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

    const canal = await interaction.guild.channels.fetch(
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

    const canalAntigoId =
        config.tickets.painelPublicadoCanalId;

    const mensagemAntigaId =
        config.tickets.painelMensagemId;

    // Usa o painel novo, com os arquivos PNG.
    const novaMensagem = await canal.send(
        criarCentralPublica(
            config,
            interaction.guildId
        )
    );

    config.tickets.painelPublicadoCanalId =
        canal.id;

    config.tickets.painelMensagemId =
        novaMensagem.id;

    saveConfig(config);

    // Remover a mensagem antiga, se existir.
    if (
        canalAntigoId &&
        mensagemAntigaId &&
        mensagemAntigaId !== novaMensagem.id
    ) {
        try {
            const canalAntigo =
                await interaction.guild.channels.fetch(
                    canalAntigoId
                );

            if (canalAntigo?.messages) {
                const mensagemAntiga =
                    await canalAntigo.messages.fetch(
                        mensagemAntigaId
                    );

                if (
                    mensagemAntiga.author.id ===
                    interaction.client.user.id
                ) {
                    await mensagemAntiga.delete();
                }
            }
        } catch (erro) {
            console.warn(
                '[InovareSale] Central antiga não removida:',
                erro.message
            );
        }
    }

    return interaction.editReply({
        content:
            'Central de Pedidos publicada com sucesso!\n' +
            `[Abrir painel](${novaMensagem.url})`
    });
}

// ==========================================
// MODAL DE PREÇOS
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
        .setPlaceholder('Exemplo: 39, 42 ou OFF')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    if (
        atual !== null &&
        atual !== undefined
    ) {
        entrada.setValue(String(atual));
    }

    modal.addComponents(
        new ActionRowBuilder()
            .addComponents(entrada)
    );

    return interaction.showModal(modal);
}

function interpretarPrecoK(texto, permitirOff) {
    const valor = String(texto)
        .trim()
        .toUpperCase();

    if (valor === 'OFF' && permitirOff) {
        return null;
    }

    const numero = Number(
        valor
            .replace(/^K/, '')
            .replace(',', '.')
    );

    if (
        !Number.isFinite(numero) ||
        numero <= 0
    ) {
        throw new Error(
            'Informe um valor K maior que zero.'
        );
    }

    return numero;
}

// ==========================================
// INTERAÇÕES DO SETUP
// ==========================================

async function handleSetupInteraction(interaction) {
    const id = interaction.customId || '';

    const ehSetup =
        id.startsWith('setup_') ||
        id.startsWith('modal_k_') ||
        id === 'modal_estoque_preco';

    if (!ehSetup) {
        return false;
    }

    if (
        !interaction.inGuild() ||
        !interaction.memberPermissions?.has(
            PermissionFlagsBits.Administrator
        )
    ) {
        await responderPrivado(
            interaction,
            'Somente administradores podem alterar as configurações.'
        );

        return true;
    }

    try {
        const config = carregarConfig();

        // ==================================
        // MODAIS
        // ==================================

        if (interaction.isModalSubmit()) {
            if (id.startsWith('modal_k_')) {
                const metodo = id.slice(
                    'modal_k_'.length
                );

                if (!MODALIDADES[metodo]) {
                    throw new Error(
                        'Modalidade inválida.'
                    );
                }

                const texto =
                    interaction.fields.getTextInputValue(
                        'valor_k'
                    );

                config.calculadora[metodo] =
                    interpretarPrecoK(
                        texto,
                        true
                    );

                saveConfig(config);

                await responderPrivado(
                    interaction,
                    'Preço da calculadora salvo com sucesso.'
                );

                return true;
            }

            if (id === 'modal_estoque_preco') {
                const texto =
                    interaction.fields.getTextInputValue(
                        'valor_k'
                    );

                config.estoque.precoK =
                    interpretarPrecoK(
                        texto,
                        false
                    );

                saveConfig(config);

                await responderPrivado(
                    interaction,
                    'Preço do estoque atualizado.'
                );

                return true;
            }
        }

        // ==================================
        // SELEÇÃO DE CANAIS
        // ==================================

        if (interaction.isChannelSelectMenu()) {
            const escolhido = interaction.values[0];

            const campos = {
                setup_canal_calculadora:
                    ['calculadora', 'canalId'],

                setup_canal_estoque:
                    ['estoque', 'canalId'],

                setup_canal_compra:
                    ['estoque', 'canalCompraId'],

                setup_canal_vendas:
                    ['vendas', 'canalId'],

                setup_pedidos_canal:
                    ['tickets', 'painelCanalId']
            };

            if (campos[id]) {
                const [secao, campo] =
                    campos[id];

                config[secao][campo] =
                    escolhido;

                saveConfig(config);

                const paineis = {
                    calculadora: painelCalculadora,
                    estoque: painelEstoque,
                    vendas: painelVendas,
                    tickets: painelPedidos
                };

                await mostrarPainel(
                    interaction,
                    paineis[secao](config)
                );

                return true;
            }

            const prefixo =
                'setup_ticket_categoria_';

            if (id.startsWith(prefixo)) {
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
                        escolhido
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
                    escolhido;

                saveConfig(config);

                await mostrarPainel(
                    interaction,
                    painelTickets(config)
                );

                return true;
            }
        }

        // ==================================
        // SELEÇÃO DE CARGOS
        // ==================================

        if (interaction.isRoleSelectMenu()) {
            const cargoId =
                interaction.values[0];

            if (id === 'setup_ticket_equipe') {
                config.tickets.cargoEquipeId =
                    cargoId;

                saveConfig(config);

                await mostrarPainel(
                    interaction,
                    painelTickets(config)
                );

                return true;
            }

            if (id.startsWith('setup_role_')) {
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
        }

        // ==================================
        // MENUS DE SELEÇÃO
        // ==================================

        if (interaction.isStringSelectMenu()) {
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
        }

        // ==================================
        // BOTÕES
        // ==================================

        if (!interaction.isButton()) {
            return false;
        }

        const paineis = {
            setup_calculadora: painelCalculadora,
            setup_estoque: painelEstoque,
            setup_vendas: painelVendas,
            setup_cargos: painelCargos,
            setup_tickets: painelTickets,
            setup_bloqueios: painelBloqueios,
            setup_pedidos: painelPedidos
        };

        if (id === 'setup_voltar') {
            await mostrarPainel(
                interaction,
                criarPainelSetup(config)
            );

            return true;
        }

        if (paineis[id]) {
            await mostrarPainel(
                interaction,
                paineis[id](config)
            );

            return true;
        }

        if (id.startsWith('setup_bloqueio_')) {
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

        if (id.startsWith('setup_k_')) {
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

        if (id === 'setup_estoque_preco') {
            await mostrarModalPreco(
                interaction,
                'modal_estoque_preco',
                'Preço do estoque',
                config.estoque.precoK
            );

            return true;
        }

        if (id === 'setup_pedidos_publicar') {
            await publicarCentral(interaction);

            return true;
        }

        return false;

    } catch (erro) {
        console.error(
            '[InovareSale] Erro no setup:',
            erro
        );

        try {
            await responderPrivado(
                interaction,
                `Não foi possível concluir a ação: ${erro.message}`
            );
        } catch (erroResposta) {
            console.error(
                '[InovareSale] Erro ao responder:',
                erroResposta
            );
        }

        return true;
    }
}

// ==========================================
// EXPORTAÇÕES
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
