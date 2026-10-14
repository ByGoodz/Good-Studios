
'use strict';

const {
    EmbedBuilder,
    GatewayIntentBits,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    UserSelectMenuBuilder,
    MessageFlags
} = require('discord.js');

const { db } = require('../database/db');
const { getConfig, saveConfig } = require('../utils/storage');
const { obterResumoConvites } = require('./convitesService');

const {
    obterResumoModeracao,
    obterRankingModeracaoPeriodo,
    obterModeracaoFuncionarioPeriodo
} = require('./moderacaoService');

const {
    obterResumoEquipe,
    obterRankingVozPeriodo,
    obterVozFuncionarioPeriodo
} = require('./staffService');

const VERSAO = '3.1.0';
const INTERVALO_ATUALIZACAO = 30 * 60 * 1000;
const INICIO_RANKING = Math.floor(Date.UTC(2026, 9, 14, 3) / 1000);

const RESULTADOS = new Map();
const SERVIDORES_ATUALIZANDO = new Set();
const PREMIACOES_PROCESSANDO = new Set();

const ESTADOS = Object.freeze({
    NORMAL: 'normal',
    ATENCAO: 'atencao',
    PROBLEMA: 'problema'
});

const CORES = Object.freeze({
    NORMAL: 0x22C55E,
    ATENCAO: 0xFACC15,
    PROBLEMA: 0xEF4444
});

let timerStatus = null;
let clienteMonitorado = null;
let atualizacaoGeralEmAndamento = false;

db.exec(`
    CREATE TABLE IF NOT EXISTS staff_premiacoes_mensais_v31 (
        servidor_id TEXT NOT NULL,
        inicio_em INTEGER NOT NULL,
        fim_em INTEGER NOT NULL,
        vencedor_id TEXT,
        pontos INTEGER NOT NULL DEFAULT 0,
        anunciado_em INTEGER,
        PRIMARY KEY (servidor_id, inicio_em)
    );
`);

const SQL_PREMIOS = {
    obter: db.prepare(`
        SELECT * FROM staff_premiacoes_mensais_v31
        WHERE servidor_id = ? AND inicio_em = ?
    `),

    inserir: db.prepare(`
        INSERT OR IGNORE INTO staff_premiacoes_mensais_v31
        (servidor_id, inicio_em, fim_em, vencedor_id, pontos)
        VALUES (?, ?, ?, ?, ?)
    `),

    marcar: db.prepare(`
        UPDATE staff_premiacoes_mensais_v31
        SET anunciado_em = ?
        WHERE servidor_id = ? AND inicio_em = ? AND anunciado_em IS NULL
    `)
};

function idValido(valor) {
    const texto = String(valor ?? '').trim();

    return /^\d{15,22}$/.test(texto)
        ? texto
        : null;
}

function formatarNumero(valor) {
    const numero = Number(valor);

    return Number.isFinite(numero) && numero >= 0
        ? Math.floor(numero).toLocaleString('pt-BR')
        : 'Indisponível';
}

function formatarDuracao(segundos) {
    const total = Math.max(
        0,
        Math.floor(Number(segundos) || 0)
    );

    const dias = Math.floor(total / 86400);
    const horas = Math.floor((total % 86400) / 3600);
    const minutos = Math.floor((total % 3600) / 60);

    return [
        dias && `${dias}d`,
        horas && `${horas}h`,
        minutos && `${minutos}min`
    ].filter(Boolean).join(' ') || `${total % 60}s`;
}

function limitarTexto(valor, limite = 1500) {
    const texto = String(valor ?? '');

    return texto.length > limite
        ? `${texto.slice(0, limite - 3)}...`
        : texto;
}

function carregarConfigStatus() {
    const config = getConfig();

    return {
        config,
        status: config.status || {},
        staff: config.staff || {}
    };
}

function obterResumoTicketsStatus(servidorId) {
    const servidor = idValido(servidorId);

    if (!servidor) {
        return {
            disponivel: false,
            motivo: 'Servidor inválido'
        };
    }

    try {
        const resultado = db.prepare(`
            SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'criando' THEN 1 ELSE 0 END) AS criando,
                SUM(CASE WHEN status = 'aberto' THEN 1 ELSE 0 END) AS abertos,
                SUM(CASE WHEN status = 'em_atendimento' THEN 1 ELSE 0 END) AS em_atendimento,
                SUM(CASE WHEN status = 'finalizando' THEN 1 ELSE 0 END) AS finalizando,
                SUM(CASE WHEN status = 'finalizado' THEN 1 ELSE 0 END) AS finalizados,
                SUM(CASE WHEN status = 'cancelado' THEN 1 ELSE 0 END) AS cancelados
            FROM tickets
            WHERE servidor_id = ?
        `).get(servidor);

        const dados = {
            disponivel: true,
            total: Number(resultado?.total || 0),
            criando: Number(resultado?.criando || 0),
            abertos: Number(resultado?.abertos || 0),
            emAtendimento: Number(resultado?.em_atendimento || 0),
            finalizando: Number(resultado?.finalizando || 0),
            finalizados: Number(resultado?.finalizados || 0),
            cancelados: Number(resultado?.cancelados || 0)
        };

        dados.ativos =
            dados.criando +
            dados.abertos +
            dados.emAtendimento +
            dados.finalizando;

        return dados;
    } catch (erro) {
        console.error(
            '[InovareSale | Status] Erro ao consultar tickets:',
            erro
        );

        return {
            disponivel: false,
            motivo: 'Estatísticas de tickets indisponíveis'
        };
    }
}

