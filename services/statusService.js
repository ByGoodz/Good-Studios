
'use strict';

const {
    EmbedBuilder,
    GatewayIntentBits
} = require('discord.js');

const {
    db
} = require('../database/db');

const {
    getConfig,
    saveConfig
} = require('../utils/storage');

const {
    obterResumoConvites
} = require('./convitesService');

const {
    obterResumoModeracao
} = require('./moderacaoService');

const {
    obterResumoEquipe
} = require('./staffService');

// ==========================================
// INOVARESALE BOT 3.0
// SERVIÇO DE STATUS DO SERVIDOR
// ==========================================

// FUNCIONALIDADES:
//
// - Um painel por servidor
// - Atualização a cada 60 minutos
// - Editar mensagem existente
// - Status verde, amarelo ou vermelho
// - Tempo online do bot
// - Latência da conexão
// - Estatísticas reais de tickets
// - Funcionários em canais de voz
// - Convites identificados
// - Estatísticas de moderação
// - Persistência do ID da mensagem
// - Evitar atualizações simultâneas
// - Preservar configurações existentes
//
// IMPORTANTE:
//
// Quando não for possível consultar
// alguma informação, o painel mostrará
// "Indisponível".
//
// Não inventamos números.
//
// O histórico permanece nos serviços
// e tabelas SQLite já existentes.

// ==========================================
// CONFIGURAÇÕES
// ==========================================

const VERSAO = '3.0.0';

const INTERVALO_ATUALIZACAO =
    60 * 60 * 1000;

const CORES = Object.freeze({
    NORMAL: 0x22C55E,
    ATENCAO: 0xFACC15,
    PROBLEMA: 0xEF4444
});

const ESTADOS = Object.freeze({
    NORMAL: 'normal',
    ATENCAO: 'atencao',
    PROBLEMA: 'problema'
});

// ==========================================
// CONTROLES INTERNOS
// ==========================================

let timerStatus = null;

let clienteMonitorado = null;

let atualizacaoGeralEmAndamento = false;

const SERVIDORES_ATUALIZANDO =
    new Set();

const RESULTADOS = new Map();

// ==========================================
// FORMATAÇÕES
// ==========================================

function formatarNumero(valor) {
    const numero = Number(valor);

    if (
        !Number.isFinite(numero) ||
        numero < 0
    ) {
        return 'Indisponível';
    }

    return Math.floor(numero)
        .toLocaleString('pt-BR');
}

function formatarDuracao(segundos) {
    const total = Math.max(
        0,
        Math.floor(
            Number(segundos) || 0
        )
    );

    const dias = Math.floor(
        total / 86400
    );

    const horas = Math.floor(
        (total % 86400) / 3600
    );

    const minutos = Math.floor(
        (total % 3600) / 60
    );

    const partes = [];

    if (dias > 0) {
        partes.push(`${dias}d`);
    }

    if (horas > 0) {
        partes.push(`${horas}h`);
    }

    if (minutos > 0) {
        partes.push(`${minutos}min`);
    }

    if (!partes.length) {
        partes.push(
            `${total % 60}s`
        );
    }

    return partes.join(' ');
}

function textoDisponivel(
    valor,
    sufixo = ''
) {
    if (
        valor === null ||
        valor === undefined
    ) {
        return 'Indisponível';
    }

    const numero = Number(valor);

    if (
        !Number.isFinite(numero) ||
        numero < 0
    ) {
        return 'Indisponível';
    }

    return (
        formatarNumero(numero) +
        sufixo
    );
}

function limitarTexto(
    valor,
    limite = 1024
) {
    const texto = String(
        valor ?? ''
    );

    if (texto.length <= limite) {
        return texto;
    }

    return texto.slice(
        0,
        limite - 3
    ) + '...';
}

// ==========================================
// IDENTIFICAR CONFIGURAÇÃO
// ==========================================

function carregarConfigStatus() {
    const config = getConfig();

    return {
        config,

        status:
            config.status || {},

        staff:
            config.staff || {}
    };
}

function idValido(valor) {
    const texto = String(
        valor ?? ''
    ).trim();

    return /^\d{15,22}$/.test(
        texto
    )
        ? texto
        : null;
}

