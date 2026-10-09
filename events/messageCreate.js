
'use strict';

const {
    Events,
    AttachmentBuilder
} = require('discord.js');

const { getConfig } = require('../utils/storage');

const {
    interpretarQuantidadeRobux,
    interpretarValorReais
} = require('../utils/validators');

const {
    gerarImagemPorRobux,
    gerarImagemPorReais
} = require('../services/imagemService');

// ==========================================
// INOVARESALE BOT 2.0
// CALCULADORA AUTOMATICA POR IMAGEM
// ==========================================
// Exemplos aceitos no canal configurado:
//   5000       -> 5.000 Robux
//   5.000      -> 5.000 Robux
//   5k         -> 5.000 Robux
//   5,5k       -> 5.500 Robux
//   5000 robux -> 5.000 Robux
//   R$ 100     -> orcamento de R$ 100,00
//   R$ 39,50   -> orcamento de R$ 39,50
//   100 reais  -> orcamento de R$ 100,00
// ==========================================

const COOLDOWN_MS = 3000;
const usuariosEmProcessamento = new Set();
const ultimaConsulta = new Map();
let ultimaLimpeza = 0;

// ==========================================
// RECONHECER SE O TEXTO E UM CALCULO
// ==========================================

function interpretarMensagemCalculadora(conteudo) {
    const texto = String(conteudo ?? '').trim();

    if (!texto || texto.length > 80 || texto.includes('\n')) {
        return null;
    }

    // Entradas com R$ ou palavras como "reais" sao orcamentos.
    const comCifrao = texto.match(/^R\$\s*(.+)$/i);

    if (comCifrao) {
        return {
            tipo: 'reais',
            valor: interpretarValorReais(comCifrao[1])
        };
    }

    const comReais = texto.match(
        /^(\d[\d.,\s]*)\s*(?:reais?|brl)$/i
    );

    if (comReais) {
        return {
            tipo: 'reais',
            valor: interpretarValorReais(comReais[1])
        };
    }

    // Numero ou numero com K (com "robux" opcional).
    let quantidadeTexto = texto;

    if (/\s*robux$/i.test(quantidadeTexto)) {
        quantidadeTexto = quantidadeTexto.replace(/\s*robux$/i, '').trim();
    }

    const formatoInteiro =
        /^(?:\d+|\d{1,3}(?:\.\d{3})+)$/;

    const formatoK = /^\d+(?:[.,]\d{1,3})?\s*k$/i;

    if (!formatoInteiro.test(quantidadeTexto) &&
        !formatoK.test(quantidadeTexto)) {
        return null;
    }

    return {
        tipo: 'robux',
        valor: interpretarQuantidadeRobux(
            quantidadeTexto.replace(/\s+(?=k$)/i, '')
        )
    };
}

// ==========================================
// EVITAR VARIAS IMAGENS AO MESMO TEMPO
// ==========================================

function limparConsultasAntigas() {
    const agora = Date.now();

    if (agora - ultimaLimpeza < 60000) {
        return;
    }

    ultimaLimpeza = agora;

    for (const [chave, data] of ultimaConsulta) {
        if (agora - data > 60000) {
            ultimaConsulta.delete(chave);
        }
    }
}

function permitirConsulta(chave) {
    limparConsultasAntigas();

    if (usuariosEmProcessamento.has(chave)) {
        return false;
    }

    const agora = Date.now();
    const ultima = ultimaConsulta.get(chave) || 0;

    if (agora - ultima < COOLDOWN_MS) {
        return false;
    }

    ultimaConsulta.set(chave, agora);
    usuariosEmProcessamento.add(chave);

    return true;
}

// ==========================================
// RESPONDER SEM MENCIONAR O USUARIO
// ==========================================

async function responderMensagem(mensagem, dados) {
    return mensagem.reply({
        ...dados,
        allowedMentions: {
            parse: [],
            repliedUser: false
        }
    });
}

// ==========================================
// GERAR E ENVIAR A IMAGEM
// ==========================================

async function processarCalculadora(mensagem, config, entrada) {
    const imagem = entrada.tipo === 'robux'
        ? await gerarImagemPorRobux(entrada.valor, config)
        : await gerarImagemPorReais(entrada.valor, config);

    if (!imagem || imagem.length === 0) {
        throw new Error('A imagem da calculadora ficou vazia.');
    }

    const arquivo = new AttachmentBuilder(imagem, {
        name: 'inovaresale-calculadora.png',
        description: 'Tabela de precos da InovareSale'
    });

    await responderMensagem(mensagem, {
        files: [arquivo]
    });
}

// ==========================================
// EVENTO DE MENSAGENS
// ==========================================

module.exports = {
    name: Events.MessageCreate,

    async execute(mensagem) {
        if (
            !mensagem?.guild ||
            !mensagem.author ||
            mensagem.author.bot ||
            mensagem.webhookId
        ) {
            return;
        }

        let config;

        try {
            config = getConfig();
        } catch (erro) {
            console.error(
                '[InovareSale] Falha ao carregar configuracao da calculadora:',
                erro
            );
            return;
        }

        const canalCalculadora = config?.calculadora?.canalId;

        // Nunca interferir em conversas de outros canais.
        if (!canalCalculadora || mensagem.channelId !== canalCalculadora) {
            return;
        }

        let entrada;

        try {
            entrada = interpretarMensagemCalculadora(mensagem.content);
        } catch (erro) {
            await responderMensagem(mensagem, {
                content: `❌ ${erro.message}\n\n` +
                    'Exemplos: `5000`, `5k`, `5,5k`, `R$ 100`.'
            }).catch(console.error);
            return;
        }

        // Mensagens normais, links e comandos nao geram imagens.
        if (!entrada) {
            return;
        }

        const chave = `${mensagem.guildId}:${mensagem.author.id}`;

        if (!permitirConsulta(chave)) {
            return;
        }

        try {
            // Indica que o bot esta gerando a imagem.
            if (typeof mensagem.channel.sendTyping === 'function') {
                await mensagem.channel.sendTyping().catch(() => {});
            }

            await processarCalculadora(mensagem, config, entrada);

        } catch (erro) {
            console.error(
                '[InovareSale] Erro ao gerar imagem da calculadora:',
                erro
            );

            await responderMensagem(mensagem, {
                content:
                    '❌ Não consegui gerar a imagem agora. ' +
                    'Avise a equipe se o problema continuar.'
            }).catch(console.error);

        } finally {
            usuariosEmProcessamento.delete(chave);
        }
    }
};