function obterEquipeEmVoz(guild, config = null) {
    if (!guild?.id) {
        return {
            disponivel: false,
            motivo: 'Servidor indisponível'
        };
    }

    const cargoId = idValido(
        (config || getConfig()).staff?.cargoId
    );

    if (!cargoId) {
        return {
            disponivel: false,
            configurado: false,
            motivo: 'Cargo da equipe não configurado'
        };
    }

    if (
        !guild.client?.options?.intents?.has(
            GatewayIntentBits.GuildVoiceStates
        )
    ) {
        return {
            disponivel: false,
            configurado: true,
            motivo: 'Intent de voz não habilitado'
        };
    }

    const membros = [];
    let membrosSemDados = 0;

    for (const estado of guild.voiceStates.cache.values()) {
        if (!estado.channelId) continue;

        const membro =
            estado.member ||
            guild.members.cache.get(estado.id);

        if (!membro) {
            membrosSemDados++;
            continue;
        }

        if (
            !membro.user?.bot &&
            membro.roles?.cache?.has(cargoId)
        ) {
            membros.push({
                membroId: membro.id,
                canalId: estado.channelId
            });
        }
    }

    return {
        disponivel: membrosSemDados === 0,
        configurado: true,
        quantidade: membros.length,
        parcial: membrosSemDados > 0,
        membrosSemDados,
        membros,
        motivo: membrosSemDados
            ? 'Contagem parcial da equipe em voz'
            : null
    };
}

async function obterResumoEquipeStatus(guild, config) {
    const presenca = obterEquipeEmVoz(guild, config);

    try {
        const historico = await obterResumoEquipe(guild);

        return {
            ...presenca,
            historico
        };
    } catch (erro) {
        console.warn(
            '[InovareSale | Status] Histórico de voz indisponível:',
            erro.message
        );

        return {
            ...presenca,
            historico: null
        };
    }
}

function obterResumoConvitesStatus(servidorId) {
    try {
        const resultado = obterResumoConvites(servidorId);

        if (!resultado || resultado.disponivel === false) {
            return {
                disponivel: false,
                motivo: resultado?.descricao || 'Aguardando convites'
            };
        }

        return {
            disponivel: true,
            confirmados: Number(resultado.quantidade || 0),
            linksAtivos: Number(resultado.linksAtivos || 0),
            naoIdentificados: Number(resultado.naoIdentificados || 0)
        };
    } catch (erro) {
        console.error(
            '[InovareSale | Status] Erro ao consultar convites:',
            erro
        );

        return {
            disponivel: false,
            motivo: 'Dados de convites indisponíveis'
        };
    }
}

function obterResumoModeracaoStatus(servidorId) {
    try {
        const resultado = obterResumoModeracao(servidorId);

        if (!resultado?.disponivel) {
            return {
                disponivel: false
            };
        }

        return {
            disponivel: true,
            total: Number(resultado.quantidade || 0),
            bans: Number(resultado.banimentos || 0),
            warns: Number(resultado.advertencias || 0),
            warnsAtivas: Number(resultado.advertenciasAtivas || 0),
            timeouts: Number(resultado.timeouts || 0),
            acoesTotais: Number(resultado.acoesTotais || 0)
        };
    } catch (erro) {
        console.error(
            '[InovareSale | Status] Erro ao consultar moderação:',
            erro
        );

        return {
            disponivel: false
        };
    }
}

function obterSaudeSistema(
    client,
    {
        tickets,
        equipe,
        convites,
        moderacao
    } = {}
) {
    const problemas = [];
    const avisos = [];

    const conectado = Boolean(client?.isReady?.());
    const bancoDisponivel = Boolean(db.open);

    const ping = Number(client?.ws?.ping);
    const pingValido = Number.isFinite(ping) && ping >= 0;

    if (!conectado) {
        problemas.push('Discord desconectado');
    }

    if (!bancoDisponivel) {
        problemas.push('SQLite indisponível');
    }

    if (pingValido && ping >= 2000) {
        problemas.push('Latência crítica');
    } else if (pingValido && ping >= 1000) {
        avisos.push('Latência elevada');
    }

    if (tickets && !tickets.disponivel) {
        avisos.push('Dados de tickets indisponíveis');
    }

    if (equipe && !equipe.disponivel) {
        avisos.push(
            equipe.motivo || 'Dados da equipe indisponíveis'
        );
    }

    if (convites && !convites.disponivel) {
        avisos.push('Dados de convites indisponíveis');
    }

    if (moderacao && !moderacao.disponivel) {
        avisos.push('Dados de moderação indisponíveis');
    }

    const estado = problemas.length
        ? ESTADOS.PROBLEMA
        : avisos.length
            ? ESTADOS.ATENCAO
            : ESTADOS.NORMAL;

    return {
        estado,
        cor: CORES[
            estado === ESTADOS.NORMAL
                ? 'NORMAL'
                : estado === ESTADOS.ATENCAO
                    ? 'ATENCAO'
                    : 'PROBLEMA'
        ],
        icone: estado === ESTADOS.NORMAL
            ? '🟢'
            : estado === ESTADOS.ATENCAO
                ? '🟡'
                : '🔴',
        descricao: estado === ESTADOS.NORMAL
            ? 'Funcionamento normal'
            : estado === ESTADOS.ATENCAO
                ? 'Alguns dados precisam de atenção'
                : 'Problema detectado',
        conectado,
        bancoDisponivel,
        ping: pingValido ? Math.round(ping) : null,
        problemas,
        avisos
    };
}

async function obterDadosStatus(
    guild,
    client = guild?.client
) {
    if (!guild?.id) {
        throw new Error(
            'Servidor inválido para o painel.'
        );
    }

    const { config } = carregarConfigStatus();

    const tickets = obterResumoTicketsStatus(
        guild.id
    );

    const equipe = await obterResumoEquipeStatus(
        guild,
        config
    );

    const convites = obterResumoConvitesStatus(
        guild.id
    );

    const moderacao = obterResumoModeracaoStatus(
        guild.id
    );

    const saude = obterSaudeSistema(client, {
        tickets,
        equipe,
        convites,
        moderacao
    });

    return {
        servidorId: guild.id,
        nomeServidor: guild.name,
        tickets,
        equipe,
        convites,
        moderacao,
        saude,
        uptimeSegundos: Math.max(
            0,
            Math.floor(Number(client?.uptime || 0) / 1000)
        ),
        atualizadoEm: Date.now()
    };
}

