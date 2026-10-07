const {
    Events,
    EmbedBuilder
} = require('discord.js');

const {
    getConfig
} = require('../utils/storage');

const {
    calcularPreco,
    calcularSemTaxa,
    calcularTaxado,
    calcularPorReais,
    formatarDinheiro,
    formatarRobux
} = require('../utils/calculator');


// ==========================================
// INTERPRETAR QUANTIDADE DE ROBUX
// ==========================================

function interpretarRobux(texto) {

    let valor = texto
        .trim()
        .toLowerCase()
        .replace(/\s/g, '');

    // Exemplo: 5k ou 2,5k
    if (valor.endsWith('k')) {

        valor = valor
            .slice(0, -1)
            .replace(',', '.');

        const numero = Number(valor);

        if (
            !Number.isFinite(numero) ||
            numero <= 0
        ) {
            return null;
        }

        return Math.floor(numero * 1000);
    }


    // Aceita somente números, pontos e vírgulas
    if (!/^[\d.,]+$/.test(valor)) {
        return null;
    }


    // Exemplo:
    // 5000
    // 5.000
    // 10000
    valor = valor
        .replace(/\./g, '')
        .replace(',', '.');


    const numero = Number(valor);


    if (
        !Number.isFinite(numero) ||
        numero <= 0
    ) {
        return null;
    }


    return Math.floor(numero);
}


// ==========================================
// INTERPRETAR VALOR EM REAIS
// ==========================================

function interpretarReais(texto) {

    const original = texto
        .trim()
        .toLowerCase();


    let valor = null;


    // R$ 100
    // R$100
    if (original.startsWith('r$')) {

        valor = original
            .replace('r$', '')
            .trim();
    }


    // 100 reais
    else if (original.endsWith('reais')) {

        valor = original
            .replace('reais', '')
            .trim();
    }


    // 100 rs
    else if (original.endsWith('rs')) {

        valor = original
            .slice(0, -2)
            .trim();
    }


    else {

        return null;
    }


    valor = valor
        .replace(/\s/g, '')
        .replace(/\./g, '')
        .replace(',', '.');


    const numero = Number(valor);


    if (
        !Number.isFinite(numero) ||
        numero <= 0
    ) {
        return null;
    }


    return numero;
}


// ==========================================
// VERIFICAR SE MÉTODO ESTÁ ATIVO
// ==========================================

function metodoAtivo(valor) {

    return (
        valor !== null &&
        valor !== undefined &&
        valor !== false &&
        Number(valor) > 0
    );
}


// ==========================================
// CALCULAR ROBUX DIRETO PELO K
// ==========================================

function robuxPorReais(valorReais, k) {

    return Math.floor(
        (valorReais / Number(k)) * 1000
    );
}


// ==========================================
// CALCULAR POR QUANTIDADE DE ROBUX
// ==========================================

function criarEmbedPorRobux(
    robux,
    config
) {

    const calc =
        config.calculadora;


    const embed =
        new EmbedBuilder()

            .setColor(0xC0C0C0)

            .setAuthor({
                name:
                    'InovareSale • Calculadora de Robux'
            })

            .setTitle(
                `💎 Preço estimado para ${formatarRobux(robux)} Robux`
            )

            .setDescription(
                'Confira abaixo as modalidades disponíveis para sua compra.'
            );


    // ======================================
    // VIA PLUS
    // ======================================

    if (
        metodoAtivo(
            calc.viaPlus
        )
    ) {

        const preco =
            calcularPreco(
                robux,
                calc.viaPlus
            );


        embed.addFields({

            name:
                `➕ Via Plus • K${calc.viaPlus}`,

            value:
                `**${formatarDinheiro(preco)}**\n` +
                `${formatarRobux(robux)} Robux`,

            inline:
                false
        });
    }


    // ======================================
    // VIA GRUPO
    // ======================================

    if (
        metodoAtivo(
            calc.viaGrupo
        )
    ) {

        const preco =
            calcularPreco(
                robux,
                calc.viaGrupo
            );


        embed.addFields({

            name:
                `👥 Via Grupo • K${calc.viaGrupo}`,

            value:
                `**${formatarDinheiro(preco)}**\n` +
                `${formatarRobux(robux)} Robux`,

            inline:
                false
        });
    }


    // ======================================
    // SEM TAXA
    // ======================================

    if (
        metodoAtivo(
            calc.semTaxa
        )
    ) {

        const resultado =
            calcularSemTaxa(
                robux,
                calc.semTaxa
            );


        embed.addFields({

            name:
                `💸 Robux Sem Taxa • K${calc.semTaxa}`,

            value:
                `**${formatarDinheiro(resultado.preco)}**\n` +
                `Você recebe **${formatarRobux(resultado.robuxRecebido)} Robux**\n` +
                `Gamepass de **${formatarRobux(resultado.robuxGamepass)} Robux**`,

            inline:
                false
        });
    }


    // ======================================
    // TAXADO
    // ======================================

    if (
        metodoAtivo(
            calc.taxado
        )
    ) {

        const resultado =
            calcularTaxado(
                robux,
                calc.taxado
            );


        embed.addFields({

            name:
                `💰 Robux Taxado • K${calc.taxado}`,

            value:
                `**${formatarDinheiro(resultado.preco)}**\n` +
                `Você recebe **${formatarRobux(resultado.robuxRecebido)} Robux**\n` +
                `Gamepass de **${formatarRobux(resultado.robuxGamepass)} Robux**`,

            inline:
                false
        });
    }


    embed.setFooter({
        text:
            'InovareSale • Valores calculados automaticamente'
    });


    return embed;
}


