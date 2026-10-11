
'use strict';

// ==========================================
// INOVARESALE BOT 3.0
// SISTEMA CENTRAL DE EMOJIS
// ==========================================

// Este arquivo organiza os emojis
// utilizados nos sistemas do bot.
//
// - Painéis
// - Tickets
// - Vendas
// - Robux
// - Estoque
// - Limiteds
// - Moderação
// - Logs
// - Convites
// - Equipe
// - Status
//
// Utilizamos emojis Unicode.
//
// Assim, não precisamos configurar
// IDs de emojis personalizados nem
// depender de emojis de outro servidor.

// ==========================================
// EMOJIS DO BOT
// ==========================================

const EMOJIS = Object.freeze({

    // ======================================
    // IDENTIDADE
    // ======================================

    loja: '💜',
    inovare: '💎',
    principal: '💜',
    estrela: '⭐',
    brilho: '✨',
    coroa: '👑',
    foguete: '🚀',

    // ======================================
    // AÇÕES
    // ======================================

    sucesso: '✅',
    erro: '❌',
    aviso: '⚠️',
    informacao: 'ℹ️',
    carregando: '🔄',
    aguardando: '⏳',
    confirmado: '✅',
    cancelado: '❌',
    voltar: '◀️',
    avancar: '▶️',
    atualizar: '🔄',
    adicionar: '➕',
    remover: '➖',
    editar: '✏️',
    pesquisar: '🔎',
    configurar: '⚙️',
    salvar: '💾',
    excluir: '🗑️',
    cadeado: '🔒',
    desbloqueado: '🔓',

    // ======================================
    // ROBUX E PAGAMENTOS
    // ======================================

    robux: '💎',
    moedas: '🪙',
    dinheiro: '💰',
    carteira: '👛',
    pix: '💸',
    pagamento: '💳',
    calculadora: '🧮',
    preco: '🏷️',
    desconto: '🎟️',

    // ======================================
    // LOJA E VENDAS
    // ======================================

    lojaVirtual: '🛍️',
    comprar: '🛒',
    venda: '💰',
    vendas: '📈',
    produto: '📦',
    produtos: '📦',
    estoque: '🗃️',
    entrega: '🚚',
    pedido: '📨',
    pedidos: '📨',
    limited: '💠',
    limiteds: '💠',
    presente: '🎁',

    // ======================================
    // TICKETS E ATENDIMENTO
    // ======================================

    ticket: '🎫',
    tickets: '🎫',
    atendimento: '🎧',
    atendente: '👨‍💻',
    cliente: '👤',
    conversa: '💬',
    mensagem: '✉️',
    abrirTicket: '📂',
    fecharTicket: '🔒',
    finalizar: '🏁',
    comprovante: '🧾',

    // ======================================
    // STATUS DOS PEDIDOS
    // ======================================

    criando: '🆕',
    aberto: '📂',
    emAtendimento: '🎧',
    finalizando: '⏳',
    finalizado: '✅',

    // ======================================
    // MODERAÇÃO
    // ======================================

    moderacao: '🛡️',
    seguranca: '🔐',
    ban: '🔨',
    unban: '🔓',
    warn: '⚠️',
    unwarn: '✅',
    timeout: '🔇',
    untimeout: '🔊',
    punicao: '🚫',
    historico: '📜',

    // ======================================
    // EQUIPE
    // ======================================

    equipe: '👥',
    funcionario: '👨‍💼',
    staff: '🛡️',
    voz: '🎙️',
    call: '🎧',
    microfone: '🎤',
    ranking: '🏆',
    relogio: '🕒',
    tempo: '⏱️',

    // ======================================
    // CONVITES
    // ======================================

    convite: '🔗',
    convites: '🔗',
    membroEntrou: '📥',
    membroSaiu: '📤',
    usuarios: '👥',
    adicionarMembro: '👤',

    // ======================================
    // LOGS E SISTEMA
    // ======================================

    logs: '📋',
    bancoDados: '🗄️',
    servidor: '🖥️',
    discord: '💬',
    online: '🟢',
    offline: '🔴',
    manutencao: '🛠️',
    estatisticas: '📊',
    grafico: '📈',
    painel: '🖥️',

    // ======================================
    // INDICADORES DE STATUS
    // ======================================

    verde: '🟢',
    amarelo: '🟡',
    vermelho: '🔴',
    cinza: '⚪'

});