function partesDataBrasil(data = new Date()) {
    const partes = new Intl.DateTimeFormat(
        'en-US',
        {
            timeZone: 'America/Sao_Paulo',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric'
        }
    ).formatToParts(data);

    const obter = tipo => Number(
        partes.find(item => item.type === tipo)?.value
    );

    return {
        ano: obter('year'),
        mes: obter('month'),
        dia: obter('day')
    };
}

function obterPeriodoMensal(data = new Date()) {
    const local = partesDataBrasil(data);

    const mesInicio = local.dia >= 14
        ? local.mes - 1
        : local.mes - 2;

    const inicioCalculado = Math.floor(
        Date.UTC(local.ano, mesInicio, 14, 3) / 1000
    );

    const inicio = Math.max(
        INICIO_RANKING,
        inicioCalculado
    );

    const fim = inicioCalculado < INICIO_RANKING
        ? Math.floor(Date.UTC(2026, 10, 14, 3) / 1000)
        : Math.floor(
            Date.UTC(
                local.ano,
                mesInicio + 1,
                14,
                3
            ) / 1000
        );

    return {
        inicio,
        fim,
        iniciado: inicioCalculado >= INICIO_RANKING,
        rotulo:
            `${formatarData(inicio)} a ${formatarData(fim)}`
    };
}

function formatarData(timestamp) {
    return new Intl.DateTimeFormat(
        'pt-BR',
        {
            timeZone: 'America/Sao_Paulo',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        }
    ).format(new Date(timestamp * 1000));
}

function pesosRanking(config = getConfig()) {
    const pesos = config.status?.rankingPesos || {};

    const seguro = (valor, padrao) =>
        Number.isSafeInteger(valor) &&
        valor >= 0 &&
        valor <= 1000
            ? valor
            : padrao;

    return {
        warn: seguro(pesos.warn, 10),
        ban: seguro(pesos.ban, 20),
        dezMinutosVoz: seguro(
            pesos.dezMinutosVoz,
            1
        ),
        dezMinutosAtendimento: seguro(
            pesos.dezMinutosAtendimento,
            3
        )
    };
}

async function buscarMembroEquipe(
    guild,
    id,
    cargoId
) {
    try {
        const membro =
            guild.members.cache.get(id) ||
            await guild.members.fetch(id);

        return (
            !membro.user?.bot &&
            membro.roles.cache.has(cargoId)
        )
            ? membro
            : null;
    } catch {
        return null;
    }
}

async function obterRankingMensal(
    guild,
    periodo = obterPeriodoMensal()
) {
    const config = getConfig();

    const cargoId = idValido(
        config.staff?.cargoId
    );

    if (!cargoId) {
        return {
            disponivel: false,
            motivo: 'Cargo da equipe não configurado',
            periodo,
            ranking: []
        };
    }

    if (!periodo.iniciado) {
        return {
            disponivel: false,
            motivo: 'A contagem começa em 14/10/2026',
            periodo,
            ranking: []
        };
    }

    const fim = Math.min(
        periodo.fim,
        Math.floor(Date.now() / 1000)
    );

    if (fim <= periodo.inicio) {
        return {
            disponivel: true,
            periodo,
            ranking: [],
            pesos: pesosRanking(config)
        };
    }

    const voz = obterRankingVozPeriodo(
        guild.id,
        periodo.inicio,
        fim,
        100
    );

    const moderacao = obterRankingModeracaoPeriodo(
        guild.id,
        periodo.inicio,
        fim,
        100
    );

    const mapa = new Map();

    for (const item of voz) {
        mapa.set(item.membroId, {
            membroId: item.membroId,
            warns: 0,
            bans: 0,
            tempoTotalSegundos:
                item.tempoTotalSegundos,
            tempoAtendimentoSegundos:
                item.tempoAtendimentoSegundos
        });
    }

    for (const item of moderacao) {
        const linha =
            mapa.get(item.moderadorId) ||
            {
                membroId: item.moderadorId,
                warns: 0,
                bans: 0,
                tempoTotalSegundos: 0,
                tempoAtendimentoSegundos: 0
            };

        linha.warns = item.warns;
        linha.bans = item.bans;

        mapa.set(item.moderadorId, linha);
    }

    const pesos = pesosRanking(config);
    const ranking = [];

    for (const item of mapa.values()) {
        const membro = await buscarMembroEquipe(
            guild,
            item.membroId,
            cargoId
        );

        if (!membro) continue;

        const pontos =
            item.warns * pesos.warn +
            item.bans * pesos.ban +
            Math.floor(
                item.tempoTotalSegundos / 600
            ) * pesos.dezMinutosVoz +
            Math.floor(
                item.tempoAtendimentoSegundos / 600
            ) * pesos.dezMinutosAtendimento;

        ranking.push({
            ...item,
            nome:
                membro.displayName ||
                membro.user.username,
            pontos,
            totalAcoes:
                item.warns +
                item.bans
        });
    }

    ranking.sort((a, b) =>
        b.pontos - a.pontos ||
        b.tempoAtendimentoSegundos -
        a.tempoAtendimentoSegundos ||
        a.membroId.localeCompare(b.membroId)
    );

    return {
        disponivel: true,
        periodo,
        pesos,
        ranking: ranking.map(
            (item, indice) => ({
                ...item,
                posicao: indice + 1
            })
        )
    };
}