// ==========================================
// ESTATÍSTICAS DE TICKETS
// ==========================================

// Os estados utilizados vêm do
// services/ticketService.js:
//
// criando
// aberto
// em_atendimento
// finalizando
// finalizado
// cancelado
//
// Conta apenas tickets do servidor.
//
// Não consulta valores financeiros,
// portanto não mistura pedidos
// com vendas efetivamente concluídas.

function obterResumoTicketsStatus(
    servidorId
) {
    const servidor =
        idValido(servidorId);

    if (!servidor) {
        return {
            disponivel: false,
            motivo: 'Servidor inválido'
        };
    }

    try {
        const resultado = db.prepare(`
            SELECT
                COUNT(*) AS total,

                COALESCE(SUM(
                    CASE
                        WHEN status = 'criando'
                        THEN 1 ELSE 0
                    END
                ), 0) AS criando,

                COALESCE(SUM(
                    CASE
                        WHEN status = 'aberto'
                        THEN 1 ELSE 0
                    END
                ), 0) AS abertos,

                COALESCE(SUM(
                    CASE
                        WHEN status = 'em_atendimento'
                        THEN 1 ELSE 0
                    END
                ), 0) AS em_atendimento,

                COALESCE(SUM(
                    CASE
                        WHEN status = 'finalizando'
                        THEN 1 ELSE 0
                    END
                ), 0) AS finalizando,

                COALESCE(SUM(
                    CASE
                        WHEN status = 'finalizado'
                        THEN 1 ELSE 0
                    END
                ), 0) AS finalizados,

                COALESCE(SUM(
                    CASE
                        WHEN status = 'cancelado'
                        THEN 1 ELSE 0
                    END
                ), 0) AS cancelados

            FROM tickets

            WHERE servidor_id = ?
        `).get(servidor);

        const criando =
            Number(resultado?.criando || 0);

        const abertos =
            Number(resultado?.abertos || 0);

        const emAtendimento =
            Number(
                resultado?.em_atendimento || 0
            );

        const finalizando =
            Number(
                resultado?.finalizando || 0
            );

        return {
            disponivel: true,

            total:
                Number(resultado?.total || 0),

            criando,
            abertos,
            emAtendimento,
            finalizando,

            ativos:
                criando +
                abertos +
                emAtendimento +
                finalizando,

            finalizados:
                Number(
                    resultado?.finalizados || 0
                ),

            cancelados:
                Number(
                    resultado?.cancelados || 0
                )
        };

    } catch (erro) {
        console.error(
            '[InovareSale | Status] ' +
            'Erro ao consultar tickets:',
            erro
        );

        return {
            disponivel: false,
            motivo:
                'Falha ao consultar tickets'
        };
    }
}

// ==========================================
// FUNCIONÁRIOS EM CANAIS DE VOZ
// ==========================================

// Utiliza o cargo configurado em:
//
// config.staff.cargoId
//
// Conta somente membros com o cargo
// da equipe que estejam conectados
// em algum canal de voz.
//
// Se não houver cargo configurado,
// não mostra um zero enganoso.
//
// Se algum membro estiver sem dados
// suficientes no cache, essa contagem
// fica marcada como parcial.

function obterEquipeEmVoz(
    guild,
    config = null
) {
    if (!guild?.id) {
        return {
            disponivel: false,
            motivo:
                'Servidor indisponível'
        };
    }

    const configuracao =
        config || getConfig();

    const cargoId = idValido(
        configuracao.staff?.cargoId
    );

    if (!cargoId) {
        return {
            disponivel: false,
            configurado: false,
            motivo:
                'Cargo da equipe não configurado'
        };
    }

    const client = guild.client;

    if (
        !client?.options?.intents?.has(
            GatewayIntentBits.GuildVoiceStates
        )
    ) {
        return {
            disponivel: false,
            configurado: true,
            motivo:
                'Intent de voz não habilitado'
        };
    }

    let quantidade = 0;
    let membrosSemDados = 0;

    const membros = [];

    for (
        const estado
        of guild.voiceStates.cache.values()
    ) {
        if (!estado.channelId) {
            continue;
        }

        const membro =
            estado.member ||
            guild.members.cache.get(
                estado.id
            );

        if (!membro) {
            membrosSemDados++;
            continue;
        }

        if (membro.user?.bot) {
            continue;
        }

        if (
            !membro.roles?.cache?.has(
                cargoId
            )
        ) {
            continue;
        }

        quantidade++;

        membros.push({
            membroId: membro.id,
            canalId:
                estado.channelId
        });
    }

    return {
        disponivel:
            membrosSemDados === 0,

        configurado: true,

        quantidade,

        parcial:
            membrosSemDados > 0,

        membrosSemDados,

        membros,

        motivo:
            membrosSemDados > 0
                ? 'Existem membros sem dados suficientes no cache'
                : null
    };
}

