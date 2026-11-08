/**
 * Sorteios CEAF – servidor em Google Apps Script.
 *
 * As páginas ficam no GitHub Pages; este script recebe as requisições, guarda os dados na
 * planilha Google à qual está vinculado, faz os sorteios (manuais e automáticos) e grava
 * uma cópia de cada sorteio no repositório do GitHub, cujo histórico público e datado
 * impede que um sorteio seja alterado ou apagado sem deixar rastro.
 *
 * Instalação: veja LEIAME.md. Depois de colar este arquivo, execute a função "configurar" uma vez.
 *
 * O cálculo do sorteio é idêntico ao de verificar_sorteio.py (verificador público em Python).
 */

var FUSO = "America/Sao_Paulo";
var VERSAO = 1;
var VAGAS_MIN = 1, VAGAS_MAX = 100;
var ZEROS = "0000000000000000000000000000000000000000000000000000000000000000";
var CAMPOS_SEMENTE = ["versao", "id", "nome", "dataHora", "vagas", "reserva", "participantes", "mulheres", "entropia", "sementeExterna", "anterior"];
var SENHA_MINIMA = 12;
var ITERACOES_SENHA = 2000;
var ADMIN_LOGIN = "admin";
var SEGUNDOS_SESSAO = 21600; // 6 horas (máximo do cache do Apps Script)
var LIMITE_CELULA = 49000;   // a planilha aceita até 50.000 caracteres por célula
var MODOS = { automatico: "automático", manual: "manual" };
var SISTEMA = "Sistema (sorteio automático)";
var FORMULARIO = "Formulário público";
var PRESENCA = { aguardando: "Aguardando confirmação", confirmada: "Confirmada", desistiu: "Desistiu" };
var RELATORIO = { pendente: "Pendente", entregue: "Entregue" };

var ABAS = {
  sorteios: ["id", "hash", "registro", "criado_por", "criado_em", "github"],
  chamadas: ["id", "dados", "versao", "sorteio_id", "confirmacao", "aviso", "criado_por", "criado_em"],
  inscricoes: ["seq", "chamada_id", "nome", "email", "interesse", "atua", "origem", "criado_em", "mulher", "excluida"],
  controle: ["id", "dados", "versao"],
  historico: ["tipo", "ref", "quando", "usuario", "texto"],
  usuarios: ["login", "nome", "senha", "ativo", "admin", "trocar_senha", "geracao", "criado_em"]
};

/* =====================================================================
 * Instalação
 * ===================================================================== */

/** Execute uma vez pelo editor: cria as abas, o administrador (admin + ano) e o gatilho do sorteio automático. */
function configurar() {
  var pl = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  props.setProperty("PLANILHA_ID", pl.getId());
  if (!props.getProperty("DOMINIOS_EMAIL")) props.setProperty("DOMINIOS_EMAIL", "mpsc.mp.br");
  Object.keys(ABAS).forEach(function (nome) {
    var a = pl.getSheetByName(nome) || pl.insertSheet(nome);
    if (a.getLastRow() === 0) a.appendRow(ABAS[nome]);
    a.setFrozenRows(1);
    // Aviso a quem tentar editar à mão: os dados são mantidos pelo sistema.
    if (a.protect && !a.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) a.protect().setWarningOnly(true).setDescription("Mantido pelo sistema de sorteios");
  });
  var padrao = pl.getSheetByName("Página1") || pl.getSheetByName("Sheet1");
  if (padrao && pl.getSheets().length > Object.keys(ABAS).length) pl.deleteSheet(padrao);

  var criado = garantirAdmin();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "tarefaPeriodica") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("tarefaPeriodica").timeBased().everyMinutes(5).create();
  var msg = "Configuração concluída. " + (criado ? "Administrador criado: usuário admin, senha " + criado + " (troque no primeiro acesso)." : "Administrador já existia.");
  Logger.log(msg);
  return msg;
}

/** Chamado pelo gatilho a cada 5 minutos: sorteios automáticos vencidos e cópias pendentes no GitHub. */
function tarefaPeriodica() {
  executarAutomaticos();
  republicarPendentes();
}

/* =====================================================================
 * Entrada HTTP
 * ===================================================================== */

function doGet(e) {
  return responder({ ok: true, dados: saude() });
}

function doPost(e) {
  var pedido;
  try { pedido = JSON.parse(e.postData.contents); } catch (x) { return responder({ ok: false, status: 400, detail: "Dados inválidos." }); }
  try {
    return responder({ ok: true, dados: rotear(String(pedido.metodo || "GET").toUpperCase(), String(pedido.caminho || ""), pedido.corpo, pedido.token) });
  } catch (x) {
    if (x && x.status) return responder({ ok: false, status: x.status, detail: x.message });
    console.error(x && x.stack || x);
    return responder({ ok: false, status: 500, detail: "Erro interno. Tente de novo em instantes." });
  }
}

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function Falha(status, mensagem) { var e = new Error(mensagem); e.status = status; return e; }

var ROTAS = [
  ["GET", /^\/api\/sessao$/, function (p) { return { usuario: usuarioAtual(p.token), modoLogin: "senha", urlBase: "", dominiosEmail: dominiosEmail(), repositorio: prop("GITHUB_REPOSITORIO") || "" }; }],
  ["POST", /^\/api\/login$/, function (p) { return comTrava(function () { return entrar(p.corpo || {}); }); }],
  ["POST", /^\/api\/logout$/, function (p) { encerrarSessao(p.token); return { ok: true }; }],
  ["POST", /^\/api\/conta\/senha$/, function (p) { var u = exigirConta(p.token); return comTrava(function () { return trocarPropriaSenha(u, p.corpo || {}, p.token); }); }],
  ["GET", /^\/api\/usuarios$/, function (p) { exigirAdmin(p.token); return painelUsuarios(); }],
  ["POST", /^\/api\/usuarios$/, function (p) { var u = exigirAdmin(p.token); return comTrava(function () { var s = criarUsuario(p.corpo || {}, u); return Object.assign(painelUsuarios(), { senhaProvisoria: s }); }); }],
  ["PATCH", /^\/api\/usuarios\/([^\/]+)$/, function (p, m) { var u = exigirAdmin(p.token); return comTrava(function () { alterarUsuario(decodeURIComponent(m[1]), p.corpo || {}, u); return painelUsuarios(); }); }],
  ["POST", /^\/api\/usuarios\/([^\/]+)\/senha$/, function (p, m) { var u = exigirAdmin(p.token); return comTrava(function () { var s = redefinirSenha(decodeURIComponent(m[1]), u); return Object.assign(painelUsuarios(), { senhaProvisoria: s }); }); }],
  ["DELETE", /^\/api\/usuarios\/([^\/]+)$/, function (p, m) { var u = exigirAdmin(p.token); return comTrava(function () { excluirUsuario(decodeURIComponent(m[1]), u); return painelUsuarios(); }); }],
  ["GET", /^\/api\/sorteios$/, function () { return listarSorteios(); }],
  ["GET", /^\/api\/chamadas$/, function () { return listarChamadasPublicas(); }],
  ["POST", /^\/api\/chamadas\/([^\/]+)\/inscricoes$/, function (p, m) { return inscrever(decodeURIComponent(m[1]), p.corpo || {}); }],
  ["GET", /^\/api\/equipe\/chamadas$/, function (p) { exigirUsuario(p.token); return listarChamadasEquipe(); }],
  ["POST", /^\/api\/chamadas$/, function (p) { var u = exigirUsuario(p.token); return comTrava(function () { return criarChamada(p.corpo, u); }); }],
  ["PUT", /^\/api\/chamadas\/([^\/]+)$/, function (p, m) { var u = exigirUsuario(p.token); return comTrava(function () { return gravarChamada(decodeURIComponent(m[1]), p.corpo || {}, u); }); }],
  ["POST", /^\/api\/chamadas\/([^\/]+)\/inscricoes\/equipe$/, function (p, m) { var u = exigirUsuario(p.token); return comTrava(function () { return inscreverPelaEquipe(decodeURIComponent(m[1]), p.corpo || {}, u); }); }],
  ["PATCH", /^\/api\/chamadas\/([^\/]+)\/inscricoes\/(\d+)$/, function (p, m) { var u = exigirUsuario(p.token); return comTrava(function () { return alterarInscricao(decodeURIComponent(m[1]), Number(m[2]), p.corpo || {}, u); }); }],
  ["POST", /^\/api\/chamadas\/([^\/]+)\/confirmacao$/, function (p, m) { var u = exigirUsuario(p.token); return comTrava(function () { return confirmarInscritas(decodeURIComponent(m[1]), p.corpo || {}, u); }); }],
  ["POST", /^\/api\/chamadas\/([^\/]+)\/sortear$/, function (p, m) { var u = exigirUsuario(p.token); return sortearManual(decodeURIComponent(m[1]), u); }],
  ["GET", /^\/api\/controle$/, function (p) { exigirUsuario(p.token); return lerControles(); }],
  ["PUT", /^\/api\/controle\/([^\/]+)$/, function (p, m) { var u = exigirUsuario(p.token); return comTrava(function () { return gravarControle(decodeURIComponent(m[1]), p.corpo || {}, u); }); }],
  ["GET", /^\/api\/saude$/, function () { return saude(); }]
];

