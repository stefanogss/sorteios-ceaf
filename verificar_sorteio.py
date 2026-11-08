#!/usr/bin/env python3
"""Verificador independente do Sorteio CEAF.

Recalcula, a partir apenas dos dados publicados, a semente, o resultado e o
hash de um sorteio. Não depende da ferramenta nem de internet.

Uso:
    python3 verificar_sorteio.py registro.json
    python3 verificar_sorteio.py registro.json registro_anterior.json

"registro.json" é o arquivo baixado (ou copiado) na página de
sindicabilidade do sorteio. Informando também o registro anterior, o
script confere o encadeamento entre os dois.
"""
import hashlib
import json
import sys

ZEROS = "0" * 64
CAMPOS_SEMENTE = ["versao", "id", "nome", "dataHora", "vagas", "reserva",
                  "participantes", "mulheres", "entropia", "sementeExterna",
                  "anterior"]


def canon(v):
    """JSON canônico: chaves ordenadas, sem espaços, UTF-8 sem escapes."""
    return json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256(texto):
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()


def gerador(semente, fluxo):
    """Inteiros uniformes em [0, n): SHA-256(semente:fluxo:contador), 32 bits,
    com descarte dos valores que causariam viés de módulo."""
    contador = 0

    def aleatorio(n):
        nonlocal contador
        limite = (2 ** 32 // n) * n
        while True:
            x = int(sha256(f"{semente}:{fluxo}:{contador}")[:8], 16)
            contador += 1
            if x < limite:
                return x % n
    return aleatorio


def embaralhar(lista, semente, fluxo):
    """Sorteio sequencial sem reposição: a ordem de saída é a classificação."""
    aleatorio = gerador(semente, fluxo)
    urna = list(lista)
    saida = []
    while urna:
        saida.append(urna.pop(aleatorio(len(urna))))
    return saida


def vagas_reservadas(vagas, reserva):
    if not reserva["ativa"]:
        return 0
    if reserva["arredondamento"] == "baixo":
        return vagas // 2
    return (vagas + 1) // 2


def sortear(r):
    semente = r["semente"]
    k = vagas_reservadas(r["vagas"], r["reserva"])
    fila_mulheres, reservadas = [], []
    if k > 0 and r["mulheres"]:
        fila_mulheres = embaralhar(sorted(r["mulheres"]), semente, "F")
        reservadas = fila_mulheres[:k]
    resto = [i for i in range(len(r["participantes"])) if i not in reservadas]
    fila_geral = embaralhar(resto, semente, "G")
    n_ampla = r["vagas"] - len(reservadas)
    ampla = fila_geral[:n_ampla]
    selecionados = set(reservadas) | set(ampla)
    return {
        "reservadas": reservadas,
        "ampla": ampla,
        "suplentesGerais": fila_geral[n_ampla:],
        "suplentesMulheres": [i for i in fila_mulheres if i not in selecionados],
    }


def verificar(r, anterior=None):
    ok = True

    def item(cond, texto):
        nonlocal ok
        ok = ok and cond
        print(("[OK]    " if cond else "[FALHA] ") + texto)

    entrada = {c: r[c] for c in CAMPOS_SEMENTE}
    item(sha256(canon(entrada)) == r["semente"], "Semente = SHA-256 dos dados de entrada")
    item(sortear(r) == r["resultado"], "Resultado recalculado confere com o publicado")
    sem_hash = {c: v for c, v in r.items() if c != "hash"}
    item(sha256(canon(sem_hash)) == r["hash"], "Hash do registro confere")
    if anterior is not None:
        item(r["anterior"] == anterior["hash"], "Encadeamento com o registro anterior confere")
    elif r["anterior"] == ZEROS:
        print("[INFO]  Primeiro registro da cadeia")

    p = r["participantes"]
    print()
    print(f"{r['id']} - {r['nome']} ({r['dataHora']})")
    for rotulo, chave in [("Vagas reservadas a mulheres", "reservadas"),
                          ("Ampla concorrência", "ampla"),
                          ("Suplentes - lista geral", "suplentesGerais"),
                          ("Suplentes - vagas reservadas", "suplentesMulheres")]:
        lista = r["resultado"][chave]
        if lista:
            print(f"\n{rotulo}:")
            for pos, i in enumerate(lista, 1):
                print(f"  {pos:>2}. {p[i]}")
    print("\nVERIFICAÇÃO CONCLUÍDA: " + ("íntegro" if ok else "DIVERGÊNCIA ENCONTRADA"))
    return ok


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    with open(sys.argv[1], encoding="utf-8") as f:
        registro = json.load(f)
    reg_anterior = None
    if len(sys.argv) > 2:
        with open(sys.argv[2], encoding="utf-8") as f:
            reg_anterior = json.load(f)
    sys.exit(0 if verificar(registro, reg_anterior) else 1)