// ==========================================
// RESUMO DA EQUIPE NO SQLITE
// ==========================================

// O staffService guarda sessões
// de funcionários.
//
// A contagem atual é observada
// diretamente no Discord.
//
// O histórico é consultado
// separadamente para não confundir
// presença atual com tempo acumulado.

async function obterResumoEquipeStatus(
    guild,
    config
) {
    const presenca =
        obterEquipeEmVoz(
            guild,
            config
        );

    let historico = null;

    try {
        historico =
            await obterResumoEquipe(
                guild
            );

    } catch (erro) {
        console.warn(
            '[InovareSale | Status] ' +
            'Histórico da equipe indisponível:',
            erro.message
        );
    }

    return {
        ...presenca,

        historico
    };
}

// ==========================================
// RESUMO DE CONVITES
// ==========================================

function obterResumoConvitesStatus(
    servidorId
) {
    try {
        const resultado =
            obterResumoConvites(
                servidorId
            );

        if (
            !resultado ||
            resultado.disponivel === false
        ) {
            return {
                disponivel: false,
                motivo:
                    resultado?.descricao ||
                    'Aguardando sincronização'
            };
        }

        return {
            disponivel: true,

            confirmados:
                Number(
                    resultado.quantidade || 0
                ),

            linksAtivos:
                Number(
                    resultado.linksAtivos || 0
                ),

            naoIdentificados:
                Number(
                    resultado.naoIdentificados || 0
                )
        };

    } catch (erro) {
        console.error(
            '[InovareSale | Status] ' +
            'Erro ao consultar convites:',
            erro
        );

        return {
            disponivel: false,
            motivo:
                'Falha ao consultar convites'
        };
    }
}

// ==========================================
// RESUMO DE MODERAÇÃO
// ==========================================

function obterResumoModeracaoStatus(
    servidorId
) {
    try {
        const resultado =
            obterResumoModeracao(
                servidorId
            );

        if (!resultado?.disponivel) {
            return {
                disponivel: false,
                motivo:
                    'Moderação indisponível'
            };
        }

        return {
            disponivel: true,

            total:
                Number(
                    resultado.quantidade || 0
                ),

            bans:
                Number(
                    resultado.banimentos || 0
                ),

            warns:
                Number(
                    resultado.advertencias || 0
                ),

            warnsAtivas:
                Number(
                    resultado.advertenciasAtivas || 0
                ),

            timeouts:
                Number(
                    resultado.timeouts || 0
                ),

            acoesTotais:
                Number(
                    resultado.acoesTotais || 0
                )
        };

    } catch (erro) {
        console.error(
            '[InovareSale | Status] ' +
            'Erro ao consultar moderação:',
            erro
        );

        return {
            disponivel: false,
            motivo:
                'Falha ao consultar moderação'
        };
    }
}

// ==========================================
// SAÚDE DO SISTEMA
// ==========================================

// NORMAL:
// - Bot conectado
// - SQLite acessível
// - Métricas consultáveis
//
// ATENÇÃO:
// - Serviço secundário indisponível
// - Alguma configuração faltando
// - Latência elevada
//
// PROBLEMA:
// - Bot desconectado
// - Banco indisponível
// - Latência extremamente elevada
//
// Nenhum desses estados representa
// o status do site Roblox ou do
// processamento externo de pagamentos.

