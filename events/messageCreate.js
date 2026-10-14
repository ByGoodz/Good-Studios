
'use strict';

const crypto = require('crypto');
const { Events, AttachmentBuilder } = require('discord.js');
const { db } = require('../database/db');
const { getConfig } = require('../utils/storage');

const {
    interpretarQuantidadeRobux,
    interpretarValorReais
} = require('../utils/validators');

const {
    gerarImagemPorRobux,
    gerarImagemPorReais
} = require('../services/imagemService');

const COOLDOWN_MS = 3000;
const INTERVALO_MENSAGENS_SEGUNDOS = 60;
const LIMITE_MENSAGENS_HORA = 25;
const LIMITE_MENSAGENS_DIA = 120;
const JANELA_REPETICAO_SEGUNDOS = 15 * 60;

const usuariosEmProcessamento = new Set();
const ultimaConsulta = new Map();

let ultimaLimpeza = 0;

db.exec(`
    CREATE TABLE IF NOT EXISTS staff_mensagens_v31 (
        mensagem_id TEXT PRIMARY KEY,
        servidor_id TEXT NOT NULL,
        membro_id TEXT NOT NULL,
        canal_id TEXT NOT NULL,
        criado_em INTEGER NOT NULL,
        texto_hash TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_staff_mensagens_periodo_v31
    ON staff_mensagens_v31 (
        servidor_id,
        criado_em,
        membro_id
    );

    CREATE INDEX IF NOT EXISTS idx_staff_mensagens_membro_v31
    ON staff_mensagens_v31 (
        servidor_id,
        membro_id,
        criado_em DESC
    );
`);

const SQL_MENSAGENS = {
    ultima: db.prepare(`
        SELECT criado_em
        FROM staff_mensagens_v31
        WHERE servidor_id = ?
          AND membro_id = ?
        ORDER BY criado_em DESC
        LIMIT 1
    `),

    repetida: db.prepare(`
        SELECT 1
        FROM staff_mensagens_v31
        WHERE servidor_id = ?
          AND membro_id = ?
          AND texto_hash = ?
          AND criado_em >= ?
        LIMIT 1
    `),

    quantidade: db.prepare(`
        SELECT COUNT(*) AS total
        FROM staff_mensagens_v31
        WHERE servidor_id = ?
          AND membro_id = ?
          AND criado_em >= ?
    `),

    inserir: db.prepare(`
        INSERT OR IGNORE INTO staff_mensagens_v31 (
            mensagem_id,
            servidor_id,
            membro_id,
            canal_id,
            criado_em,
            texto_hash
        ) VALUES (?, ?, ?, ?, ?, ?)
    `),

    ranking: db.prepare(`
        SELECT
            membro_id,
            COUNT(*) AS mensagens
        FROM staff_mensagens_v31
        WHERE servidor_id = ?
          AND criado_em >= ?
          AND criado_em < ?
        GROUP BY membro_id
        ORDER BY mensagens DESC, membro_id ASC
        LIMIT ?
    `),

    individual: db.prepare(`
        SELECT COUNT(*) AS mensagens
        FROM staff_mensagens_v31
        WHERE servidor_id = ?
          AND membro_id = ?
          AND criado_em >= ?
          AND criado_em < ?
    `)
};

function interpretarMensagemCalculadora(conteudo) {
    const texto = String(conteudo ?? '').trim();

    if (
        !texto ||
        texto.length > 80 ||
        texto.includes('\n')
    ) {
        return null;
    }

    const comCifrao = texto.match(/^R\$\s*(.+)$/i);

    if (comCifrao) {
        return {
            tipo: 'reais',
            valor: interpretarValorReais(
                comCifrao[1]
            )
        };
    }

    const comReais = texto.match(
        /^(\d[\d.,\s]*)\s*(?:reais?|brl)$/i
    );

    if (comReais) {
        return {
            tipo: 'reais',
            valor: interpretarValorReais(
                comReais[1]
            )
        };
    }

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
            quantidadeTexto.replace(
                /\s+(?=k$)/i,
                ''
            )
        )
    };
}

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

