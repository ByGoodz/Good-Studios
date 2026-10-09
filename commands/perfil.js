'use strict';

const fs = require('fs');
const path = require('path');
const {
    SlashCommandBuilder,
    AttachmentBuilder,
    EmbedBuilder
} = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { getSales } = require('../utils/storage');

const BASE = path.join(__dirname, '..', 'assets', 'perfil-base.png');
const W = 1440;
const H = 1024;

const NIVEIS = [
    { minimo: 10000, nome: 'SUPREMO', cor: '#e8dca9' },
    { minimo: 5000, nome: 'ESMERALDA', cor: '#7de0b2' },
    { minimo: 1000, nome: 'PLATINA', cor: '#b8e1ff' },
    { minimo: 500, nome: 'DIAMANTE', cor: '#bcbaff' },
    { minimo: 300, nome: 'OURO', cor: '#ffd67c' },
    { minimo: 100, nome: 'PRATA', cor: '#e0e3ef' },
    { minimo: 0.01, nome: 'BRONZE', cor: '#dfaa87' }
];

function dinheiro(n) {
    return Number(n || 0).toLocaleString('pt-BR', {
        style: 'currency', currency: 'BRL'
    });
}

function numero(n) {
    return Math.floor(Number(n || 0)).toLocaleString('pt-BR');
}

function obterDados(servidorId, usuarioId) {
    const vendas = getSales();
    const d = vendas?.[servidorId]?.[usuarioId] || {};
    const historico = Array.isArray(d.historico) ? d.historico : [];
    const agora = new Date();
    const noMes = historico.filter(item => {
        const data = new Date(item.data);
        return !Number.isNaN(data.getTime()) &&
            data.getFullYear() === agora.getFullYear() &&
            data.getMonth() === agora.getMonth();
    });

    return {
        total: Number(d.totalGasto || 0),
        robux: Number(d.totalRobux || 0),
        compras: Number(d.quantidadeCompras || historico.length),
        maior: historico.reduce((maior, v) => Math.max(maior, Number(v.valor || 0)), 0),
        mensal: noMes.reduce((soma, v) => soma + Number(v.valor || 0), 0)
    };
}

function rounded(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
}

function escrever(ctx, texto, x, y, tamanho, cor = '#ffffff', peso = 'normal', maxWidth) {
    ctx.fillStyle = cor;
    ctx.font = `${peso} ${tamanho}px Arial`;
    ctx.textAlign = 'left';
    ctx.fillText(String(texto), x, y, maxWidth);
}

function card(ctx, x, y, w, h, titulo, valor, cor = '#f3efff') {
    const fundo = ctx.createLinearGradient(x, y, x + w, y + h);
    fundo.addColorStop(0, '#21172d');
    fundo.addColorStop(1, '#0a0811');
    rounded(ctx, x, y, w, h, 17);
    ctx.fillStyle = fundo;
    ctx.fill();
    ctx.strokeStyle = '#7949a8';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#ad57ff';
    rounded(ctx, x + 20, y + 24, 5, h - 48, 3);
    ctx.fill();
    escrever(ctx, titulo, x + 42, y + 48, 21, '#c8bfd3', 'bold', w - 60);
    escrever(ctx, valor, x + 42, y + 103, 37, cor, 'bold', w - 65);
}

async function carregarAvatar(usuario) {
    try {
        const url = usuario.displayAvatarURL({ extension: 'png', size: 256 });
        const resposta = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!resposta.ok) return null;
        return await loadImage(Buffer.from(await resposta.arrayBuffer()));
    } catch (erro) {
        console.warn('[Perfil] Avatar indisponível:', erro.message);
        return null;
    }
}

