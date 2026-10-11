
'use strict';

// ==========================================
// INOVARESALE BOT 3.0
// ARQUIVO PRINCIPAL - INDEX.JS
// ==========================================
//
// Responsabilidades:
//
// - Iniciar o Discord
// - Carregar comandos
// - Carregar eventos
// - Verificar armazenamento SQLite
// - Sincronizar convites
// - Sincronizar funcionários em call
// - Atualizar sessões de voz
// - Iniciar monitoramento do status
// - Tratar erros
// - Encerrar o bot com segurança
//
// IMPORTANTE:
//
// NÃO executa migrações automáticas.
// NÃO cria histórico de vendas vazio.
// NÃO apaga configurações.
// NÃO registra comandos slash na API.
//
// A migração e o registro de comandos
// são etapas separadas.

// ==========================================
// VARIÁVEIS DE AMBIENTE
// ==========================================

require('dotenv').config();

// ==========================================
// IMPORTAÇÕES
// ==========================================

const fs = require('fs');
const path = require('path');

const {
    Client,
    Collection,
    Events,
    GatewayIntentBits
} = require('discord.js');

const {
    verificarArmazenamento
} = require('./utils/storage');

const {
    fecharBanco
} = require('./database/db');

// ==========================================
// CONFIGURAÇÕES
// ==========================================

const TOKEN = process.env.DISCORD_TOKEN;

const INTERVALO_VOZ_MS =
    5 * 60 * 1000;

// ==========================================
// CRIAR CLIENT DO DISCORD
// ==========================================

const client = new Client({
    intents: [
        // Servidores e comandos
        GatewayIntentBits.Guilds,

        // Entrada e saída de membros
        GatewayIntentBits.GuildMembers,

        // Mensagens nos servidores
        GatewayIntentBits.GuildMessages,

        // Conteúdo de mensagens
        GatewayIntentBits.MessageContent,

        // Equipe em canais de voz
        GatewayIntentBits.GuildVoiceStates,

        // Criação e exclusão de convites
        GatewayIntentBits.GuildInvites
    ],

    allowedMentions: {
        parse: []
    }
});

// ==========================================
// COLEÇÃO DE COMANDOS
// ==========================================

client.commands = new Collection();

// ==========================================
// CONTROLES INTERNOS
// ==========================================

let encerrando = false;

let inicializacaoConcluida = false;

let intervaloVoz = null;

let integracoes = null;

const sincronizacoesVoz =
    new Set();

// ==========================================
// VALIDAR ARQUIVOS .JS
// ==========================================

function listarArquivosJS(pasta) {
    if (!fs.existsSync(pasta)) {
        throw new Error(
            `Pasta não encontrada: ${pasta}`
        );
    }

    const arquivos =
        fs.readdirSync(pasta)
            .filter(arquivo =>
                arquivo.endsWith('.js')
            )
            .sort();

    return arquivos;
}

// ==========================================
// CARREGAR COMANDOS
// ==========================================

function carregarComandos() {
    const pasta =
        path.join(
            __dirname,
            'commands'
        );

    const arquivos =
        listarArquivosJS(pasta);

    client.commands.clear();

    for (const arquivo of arquivos) {
        const caminho =
            path.join(
                pasta,
                arquivo
            );

        const comando =
            require(caminho);

        if (
            !comando?.data ||
            typeof comando.data.toJSON !==
                'function' ||
            typeof comando.execute !==
                'function'
        ) {
            throw new Error(
                `Comando inválido: commands/${arquivo}. ` +
                'São necessários data e execute().'
            );
        }

        const dados =
            comando.data.toJSON();

        const nome =
            dados?.name;

        if (
            !nome ||
            typeof nome !== 'string'
        ) {
            throw new Error(
                `Nome inválido em commands/${arquivo}`
            );
        }

        if (
            client.commands.has(nome)
        ) {
            throw new Error(
                `Comando duplicado: /${nome}`
            );
        }

        client.commands.set(
            nome,
            comando
        );

        console.log(
            `[InovareSale] Comando carregado: /${nome}`
        );
    }

    console.log(
        `[InovareSale] Total de comandos: ` +
        client.commands.size
    );

    return client.commands.size;
}

// ==========================================
// CARREGAR EVENTOS
// ==========================================

