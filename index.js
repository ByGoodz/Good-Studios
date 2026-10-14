
'use strict';

require('dotenv').config();

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

const TOKEN = process.env.DISCORD_TOKEN;

const INTERVALO_VOZ_MS = 5 * 60 * 1000;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildInvites
    ],
    allowedMentions: {
        parse: []
    }
});

client.commands = new Collection();

let encerrando = false;
let inicializacaoConcluida = false;
let intervaloVoz = null;
let integracoes = null;

const sincronizacoesVoz = new Set();

function listarArquivosJS(pasta) {
    if (!fs.existsSync(pasta)) {
        throw new Error(
            `Pasta não encontrada: ${pasta}`
        );
    }

    return fs.readdirSync(pasta)
        .filter(arquivo => arquivo.endsWith('.js'))
        .sort();
}

function carregarComandos() {
    const pasta = path.join(__dirname, 'commands');
    const arquivos = listarArquivosJS(pasta);

    client.commands.clear();

    for (const arquivo of arquivos) {
        const caminho = path.join(pasta, arquivo);
        const comando = require(caminho);

        if (
            !comando?.data ||
            typeof comando.data.toJSON !== 'function' ||
            typeof comando.execute !== 'function'
        ) {
            throw new Error(
                `Comando inválido: commands/${arquivo}. ` +
                'São necessários data e execute().'
            );
        }

        const dados = comando.data.toJSON();
        const nome = dados?.name;

        if (!nome || typeof nome !== 'string') {
            throw new Error(
                `Nome inválido em commands/${arquivo}`
            );
        }

        if (client.commands.has(nome)) {
            throw new Error(
                `Comando duplicado: /${nome}`
            );
        }

        client.commands.set(nome, comando);

        console.log(
            `[InovareSale] Comando carregado: /${nome}`
        );
    }

    console.log(
        `[InovareSale] Total de comandos: ${client.commands.size}`
    );

    return client.commands.size;
}

function carregarEventos() {
    const pasta = path.join(__dirname, 'events');
    const arquivos = listarArquivosJS(pasta);

    let carregados = 0;

    for (const arquivo of arquivos) {
        const caminho = path.join(pasta, arquivo);
        const evento = require(caminho);

        if (
            !evento?.name ||
            typeof evento.execute !== 'function'
        ) {
            throw new Error(
                `Evento inválido: events/${arquivo}. ` +
                'São necessários name e execute().'
            );
        }

        const executar = async (...args) => {
            try {
                await evento.execute(...args, client);
            } catch (erro) {
                console.error(
                    '[InovareSale] ' +
                    `Erro no evento ${evento.name} (${arquivo}):`,
                    erro
                );
            }
        };

        if (evento.once) {
            client.once(evento.name, executar);
        } else {
            client.on(evento.name, executar);
        }

        carregados++;

        console.log(
            `[InovareSale] Evento carregado: ` +
            `${evento.name} (${arquivo})`
        );
    }

    console.log(
        `[InovareSale] Total de eventos: ${carregados}`
    );

    return carregados;
}