async function obterFuncionarioMensal(
    guild,
    membroId,
    periodo = obterPeriodoMensal()
) {
    const id = idValido(membroId);

    const cargoId = idValido(
        getConfig().staff?.cargoId
    );

    if (!id || !cargoId) {
        return {
            disponivel: false,
            motivo: 'Funcionário ou cargo inválido'
        };
    }

    const membro = await buscarMembroEquipe(
        guild,
        id,
        cargoId
    );

    if (!membro) {
        return {
            disponivel: false,
            motivo:
                'O usuário não pertence à equipe configurada'
        };
    }

    if (!periodo.iniciado) {
        return {
            disponivel: false,
            motivo: 'Ranking ainda não iniciado'
        };
    }

    const fim = Math.min(
        periodo.fim,
        Math.floor(Date.now() / 1000)
    );

    const fimConsulta = Math.max(
        periodo.inicio + 1,
        fim
    );

    const voz = obterVozFuncionarioPeriodo(
        guild.id,
        id,
        periodo.inicio,
        fimConsulta
    );

    const moderacao = obterModeracaoFuncionarioPeriodo(
        guild.id,
        id,
        periodo.inicio,
        fimConsulta
    );

    const pesos = pesosRanking();

    const pontos =
        moderacao.warns * pesos.warn +
        moderacao.bans * pesos.ban +
        Math.floor(
            voz.tempoTotalSegundos / 600
        ) * pesos.dezMinutosVoz +
        Math.floor(
            voz.tempoAtendimentoSegundos / 600
        ) * pesos.dezMinutosAtendimento;

    return {
        disponivel: true,
        membroId: id,
        nome:
            membro.displayName ||
            membro.user.username,
        periodo,
        pontos,
        ...voz,
        ...moderacao
    };
}

function criarEmbedStatus(dados) {
    if (!dados?.saude) {
        throw new Error(
            'Dados do status inválidos.'
        );
    }

    return new EmbedBuilder()
        .setColor(dados.saude.cor)
        .setTitle(
            `${dados.saude.icone} INOVARESALE | STATUS`
        )
        .setDescription(
            `**Situação:** ${dados.saude.descricao}\n\n` +
            `**Bot:** ${
                dados.saude.conectado
                    ? 'Online'
                    : 'Offline'
            }\n` +
            `**SQLite:** ${
                dados.saude.bancoDisponivel
                    ? 'Disponível'
                    : 'Indisponível'
            }\n` +
            `**Ping:** ${
                dados.saude.ping === null
                    ? 'Indisponível'
                    : `${dados.saude.ping}ms`
            }\n` +
            `**Tempo online:** ${
                formatarDuracao(
                    dados.uptimeSegundos
                )
            }`
        )
        .setFooter({
            text:
                `InovareSale Bot ${VERSAO} • ` +
                'Atualização a cada 30 minutos'
        })
        .setTimestamp(
            new Date(dados.atualizadoEm)
        );
}

function bloco(texto) {
    return new TextDisplayBuilder()
        .setContent(
            limitarTexto(texto, 3800)
        );
}

function criarContainer(
    titulo,
    conteudo,
    cor = CORES.NORMAL
) {
    return new ContainerBuilder()
        .setAccentColor(cor)
        .addTextDisplayComponents(
            bloco(titulo)
        )
        .addSeparatorComponents(
            new SeparatorBuilder()
        )
        .addTextDisplayComponents(
            bloco(conteudo)
        );
}

function criarPainelStatus(dados) {
    if (!dados?.saude) {
        throw new Error(
            'Dados do status inválidos.'
        );
    }

    const periodo = obterPeriodoMensal();

    const linhas = [
        `${dados.saude.icone} **${dados.saude.descricao}**`,
        '',
        'Este painel permanece neste canal e é atualizado a cada **30 minutos**.',
        'Escolha abaixo o que deseja consultar. A resposta será privada para você.',
        '',
        `🏆 **Ciclo da equipe:** ${periodo.rotulo}`,
        `🕒 **Última atualização:** <t:${
            Math.floor(
                dados.atualizadoEm / 1000
            )
        }:R>`
    ];

    const menu = new StringSelectMenuBuilder()
        .setCustomId('status_view')
        .setPlaceholder(
            'Selecione as informações de status'
        )
        .addOptions(
            {
                label: 'Status do Bot',
                value: 'bot',
                description:
                    'Sistema, pedidos, convites e moderação',
                emoji: '🤖'
            },
            {
                label: 'Status da Equipe',
                value: 'equipe',
                description:
                    'Atendimentos, voz e desempenho coletivo',
                emoji: '🎙️'
            },
            {
                label: 'Ranking Mensal',
                value: 'ranking',
                description:
                    'Classificação dos funcionários',
                emoji: '🏆'
            },
            {
                label: 'Funcionário Individual',
                value: 'individual',
                description:
                    'Consultar um membro da equipe',
                emoji: '👤'
            }
        );

    return criarContainer(
        '## 💜 INOVARESALE | CENTRAL DE STATUS',
        linhas.join('\n'),
        dados.saude.cor
    )
        .addSeparatorComponents(
            new SeparatorBuilder()
        )
        .addActionRowComponents(
            new ActionRowBuilder()
                .addComponents(menu)
        )
        .addTextDisplayComponents(
            bloco(
                `-# InovareSale Bot ${VERSAO} • Monitoramento automático`
            )
        );
}

