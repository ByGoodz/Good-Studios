
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
    AttachmentBuilder,
    ChannelType,
    PermissionFlagsBits,
    MessageFlags
} = require('discord.js');

const fs = require('fs');
const path = require('path');

const {
    getConfig,
    saveConfig
} = require('../utils/storage');

const {
    criarPainelPrincipal
} = require('../commands/setup');

// ==========================================
// INOVARESALE BOT 2.0
// GERENCIADOR DO PAINEL CENTRAL
// ==========================================

const METODOS = {
    viaPlus: 'Via Plus',
    semTaxa: 'Robux Sem Taxa',
    taxado: 'Robux Taxado',
    viaGrupo: 'Robux Via Grupo'
};

const CARGOS = {
    primeiraCompra: '🥉 Primeira compra',
    cliente100: '🥈 Cliente R$100',
    cliente300: '🥇 Cliente R$300',
    cliente500: '💎 Cliente R$500',
    cliente1000: '💠 Cliente R$1.000',
    cliente5000: '💚 Cliente R$5.000',
    cliente10000: '👑 Cliente R$10.000'
};

// ==========================================
// CARREGAR CONFIGURAÇÃO
// ==========================================

function carregarConfig() {
    const config = getConfig() || {};

    config.calculadora ??= {};
    config.estoque ??= {};
    config.vendas ??= {};
    config.cargos ??= {};
    config.setup ??= {};
    config.tickets ??= {};

    const calc = config.calculadora;

    calc.canalId ??= null;
    calc.viaPlus ??= 42;

    if (!('viaGrupo' in calc)) {
        calc.viaGrupo = null;
    }

    calc.semTaxa ??= 39;
    calc.taxado ??= 39;

    const estoque = config.estoque;

    estoque.canalId ??= null;
    estoque.canalCompraId ??= null;
    estoque.precoK ??= 39;

    config.vendas.canalId ??= null;

    const tickets = config.tickets;

    tickets.cargoEquipeId ??= null;
    tickets.painelCanalId ??= null;
    tickets.painelMensagemId ??= null;

    tickets.categorias ??= {};
    tickets.bloqueados ??= {};

    for (const metodo of Object.keys(METODOS)) {
        tickets.categorias[metodo] ??= null;

        if (!(metodo in tickets.bloqueados)) {
            // Via Grupo começa desativado.
            tickets.bloqueados[metodo] =
                metodo === 'viaGrupo';
        }
    }

    return config;
}

// ==========================================
// FORMATAÇÃO
// ==========================================

function formatarCanal(id) {
    return id ? `<#${id}>` : '`Não configurado`';
}

function formatarCargo(id) {
    return id ? `<@&${id}>` : '`Não configurado`';
}

function formatarK(valor) {
    if (
        valor === null ||
        valor === undefined ||
        valor === false
    ) {
        return 'OFF';
    }

    return `K${Number(valor).toLocaleString(
        'pt-BR',
        { maximumFractionDigits: 2 }
    )}`;
}

function criarEmbed(titulo, descricao) {
    return new EmbedBuilder()
        .setColor(0xC0C0C0)
        .setTitle(titulo)
        .setDescription(descricao)
        .setFooter({
            text: 'InovareSale • Configurações 2.0'
        });
}

function botaoVoltar(destino = 'setup_voltar') {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(destino)
                .setLabel('Voltar')
                .setEmoji('⬅️')
                .setStyle(ButtonStyle.Secondary)
        );
}

// ==========================================
// RESPOSTAS PRIVADAS
// ==========================================

function mensagemEhPrivada(interaction) {
    return Boolean(
        interaction.message?.flags?.has(
            MessageFlags.Ephemeral
        )
    );
}

async function mostrarPainel(interaction, painel) {
    // Se já estamos em um submenu privado,
    // atualizamos apenas aquele submenu.

    if (mensagemEhPrivada(interaction)) {
        return interaction.update(painel);
    }

    // Se o clique veio do painel público,
    // criamos uma resposta privada.

    return interaction.reply({
        ...painel,
        flags: MessageFlags.Ephemeral
    });
}

async function mostrarResultadoModal(
    interaction,
    painel
) {
    if (interaction.isFromMessage()) {
        return interaction.update(painel);
    }

    return interaction.reply({
        content: '✅ Configuração salva.',
        flags: MessageFlags.Ephemeral
    });
}