function obterSaudeSistema(
    client,
    {
        tickets = null,
        equipe = null,
        convites = null,
        moderacao = null
    } = {}
) {
    const problemas = [];
    const avisos = [];

    const conectado =
        Boolean(
            client?.isReady?.()
        );

    const bancoDisponivel =
        Boolean(
            db.open
        );

    const ping = Number(
        client?.ws?.ping
    );

    const pingValido =
        Number.isFinite(ping) &&
        ping >= 0;

    if (!conectado) {
        problemas.push(
            'Conexão com o Discord indisponível'
        );
    }

    if (!bancoDisponivel) {
        problemas.push(
            'Banco SQLite indisponível'
        );
    }

    if (
        pingValido &&
        ping >= 2000
    ) {
        problemas.push(
            'Latência crítica do Discord'
        );

    } else if (
        pingValido &&
        ping >= 1000
    ) {
        avisos.push(
            'Latência elevada do Discord'
        );
    }

    if (
        tickets &&
        !tickets.disponivel
    ) {
        avisos.push(
            'Estatísticas de tickets indisponíveis'
        );
    }

    if (
        equipe &&
        !equipe.disponivel
    ) {
        avisos.push(
            equipe.motivo ||
            'Equipe em voz indisponível'
        );
    }

    if (
        convites &&
        !convites.disponivel
    ) {
        avisos.push(
            'Convites ainda não disponíveis'
        );
    }

    if (
        moderacao &&
        !moderacao.disponivel
    ) {
        avisos.push(
            'Estatísticas de moderação indisponíveis'
        );
    }

    let estado = ESTADOS.NORMAL;

    if (problemas.length) {
        estado = ESTADOS.PROBLEMA;

    } else if (avisos.length) {
        estado = ESTADOS.ATENCAO;
    }

    return {
        estado,

        cor:
            estado === ESTADOS.NORMAL
                ? CORES.NORMAL
                : estado === ESTADOS.ATENCAO
                    ? CORES.ATENCAO
                    : CORES.PROBLEMA,

        icone:
            estado === ESTADOS.NORMAL
                ? '🟢'
                : estado === ESTADOS.ATENCAO
                    ? '🟡'
                    : '🔴',

        descricao:
            estado === ESTADOS.NORMAL
                ? 'Funcionamento normal'
                : estado === ESTADOS.ATENCAO
                    ? 'Alguns dados precisam de atenção'
                    : 'Problema detectado',

        conectado,
        bancoDisponivel,

        ping:
            pingValido
                ? Math.round(ping)
                : null,

        problemas,
        avisos
    };
}

// ==========================================
// COLETAR DADOS DO PAINEL
// ==========================================

async function obterDadosStatus(
    guild,
    client = guild?.client
) {
    if (!guild?.id) {
        throw new Error(
            'Servidor inválido para o painel.'
        );
    }

    const {
        config
    } = carregarConfigStatus();

    const tickets =
        obterResumoTicketsStatus(
            guild.id
        );

    const equipe =
        await obterResumoEquipeStatus(
            guild,
            config
        );

    const convites =
        obterResumoConvitesStatus(
            guild.id
        );

    const moderacao =
        obterResumoModeracaoStatus(
            guild.id
        );

    const saude =
        obterSaudeSistema(
            client,
            {
                tickets,
                equipe,
                convites,
                moderacao
            }
        );

    const uptimeMilissegundos =
        Number(
            client?.uptime || 0
        );

    const uptimeSegundos =
        Math.max(
            0,
            Math.floor(
                uptimeMilissegundos / 1000
            )
        );

    return {
        servidorId:
            guild.id,

        nomeServidor:
            guild.name,

        tickets,
        equipe,
        convites,
        moderacao,
        saude,

        uptimeSegundos,

        atualizadoEm:
            Date.now()
    };
}

// ==========================================
// TEXTO DOS TICKETS
// ==========================================

function criarTextoTickets(
    tickets
) {
    if (!tickets.disponivel) {
        return (
            '⚪ Estatísticas indisponíveis'
        );
    }

    return [
        `📨 **Pedidos ativos:** ${
            formatarNumero(
                tickets.ativos
            )
        }`,

        `🆕 Em criação: ${
            formatarNumero(
                tickets.criando
            )
        }`,

        `📂 Abertos: ${
            formatarNumero(
                tickets.abertos
            )
        }`,

        `👤 Em atendimento: ${
            formatarNumero(
                tickets.emAtendimento
            )
        }`,

        `⏳ Finalizando: ${
            formatarNumero(
                tickets.finalizando
            )
        }`,

        `✅ Finalizados: ${
            formatarNumero(
                tickets.finalizados
            )
        }`,

        `❌ Cancelados: ${
            formatarNumero(
                tickets.cancelados
            )
        }`
    ].join('\n');
}

