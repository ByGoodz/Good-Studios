const NIVEIS = [
    {
        chave: 'primeiraCompra',
        minimo: 0.01
    },
    {
        chave: 'cliente100',
        minimo: 100
    },
    {
        chave: 'cliente300',
        minimo: 300
    },
    {
        chave: 'cliente500',
        minimo: 500
    },
    {
        chave: 'cliente1000',
        minimo: 1000
    },
    {
        chave: 'cliente5000',
        minimo: 5000
    },
    {
        chave: 'cliente10000',
        minimo: 10000
    }
];

function obterCargoIdeal(totalGasto, cargosConfigurados) {
    let cargoIdeal = null;

    for (const nivel of NIVEIS) {
        if (
            totalGasto >= nivel.minimo &&
            cargosConfigurados?.[nivel.chave]
        ) {
            cargoIdeal = cargosConfigurados[nivel.chave];
        }
    }

    return cargoIdeal;
}

async function atualizarCargo(member, totalGasto, cargosConfigurados) {
    const cargoIdeal = obterCargoIdeal(
        totalGasto,
        cargosConfigurados
    );

    if (!cargoIdeal) {
        return null;
    }

    const todosOsCargos = NIVEIS
        .map(nivel => cargosConfigurados?.[nivel.chave])
        .filter(Boolean);

    const cargosParaRemover = todosOsCargos.filter(
        cargoId =>
            cargoId !== cargoIdeal &&
            member.roles.cache.has(cargoId)
    );

    if (cargosParaRemover.length > 0) {
        await member.roles.remove(cargosParaRemover);
    }

    if (!member.roles.cache.has(cargoIdeal)) {
        await member.roles.add(cargoIdeal);
    }

    return cargoIdeal;
}

module.exports = {
    NIVEIS,
    obterCargoIdeal,
    atualizarCargo
};