async function avisoPrivado(interaction, texto) {
    return interaction.reply({
        content: texto,
        flags: MessageFlags.Ephemeral
    });
}

// ==========================================
// PAINEL DA CALCULADORA
// ==========================================

function painelCalculadora(config) {
    const calc = config.calculadora;

    const embed = criarEmbed(
        '🧮 Configurações da Calculadora',

        `📍 **Canal:** ${formatarCanal(calc.canalId)}\n\n` +

        `➕ **Via Plus:** ${formatarK(calc.viaPlus)}\n` +
        `💸 **Sem Taxa:** ${formatarK(calc.semTaxa)}\n` +
        `💰 **Taxado:** ${formatarK(calc.taxado)}\n` +
        `👥 **Via Grupo:** ${formatarK(calc.viaGrupo)}\n\n` +

        'Selecione o canal ou altere os valores K.'
    );

    const canal = new ActionRowBuilder()
        .addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('setup_canal_calculadora')
                .setPlaceholder('Canal da calculadora')
                .setChannelTypes(ChannelType.GuildText)
                .setMinValues(1)
                .setMaxValues(1)
        );

    const precos = new ActionRowBuilder()
        .addComponents(
            ...Object.entries(METODOS).map(
                ([chave, nome]) =>
                    new ButtonBuilder()
                        .setCustomId(`setup_k_${chave}`)
                        .setLabel(
                            `${nome} • ${formatarK(calc[chave])}`
                        )
                        .setStyle(ButtonStyle.Secondary)
            )
        );

    return {
        embeds: [embed],
        components: [
            canal,
            precos,
            botaoVoltar()
        ]
    };
}

// ==========================================
// PAINEL DO ESTOQUE
// ==========================================

function painelEstoque(config) {
    const estoque = config.estoque;

    const embed = criarEmbed(
        '📦 Configurações do Estoque',

        `📍 **Canal do estoque:** ${formatarCanal(estoque.canalId)}\n\n` +

        `🛒 **Canal de compra:** ${formatarCanal(estoque.canalCompraId)}\n\n` +

        `💰 **Preço K:** ${formatarK(estoque.precoK)}\n\n` +

        'Configure os canais e o valor exibido no estoque.'
    );

    const canalEstoque = new ActionRowBuilder()
        .addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('setup_canal_estoque')
                .setPlaceholder('Canal do estoque')
                .setChannelTypes(ChannelType.GuildText)
        );

    const canalCompra = new ActionRowBuilder()
        .addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('setup_canal_compra')
                .setPlaceholder('Canal de compra')
                .setChannelTypes(ChannelType.GuildText)
        );

    const botoes = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('setup_estoque_preco')
                .setLabel(
                    `Preço • ${formatarK(estoque.precoK)}`
                )
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId('setup_voltar')
                .setLabel('Voltar')
                .setStyle(ButtonStyle.Secondary)
        );

    return {
        embeds: [embed],
        components: [
            canalEstoque,
            canalCompra,
            botoes
        ]
    };
}

// ==========================================
// PAINEL DE VENDAS
// ==========================================

function painelVendas(config) {
    const embed = criarEmbed(
        '💰 Configurações de Vendas',

        `📍 **Canal das vendas:** ` +
        `${formatarCanal(config.vendas.canalId)}\n\n` +

        'As vendas concluídas serão publicadas ' +
        'automaticamente neste canal.'
    );

    const canal = new ActionRowBuilder()
        .addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('setup_canal_vendas')
                .setPlaceholder('Canal de vendas')
                .setChannelTypes(ChannelType.GuildText)
        );

    return {
        embeds: [embed],
        components: [canal, botaoVoltar()]
    };
}

// ==========================================
// PAINEL DOS CARGOS
// ==========================================

function painelCargos(config) {
    const descricao = Object.entries(CARGOS)
        .map(
            ([chave, nome]) =>
                `${nome}: ${formatarCargo(config.cargos[chave])}`
        )
        .join('\n');

    const embed = criarEmbed(
        '🏆 Configurações dos Cargos',

        `${descricao}\n\n` +
        'Escolha um nível para configurar seu cargo.'
    );

    const menu = new StringSelectMenuBuilder()
        .setCustomId('setup_selecionar_nivel_cargo')
        .setPlaceholder('Selecione um nível')
        .addOptions(
            Object.entries(CARGOS).map(
                ([chave, nome]) => ({
                    label: nome,
                    value: chave
                })
            )
        );

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(menu),
            botaoVoltar()
        ]
    };
}