// ==========================================
// TEXTO DA EQUIPE
// ==========================================

function criarTextoEquipe(
    equipe
) {
    if (!equipe.configurado) {
        return (
            '⚪ Cargo da equipe não configurado'
        );
    }

    const linhas = [];

    if (
        equipe.disponivel ||
        equipe.parcial
    ) {
        linhas.push(
            `🎙️ **Funcionários em call:** ${
                formatarNumero(
                    equipe.quantidade
                )
            }${
                equipe.parcial
                    ? ' (contagem parcial)'
                    : ''
            }`
        );
    } else {
        linhas.push(
            '🎙️ **Funcionários em call:** ' +
            'Indisponível'
        );
    }

    const historico =
        equipe.historico;

    if (
        historico &&
        typeof historico === 'object'
    ) {
        const segundos =
            historico.tempoTotalSegundos ??
            historico.segundosTotais ??
            historico.tempoTotalVozSegundos;

        if (
            segundos !== null &&
            segundos !== undefined &&
            Number.isFinite(
                Number(segundos)
            )
        ) {
            linhas.push(
                `⏱️ Tempo registrado: ${
                    formatarDuracao(
                        segundos
                    )
                }`
            );
        }
    }

    return linhas.join('\n');
}

// ==========================================
// TEXTO DOS CONVITES
// ==========================================

function criarTextoConvites(
    convites
) {
    if (!convites.disponivel) {
        return (
            '⚪ Aguardando dados de convites'
        );
    }

    return [
        `🔗 **Convites confirmados:** ${
            formatarNumero(
                convites.confirmados
            )
        }`,

        `👥 Entradas sem identificação: ${
            formatarNumero(
                convites.naoIdentificados
            )
        }`,

        `📨 Links ativos: ${
            formatarNumero(
                convites.linksAtivos
            )
        }`
    ].join('\n');
}

// ==========================================
// TEXTO DA MODERAÇÃO
// ==========================================

function criarTextoModeracao(
    moderacao
) {
    if (!moderacao.disponivel) {
        return (
            '⚪ Estatísticas indisponíveis'
        );
    }

    return [
        `🔨 **Banimentos:** ${
            formatarNumero(
                moderacao.bans
            )
        }`,

        `⚠️ Advertências aplicadas: ${
            formatarNumero(
                moderacao.warns
            )
        }`,

        `🟡 Advertências ativas: ${
            formatarNumero(
                moderacao.warnsAtivas
            )
        }`,

        `🔇 Timeouts aplicados: ${
            formatarNumero(
                moderacao.timeouts
            )
        }`
    ].join('\n');
}

// ==========================================
// CRIAR EMBED DE STATUS
// ==========================================