function carregarEventos() {
    const pasta =
        path.join(
            __dirname,
            'events'
        );

    const arquivos =
        listarArquivosJS(pasta);

    let carregados = 0;

    for (const arquivo of arquivos) {
        const caminho =
            path.join(
                pasta,
                arquivo
            );

        const evento =
            require(caminho);

        if (
            !evento?.name ||
            typeof evento.execute !==
                'function'
        ) {
            throw new Error(
                `Evento inválido: events/${arquivo}. ` +
                'São necessários name e execute().'
            );
        }

        // ==================================
        // EXECUTAR EVENTO COM PROTEÇÃO
        // ==================================

        const executar =
            async (...args) => {
                try {
                    await evento.execute(
                        ...args,
                        client
                    );

                } catch (erro) {
                    console.error(
                        '[InovareSale] ' +
                        `Erro no evento ${evento.name} ` +
                        `(${arquivo}):`,
                        erro
                    );
                }
            };

        // ==================================
        // ON OU ONCE
        // ==================================

        if (evento.once) {
            client.once(
                evento.name,
                executar
            );

        } else {
            client.on(
                evento.name,
                executar
            );
        }

        carregados++;

        console.log(
            `[InovareSale] Evento carregado: ` +
            `${evento.name} (${arquivo})`
        );
    }

    console.log(
        `[InovareSale] Total de eventos: ` +
        carregados
    );

    return carregados;
}

// ==========================================
// CARREGAR INTEGRAÇÕES
// ==========================================

// Utiliza os serviços da versão 3.0.
//
// Mantém a inicialização centralizada.
//
// Se um serviço obrigatório estiver
// ausente ou inválido, o erro será
// apresentado no console.
//
// Não ignoramos falhas silenciosamente
// durante o carregamento.

function carregarIntegracoes() {
    const convites =
        require('./services/convitesService');

    const staff =
        require('./services/staffService');

    const status =
        require('./services/statusService');

    const obrigatorias = [
        [
            'sincronizarConvitesGuild',
            convites.sincronizarConvitesGuild
        ],
        [
            'sincronizarEquipeEmVoz',
            staff.sincronizarEquipeEmVoz
        ],
        [
            'iniciarMonitoramentoStatus',
            status.iniciarMonitoramentoStatus
        ],
        [
            'pararMonitoramentoStatus',
            status.pararMonitoramentoStatus
        ]
    ];

    for (
        const [nome, funcao]
        of obrigatorias
    ) {
        if (
            typeof funcao !== 'function'
        ) {
            throw new Error(
                `Integração obrigatória ausente: ${nome}`
            );
        }
    }

    return {
        sincronizarConvitesGuild:
            convites.sincronizarConvitesGuild,

        sincronizarEquipeEmVoz:
            staff.sincronizarEquipeEmVoz,

        iniciarMonitoramentoStatus:
            status.iniciarMonitoramentoStatus,

        pararMonitoramentoStatus:
            status.pararMonitoramentoStatus
    };
}

// ==========================================
// SINCRONIZAR CONVITES DE UM SERVIDOR
// ==========================================

async function sincronizarConvites(
    guild
) {
    if (
        !guild ||
        !integracoes ||
        encerrando
    ) {
        return false;
    }

    try {
        await integracoes
            .sincronizarConvitesGuild(
                guild
            );

        console.log(
            '[InovareSale | Convites] ' +
            `Servidor sincronizado: ${guild.id}`
        );

        return true;

    } catch (erro) {
        // O serviço de convites deve
        // invalidar sua base quando
        // não consegue consultar o
        // Discord corretamente.
        //
        // Não assumimos que zero links
        // significa ausência real
        // de convites.

        console.warn(
            '[InovareSale | Convites] ' +
            `Falha no servidor ${guild.id}:`,
            erro.message
        );

        return false;
    }
}

// ==========================================
// SINCRONIZAR EQUIPE EM VOZ
// ==========================================

async function sincronizarVoz(
    guild
) {
    if (
        !guild ||
        !integracoes ||
        encerrando
    ) {
        return false;
    }

    // Não executar a mesma sincronização
    // simultaneamente no mesmo servidor.

    if (
        sincronizacoesVoz.has(
            guild.id
        )
    ) {
        return false;
    }

    sincronizacoesVoz.add(
        guild.id
    );

    try {
        await integracoes
            .sincronizarEquipeEmVoz(
                guild
            );

        return true;

    } catch (erro) {
        console.error(
            '[InovareSale | Staff] ' +
            `Erro ao sincronizar voz em ${guild.id}:`,
            erro
        );

        return false;

    } finally {
        sincronizacoesVoz.delete(
            guild.id
        );
    }
}