function rotear(metodo, caminho, corpo, token) {
  for (var i = 0; i < ROTAS.length; i++) {
    var m = ROTAS[i][0] === metodo && ROTAS[i][1].exec(caminho);
    if (m) return ROTAS[i][2]({ corpo: corpo, token: token }, m);
  }
  throw Falha(404, "Endereço não encontrado.");
}

/** Toda escrita passa por aqui: uma de cada vez, para que numeração, encadeamento e versões não colidam. */
function comTrava(f) {
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(25000)) throw Falha(503, "O sistema está ocupado. Tente de novo em alguns segundos.");
  try { return f(); } finally { trava.releaseLock(); }
}

/* =====================================================================
 * Planilha
 * ===================================================================== */

function prop(nome) { return PropertiesService.getScriptProperties().getProperty(nome); }
function planilha() { var id = prop("PLANILHA_ID"); if (!id) throw Falha(500, "Sistema não configurado: execute a função configurar."); return SpreadsheetApp.openById(id); }
function aba(nome) { return planilha().getSheetByName(nome); }

function ler(nome) {
  var v = aba(nome).getDataRange().getValues(), cab = ABAS[nome];
  var saida = [];
  for (var i = 1; i < v.length; i++) {
    var o = { _linha: i + 1 };
    for (var j = 0; j < cab.length; j++) o[cab[j]] = v[i][j] === undefined ? "" : v[i][j];
    saida.push(o);
  }
  return saida;
}

/** Texto vai com apóstrofo inicial: a planilha guarda como texto puro, sem converter datas nem executar fórmulas. */
function celula(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  var s = String(v);
  if (s.length > LIMITE_CELULA) throw Falha(422, "Conteúdo grande demais para a planilha.");
  return s === "" ? "" : "'" + s;
}
function linhaDe(nome, obj) { return ABAS[nome].map(function (c) { return celula(obj[c]); }); }
function inserir(nome, obj) { aba(nome).appendRow(linhaDe(nome, obj)); }
function regravar(nome, obj) { aba(nome).getRange(obj._linha, 1, 1, ABAS[nome].length).setValues([linhaDe(nome, obj)]); }
function apagarLinha(nome, obj) { aba(nome).deleteRow(obj._linha); }
function texto(v) { return v === null || v === undefined ? "" : String(v); }
function num(v) { return Number(v) || 0; }

function registrarHistorico(tipo, ref, usuario, textoH) {
  inserir("historico", { tipo: tipo, ref: ref, quando: agoraIso(), usuario: usuario, texto: String(textoH).slice(0, 500) });
}
function historicoDe(tipo, ref, todas) {
  return (todas || ler("historico")).filter(function (h) { return h.tipo === tipo && (ref === null || texto(h.ref) === ref); })
    .map(function (h) { return { quando: texto(h.quando), usuario: texto(h.usuario), texto: texto(h.texto) }; });
}

/* =====================================================================
 * Utilidades
 * ===================================================================== */

function bytesParaHex(b) { return b.map(function (x) { return ("0" + (x & 255).toString(16)).slice(-2); }).join(""); }
function hexParaBytes(h) { var b = []; for (var i = 0; i < h.length; i += 2) { var v = parseInt(h.substr(i, 2), 16); b.push(v > 127 ? v - 256 : v); } return b; }
function sha256(t) { return bytesParaHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, t, Utilities.Charset.UTF_8)); }
function aleatorioHex() { return sha256(Utilities.getUuid() + Utilities.getUuid() + new Date().getTime()); }
function agoraIso() { return new Date().toISOString(); }
function agoraLocal() { return Utilities.formatDate(new Date(), FUSO, "yyyy-MM-dd'T'HH:mm"); }
function hoje() { return Utilities.formatDate(new Date(), FUSO, "yyyy-MM-dd"); }
function anoAtual() { return Number(Utilities.formatDate(new Date(), FUSO, "yyyy")); }
function normalizar(s) { return String(s === null || s === undefined ? "" : s).normalize("NFC").replace(/\s+/g, " ").trim(); }
function chaveNome(s) { return normalizar(s).toLowerCase(); }
function dataBR(iso) { if (!iso) return ""; var p = String(iso).slice(0, 10).split("-"); return p[2] + "/" + p[1] + "/" + p[0]; }
function dataHoraBR(v) { return v ? dataBR(v.slice(0, 10)) + " às " + v.slice(11, 16) : ""; }
function dominiosEmail() { return String(prop("DOMINIOS_EMAIL") || "").split(",").map(function (d) { return d.trim().toLowerCase().replace(/^@/, ""); }).filter(String); }

function campoTexto(dados, campo, maximo, obrigatorio) {
  var v = normalizar(dados[campo]);
  if (obrigatorio !== false && !v) throw Falha(422, "Informe o campo '" + campo + "'.");
  if (v.length > maximo) throw Falha(422, "O campo '" + campo + "' passa de " + maximo + " caracteres.");
  return v;
}
function campoData(valor, rotulo, obrigatorio) {
  if (!valor) { if (obrigatorio !== false) throw Falha(422, "Informe a data '" + rotulo + "'."); return ""; }
  var s = String(valor).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s + "T00:00:00Z"))) throw Falha(422, "Data inválida em '" + rotulo + "'.");
  return s;
}
function campoDataHora(valor, rotulo) {
  if (!valor) throw Falha(422, "Informe " + rotulo + ".");
  var s = String(valor).slice(0, 16);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) || isNaN(Date.parse(s + ":00Z"))) throw Falha(422, "Data e hora inválidas em " + rotulo + ".");
  return s;
}