function criarEmbedStatus(
    dados
) {
    if (!dados?.saude) {
        throw new Error(
            'Dados do painel de status inválidos.'
        );
    }

    const saude =
        dados.saude;

    const ping =
        saude.ping === null
            ? 'Indisponível'
            : `${saude.ping} ms`;

    const uptime =
        formatarDuracao(
            dados.uptimeSegundos
        );

    const titulo =
        `${saude.icone} INOVARESALE | STATUS`;

    const embed =
        new EmbedBuilder()
            .setColor(
                saude.cor
            )
            .setTitle(
                titulo
            )
            .setDescription(
                [
                    '**Monitoramento automático do servidor**',
                    '',
                    `**Situação:** ${saude.descricao}`,
                    '',
                    'As informações abaixo são consultadas ' +
                    'nos serviços do bot e no Discord.'
                ].join('\n')
            )
            .addFields(
                {
                    name: '🤖 SISTEMA',
                    value: [
                        `**Bot:** ${
                            saude.conectado
                                ? 'Online'
                                : 'Offline'
                        }`,

                        `**SQLite:** ${
                            saude.bancoDisponivel
                                ? 'Disponível'
                                : 'Indisponível'
                        }`,

                        `**Ping:** ${ping}`,

                        `**Tempo online:** ${uptime}`
                    ].join('\n'),

                    inline: false
                },

                {
                    name: '🛒 PEDIDOS E TICKETS',
                    value:
                        limitarTexto(
                            criarTextoTickets(
                                dados.tickets
                            )
                        ),

                    inline: false
                },

                {
                    name: '🎙️ EQUIPE EM VOZ',
                    value:
                        limitarTexto(
                            criarTextoEquipe(
                                dados.equipe
                            )
                        ),

                    inline: false
                },

                {
                    name: '🔗 CONVITES',
                    value:
                        limitarTexto(
                            criarTextoConvites(
                                dados.convites
                            )
                        ),

                    inline: false
                },

                {
                    name: '🛡️ MODERAÇÃO',
                    value:
                        limitarTexto(
                            criarTextoModeracao(
                                dados.moderacao
                            )
                        ),

                    inline: false
                }
            )
            .setFooter({
                text:
                    `InovareSale Bot ${VERSAO} • ` +
                    'Atualização a cada 60 minutos'
            })
            .setTimestamp(
                new Date(
                    dados.atualizadoEm
                )
            );

    // ======================================
    // AVISOS OU PROBLEMAS
    // ======================================

    const observacoes = [
        ...saude.problemas,
        ...saude.avisos
    ];

    if (observacoes.length) {
        embed.addFields({
            name: '📋 OBSERVAÇÕES',

            value:
                limitarTexto(
                    observacoes
                        .slice(0, 6)
                        .map(item =>
                            `• ${item}`
                        )
                        .join('\n')
                ),

            inline: false
        });
    }

    return embed;
}

// ==========================================
// OBTER CANAL DO STATUS
// ==========================================

async function obterCanalStatus(
    guild,
    config = null
) {
    if (!guild?.id) {
        return null;
    }

    const configuracao =
        config || getConfig();

    const canalId = idValido(
        configuracao.status?.canalId
    );

    if (!canalId) {
        return null;
    }

    let canal =
        guild.channels.cache.get(
            canalId
        );

    if (!canal) {
        try {
            canal =
                await guild.channels.fetch(
                    canalId
                );

        } catch (erro) {
            console.warn(
                '[InovareSale | Status] ' +
                'Não foi possível consultar o canal:',
                erro.message
            );

            return null;
        }
    }

    if (
        !canal ||
        !canal.isTextBased?.() ||
        typeof canal.send !== 'function'
    ) {
        return null;
    }

    return canal;
}

// ==========================================
// BUSCAR MENSAGEM EXISTENTE
// ==========================================

// Só cria outra mensagem quando o
// Discord confirma que a anterior
// não existe mais.
//
// Se houver erro de permissão ou
// de conexão, não tentamos criar
// outra mensagem, evitando spam.

async function buscarMensagemStatus(
    canal,
    mensagemId
) {
    const id =
        idValido(mensagemId);

    if (!id) {
        return null;
    }

    try {
        return await canal.messages.fetch(
            id
        );

    } catch (erro) {
        // 10008 = Unknown Message.
        //
        // A mensagem realmente
        // não existe mais.

        if (
            erro.code === 10008
        ) {
            return null;
        }

        // Outros erros podem ser
        // problemas temporários.
        //
        // Não publicamos outra
        // mensagem nesses casos.

        throw erro;
    }
}

// ==========================================
// ATUALIZAR CONFIGURAÇÃO DA MENSAGEM
// ==========================================

// Recarrega a configuração imediatamente
// antes de salvar para não sobrescrever
// alterações feitas em outros menus.
//
// Não altera config.calculadora,
// config.tickets, config.vendas,
// config.estoque nem o histórico.

function salvarReferenciaStatus(
    guildId,
    canalId,
    mensagemId
) {
    const config = getConfig();

    config.status ??= {};

    config.status.canalId =
        canalId;

    config.status.mensagemId =
        mensagemId;

    config.status.mensagemCanalId =
        canalId;

    config.status.ultimaAtualizacaoEm =
        new Date().toISOString();

    saveConfig(config);

    return {
        guildId,
        canalId,
        mensagemId
    };
}

