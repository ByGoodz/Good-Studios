
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
// CALCULADORA AUTOMATICA
// ==========================================

const COOLDOWN_MS = 3000;

const usuariosEmProcessamento = new Set();
const ultimaConsulta = new Map();

let ultimaLimpeza = 0;

// ==========================================
// INTERPRETAR MENSAGENS
// ==========================================

function interpretarMensagemCalculadora(conteudo) {
    const texto = String(conteudo ?? '').trim();

    if (
        !texto ||
        texto.length > 80 ||
        texto.includes('\n')
    ) {
        return null;
    }

    // Exemplos: R$ 100, R$ 39,50
    const comCifrao = texto.match(/^R\$\s*(.+)$/i);

    if (comCifrao) {
        return {
            tipo: 'reais',
            valor: interpretarValorReais(comCifrao[1])
        };
    }

    // Exemplos: 100 reais, 50 BRL
    const comReais = texto.match(
        /^(\d[\d.,\s]*)\s*(?:reais?|brl)$/i
    );

    if (comReais) {
        return {
            tipo: 'reais',
            valor: interpretarValorReais(comReais[1])
        };
    }

    // Exemplos: 100, 5000, 5k, 5,5k
    let quantidadeTexto = texto;

    if (/\s*robux$/i.test(quantidadeTexto)) {
        quantidadeTexto = quantidadeTexto
            .replace(/\s*robux$/i, '')
            .trim();
    }

    const formatoInteiro =
        /^(?:\d+|\d{1,3}(?:\.\d{3})+)$/;

    const formatoK =
        /^\d+(?:[.,]\d{1,3})?\s*k$/i;

    if (
        !formatoInteiro.test(quantidadeTexto) &&
        !formatoK.test(quantidadeTexto)
    ) {
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
// CONTROLE DE CONSULTAS
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
// RESPONDER MENSAGEM
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
// NORMALIZAR ARQUIVO GERADO
// ==========================================

function prepararImagem(imagem) {

    // CORRECAO PRINCIPAL:
    // O imagemService novo ja retorna
    // um AttachmentBuilder pronto.
    //
    // Nao podemos colocar AttachmentBuilder
    // dentro de outro AttachmentBuilder.

    if (imagem instanceof AttachmentBuilder) {
        return imagem;
    }

    // Compatibilidade com versoes antigas
    // que retornavam um Buffer de imagem.

    if (Buffer.isBuffer(imagem)) {
        if (imagem.length === 0) {
            throw new Error(
                'A imagem gerada está vazia.'
            );
        }

        return new AttachmentBuilder(imagem, {
            name: 'inovaresale-calculadora.png'
        });
    }

    if (imagem instanceof Uint8Array) {
        if (imagem.byteLength === 0) {
            throw new Error(
                'A imagem gerada está vazia.'
            );
        }

        return new AttachmentBuilder(
            Buffer.from(imagem),
            {
                name: 'inovaresale-calculadora.png'
            }
        );
    }

    throw new Error(
        'O serviço de imagens retornou um formato inválido.'
    );
}

// ==========================================
// GERAR E ENVIAR IMAGEM
// ==========================================

async function processarCalculadora(
    mensagem,
    config,
    entrada
) {
    let imagem;

    if (entrada.tipo === 'robux') {
        imagem = await gerarImagemPorRobux(
            entrada.valor,
            config
        );
    } else {
        imagem = await gerarImagemPorReais(
            entrada.valor,
            config
        );
    }

    const arquivo = prepararImagem(imagem);

    await responderMensagem(mensagem, {
        files: [arquivo]
    });
}

// ==========================================
// EVENTO MESSAGE CREATE
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
                '[InovareSale] Erro ao carregar configurações:',
                erro
            );
            return;
        }

        const canalCalculadora =
            config?.calculadora?.canalId;

        // Só funciona no canal configurado.
        if (
            !canalCalculadora ||
            mensagem.channelId !== canalCalculadora
        ) {
            return;
        }

        let entrada;

        try {
            entrada = interpretarMensagemCalculadora(
                mensagem.content
            );
        } catch (erro) {
            await responderMensagem(mensagem, {
                content:
                    `Valor inválido: ${erro.message}\n\n` +
                    'Exemplos: `100`, `5000`, `5k`, `R$ 100`.'
            }).catch(console.error);

            return;
        }

        // Ignora conversas normais.
        if (!entrada) {
            return;
        }

        const chave =
            `${mensagem.guildId}:${mensagem.author.id}`;

        if (!permitirConsulta(chave)) {
            return;
        }

        try {
            // Mostra "digitando..." no Discord.
            if (
                typeof mensagem.channel.sendTyping ===
                'function'
            ) {
                await mensagem.channel
                    .sendTyping()
                    .catch(() => {});
            }

            // Gera e envia a imagem.
            await processarCalculadora(
                mensagem,
                config,
                entrada
            );

            console.log(
                `[InovareSale] Calculadora enviada: ` +
                `${entrada.tipo} = ${entrada.valor}`
            );

        } catch (erro) {
            console.error(
                '[InovareSale] Erro ao gerar imagem da calculadora:',
                erro
            );

            await responderMensagem(mensagem, {
                content:
                    'Não consegui gerar a imagem agora. ' +
                    'A equipe pode consultar o erro nos logs.'
            }).catch(console.error);

        } finally {
            usuariosEmProcessamento.delete(chave);
        }
    }
};