function painelSelecionarCargo(config, nivel) {
    const embed = criarEmbed(
        '🏆 Selecionar Cargo',

        `**Nível:** ${CARGOS[nivel]}\n\n` +
        `**Cargo atual:** ` +
        `${formatarCargo(config.cargos[nivel])}\n\n` +
        'Selecione o cargo do servidor.'
    );

    const menu = new RoleSelectMenuBuilder()
        .setCustomId(`setup_role_${nivel}`)
        .setPlaceholder('Selecione o cargo');

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(menu),
            botaoVoltar('setup_cargos')
        ]
    };
}

// ==========================================
// PAINEL DE TICKETS
// ==========================================

function painelTickets(config) {
    const tickets = config.tickets;

    const categorias = Object.entries(METODOS)
        .map(
            ([chave, nome]) =>
                `**${nome}:** ` +
                `${formatarCanal(tickets.categorias[chave])}`
        )
        .join('\n');

    const embed = criarEmbed(
        '🎫 Configurações de Tickets',

        `👥 **Equipe de atendimento:** ` +
        `${formatarCargo(tickets.cargoEquipeId)}\n\n` +

        '**Categorias dos tickets:**\n' +
        `${categorias}\n\n` +

        'Cada modalidade pode ter sua própria categoria.\n\n' +

        'Somente o cliente, a equipe autorizada e ' +
        'o bot terão acesso ao ticket.'
    );

    const selecionarEquipe =
        new RoleSelectMenuBuilder()
            .setCustomId('setup_ticket_equipe')
            .setPlaceholder(
                'Selecione o cargo da equipe de tickets'
            );

    const selecionarCategoria =
        new StringSelectMenuBuilder()
            .setCustomId('setup_ticket_escolher_categoria')
            .setPlaceholder(
                'Escolha a modalidade para configurar'
            )
            .addOptions(
                Object.entries(METODOS).map(
                    ([chave, nome]) => ({
                        label: nome,
                        value: chave
                    })
                )
            );

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder()
                .addComponents(selecionarEquipe),

            new ActionRowBuilder()
                .addComponents(selecionarCategoria),

            botaoVoltar()
        ]
    };
}

// ==========================================
// CONFIGURAR CATEGORIA ESPECÍFICA
// ==========================================

function painelCategoria(config, metodo) {
    const categoriaAtual =
        config.tickets.categorias[metodo];

    const embed = criarEmbed(
        '📁 Categoria do Ticket',

        `**Modalidade:** ${METODOS[metodo]}\n\n` +

        `**Categoria atual:** ` +
        `${formatarCanal(categoriaAtual)}\n\n` +

        'Escolha a categoria onde os tickets ' +
        'dessa modalidade serão criados.'
    );

    const menu = new ChannelSelectMenuBuilder()
        .setCustomId(
            `setup_ticket_categoria_${metodo}`
        )
        .setPlaceholder('Selecione uma categoria')
        .setChannelTypes(ChannelType.GuildCategory)
        .setMinValues(1)
        .setMaxValues(1);

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(menu),
            botaoVoltar('setup_tickets')
        ]
    };
}

// ==========================================
// PAINEL DE BLOQUEIOS
// ==========================================

function painelBloqueios(config) {
    const bloqueados = config.tickets.bloqueados;

    const descricao = Object.entries(METODOS)
        .map(([chave, nome]) => {
            const status = bloqueados[chave]
                ? '🔴 TRANCADO'
                : '🟢 LIBERADO';

            return `**${nome}:** ${status}`;
        })
        .join('\n');

    const embed = criarEmbed(
        '🔐 Bloqueio de Modalidades',

        `${descricao}\n\n` +

        'Clique em uma modalidade para ' +
        'trancar ou destrancar novas compras.\n\n' +

        'Tickets já existentes não serão apagados.'
    );

    const botoes = new ActionRowBuilder()
        .addComponents(
            ...Object.entries(METODOS).map(
                ([chave, nome]) => {
                    const bloqueado =
                        bloqueados[chave];

                    return new ButtonBuilder()
                        .setCustomId(
                            `setup_bloqueio_${chave}`
                        )
                        .setLabel(nome)
                        .setEmoji(
                            bloqueado ? '🔒' : '🔓'
                        )
                        .setStyle(
                            bloqueado
                                ? ButtonStyle.Danger
                                : ButtonStyle.Success
                        );
                }
            )
        );

    return {
        embeds: [embed],
        components: [
            botoes,
            botaoVoltar()
        ]
    };
}