// ==========================================
// ATUALIZAR PAINEL DE UM SERVIDOR
// ==========================================

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

    // ======================================
    // IMPEDIR ATUALIZAÇÕES SIMULTÂNEAS
    // ======================================

    if (
        SERVIDORES_ATUALIZANDO.has(
            guild.id
        )
    ) {
        return {
            atualizado: false,
            ocupado: true,
            motivo:
                'Atualização já em andamento'
        };
    }

    SERVIDORES_ATUALIZANDO.add(
        guild.id
    );

    try {
        // ==================================
        // CARREGAR CONFIGURAÇÃO
        // ==================================

        const config =
            getConfig();

        const statusConfig =
            config.status || {};

        const canalId =
            idValido(
                statusConfig.canalId
            );

        if (!canalId) {
            return {
                atualizado: false,
                configurado: false,
                motivo:
                    'Canal de status não configurado'
            };
        }

        // ==================================
        // BUSCAR CANAL
        // ==================================

        const canal =
            await obterCanalStatus(
                guild,
                config
            );

        if (!canal) {
            return {
                atualizado: false,
                configurado: true,
                motivo:
                    'Canal de status indisponível'
            };
        }

        // ==================================
        // COLETAR DADOS REAIS
        // ==================================

        const dados =
            await obterDadosStatus(
                guild,
                client
            );

        const embed =
            criarEmbedStatus(
                dados
            );

        const payload = {
            embeds: [embed],

            allowedMentions: {
                parse: []
            }
        };

        // ==================================
        // LOCALIZAR MENSAGEM ANTERIOR
        // ==================================

        const mensagemId =
            idValido(
                statusConfig.mensagemId
            );

        const canalAnteriorId =
            idValido(
                statusConfig.mensagemCanalId
            );

        const mesmaLocalizacao =
            !canalAnteriorId ||
            canalAnteriorId === canal.id;

        let mensagem = null;

        if (
            mensagemId &&
            mesmaLocalizacao
        ) {
            mensagem =
                await buscarMensagemStatus(
                    canal,
                    mensagemId
                );
        }

        // ==================================
        // EDITAR A MENSAGEM EXISTENTE
        // ==================================

        if (mensagem) {
            await mensagem.edit(
                payload
            );

            RESULTADOS.set(
                guild.id,
                {
                    atualizadoEm:
                        Date.now(),

                    mensagemId:
                        mensagem.id,

                    canalId:
                        canal.id,

                    estado:
                        dados.saude.estado,

                    criado: false
                }
            );

            return {
                atualizado: true,
                criado: false,
                sucesso: true,

                mensagemId:
                    mensagem.id,

                canalId:
                    canal.id,

                estado:
                    dados.saude.estado
            };
        }

        // ==================================
        // CRIAR PRIMEIRA MENSAGEM
        // ==================================

        // Só chegamos aqui se:
        //
        // - Ainda não havia ID salvo;
        // - O canal configurado mudou;
        // - Ou o Discord confirmou que
        //   a mensagem anterior foi apagada.

        const novaMensagem =
            await canal.send(
                payload
            );

        // ==================================
        // SALVAR ID NO SQLITE
        // ==================================

        salvarReferenciaStatus(
            guild.id,
            canal.id,
            novaMensagem.id
        );

        // ==================================
        // REMOVER PAINEL DO CANAL ANTIGO
        // ==================================

        // Se o administrador trocou o
        // canal de status, tentamos
        // remover a mensagem antiga.
        //
        // Uma falha nessa limpeza
        // não apaga a nova referência.

        if (
            mensagemId &&
            canalAnteriorId &&
            canalAnteriorId !== canal.id
        ) {
            try {
                const canalAnterior =
                    await guild.channels.fetch(
                        canalAnteriorId
                    );

                if (
                    canalAnterior?.messages?.fetch
                ) {
                    const mensagemAnterior =
                        await buscarMensagemStatus(
                            canalAnterior,
                            mensagemId
                        );

                    if (
                        mensagemAnterior &&
                        mensagemAnterior.author?.id ===
                        client.user?.id
                    ) {
                        await mensagemAnterior.delete();
                    }
                }

            } catch (erro) {
                console.warn(
                    '[InovareSale | Status] ' +
                    'Não foi possível remover o painel antigo:',
                    erro.message
                );
            }
        }

        RESULTADOS.set(
            guild.id,
            {
                atualizadoEm:
                    Date.now(),

                mensagemId:
                    novaMensagem.id,

                canalId:
                    canal.id,

                estado:
                    dados.saude.estado,

                criado: true
            }
        );

        return {
            atualizado: true,
            criado: true,
            sucesso: true,

            mensagemId:
                novaMensagem.id,

            canalId:
                canal.id,

            estado:
                dados.saude.estado
        };

    } catch (erro) {
        console.error(
            '[InovareSale | Status] ' +
            `Falha no servidor ${guild.id}:`,
            erro
        );

        return {
            atualizado: false,
            sucesso: false,
            motivo:
                erro.message
        };

    } finally {
        SERVIDORES_ATUALIZANDO.delete(
            guild.id
        );
    }
}