// ==========================================
// STATUS PADRONIZADOS
// ==========================================

const STATUS = Object.freeze({
    NORMAL: 'normal',
    ATENCAO: 'atencao',
    PROBLEMA: 'problema'
});

// ==========================================
// EMOJI PELO STATUS
// ==========================================

// Exemplos:
//
// obterEmojiStatus('normal')  -> 🟢
// obterEmojiStatus('atencao') -> 🟡
// obterEmojiStatus('problema')-> 🔴

function obterEmojiStatus(status) {
    const texto = String(
        status ?? ''
    )
        .trim()
        .toLowerCase();

    switch (texto) {
        case STATUS.NORMAL:
        case 'online':
        case 'sucesso':
        case 'ativo':
            return EMOJIS.verde;

        case STATUS.ATENCAO:
        case 'atenção':
        case 'aviso':
        case 'pendente':
            return EMOJIS.amarelo;

        case STATUS.PROBLEMA:
        case 'erro':
        case 'offline':
        case 'falha':
            return EMOJIS.vermelho;

        default:
            return EMOJIS.cinza;
    }
}

// ==========================================
// BUSCAR EMOJI PELO NOME
// ==========================================

// Exemplos:
//
// obterEmoji('robux')   -> 💎
// obterEmoji('ticket')  -> 🎫
// obterEmoji('sucesso') -> ✅
//
// Se a chave não existir, retorna
// o emoji de informação.

function obterEmoji(
    nome,
    padrao = EMOJIS.informacao
) {
    const chave = String(
        nome ?? ''
    ).trim();

    if (
        Object.prototype.hasOwnProperty.call(
            EMOJIS,
            chave
        )
    ) {
        return EMOJIS[chave];
    }

    return padrao;
}

// ==========================================
// FORMATAR MENSAGEM COM EMOJI
// ==========================================

// Exemplo:
//
// mensagemComEmoji(
//     'sucesso',
//     'Compra concluída!'
// );
//
// Resultado:
//
// ✅ Compra concluída!

function mensagemComEmoji(
    nome,
    mensagem
) {
    const emoji = obterEmoji(nome);

    const texto = String(
        mensagem ?? ''
    ).trim();

    if (!texto) {
        return emoji;
    }

    return `${emoji} ${texto}`;
}

// ==========================================
// EMOJI DO STATUS DO TICKET
// ==========================================

function obterEmojiTicket(
    status
) {
    const mapa = {
        criando: EMOJIS.criando,

        aberto: EMOJIS.aberto,

        em_atendimento:
            EMOJIS.emAtendimento,

        finalizando:
            EMOJIS.finalizando,

        finalizado:
            EMOJIS.finalizado,

        cancelado:
            EMOJIS.cancelado
    };

    const chave = String(
        status ?? ''
    ).trim();

    return mapa[chave] ||
        EMOJIS.informacao;
}

// ==========================================
// EMOJI DA MODERAÇÃO
// ==========================================

function obterEmojiModeracao(
    tipo
) {
    const mapa = {
        ban: EMOJIS.ban,
        unban: EMOJIS.unban,
        warn: EMOJIS.warn,
        unwarn: EMOJIS.unwarn,
        timeout: EMOJIS.timeout,
        untimeout: EMOJIS.untimeout
    };

    const chave = String(
        tipo ?? ''
    )
        .trim()
        .toLowerCase();

    return mapa[chave] ||
        EMOJIS.moderacao;
}

// ==========================================
// EXPORTAÇÕES
// ==========================================

module.exports = {
    EMOJIS,
    STATUS,

    obterEmoji,
    obterEmojiStatus,
    obterEmojiTicket,
    obterEmojiModeracao,
    mensagemComEmoji
};
