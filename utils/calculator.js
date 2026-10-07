function calcularPreco(robux, k) {
    return (robux / 1000) * k;
}

function calcularGamepassTaxada(robuxLiquido) {
    return Math.ceil(robuxLiquido / 0.70);
}

// SEM TAXA:
// O número digitado é o valor da gamepass.
// O cliente recebe 70% disso.
function calcularSemTaxa(robuxGamepass, k) {
    const robuxRecebido = Math.floor(robuxGamepass * 0.70);
    const preco = calcularPreco(robuxGamepass, k);

    return {
        robuxGamepass,
        robuxRecebido,
        preco
    };
}

// TAXADO:
// O número digitado é quanto o cliente quer receber líquido.
// Calculamos uma gamepass maior para compensar os 30%.
function calcularTaxado(robuxDesejado, k) {
    const robuxGamepass = calcularGamepassTaxada(robuxDesejado);
    const preco = calcularPreco(robuxGamepass, k);

    return {
        robuxGamepass,
        robuxRecebido: robuxDesejado,
        preco
    };
}

// Quando a pessoa manda, por exemplo: R$ 100
function calcularPorReais(valorReais, k) {
    const robuxGamepass = Math.floor((valorReais / k) * 1000);
    const robuxRecebido = Math.floor(robuxGamepass * 0.70);

    return {
        robuxGamepass,
        robuxRecebido,
        valor: valorReais
    };
}

function formatarDinheiro(valor) {
    return valor.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });
}

function formatarRobux(valor) {
    return Math.floor(valor).toLocaleString('pt-BR');
}

module.exports = {
    calcularPreco,
    calcularGamepassTaxada,
    calcularSemTaxa,
    calcularTaxado,
    calcularPorReais,
    formatarDinheiro,
    formatarRobux
};