function criarDetalhesBot(dados) {
    const tickets = dados.tickets.disponivel
        ? [
            `**Ativos:** ${
                formatarNumero(
                    dados.tickets.ativos
                )
            }`,
            `**Abertos:** ${
                formatarNumero(
                    dados.tickets.abertos
                )
            }`,
            `**Em atendimento:** ${
                formatarNumero(
                    dados.tickets.emAtendimento
                )
            }`,
            `**Finalizados:** ${
                formatarNumero(
                    dados.tickets.finalizados
                )
            }`,
            `**Cancelados:** ${
                formatarNumero(
                    dados.tickets.cancelados
                )
            }`
        ].join('\n')
        : 'Estatísticas indisponíveis';

    const convites = dados.convites.disponivel
        ? [
            `**Confirmados:** ${
                formatarNumero(
                    dados.convites.confirmados
                )
            }`,
            `**Links ativos:** ${
                formatarNumero(
                    dados.convites.linksAtivos
                )
            }`,
            `**Não identificados:** ${
                formatarNumero(
                    dados.convites.naoIdentificados
                )
            }`
        ].join('\n')
        : 'Dados indisponíveis';

    const mod = dados.moderacao.disponivel
        ? [
            `**/warn registrados:** ${
                formatarNumero(
                    dados.moderacao.warns
                )
            }`,
            `**/ban registrados:** ${
                formatarNumero(
                    dados.moderacao.bans
                )
            }`,
            `**Timeouts registrados:** ${
                formatarNumero(
                    dados.moderacao.timeouts
                )
            }`
        ].join('\n')
        : 'Dados indisponíveis';

    const observacoes = [
        ...dados.saude.problemas,
        ...dados.saude.avisos
    ];

    return criarContainer(
        '## 🤖 STATUS DO BOT',
        [
            `**Situação:** ${
                dados.saude.icone
            } ${dados.saude.descricao}`,
            `**Bot:** ${
                dados.saude.conectado
                    ? 'Online'
                    : 'Offline'
            }`,
            `**SQLite:** ${
                dados.saude.bancoDisponivel
                    ? 'Disponível'
                    : 'Indisponível'
            }`,
            `**Ping:** ${
                dados.saude.ping === null
                    ? 'Indisponível'
                    : `${dados.saude.ping} ms`
            }`,
            `**Tempo online:** ${
                formatarDuracao(
                    dados.uptimeSegundos
                )
            }`,
            '',
            '### 🛒 Pedidos e tickets',
            tickets,
            '',
            '### 🔗 Convites',
            convites,
            '',
            '### 🛡️ Moderação do InovareSale',
            mod,
            observacoes.length
                ? `\n### ⚠️ Observações\n${
                    observacoes
                        .slice(0, 5)
                        .map(item => `• ${item}`)
                        .join('\n')
                }`
                : '',
            '',
            `-# Atualizado <t:${
                Math.floor(
                    dados.atualizadoEm / 1000
                )
            }:R>`
        ].filter(Boolean).join('\n'),
        dados.saude.cor
    );
}

function textoRanking(
    ranking,
    limite = 10
) {
    if (!ranking.length) {
        return 'Nenhuma atividade registrada neste período.';
    }

    return ranking
        .slice(0, limite)
        .map(item => {
            const medalha =
                ['🥇', '🥈', '🥉'][
                    item.posicao - 1
                ] ||
                `**${item.posicao}.**`;

            return (
                `${medalha} <@${item.membroId}> — ` +
                `**${formatarNumero(item.pontos)} pts**\n` +
                `↳ ${item.warns} warns • ` +
                `${item.bans} bans • ` +
                `${formatarDuracao(
                    item.tempoAtendimentoSegundos
                )} atendimento`
            );
        })
        .join('\n\n');
}

function criarDetalhesEquipe(
    dados,
    ranking
) {
    const total = ranking.ranking.reduce(
        (soma, item) => ({
            pontos:
                soma.pontos +
                item.pontos,
            warns:
                soma.warns +
                item.warns,
            bans:
                soma.bans +
                item.bans,
            voz:
                soma.voz +
                item.tempoTotalSegundos,
            atendimento:
                soma.atendimento +
                item.tempoAtendimentoSegundos
        }),
        {
            pontos: 0,
            warns: 0,
            bans: 0,
            voz: 0,
            atendimento: 0
        }
    );

    const presenca =
        dados.equipe.disponivel ||
        dados.equipe.parcial
            ? formatarNumero(
                dados.equipe.quantidade
            )
            : 'Indisponível';

    return criarContainer(
        '## 🎙️ STATUS DA EQUIPE',
        [
            `**Período:** ${
                ranking.periodo.rotulo
            }`,
            `**Funcionários com atividades:** ${
                ranking.ranking.length
            }`,
            `**Funcionários em call agora:** ${
                presenca
            }`,
            `**Total de pontos:** ${
                formatarNumero(total.pontos)
            }`,
            `**Advertências:** ${
                formatarNumero(total.warns)
            }`,
            `**Banimentos:** ${
                formatarNumero(total.bans)
            }`,
            `**Tempo total em voz:** ${
                formatarDuracao(total.voz)
            }`,
            `**Tempo em call de atendimento:** ${
                formatarDuracao(
                    total.atendimento
                )
            }`,
            '**Mensagens:** integração pendente',
            '',
            '### 🏅 Destaques do mês',
            textoRanking(ranking.ranking, 3),
            '',
            '-# Apenas ações registradas pelo InovareSale entram nas estatísticas de moderação.'
        ].join('\n'),
        0x5865F2
    );
}

function criarDetalhesRanking(resultado) {
    const {
        pesos,
        periodo,
        ranking
    } = resultado;

    return criarContainer(
        '## 🏆 RANKING MENSAL',
        [
            `**Ciclo:** ${periodo.rotulo}`,
            '',
            textoRanking(ranking, 15),
            '',
            '### ⚖️ Pontuação',
            `**Warn:** ${pesos.warn} pts • ` +
                `**Ban:** ${pesos.ban} pts`,
            `**10 min em call:** ${
                pesos.dezMinutosVoz
            } pt(s)`,
            `**10 min em atendimento:** +${
                pesos.dezMinutosAtendimento
            } pt(s)`,
            '**Mensagens:** ainda não integradas',
            '',
            '-# Os pontos deste ciclo recomeçam no próximo dia 14. O histórico é preservado.'
        ].join('\n'),
        0xF1C40F
    );
}