// ==========================================
// PAINEL DE PEDIDOS
// ==========================================

function painelPedidos(config) {
    const tickets = config.tickets;

    const embed = criarEmbed(
        '🛒 Central de Pedidos',

        `📍 **Canal:** ` +
        `${formatarCanal(tickets.painelCanalId)}\n\n` +

        'Configure o canal onde ficará a ' +
        'mensagem de abertura de compras.\n\n' +

        'O painel terá os botões:\n\n' +

        '🛒 **Comprar quantia específica**\n' +
        '🧮 **Calcular valores**\n\n' +

        'Após escolher o canal, clique em ' +
        '**Publicar Central**.'
    );

    const canal = new ChannelSelectMenuBuilder()
        .setCustomId('setup_pedidos_canal')
        .setPlaceholder(
            'Selecione o canal da Central de Pedidos'
        )
        .setChannelTypes(ChannelType.GuildText);

    const botoes = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('setup_pedidos_publicar')
                .setLabel('Publicar Central')
                .setEmoji('🛒')
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId('setup_voltar')
                .setLabel('Voltar')
                .setStyle(ButtonStyle.Secondary)
        );

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(canal),
            botoes
        ]
    };
}

// ==========================================
// CRIAR CENTRAL DE COMPRAS PÚBLICA
// ==========================================

function criarCentralPublica(config, guildId) {
    const embed = new EmbedBuilder()
        .setColor(0xC0C0C0)
        .setTitle(
            '💎 CENTRAL DE PEDIDOS — INOVARESALE'
        )
        .setDescription(
            'Bem-vindo à **InovareSale**!\n\n' +

            'Está procurando Robux com praticidade? ' +
            'Você está no lugar certo!\n\n' +

            '🛒 **COMPRAR QUANTIA ESPECÍFICA**\n' +
            'Informe quantos Robux deseja comprar, ' +
            'escolha a modalidade e abra um ticket ' +
            'com nossa equipe.\n\n' +

            '🧮 **CALCULAR VALORES**\n' +
            'Confira os preços disponíveis antes ' +
            'de realizar sua compra.\n\n' +

            '✨ **InovareSale — Sua loja de Robux**'
        )
        .setFooter({
            text: 'InovareSale • Central de Atendimento'
        });

    const arquivos = [];
    const pastaAssets = path.join(
        __dirname,
        '..',
        'assets'
    );

    for (const nome of ['logo.png', 'banner.png']) {
        const caminho = path.join(
            pastaAssets,
            nome
        );

        try {
            if (
                !fs.statSync(caminho).isFile() ||
                fs.statSync(caminho).size === 0
            ) {
                continue;
            }

            arquivos.push(
                new AttachmentBuilder(caminho, {
                    name: nome
                })
            );

            if (nome === 'logo.png') {
                embed.setThumbnail(
                    'attachment://logo.png'
                );
            }

            if (nome === 'banner.png') {
                embed.setImage(
                    'attachment://banner.png'
                );
            }

        } catch {
            // Imagem ausente: continua sem ela.
        }
    }

    const comprar = new ButtonBuilder()
        .setCustomId('ticket_abrir')
        .setLabel('Comprar quantia específica')
        .setEmoji('🛒')
        .setStyle(ButtonStyle.Success);

    let calcular;

    if (config.calculadora?.canalId) {
        calcular = new ButtonBuilder()
            .setLabel('Calcular valores')
            .setEmoji('🧮')
            .setStyle(ButtonStyle.Link)
            .setURL(
                `https://discord.com/channels/` +
                `${guildId}/${config.calculadora.canalId}`
            );
    } else {
        calcular = new ButtonBuilder()
            .setCustomId('ticket_calculadora_indisponivel')
            .setLabel('Calcular valores')
            .setEmoji('🧮')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true);
    }

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder()
                .addComponents(comprar, calcular)
        ],
        files: arquivos,
        allowedMentions: {
            parse: []
        }
    };
}