/* =====================================================================
 * Núcleo do sorteio (idêntico a verificar_sorteio.py)
 * ===================================================================== */

function canon(v) {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
  return JSON.stringify(v);
}
function gerador(semente, fluxo) {
  var contador = 0;
  return function (n) {
    var limite = Math.floor(4294967296 / n) * n;
    for (;;) {
      var x = parseInt(sha256(semente + ":" + fluxo + ":" + contador).slice(0, 8), 16);
      contador++;
      if (x < limite) return x % n;
    }
  };
}
function embaralhar(lista, semente, fluxo) {
  var aleatorio = gerador(semente, fluxo), urna = lista.slice(), saida = [];
  while (urna.length) saida.push(urna.splice(aleatorio(urna.length), 1)[0]);
  return saida;
}
function vagasReservadas(vagas, reserva) {
  if (!reserva.ativa) return 0;
  return reserva.arredondamento === "baixo" ? Math.floor(vagas / 2) : Math.ceil(vagas / 2);
}
function sortear(r) {
  var k = vagasReservadas(r.vagas, r.reserva), filaMulheres = [], reservadas = [];
  if (k > 0 && r.mulheres.length) {
    filaMulheres = embaralhar(r.mulheres.slice().sort(function (a, b) { return a - b; }), r.semente, "F");
    reservadas = filaMulheres.slice(0, k);
  }
  var resto = r.participantes.map(function (_, i) { return i; }).filter(function (i) { return reservadas.indexOf(i) < 0; });
  var filaGeral = embaralhar(resto, r.semente, "G");
  var nAmpla = r.vagas - reservadas.length, ampla = filaGeral.slice(0, nAmpla), sel = reservadas.concat(ampla);
  return {
    reservadas: reservadas,
    ampla: ampla,
    suplentesGerais: filaGeral.slice(nAmpla),
    suplentesMulheres: filaMulheres.filter(function (i) { return sel.indexOf(i) < 0; })
  };
}
function entradaSemente(r) { var e = {}; CAMPOS_SEMENTE.forEach(function (c) { e[c] = r[c]; }); return e; }
function semHash(r) { var e = {}; Object.keys(r).forEach(function (c) { if (c !== "hash") e[c] = r[c]; }); return e; }

function montarRegistro(entrada, id, anterior, inscricao) {
  var r = {
    versao: VERSAO, id: id, nome: entrada.nome, dataHora: agoraIso(), vagas: entrada.vagas, reserva: entrada.reserva,
    participantes: entrada.participantes, mulheres: entrada.mulheres, entropia: aleatorioHex().slice(0, 32),
    sementeExterna: entrada.sementeExterna, anterior: anterior || ZEROS
  };
  r.semente = sha256(canon(entradaSemente(r)));
  r.responsavel = entrada.responsavel;
  r.evento = entrada.evento;
  r.classificacao = entrada.reserva.ativa ? "indicação manual confirmada pela pessoa responsável" : "não se aplica";
  if (inscricao) r.inscricao = inscricao;
  r.resultado = sortear(r);
  r.hash = sha256(canon(semHash(r)));
  return r;
}

function verificarCadeia(registros) {
  var falhas = [], anterior = ZEROS;
  registros.forEach(function (r) {
    var ok = sha256(canon(entradaSemente(r))) === r.semente && canon(sortear(r)) === canon(r.resultado) &&
      sha256(canon(semHash(r))) === r.hash && r.anterior === anterior;
    if (!ok) falhas.push(r.id || "?");
    anterior = r.hash;
  });
  return falhas;
}

/* =====================================================================
 * Sorteios publicados
 * ===================================================================== */

function listarSorteios(linhas) { return (linhas || ler("sorteios")).map(function (l) { return JSON.parse(texto(l.registro)); }); }

function saude() {
  var linhas = ler("sorteios"), regs = listarSorteios(linhas), falhas = verificarCadeia(regs);
  linhas.forEach(function (l) { if (sha256(canon(semHash(JSON.parse(texto(l.registro))))) !== texto(l.hash)) falhas.push(texto(l.id)); });
  return { ok: !falhas.length, registros: regs.length, divergencias: falhas,
    copiasPendentes: linhas.filter(function (l) { return texto(l.github).indexOf("ok") !== 0; }).map(function (l) { return texto(l.id); }) };
}