// ==========================================
// SINCRONIZAR UM SERVIDOR
// ==========================================

async function sincronizarServidor(
    guild
) {
    if (
        !guild ||
        encerrando
    ) {
        return;
    }

    console.log(
        '[InovareSale] ' +
        `Preparando servidor: ${guild.name} (${guild.id})`
    );

    // Convites e voz são independentes.
    //
    // Se um serviço falhar,
    // o outro ainda poderá sincronizar.

    await Promise.allSettled([
        sincronizarConvites(guild),
        sincronizarVoz(guild)
    ]);
}

// ==========================================
// SINCRONIZAÇÃO INICIAL
// ==========================================

async function sincronizarServidores() {
    const servidores =
        Array.from(
            client.guilds.cache.values()
        );

    console.log(
        '[InovareSale] ' +
        `Iniciando sincronização de ` +
        `${servidores.length} servidor(es).`
    );

    // Executamos por servidor para
    // evitar muitas consultas
    // simultâneas à API do Discord.

    for (const guild of servidores) {
        if (encerrando) {
            return;
        }

        await sincronizarServidor(
            guild
        );
    }
}

// ==========================================
// ATUALIZAÇÃO PERIÓDICA DA EQUIPE
// ==========================================

// Atualiza as observações das sessões
// de voz a cada cinco minutos.
//
// O staffService.js é responsável por
// contabilizar as sessões no SQLite.
//
// Não calculamos tempo em call
// dentro do index.js.

function iniciarSincronizacaoVoz() {
    if (intervaloVoz) {
        return;
    }

    intervaloVoz = setInterval(
        async () => {
            if (
                encerrando ||
                !client.isReady()
            ) {
                return;
            }

            for (
                const guild
                of client.guilds.cache.values()
            ) {
                if (encerrando) {
                    break;
                }

                await sincronizarVoz(
                    guild
                );
            }
        },

        INTERVALO_VOZ_MS
    );

    intervaloVoz.unref?.();

    console.log(
        '[InovareSale | Staff] ' +
        'Atualização de voz ativada ' +
        '(intervalo de 5 minutos).'
    );
}

// ==========================================
// INICIAR SISTEMA DE STATUS
// ==========================================

async function iniciarStatusAutomatico() {
    if (
        !integracoes ||
        encerrando
    ) {
        return;
    }

    try {
        await integracoes
            .iniciarMonitoramentoStatus(
                client
            );

        console.log(
            '[InovareSale | Status] ' +
            'Monitoramento iniciado.'
        );

    } catch (erro) {
        console.error(
            '[InovareSale | Status] ' +
            'Falha ao iniciar monitoramento:',
            erro
        );
    }
}

// ==========================================
// EVENTO READY
// ==========================================

client.once(
    Events.ClientReady,

    async bot => {
        console.log('');
        console.log(
            '===================================='
        );
        console.log(
            '💜 INOVARESALE BOT 3.0 ONLINE'
        );
        console.log(
            '===================================='
        );

        console.log(
            `Conta: ${bot.user.tag}`
        );

        console.log(
            `ID: ${bot.user.id}`
        );

        console.log(
            `Servidores: ${bot.guilds.cache.size}`
        );

        console.log(
            `Comandos carregados: ${bot.commands.size}`
        );

        console.log(
            '===================================='
        );
        console.log('');

        try {
            // ==================================
            // SINCRONIZAR ESTADO INICIAL
            // ==================================

            await sincronizarServidores();

            // ==================================
            // INICIAR MONITORAMENTO DE VOZ
            // ==================================

            iniciarSincronizacaoVoz();

            // ==================================
            // INICIAR STATUS AUTOMÁTICO
            // ==================================

            await iniciarStatusAutomatico();

            inicializacaoConcluida = true;

            console.log(
                '[InovareSale] ' +
                'Inicialização dos serviços concluída.'
            );

        } catch (erro) {
            console.error(
                '[InovareSale] ' +
                'Falha na inicialização dos serviços:',
                erro
            );
        }
    }
);

// ==========================================
// NOVOS SERVIDORES
// ==========================================

// Se o bot for adicionado a um
// servidor depois de iniciado,
// sincronizamos as referências.
//
// Não cria configuração nem
// histórico novo automaticamente.