function criarDetalhesFuncionario(dados) {
    return criarContainer(
        `## 👤 ${
            limitarTexto(dados.nome, 70)
        }`,
        [
            `<@${dados.membroId}>`,
            `**Ciclo:** ${
                dados.periodo.rotulo
            }`,
            `**Pontuação:** ${
                formatarNumero(dados.pontos)
            } pts`,
            `**Advertências:** ${
                formatarNumero(dados.warns)
            }`,
            `**Banimentos:** ${
                formatarNumero(dados.bans)
            }`,
            `**Total de ações:** ${
                formatarNumero(
                    dados.totalAcoes
                )
            }`,
            `**Tempo total em voz:** ${
                formatarDuracao(
                    dados.tempoTotalSegundos
                )
            }`,
            `**Tempo em call de atendimento:** ${
                formatarDuracao(
                    dados.tempoAtendimentoSegundos
                )
            }`,
            `**Sessões de voz:** ${
                formatarNumero(
                    dados.totalSessoes
                )
            }`,
            '**Mensagens válidas:** integração pendente'
        ].join('\n'),
        0x5865F2
    );
}

async function responderStatus(
    interaction,
    container
) {
    const payload = {
        components: [container],
        allowedMentions: {
            parse: []
        },
        flags:
            MessageFlags.Ephemeral |
            MessageFlags.IsComponentsV2
    };

    if (
        interaction.replied ||
        interaction.deferred
    ) {
        return interaction.editReply({
            components: [container],
            allowedMentions: {
                parse: []
            }
        });
    }

    return interaction.reply(payload);
}

async function handleStatusInteraction(
    interaction
) {
    if (
        !interaction.inGuild?.() ||
        !interaction.guild
    ) {
        await responderStatus(
            interaction,
            criarContainer(
                '## ⚠️ Indisponível',
                'Este menu funciona apenas em servidores.',
                CORES.ATENCAO
            )
        );

        return true;
    }

    const id = interaction.customId;

    if (
        id !== 'status_view' &&
        id !== 'status_funcionario'
    ) {
        return false;
    }

    if (id === 'status_view') {
        const config = getConfig();

        const painelId = idValido(
            config.status?.mensagemId
        );

        if (
            painelId &&
            interaction.message?.id !== painelId
        ) {
            await responderStatus(
                interaction,
                criarContainer(
                    '## ⚠️ Painel antigo',
                    'Utilize o painel de status atual.',
                    CORES.ATENCAO
                )
            );

            return true;
        }
    }

    await responderStatus(
        interaction,
        criarContainer(
            '## ⏳ Consultando',
            'Buscando as informações atualizadas...'
        )
    );

    try {
        let conteudo;

        if (id === 'status_funcionario') {
            const membroId = idValido(
                interaction.values?.[0]
            );

            const dados =
                await obterFuncionarioMensal(
                    interaction.guild,
                    membroId
                );

            conteudo = dados.disponivel
                ? criarDetalhesFuncionario(dados)
                : criarContainer(
                    '## ⚠️ Não foi possível consultar',
                    dados.motivo,
                    CORES.ATENCAO
                );
        } else {
            const opcao =
                interaction.values?.[0];

            if (opcao === 'individual') {
                conteudo = criarContainer(
                    '## 👤 CONSULTAR FUNCIONÁRIO',
                    'Escolha abaixo o funcionário que deseja consultar.'
                ).addActionRowComponents(
                    new ActionRowBuilder()
                        .addComponents(
                            new UserSelectMenuBuilder()
                                .setCustomId(
                                    'status_funcionario'
                                )
                                .setPlaceholder(
                                    'Selecione um funcionário'
                                )
                                .setMinValues(1)
                                .setMaxValues(1)
                        )
                );
            } else if (opcao === 'bot') {
                conteudo = criarDetalhesBot(
                    await obterDadosStatus(
                        interaction.guild
                    )
                );
            } else if (
                opcao === 'equipe' ||
                opcao === 'ranking'
            ) {
                const ranking =
                    await obterRankingMensal(
                        interaction.guild
                    );

                if (!ranking.disponivel) {
                    conteudo = criarContainer(
                        '## ⚠️ Ranking indisponível',
                        ranking.motivo,
                        CORES.ATENCAO
                    );
                } else if (
                    opcao === 'ranking'
                ) {
                    conteudo =
                        criarDetalhesRanking(
                            ranking
                        );
                } else {
                    conteudo =
                        criarDetalhesEquipe(
                            await obterDadosStatus(
                                interaction.guild
                            ),
                            ranking
                        );
                }
            } else {
                conteudo = criarContainer(
                    '## ⚠️ Opção desconhecida',
                    'Selecione uma opção válida.',
                    CORES.ATENCAO
                );
            }
        }

        await interaction.editReply({
            components: [conteudo],
            allowedMentions: {
                parse: []
            }
        });
    } catch (erro) {
        console.error(
            '[InovareSale | Status] Falha no seletor:',
            erro
        );

        await interaction.editReply({
            components: [
                criarContainer(
                    '## ❌ Consulta indisponível',
                    'Não foi possível obter os dados agora. Tente novamente.',
                    CORES.PROBLEMA
                )
            ]
        });
    }

    return true;
}

async function obterCanalStatus(
    guild,
    config = null
) {
    if (!guild?.id) return null;

    const canalId = idValido(
        (config || getConfig()).status?.canalId
    );

    if (!canalId) return null;

    let canal =
        guild.channels.cache.get(canalId);

    if (!canal) {
        try {
            canal = await guild.channels.fetch(
                canalId
            );
        } catch (erro) {
            console.warn(
                '[InovareSale | Status] Canal indisponível:',
                erro.message
            );

            return null;
        }
    }

    return (
        canal?.isTextBased?.() &&
        typeof canal.send === 'function'
    )
        ? canal
        : null;
}