function carregarIntegracoes() {
    const convites = require('./services/convitesService');
    const staff = require('./services/staffService');
    const status = require('./services/statusService');

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

    for (const [nome, funcao] of obrigatorias) {
        if (typeof funcao !== 'function') {
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

async function sincronizarConvites(guild) {
    if (!guild || !integracoes || encerrando) {
        return false;
    }

    try {
        await integracoes.sincronizarConvitesGuild(guild);

        console.log(
            '[InovareSale | Convites] ' +
            `Servidor sincronizado: ${guild.id}`
        );

        return true;
    } catch (erro) {
        console.warn(
            '[InovareSale | Convites] ' +
            `Falha no servidor ${guild.id}:`,
            erro.message
        );

        return false;
    }
}

async function sincronizarVoz(guild) {
    if (!guild || !integracoes || encerrando) {
        return false;
    }

    if (sincronizacoesVoz.has(guild.id)) {
        return false;
    }

    sincronizacoesVoz.add(guild.id);

    try {
        await integracoes.sincronizarEquipeEmVoz(guild);
        return true;
    } catch (erro) {
        console.error(
            '[InovareSale | Staff] ' +
            `Erro ao sincronizar voz em ${guild.id}:`,
            erro
        );

        return false;
    } finally {
        sincronizacoesVoz.delete(guild.id);
    }
}

async function sincronizarServidor(guild) {
    if (!guild || encerrando) {
        return;
    }

    console.log(
        '[InovareSale] ' +
        `Preparando servidor: ${guild.name} (${guild.id})`
    );

    await Promise.allSettled([
        sincronizarConvites(guild),
        sincronizarVoz(guild)
    ]);
}

async function sincronizarServidores() {
    const servidores = Array.from(
        client.guilds.cache.values()
    );

    console.log(
        '[InovareSale] ' +
        `Iniciando sincronização de ${servidores.length} servidor(es).`
    );

    for (const guild of servidores) {
        if (encerrando) {
            return;
        }

        await sincronizarServidor(guild);
    }
}

function iniciarSincronizacaoVoz() {
    if (intervaloVoz) {
        return;
    }

    intervaloVoz = setInterval(
        async () => {
            if (encerrando || !client.isReady()) {
                return;
            }

            for (const guild of client.guilds.cache.values()) {
                if (encerrando) {
                    break;
                }

                await sincronizarVoz(guild);
            }
        },
        INTERVALO_VOZ_MS
    );

    intervaloVoz.unref?.();

    console.log(
        '[InovareSale | Staff] ' +
        'Atualização de voz ativada (intervalo de 5 minutos).'
    );
}

async function iniciarStatusAutomatico() {
    if (!integracoes || encerrando) {
        return;
    }

    try {
        await integracoes.iniciarMonitoramentoStatus(client);

        console.log(
            '[InovareSale | Status] Monitoramento iniciado.'
        );
    } catch (erro) {
        console.error(
            '[InovareSale | Status] ' +
            'Falha ao iniciar monitoramento:',
            erro
        );
    }
}

client.once(
    Events.ClientReady,
    async bot => {
        console.log('');
        console.log('====================================');
        console.log('💜 INOVARESALE BOT 3.1 ONLINE');
        console.log('====================================');
        console.log(`Conta: ${bot.user.tag}`);
        console.log(`ID: ${bot.user.id}`);
        console.log(
            `Servidores: ${bot.guilds.cache.size}`
        );
        console.log(
            `Comandos carregados: ${bot.commands.size}`
        );
        console.log('====================================');
        console.log('');

        try {
            await sincronizarServidores();

            iniciarSincronizacaoVoz();

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

client.on(
    Events.GuildCreate,
    async guild => {
        if (encerrando || !inicializacaoConcluida) {
            return;
        }

        try {
            await sincronizarServidor(guild);
        } catch (erro) {
            console.error(
                '[InovareSale] ' +
                'Erro ao preparar novo servidor:',
                erro
            );
        }
    }
);

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

process.on(
    'unhandledRejection',
    erro => {
        console.error(
            '[InovareSale] Promise rejeitada:',
            erro
        );
    }
);

function encerrarBot(sinal, codigo = 0) {
    if (encerrando) {
        return;
    }

    encerrando = true;

    console.log(
        `[InovareSale] Encerrando: ${sinal}`
    );

    if (intervaloVoz) {
        clearInterval(intervaloVoz);
        intervaloVoz = null;
    }

    if (integracoes?.pararMonitoramentoStatus) {
        try {
            integracoes.pararMonitoramentoStatus();
        } catch (erro) {
            console.error(
                '[InovareSale] Falha ao parar status:',
                erro
            );
        }
    }

    try {
        client.destroy();
    } catch (erro) {
        console.error(
            '[InovareSale] ' +
            'Falha ao desconectar Discord:',
            erro
        );
    }

    try {
        fecharBanco();
    } catch (erro) {
        console.error(
            '[InovareSale] Falha ao fechar banco:',
            erro
        );

        codigo = 1;
    }

    process.exit(codigo);
}

process.once(
    'SIGINT',
    () => encerrarBot('SIGINT')
);

process.once(
    'SIGTERM',
    () => encerrarBot('SIGTERM')
);

async function iniciar() {
    if (!TOKEN) {
        throw new Error(
            'DISCORD_TOKEN não configurado ' +
            'no .env ou nas variáveis da Railway.'
        );
    }

    verificarArmazenamento();

    console.log(
        '[InovareSale] ' +
        'Configurações e histórico SQLite verificados.'
    );

    carregarComandos();
    carregarEventos();

    integracoes = carregarIntegracoes();

    console.log(
        '[InovareSale] Conectando ao Discord...'
    );

    await client.login(TOKEN);
}

iniciar().catch(
    erro => {
        console.error(
            '[InovareSale] ' +
            'Não foi possível iniciar o Bot 3.1:',
            erro
        );

        encerrarBot(
            'FALHA_NA_INICIALIZACAO',
            1
        );
    }
);