// ==========================================
// ATUALIZAR TODOS OS SERVIDORES
// ==========================================

async function atualizarTodosStatus(
    client
) {
    if (
        !client?.isReady?.()
    ) {
        return {
            atualizado: false,
            motivo:
                'Bot não conectado'
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

            if (
                resultado.atualizado
            ) {
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

// ==========================================
// INICIAR MONITORAMENTO AUTOMÁTICO
// ==========================================

// Chamado pelo index.js depois que
// o cliente Discord estiver pronto.
//
// Mantém apenas um intervalo ativo.
//
// Atualiza os painéis uma vez
// imediatamente e, depois,
// a cada 60 minutos.
//
// Não envia uma nova mensagem
// em toda atualização.

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

    clienteMonitorado =
        client;

    // ======================================
    // PRIMEIRA ATUALIZAÇÃO
    // ======================================

    atualizarTodosStatus(
        client
    ).catch(erro => {
        console.error(
            '[InovareSale | Status] ' +
            'Falha na atualização inicial:',
            erro
        );
    });

    // ======================================
    // ATUALIZAÇÃO POR HORA
    // ======================================

    timerStatus = setInterval(
        () => {
            atualizarTodosStatus(
                client
            ).catch(erro => {
                console.error(
                    '[InovareSale | Status] ' +
                    'Falha na atualização automática:',
                    erro
                );
            });
        },
        INTERVALO_ATUALIZACAO
    );

    timerStatus.unref?.();

    console.log(
        '[InovareSale | Status] ' +
        'Monitoramento iniciado: ' +
        '60 minutos.'
    );

    return true;
}

// ==========================================
// PARAR MONITORAMENTO
// ==========================================

function pararMonitoramentoStatus() {
    if (!timerStatus) {
        clienteMonitorado = null;

        return false;
    }

    clearInterval(
        timerStatus
    );

    timerStatus = null;

    clienteMonitorado = null;

    console.log(
        '[InovareSale | Status] ' +
        'Monitoramento interrompido.'
    );

    return true;
}

// ==========================================
// ESTATÍSTICAS DO MONITORAMENTO
// ==========================================

function obterEstatisticasStatus(
    servidorId = null
) {
    if (servidorId) {
        const registro =
            RESULTADOS.get(
                String(servidorId)
            );

        return {
            monitoramentoAtivo:
                Boolean(timerStatus),

            intervaloMinutos:
                INTERVALO_ATUALIZACAO / 60000,

            ultimaAtualizacao:
                registro?.atualizadoEm ||
                null,

            mensagemId:
                registro?.mensagemId ||
                null,

            canalId:
                registro?.canalId ||
                null,

            estado:
                registro?.estado ||
                null
        };
    }

    return {
        versao:
            VERSAO,

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

// ==========================================
// EXPORTAÇÕES
// ==========================================

module.exports = {
    VERSAO,
    INTERVALO_ATUALIZACAO,

    formatarDuracao,

    obterResumoTicketsStatus,
    obterEquipeEmVoz,
    obterSaudeSistema,
    obterDadosStatus,

    criarEmbedStatus,

    obterCanalStatus,

    atualizarStatusServidor,
    atualizarTodosStatus,

    iniciarMonitoramentoStatus,
    pararMonitoramentoStatus,

    obterEstatisticasStatus
};