async function buscarMensagemStatus(
    canal,
    mensagemId
) {
    const id = idValido(mensagemId);

    if (!id) return null;

    try {
        return await canal.messages.fetch(
            id
        );
    } catch (erro) {
        if (erro.code === 10008) {
            return null;
        }

        throw erro;
    }
}

function salvarReferenciaStatus(
    guildId,
    canalId,
    mensagemId
) {
    const config = getConfig();

    config.status ??= {};

    config.status.canalId = canalId;
    config.status.mensagemId = mensagemId;
    config.status.mensagemCanalId = canalId;
    config.status.ultimaAtualizacaoEm =
        new Date().toISOString();

    saveConfig(config);

    return {
        guildId,
        canalId,
        mensagemId
    };
}

async function anunciarFuncionarioDoMes(
    guild,
    canal
) {
    const periodoAtual =
        obterPeriodoMensal();

    if (
        !periodoAtual.iniciado ||
        periodoAtual.inicio <= INICIO_RANKING
    ) {
        return false;
    }

    if (
        PREMIACOES_PROCESSANDO.has(
            guild.id
        )
    ) {
        return false;
    }

    PREMIACOES_PROCESSANDO.add(
        guild.id
    );

    try {
        const fim =
            periodoAtual.inicio;

        const inicioBase = new Date(
            (fim - 3600) * 1000
        );

        const periodo =
            obterPeriodoMensal(
                inicioBase
            );

        if (
            periodo.inicio < INICIO_RANKING
        ) {
            return false;
        }

        const existente =
            SQL_PREMIOS.obter.get(
                guild.id,
                periodo.inicio
            );

        if (existente?.anunciado_em) {
            return false;
        }

        const resultado =
            await obterRankingMensal(
                guild,
                periodo
            );

        if (!resultado.disponivel) {
            return false;
        }

        const vencedor =
            resultado.ranking.find(
                item => item.pontos > 0
            ) || null;

        SQL_PREMIOS.inserir.run(
            guild.id,
            periodo.inicio,
            periodo.fim,
            vencedor?.membroId || null,
            vencedor?.pontos || 0
        );

        const anuncio = vencedor
            ? [
                '## 🏆 FUNCIONÁRIO DO MÊS',
                `Parabéns, <@${vencedor.membroId}>!`,
                `**Pontuação:** ${
                    formatarNumero(
                        vencedor.pontos
                    )
                } pts`,
                `**Período:** ${
                    periodo.rotulo
                }`,
                '',
                '💜 Obrigado pelo seu trabalho na InovareSale!'
            ].join('\n')
            : [
                '## 🏆 ENCERRAMENTO DO CICLO',
                `**Período:** ${
                    periodo.rotulo
                }`,
                'Nenhum funcionário alcançou pontuação neste ciclo.'
            ].join('\n');

        await canal.send({
            components: [
                criarContainer(
                    '## 💜 INOVARESALE | EQUIPE',
                    anuncio,
                    0xF1C40F
                )
            ],
            flags:
                MessageFlags.IsComponentsV2,
            allowedMentions: {
                parse: [],
                users: vencedor
                    ? [vencedor.membroId]
                    : []
            }
        });

        SQL_PREMIOS.marcar.run(
            Math.floor(
                Date.now() / 1000
            ),
            guild.id,
            periodo.inicio
        );

        return true;
    } catch (erro) {
        console.error(
            '[InovareSale | Status] Falha no anúncio mensal:',
            erro
        );

        return false;
    } finally {
        PREMIACOES_PROCESSANDO.delete(
            guild.id
        );
    }
}

async function atualizarStatusServidor(
    guild,
    client = guild?.client
) {
    if (!guild?.id) {
        return {
            atualizado: false,
            motivo: 'Servidor inválido'
        };
    }

    if (
        SERVIDORES_ATUALIZANDO.has(
            guild.id
        )
    ) {
        return {
            atualizado: false,
            ocupado: true,
            motivo: 'Atualização em andamento'
        };
    }

    SERVIDORES_ATUALIZANDO.add(
        guild.id
    );

    try {
        const config = getConfig();
        const statusConfig =
            config.status || {};

        if (
            !idValido(
                statusConfig.canalId
            )
        ) {
            return {
                atualizado: false,
                configurado: false,
                motivo: 'Canal não configurado'
            };
        }

        const canal =
            await obterCanalStatus(
                guild,
                config
            );

        if (!canal) {
            return {
                atualizado: false,
                configurado: true,
                motivo: 'Canal indisponível'
            };
        }

        const dados =
            await obterDadosStatus(
                guild,
                client
            );

        const payload = {
            components: [
                criarPainelStatus(
                    dados
                )
            ],
            content: null,
            embeds: [],
            flags:
                MessageFlags.IsComponentsV2,
            allowedMentions: {
                parse: []
            }
        };

        const mensagemId = idValido(
            statusConfig.mensagemId
        );

        const canalAnteriorId = idValido(
            statusConfig.mensagemCanalId
        );

        const mesmaLocalizacao =
            !canalAnteriorId ||
            canalAnteriorId === canal.id;

        const mensagem =
            mensagemId &&
            mesmaLocalizacao
                ? await buscarMensagemStatus(
                    canal,
                    mensagemId
                )
                : null;

        let publicada;
        let criado = false;

        if (mensagem) {
            if (
                mensagem.author?.id !==
                client?.user?.id
            ) {
                throw new Error(
                    'A mensagem salva não pertence a este bot.'
                );
            }

            publicada =
                await mensagem.edit(
                    payload
                );
        } else {
            publicada =
                await canal.send(
                    payload
                );

            criado = true;

            salvarReferenciaStatus(
                guild.id,
                canal.id,
                publicada.id
            );

            if (
                mensagemId &&
                canalAnteriorId &&
                canalAnteriorId !== canal.id
            ) {
                try {
                    const anterior =
                        await guild.channels.fetch(
                            canalAnteriorId
                        );

                    const mensagemAnterior =
                        await buscarMensagemStatus(
                            anterior,
                            mensagemId
                        );

                    if (
                        mensagemAnterior?.author?.id ===
                        client?.user?.id
                    ) {
                        await mensagemAnterior.delete();
                    }
                } catch (erro) {
                    console.warn(
                        '[InovareSale | Status] Falha ao limpar painel antigo:',
                        erro.message
                    );
                }
            }
        }

        if (!publicada.pinned) {
            try {
                await publicada.pin();
            } catch (erro) {
                console.warn(
                    '[InovareSale | Status] Não foi possível fixar o painel:',
                    erro.message
                );
            }
        }

        RESULTADOS.set(
            guild.id,
            {
                atualizadoEm: Date.now(),
                mensagemId: publicada.id,
                canalId: canal.id,
                estado: dados.saude.estado,
                criado
            }
        );

        await anunciarFuncionarioDoMes(
            guild,
            canal
        );

        return {
            atualizado: true,
            sucesso: true,
            criado,
            mensagemId: publicada.id,
            canalId: canal.id,
            estado: dados.saude.estado
        };
    } catch (erro) {
        console.error(
            `[InovareSale | Status] Falha no servidor ${guild.id}:`,
            erro
        );

        return {
            atualizado: false,
            sucesso: false,
            motivo: erro.message
        };
    } finally {
        SERVIDORES_ATUALIZANDO.delete(
            guild.id
        );
    }
}