// ==========================================
// CALCULAR A PARTIR DE REAIS
// ==========================================

function criarEmbedPorReais(
    valor,
    config
) {

    const calc =
        config.calculadora;


    const embed =
        new EmbedBuilder()

            .setColor(0xC0C0C0)

            .setAuthor({
                name:
                    'InovareSale • Calculadora de Robux'
            })

            .setTitle(
                `💵 O que você consegue com ${formatarDinheiro(valor)}`
            )

            .setDescription(
                'Confira abaixo a quantidade estimada em cada modalidade.'
            );


    // ======================================
    // VIA PLUS
    // ======================================

    if (
        metodoAtivo(
            calc.viaPlus
        )
    ) {

        const quantidade =
            robuxPorReais(
                valor,
                calc.viaPlus
            );


        embed.addFields({

            name:
                `➕ Via Plus • K${calc.viaPlus}`,

            value:
                `Você consegue **${formatarRobux(quantidade)} Robux**`,

            inline:
                false
        });
    }


    // ======================================
    // VIA GRUPO
    // ======================================

    if (
        metodoAtivo(
            calc.viaGrupo
        )
    ) {

        const quantidade =
            robuxPorReais(
                valor,
                calc.viaGrupo
            );


        embed.addFields({

            name:
                `👥 Via Grupo • K${calc.viaGrupo}`,

            value:
                `Você consegue **${formatarRobux(quantidade)} Robux**`,

            inline:
                false
        });
    }


    // ======================================
    // SEM TAXA
    // ======================================

    if (
        metodoAtivo(
            calc.semTaxa
        )
    ) {

        const resultado =
            calcularPorReais(
                valor,
                calc.semTaxa
            );


        embed.addFields({

            name:
                `💸 Robux Sem Taxa • K${calc.semTaxa}`,

            value:
                `Você recebe **${formatarRobux(resultado.robuxRecebido)} Robux**\n` +
                `Gamepass de **${formatarRobux(resultado.robuxGamepass)} Robux**`,

            inline:
                false
        });
    }


    // ======================================
    // TAXADO
    // ======================================

    if (
        metodoAtivo(
            calc.taxado
        )
    ) {

        const resultado =
            calcularPorReais(
                valor,
                calc.taxado
            );


        embed.addFields({

            name:
                `💰 Robux Taxado • K${calc.taxado}`,

            value:
                `Você consegue receber **${formatarRobux(resultado.robuxRecebido)} Robux**\n` +
                `Gamepass de **${formatarRobux(resultado.robuxGamepass)} Robux**`,

            inline:
                false
        });
    }


    embed.setFooter({
        text:
            'InovareSale • Valores calculados automaticamente'
    });


    return embed;
}


// ==========================================
// EVENTO DE MENSAGEM
// ==========================================

module.exports = {

    name:
        Events.MessageCreate,


    async execute(message) {

        // Ignorar mensagens de bots
        if (message.author.bot) {
            return;
        }


        // Ignorar mensagens fora de servidores
        if (!message.guild) {
            return;
        }


        const config =
            getConfig();


        // Calculadora ainda não configurada
        if (
            !config.calculadora?.canalId
        ) {
            return;
        }


        // Só funciona no canal escolhido no /setup
        if (
            message.channel.id !==
            config.calculadora.canalId
        ) {
            return;
        }


        const texto =
            message.content.trim();


        // ==================================
        // TENTAR VALOR EM REAIS
        // ==================================

        const valorReais =
            interpretarReais(texto);


        if (valorReais !== null) {

            const embed =
                criarEmbedPorReais(
                    valorReais,
                    config
                );


            await message.reply({

                embeds: [embed],

                allowedMentions: {
                    repliedUser: true
                }
            });


            return;
        }


        // ==================================
        // TENTAR QUANTIDADE DE ROBUX
        // ==================================

        const robux =
            interpretarRobux(texto);


        if (robux !== null) {

            const embed =
                criarEmbedPorRobux(
                    robux,
                    config
                );


            await message.reply({

                embeds: [embed],

                allowedMentions: {
                    repliedUser: true
                }
            });


            return;
        }


        // ==================================
        // FORMATO INVÁLIDO
        // ==================================

        await message.reply({

            content:
                '❌ **Formato inválido.**\n\n' +
                'Para calcular Robux, envie somente a quantidade:\n' +
                '`5000`\n\n' +
                'Para calcular por dinheiro, envie:\n' +
                '`R$ 100`',

            allowedMentions: {
                repliedUser: true
            }
        });
    }
};