/** Grava a cópia do sorteio no repositório (registros/<id>.json). O histórico do Git é público e datado. */
function publicarNoGithub(r) {
  var token = prop("GITHUB_TOKEN"), repo = prop("GITHUB_REPOSITORIO");
  if (!token || !repo) return "pendente: GitHub não configurado";
  var url = "https://api.github.com/repos/" + repo + "/contents/registros/" + encodeURIComponent(r.id) + ".json";
  var cab = { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  try {
    var resp = UrlFetchApp.fetch(url, {
      method: "put", contentType: "application/json", headers: cab, muteHttpExceptions: true,
      payload: JSON.stringify({
        message: "Sorteio " + r.id + " – " + r.nome,
        content: Utilities.base64Encode(JSON.stringify(r, null, 2) + "\n", Utilities.Charset.UTF_8),
        branch: prop("GITHUB_RAMO") || "main"
      })
    });
    var cod = resp.getResponseCode();
    if (cod === 200 || cod === 201) return "ok " + agoraIso();
    if (cod === 422) return "ok (já publicado)";
    return "pendente: GitHub respondeu " + cod;
  } catch (e) {
    return "pendente: " + String(e.message || e).slice(0, 120);
  }
}

function republicarPendentes() {
  ler("sorteios").forEach(function (l) {
    if (texto(l.github).indexOf("ok") === 0) return;
    l.github = publicarNoGithub(JSON.parse(texto(l.registro)));
    regravar("sorteios", l);
  });
}

/* =====================================================================
 * Sessões, login e usuários
 * ===================================================================== */

function hashSenha(senha, sal, iteracoes) {
  sal = sal || aleatorioHex().slice(0, 32);
  iteracoes = iteracoes || ITERACOES_SENHA;
  // PBKDF2-HMAC-SHA256, um bloco de 32 bytes.
  var chave = Utilities.newBlob(String(senha)).getBytes();
  var u = Utilities.computeHmacSha256Signature(hexParaBytes(sal).concat([0, 0, 0, 1]), chave), t = u.slice();
  for (var i = 1; i < iteracoes; i++) {
    u = Utilities.computeHmacSha256Signature(u, chave);
    for (var j = 0; j < t.length; j++) t[j] ^= u[j];
  }
  return "pbkdf2$" + iteracoes + "$" + sal + "$" + bytesParaHex(t);
}
function conferirSenha(senha, guardado) {
  var p = String(guardado || "").split("$");
  if (p.length !== 4 || p[0] !== "pbkdf2") return false;
  var calc = hashSenha(senha, p[2], Number(p[1])).split("$")[3], dif = 0;
  for (var i = 0; i < calc.length; i++) dif |= calc.charCodeAt(i) ^ (p[3].charCodeAt(i) || 0);
  return dif === 0 && calc.length === p[3].length;
}
function senhaProvisoria(login) { return login + anoAtual(); }

function descreverUsuario(l) {
  return { login: texto(l.login), nome: texto(l.nome), admin: !!num(l.admin), trocarSenha: !!num(l.trocar_senha) };
}
function buscarUsuario(login, linhas) {
  return (linhas || ler("usuarios")).filter(function (l) { return texto(l.login) === login; })[0];
}

function garantirAdmin() {
  var linhas = ler("usuarios");
  if (linhas.some(function (l) { return num(l.admin) && num(l.ativo); })) return null;
  var senha = senhaProvisoria(ADMIN_LOGIN), atual = buscarUsuario(ADMIN_LOGIN, linhas);
  if (atual) {
    atual.admin = 1; atual.ativo = 1; atual.senha = hashSenha(senha); atual.trocar_senha = 1; atual.geracao = num(atual.geracao) + 1;
    regravar("usuarios", atual);
  } else {
    inserir("usuarios", { login: ADMIN_LOGIN, nome: "Administrador", senha: hashSenha(senha), ativo: 1, admin: 1, trocar_senha: 1, geracao: 1, criado_em: agoraIso() });
  }
  registrarHistorico("usuarios", "", "Sistema", "Administrador inicial criado (usuário admin); a senha deve ser trocada no primeiro acesso.");
  return senha;
}

function cache() { return CacheService.getScriptCache(); }
function chaveSessao(token) { return "sessao:" + sha256(String(token)); }

function criarSessao(l) {
  var token = aleatorioHex() + aleatorioHex().slice(0, 32);
  cache().put(chaveSessao(token), texto(l.login) + "|" + num(l.geracao), SEGUNDOS_SESSAO);
  return token;
}
function encerrarSessao(token) { if (token) cache().remove(chaveSessao(token)); }

/** Usuário da sessão (ou null). Inativar, excluir ou redefinir a senha muda a "geração" e derruba as sessões abertas. */
function usuarioAtual(token) {
  if (!token) return null;
  var v = cache().get(chaveSessao(token));
  if (!v) return null;
  var p = v.split("|"), l = buscarUsuario(p[0]);
  if (!l || !num(l.ativo) || String(num(l.geracao)) !== p[1]) return null;
  return descreverUsuario(l);
}
function exigirConta(token) {
  var u = usuarioAtual(token);
  if (!u) throw Falha(401, "Entre com seu usuário para continuar.");
  return u;
}
function exigirUsuario(token) {
  var u = exigirConta(token);
  if (u.trocarSenha) throw Falha(403, "Troque a senha provisória em Minha conta antes de continuar.");
  return u;
}
function exigirAdmin(token) {
  var u = exigirUsuario(token);
  if (!u.admin) throw Falha(403, "Área restrita ao administrador.");
  return u;
}

function entrar(d) {
  var login = String(d.login || "").trim().toLowerCase(), chave = "falhas:" + login, falhas = Number(cache().get(chave) || 0);
  if (falhas >= 10) throw Falha(429, "Muitas tentativas. Aguarde 15 minutos e tente de novo.");
  var l = buscarUsuario(login);
  if (!l || !num(l.ativo) || !conferirSenha(String(d.senha || ""), texto(l.senha))) {
    cache().put(chave, String(falhas + 1), 900);
    throw Falha(401, "Usuário ou senha incorretos.");
  }
  cache().remove(chave);
  return { usuario: descreverUsuario(l), token: criarSessao(l) };
}

function validarLogin(login) {
  login = String(login || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(login)) throw Falha(422, "O usuário deve ter de 3 a 40 caracteres: letras minúsculas sem acento, números, ponto, hífen ou sublinhado.");
  return login;
}
function validarNomePessoa(nome) {
  nome = normalizar(nome);
  if (!nome || nome.length > 120) throw Falha(422, "Informe o nome completo (até 120 caracteres).");
  return nome;
}

function painelUsuarios() {
  var usuarios = ler("usuarios").map(function (l) {
    return { login: texto(l.login), nome: texto(l.nome), ativo: !!num(l.ativo), admin: !!num(l.admin), trocarSenha: !!num(l.trocar_senha), temSenha: !!texto(l.senha), criadoEm: texto(l.criado_em) };
  }).sort(function (a, b) { return (b.admin - a.admin) || a.nome.localeCompare(b.nome, "pt-BR"); });
  return { usuarios: usuarios, historico: historicoDe("usuarios", null).reverse().slice(0, 300) };
}

function alvoProtegido(login, quem) {
  var l = buscarUsuario(login);
  if (!l) throw Falha(422, "Usuário não encontrado.");
  if (texto(l.login) === quem.login) throw Falha(422, "Você não pode fazer isso com o seu próprio usuário.");
  if (num(l.admin)) throw Falha(422, "O usuário administrador não pode ser alterado por este painel.");
  return l;
}

function criarUsuario(d, quem) {
  var login = validarLogin(d.login), nome = validarNomePessoa(d.nome);
  if (buscarUsuario(login)) throw Falha(422, "Já existe um usuário com esse nome de acesso.");
  var senha = senhaProvisoria(login);
  inserir("usuarios", { login: login, nome: nome, senha: hashSenha(senha), ativo: 1, admin: 0, trocar_senha: 1, geracao: 1, criado_em: agoraIso() });
  registrarHistorico("usuarios", login, quem.nome, "Usuário criado: " + login + " (" + nome + ").");
  return senha;
}

function alterarUsuario(login, d, quem) {
  if ("nome" in d) {
    var l = buscarUsuario(login);
    if (!l) throw Falha(422, "Usuário não encontrado.");
    if (texto(l.login) !== quem.login && num(l.admin)) throw Falha(422, "O usuário administrador não pode ser alterado por este painel.");
    var nome = validarNomePessoa(d.nome), antigo = texto(l.nome);
    if (nome !== antigo) {
      l.nome = nome; regravar("usuarios", l);
      registrarHistorico("usuarios", login, quem.nome, "Usuário " + login + " renomeado: de " + antigo + " para " + nome + ".");
    }
  }
  if ("ativo" in d) {
    var a = alvoProtegido(login, quem);
    a.ativo = d.ativo ? 1 : 0; a.geracao = num(a.geracao) + 1; regravar("usuarios", a);
    registrarHistorico("usuarios", login, quem.nome, "Usuário " + login + " (" + texto(a.nome) + ") " + (d.ativo ? "reativado" : "inativado") + ".");
  }
}

function redefinirSenha(login, quem) {
  var a = alvoProtegido(login, quem), senha = senhaProvisoria(login);
  a.senha = hashSenha(senha); a.trocar_senha = 1; a.geracao = num(a.geracao) + 1; regravar("usuarios", a);
  registrarHistorico("usuarios", login, quem.nome, "Senha de " + login + " (" + texto(a.nome) + ") redefinida para a senha provisória.");
  return senha;
}

function excluirUsuario(login, quem) {
  var a = alvoProtegido(login, quem);
  apagarLinha("usuarios", a);
  registrarHistorico("usuarios", login, quem.nome, "Usuário " + login + " (" + texto(a.nome) + ") excluído. O histórico dos sorteios mantém o nome de quem fez cada alteração.");
}

function trocarPropriaSenha(u, d, token) {
  var l = buscarUsuario(u.login), nova = String(d.nova || "");
  if (!conferirSenha(String(d.atual || ""), texto(l.senha))) throw Falha(422, "A senha atual está incorreta.");
  if (nova.length < SENHA_MINIMA) throw Falha(422, "A senha deve ter pelo menos " + SENHA_MINIMA + " caracteres.");
  if (nova.length > 200) throw Falha(422, "Senha longa demais.");
  if (nova === d.atual || nova === senhaProvisoria(u.login)) throw Falha(422, "A nova senha deve ser diferente da senha provisória.");
  l.senha = hashSenha(nova); l.trocar_senha = 0; l.geracao = num(l.geracao) + 1; regravar("usuarios", l);
  // As outras sessões caem com a nova geração; a atual é renovada.
  cache().put(chaveSessao(token), u.login + "|" + num(l.geracao), SEGUNDOS_SESSAO);
  registrarHistorico("usuarios", u.login, u.nome, u.nome + " trocou a própria senha.");
  return { usuario: descreverUsuario(l) };
}

/* =====================================================================
 * Sorteios em preparação ("chamadas") e inscrições
 * ===================================================================== */

function validarChamada(dados) {
  if (!dados || typeof dados !== "object") throw Falha(422, "Dados do sorteio ausentes.");
  var nome = campoTexto(dados, "nome", 160), responsavel = campoTexto(dados, "responsavel", 120);
  var vagas = parseInt(dados.vagas, 10);
  if (isNaN(vagas) || String(vagas) !== String(dados.vagas).trim()) throw Falha(422, "Número de vagas inválido.");
  if (vagas < VAGAS_MIN || vagas > VAGAS_MAX) throw Falha(422, "O número de vagas deve ficar entre " + VAGAS_MIN + " e " + VAGAS_MAX + ".");
  var r = dados.reserva || {};
  var reserva = { ativa: !!r.ativa, arredondamento: r.arredondamento === "baixo" ? "baixo" : "cima" };
  var ev = dados.evento || {};
  var inicio = campoData(ev.inicio, "início do evento"), fim = campoData(ev.fim, "término do evento", false) || inicio;
  if (fim < inicio) throw Falha(422, "O término do evento é anterior ao início.");
  var textoPub = String(dados.textoPublico || "").replace(/\r\n/g, "\n").trim();
  if (textoPub.length > 6000) throw Falha(422, "O texto público passa de 6.000 caracteres.");
  var link = String(dados.linkExterno || "").trim();
  if (link && (link.length > 500 || !/^https?:\/\/\S+$/.test(link))) throw Falha(422, "O endereço do formulário externo deve começar com https://.");
  var ii = campoDataHora(dados.inscricaoInicio, "o início das inscrições"), fi = campoDataHora(dados.inscricaoFim, "o encerramento das inscrições");
  var ds = campoDataHora(dados.dataSorteio, "a data do sorteio");
  if (fi <= ii) throw Falha(422, "O encerramento das inscrições deve ser posterior ao início.");
  if (ds < fi) throw Falha(422, "O sorteio deve ocorrer depois do encerramento das inscrições.");
  return {
    nome: nome, responsavel: responsavel, vagas: vagas, reserva: reserva,
    evento: { inicio: inicio, fim: fim, local: campoTexto(ev, "local", 120, false) },
    textoPublico: textoPub, formularioPublico: !!dados.formularioPublico, linkExterno: link, exigeAtuacao: !!dados.exigeAtuacao,
    inscricaoInicio: ii, inscricaoFim: fi, dataSorteio: ds,
    modoSorteio: MODOS[dados.modoSorteio] ? dados.modoSorteio : "manual",
    sementeExterna: campoTexto(dados, "sementeExterna", 200, false)
  };
}

function situacaoChamada(d, sorteioId) {
  var a = agoraLocal();
  if (sorteioId) return "sorteado";
  if (a < d.inscricaoInicio) return "agendado";
  if (a < d.inscricaoFim) return "aberto";
  return "encerrado";
}

function inscricaoObj(l) {
  var n = function (v) { return v === "" || v === null || v === undefined ? null : Number(v); };
  return { seq: num(l.seq), nome: texto(l.nome), email: texto(l.email), interesse: n(l.interesse), atua: n(l.atua), origem: texto(l.origem),
    criado_em: texto(l.criado_em), mulher: num(l.mulher), excluida: texto(l.excluida) || null, _linha: l._linha, chamada_id: texto(l.chamada_id) };
}
function inscricoesDe(id, todas) {
  return (todas || ler("inscricoes")).filter(function (l) { return texto(l.chamada_id) === id; }).map(inscricaoObj)
    .sort(function (a, b) { return a.seq - b.seq; });
}
function semLinha(i) { var o = {}; Object.keys(i).forEach(function (k) { if (k !== "_linha" && k !== "chamada_id") o[k] = i[k]; }); return o; }

function motivoFora(d, i) {
  if (i.excluida) return "Excluída pela equipe: " + i.excluida;
  if (i.interesse === 0) return "Declarou não ter interesse ou disponibilidade";
  if (d.exigeAtuacao && i.atua === 0) return "Declarou não atuar na área";
  return null;
}
function concorrentes(d, lista) { return lista.filter(function (i) { return motivoFora(d, i) === null; }); }

function chamadaLinha(id, linhas) {
  var l = (linhas || ler("chamadas")).filter(function (x) { return texto(x.id) === id; })[0];
  if (!l) throw Falha(404, "Sorteio não encontrado.");
  return l;
}
function dadosChamada(l) { return JSON.parse(texto(l.dados)); }

function publica(l, n) {
  var d = dadosChamada(l), sid = texto(l.sorteio_id) || null;
  return { id: texto(l.id), nome: d.nome, vagas: d.vagas, reserva: d.reserva, evento: d.evento, textoPublico: d.textoPublico,
    formularioPublico: d.formularioPublico, linkExterno: d.linkExterno, exigeAtuacao: d.exigeAtuacao, inscricaoInicio: d.inscricaoInicio,
    inscricaoFim: d.inscricaoFim, dataSorteio: d.dataSorteio, modoSorteio: d.modoSorteio, sorteioId: sid, inscritos: n, situacao: situacaoChamada(d, sid) };
}
function listarChamadasPublicas() {
  var ins = ler("inscricoes"), cont = {};
  ins.forEach(function (i) { var k = texto(i.chamada_id); cont[k] = (cont[k] || 0) + 1; });
  return ler("chamadas").map(function (l) { return publica(l, cont[texto(l.id)] || 0); });
}

function completa(l, ins, hist) {
  var d = dadosChamada(l), id = texto(l.id), sid = texto(l.sorteio_id) || null;
  return { id: id, dados: d, versao: num(l.versao), sorteioId: sid, confirmacao: texto(l.confirmacao) || null, aviso: texto(l.aviso) || null,
    criadoPor: texto(l.criado_por), criadoEm: texto(l.criado_em), inscricoes: inscricoesDe(id, ins).map(semLinha),
    historico: historicoDe("chamada", id, hist), situacao: situacaoChamada(d, sid) };
}
function listarChamadasEquipe() {
  var ins = ler("inscricoes"), hist = ler("historico"), saida = {};
  ler("chamadas").forEach(function (l) { saida[texto(l.id)] = completa(l, ins, hist); });
  return saida;
}
function chamadaCompleta(id) { return completa(chamadaLinha(id), null, null); }

function resumoCriacao(d) {
  return "Sorteio criado: " + d.vagas + " vaga(s); inscrições de " + dataHoraBR(d.inscricaoInicio) + " a " + dataHoraBR(d.inscricaoFim) +
    "; sorteio " + MODOS[d.modoSorteio] + " em " + dataHoraBR(d.dataSorteio) + "; " + (d.formularioPublico ? "com" : "sem") + " formulário público.";
}

function criarChamada(dados, u) {
  var d = validarChamada(dados), linhas = ler("chamadas"), prefixo = "c" + anoAtual() + "-";
  var n = linhas.filter(function (l) { return texto(l.id).indexOf(prefixo) === 0; }).length + 1;
  var id = prefixo + ("00" + n).slice(-3);
  inserir("chamadas", { id: id, dados: JSON.stringify(d), versao: 1, sorteio_id: "", confirmacao: "", aviso: "", criado_por: u.login, criado_em: agoraIso() });
  registrarHistorico("chamada", id, u.nome, resumoCriacao(d));
  return chamadaCompleta(id);
}

var ROTULOS_CHAMADA = [["nome", "nome"], ["responsavel", "responsável"], ["vagas", "vagas"], ["reserva", "reserva feminina"], ["evento", "dados do evento"],
  ["textoPublico", "texto público"], ["formularioPublico", "formulário público"], ["linkExterno", "formulário externo"],
  ["exigeAtuacao", "exigência de atuação na área"], ["inscricaoInicio", "início das inscrições"], ["inscricaoFim", "encerramento das inscrições"],
  ["dataSorteio", "data do sorteio"], ["modoSorteio", "modo do sorteio"], ["sementeExterna", "semente externa"]];
function camposAlterados(antigo, novo) {
  return ROTULOS_CHAMADA.filter(function (r) { return canon(antigo[r[0]]) !== canon(novo[r[0]]); }).map(function (r) {
    var k = r[0], v = novo[k], valor = null;
    if (k === "inscricaoInicio" || k === "inscricaoFim" || k === "dataSorteio") valor = dataHoraBR(v);
    else if (k === "modoSorteio") valor = MODOS[v];
    else if (k === "formularioPublico" || k === "exigeAtuacao") valor = v ? "sim" : "não";
    else if (k === "vagas") valor = String(v);
    return valor ? r[1] + " (" + valor + ")" : r[1];
  });
}

function desfazerConfirmacao(l, usuario, motivo) {
  if (texto(l.confirmacao)) {
    l.confirmacao = ""; regravar("chamadas", l);
    registrarHistorico("chamada", texto(l.id), usuario, "Confirmação das inscritas desfeita (" + motivo + "). É preciso conferir e confirmar de novo.");
  }
}

function gravarChamada(id, corpo, u) {
  var l = chamadaLinha(id), antigo = dadosChamada(l), novo = corpo.dados && typeof corpo.dados === "object" ? corpo.dados : {}, d;
  if (texto(l.sorteio_id)) {
    // Depois do sorteio, só o texto público pode mudar: o resto já consta do registro público.
    d = JSON.parse(JSON.stringify(antigo));
    d.textoPublico = String(novo.textoPublico === undefined ? antigo.textoPublico : novo.textoPublico || "").replace(/\r\n/g, "\n").trim().slice(0, 6000);
  } else {
    d = validarChamada(novo);
  }
  if (Number(corpo.versao) !== num(l.versao)) throw Falha(409, "Outra pessoa alterou este sorteio. A tela foi atualizada; repita a alteração.");
  var mudou = camposAlterados(antigo, d);
  if (mudou.length) {
    l.dados = JSON.stringify(d); l.versao = num(l.versao) + 1; l.aviso = ""; regravar("chamadas", l);
    registrarHistorico("chamada", id, u.nome, "Alterado: " + mudou.join("; ") + ".");
    if (canon(d.reserva) !== canon(antigo.reserva) || d.exigeAtuacao !== antigo.exigeAtuacao) desfazerConfirmacao(l, u.nome, "regra alterada");
  }
  return chamadaCompleta(id);
}

var REGEX_EMAIL = /^[^\s@<>;,"'()]+@([^\s@<>;,"'()]+\.[^\s@<>;,"'()]+)$/;
function validarEmailInstitucional(email) {
  email = String(email || "").trim().toLowerCase();
  var m = REGEX_EMAIL.exec(email);
  if (!m || email.length > 200) throw Falha(422, "Informe um e-mail válido.");
  var doms = dominiosEmail(), dom = m[1];
  if (doms.length && !doms.some(function (d) { return dom === d || dom.slice(-(d.length + 1)) === "." + d; }))
    throw Falha(422, "Use o e-mail institucional (" + doms.map(function (d) { return "@" + d; }).join(", ") + ").");
  return email;
}
function simNao(v, campo) {
  if (v === "sim" || v === true) return 1;
  if (v === "nao" || v === "não" || v === false) return 0;
  throw Falha(422, "Responda se " + campo + ".");
}
function conflito(existentes, nome, email) {
  for (var i = 0; i < existentes.length; i++) {
    if (chaveNome(existentes[i].nome) === chaveNome(nome)) return "Já existe uma inscrição com este nome.";
    if (email && existentes[i].email === email) return "Já existe uma inscrição com este e-mail.";
  }
  return null;
}
function proximaSeq(todas) { return todas.reduce(function (m, l) { return Math.max(m, num(l.seq)); }, 0) + 1; }

