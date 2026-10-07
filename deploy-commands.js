require('dotenv').config();

const {
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionFlagsBits
} = require('discord.js');

const token = process.env.DISCORD_TOKEN;

// ID da aplicação/bot
const CLIENT_ID = '1557429851231887511';

const commands = [
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Abre o painel de configuração da InovareSale.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('estoque')
        .setDescription('Atualiza o estoque da InovareSale.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('venda')
        .setDescription('Registra uma venda da InovareSale.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option =>
            option
                .setName('cliente')
                .setDescription('Cliente que realizou a compra')
                .setRequired(true)
        )
        .addNumberOption(option =>
            option
                .setName('valor')
                .setDescription('Valor pago em reais')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName('robux')
                .setDescription('Quantidade de Robux da venda')
                .setRequired(true)
        )
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

async function registrar() {
    try {
        console.log('Registrando comandos globais...');

        const resultado = await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands }
        );

        console.log(`SUCESSO: ${resultado.length} comandos registrados.`);

        for (const comando of resultado) {
            console.log(`/${comando.name}`);
        }

        console.log('Conferindo diretamente na API...');

        const conferir = await rest.get(
            Routes.applicationCommands(CLIENT_ID)
        );

        console.log(
            'COMANDOS NA API:',
            conferir.map(c => `/${c.name}`)
        );

    } catch (erro) {
        console.error('ERRO REAL DO DISCORD:');
        console.error(erro);
    }
}

registrar();