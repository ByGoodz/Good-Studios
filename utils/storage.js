const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'data', 'config.json');
const salesPath = path.join(__dirname, '..', 'data', 'sales.json');

function lerArquivo(caminho) {
    try {
        const conteudo = fs.readFileSync(caminho, 'utf8');
        return JSON.parse(conteudo || '{}');
    } catch (erro) {
        console.error(`Erro ao ler ${caminho}:`, erro);
        return {};
    }
}

function salvarArquivo(caminho, dados) {
    try {
        fs.writeFileSync(
            caminho,
            JSON.stringify(dados, null, 4),
            'utf8'
        );
    } catch (erro) {
        console.error(`Erro ao salvar ${caminho}:`, erro);
    }
}

function getConfig() {
    return lerArquivo(configPath);
}

function saveConfig(config) {
    salvarArquivo(configPath, config);
}

function getSales() {
    return lerArquivo(salesPath);
}

function saveSales(sales) {
    salvarArquivo(salesPath, sales);
}

module.exports = {
    getConfig,
    saveConfig,
    getSales,
    saveSales
};