function inscrever(id, d) {
  if (d.site) throw Falha(422, "Inscrição recusada.");  // campo invisível: só robôs o preenchem
  var nome = normalizar(d.nome);
  if (nome.length < 5 || nome.indexOf(" ") < 0) throw Falha(422, "Informe o nome completo.");
  if (nome.length > 200) throw Falha(422, "Nome longo demais.");
  if (d.ciente !== true) throw Falha(422, "É preciso declarar ciência da publicação do nome no resultado do sorteio.");
  var email = validarEmailInstitucional(d.email);
  var interesse = simNao(d.interesse, "tem interesse e disponibilidade de comparecer"), atua = simNao(d.atua, "atua na área");
  // Freio contra envios em massa: no máximo 60 inscrições por minuto no sistema todo.
  var minuto = "inscricoes:" + Utilities.formatDate(new Date(), FUSO, "yyyyMMddHHmm"), n = Number(cache().get(minuto) || 0);
  if (n >= 60) throw Falha(429, "Muitos envios neste momento. Tente de novo em um minuto.");
  cache().put(minuto, String(n + 1), 120);
  return comTrava(function () {
    var l = chamadaLinha(id), ch = dadosChamada(l), fase = situacaoChamada(ch, texto(l.sorteio_id));
    if (!ch.formularioPublico) throw Falha(409, "Este sorteio não recebe inscrições por este formulário.");
    if (fase === "agendado") throw Falha(409, "As inscrições abrem em " + dataHoraBR(ch.inscricaoInicio) + ".");
    if (fase !== "aberto") throw Falha(409, "As inscrições estão encerradas.");
    var todas = ler("inscricoes"), existentes = inscricoesDe(id, todas);
    if (existentes.length >= 3000) throw Falha(409, "Limite de inscrições atingido.");
    var erro = conflito(existentes, nome, email);
    if (erro) throw Falha(409, erro);
    var quando = agoraIso();
    inserir("inscricoes", { seq: proximaSeq(todas), chamada_id: id, nome: nome, email: email, interesse: interesse, atua: atua, origem: "formulario", criado_em: quando, mulher: 0, excluida: "" });
    registrarHistorico("chamada", id, FORMULARIO, "Inscrição recebida: " + nome + ".");
    desfazerConfirmacao(l, FORMULARIO, "nova inscrição");
    return { numero: existentes.length + 1, quando: quando, nome: nome, email: email };
  });
}

