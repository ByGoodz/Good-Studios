const {
    Events,
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


// ==========================================
// CONFIGURAÇÕES PADRÃO
// ==========================================

function definirPadrao(objeto, chave, valor) {
    if (!(chave in objeto)) {
        objeto[chave] = valor;
    }
}

function carregarConfig() {
    const config = getConfig() || {};

    if (!config.calculadora) config.calculadora = {};
    if (!config.estoque) config.estoque = {};
    if (!config.vendas) config.vendas = {};
    if (!config.cargos) config.cargos = {};

    // Calculadora
    definirPadrao(config.calculadora, 'canalId', null);

    definirPadrao(
        config.calculadora,
        'viaPlus',
        42
    );

    definirPadrao(
        config.calculadora,
        'viaGrupo',
        null
    );

    definirPadrao(
        config.calculadora,
        'semTaxa',
        39
    );

    definirPadrao(
        config.calculadora,
        'taxado',
        39
    );

    // Estoque
    definirPadrao(
        config.estoque,
        'canalId',
        null
    );

    definirPadrao(
        config.estoque,
        'canalCompraId',
        null
    );

    definirPadrao(
        config.estoque,
        'precoK',
        39
    );

    // Vendas
    definirPadrao(
        config.vendas,
        'canalId',
        null
    );

    // Cargos
    definirPadrao(
        config.cargos,
        'primeiraCompra',
        null
    );

    definirPadrao(
        config.cargos,
        'cliente100',
        null
    );

    definirPadrao(
        config.cargos,
        'cliente300',
        null
    );

    definirPadrao(
        config.cargos,
        'cliente500',
        null
    );

    definirPadrao(
        config.cargos,
        'cliente1000',
        null
    );

    definirPadrao(
        config.cargos,
        'cliente5000',
        null
    );

    definirPadrao(
        config.cargos,
        'cliente10000',
        null
    );

    return config;
}


// ==========================================
// NOMES DOS MÉTODOS
// ==========================================

const METODOS = {
    viaPlus: 'Via Plus',
    viaGrupo: 'Via Grupo',
    semTaxa: 'Robux Sem Taxa',
    taxado: 'Robux Taxado'
};


// ==========================================
// CARGOS
// ==========================================

const CARGOS = {
    primeiraCompra: '🥉 Primeira compra',
    cliente100: '🥈 R$100',
    cliente300: '🥇 R$300',
    cliente500: '💎 R$500',
    cliente1000: '💠 R$1.000',
    cliente5000: '💚 R$5.000',
    cliente10000: '👑 R$10.000'
};


// ==========================================
// FORMATAÇÃO
// ==========================================

function formatarK(valor) {

    if (
        valor === null ||
        valor === undefined ||
        valor === false
    ) {
        return 'OFF';
    }

    const numero = Number(valor);

    return `K${numero.toLocaleString('pt-BR', {
        maximumFractionDigits: 2
    })}`;
}


function formatarCanal(canalId) {

    if (!canalId) {
        return '`Não configurado`';
    }

    return `<#${canalId}>`;
}


function formatarCargo(cargoId) {

    if (!cargoId) {
        return '`Não configurado`';
    }

    return `<@&${cargoId}>`;
}


// ==========================================
// PAINEL PRINCIPAL
// ==========================================

function criarPainelPrincipal() {

    const embed = new EmbedBuilder()

        .setTitle(
            '⚙️ Painel de Configuração — InovareSale'
        )

        .setDescription(
            'Configure o bot diretamente pelo Discord.\n\n' +

            '🧮 **Calculadora**\n' +
            'Preços, métodos e canal da calculadora.\n\n' +

            '📦 **Estoque**\n' +
            'Canal de estoque, canal de compra e preço.\n\n' +

            '💰 **Vendas**\n' +
            'Canal onde as vendas serão publicadas.\n\n' +

            '🏆 **Cargos**\n' +
            'Cargos automáticos conforme o total gasto.'
        )

        .setFooter({
            text: 'InovareSale • Painel Administrativo'
        });


    const botoes = new ActionRowBuilder()
        .addComponents(

            new ButtonBuilder()
                .setCustomId('setup_calculadora')
                .setLabel('Calculadora')
                .setEmoji('🧮')
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId('setup_estoque')
                .setLabel('Estoque')
                .setEmoji('📦')
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId('setup_vendas')
                .setLabel('Vendas')
                .setEmoji('💰')
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId('setup_cargos')
                .setLabel('Cargos')
                .setEmoji('🏆')
                .setStyle(ButtonStyle.Secondary)
        );


    return {
        embeds: [embed],
        components: [botoes]
    };
}


// ==========================================
// PAINEL DA CALCULADORA
// ==========================================

function criarPainelCalculadora(config) {

    const calc = config.calculadora;

    const embed = new EmbedBuilder()

        .setTitle(
            '🧮 Configuração da Calculadora'
        )

        .setDescription(
            `📍 **Canal:** ${formatarCanal(calc.canalId)}\n\n` +

            `➕ **Via Plus:** ${formatarK(calc.viaPlus)}\n` +

            `👥 **Via Grupo:** ${formatarK(calc.viaGrupo)}\n` +

            `💸 **Robux Sem Taxa:** ${formatarK(calc.semTaxa)}\n` +

            `💰 **Robux Taxado:** ${formatarK(calc.taxado)}\n\n` +

            'Selecione o canal ou clique em um método para alterar seu valor.'
        )

        .setFooter({
            text: 'InovareSale • Calculadora'
        });


    const canal = new ActionRowBuilder()
        .addComponents(

            new ChannelSelectMenuBuilder()

                .setCustomId(
                    'setup_canal_calculadora'
                )

                .setPlaceholder(
                    'Selecione o canal da calculadora'
                )

                .setChannelTypes(
                    ChannelType.GuildText
                )

                .setMinValues(1)

                .setMaxValues(1)
        );


    const precos = new ActionRowBuilder()
        .addComponents(

            new ButtonBuilder()
                .setCustomId('setup_k_viaPlus')
                .setLabel(
                    `Via Plus • ${formatarK(calc.viaPlus)}`
                )
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId('setup_k_viaGrupo')
                .setLabel(
                    `Via Grupo • ${formatarK(calc.viaGrupo)}`
                )
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId('setup_k_semTaxa')
                .setLabel(
                    `Sem Taxa • ${formatarK(calc.semTaxa)}`
                )
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId('setup_k_taxado')
                .setLabel(
                    `Taxado • ${formatarK(calc.taxado)}`
                )
                .setStyle(ButtonStyle.Secondary)
        );


    const voltar = new ActionRowBuilder()
        .addComponents(

            new ButtonBuilder()
                .setCustomId('setup_voltar')
                .setLabel('Voltar')
                .setEmoji('⬅️')
                .setStyle(ButtonStyle.Secondary)
        );


    return {
        embeds: [embed],
        components: [
            canal,
            precos,
            voltar
        ]
    };
}


// ==========================================
// PAINEL DO ESTOQUE
// ==========================================

function criarPainelEstoque(config) {

    const estoque = config.estoque;

    const embed = new EmbedBuilder()

        .setTitle(
            '📦 Configuração do Estoque'
        )

        .setDescription(
            `📍 **Canal do estoque:** ${formatarCanal(estoque.canalId)}\n\n` +

            `🛒 **Canal de compra:** ${formatarCanal(estoque.canalCompraId)}\n\n` +

            `💰 **Preço exibido:** ${formatarK(estoque.precoK)}\n\n` +

            'Essas informações serão usadas pelo comando `/estoque`.'
        )

        .setFooter({
            text: 'InovareSale • Estoque'
        });


    const canalEstoque = new ActionRowBuilder()
        .addComponents(

            new ChannelSelectMenuBuilder()

                .setCustomId(
                    'setup_canal_estoque'
                )

                .setPlaceholder(
                    'Selecione o canal do estoque'
                )

                .setChannelTypes(
                    ChannelType.GuildText
                )

                .setMinValues(1)

                .setMaxValues(1)
        );


    const canalCompra = new ActionRowBuilder()
        .addComponents(

            new ChannelSelectMenuBuilder()

                .setCustomId(
                    'setup_canal_compra'
                )

                .setPlaceholder(
                    'Selecione o canal de compra'
                )

                .setChannelTypes(
                    ChannelType.GuildText
                )

                .setMinValues(1)

                .setMaxValues(1)
        );


    const botoes = new ActionRowBuilder()
        .addComponents(

            new ButtonBuilder()
                .setCustomId(
                    'setup_estoque_preco'
                )
                .setLabel(
                    `Preço • ${formatarK(estoque.precoK)}`
                )
                .setEmoji('💰')
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId('setup_voltar')
                .setLabel('Voltar')
                .setEmoji('⬅️')
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

function criarPainelVendas(config) {

    const embed = new EmbedBuilder()

        .setTitle(
            '💰 Configuração de Vendas'
        )

        .setDescription(
            `📍 **Canal das vendas:** ${formatarCanal(config.vendas.canalId)}\n\n` +

            'Quando uma venda for registrada com `/venda`, ' +
            'ela será publicada neste canal.'
        )

        .setFooter({
            text: 'InovareSale • Vendas'
        });


    const canal = new ActionRowBuilder()
        .addComponents(

            new ChannelSelectMenuBuilder()

                .setCustomId(
                    'setup_canal_vendas'
                )

                .setPlaceholder(
                    'Selecione o canal de vendas'
                )

                .setChannelTypes(
                    ChannelType.GuildText
                )

                .setMinValues(1)

                .setMaxValues(1)
        );


    const voltar = new ActionRowBuilder()
        .addComponents(

            new ButtonBuilder()
                .setCustomId('setup_voltar')
                .setLabel('Voltar')
                .setEmoji('⬅️')
                .setStyle(ButtonStyle.Secondary)
        );


    return {
        embeds: [embed],
        components: [
            canal,
            voltar
        ]
    };
}


// ==========================================
// PAINEL DOS CARGOS
// ==========================================

function criarPainelCargos(config) {

    const embed = new EmbedBuilder()

        .setTitle(
            '🏆 Configuração dos Cargos'
        )

        .setDescription(
            `🥉 **Primeira compra:** ${formatarCargo(config.cargos.primeiraCompra)}\n\n` +

            `🥈 **R$100:** ${formatarCargo(config.cargos.cliente100)}\n` +

            `🥇 **R$300:** ${formatarCargo(config.cargos.cliente300)}\n` +

            `💎 **R$500:** ${formatarCargo(config.cargos.cliente500)}\n` +

            `💠 **R$1.000:** ${formatarCargo(config.cargos.cliente1000)}\n` +

            `💚 **R$5.000:** ${formatarCargo(config.cargos.cliente5000)}\n` +

            `👑 **R$10.000:** ${formatarCargo(config.cargos.cliente10000)}\n\n` +

            'Escolha abaixo qual nível deseja configurar.'
        )

        .setFooter({
            text: 'InovareSale • Autocargos'
        });


    const selecionarNivel = new StringSelectMenuBuilder()

        .setCustomId(
            'setup_selecionar_nivel_cargo'
        )

        .setPlaceholder(
            'Selecione um nível'
        )

        .addOptions(

            {
                label: 'Primeira compra',
                description: 'Cargo da primeira compra',
                value: 'primeiraCompra',
                emoji: '🥉'
            },

            {
                label: 'R$100',
                description: 'Cliente que atingiu R$100',
                value: 'cliente100',
                emoji: '🥈'
            },

            {
                label: 'R$300',
                description: 'Cliente que atingiu R$300',
                value: 'cliente300',
                emoji: '🥇'
            },

            {
                label: 'R$500',
                description: 'Cliente que atingiu R$500',
                value: 'cliente500',
                emoji: '💎'
            },

            {
                label: 'R$1.000',
                description: 'Cliente que atingiu R$1.000',
                value: 'cliente1000',
                emoji: '💠'
            },

            {
                label: 'R$5.000',
                description: 'Cliente que atingiu R$5.000',
                value: 'cliente5000',
                emoji: '💚'
            },

            {
                label: 'R$10.000',
                description: 'Cliente que atingiu R$10.000',
                value: 'cliente10000',
                emoji: '👑'
            }
        );


    const linhaNivel = new ActionRowBuilder()
        .addComponents(
            selecionarNivel
        );


    const voltar = new ActionRowBuilder()
        .addComponents(

            new ButtonBuilder()
                .setCustomId('setup_voltar')
                .setLabel('Voltar')
                .setEmoji('⬅️')
                .setStyle(ButtonStyle.Secondary)
        );


    return {
        embeds: [embed],
        components: [
            linhaNivel,
            voltar
        ]
    };
}


// ==========================================
// SELEÇÃO DE UM CARGO ESPECÍFICO
// ==========================================

function criarPainelSelecionarCargo(
    config,
    nivel
) {

    const nome = CARGOS[nivel];

    const embed = new EmbedBuilder()

        .setTitle(
            '🏆 Selecionar Cargo'
        )

        .setDescription(
            `Você está configurando:\n\n` +
            `**${nome}**\n\n` +
            `Cargo atual: ${formatarCargo(config.cargos[nivel])}\n\n` +
            'Selecione abaixo o cargo correto do servidor.'
        )

        .setFooter({
            text: 'InovareSale • Autocargos'
        });


    const selecionarCargo = new RoleSelectMenuBuilder()

        .setCustomId(
            `setup_role_${nivel}`
        )

        .setPlaceholder(
            'Selecione o cargo'
        )

        .setMinValues(1)

        .setMaxValues(1);


    const linhaCargo = new ActionRowBuilder()
        .addComponents(
            selecionarCargo
        );


    const voltar = new ActionRowBuilder()
        .addComponents(

            new ButtonBuilder()
                .setCustomId('setup_cargos')
                .setLabel('Voltar')
                .setEmoji('⬅️')
                .setStyle(ButtonStyle.Secondary)
        );


    return {
        embeds: [embed],
        components: [
            linhaCargo,
            voltar
        ]
    };
}


// ==========================================
// MODAL PARA ALTERAR VALOR K
// ==========================================

async function abrirModalK(
    interaction,
    chave,
    titulo,
    valorAtual
) {

    const modal = new ModalBuilder()

        .setCustomId(
            `modal_k_${chave}`
        )

        .setTitle(
            `Configurar ${titulo}`
        );


    const input = new TextInputBuilder()

        .setCustomId('valor_k')

        .setLabel(
            'Digite o valor K ou OFF'
        )

        .setPlaceholder(
            'Exemplo: 39, 42 ou OFF'
        )

        .setStyle(
            TextInputStyle.Short
        )

        .setRequired(true);


    if (valorAtual !== null) {

        input.setValue(
            String(valorAtual)
        );
    }


    const linha = new ActionRowBuilder()
        .addComponents(input);


    modal.addComponents(linha);


    await interaction.showModal(modal);
}


// ==========================================
// CONVERTER TEXTO PARA K
// ==========================================

function interpretarK(texto) {

    const valor = texto
        .trim()
        .toUpperCase();


    if (valor === 'OFF') {

        return {
            valido: true,
            valor: null
        };
    }


    const limpo = valor

        .replace(/^K/, '')

        .replace(',', '.');


    const numero = Number(limpo);


    if (
        !Number.isFinite(numero) ||
        numero <= 0
    ) {

        return {
            valido: false
        };
    }


    return {
        valido: true,
        valor: numero
    };
}


// ==========================================
// EVENTO PRINCIPAL
// ==========================================

module.exports = {

    name: Events.InteractionCreate,


    async execute(interaction, client) {

        // ==================================
        // COMANDOS /
        // ==================================

        if (
            interaction.isChatInputCommand()
        ) {

            const command =
                client.commands.get(
                    interaction.commandName
                );


            if (!command) {
                return;
            }


            try {

                await command.execute(
                    interaction,
                    client
                );

            } catch (erro) {

                console.error(erro);


                const mensagem = {
                    content:
                        '❌ Ocorreu um erro ao executar esse comando.',

                    flags:
                        MessageFlags.Ephemeral
                };


                if (
                    interaction.replied ||
                    interaction.deferred
                ) {

                    await interaction.followUp(
                        mensagem
                    );

                } else {

                    await interaction.reply(
                        mensagem
                    );
                }
            }


            return;
        }


        // ==================================
        // PROTEÇÃO DO /SETUP
        // ==================================

        const id =
            interaction.customId || '';


        const pertenceAoSetup =

            id.startsWith('setup_') ||

            id.startsWith('modal_k_') ||

            id === 'modal_estoque_preco';


        if (pertenceAoSetup) {

            const admin =
                interaction
                    .memberPermissions
                    ?.has(
                        PermissionFlagsBits.Administrator
                    );


            if (!admin) {

                await interaction.reply({

                    content:
                        '❌ Apenas administradores podem usar este painel.',

                    flags:
                        MessageFlags.Ephemeral
                });


                return;
            }
        }


        // ==================================
        // MODAIS
        // ==================================

        if (
            interaction.isModalSubmit()
        ) {

            const config =
                carregarConfig();


            // ------------------------------
            // K DA CALCULADORA
            // ------------------------------

            if (
                interaction.customId
                    .startsWith(
                        'modal_k_'
                    )
            ) {

                const chave =
                    interaction.customId
                        .replace(
                            'modal_k_',
                            ''
                        );


                if (!METODOS[chave]) {
                    return;
                }


                const texto =
                    interaction.fields
                        .getTextInputValue(
                            'valor_k'
                        );


                const resultado =
                    interpretarK(texto);


                if (!resultado.valido) {

                    await interaction.reply({

                        content:
                            '❌ Digite um valor válido, como `39`, `42` ou `OFF`.',

                        flags:
                            MessageFlags.Ephemeral
                    });


                    return;
                }


                config.calculadora[chave] =
                    resultado.valor;


                saveConfig(config);


                if (
                    interaction.isFromMessage()
                ) {

                    await interaction.update(
                        criarPainelCalculadora(
                            config
                        )
                    );

                } else {

                    await interaction.reply({

                        content:
                            '✅ Valor salvo com sucesso.',

                        flags:
                            MessageFlags.Ephemeral
                    });
                }


                return;
            }


            // ------------------------------
            // PREÇO DO ESTOQUE
            // ------------------------------

            if (
                interaction.customId ===
                'modal_estoque_preco'
            ) {

                const texto =
                    interaction.fields
                        .getTextInputValue(
                            'valor_k'
                        );


                const resultado =
                    interpretarK(texto);


                if (
                    !resultado.valido ||
                    resultado.valor === null
                ) {

                    await interaction.reply({

                        content:
                            '❌ O preço do estoque precisa ser um valor, por exemplo `39`.',

                        flags:
                            MessageFlags.Ephemeral
                    });


                    return;
                }


                config.estoque.precoK =
                    resultado.valor;


                saveConfig(config);


                if (
                    interaction.isFromMessage()
                ) {

                    await interaction.update(
                        criarPainelEstoque(
                            config
                        )
                    );

                } else {

                    await interaction.reply({

                        content:
                            '✅ Preço salvo.',

                        flags:
                            MessageFlags.Ephemeral
                    });
                }


                return;
            }
        }


        // ==================================
        // SELETORES DE CANAL
        // ==================================

        if (
            interaction.isChannelSelectMenu()
        ) {

            const config =
                carregarConfig();


            const canalId =
                interaction.values[0];


            if (
                interaction.customId ===
                'setup_canal_calculadora'
            ) {

                config.calculadora.canalId =
                    canalId;


                saveConfig(config);


                await interaction.update(
                    criarPainelCalculadora(
                        config
                    )
                );


                return;
            }


            if (
                interaction.customId ===
                'setup_canal_estoque'
            ) {

                config.estoque.canalId =
                    canalId;


                saveConfig(config);


                await interaction.update(
                    criarPainelEstoque(
                        config
                    )
                );


                return;
            }


            if (
                interaction.customId ===
                'setup_canal_compra'
            ) {

                config.estoque.canalCompraId =
                    canalId;


                saveConfig(config);


                await interaction.update(
                    criarPainelEstoque(
                        config
                    )
                );


                return;
            }


            if (
                interaction.customId ===
                'setup_canal_vendas'
            ) {

                config.vendas.canalId =
                    canalId;


                saveConfig(config);


                await interaction.update(
                    criarPainelVendas(
                        config
                    )
                );


                return;
            }
        }


        // ==================================
        // ESCOLHER NÍVEL DE CARGO
        // ==================================

        if (
            interaction.isStringSelectMenu()
        ) {

            if (
                interaction.customId ===
                'setup_selecionar_nivel_cargo'
            ) {

                const config =
                    carregarConfig();


                const nivel =
                    interaction.values[0];


                if (!CARGOS[nivel]) {
                    return;
                }


                await interaction.update(
                    criarPainelSelecionarCargo(
                        config,
                        nivel
                    )
                );


                return;
            }
        }


        // ==================================
        // SELECIONAR CARGO
        // ==================================

        if (
            interaction.isRoleSelectMenu()
        ) {

            if (
                interaction.customId
                    .startsWith(
                        'setup_role_'
                    )
            ) {

                const config =
                    carregarConfig();


                const nivel =
                    interaction.customId
                        .replace(
                            'setup_role_',
                            ''
                        );


                if (!CARGOS[nivel]) {
                    return;
                }


                const cargoId =
                    interaction.values[0];


                config.cargos[nivel] =
                    cargoId;


                saveConfig(config);


                await interaction.update(
                    criarPainelCargos(
                        config
                    )
                );


                return;
            }
        }


        // ==================================
        // BOTÕES
        // ==================================

        if (!interaction.isButton()) {
            return;
        }


        const config =
            carregarConfig();


        // ------------------------------
        // MENU PRINCIPAL
        // ------------------------------

        if (
            interaction.customId ===
            'setup_voltar'
        ) {

            await interaction.update(
                criarPainelPrincipal()
            );


            return;
        }


        // ------------------------------
        // CALCULADORA
        // ------------------------------

        if (
            interaction.customId ===
            'setup_calculadora'
        ) {

            await interaction.update(
                criarPainelCalculadora(
                    config
                )
            );


            return;
        }


        // ------------------------------
        // ESTOQUE
        // ------------------------------

        if (
            interaction.customId ===
            'setup_estoque'
        ) {

            await interaction.update(
                criarPainelEstoque(
                    config
                )
            );


            return;
        }


        // ------------------------------
        // VENDAS
        // ------------------------------

        if (
            interaction.customId ===
            'setup_vendas'
        ) {

            await interaction.update(
                criarPainelVendas(
                    config
                )
            );


            return;
        }


        // ------------------------------
        // CARGOS
        // ------------------------------

        if (
            interaction.customId ===
            'setup_cargos'
        ) {

            await interaction.update(
                criarPainelCargos(
                    config
                )
            );


            return;
        }


        // ------------------------------
        // ALTERAR K
        // ------------------------------

        if (
            interaction.customId
                .startsWith(
                    'setup_k_'
                )
        ) {

            const chave =
                interaction.customId
                    .replace(
                        'setup_k_',
                        ''
                    );


            if (!METODOS[chave]) {
                return;
            }


            await abrirModalK(

                interaction,

                chave,

                METODOS[chave],

                config.calculadora[chave]
            );


            return;
        }


        // ------------------------------
        // ALTERAR PREÇO DO ESTOQUE
        // ------------------------------

        if (
            interaction.customId ===
            'setup_estoque_preco'
        ) {

            const modal =
                new ModalBuilder()

                    .setCustomId(
                        'modal_estoque_preco'
                    )

                    .setTitle(
                        'Preço do Estoque'
                    );


            const input =
                new TextInputBuilder()

                    .setCustomId(
                        'valor_k'
                    )

                    .setLabel(
                        'Digite o valor K'
                    )

                    .setPlaceholder(
                        'Exemplo: 39'
                    )

                    .setStyle(
                        TextInputStyle.Short
                    )

                    .setRequired(true)

                    .setValue(
                        String(
                            config.estoque.precoK
                        )
                    );


            const linha =
                new ActionRowBuilder()
                    .addComponents(input);


            modal.addComponents(linha);


            await interaction.showModal(
                modal
            );


            return;
        }
    }
};