// ==========================================
// PUBLICAR CENTRAL DE PEDIDOS
// ==========================================

async function publicarCentral(interaction) {
    const config = carregarConfig();

    if (!config.tickets.painelCanalId) {
        return avisoPrivado(
            interaction,
            '❌ Configure o canal da Central de Pedidos primeiro.'
        );
    }

    if (!config.tickets.cargoEquipeId) {
        return avisoPrivado(
            interaction,
            '❌ Configure o cargo da equipe de tickets primeiro.'
        );
    }

    const canal = await interaction.guild.channels.fetch(
        config.tickets.painelCanalId
    );

    if (
        !canal ||
        canal.type !== ChannelType.GuildText
    ) {
        return avisoPrivado(
            interaction,
            '❌ Canal de pedidos inválido.'
        );
    }

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    const anteriorCanalId =
        config.tickets.painelPublicadoCanalId;

    const anteriorMensagemId =
        config.tickets.painelMensagemId;

    const nova = await canal.send(
        criarCentralPublica(
            config,
            interaction.guildId
        )
    );

    config.tickets.painelPublicadoCanalId = canal.id;
    config.tickets.painelMensagemId = nova.id;

    saveConfig(config);

    let aviso = '';

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

            const antiga =
                await canalAntigo.messages.fetch(
                    anteriorMensagemId
                );

            if (
                antiga.author.id ===
                interaction.client.user.id
            ) {
                await antiga.delete();
            }

        } catch {
            aviso =
                '\n⚠️ Não foi possível remover a central antiga.';
        }
    }

    return interaction.editReply({
        content:
            '✅ **Central de Pedidos publicada!**\n\n' +
            `[Abrir mensagem](${nova.url})` +
            aviso
    });
}

// ==========================================
// MODAIS DE PREÇOS
// ==========================================

async function mostrarModalPreco(
    interaction,
    customId,
    titulo,
    valor
) {
    const modal = new ModalBuilder()
        .setCustomId(customId)
        .setTitle(titulo);

    const input = new TextInputBuilder()
        .setCustomId('valor_k')
        .setLabel('Digite o valor K ou OFF')
        .setPlaceholder('Exemplo: 39, 42 ou OFF')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    if (
        valor !== null &&
        valor !== undefined
    ) {
        input.setValue(String(valor));
    }

    modal.addComponents(
        new ActionRowBuilder().addComponents(input)
    );

    return interaction.showModal(modal);
}

function interpretarK(texto) {
    const valor = texto.trim().toUpperCase();

    if (valor === 'OFF') {
        return { valido: true, valor: null };
    }

    const numero = Number(
        valor.replace(/^K/, '').replace(',', '.')
    );

    if (
        !Number.isFinite(numero) ||
        numero <= 0
    ) {
        return { valido: false };
    }

    return {
        valido: true,
        valor: numero
    };
}

// ==========================================
// PROCESSAR INTERAÇÕES DO SETUP
// ==========================================