client.on(
    Events.GuildCreate,

    async guild => {
        if (
            encerrando ||
            !inicializacaoConcluida
        ) {
            return;
        }

        try {
            await sincronizarServidor(
                guild
            );

        } catch (erro) {
            console.error(
                '[InovareSale] ' +
                'Erro ao preparar novo servidor:',
                erro
            );
        }
    }
);

// ==========================================
// ERROS DO DISCORD
// ==========================================

client.on(
    Events.Error,

    erro => {
        console.error(
            '[InovareSale | Discord] Erro:',
            erro
        );
    }
);

client.on(
    Events.Warn,

    aviso => {
        console.warn(
            '[InovareSale | Discord] Aviso:',
            aviso
        );
    }
);

// ==========================================
// PROMISES NÃO TRATADAS
// ==========================================

process.on(
    'unhandledRejection',

    erro => {
        console.error(
            '[InovareSale] Promise rejeitada:',
            erro
        );
    }
);

// ==========================================
// ENCERRAMENTO SEGURO
// ==========================================

function encerrarBot(
    sinal,
    codigo = 0
) {
    if (encerrando) {
        return;
    }

    encerrando = true;

    console.log(
        `[InovareSale] Encerrando: ${sinal}`
    );

    // ======================================
    // PARAR ATUALIZAÇÃO DE VOZ
    // ======================================

    if (intervaloVoz) {
        clearInterval(
            intervaloVoz
        );

        intervaloVoz = null;
    }

    // ======================================
    // PARAR MONITORAMENTO DE STATUS
    // ======================================

    if (
        integracoes?.pararMonitoramentoStatus
    ) {
        try {
            integracoes
                .pararMonitoramentoStatus();

        } catch (erro) {
            console.error(
                '[InovareSale] ' +
                'Falha ao parar status:',
                erro
            );
        }
    }

    // ======================================
    // DESCONECTAR DISCORD
    // ======================================

    try {
        client.destroy();

    } catch (erro) {
        console.error(
            '[InovareSale] ' +
            'Falha ao desconectar Discord:',
            erro
        );
    }

    // ======================================
    // FECHAR SQLITE
    // ======================================

    try {
        fecharBanco();

    } catch (erro) {
        console.error(
            '[InovareSale] ' +
            'Falha ao fechar banco:',
            erro
        );

        codigo = 1;
    }

    process.exit(
        codigo
    );
}

// ==========================================
// SINAIS DE ENCERRAMENTO
// ==========================================

process.once(
    'SIGINT',

    () => encerrarBot(
        'SIGINT'
    )
);

process.once(
    'SIGTERM',

    () => encerrarBot(
        'SIGTERM'
    )
);

// ==========================================
// INICIAR BOT
// ==========================================

async function iniciar() {
    // ======================================
    // VALIDAR TOKEN
    // ======================================

    if (!TOKEN) {
        throw new Error(
            'DISCORD_TOKEN não configurado ' +
            'no .env ou nas variáveis da Railway.'
        );
    }

    // ======================================
    // VERIFICAR HISTÓRICO SQLITE
    // ======================================

    // Essa função EXIGE a presença
    // das chaves "config" e "sales".
    //
    // Se a migração ainda não tiver
    // sido concluída, a inicialização
    // será interrompida.
    //
    // Nunca cria um histórico
    // financeiro vazio.

    verificarArmazenamento();

    console.log(
        '[InovareSale] ' +
        'Configurações e histórico SQLite verificados.'
    );

    // ======================================
    // CARREGAR COMANDOS
    // ======================================

    carregarComandos();

    // ======================================
    // CARREGAR EVENTOS
    // ======================================

    carregarEventos();

    // ======================================
    // CARREGAR SERVIÇOS
    // ======================================

    integracoes =
        carregarIntegracoes();

    // ======================================
    // CONECTAR AO DISCORD
    // ======================================

    console.log(
        '[InovareSale] Conectando ao Discord...'
    );

    await client.login(
        TOKEN
    );
}

// ==========================================
// TRATAR FALHA NA INICIALIZAÇÃO
// ==========================================

iniciar().catch(
    erro => {
        console.error(
            '[InovareSale] ' +
            'Não foi possível iniciar o Bot 3.0:',
            erro
        );

        encerrarBot(
            'FALHA_NA_INICIALIZACAO',
            1
        );
    }
);