function normalizarMensagem(texto) {
    return String(texto ?? '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/https?:\/\/\S+/gi, ' ')
        .replace(/<[@#&]!?\d+>/g, ' ')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function mensagemElegivel(
    mensagem,
    config,
    membro
) {
    const cargoId = String(
        config?.staff?.cargoId || ''
    );

    if (
        !/^\d{15,22}$/.test(cargoId) ||
        !membro?.roles?.cache?.has(cargoId) ||
        membro.user?.bot
    ) {
        return false;
    }

    const ignorados = [
        config?.calculadora?.canalId,
        config?.status?.canalId
    ]
        .filter(Boolean)
        .map(String);

    if (
        ignorados.includes(mensagem.channelId) ||
        ignorados.includes(
            mensagem.channel?.parentId
        )
    ) {
        return false;
    }

    const canais =
        config?.staff?.canaisMensagens;

    if (
        Array.isArray(canais) &&
        canais.length
    ) {
        const permitidos = canais.map(String);

        if (
            !permitidos.includes(
                mensagem.channelId
            ) &&
            !permitidos.includes(
                mensagem.channel?.parentId
            )
        ) {
            return false;
        }
    }

    return true;
}

async function registrarMensagemEquipe(
    mensagem,
    config
) {
    const conteudo = String(
        mensagem.content ?? ''
    );

    if (
        conteudo.length < 12 ||
        conteudo.startsWith('/') ||
        conteudo.startsWith('!') ||
        conteudo.startsWith('.')
    ) {
        return false;
    }

    const texto = normalizarMensagem(
        conteudo
    );

    if (
        texto.length < 12 ||
        texto.split(' ').length < 2
    ) {
        return false;
    }

    let membro = mensagem.member;

    if (!membro) {
        try {
            membro = await mensagem.guild.members.fetch(
                mensagem.author.id
            );
        } catch {
            return false;
        }
    }

    if (
        !mensagemElegivel(
            mensagem,
            config,
            membro
        )
    ) {
        return false;
    }

    const servidor = String(
        mensagem.guildId
    );

    const usuario = String(
        mensagem.author.id
    );

    const horario = Math.floor(
        mensagem.createdTimestamp / 1000
    );

    const agora = Math.floor(
        Date.now() / 1000
    );

    if (
        !Number.isSafeInteger(horario) ||
        Math.abs(agora - horario) > 300
    ) {
        return false;
    }

    const hash = crypto
        .createHash('sha256')
        .update(texto)
        .digest('hex');

    return db.transaction(() => {
        const ultima = SQL_MENSAGENS.ultima.get(
            servidor,
            usuario
        );

        if (
            ultima &&
            horario - ultima.criado_em <
                INTERVALO_MENSAGENS_SEGUNDOS
        ) {
            return false;
        }

        const repetida = SQL_MENSAGENS.repetida.get(
            servidor,
            usuario,
            hash,
            horario - JANELA_REPETICAO_SEGUNDOS
        );

        if (repetida) {
            return false;
        }

        const hora = SQL_MENSAGENS.quantidade.get(
            servidor,
            usuario,
            horario - 3600
        );

        if (
            Number(hora?.total || 0) >=
            LIMITE_MENSAGENS_HORA
        ) {
            return false;
        }

        const dia = SQL_MENSAGENS.quantidade.get(
            servidor,
            usuario,
            horario - 86400
        );

        if (
            Number(dia?.total || 0) >=
            LIMITE_MENSAGENS_DIA
        ) {
            return false;
        }

        const resultado = SQL_MENSAGENS.inserir.run(
            String(mensagem.id),
            servidor,
            usuario,
            String(mensagem.channelId),
            horario,
            hash
        );

        return resultado.changes === 1;
    })();
}

function validarConsultaPeriodo(
    servidorId,
    inicioEm,
    fimEm
) {
    const servidor = String(
        servidorId ?? ''
    );

    const inicio = Number(inicioEm);
    const fim = Number(fimEm);

    if (
        !/^\d{15,22}$/.test(servidor) ||
        !Number.isSafeInteger(inicio) ||
        !Number.isSafeInteger(fim) ||
        inicio < 0 ||
        fim <= inicio
    ) {
        throw new Error(
            'Servidor ou período de consulta inválido.'
        );
    }

    return {
        servidor,
        inicio,
        fim
    };
}

function obterRankingMensagensPeriodo(
    servidorId,
    inicioEm,
    fimEm,
    limite = 100
) {
    const {
        servidor,
        inicio,
        fim
    } = validarConsultaPeriodo(
        servidorId,
        inicioEm,
        fimEm
    );

    const quantidade =
        Number.isSafeInteger(Number(limite))
            ? Math.min(
                100,
                Math.max(1, Number(limite))
            )
            : 100;

    return SQL_MENSAGENS.ranking.all(
        servidor,
        inicio,
        fim,
        quantidade
    ).map(item => ({
        membroId: item.membro_id,
        mensagensValidas: Number(
            item.mensagens || 0
        )
    }));
}

function obterMensagensFuncionarioPeriodo(
    servidorId,
    membroId,
    inicioEm,
    fimEm
) {
    const {
        servidor,
        inicio,
        fim
    } = validarConsultaPeriodo(
        servidorId,
        inicioEm,
        fimEm
    );

    const membro = String(
        membroId ?? ''
    );

    if (!/^\d{15,22}$/.test(membro)) {
        throw new Error(
            'Funcionário inválido.'
        );
    }

    const resultado = SQL_MENSAGENS.individual.get(
        servidor,
        membro,
        inicio,
        fim
    );

    return {
        membroId: membro,
        mensagensValidas: Number(
            resultado?.mensagens || 0
        )
    };
}

async function responderMensagem(
    mensagem,
    dados
) {
    return mensagem.reply({
        ...dados,
        allowedMentions: {
            parse: [],
            repliedUser: false
        }
    });
}

function prepararImagem(imagem) {
    if (imagem instanceof AttachmentBuilder) {
        return imagem;
    }

    if (Buffer.isBuffer(imagem)) {
        if (!imagem.length) {
            throw new Error(
                'A imagem gerada está vazia.'
            );
        }

        return new AttachmentBuilder(imagem, {
            name: 'inovaresale-calculadora.png'
        });
    }

    if (imagem instanceof Uint8Array) {
        if (!imagem.byteLength) {
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

async function processarCalculadora(
    mensagem,
    config,
    entrada
) {
    const imagem =
        entrada.tipo === 'robux'
            ? await gerarImagemPorRobux(
                entrada.valor,
                config
            )
            : await gerarImagemPorReais(
                entrada.valor,
                config
            );

    await responderMensagem(mensagem, {
        files: [
            prepararImagem(imagem)
        ]
    });
}

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

        try {
            await registrarMensagemEquipe(
                mensagem,
                config
            );
        } catch (erro) {
            console.error(
                '[InovareSale | Staff] Erro ao registrar mensagem:',
                erro
            );
        }

        if (
            !config?.calculadora?.canalId ||
            mensagem.channelId !==
                String(config.calculadora.canalId)
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

        if (!entrada) {
            return;
        }

        const chave =
            `${mensagem.guildId}:${mensagem.author.id}`;

        if (!permitirConsulta(chave)) {
            return;
        }

        try {
            if (
                typeof mensagem.channel.sendTyping ===
                'function'
            ) {
                await mensagem.channel
                    .sendTyping()
                    .catch(() => {});
            }

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
    },

    obterRankingMensagensPeriodo,
    obterMensagensFuncionarioPeriodo
};