function lerLinhasEquipe(t) {
  var saida = [], erros = [];
  String(t || "").split(/\r?\n/).forEach(function (linha) {
    linha = linha.trim();
    if (!linha) return;
    var m = /[^\s<>;,"'()]+@[^\s<>;,"'()]+\.[^\s<>;,"'()]+/.exec(linha), email = m ? m[0].toLowerCase() : "";
    if (email && !REGEX_EMAIL.test(email)) { erros.push(linha); return; }
    var nome = normalizar((m ? linha.replace(m[0], " ") : linha).replace(/[;,\t<>()]/g, " "));
    if (!nome || nome.length > 200) { erros.push(linha); return; }
    saida.push({ nome: nome, email: email });
  });
  return { linhas: saida, erros: erros };
}

function inscreverPelaEquipe(id, corpo, u) {
  var l = chamadaLinha(id);
  if (texto(l.sorteio_id)) throw Falha(409, "O sorteio já foi realizado; as inscrições não podem mais ser alteradas.");
  var lido = lerLinhasEquipe(corpo.texto), recusadas = lido.erros.slice(), incluidas = [];
  var todas = ler("inscricoes"), existentes = inscricoesDe(id, todas), seq = proximaSeq(todas), novas = [];
  lido.linhas.forEach(function (i) {
    var erro = conflito(existentes, i.nome, i.email);
    if (erro) { recusadas.push(i.nome + " (" + erro.toLowerCase().replace(/\.$/, "") + ")"); return; }
    novas.push(linhaDe("inscricoes", { seq: seq++, chamada_id: id, nome: i.nome, email: i.email, interesse: "", atua: "", origem: "equipe", criado_em: agoraIso(), mulher: 0, excluida: "" }));
    existentes.push(i); incluidas.push(i.nome);
  });
  if (novas.length) {
    var a = aba("inscricoes");
    a.getRange(a.getLastRow() + 1, 1, novas.length, ABAS.inscricoes.length).setValues(novas);
    registrarHistorico("chamada", id, u.nome, incluidas.length + " inscrição(ões) lançada(s) pela equipe: " + incluidas.join(", ") + ".");
    desfazerConfirmacao(l, u.nome, "nova inscrição");
  }
  return { incluidas: incluidas, recusadas: recusadas, chamada: chamadaCompleta(id) };
}

