
'use strict';

const {
    Events
} = require('discord.js');

// ==========================================
// INOVARESALE BOT 3.0
// EVENTO: CONVITE CRIADO
// ==========================================

// Responsabilidades:
//
// - Detectar novos convites do Discord
// - Identificar o servidor
// - Identificar o criador do convite
// - Registrar o código no SQLite
// - Armazenar canal e número de usos
// - Registrar a criação no sistema de logs
// - Evitar duplicação dos logs
//
// IMPORTANTE:
//
// Criar um convite NÃO significa
// que alguém entrou no servidor.
//
// Este evento só registra a criação.
//
// Quem registra entradas de membros é:
// events/guildMemberAdd.js
//
// Quem compara os usos dos convites é:
// services/convitesService.js

// ==========================================
// IMPORTAR SERVIÇO DE CONVITES
// ==========================================

const {
    registrarConviteCriado
} = require('../services/convitesService');

// ==========================================
// IMPORTAR SERVIÇO DE LOGS
// ==========================================

const {
    registrarLogSistema,
    TIPOS_LOG
} = require('../services/logsService');

// ==========================================
// FORMATAR MENÇÃO DE USUÁRIO
// ==========================================

function mencionarUsuario(id) {
    const texto = String(
        id ?? ''
    ).trim();

    if (!/^\d{15,22}$/.test(texto)) {
        return 'Não identificado';
    }

    return `<@${texto}>`;
}

// ==========================================
// FORMATAR MENÇÃO DE CANAL
// ==========================================

function mencionarCanal(id) {
    const texto = String(
        id ?? ''
    ).trim();

    if (!/^\d{15,22}$/.test(texto)) {
        return 'Canal não identificado';
    }

    return `<#${texto}>`;
}

// ==========================================
// FORMATAR CÓDIGO
// ==========================================

function formatarCodigo(codigo) {
    const texto = String(
        codigo ?? ''
    ).trim();

    if (!/^[A-Za-z0-9_-]{2,64}$/.test(texto)) {
        return 'Desconhecido';
    }

    return `\`${texto}\``;
}

// ==========================================
// FORMATAR LIMITE DE USOS
// ==========================================

function formatarLimiteUsos(valor) {
    const numero = Number(valor);

    if (
        !Number.isSafeInteger(numero) ||
        numero <= 0
    ) {
        return 'Ilimitado';
    }

    return numero.toLocaleString(
        'pt-BR'
    );
}

// ==========================================
// MONTAR DETALHES DO LOG
// ==========================================

function criarDescricaoConvite(
    convite,
    registro
) {
    const convidadorId =
        registro.convidador_id ||
        convite.inviter?.id ||
        null;

    const canalId =
        registro.canal_id ||
        convite.channelId ||
        convite.channel?.id ||
        null;

    const codigo = registro.codigo;

    return [
        '**Novo convite criado no servidor**',
        '',
        `**Criado por:** ${
            mencionarUsuario(convidadorId)
        }`,

        `**Canal:** ${
            mencionarCanal(canalId)
        }`,

        `**Código:** ${
            formatarCodigo(codigo)
        }`,

        `**Usos iniciais:** ${
            Number(
                registro.usos || 0
            ).toLocaleString('pt-BR')
        }`,

        `**Limite de usos:** ${
            formatarLimiteUsos(
                registro.usos_maximos
            )
        }`
    ].join('\n');
}

// ==========================================
// MONTAR DADOS DO LOG
// ==========================================

function criarDadosLog(
    convite,
    registro
) {
    const codigo = registro.codigo;

    return {
        guild: convite.guild,

        tipo:
            TIPOS_LOG.CONVITE_CRIADO,

        titulo:
            'Novo convite criado',

        detalhes:
            criarDescricaoConvite(
                convite,
                registro
            ),

        autorId:
            registro.convidador_id ||
            null,

        alvoId: null,

        referencia:
            `Convite ${codigo}`,

        // O mesmo evento pode chegar
        // mais de uma vez.
        //
        // A chave evita duplicar
        // o registro do mesmo código.
        //
        // A separação por servidor
        // já é feita pelo logsService.

        chaveEvento:
            `convite_criado_${codigo}`
    };
}

// ==========================================
// SALVAR REGISTRO NO SISTEMA DE LOGS
// ==========================================

async function registrarLogConvite(
    convite,
    registro
) {
    try {
        const dados = criarDadosLog(
            convite,
            registro
        );

        const resultado =
            await registrarLogSistema(
                dados
            );

        if (
            resultado.salvo &&
            resultado.publicado
        ) {
            console.log(
                '[InovareSale | Convites] ' +
                `Log do convite ${
                    registro.codigo
                } processado.`
            );

        } else if (resultado.salvo) {
            console.log(
                '[InovareSale | Convites] ' +
                'Convite registrado nos logs. ' +
                'Publicação no Discord pendente.'
            );
        }

        return resultado;

    } catch (erro) {
        // O convite já foi salvo no
        // SQLite pelo convitesService.
        //
        // Uma falha no serviço de logs
        // não apaga esse registro.

        console.error(
            '[InovareSale | Convites] ' +
            'Erro ao registrar log de criação:',
            erro
        );

        return null;
    }
}

// ==========================================
// EVENTO PRINCIPAL
// ==========================================

module.exports = {
    name: Events.InviteCreate,

    once: false,

    async execute(convite, client) {
        // ==================================
        // VERIFICAR DADOS DO CONVITE
        // ==================================

        if (
            !convite ||
            !convite.guild?.id ||
            !convite.code
        ) {
            return;
        }

        // ==================================
        // VERIFICAR SERVIDOR
        // ==================================

        const guild = convite.guild;

        if (
            client &&
            !client.guilds.cache.has(
                guild.id
            )
        ) {
            return;
        }

        // ==================================
        // IDENTIFICAR CRIADOR
        // ==================================

        // O Discord pode não fornecer
        // inviter em algumas situações.
        //
        // Se não houver criador disponível,
        // registramos como desconhecido.
        //
        // Não atribuímos o convite
        // a outro usuário por suposição.

        const criadorId =
            convite.inviter?.id ||
            null;

        // ==================================
        // SALVAR CONVITE NO SQLITE
        // ==================================

        let registro;

        try {
            registro =
                registrarConviteCriado(
                    convite
                );

        } catch (erro) {
            console.error(
                '[InovareSale | Convites] ' +
                'Falha ao salvar convite criado:',
                erro
            );

            return;
        }

        if (!registro) {
            console.warn(
                '[InovareSale | Convites] ' +
                'O convite não foi localizado ' +
                'após o registro no SQLite.'
            );

            return;
        }

        // ==================================
        // MOSTRAR ATIVIDADE NO CONSOLE
        // ==================================

        console.log(
            '🔗 [InovareSale | Convites] ' +
            `Novo convite: ${
                registro.codigo
            } | ` +
            `Servidor: ${
                guild.id
            } | ` +
            `Criador: ${
                criadorId || 'desconhecido'
            }`
        );

        // ==================================
        // REGISTRAR ATIVIDADE NOS LOGS
        // ==================================

        await registrarLogConvite(
            convite,
            registro
        );

        // ==================================
        // PAINEL DE STATUS
        // ==================================

        // O painel de status será
        // atualizado pelo monitoramento
        // automático uma vez por hora.
        //
        // Não enviamos uma nova mensagem
        // de status para cada convite.
    }
};