async function atualizarTodosStatus(
    client
) {
    if (!client?.isReady?.()) {
        return {
            atualizado: false,
            motivo: 'Bot desconectado'
        };
    }

    if (
        atualizacaoGeralEmAndamento
    ) {
        return {
            atualizado: false,
            ocupado: true
        };
    }

    atualizacaoGeralEmAndamento = true;

    const resumo = {
        atualizado: true,
        servidores: 0,
        mensagensAtualizadas: 0,
        mensagensCriadas: 0,
        ignorados: 0,
        falhas: 0
    };

    try {
        for (
            const guild
            of client.guilds.cache.values()
        ) {
            resumo.servidores++;

            const resultado =
                await atualizarStatusServidor(
                    guild,
                    client
                );

            if (resultado.atualizado) {
                if (resultado.criado) {
                    resumo.mensagensCriadas++;
                } else {
                    resumo.mensagensAtualizadas++;
                }
            } else if (
                resultado.configurado === false ||
                resultado.ocupado
            ) {
                resumo.ignorados++;
            } else {
                resumo.falhas++;
            }
        }

        return resumo;
    } finally {
        atualizacaoGeralEmAndamento = false;
    }
}

function iniciarMonitoramentoStatus(
    client
) {
    if (
        !client ||
        typeof client.isReady !== 'function'
    ) {
        throw new Error(
            'Cliente Discord inválido.'
        );
    }

    if (timerStatus) {
        return false;
    }

    clienteMonitorado = client;

    atualizarTodosStatus(
        client
    ).catch(erro => {
        console.error(
            '[InovareSale | Status] Falha inicial:',
            erro
        );
    });

    timerStatus = setInterval(
        () => {
            atualizarTodosStatus(
                client
            ).catch(erro => {
                console.error(
                    '[InovareSale | Status] Falha periódica:',
                    erro
                );
            });
        },
        INTERVALO_ATUALIZACAO
    );

    timerStatus.unref?.();

    console.log(
        '[InovareSale | Status] Monitoramento iniciado: 30 minutos.'
    );

    return true;
}

function pararMonitoramentoStatus() {
    if (!timerStatus) {
        clienteMonitorado = null;
        return false;
    }

    clearInterval(timerStatus);

    timerStatus = null;
    clienteMonitorado = null;

    return true;
}

function obterEstatisticasStatus(
    servidorId = null
) {
    if (servidorId) {
        const registro = RESULTADOS.get(
            String(servidorId)
        );

        return {
            monitoramentoAtivo:
                Boolean(timerStatus),
            intervaloMinutos:
                INTERVALO_ATUALIZACAO / 60000,
            ultimaAtualizacao:
                registro?.atualizadoEm || null,
            mensagemId:
                registro?.mensagemId || null,
            canalId:
                registro?.canalId || null,
            estado:
                registro?.estado || null
        };
    }

    return {
        versao: VERSAO,
        monitoramentoAtivo:
            Boolean(timerStatus),
        clienteConectado:
            Boolean(
                clienteMonitorado?.isReady?.()
            ),
        intervaloMinutos:
            INTERVALO_ATUALIZACAO / 60000,
        servidoresMonitorados:
            RESULTADOS.size,
        atualizacaoEmAndamento:
            atualizacaoGeralEmAndamento,
        resultados:
            Array.from(
                RESULTADOS.entries()
            ).map(
                ([id, dados]) => ({
                    servidorId: id,
                    ...dados
                })
            )
    };
}

module.exports = {
    VERSAO,
    INTERVALO_ATUALIZACAO,
    formatarDuracao,
    obterResumoTicketsStatus,
    obterEquipeEmVoz,
    obterSaudeSistema,
    obterDadosStatus,
    criarEmbedStatus,
    criarPainelStatus,
    obterPeriodoMensal,
    obterRankingMensal,
    obterFuncionarioMensal,
    handleStatusInteraction,
    obterCanalStatus,
    atualizarStatusServidor,
    atualizarTodosStatus,
    iniciarMonitoramentoStatus,
    pararMonitoramentoStatus,
    obterEstatisticasStatus
};