async function gerarImagemPerfil(usuario, dados) {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // A imagem-base entra como textura decorativa. O escurecimento
    // impede que os valores de exemplo do modelo sejam exibidos.
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#251137');
    grad.addColorStop(0.5, '#090811');
    grad.addColorStop(1, '#190f2e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    if (fs.existsSync(BASE)) {
        try {
            const modelo = await loadImage(BASE);
            ctx.globalAlpha = 0.20;
            ctx.drawImage(modelo, 0, 0, W, H);
            ctx.globalAlpha = 1;
        } catch (erro) {
            console.warn('[Perfil] Base inválida:', erro.message);
        }
    }
    ctx.fillStyle = 'rgba(6, 5, 12, 0.82)';
    ctx.fillRect(0, 0, W, H);

    // Moldura metálica roxa.
    rounded(ctx, 32, 31, W - 64, H - 62, 30);
    ctx.strokeStyle = '#aa54fc';
    ctx.lineWidth = 4;
    ctx.stroke();
    rounded(ctx, 47, 47, W - 94, H - 94, 23);
    ctx.strokeStyle = '#57406d';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Cabeçalho.
    rounded(ctx, 68, 69, W - 136, 255, 22);
    ctx.fillStyle = '#0d0b17';
    ctx.fill();
    ctx.strokeStyle = '#693f9b';
    ctx.lineWidth = 2;
    ctx.stroke();

    const nivel = NIVEIS.find(n => dados.total >= n.minimo) ||
        { nome: 'VISITANTE', cor: '#b8b4c2' };
    const avatar = await carregarAvatar(usuario);
    ctx.save();
    ctx.beginPath();
    ctx.arc(192, 193, 92, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (avatar) {
        ctx.drawImage(avatar, 100, 101, 184, 184);
    } else {
        ctx.fillStyle = '#241630';
        ctx.fill();
        escrever(ctx, '?', 163, 233, 110, '#e5d8f4', 'bold');
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(192, 193, 94, 0, Math.PI * 2);
    ctx.strokeStyle = '#bc6bff';
    ctx.lineWidth = 7;
    ctx.stroke();

    escrever(ctx, usuario.username.slice(0, 22), 322, 158, 49, '#ffffff', 'bold', 500);
    escrever(ctx, `ID: ${usuario.id}`, 325, 202, 20, '#aba1b9');
    rounded(ctx, 323, 226, 325, 65, 14);
    ctx.fillStyle = '#1c1428';
    ctx.fill();
    ctx.strokeStyle = nivel.cor;
    ctx.lineWidth = 2;
    ctx.stroke();
    escrever(ctx, `CLIENTE ${nivel.nome}`, 343, 268, 27, nivel.cor, 'bold', 290);
    escrever(ctx, 'INOVARESALE', 946, 168, 43, '#ece5f3', 'bold', 380);
    escrever(ctx, 'SEU PERFIL DE COMPRAS', 980, 212, 19, '#bf82f7', 'bold');

    escrever(ctx, 'SUAS ESTATÍSTICAS', 78, 381, 30, '#ffffff', 'bold');
    const x = [76, 520, 964];
    card(ctx, x[0], 412, 400, 145, 'TOTAL GASTO', dinheiro(dados.total), '#c977ff');
    card(ctx, x[1], 412, 400, 145, 'COMPRAS REALIZADAS', numero(dados.compras));
    card(ctx, x[2], 412, 400, 145, 'MAIOR COMPRA', dinheiro(dados.maior));
    card(ctx, x[0], 574, 400, 145, 'ROBUX COMPRADOS', numero(dados.robux), '#c977ff');
    card(ctx, x[1], 574, 400, 145, 'GASTO NESTE MÊS', dinheiro(dados.mensal));
    const proximo = [...NIVEIS].reverse().find(n => dados.total < n.minimo);
    card(ctx, x[2], 574, 400, 145,
        'PRÓXIMA CONQUISTA',
        proximo ? `Faltam ${dinheiro(proximo.minimo - dados.total)}` : 'NÍVEL MÁXIMO',
        '#d6a2ff');

    // Emblemas reais de acordo com o total gasto.
    escrever(ctx, 'EMBLEMAS', 78, 777, 30, '#ffffff', 'bold');
    const emblemas = [
        { minimo: 0.01, titulo: 'BRONZE' },
        { minimo: 100, titulo: 'PRATA' },
        { minimo: 300, titulo: 'OURO' },
        { minimo: 500, titulo: 'DIAMANTE' },
        { minimo: 1000, titulo: 'PLATINA' },
        { minimo: 5000, titulo: 'ESMERALDA' },
        { minimo: 10000, titulo: 'SUPREMO' }
    ];
    for (let i = 0; i < emblemas.length; i++) {
        const e = emblemas[i];
        const bx = 75 + i * 184;
        const conquistado = dados.total >= e.minimo;
        rounded(ctx, bx, 808, 166, 143, 16);
        ctx.fillStyle = conquistado ? '#27163b' : '#0e0b16';
        ctx.fill();
        ctx.strokeStyle = conquistado ? '#b663fd' : '#483458';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.font = 'bold 49px Arial';
        ctx.fillStyle = conquistado ? '#dab0ff' : '#5d506c';
        ctx.fillText(conquistado ? '◆' : '◇', bx + 83, 879);
        ctx.font = 'bold 17px Arial';
        ctx.fillText(e.titulo, bx + 83, 925);
    }
    ctx.textAlign = 'left';

    return await canvas.encode('png');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('perfil')
        .setDescription('Veja seu perfil de compras na InovareSale')
        .addUserOption(option => option
            .setName('usuario')
            .setDescription('Cliente cujo perfil deseja consultar')
            .setRequired(false)),

    async execute(interaction) {
        await interaction.deferReply();
        const usuario = interaction.options.getUser('usuario') || interaction.user;
        try {
            const dados = obterDados(interaction.guildId, usuario.id);
            const imagem = await gerarImagemPerfil(usuario, dados);
            await interaction.editReply({
                files: [new AttachmentBuilder(imagem, { name: 'perfil-inovaresale.png' })],
                allowedMentions: { parse: [] }
            });
        } catch (erro) {
            console.error('[InovareSale] Falha ao gerar perfil:', erro);
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor(0x9951cb)
                    .setTitle(`Perfil de ${usuario.username}`)
                    .setDescription('Não foi possível gerar a imagem agora. Tente novamente.')]
            });
        }
    }
};