function alterarInscricao(id, seq, corpo, u) {
  var l = chamadaLinha(id);
  if (texto(l.sorteio_id)) throw Falha(409, "O sorteio já foi realizado; as inscrições não podem mais ser alteradas.");
  var linha = ler("inscricoes").filter(function (x) { return texto(x.chamada_id) === id && num(x.seq) === seq; })[0];
  if (!linha) throw Falha(404, "Inscrição não encontrada.");
  var nome = texto(linha.nome);
  if ("mulher" in corpo) {
    var m = corpo.mulher ? 1 : 0;
    if (m !== num(linha.mulher)) {
      linha.mulher = m; regravar("inscricoes", linha);
      registrarHistorico("chamada", id, u.nome, nome + ": " + (m ? "marcada" : "desmarcada") + " para as vagas reservadas.");
      desfazerConfirmacao(l, u.nome, "marcação alterada");
    }
  }
  if ("excluida" in corpo) {
    var motivo = corpo.excluida === null ? "" : normalizar(corpo.excluida).slice(0, 200);
    if (corpo.excluida !== null && !motivo) throw Falha(422, "Informe o motivo da exclusão.");
    if (motivo !== texto(linha.excluida)) {
      linha.excluida = motivo; regravar("inscricoes", linha);
      registrarHistorico("chamada", id, u.nome, nome + ": " + (motivo ? "excluída do sorteio (" + motivo + ")." : "reincluída no sorteio."));
      desfazerConfirmacao(l, u.nome, "lista de concorrentes alterada");
    }
  }
  return chamadaCompleta(id);
}

function confirmarInscritas(id, corpo, u) {
  var l = chamadaLinha(id);
  if (texto(l.sorteio_id)) throw Falha(409, "O sorteio já foi realizado; as inscrições não podem mais ser alteradas.");
  if (corpo.confirmar) {
    var n = concorrentes(dadosChamada(l), inscricoesDe(id)).filter(function (i) { return i.mulher; }).length;
    l.confirmacao = u.nome + ", em " + Utilities.formatDate(new Date(), FUSO, "dd/MM/yyyy 'às' HH:mm"); regravar("chamadas", l);
    registrarHistorico("chamada", id, u.nome, "Confirmada a lista de " + n + " inscrita(s) que concorrem às vagas reservadas.");
  } else {
    desfazerConfirmacao(l, u.nome, "a pedido");
  }
  return chamadaCompleta(id);
}

/* =====================================================================
 * Realização do sorteio
 * ===================================================================== */

function pendencias(d, l, lista, automatico) {
  var a = agoraLocal(), falta = [];
  if (texto(l.sorteio_id)) return ["O sorteio já foi realizado."];
  if (a < d.inscricaoFim) falta.push("as inscrições terminam em " + dataHoraBR(d.inscricaoFim));
  if (automatico && a < d.dataSorteio) falta.push("o sorteio automático está agendado para " + dataHoraBR(d.dataSorteio));
  if (!concorrentes(d, lista).length) falta.push("não há inscrições que concorram ao sorteio");
  if (d.reserva.ativa && !texto(l.confirmacao)) falta.push("a lista de inscritas que concorrem às vagas reservadas ainda não foi confirmada");
  return falta;
}

function controlePadrao(r) {
  var ev = r.evento || {}, conv = function (i, vaga) {
    return { idx: i, vaga: vaga, origem: "sorteio", substitui: null, presenca: "aguardando", relatorio: "pendente", dataRelatorio: "", convocadaEm: hoje() };
  };
  return {
    convocacoes: r.resultado.reservadas.map(function (i) { return conv(i, "reservada"); }).concat(r.resultado.ampla.map(function (i) { return conv(i, "ampla"); })),
    emails: {}, evento: { inicio: ev.inicio || "", fim: ev.fim || ev.inicio || "", local: ev.local || "" }, prazoConfirmacao: "", prazoRelatorio: ""
  };
}