async function handleSetupInteraction(interaction) {
    const id = interaction.customId || '';

    const pertenceAoSetup =
        id.startsWith('setup_') ||
        id.startsWith('modal_k_') ||
        id === 'modal_estoque_preco';

    if (!pertenceAoSetup) {
        return false;
    }

    // ======================================
    // PROTEÇÃO ADMINISTRATIVA
    // ======================================

    if (
        !interaction.memberPermissions?.has(
            PermissionFlagsBits.Administrator
        )
    ) {
        await avisoPrivado(
            interaction,
            '❌ Apenas administradores podem utilizar este painel.'
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
                const metodo = id.replace(
                    'modal_k_', ''
                );

                if (!METODOS[metodo]) {
                    await avisoPrivado(
                        interaction,
                        '❌ Modalidade inválida.'
                    );

                    return true;
                }

                const resultado = interpretarK(
                    interaction.fields.getTextInputValue(
                        'valor_k'
                    )
                );

                if (!resultado.valido) {
                    await avisoPrivado(
                        interaction,
                        '❌ Digite um K válido ou OFF.'
                    );

                    return true;
                }

                config.calculadora[metodo] =
                    resultado.valor;

                saveConfig(config);

                await mostrarResultadoModal(
                    interaction,
                    painelCalculadora(config)
                );

                return true;
            }

            if (id === 'modal_estoque_preco') {
                const resultado = interpretarK(
                    interaction.fields.getTextInputValue(
                        'valor_k'
                    )
                );

                if (
                    !resultado.valido ||
                    resultado.valor === null
                ) {
                    await avisoPrivado(
                        interaction,
                        '❌ O preço do estoque precisa ser maior que zero.'
                    );

                    return true;
                }

                config.estoque.precoK =
                    resultado.valor;

                saveConfig(config);

                await mostrarResultadoModal(
                    interaction,
                    painelEstoque(config)
                );

                return true;
            }
        }

        // ==================================
        // SELETORES DE CANAL
        // ==================================

        if (interaction.isChannelSelectMenu()) {
            const canalId = interaction.values[0];

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
                const [secao, chave] = campos[id];

                config[secao][chave] = canalId;
                saveConfig(config);

                const painel =
                    secao === 'calculadora'
                        ? painelCalculadora(config)
                        : secao === 'estoque'
                            ? painelEstoque(config)
                            : secao === 'vendas'
                                ? painelVendas(config)
                                : painelPedidos(config);

                await mostrarPainel(
                    interaction,
                    painel
                );

                return true;
            }

            if (
                id.startsWith(
                    'setup_ticket_categoria_'
                )
            ) {
                const metodo = id.replace(
                    'setup_ticket_categoria_', ''
                );

                if (!METODOS[metodo]) {
                    return false;
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
        }

        // ==================================
        // SELETORES DE CARGO
        // ==================================

        if (interaction.isRoleSelectMenu()) {
            if (id === 'setup_ticket_equipe') {
                config.tickets.cargoEquipeId =
                    interaction.values[0];

                saveConfig(config);

                await mostrarPainel(
                    interaction,
                    painelTickets(config)
                );

                return true;
            }

            if (id.startsWith('setup_role_')) {
                const nivel = id.replace(
                    'setup_role_', ''
                );

                if (!CARGOS[nivel]) {
                    return false;
                }

                config.cargos[nivel] =
                    interaction.values[0];

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

                if (!CARGOS[nivel]) {
                    return false;
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

                if (!METODOS[metodo]) {
                    return false;
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
                painelPedidos
        };

        if (id === 'setup_voltar') {
            await mostrarPainel(
                interaction,
                criarPainelPrincipal()
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

        // ==================================
        // TRANCAR / DESTRANCAR
        // ==================================

        if (
            id.startsWith('setup_bloqueio_')
        ) {
            const metodo = id.replace(
                'setup_bloqueio_', ''
            );

            if (!METODOS[metodo]) {
                return false;
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
        // ALTERAR VALOR K
        // ==================================

        if (id.startsWith('setup_k_')) {
            const metodo = id.replace(
                'setup_k_', ''
            );

            if (!METODOS[metodo]) {
                return false;
            }

            await mostrarModalPreco(
                interaction,
                `modal_k_${metodo}`,
                `Configurar ${METODOS[metodo]}`,
                config.calculadora[metodo]
            );

            return true;
        }

        // ==================================
        // ALTERAR PREÇO DO ESTOQUE
        // ==================================

        if (id === 'setup_estoque_preco') {
            await mostrarModalPreco(
                interaction,
                'modal_estoque_preco',
                'Preço do Estoque',
                config.estoque.precoK
            );

            return true;
        }

        // ==================================
        // PUBLICAR CENTRAL DE PEDIDOS
        // ==================================

        if (id === 'setup_pedidos_publicar') {
            await publicarCentral(interaction);
            return true;
        }

        return false;

    } catch (erro) {
        console.error(
            '❌ Erro no Setup Handler:',
            erro
        );

        try {
            if (
                interaction.replied ||
                interaction.deferred
            ) {
                await interaction.followUp({
                    content:
                        '❌ Ocorreu um erro nas configurações. Verifique os logs.',
                    flags: MessageFlags.Ephemeral
                });
            } else {
                await avisoPrivado(
                    interaction,
                    '❌ Ocorreu um erro nas configurações. Verifique os logs.'
                );
            }
        } catch {}

        return true;
    }
}

// ==========================================
// EXPORTAR FUNÇÕES
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