/** Faz o sorteio. Deve ser chamado dentro de comTrava. */
function realizar(id, usuario, automatico) {
  var l = chamadaLinha(id), d = dadosChamada(l);
  if (automatico && d.modoSorteio !== "automatico") throw Falha(409, "Este sorteio é manual.");
  var inscricoes = inscricoesDe(id), falta = pendencias(d, l, inscricoes, automatico);
  if (falta.length) throw Falha(409, "Ainda não é possível sortear: " + falta.join("; ") + ".");
  var lista = concorrentes(d, inscricoes);
  var mulheres = [];
  if (d.reserva.ativa) lista.forEach(function (i, k) { if (i.mulher) mulheres.push(k); });
  var linhas = ler("sorteios"), prefixo = "s" + anoAtual() + "-";
  var sid = prefixo + ("00" + (linhas.filter(function (x) { return texto(x.id).indexOf(prefixo) === 0; }).length + 1)).slice(-3);
  var r = montarRegistro({ nome: d.nome, responsavel: d.responsavel, vagas: d.vagas, participantes: lista.map(function (i) { return i.nome; }),
    reserva: d.reserva, mulheres: mulheres, evento: d.evento, sementeExterna: d.sementeExterna },
    sid, linhas.length ? texto(linhas[linhas.length - 1].hash) : null, {
      chamada: id, inicio: d.inscricaoInicio, encerramento: d.inscricaoFim, fuso: FUSO, formularioPublico: d.formularioPublico,
      inscricoesRecebidas: inscricoes.length, inscricoesConcorrentes: lista.length, modo: d.modoSorteio, dataPrevista: d.dataSorteio
    });
  var json = JSON.stringify(r);
  if (json.length > LIMITE_CELULA) throw Falha(422, "A lista de inscritos é grande demais para uma célula da planilha (limite de cerca de 1.500 nomes).");
  var quem = automatico ? SISTEMA : usuario.nome;
  inserir("sorteios", { id: sid, hash: r.hash, registro: json, criado_por: usuario.login, criado_em: agoraIso(), github: "pendente" });
  var ctl = controlePadrao(r);
  lista.forEach(function (i, k) { if (i.email) ctl.emails[String(k)] = i.email; });
  inserir("controle", { id: sid, dados: JSON.stringify(ctl), versao: 1 });
  l.sorteio_id = sid; l.aviso = ""; regravar("chamadas", l);
  var t = "Sorteio " + (automatico ? "automático" : "manual") + " realizado (" + lista.length + " concorrentes de " + inscricoes.length + " inscrições, " + r.vagas + " vagas).";
  registrarHistorico("chamada", id, quem, t + " Registro público " + sid + ".");
  registrarHistorico("sorteio", sid, quem, t + " Origem: " + id + ".");
  // Cópia permanente no GitHub; se falhar, a tarefa periódica tenta de novo.
  var linhaNova = ler("sorteios").filter(function (x) { return texto(x.id) === sid; })[0];
  linhaNova.github = publicarNoGithub(r); regravar("sorteios", linhaNova);
  return r;
}

function sortearManual(id, u) {
  return comTrava(function () {
    if (dadosChamada(chamadaLinha(id)).modoSorteio !== "manual") throw Falha(409, "Este sorteio é automático: o sistema o realiza na data agendada.");
    return realizar(id, u, false);
  });
}

function executarAutomaticos() {
  var feitos = [], agora = agoraLocal();
  ler("chamadas").forEach(function (l) {
    if (texto(l.sorteio_id)) return;
    var d = dadosChamada(l);
    if (d.modoSorteio !== "automatico" || agora < d.dataSorteio) return;
    comTrava(function () {
      try {
        feitos.push(realizar(texto(l.id), { login: texto(l.criado_por), nome: SISTEMA }, true));
      } catch (e) {
        if (!e.status) throw e;
        var atual = chamadaLinha(texto(l.id)), aviso = "Sorteio automático suspenso. " + e.message;
        if (aviso !== texto(atual.aviso)) {
          atual.aviso = aviso; regravar("chamadas", atual);
          registrarHistorico("chamada", texto(l.id), SISTEMA, aviso);
        }
      }
    });
  });
  return feitos;
}

/* =====================================================================
 * Controle interno (presença, desistências, e-mails, relatórios)
 * ===================================================================== */

function lerControles() {
  var regs = listarSorteios(), salvos = {}, hist = ler("historico"), saida = {};
  ler("controle").forEach(function (l) { salvos[texto(l.id)] = { dados: JSON.parse(texto(l.dados)), versao: num(l.versao) }; });
  regs.forEach(function (r) {
    var s = salvos[r.id] || { dados: controlePadrao(r), versao: 0 };
    saida[r.id] = { dados: s.dados, versao: s.versao, historico: historicoDe("sorteio", r.id, hist) };
  });
  return saida;
}

function dataOpcional(v) { return v ? campoData(v, "data") : ""; }

function validarControle(r, dados) {
  if (!dados || !Array.isArray(dados.convocacoes)) throw Falha(422, "Dados de controle em formato inválido.");
  var n = r.participantes.length, vistos = {};
  var convs = dados.convocacoes.map(function (c) {
    var idx = parseInt(c.idx, 10);
    if (isNaN(idx) || idx < 0 || idx >= n) throw Falha(422, "Pessoa inexistente no sorteio.");
    if (vistos[idx]) throw Falha(422, "A mesma pessoa aparece convocada duas vezes.");
    vistos[idx] = true;
    return {
      idx: idx, vaga: c.vaga === "reservada" ? "reservada" : "ampla", origem: c.origem === "suplente" ? "suplente" : "sorteio",
      substitui: c.substitui === null || c.substitui === undefined ? null : parseInt(c.substitui, 10),
      presenca: PRESENCA[c.presenca] ? c.presenca : "aguardando", relatorio: RELATORIO[c.relatorio] ? c.relatorio : "pendente",
      dataRelatorio: dataOpcional(c.dataRelatorio), convocadaEm: dataOpcional(c.convocadaEm) || hoje()
    };
  });
  var emails = {};
  Object.keys(dados.emails || {}).forEach(function (k) {
    var i = parseInt(k, 10), v = String(dados.emails[k] || "").trim().toLowerCase();
    if (isNaN(i) || i < 0 || i >= n || !v) return;
    if (v.length > 200 || v.indexOf("@") < 0) throw Falha(422, "E-mail inválido: " + v);
    emails[String(i)] = v;
  });
  var ev = dados.evento || {}, inicio = dataOpcional(ev.inicio), fim = dataOpcional(ev.fim);
  if (inicio && fim && fim < inicio) fim = inicio;
  return { convocacoes: convs, emails: emails, evento: { inicio: inicio, fim: fim, local: String(ev.local || "").slice(0, 120) },
    prazoConfirmacao: dataOpcional(dados.prazoConfirmacao), prazoRelatorio: dataOpcional(dados.prazoRelatorio) };
}

function gravarControle(id, corpo, u) {
  var linhaS = ler("sorteios").filter(function (x) { return texto(x.id) === id; })[0];
  if (!linhaS) throw Falha(404, "Sorteio não encontrado.");
  var r = JSON.parse(texto(linhaS.registro)), dados = validarControle(r, corpo.dados);
  var l = ler("controle").filter(function (x) { return texto(x.id) === id; })[0], versaoAtual = l ? num(l.versao) : 0;
  if (Number(corpo.versao) !== versaoAtual) throw Falha(409, "Outra pessoa alterou este controle. A tela foi atualizada; repita a alteração.");
  var json = JSON.stringify(dados);
  if (l) { l.dados = json; l.versao = versaoAtual + 1; regravar("controle", l); }
  else inserir("controle", { id: id, dados: json, versao: 1 });
  registrarHistorico("sorteio", id, u.nome, String(corpo.acao || "Controle atualizado.").slice(0, 500));
  return { dados: dados, versao: versaoAtual + 1, historico: historicoDe("sorteio", id) };
}
