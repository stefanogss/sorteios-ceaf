/* Sorteios CEAF – interface. Páginas públicas (registro, atas, verificação) e área da equipe (sorteio, controle). */
(function () {
"use strict";

var ZEROS = "0000000000000000000000000000000000000000000000000000000000000000";
var NORMA = "A seleção observará os critérios definidos no Despacho da Procuradora-Geral de Justiça proferido no Procedimento Administrativo (SGA) n. 2025/031558, que prevê a reserva de 50% das vagas para participação feminina nos cursos e eventos externos de curta duração custeados pelo CEAF, quando houver limitação de vagas e necessidade de sorteio.";
var CAMPOS_SEMENTE = ["versao", "id", "nome", "dataHora", "vagas", "reserva", "participantes", "mulheres", "entropia", "sementeExterna", "anterior"];

/* ---------- núcleo (idêntico a verificar_sorteio.py, usado aqui para conferir no navegador) ---------- */
var codificador = new TextEncoder();
function sha256(texto) {
  return crypto.subtle.digest("SHA-256", codificador.encode(texto)).then(function (b) {
    return Array.prototype.map.call(new Uint8Array(b), function (x) { return x.toString(16).padStart(2, "0"); }).join("");
  });
}
function canon(v) {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
  return JSON.stringify(v);
}
function gerador(semente, fluxo) {
  var contador = 0;
  return async function (n) {
    var limite = Math.floor(4294967296 / n) * n;
    for (;;) {
      var h = await sha256(semente + ":" + fluxo + ":" + contador);
      contador++;
      var x = parseInt(h.slice(0, 8), 16);
      if (x < limite) return x % n;
    }
  };
}
async function embaralhar(lista, semente, fluxo) {
  var aleatorio = gerador(semente, fluxo), urna = lista.slice(), saida = [];
  while (urna.length) { var i = await aleatorio(urna.length); saida.push(urna.splice(i, 1)[0]); }
  return saida;
}
function vagasReservadas(vagas, reserva) {
  if (!reserva.ativa) return 0;
  return reserva.arredondamento === "baixo" ? Math.floor(vagas / 2) : Math.ceil(vagas / 2);
}
async function sortear(r) {
  var k = vagasReservadas(r.vagas, r.reserva), filaMulheres = [], reservadas = [];
  if (k > 0 && r.mulheres.length) {
    filaMulheres = await embaralhar(r.mulheres.slice().sort(function (a, b) { return a - b; }), r.semente, "F");
    reservadas = filaMulheres.slice(0, k);
  }
  var resto = r.participantes.map(function (_, i) { return i; }).filter(function (i) { return reservadas.indexOf(i) < 0; });
  var filaGeral = await embaralhar(resto, r.semente, "G");
  var nAmpla = r.vagas - reservadas.length, ampla = filaGeral.slice(0, nAmpla);
  var sel = reservadas.concat(ampla);
  return {
    reservadas: reservadas,
    ampla: ampla,
    suplentesGerais: filaGeral.slice(nAmpla),
    suplentesMulheres: filaMulheres.filter(function (i) { return sel.indexOf(i) < 0; })
  };
}
function entradaSemente(r) { var e = {}; CAMPOS_SEMENTE.forEach(function (c) { e[c] = r[c]; }); return e; }
function semHash(r) { var e = {}; Object.keys(r).forEach(function (c) { if (c !== "hash") e[c] = r[c]; }); return e; }
async function verificar(r, anterior) {
  var semente = await sha256(canon(entradaSemente(r)));
  var resultado = await sortear(r);
  var hash = await sha256(canon(semHash(r)));
  return {
    semente: semente === r.semente,
    resultado: canon(resultado) === canon(r.resultado),
    hash: hash === r.hash,
    cadeia: anterior === undefined ? null : r.anterior === (anterior ? anterior.hash : ZEROS)
  };
}
/* ---------- fim do núcleo ---------- */

/* ---------- utilidades ---------- */
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function normalizar(nome) { return nome.normalize("NFC").replace(/\s+/g, " ").trim(); }
function dataLocal(iso) {
  try { return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "long", timeStyle: "medium" }) + " (horário de Brasília)"; }
  catch (e) { return iso; }
}
function lerLocal(chave) { try { return JSON.parse(localStorage.getItem(chave)); } catch (e) { return null; } }
function gravarLocal(chave, valor) { try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) {} }
function apagarLocal(chave) { try { localStorage.removeItem(chave); } catch (e) {} }
function textoArredondamento(r) { return r === "baixo" ? "para baixo" : "para cima"; }
function diaLocal(iso) { try { return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }); } catch (e) { return iso.slice(0, 10); } }
function hojeISO() { try { return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }); } catch (e) { return new Date().toISOString().slice(0, 10); } }
function dataBR(iso) { if (!iso) return ""; var p = iso.split("-"); return p[2] + "/" + p[1] + "/" + p[0]; }
function diasEntre(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); }
function textoPeriodo(ev) {
  if (!ev || !ev.inicio) return "data a definir";
  var t = !ev.fim || ev.fim === ev.inicio ? "em " + dataBR(ev.inicio) : "de " + dataBR(ev.inicio) + " a " + dataBR(ev.fim);
  return t + (ev.local ? ", " + ev.local : "");
}
function clonar(o) { return JSON.parse(JSON.stringify(o)); }
function enderecoBase() { return location.href.split("#")[0].split("?")[0]; }
function linkDe(id) { return enderecoBase() + "#" + id; }
function baixarTexto(nome, texto, tipo) {
  var a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([texto], { type: tipo }));
  a.download = nome; document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function copiar(texto, quandoOk, quandoFalha) {
  if (!navigator.clipboard) { quandoFalha(); return; }
  navigator.clipboard.writeText(texto).then(quandoOk, quandoFalha);
}

/* ---------- comunicação com o servidor ---------- */
/* O servidor é o Google Apps Script (ver config.js). Todas as chamadas vão por POST com texto simples,
   o que dispensa a verificação prévia de CORS; o token da sessão vai no corpo. */
var CONFIG = window.SORTEIO_CONFIG || {};
var CHAVE_TOKEN = "ceaf-sorteio-token";
function api(metodo, caminho, corpo) {
  var pedido = { metodo: metodo, caminho: caminho, corpo: corpo, token: lerLocal(CHAVE_TOKEN) };
  var envio;
  if (CONFIG.api === "local") envio = new Promise(function (ok) { setTimeout(function () { ok(window.SIMULADOR.chamar(pedido)); }, 50); });
  else if (!/^https:\/\//.test(CONFIG.api || "")) envio = Promise.reject(new Error("O endereço do servidor (Apps Script) ainda não foi informado em config.js."));
  else envio = fetch(CONFIG.api, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(pedido), redirect: "follow" })
    .then(function (r) { return r.json(); }, function () { throw new Error("Sem conexão com o servidor. Verifique a internet e tente de novo."); });
  return envio.then(function (d) {
    if (caminho === "/api/logout") apagarLocal(CHAVE_TOKEN);
    if (!d || !d.ok) { var e = new Error((d && d.detail) || "Erro de comunicação com o servidor."); e.status = (d && d.status) || 0; throw e; }
    if (d.dados && d.dados.token) gravarLocal(CHAVE_TOKEN, d.dados.token);
    return d.dados;
  });
}

/* QR code gerado no navegador (biblioteca em vendor/qrcode.js). */
var qrCache = {};
function qrPng(texto) {
  if (qrCache[texto]) return qrCache[texto];
  if (!window.qrcode) return "";
  var q = window.qrcode(0, "M"); q.addData(texto); q.make();
  var n = q.getModuleCount(), esc8 = 8, borda = 4, tam = (n + 2 * borda) * esc8;
  var cv = document.createElement("canvas"); cv.width = cv.height = tam;
  var cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, tam, tam); cx.fillStyle = "#000";
  for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) if (q.isDark(i, j)) cx.fillRect((j + borda) * esc8, (i + borda) * esc8, esc8, esc8);
  return (qrCache[texto] = cv.toDataURL("image/png"));
}

/* ---------- estado ---------- */
var estado = { usuario: null, modoLogin: "senha", urlBase: "", dominiosEmail: [], registros: [], chamadas: [], carregado: false, erro: "" };
var controles = {};
var equipe = {};
var telaAtual = null;
var ui = { avisoLogin: "" };
var uiCtl = { minuta: "contemplados", emails: {}, msg: "", msgEmails: "" };

/* ---------- navegação ---------- */
var app = document.getElementById("app");
function rota() {
  var h = location.hash.replace(/^#/, ""), m;
  var existe = function (id) { return estado.registros.some(function (r) { return r.id === id; }); };
  if (h && existe(h)) return { tela: "ata", id: h };
  if ((m = /^inscricao-(.+)$/.exec(h)) && chamadaPublica(m[1])) return { tela: "inscricao", id: m[1] };
  if (h === "novo") return { tela: "novo" };
  if (h === "controle") return { tela: "controle" };
  if (h === "entrar") return { tela: "entrar" };
  if (h === "conta") return { tela: "conta" };
  if (h === "usuarios") return { tela: "usuarios" };
  if ((m = /^chamada-(.+)$/.exec(h)) && chamadaPublica(m[1])) return { tela: "chamada", id: m[1] };
  if ((m = /^controle-(.+)$/.exec(h)) && existe(m[1])) return { tela: "controleSorteio", id: m[1] };
  return { tela: "registro" };
}
var PREFIXO = { ata: "", controleSorteio: "controle-", inscricao: "inscricao-", chamada: "chamada-" };
function irPara(tela, id) {
  telaAtual = { tela: tela, id: id };
  var hash = tela in PREFIXO ? PREFIXO[tela] + id : tela === "registro" ? "" : tela;
  history.replaceState(null, "", hash ? "#" + hash : location.pathname);
  uiCh.confirmando = false;
  if (tela !== "inscricao") document.title = "Sorteios CEAF";
  desenhar(); window.scrollTo(0, 0);
  // Telas da equipe: busca o estado mais recente (ex.: um sorteio automático feito enquanto a página estava aberta).
  if (estado.usuario && (tela === "controle" || tela === "chamada" || tela === "controleSorteio")) recarregarEquipe().then(desenhar, function () {});
  if (tela === "usuarios") carregarUsuarios().then(desenhar, function () {});
}
function telaPrivada(t) { return t === "novo" || t === "controle" || t === "controleSorteio" || t === "chamada" || t === "conta" || t === "usuarios"; }

function cabecalho(ativa) {
  var abas = ['<a href="#" data-ir="registro"' + (ativa === "registro" || ativa === "ata" || ativa === "inscricao" ? ' aria-current="page"' : "") + ">Registro público (" + estado.registros.length + ")</a>"];
  if (estado.usuario) {
    abas.push('<a href="#controle" data-ir="controle"' + (ativa === "controle" || ativa === "controleSorteio" || ativa === "chamada" ? ' aria-current="page"' : "") + ">Controle</a>");
    abas.push('<a href="#novo" data-ir="novo"' + (ativa === "novo" ? ' aria-current="page"' : "") + ">Novo sorteio</a>");
    if (estado.usuario.admin) abas.push('<a href="#usuarios" data-ir="usuarios"' + (ativa === "usuarios" ? ' aria-current="page"' : "") + ">Usuários</a>");
  }
  var usuario = estado.usuario
    ? '<div class="usuario"><span>' + esc(estado.usuario.nome) + '</span><a href="#conta" data-ir="conta" class="botao"' + (ativa === "conta" ? ' aria-current="page"' : "") + ">Minha conta</a>" + (estado.modoLogin === "senha" ? '<button type="button" id="b-sair">Sair</button>' : "") + "</div>"
    : '<div class="usuario"><a href="#entrar" data-ir="entrar" class="botao">Acesso da equipe</a></div>';
  return '<div class="faixa"><div class="miolo"><div class="linha-topo"><div><span class="sigla">Centro de Estudos e Aperfeiçoamento Funcional</span><h1>Sorteio de vagas · cursos de curta duração</h1></div>' + usuario + '</div><nav class="abas">' + abas.join("") + "</nav></div></div>";
}

function desenhar() {
  var r = telaAtual || rota();
  if (telaPrivada(r.tela) && !estado.usuario) r = { tela: "entrar" };
  // Senha provisória: a pessoa só usa a área da equipe depois de criar a própria senha.
  if (telaPrivada(r.tela) && estado.usuario && estado.usuario.trocarSenha) r = { tela: "conta" };
  var corpo;
  if (!estado.carregado) corpo = '<p class="nota">Carregando…</p>';
  else if (estado.erro) corpo = '<div class="aviso erro">' + esc(estado.erro) + "</div>";
  else corpo = r.tela === "ata" ? telaAta(r.id) : r.tela === "entrar" ? telaEntrar() : r.tela === "novo" ? telaNovo() :
    r.tela === "controle" ? telaControle() : r.tela === "controleSorteio" ? telaControleSorteio(r.id) :
    r.tela === "inscricao" ? telaInscricao(r.id) : r.tela === "chamada" ? telaChamada(r.id) :
    r.tela === "conta" ? telaConta() : r.tela === "usuarios" ? telaUsuarios() : telaRegistro();
  app.innerHTML = cabecalho(r.tela) + '<main class="miolo">' + corpo + "</main>";
  if (estado.carregado && !estado.erro) {
    if (r.tela === "ata") posAta(r.id);
    if (r.tela === "registro") posRegistro();
  }
}

/* ---------- tela: entrar ---------- */
function telaEntrar() {
  if (estado.usuario) return '<div class="aviso ok">Você já está conectado(a) como ' + esc(estado.usuario.nome) + ".</div>";
  if (estado.modoLogin === "cabecalho") return '<div class="aviso info">O acesso da equipe é feito pelo login institucional. Se você faz parte da equipe do CEAF e não está conectado(a), procure a TI.</div>';
  return '<section class="painel login"><h2>Acesso da equipe</h2><p class="nota">Área restrita às pessoas autorizadas do CEAF. O registro público dos sorteios não exige login.</p>' +
    '<form id="form-login" class="corpo" style="display:flex;flex-direction:column;gap:12px">' +
    '<label class="campo" for="l-login">Usuário<input type="text" id="l-login" autocomplete="username" required></label>' +
    '<label class="campo" for="l-senha">Senha<input type="password" id="l-senha" autocomplete="current-password" required></label>' +
    '<div class="acoes"><button type="submit" class="primario">Entrar</button></div>' +
    (ui.avisoLogin ? '<div class="aviso erro" role="alert">' + esc(ui.avisoLogin) + "</div>" : "") + "</form></section>";
}

/* ---------- sorteios em preparação: dados comuns ---------- */
var MODOS = { automatico: "automático", manual: "manual" };
function dhBR(v) { return v ? dataBR(v.slice(0, 10)) + " às " + v.slice(11, 16) : ""; }
function agoraLocal() {
  try { return new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 16).replace(" ", "T"); }
  catch (e) { return new Date().toISOString().slice(0, 16); }
}
function somarDias(dh, dias) {
  var d = new Date(Date.parse(dh + ":00Z") + dias * 86400000);
  return d.toISOString().slice(0, 16);
}
function textoDuracao(ini, fim) {
  if (!ini || !fim || fim <= ini) return "";
  var min = Math.round((Date.parse(fim + ":00Z") - Date.parse(ini + ":00Z")) / 60000), d = Math.floor(min / 1440), h = Math.floor(min % 1440 / 60), m = min % 60, p = [];
  if (d) p.push(d + (d === 1 ? " dia" : " dias"));
  if (h) p.push(h + (h === 1 ? " hora" : " horas"));
  if (m) p.push(m + " min");
  return p.join(" e ");
}
function situacaoCh(d, sorteioId) {
  var a = agoraLocal();
  if (sorteioId) return "sorteado";
  if (a < d.inscricaoInicio) return "agendado";
  if (a < d.inscricaoFim) return "aberto";
  return "encerrado";
}
function seloSituacao(d, sorteioId) {
  var s = situacaoCh(d, sorteioId);
  return {
    agendado: '<span class="selo n">Inscrições a partir de ' + esc(dhBR(d.inscricaoInicio)) + "</span>",
    aberto: '<span class="selo ok">Inscrições abertas até ' + esc(dhBR(d.inscricaoFim)) + "</span>",
    encerrado: '<span class="selo w">Inscrições encerradas · sorteio ' + esc(dhBR(d.dataSorteio)) + "</span>",
    sorteado: '<span class="selo a">Sorteio realizado</span>'
  }[s];
}
function paragrafos(texto) {
  return texto ? texto.split(/\n\s*\n/).map(function (p) { return "<p>" + esc(p.trim()).replace(/\n/g, "<br>") + "</p>"; }).join("") : "";
}
function chamadaPublica(id) { return estado.chamadas.filter(function (c) { return c.id === id; })[0]; }
function chamadaDoSorteio(sid) { return estado.chamadas.filter(function (c) { return c.sorteioId === sid; })[0]; }
function linkInscricao(id) { return enderecoBase() + "#inscricao-" + id; }
function motivoFora(d, i) {
  if (i.excluida) return "Excluída pela equipe: " + i.excluida;
  if (i.interesse === 0) return "Sem interesse ou disponibilidade";
  if (d.exigeAtuacao && i.atua === 0) return "Não atua na área";
  return null;
}
function concorrentesDe(ch) { return ch.inscricoes.filter(function (i) { return motivoFora(ch.dados, i) === null; }); }
function pendenciasCh(ch) {
  var d = ch.dados, a = agoraLocal(), falta = [];
  if (a < d.inscricaoFim) falta.push("as inscrições terminam em " + dhBR(d.inscricaoFim));
  if (d.modoSorteio === "automatico" && a < d.dataSorteio) falta.push("o sorteio automático está agendado para " + dhBR(d.dataSorteio));
  if (!concorrentesDe(ch).length) falta.push("não há inscrições que concorram ao sorteio");
  if (d.reserva.ativa && !ch.confirmacao) falta.push("falta confirmar a lista de inscritas que concorrem às vagas reservadas");
  return falta;
}

/* ---------- página pública de um sorteio (texto e formulário de inscrição) ---------- */
var uiIns = { ok: {}, erro: {}, enviando: false };
function telaInscricao(id) {
  var ch = chamadaPublica(id), s = situacaoCh(ch, ch.sorteioId), k = vagasReservadas(ch.vagas, ch.reserva);
  document.title = ch.nome + " – inscrições";
  var h = '<p><a href="#" data-ir="registro">← Todos os sorteios</a></p>';
  h += '<section class="painel"><div class="ata-topo"><div style="display:flex;flex-direction:column;gap:10px;min-width:0"><span class="sigla">Sorteio de vagas · ' + esc(ch.id) + "</span><h2>" + esc(ch.nome) + "</h2>" + seloSituacao(ch, ch.sorteioId) +
    (ch.textoPublico ? '<div class="texto-publico">' + paragrafos(ch.textoPublico) + "</div>" : "") +
    '<dl class="resumo"><dt>Evento</dt><dd>' + esc(textoPeriodo(ch.evento)) + "</dd>" +
    "<dt>Vagas</dt><dd>" + ch.vagas + (ch.reserva.ativa ? ", das quais " + k + " reservada(s) à participação feminina" : "") + "</dd>" +
    "<dt>Inscrições</dt><dd>De " + esc(dhBR(ch.inscricaoInicio)) + " a " + esc(dhBR(ch.inscricaoFim)) + " (horário de Brasília)</dd>" +
    "<dt>Sorteio</dt><dd>" + esc(dhBR(ch.dataSorteio)) + (ch.modoSorteio === "automatico" ? ", feito automaticamente pelo sistema" : ", feito pela equipe do CEAF") + "</dd>" +
    (ch.exigeAtuacao ? "<dt>Requisito</dt><dd>Atuar na área do evento</dd>" : "") +
    "<dt>Inscrições recebidas</dt><dd>" + ch.inscritos + "</dd></dl></div>" +
    '<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start"><div class="qr"><img src="' + qrPng(linkInscricao(ch.id)) + '" alt="QR code desta página" width="156" height="156"></div><a download="qr-inscricao-' + esc(ch.id) + '.png" href="' + qrPng(linkInscricao(ch.id)) + '">Baixar QR code</a></div></div>' +
    (ch.reserva.ativa ? '<div class="norma">' + esc(NORMA) + "</div>" : "") + "</section>";

  if (s === "sorteado") return h + '<div class="aviso ok">O sorteio foi realizado. <a href="#' + esc(ch.sorteioId) + '" data-ata="' + esc(ch.sorteioId) + '">Veja o resultado e a verificação (' + esc(ch.sorteioId) + ")</a>.</div>";
  if (!ch.formularioPublico) {
    return h + '<section class="painel"><h3>Como se inscrever</h3><p>As inscrições deste sorteio são recebidas por outro formulário do CEAF' + (ch.linkExterno ? "." : ", divulgado pelos canais institucionais.") + "</p>" +
      (ch.linkExterno && s === "aberto" ? '<div class="acoes"><a class="botao primario" href="' + esc(ch.linkExterno) + '" rel="noopener" target="_blank">Abrir o formulário de inscrição</a></div>' : "") + "</section>";
  }
  if (s === "agendado") return h + '<div class="aviso info">As inscrições abrem em ' + esc(dhBR(ch.inscricaoInicio)) + ".</div>";
  if (s === "encerrado") return h + '<div class="aviso info">As inscrições foram encerradas em ' + esc(dhBR(ch.inscricaoFim)) + ". O sorteio está previsto para " + esc(dhBR(ch.dataSorteio)) + ".</div>";

  var ok = uiIns.ok[id];
  if (ok) {
    return h + '<section class="painel"><div class="aviso ok" role="status"><strong>Inscrição nº ' + ok.numero + " recebida</strong> em " + esc(dataLocal(ok.quando)) + ", em nome de " + esc(ok.nome) + " (" + esc(ok.email) + ").</div>" +
      '<p class="nota">Guarde esta confirmação. O resultado será publicado nesta página depois do sorteio.</p><div class="acoes"><button type="button" id="b-outra">Fazer outra inscrição</button></div></section>';
  }
  var dom = (estado.dominiosEmail || []).map(function (d) { return "@" + d; }).join(" ou ");
  h += '<section class="painel"><h3>Inscrição</h3><form id="form-inscricao" data-chamada="' + esc(id) + '" class="formulario" novalidate>' +
    '<label class="campo" for="i-nome">Nome completo<input type="text" id="i-nome" autocomplete="name" maxlength="200" required></label>' +
    '<label class="campo" for="i-email">E-mail institucional' + (dom ? "<small>Use o e-mail " + esc(dom) + ".</small>" : "") + '<input type="email" id="i-email" autocomplete="email" maxlength="200" required></label>' +
    '<fieldset><legend>Você tem interesse e disponibilidade para comparecer ao evento, nas datas indicadas?</legend><label><input type="radio" name="i-int" value="sim" required> Sim</label><label><input type="radio" name="i-int" value="nao"> Não</label></fieldset>' +
    '<fieldset><legend>Você atua na área do evento?</legend><label><input type="radio" name="i-atua" value="sim" required> Sim</label><label><input type="radio" name="i-atua" value="nao"> Não</label></fieldset>' +
    '<label class="marcar" for="i-ciente"><input type="checkbox" id="i-ciente" required><span>Estou ciente de que meu nome constará do resultado público do sorteio, para permitir a conferência por qualquer pessoa. O e-mail não é publicado.</span></label>' +
    '<div class="acoes"><button type="submit" class="primario"' + (uiIns.enviando ? " disabled" : "") + ">" + (uiIns.enviando ? "Enviando…" : "Enviar inscrição") + "</button></div>" +
    (uiIns.erro[id] ? '<div class="aviso erro" role="alert">' + esc(uiIns.erro[id]) + "</div>" : "") + "</form></section>";
  return h;
}
function enviarInscricao(form) {
  var id = form.dataset.chamada, marcado = function (n) { var r = form.querySelector('input[name="' + n + '"]:checked'); return r ? r.value : ""; };
  var dados = { nome: document.getElementById("i-nome").value, email: document.getElementById("i-email").value, interesse: marcado("i-int"), atua: marcado("i-atua"), ciente: document.getElementById("i-ciente").checked };
  var falta = [];
  if (!normalizar(dados.nome)) falta.push("nome completo");
  if (!dados.email.trim()) falta.push("e-mail institucional");
  if (!dados.interesse) falta.push("interesse e disponibilidade");
  if (!dados.atua) falta.push("atuação na área");
  if (!dados.ciente) falta.push("ciência da publicação do nome");
  if (falta.length) { uiIns.erro[id] = "Preencha: " + falta.join(", ") + "."; guardarCampos(form); desenhar(); restaurarCampos(); return; }
  uiIns.enviando = true; uiIns.erro[id] = ""; guardarCampos(form); desenhar(); restaurarCampos();
  api("POST", "/api/chamadas/" + encodeURIComponent(id) + "/inscricoes", dados).then(function (r) {
    uiIns.enviando = false; uiIns.ok[id] = r; camposGuardados = null;
    var ch = chamadaPublica(id); if (ch) ch.inscritos = r.numero;
    desenhar(); window.scrollTo(0, 0);
  }).catch(function (e) {
    uiIns.enviando = false; uiIns.erro[id] = e.message; desenhar(); restaurarCampos();
  });
}
/* Mantém o que a pessoa digitou quando a tela é redesenhada (ex.: mensagem de erro). */
var camposGuardados = null;
function guardarCampos(form) {
  camposGuardados = {};
  Array.prototype.forEach.call(form.querySelectorAll("input"), function (el) {
    camposGuardados[el.id || el.name + ":" + el.value] = el.type === "radio" || el.type === "checkbox" ? el.checked : el.value;
  });
}
function restaurarCampos() {
  var f = document.getElementById("form-inscricao"); if (!f || !camposGuardados) return;
  Array.prototype.forEach.call(f.querySelectorAll("input"), function (el) {
    var k = el.id || el.name + ":" + el.value; if (!(k in camposGuardados)) return;
    if (el.type === "radio" || el.type === "checkbox") el.checked = camposGuardados[k]; else el.value = camposGuardados[k];
  });
}

/* ---------- equipe: formulário do sorteio (criação e edição) ---------- */
var CHAVE_RASCUNHO = "ceaf-sorteio-rascunho-2";
function rascunhoVazio() {
  return { nome: "", responsavel: estado.usuario ? estado.usuario.nome : "", vagas: 5, reserva: { ativa: true, arredondamento: "cima" },
    evento: { inicio: "", fim: "", local: "" }, textoPublico: "", formularioPublico: true, linkExterno: "", exigeAtuacao: false,
    inscricaoInicio: agoraLocal(), inscricaoFim: "", dataSorteio: "", modoSorteio: "manual", sementeExterna: "" };
}
var rascunho = null;
var uiCh = { form: {}, msg: "", msgLote: {}, lote: {}, confirmando: false, sorteando: false, criando: false };
function formDe(chave) {
  if (chave === "novo") {
    if (!rascunho) { rascunho = lerLocal(CHAVE_RASCUNHO) || rascunhoVazio(); if (!rascunho.evento) rascunho = rascunhoVazio(); }
    return rascunho;
  }
  if (!uiCh.form[chave]) uiCh.form[chave] = clonar(equipe[chave].dados);
  return uiCh.form[chave];
}
function alterado(id) { return uiCh.form[id] && canon(uiCh.form[id]) !== canon(equipe[id].dados); }
function lerCaminho(o, p) { return p.split(".").reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
function gravarCaminho(o, p, v) { var ks = p.split("."), u = ks.pop(); ks.reduce(function (a, k) { return a[k] = a[k] || {}; }, o)[u] = v; }

function formChamada(chave, f, sorteado) {
  var trava = sorteado ? " disabled" : "", k = vagasReservadas(Number(f.vagas) || 0, f.reserva);
  function campo(id, rotulo, ajuda, tipo, caminho, extra) {
    return '<label class="campo" for="' + id + '">' + rotulo + (ajuda ? "<small>" + ajuda + "</small>" : "") +
      '<input type="' + tipo + '" id="' + id + '" data-form="' + chave + '" data-f="' + caminho + '" value="' + esc(lerCaminho(f, caminho) == null ? "" : lerCaminho(f, caminho)) + '"' + (extra || "") + trava + "></label>";
  }
  function marca(id, caminho, texto) {
    return '<label class="marcar" for="' + id + '"><input type="checkbox" id="' + id + '" data-form="' + chave + '" data-f="' + caminho + '"' + (lerCaminho(f, caminho) ? " checked" : "") + trava + "><span>" + texto + "</span></label>";
  }
  var dur = textoDuracao(f.inscricaoInicio, f.inscricaoFim);
  var h = "";
  h += '<div class="bloco"><h3>Evento</h3><div class="campos">' +
    campo(chave + "-nome", "Nome do sorteio", "Ex.: Congresso Nacional de Direito Ambiental 2026", "text", "nome", ' maxlength="160"') +
    campo(chave + "-resp", "Responsável pela condução", "Consta da ata.", "text", "responsavel", ' maxlength="120"') +
    campo(chave + "-vagas", "Vagas a sortear", "De 1 a 100.", "number", "vagas", ' min="1" max="100" step="1" data-numero') +
    campo(chave + "-ini", "Início do evento", "", "date", "evento.inicio") +
    campo(chave + "-fim", "Término do evento", "Em branco se for um único dia.", "date", "evento.fim") +
    campo(chave + "-local", "Local do evento", "Opcional. Ex.: Brasília/DF", "text", "evento.local", ' maxlength="120"') + "</div></div>";

  h += '<div class="bloco"><h3>Texto público</h3><label class="campo" for="' + chave + '-texto">Sobre o evento<small>Aparece na página pública do sorteio e no controle. Separe os parágrafos com uma linha em branco.</small>' +
    '<textarea id="' + chave + '-texto" class="texto" maxlength="6000" data-form="' + chave + '" data-f="textoPublico">' + esc(f.textoPublico) + "</textarea></label></div>";

  h += '<div class="bloco"><h3>Inscrições</h3>' +
    marca(chave + "-form", "formularioPublico", "<strong>Gerar formulário de inscrição no site público</strong><br><span class=\"nota\">Nome completo, e-mail institucional, interesse e disponibilidade, atuação na área. Desmarque se as inscrições forem recebidas por outro formulário; nesse caso, a equipe lança a lista de inscritos aqui antes do sorteio.</span>") +
    (f.formularioPublico ? "" : '<div class="campos">' + campo(chave + "-link", "Endereço do formulário externo", "Opcional. Aparece na página pública durante o período de inscrição.", "url", "linkExterno", ' maxlength="500" placeholder="https://"') + "</div>") +
    marca(chave + "-atua", "exigeAtuacao", "Só concorre quem declarar atuar na área do evento") +
    '<div class="campos">' +
    campo(chave + "-ii", "Início das inscrições", "Data e horário de Brasília.", "datetime-local", "inscricaoInicio") +
    campo(chave + "-if", "Encerramento das inscrições", "Data e horário finais.", "datetime-local", "inscricaoFim") +
    '<label class="campo" for="' + chave + '-dur">Prazo em dias<small>Atalho: calcula o encerramento a partir do início.</small><input type="number" id="' + chave + '-dur" min="1" max="365" data-form="' + chave + '" data-dur value=""' + trava + "></label></div>" +
    '<p class="nota" style="margin:0">' + (dur ? "As inscrições ficarão abertas por " + dur + "." : "Informe o início e o encerramento das inscrições.") + "</p></div>";

  h += '<div class="bloco"><h3>Sorteio</h3><div class="campos">' +
    campo(chave + "-ds", "Data e horário do sorteio", "Igual ou posterior ao encerramento das inscrições.", "datetime-local", "dataSorteio") + "</div>" +
    '<fieldset><legend>Como o sorteio será feito</legend>' +
    '<label class="marcar"><input type="radio" name="' + chave + '-modo" value="automatico" data-form="' + chave + '" data-f="modoSorteio"' + (f.modoSorteio === "automatico" ? " checked" : "") + trava + "><span><strong>Automático</strong><br><span class=\"nota\">O sistema sorteia sozinho na data e no horário marcados, desde que não haja pendência (por exemplo, a confirmação das inscritas).</span></span></label>" +
    '<label class="marcar"><input type="radio" name="' + chave + '-modo" value="manual" data-form="' + chave + '" data-f="modoSorteio"' + (f.modoSorteio !== "automatico" ? " checked" : "") + trava + "><span><strong>Manual</strong><br><span class=\"nota\">A pessoa responsável clica em “Sortear” depois do encerramento das inscrições.</span></span></label></fieldset>" +
    '<div class="campos">' + campo(chave + "-ext", "Semente pública adicional (opcional)", "Valor externo que ninguém controla, como o 1º prêmio da Loteria Federal de uma data anunciada. Entra no cálculo junto com a entropia gerada pelo servidor.", "text", "sementeExterna", ' maxlength="200"') + "</div></div>";

  h += '<div class="bloco"><h3>Reserva de vagas para mulheres</h3>' +
    marca(chave + "-res", "reserva.ativa", "<strong>Aplicar a reserva de 50% das vagas à participação feminina</strong><br><span class=\"nota\">Despacho da PGJ no PA (SGA) n. 2025/031558. A equipe marca as inscritas antes do sorteio.</span>");
  if (f.reserva.ativa) {
    h += '<div class="campos"><label class="campo" for="' + chave + '-arred">Número ímpar de vagas<small>Como calcular 50% quando o número de vagas é ímpar.</small><select id="' + chave + '-arred" data-form="' + chave + '" data-f="reserva.arredondamento"' + trava + '><option value="cima"' + (f.reserva.arredondamento !== "baixo" ? " selected" : "") + '>Arredondar para cima</option><option value="baixo"' + (f.reserva.arredondamento === "baixo" ? " selected" : "") + ">Arredondar para baixo</option></select></label>" +
      '<div class="campo"><span>Vagas reservadas</span><span style="font:650 1.6rem var(--f-titulo)">' + k + ' <span class="nota" style="font-family:var(--f-texto)">de ' + (Number(f.vagas) || 0) + " · " + ((Number(f.vagas) || 0) - k) + " em ampla concorrência</span></span></div></div>";
  }
  h += "</div>";
  return h;
}

function telaNovo() {
  var f = formDe("novo");
  if (!f.responsavel && estado.usuario) f.responsavel = estado.usuario.nome;
  return '<section class="painel"><div><h2>Novo sorteio</h2><p class="nota">Cadastre o evento, o texto público, o período de inscrição e a forma do sorteio. Depois de criado, o sorteio ganha uma página pública' +
    " (com o formulário de inscrição, se você escolher) e um painel para acompanhar as inscrições.</p></div>" + formChamada("novo", f, false) +
    '<div class="acoes"><button type="button" class="primario" id="b-criar"' + (uiCh.criando ? " disabled" : "") + ">" + (uiCh.criando ? "Criando…" : "Criar sorteio") + '</button><button type="button" id="b-limpar">Limpar</button></div>' +
    (uiCh.msg ? '<div class="aviso erro" role="alert">' + esc(uiCh.msg) + "</div>" : "") + "</section>";
}

/* ---------- equipe: painel de um sorteio em preparação ---------- */
function telaChamada(id) {
  var ch = equipe[id];
  if (!ch) return '<p class="nota">Carregando…</p>';
  var d = ch.dados, s = situacaoCh(d, ch.sorteioId), sorteado = !!ch.sorteioId, conc = concorrentesDe(ch);
  var mulheres = conc.filter(function (i) { return i.mulher; }).length, k = vagasReservadas(d.vagas, d.reserva);
  var h = '<p><a href="#controle" data-ir="controle">← Controle dos sorteios</a></p>';
  if (uiCh.msg) h += '<div class="aviso info" role="status">' + esc(uiCh.msg) + "</div>";
  h += '<section class="painel"><div class="painel-topo"><div><span class="sigla">' + esc(id) + ' · <a href="#inscricao-' + esc(id) + '" data-insc="' + esc(id) + '">página pública</a></span><h2>' + esc(d.nome) + "</h2></div>" + seloSituacao(d, ch.sorteioId) + "</div>" +
    '<dl class="resumo"><dt>Evento</dt><dd>' + esc(textoPeriodo(d.evento)) + "</dd><dt>Vagas</dt><dd>" + d.vagas + (d.reserva.ativa ? " (" + k + " reservadas)" : "") + "</dd>" +
    "<dt>Inscrições</dt><dd>" + esc(dhBR(d.inscricaoInicio)) + " a " + esc(dhBR(d.inscricaoFim)) + (textoDuracao(d.inscricaoInicio, d.inscricaoFim) ? " (" + textoDuracao(d.inscricaoInicio, d.inscricaoFim) + ")" : "") + " · " + (d.formularioPublico ? "formulário público" : "formulário externo") + "</dd>" +
    "<dt>Sorteio</dt><dd>" + MODOS[d.modoSorteio] + ", " + esc(dhBR(d.dataSorteio)) + "</dd></dl>" +
    '<div class="acoes"><button type="button" id="b-link-insc">Copiar link da página pública</button><a class="botao" download="qr-inscricao-' + esc(id) + '.png" href="' + qrPng(linkInscricao(id)) + '">Baixar QR code</a><button type="button" data-exportar="' + esc(id) + '">Exportar para Excel</button></div><p class="nota" id="msg-link" role="status"></p></section>';
  if (ch.aviso && !sorteado) h += '<div class="aviso erro" role="alert">' + esc(ch.aviso) + "</div>";

  // Sorteio
  h += '<section class="painel"><h3>Sorteio</h3>';
  if (sorteado) {
    h += '<div class="aviso ok">Sorteio realizado: registro público <a href="#' + esc(ch.sorteioId) + '" data-ata="' + esc(ch.sorteioId) + '">' + esc(ch.sorteioId) + '</a>. <a href="#controle-' + esc(ch.sorteioId) + '" data-ctl="' + esc(ch.sorteioId) + '">Abrir o controle de presença →</a></div>';
  } else {
    var falta = pendenciasCh(ch);
    if (d.modoSorteio === "automatico") {
      var faltaReal = falta.filter(function (x) { return x.indexOf("terminam") < 0 && x.indexOf("agendado") < 0; });
      h += "<p>O sistema fará o sorteio automaticamente em <strong>" + esc(dhBR(d.dataSorteio)) + "</strong> (em até 5 minutos depois desse horário).</p>" +
        (faltaReal.length ? '<div class="aviso erro">Resolva antes da data marcada, ou o sorteio automático ficará suspenso: ' + esc(faltaReal.join("; ")) + ".</div>" : '<p class="nota">Nenhuma pendência no momento.</p>');
    } else if (falta.length) {
      h += '<p class="nota">Para sortear, falta: ' + esc(falta.join("; ")) + ".</p>";
    } else if (uiCh.confirmando) {
      h += '<div class="painel confirmacao"><h3>Confirme o sorteio</h3><dl class="resumo"><dt>Sorteio</dt><dd>' + esc(d.nome) + "</dd><dt>Vagas</dt><dd>" + d.vagas + (d.reserva.ativa ? " (" + k + " reservadas a mulheres, arredondamento " + textoArredondamento(d.reserva.arredondamento) + ")" : " (sem reserva)") +
        "</dd><dt>Concorrentes</dt><dd>" + conc.length + " de " + ch.inscricoes.length + " inscrições" + (d.reserva.ativa ? ", das quais " + mulheres + " mulheres" : "") + "</dd></dl>" +
        (conc.length <= d.vagas ? '<p class="nota">Há vagas para todos os concorrentes: o sorteio só define a ordem e fica registrado.</p>' : "") +
        '<p>O resultado é gravado no registro público no mesmo instante e não pode ser desfeito nem repetido.</p><div class="acoes"><button type="button" class="primario" id="b-executar"' + (uiCh.sorteando ? " disabled" : "") + ">" + (uiCh.sorteando ? "Sorteando e registrando…" : "Sortear e registrar") + '</button><button type="button" id="b-voltar"' + (uiCh.sorteando ? " disabled" : "") + ">Voltar</button></div></div>";
    } else {
      h += '<div class="acoes"><button type="button" class="primario" id="b-sortear">Revisar e sortear</button></div>';
    }
  }
  h += "</section>";

  // Inscrições
  h += '<section class="painel"><div class="painel-topo"><h3>Inscrições</h3><span class="nota">' + ch.inscricoes.length + " recebida(s) · " + conc.length + " concorre(m)" + (d.reserva.ativa ? " · " + mulheres + " marcada(s) para a reserva" : "") + "</span></div>";
  if (!ch.inscricoes.length) {
    h += '<p class="nota">Nenhuma inscrição ainda.' + (d.formularioPublico ? " Divulgue o link da página pública." : " Lance abaixo a lista recebida pelo formulário externo.") + "</p>";
  } else {
    h += '<div class="tabela"><table><thead><tr><th>Nº</th><th>Inscrição</th><th>Interesse</th><th>Atua na área</th><th>Situação</th>' + (d.reserva.ativa ? "<th>Reserva</th>" : "") + (sorteado ? "" : "<th></th>") + "</tr></thead><tbody>" +
      ch.inscricoes.map(function (i, n) {
        var fora = motivoFora(d, i), sn = function (v) { return v === 1 ? "Sim" : v === 0 ? "Não" : '<span class="nota">—</span>'; };
        return '<tr><td class="pos">' + (n + 1) + "</td><td>" + esc(i.nome) + '<span class="nota">' + (i.email ? esc(i.email) + " · " : "") + (i.origem === "formulario" ? "formulário" : "lançada pela equipe") + ", " +
          esc(new Date(i.criado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })) + "</span></td>" +
          "<td>" + sn(i.interesse) + "</td><td>" + sn(i.atua) + "</td>" +
          "<td>" + (fora ? '<span class="selo x">Não concorre</span><span class="nota">' + esc(fora) + "</span>" : '<span class="selo ok">Concorre</span>') + "</td>" +
          (d.reserva.ativa ? '<td><label class="marcar"><input type="checkbox" data-mulher-seq="' + i.seq + '" aria-label="Concorre às vagas reservadas"' + (i.mulher ? " checked" : "") + (sorteado || fora ? " disabled" : "") + "><span class=\"nota\">mulher</span></label></td>" : "") +
          (sorteado ? "" : '<td><button type="button" class="pequeno" data-excluir="' + i.seq + '" data-nome="' + esc(i.nome) + '">' + (i.excluida ? "Reincluir" : "Excluir") + "</button></td>") + "</tr>";
      }).join("") + "</tbody></table></div>";
  }
  if (d.reserva.ativa && !sorteado) {
    h += '<label class="marcar" for="ch-conf"><input type="checkbox" id="ch-conf"' + (ch.confirmacao ? " checked" : "") + "><span>Conferi a lista e confirmo as " + mulheres + " inscritas que concorrem às vagas reservadas." +
      (ch.confirmacao ? '<br><span class="nota">Confirmado por ' + esc(ch.confirmacao) + ".</span>" : '<br><span class="nota">Qualquer nova inscrição ou alteração desfaz a confirmação.</span>') + "</span></label>";
  }
  if (!sorteado) {
    h += '<details' + (!d.formularioPublico && !ch.inscricoes.length ? " open" : "") + '><summary>Lançar inscrições recebidas por outros meios</summary><p class="nota">Uma por linha: nome completo e, se houver, o e-mail (ex.: copiado de uma planilha). Nomes e e-mails repetidos são recusados.</p>' +
      '<textarea id="ch-lote" spellcheck="false" style="min-height:7rem" placeholder="Ana Beatriz Souza; anabeatriz@mpsc.mp.br">' + esc(uiCh.lote[id] || "") + '</textarea><div class="acoes"><button type="button" id="b-lote">Incluir inscrições</button></div>' +
      (uiCh.msgLote[id] ? '<div class="aviso info" role="status">' + esc(uiCh.msgLote[id]) + "</div>" : "") + "</details>";
  }
  h += "</section>";

  // Dados
  var f = formDe(id);
  h += '<section class="painel"><details' + (alterado(id) ? " open" : "") + '><summary>Dados do sorteio e texto público</summary>' +
    (sorteado ? '<p class="nota">O sorteio já foi realizado: só o texto público pode ser alterado.</p>' : "") + formChamada(id, f, sorteado) +
    '<div class="acoes"><button type="button" class="primario" data-salvar-ch="' + esc(id) + '"' + (alterado(id) ? "" : " disabled") + '>Salvar alterações</button><button type="button" data-descartar-ch="' + esc(id) + '"' + (alterado(id) ? "" : " disabled") + ">Descartar</button></div></details></section>";

  var hist = ch.historico.slice().reverse();
  h += '<section class="painel"><h3>Histórico</h3>' + (hist.length ? '<ul class="historico">' + hist.map(function (x) { return "<li><time>" + esc(new Date(x.quando).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })) + "</time>" + esc(x.usuario) + ": " + esc(x.texto) + "</li>"; }).join("") + "</ul>" : '<p class="nota">Nenhum registro.</p>') + "</section>";
  return h;
}

/* ---------- equipe: ações ---------- */
function recarregarPublico() {
  return Promise.all([api("GET", "/api/sorteios"), api("GET", "/api/chamadas")]).then(function (r) { estado.registros = r[0]; estado.chamadas = r[1]; });
}
function recarregarEquipe() {
  if (!estado.usuario || estado.usuario.trocarSenha) return recarregarPublico();
  return Promise.all([recarregarPublico(), api("GET", "/api/equipe/chamadas").then(function (d) { equipe = d; }), carregarControles()]);
}
function aplicarChamada(c) { equipe[c.id] = c; return recarregarPublico(); }
function falhaEquipe(e) {
  if (e.status === 401) { estado.usuario = null; irPara("entrar"); return; }
  uiCh.msg = e.message; desenhar();
}
function criarChamada() {
  if (uiCh.criando) return;
  uiCh.criando = true; uiCh.msg = ""; desenhar();
  api("POST", "/api/chamadas", formDe("novo")).then(function (c) {
    uiCh.criando = false; rascunho = null; apagarLocal(CHAVE_RASCUNHO);
    return aplicarChamada(c).then(function () { irPara("chamada", c.id); });
  }).catch(function (e) { uiCh.criando = false; falhaEquipe(e); });
}
function salvarChamada(id) {
  uiCh.msg = "";
  api("PUT", "/api/chamadas/" + encodeURIComponent(id), { dados: formDe(id), versao: equipe[id].versao }).then(function (c) {
    delete uiCh.form[id]; uiCh.msg = "Alterações salvas.";
    return aplicarChamada(c).then(desenhar);
  }).catch(function (e) {
    if (e.status === 409) { delete uiCh.form[id]; recarregarEquipe().then(function () { uiCh.msg = e.message; desenhar(); }); return; }
    falhaEquipe(e);
  });
}
function acaoChamada(id, metodo, caminho, corpo) {
  uiCh.msg = "";
  return api(metodo, "/api/chamadas/" + encodeURIComponent(id) + caminho, corpo).then(function (c) {
    return aplicarChamada(c.chamada || c).then(function () { desenhar(); return c; });
  }).catch(falhaEquipe);
}
function sortearChamada(id) {
  if (uiCh.sorteando) return;
  uiCh.sorteando = true; desenhar();
  api("POST", "/api/chamadas/" + encodeURIComponent(id) + "/sortear").then(function (r) {
    uiCh.sorteando = false; uiCh.confirmando = false;
    return recarregarEquipe().then(function () { irPara("ata", r.id); });
  }).catch(function (e) { uiCh.sorteando = false; uiCh.confirmando = false; falhaEquipe(e); });
}
function idChamadaAtual() { var t = telaAtual || rota(); return t.tela === "chamada" ? t.id : null; }
function tratarCliqueChamada(b) {
  var id = idChamadaAtual();
  if (b.id === "b-criar") { criarChamada(); return true; }
  if (b.id === "b-limpar") { rascunho = rascunhoVazio(); apagarLocal(CHAVE_RASCUNHO); uiCh.msg = ""; desenhar(); return true; }
  if (b.dataset.salvarCh) { salvarChamada(b.dataset.salvarCh); return true; }
  if (b.dataset.descartarCh) { delete uiCh.form[b.dataset.descartarCh]; desenhar(); return true; }
  if (b.id === "b-outra") { var t = telaAtual || rota(); delete uiIns.ok[t.id]; desenhar(); return true; }
  if (!id) return false;
  if (b.id === "b-link-insc") {
    var link = linkInscricao(id), msg = document.getElementById("msg-link");
    copiar(link, function () { msg.textContent = "Link copiado: " + link; }, function () { msg.textContent = "Link: " + link; });
    return true;
  }
  if (b.id === "b-sortear") { uiCh.confirmando = true; desenhar(); var el = document.getElementById("b-executar"); if (el) el.scrollIntoView({ block: "center" }); return true; }
  if (b.id === "b-voltar") { uiCh.confirmando = false; desenhar(); return true; }
  if (b.id === "b-executar") { sortearChamada(id); return true; }
  if (b.id === "b-lote") {
    var texto = document.getElementById("ch-lote").value;
    acaoChamada(id, "POST", "/inscricoes/equipe", { texto: texto }).then(function (r) {
      if (!r) return;
      uiCh.lote[id] = r.recusadas.length ? r.recusadas.join("\n") : "";
      uiCh.msgLote[id] = r.incluidas.length + " inscrição(ões) incluída(s)." + (r.recusadas.length ? " Recusadas (ficaram no quadro): " + r.recusadas.length + "." : "");
      desenhar();
    });
    return true;
  }
  if (b.dataset.excluir) {
    var seq = b.dataset.excluir, i = equipe[id].inscricoes.filter(function (x) { return String(x.seq) === seq; })[0];
    if (i.excluida) { acaoChamada(id, "PATCH", "/inscricoes/" + seq, { excluida: null }); return true; }
    var motivo = window.prompt("Motivo da exclusão de " + i.nome + " do sorteio (fica registrado no histórico):");
    if (motivo && motivo.trim()) acaoChamada(id, "PATCH", "/inscricoes/" + seq, { excluida: motivo.trim() });
    return true;
  }
  return false;
}
function tratarMudancaChamada(t) {
  if (t.dataset.mulherSeq) { acaoChamada(idChamadaAtual(), "PATCH", "/inscricoes/" + t.dataset.mulherSeq, { mulher: t.checked }); return true; }
  if (t.id === "ch-conf") { acaoChamada(idChamadaAtual(), "POST", "/confirmacao", { confirmar: t.checked }); return true; }
  if (t.dataset.dur !== undefined) {
    var f = formDe(t.dataset.form), n = parseInt(t.value, 10);
    if (f.inscricaoInicio && n > 0) { f.inscricaoFim = somarDias(f.inscricaoInicio, n); if (!f.dataSorteio || f.dataSorteio < f.inscricaoFim) f.dataSorteio = f.inscricaoFim; }
    aposEditarForm(t.dataset.form, true);
    return true;
  }
  if (t.dataset.form && t.dataset.f) { lerCampoForm(t); aposEditarForm(t.dataset.form, true); return true; }
  return false;
}
function lerCampoForm(t) {
  var f = formDe(t.dataset.form), v;
  if (t.type === "checkbox") v = t.checked;
  else if (t.type === "radio") { if (!t.checked) return; v = t.value; }
  else if (t.dataset.numero !== undefined) v = t.value === "" ? "" : Number(t.value);
  else v = t.value;
  gravarCaminho(f, t.dataset.f, v);
}
function aposEditarForm(chave, redesenhar) {
  if (chave === "novo") gravarLocal(CHAVE_RASCUNHO, rascunho);
  if (redesenhar) desenhar();
  else {
    var bs = document.querySelectorAll('[data-salvar-ch="' + chave + '"],[data-descartar-ch="' + chave + '"]');
    Array.prototype.forEach.call(bs, function (b) { b.disabled = !alterado(chave); });
  }
}

/* ---------- tela: registro público ---------- */
function telaRegistro() {
  var h = "", pendentes = estado.chamadas.filter(function (c) { return !c.sorteioId; }).sort(function (a, b) { return a.dataSorteio < b.dataSorteio ? -1 : 1; });
  if (pendentes.length) {
    h += '<section class="painel"><div><h2>Inscrições e próximos sorteios</h2><p class="nota">Clique no evento para ler o texto, conferir as datas e se inscrever.</p></div><div>' + pendentes.map(function (c) {
      return '<div class="registro-linha"><span class="mono rid">' + esc(c.id) + '</span><span><a href="#inscricao-' + esc(c.id) + '" data-insc="' + esc(c.id) + '">' + esc(c.nome) + '</a><br><span class="nota">Evento ' + esc(textoPeriodo(c.evento)) + " · " + c.vagas + " vaga(s) · sorteio " + esc(dhBR(c.dataSorteio)) + "</span></span>" + seloSituacao(c, c.sorteioId) + "</div>";
    }).join("") + "</div></section>";
  }
  h += '<section class="painel"><div><h2>Registro público de sorteios</h2><p class="nota" style="max-width:68ch">Cada sorteio fica gravado com todos os dados necessários para refazê-lo. Os registros formam uma cadeia: cada um contém o código de integridade (hash) do anterior. Alterar ou apagar um sorteio já publicado quebra a cadeia e aparece na verificação abaixo.</p></div><div id="cadeia"></div>';
  if (!estado.registros.length) {
    h += '<div class="vazio"><h3>Nenhum sorteio registrado ainda</h3><p>' + (estado.usuario ? 'Os sorteios aparecem aqui assim que forem realizados. Para preparar um, use <a href="#novo" data-ir="novo">Novo sorteio</a>.' : "Os sorteios aparecerão aqui assim que forem realizados.") + "</p></div>";
  } else {
    h += "<div>" + estado.registros.slice().reverse().map(function (r) {
      return '<div class="registro-linha"><span class="mono rid">' + esc(r.id) + '</span><span><a href="#' + esc(r.id) + '" data-ata="' + esc(r.id) + '">' + esc(r.nome) + '</a><br><span class="nota">' + (r.evento ? "Evento " + esc(textoPeriodo(r.evento)) + " · " : "") + r.vagas + " vaga(s) · " + r.participantes.length + " concorrente(s)</span></span>" + (r.reserva.ativa ? '<span class="selo r">Reserva 50%</span>' : '<span class="selo a">Sem reserva</span>') + "</div>";
    }).join("") + "</div>";
  }
  h += "</section>";
  h += '<section class="painel"><h2>Verificar um arquivo</h2><p class="nota">Recebeu os dados de um sorteio em arquivo (.json)? Selecione-o para refazer o cálculo aqui, sem enviar nada a lugar nenhum.</p><input type="file" id="arquivo" accept=".json,application/json"><div id="res-arquivo"></div></section>';
  h += metodo();
  return h;
}
function itensVerificacao(v, anteriorId) {
  var itens = [
    [v.semente, "A semente é o SHA-256 dos dados de entrada."],
    [v.resultado, "O resultado recalculado é idêntico ao publicado."],
    [v.hash, "O hash do registro confere com o conteúdo."]
  ];
  if (v.cadeia !== null) itens.push([v.cadeia, anteriorId ? "O registro aponta para o hash do sorteio anterior (" + anteriorId + ")." : "Primeiro registro da cadeia."]);
  return itens.map(function (it) { return "<li>" + (it[0] ? '<span class="selo ok">Confere</span>' : '<span class="selo x">Divergente</span>') + "<span>" + esc(it[1]) + "</span></li>"; }).join("");
}
function posRegistro() {
  var regs = estado.registros, alvo = document.getElementById("cadeia");
  if (regs.length) {
    alvo.innerHTML = '<p class="nota">Verificando a cadeia…</p>';
    Promise.all(regs.map(function (r, i) { return verificar(r, i > 0 ? regs[i - 1] : null); })).then(function (vs) {
      var falhas = vs.map(function (v, i) { return v.semente && v.resultado && v.hash && v.cadeia ? null : regs[i].id; }).filter(Boolean);
      alvo.innerHTML = falhas.length ? '<div class="aviso erro">Divergência encontrada em: ' + falhas.map(esc).join(", ") + ".</div>"
        : '<div class="aviso ok">Cadeia íntegra: os ' + regs.length + " registro(s) foram recalculados no seu navegador e conferem.</div>";
    });
  }
  document.getElementById("arquivo").addEventListener("change", function (e) {
    var f = e.target.files[0], saida = document.getElementById("res-arquivo");
    if (!f) return;
    f.text().then(function (t) {
      var r = JSON.parse(t);
      if (!r || !r.semente || !r.resultado) throw new Error("formato");
      var publicado = regs.filter(function (x) { return x.id === r.id; })[0];
      return verificar(r).then(function (v) {
        saida.innerHTML = "<h3>" + esc(r.id) + " · " + esc(r.nome) + '</h3><ul class="checagens">' + itensVerificacao(v) + "</ul>" +
          (publicado ? (publicado.hash === r.hash ? '<p class="nota">O arquivo é idêntico ao registro ' + esc(r.id) + " publicado aqui.</p>" : '<div class="aviso erro">O arquivo difere do registro ' + esc(r.id) + " publicado aqui.</div>") : '<p class="nota">Este identificador não consta do registro público.</p>');
      });
    }).catch(function () { saida.innerHTML = '<div class="aviso erro">O arquivo não é um registro de sorteio válido.</div>'; });
  });
}
function metodo() {
  return '<section class="painel"><details><summary>Como o sorteio é feito e como refazê-lo por conta própria</summary>' +
    '<ol class="metodo"><li>Os dados de entrada (identificador, nome, data e hora, vagas, regra de reserva, lista de inscritos na ordem registrada, índices das inscritas, entropia aleatória de 128 bits gerada pelo servidor, semente externa e hash do registro anterior) são serializados em JSON canônico: chaves em ordem alfabética, sem espaços, UTF-8.</li>' +
    "<li>A semente é o SHA-256 desse texto.</li>" +
    '<li>Cada número aleatório entre 0 e n−1 vem dos 32 primeiros bits de SHA-256("semente:fluxo:contador"); valores que gerariam viés são descartados e o contador avança.</li>' +
    "<li>Com a reserva ativa, as inscritas são sorteadas primeiro (fluxo F), em ordem; as primeiras ocupam as vagas reservadas e as demais formam a lista de suplentes reservadas.</li>" +
    "<li>Todos os demais inscritos, inclusive as inscritas não contempladas na reserva, são sorteados no fluxo G: os primeiros ocupam as vagas de ampla concorrência e os seguintes formam a lista geral de suplentes.</li>" +
    "<li>O hash do registro é o SHA-256 do JSON canônico de todo o registro, exceto o próprio hash.</li></ol>" +
    '<p class="nota">O <a href="verificar_sorteio.py" download>verificador em Python</a> faz o mesmo cálculo fora do navegador e usa só a biblioteca padrão.</p></details></section>';
}

/* ---------- tela: ata ---------- */
function linhas(lista, r, rotulo, desloc) {
  return lista.map(function (i, pos) { return '<tr><td class="pos">' + (pos + 1 + (desloc || 0)) + "º</td><td>" + esc(r.participantes[i]) + "</td><td>" + rotulo + "</td></tr>"; }).join("");
}
function telaAta(id) {
  var r = registroDe(id), res = r.resultado, k = vagasReservadas(r.vagas, r.reserva);
  document.title = r.id + " – " + r.nome;
  var h = '<p><a href="#" data-ir="registro">← Todos os sorteios</a></p>';
  h += '<section class="painel"><div class="ata-topo"><div style="display:flex;flex-direction:column;gap:10px;min-width:0"><span class="sigla">Ata de sorteio · ' + esc(r.id) + "</span><h2>" + esc(r.nome) + '</h2><dl class="resumo">' +
    (r.evento ? "<dt>Evento</dt><dd>" + esc(textoPeriodo(r.evento)) + "</dd>" : "") +
    "<dt>Sorteio realizado</dt><dd>" + esc(dataLocal(r.dataHora)) + "</dd>" +
    "<dt>Responsável</dt><dd>" + esc(r.responsavel) + "</dd>" +
    (r.inscricao ? "<dt>Inscrições</dt><dd>De " + esc(dhBR(r.inscricao.inicio)) + " a " + esc(dhBR(r.inscricao.encerramento)) + " (" + (r.inscricao.formularioPublico ? "formulário público" : "formulário externo") + "); " + r.inscricao.inscricoesRecebidas + " recebida(s), " + r.inscricao.inscricoesConcorrentes + " concorrente(s)</dd>" +
      "<dt>Modo</dt><dd>Sorteio " + MODOS[r.inscricao.modo] + ", previsto para " + esc(dhBR(r.inscricao.dataPrevista)) + "</dd>" : "") +
    "<dt>Vagas</dt><dd>" + r.vagas + "</dd><dt>Concorrentes</dt><dd>" + r.participantes.length + "</dd>" +
    "<dt>Reserva feminina</dt><dd>" + (r.reserva.ativa ? "Aplicada: " + k + " vaga(s), arredondamento " + textoArredondamento(r.reserva.arredondamento) + "; " + r.mulheres.length + " inscrita(s) concorrendo (" + esc(r.classificacao) + ")" : "Não aplicada") + "</dd></dl></div>" +
    '<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start"><div class="qr"><img src="' + qrPng(linkDe(r.id)) + '" alt="QR code da página deste sorteio" width="156" height="156"></div><a download="qr-' + esc(r.id) + '.png" href="' + qrPng(linkDe(r.id)) + '">Baixar QR code</a></div></div>' +
    (r.reserva.ativa ? '<div class="norma">' + esc(NORMA) + "</div>" : "") +
    (function () { var ch = chamadaDoSorteio(r.id); return ch && ch.textoPublico ? '<details><summary>Sobre o evento</summary><div class="texto-publico">' + paragrafos(ch.textoPublico) + "</div></details>" : ""; })() +
    (estado.usuario ? '<div class="acoes"><a href="#controle-' + esc(r.id) + '" data-ctl="' + esc(r.id) + '">Abrir o controle deste sorteio (presença, desistências, e-mails) →</a></div>' : "") + "</section>";
  h += '<section class="painel"><h3>Contemplados</h3><div class="tabela"><table><thead><tr><th>Ordem</th><th>Nome</th><th>Vaga</th></tr></thead><tbody>' +
    linhas(res.reservadas, r, '<span class="selo r">Reservada</span>') + linhas(res.ampla, r, '<span class="selo a">Ampla</span>', res.reservadas.length) + "</tbody></table></div>";
  if (res.suplentesMulheres.length) h += '<h3>Suplentes para vagas reservadas</h3><p class="nota">Convocadas, nesta ordem, em caso de desistência de contemplada em vaga reservada.</p><div class="tabela"><table><tbody>' + linhas(res.suplentesMulheres, r, '<span class="selo r">Suplente</span>') + "</tbody></table></div>";
  if (res.suplentesGerais.length) h += '<h3>Suplentes – lista geral</h3><p class="nota">Convocados, nesta ordem, em caso de desistência em vaga de ampla concorrência' + (res.suplentesMulheres.length ? "" : " ou, esgotadas as suplentes, em vaga reservada") + '.</p><div class="tabela"><table><tbody>' + linhas(res.suplentesGerais, r, '<span class="selo a">Suplente</span>') + "</tbody></table></div>";
  h += "</section>";
  h += '<section class="painel"><h3>Verificação</h3><p class="nota">Recalculado agora, no seu navegador, a partir dos dados publicados.</p><ul class="checagens" id="checagens"><li><span class="selo a">…</span><span>Recalculando…</span></li></ul>' +
    '<dl class="resumo"><dt>Semente</dt><dd class="mono">' + esc(r.semente) + '</dd><dt>Entropia</dt><dd class="mono">' + esc(r.entropia) + "</dd><dt>Semente externa</dt><dd>" + (r.sementeExterna ? esc(r.sementeExterna) : "não informada") + '</dd><dt>Hash do registro</dt><dd class="mono">' + esc(r.hash) + '</dd><dt>Registro anterior</dt><dd class="mono">' + esc(r.anterior) + "</dd></dl>" +
    '<div class="acoes"><button type="button" id="b-json">Baixar dados (JSON)</button><a class="botao" href="verificar_sorteio.py" download>Baixar verificador (Python)</a><button type="button" id="b-link">Copiar link</button></div><p class="nota" id="msg-acoes" role="status"></p>' +
    '<p class="nota">Para conferir fora do navegador: <span class="mono">python3 verificar_sorteio.py ' + esc(r.id) + ".json</span></p>" +
    '<details><summary>Dados publicados (JSON)</summary><pre id="json-ata">' + esc(JSON.stringify(r, null, 2)) + "</pre></details></section>";
  return h;
}
function posAta(id) {
  var idx = estado.registros.findIndex(function (x) { return x.id === id; }), r = estado.registros[idx];
  verificar(r, idx > 0 ? estado.registros[idx - 1] : null).then(function (v) {
    document.getElementById("checagens").innerHTML = itensVerificacao(v, idx > 0 ? estado.registros[idx - 1].id : null);
    return fetch("registros/" + encodeURIComponent(r.id) + ".json", { cache: "no-store" }).then(function (resp) { return resp.ok ? resp.json() : null; }).catch(function () { return null; })
      .then(function (copia) {
        var el = document.getElementById("checagens"); if (!el) return;
        el.insertAdjacentHTML("beforeend", "<li>" + (copia ? (copia.hash === r.hash ? '<span class="selo ok">Confere</span><span>Idêntico à cópia permanente publicada no GitHub (registros/' + esc(r.id) + '.json), cujo histórico é público e datado.</span>'
          : '<span class="selo x">Divergente</span><span>Difere da cópia permanente publicada no GitHub.</span>') : '<span class="selo n">Aguardando</span><span>A cópia permanente no GitHub ainda não está disponível (pode levar alguns minutos).</span>') + "</li>");
      });
  });
  var msg = document.getElementById("msg-acoes");
  document.getElementById("b-json").onclick = function () { baixarTexto(r.id + ".json", JSON.stringify(r, null, 2), "application/json"); };
  document.getElementById("b-link").onclick = function () {
    var link = linkDe(r.id);
    copiar(link, function () { msg.textContent = "Link copiado: " + link; }, function () { msg.textContent = "Link: " + link; });
  };
}

/* ---------- controle interno ---------- */
var ROTULO_PRESENCA = { aguardando: "Aguardando confirmação", confirmada: "Confirmada", desistiu: "Desistiu" };
var ROTULO_RELATORIO = { pendente: "Pendente", entregue: "Entregue" };
function registroDe(id) { return estado.registros.filter(function (r) { return r.id === id; })[0]; }
function novaConv(idx, vaga, origem, substitui) {
  return { idx: idx, vaga: vaga, origem: origem, substitui: substitui, presenca: "aguardando", relatorio: "pendente", dataRelatorio: "", convocadaEm: hojeISO() };
}
function controleDe(id) { return (controles[id] || {}).dados; }
function carregarControles() {
  if (!estado.usuario) return Promise.resolve();
  return api("GET", "/api/controle").then(function (d) { controles = d; }).catch(function (e) { uiCtl.msg = e.message; });
}
function gravarControle(id, novo, textoHistorico) {
  var atual = controles[id];
  controles[id] = { dados: novo, versao: atual.versao, historico: atual.historico };
  uiCtl.msg = ""; desenhar();
  api("PUT", "/api/controle/" + encodeURIComponent(id), { dados: novo, versao: atual.versao, acao: textoHistorico }).then(function (d) {
    controles[id] = d; desenhar();
  }).catch(function (e) {
    uiCtl.msg = e.status === 409 ? e.message : "A alteração não foi salva: " + e.message;
    controles[id] = atual;
    carregarControles().then(desenhar);
  });
}
function fem(r, i, f, n) { return r.mulheres.indexOf(i) >= 0 ? f : n; }
function confirmados(c) { return c.convocacoes.filter(function (x) { return x.presenca === "confirmada"; }); }
function substituida(c, conv) { return c.convocacoes.some(function (y) { return y.substitui === conv.idx; }); }
function fase(c) {
  var ev = c.evento, h = hojeISO();
  if (!ev.inicio) return { t: "Sem data do evento", cls: "n" };
  if (h < ev.inicio) { var d = diasEntre(h, ev.inicio); return { t: d === 1 ? "Falta 1 dia" : "Faltam " + d + " dias", cls: "a" }; }
  if (h <= (ev.fim || ev.inicio)) return { t: "Evento em andamento", cls: "w" };
  var pend = confirmados(c).filter(function (x) { return x.relatorio !== "entregue"; }).length;
  return pend ? { t: pend + " relatório(s) pendente(s)", cls: "x" } : { t: "Concluído", cls: "ok" };
}
function proximoSuplente(r, c, vaga) {
  var usados = c.convocacoes.map(function (x) { return x.idx; }), k;
  if (vaga === "reservada") {
    var lm = r.resultado.suplentesMulheres;
    for (k = 0; k < lm.length; k++) if (usados.indexOf(lm[k]) < 0) return { idx: lm[k], vaga: "reservada", lista: "lista de suplentes das vagas reservadas", pos: k + 1 };
  }
  var lg = r.resultado.suplentesGerais;
  for (k = 0; k < lg.length; k++) if (usados.indexOf(lg[k]) < 0) return { idx: lg[k], vaga: "ampla", lista: "lista geral de suplentes", pos: k + 1, semReservada: vaga === "reservada" };
  return null;
}
function rotuloConvocacao(r, conv) {
  if (conv.origem === "sorteio") return fem(r, conv.idx, "Contemplada", "Contemplado(a)") + " no sorteio";
  return "Suplente " + fem(r, conv.idx, "convocada", "convocado(a)") + " em " + dataBR(conv.convocadaEm) + ", no lugar de " + r.participantes[conv.substitui];
}

/* ---------- minutas de e-mail ---------- */
var minutasAtuais = {};
function assinatura(r) { return "Atenciosamente,\n\n" + r.responsavel + "\nCentro de Estudos e Aperfeiçoamento Funcional – CEAF"; }
function trechoLink(r) { return "\n\nO resultado do sorteio (registro " + r.id + ") e os dados para sua conferência estão disponíveis em:\n" + linkDe(r.id); }
function minutaContemplado(r, c, conv) {
  var nome = r.participantes[conv.idx], ev = c.evento, i = conv.idx, dia = dataBR(diaLocal(r.dataHora));
  var abertura = conv.origem === "sorteio"
    ? "Comunicamos que Vossa Senhoria foi " + fem(r, i, "contemplada", "contemplado(a)") + " no sorteio de vagas" + (conv.vaga === "reservada" ? " (vaga reservada à participação feminina)" : "") + ", realizado em " + dia + ", para participação no evento \"" + r.nome + "\", " + textoPeriodo(ev) + ", com custeio do Centro de Estudos e Aperfeiçoamento Funcional (CEAF)."
    : "Em razão de desistência de pessoa anteriormente contemplada, comunicamos que Vossa Senhoria, suplente no sorteio de vagas realizado em " + dia + ", foi " + fem(r, i, "convocada", "convocado(a)") + " para participação no evento \"" + r.nome + "\", " + textoPeriodo(ev) + ", com custeio do Centro de Estudos e Aperfeiçoamento Funcional (CEAF).";
  var corpo = fem(r, i, "Prezada", "Prezado(a)") + " " + nome + ",\n\n" + abertura +
    "\n\nSolicitamos a confirmação de sua participação em resposta a este e-mail" + (c.prazoConfirmacao ? ", até " + dataBR(c.prazoConfirmacao) : ", com a maior brevidade possível") + ". Caso não possa participar, pedimos que informe a desistência o quanto antes, para que a vaga seja oferecida à próxima pessoa da lista de suplentes." +
    "\n\nInformamos, ainda, que após o evento será necessária a apresentação de relatório das atividades realizadas" + (c.prazoRelatorio ? ", até " + dataBR(c.prazoRelatorio) : "") + "." +
    trechoLink(r) + "\n\n" + assinatura(r);
  return { para: c.emails[i] || "", assunto: "CEAF – Vaga no evento \"" + r.nome + "\"", corpo: corpo };
}
function minutaNaoContemplados(r, c) {
  var convocados = c.convocacoes.map(function (x) { return x.idx; }), emails = [], semEmail = 0;
  r.participantes.forEach(function (_, i) { if (convocados.indexOf(i) >= 0) return; var e = c.emails[i]; if (e) emails.push(e); else semEmail++; });
  var corpo = "Prezados(as),\n\nAgradecemos o interesse no evento \"" + r.nome + "\", " + textoPeriodo(c.evento) + ".\n\nInformamos que, no sorteio das " + r.vagas + " vagas disponíveis, realizado em " + dataBR(diaLocal(r.dataHora)) +
    (r.reserva.ativa ? ", com observância da reserva de 50% das vagas à participação feminina (Despacho da Procuradora-Geral de Justiça no PA SGA n. 2025/031558)" : "") +
    ", Vossa Senhoria não foi contemplado(a) nesta oportunidade.\n\nAs pessoas não contempladas integram a lista de suplência, na ordem definida pelo próprio sorteio, e poderão ser convocadas em caso de desistência." +
    trechoLink(r) + "\n\n" + assinatura(r);
  return { para: emails.join("; "), semEmail: semEmail, assunto: "CEAF – Resultado do sorteio de vagas: \"" + r.nome + "\"", corpo: corpo };
}
function minutaLembrete(r, c, conv) {
  var i = conv.idx;
  var corpo = fem(r, i, "Prezada", "Prezado(a)") + " " + r.participantes[i] + ",\n\nConsiderando a participação de Vossa Senhoria no evento \"" + r.nome + "\", " + textoPeriodo(c.evento) +
    ", custeado pelo Centro de Estudos e Aperfeiçoamento Funcional (CEAF), lembramos a necessidade de apresentação do relatório de atividades sobre o evento" + (c.prazoRelatorio ? ", até " + dataBR(c.prazoRelatorio) : "") +
    ".\n\nO relatório pode ser encaminhado em resposta a este e-mail.\n\n" + assinatura(r);
  return { para: c.emails[i] || "", assunto: "CEAF – Relatório de atividades: \"" + r.nome + "\"", corpo: corpo };
}
function blocoMinuta(chave, m, rotuloPara) {
  minutasAtuais[chave] = m;
  return '<div class="minuta"><div class="linha-meta"><span class="nota">' + (rotuloPara || "Para") + '</span><span class="mono">' + (m.para ? esc(m.para) : '<span class="nota">e-mail não informado</span>') + "</span>" +
    (m.para ? '<button type="button" data-copiar="para" data-chave="' + chave + '">Copiar</button>' : "<span></span>") + "</div>" +
    '<div class="linha-meta"><span class="nota">Assunto</span><span>' + esc(m.assunto) + '</span><button type="button" data-copiar="assunto" data-chave="' + chave + '">Copiar</button></div>' +
    '<textarea id="corpo-' + chave + '" aria-label="Texto do e-mail">' + esc(m.corpo) + "</textarea>" +
    '<div class="acoes"><button type="button" data-copiar="corpo" data-chave="' + chave + '">Copiar texto</button></div></div>';
}
function secaoMinutas(r, c) {
  minutasAtuais = {};
  var abas = [["contemplados", "Aos contemplados"], ["nao", "Aos não contemplados"], ["relatorio", "Lembrete de relatório"]];
  var h = '<div class="subabas" role="group" aria-label="Tipo de minuta">' + abas.map(function (a) { return '<button type="button" data-minuta="' + a[0] + '" aria-pressed="' + (uiCtl.minuta === a[0]) + '">' + a[1] + "</button>"; }).join("") + "</div>";
  if (uiCtl.minuta === "contemplados") {
    var aguard = c.convocacoes.filter(function (x) { return x.presenca === "aguardando"; });
    h += '<p class="nota">Uma minuta por pessoa que ainda não confirmou presença. O texto pode ser editado antes de copiar.</p>';
    h += aguard.length ? aguard.map(function (x) { return blocoMinuta("c" + x.idx, minutaContemplado(r, c, x)); }).join("") : '<p class="nota">Nenhuma pessoa aguardando confirmação.</p>';
  } else if (uiCtl.minuta === "nao") {
    var m = minutaNaoContemplados(r, c);
    h += '<p class="nota">Mensagem única, a ser enviada com os destinatários em cópia oculta (Cco).' + (m.semEmail ? " " + m.semEmail + " pessoa(s) sem e-mail informado." : "") + "</p>" + blocoMinuta("nao", m, "Cco");
  } else {
    var pend = confirmados(c).filter(function (x) { return x.relatorio !== "entregue"; }), fimEv = c.evento.fim || c.evento.inicio;
    if (fimEv && hojeISO() <= fimEv) h += '<div class="aviso info">O evento termina em ' + dataBR(fimEv) + ". Envie o lembrete depois dessa data.</div>";
    h += '<p class="nota">Uma minuta para cada participante confirmado(a) cujo relatório ainda não foi entregue.</p>';
    h += pend.length ? pend.map(function (x) { return blocoMinuta("r" + x.idx, minutaLembrete(r, c, x)); }).join("") : '<p class="nota">Nenhum relatório pendente.</p>';
  }
  return h;
}

/* ---------- telas do controle ---------- */
function telaControle() {
  var h = '<section style="display:flex;flex-direction:column;gap:14px"><div class="painel-topo"><div><h2>Controle dos sorteios</h2><p class="nota">Presença, desistências e relatórios. Estes dados não aparecem no registro público.</p></div><div class="acoes"><a class="botao" href="#novo" data-ir="novo">Novo sorteio</a><button type="button" class="primario" data-exportar="">Exportar para Excel</button></div></div>' +
    (uiCtl.msg ? '<div class="aviso info" role="status">' + esc(uiCtl.msg) + "</div>" : "");
  var prep = Object.keys(equipe).map(function (k) { return equipe[k]; }).filter(function (c) { return !c.sorteioId; })
    .sort(function (a, b) { return a.dados.dataSorteio < b.dados.dataSorteio ? -1 : 1; });
  if (prep.length) {
    h += '<h3>Em preparação</h3>' + prep.map(function (c) {
      var d = c.dados, conc = concorrentesDe(c).length;
      return '<div class="painel"><div class="painel-topo"><div><span class="sigla">' + esc(c.id) + " · " + esc(textoPeriodo(d.evento)) + '</span><h3><a href="#chamada-' + esc(c.id) + '" data-ch="' + esc(c.id) + '" style="color:inherit">' + esc(d.nome) + "</a></h3></div>" + seloSituacao(d, null) + "</div>" +
        '<p class="nota" style="margin:0">' + c.inscricoes.length + " inscrição(ões) · " + conc + " concorre(m) · " + d.vagas + " vaga(s) · sorteio " + MODOS[d.modoSorteio] + " em " + esc(dhBR(d.dataSorteio)) + "</p>" +
        (c.aviso ? '<div class="aviso erro">' + esc(c.aviso) + "</div>" : "") + "</div>";
    }).join("");
  }
  if (!estado.registros.length) return h + (prep.length ? "" : '<div class="painel vazio"><h3>Nenhum sorteio ainda</h3><p>Comece em <a href="#novo" data-ir="novo">Novo sorteio</a>.</p></div>') + "</section>";
  h += '<h3>Sorteados</h3>';
  var h0 = hojeISO();
  var ordenados = estado.registros.filter(function (r) { return controleDe(r.id); }).sort(function (a, b) {
    var ea = controleDe(a.id).evento.inicio || "", eb = controleDe(b.id).evento.inicio || "";
    var fa = ea >= h0 ? 0 : 1, fb = eb >= h0 ? 0 : 1;
    return fa !== fb ? fa - fb : fa === 0 ? (ea < eb ? -1 : 1) : (ea > eb ? -1 : 1);
  });
  h += ordenados.map(function (r) {
    var c = controleDe(r.id), f = fase(c), conf = confirmados(c);
    var ag = c.convocacoes.filter(function (x) { return x.presenca === "aguardando"; }).length;
    var des = c.convocacoes.filter(function (x) { return x.presenca === "desistiu"; }).length;
    var rel = conf.filter(function (x) { return x.relatorio === "entregue"; }).length;
    var abertas = c.convocacoes.filter(function (x) { return x.presenca === "desistiu" && !substituida(c, x); }).length;
    return '<div class="painel"><div class="painel-topo"><div><span class="sigla">' + esc(r.id) + " · " + esc(textoPeriodo(c.evento)) + '</span><h3><a href="#controle-' + esc(r.id) + '" data-ctl="' + esc(r.id) + '" style="color:inherit">' + esc(r.nome) + '</a></h3></div><span class="selo ' + f.cls + '">' + esc(f.t) + "</span></div>" +
      '<div><span class="nota">Confirmados (' + conf.length + " de " + r.vagas + ")</span>" + (conf.length ? '<div class="nomes-conf">' + conf.map(function (x) { return "<span>" + esc(r.participantes[x.idx]) + "</span>"; }).join("") + "</div>" : '<p class="nota" style="margin:4px 0 0">Ninguém confirmou ainda.</p>') + "</div>" +
      '<p class="nota" style="margin:0">' + ag + " aguardando confirmação · " + des + " desistência(s)" + (abertas ? " · <strong>" + abertas + " vaga(s) a preencher</strong>" : "") + " · relatórios: " + rel + " de " + conf.length + " entregues</p></div>";
  }).join("");
  return h + "</section>";
}
function telaControleSorteio(id) {
  var r = registroDe(id), c = controleDe(id);
  if (!c) return '<p class="nota">Carregando o controle…</p>';
  var f = fase(c), ev = c.evento;
  var h = '<p><a href="#controle" data-ir="controle">← Todos os sorteios</a></p>';
  if (uiCtl.msg) h += '<div class="aviso info" role="status">' + esc(uiCtl.msg) + "</div>";
  var chs = chamadaDoSorteio(r.id);
  h += '<section class="painel"><div class="painel-topo"><div><span class="sigla">' + esc(r.id) + ' · <a href="#' + esc(r.id) + '" data-ata="' + esc(r.id) + '">ata pública</a>' +
    (chs ? ' · <a href="#chamada-' + esc(chs.id) + '" data-ch="' + esc(chs.id) + '">inscrições e preparação (' + esc(chs.id) + ")</a>" : "") + "</span><h2>" + esc(r.nome) + '</h2></div><span class="selo ' + f.cls + '">' + esc(f.t) + "</span></div>" +
    '<div class="campos">' +
    '<label class="campo" for="c-ini">Início do evento<input type="date" id="c-ini" data-ctl-campo="inicio" value="' + esc(ev.inicio) + '"></label>' +
    '<label class="campo" for="c-fim">Término do evento<input type="date" id="c-fim" data-ctl-campo="fim" value="' + esc(ev.fim) + '"></label>' +
    '<label class="campo" for="c-local">Local<input type="text" id="c-local" data-ctl-campo="local" value="' + esc(ev.local) + '"></label>' +
    '<label class="campo" for="c-pconf">Prazo para confirmar presença<input type="date" id="c-pconf" data-ctl-campo="prazoConfirmacao" value="' + esc(c.prazoConfirmacao) + '"></label>' +
    '<label class="campo" for="c-prel">Prazo para o relatório<input type="date" id="c-prel" data-ctl-campo="prazoRelatorio" value="' + esc(c.prazoRelatorio) + '"></label>' +
    '</div><p class="nota" style="margin:0">Alterar as datas aqui (por exemplo, em caso de adiamento) não modifica a ata pública do sorteio.</p></section>';

  if (chs && equipe[chs.id]) {
    var ft = formDe(chs.id);
    h += '<section class="painel"><h3>Texto público</h3><label class="campo" for="ctl-texto"><small>Aparece na página pública do sorteio. Separe os parágrafos com uma linha em branco.</small><textarea id="ctl-texto" class="texto" maxlength="6000" data-form="' + esc(chs.id) + '" data-f="textoPublico">' + esc(ft.textoPublico) + "</textarea></label>" +
      '<div class="acoes"><button type="button" class="primario" data-salvar-ch="' + esc(chs.id) + '"' + (alterado(chs.id) ? "" : " disabled") + '>Salvar texto</button><button type="button" data-descartar-ch="' + esc(chs.id) + '"' + (alterado(chs.id) ? "" : " disabled") + ">Descartar</button></div></section>";
  }
  h += '<section class="painel"><div class="painel-topo"><h3>Vagas e presença</h3><button type="button" data-exportar="' + esc(r.id) + '">Exportar este sorteio para Excel</button></div><div class="tabela"><table><thead><tr><th>Pessoa</th><th>Vaga</th><th>Presença</th><th>Relatório</th><th>E-mail</th></tr></thead><tbody>';
  c.convocacoes.forEach(function (x, k) {
    var trava = x.presenca === "desistiu" && substituida(c, x);
    h += "<tr><td>" + esc(r.participantes[x.idx]) + '<span class="nota">' + esc(rotuloConvocacao(r, x)) + "</span></td>" +
      "<td>" + (x.vaga === "reservada" ? '<span class="selo r">Reservada</span>' : '<span class="selo a">Ampla</span>') + "</td>" +
      '<td><select id="pres-' + k + '" data-presenca="' + k + '" aria-label="Presença"' + (trava ? " disabled" : "") + ">" + Object.keys(ROTULO_PRESENCA).map(function (p) { return '<option value="' + p + '"' + (x.presenca === p ? " selected" : "") + ">" + ROTULO_PRESENCA[p] + "</option>"; }).join("") + "</select></td>" +
      "<td>" + (x.presenca === "confirmada"
        ? '<select id="rel-' + k + '" data-relatorio="' + k + '" aria-label="Relatório">' + Object.keys(ROTULO_RELATORIO).map(function (p) { return '<option value="' + p + '"' + (x.relatorio === p ? " selected" : "") + ">" + ROTULO_RELATORIO[p] + "</option>"; }).join("") + "</select>" +
          (x.relatorio === "entregue" ? '<input type="date" id="reld-' + k + '" data-relatorio-data="' + k + '" aria-label="Data de entrega" value="' + esc(x.dataRelatorio) + '" style="margin-top:6px">' : "")
        : '<span class="nota">—</span>') + "</td>" +
      '<td><input type="email" id="mail-' + x.idx + '" data-email="' + x.idx + '" aria-label="E-mail" value="' + esc(c.emails[x.idx] || "") + '" placeholder="nome@mpsc.mp.br"></td></tr>';
    if (x.presenca === "desistiu" && !trava) {
      var p = proximoSuplente(r, c, x.vaga);
      h += '<tr><td colspan="5"><div class="proximo">' + (p
        ? "<span>Próxima pessoa a convocar: <strong>" + esc(r.participantes[p.idx]) + "</strong> (" + p.pos + "º lugar na " + p.lista + (p.semReservada ? "; não há mais suplentes para a vaga reservada" : "") + ')</span><button type="button" class="primario" data-convocar="' + k + '">Convocar</button>'
        : "<span>Não há mais suplentes disponíveis para esta vaga.</span>") + "</div></td></tr>";
    }
  });
  h += "</tbody></table></div></section>";

  function filaSup(lista, titulo) {
    if (!lista.length) return "";
    return "<div><h3>" + titulo + '</h3><div class="tabela"><table><tbody>' + lista.map(function (i, k) {
      var cv = c.convocacoes.filter(function (x) { return x.idx === i; })[0];
      return '<tr><td class="pos">' + (k + 1) + "º</td><td>" + esc(r.participantes[i]) + "</td><td>" + (cv ? '<span class="selo a">Convocado(a) · ' + ROTULO_PRESENCA[cv.presenca].toLowerCase() + "</span>" : '<span class="selo n">Na fila</span>') + "</td></tr>";
    }).join("") + "</tbody></table></div></div>";
  }
  var sup = filaSup(r.resultado.suplentesMulheres, "Suplentes das vagas reservadas") + filaSup(r.resultado.suplentesGerais, "Lista geral de suplentes");
  if (sup) h += '<section class="painel">' + sup + '<p class="nota" style="margin:0">A ordem de suplência foi definida no próprio sorteio e consta da ata pública. ' + c.convocacoes.length + " pessoa(s) convocada(s) até agora.</p></section>";

  var txt = uiCtl.emails[id] !== undefined ? uiCtl.emails[id] : "";
  h += '<section class="painel"><h3>E-mails dos inscritos</h3><p class="nota">Cole as linhas da lista de inscrição, com nome e e-mail (por exemplo, copiadas de uma planilha). A associação ignora acentos e maiúsculas. Os e-mails ficam só no controle interno.</p>' +
    '<textarea id="ctl-emails" spellcheck="false" style="min-height:7rem" placeholder="Ana Beatriz Souza; anabeatriz@mpsc.mp.br">' + esc(txt) + '</textarea><div class="acoes"><button type="button" id="b-associar">Associar e-mails</button><span class="nota">' + Object.keys(c.emails).length + " de " + r.participantes.length + " inscritos com e-mail</span></div>" +
    (uiCtl.msgEmails ? '<div class="aviso info" role="status">' + esc(uiCtl.msgEmails) + "</div>" : "") + "</section>";

  h += '<section class="painel"><h3>Minutas de e-mail</h3>' + secaoMinutas(r, c) + '<p class="nota" id="msg-minuta" role="status"></p></section>';

  var hist = (controles[id].historico || []).slice().reverse();
  h += '<section class="painel"><h3>Histórico</h3>' + (hist.length ? '<ul class="historico">' + hist.map(function (x) { return "<li><time>" + esc(new Date(x.quando).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })) + "</time>" + esc(x.usuario) + ": " + esc(x.texto) + "</li>"; }).join("") + "</ul>" : '<p class="nota">Nenhuma alteração registrada.</p>') + "</section>";
  return h;
}

function chaveNome(s) { return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim(); }
function associarEmails(r, c, texto) {
  var mapa = clonar(c.emails), porNome = {}, n = 0, falhas = [];
  r.participantes.forEach(function (p, i) { porNome[chaveNome(p)] = i; });
  texto.split(/\r?\n/).forEach(function (l) {
    l = l.trim(); if (!l) return;
    var m = l.match(/[^\s<>;,"'()]+@[^\s<>;,"'()]+\.[^\s<>;,"'()]+/);
    if (!m) { falhas.push(l); return; }
    var nome = chaveNome(l.replace(m[0], " "));
    if (Object.prototype.hasOwnProperty.call(porNome, nome)) { mapa[porNome[nome]] = m[0].toLowerCase(); n++; } else falhas.push(l);
  });
  return { mapa: mapa, n: n, falhas: falhas };
}
function idControleAtual() { var t = telaAtual || rota(); return t.tela === "controleSorteio" ? t.id : null; }
function tratarCliqueControle(b) {
  var id = idControleAtual(); if (!id) return false;
  var r = registroDe(id), c;
  if (b.dataset.minuta) { uiCtl.minuta = b.dataset.minuta; desenhar(); return true; }
  if (b.dataset.copiar) {
    var m = minutasAtuais[b.dataset.chave], area = document.getElementById("corpo-" + b.dataset.chave), msg = document.getElementById("msg-minuta");
    var texto = b.dataset.copiar === "corpo" ? area.value : m[b.dataset.copiar];
    copiar(texto, function () { msg.textContent = (b.dataset.copiar === "corpo" ? "Texto" : b.dataset.copiar === "assunto" ? "Assunto" : "Destinatários") + " copiado."; },
      function () { if (b.dataset.copiar === "corpo") { area.focus(); area.select(); } msg.textContent = "Não foi possível copiar automaticamente; selecione e copie manualmente."; });
    return true;
  }
  if (b.dataset.convocar !== undefined) {
    c = clonar(controleDe(id));
    var sai = c.convocacoes[Number(b.dataset.convocar)], p = proximoSuplente(r, c, sai.vaga);
    if (!p) return true;
    c.convocacoes.push(novaConv(p.idx, p.vaga, "suplente", sai.idx));
    uiCtl.minuta = "contemplados";
    gravarControle(id, c, "Convocado(a) " + r.participantes[p.idx] + " (" + p.pos + "º lugar na " + p.lista + ") no lugar de " + r.participantes[sai.idx] + ".");
    return true;
  }
  if (b.id === "b-associar") {
    c = clonar(controleDe(id));
    var res = associarEmails(r, c, document.getElementById("ctl-emails").value);
    uiCtl.msgEmails = res.n + " e-mail(s) associado(s)." + (res.falhas.length ? " Não reconhecidas (" + res.falhas.length + "): " + res.falhas.slice(0, 5).join(" | ") + (res.falhas.length > 5 ? " …" : "") : "");
    if (res.n) { c.emails = res.mapa; uiCtl.emails[id] = ""; gravarControle(id, c, res.n + " e-mail(s) associado(s) em lote."); } else desenhar();
    return true;
  }
  return false;
}
function tratarMudancaControle(t) {
  var id = idControleAtual(); if (!id) return false;
  var r = registroDe(id), c = clonar(controleDe(id)), conv;
  if (t.dataset.ctlCampo) {
    var campo = t.dataset.ctlCampo, valor = campo === "local" ? normalizar(t.value) : t.value;
    var rotulos = { inicio: "Início do evento", fim: "Término do evento", local: "Local", prazoConfirmacao: "Prazo para confirmar presença", prazoRelatorio: "Prazo para o relatório" };
    if (campo === "inicio" || campo === "fim" || campo === "local") c.evento[campo] = valor; else c[campo] = valor;
    gravarControle(id, c, rotulos[campo] + ": " + (valor ? (campo === "local" ? valor : dataBR(valor)) : "em branco") + ".");
    return true;
  }
  if (t.dataset.presenca !== undefined) {
    conv = c.convocacoes[Number(t.dataset.presenca)]; conv.presenca = t.value;
    if (t.value !== "confirmada") { conv.relatorio = "pendente"; conv.dataRelatorio = ""; }
    gravarControle(id, c, r.participantes[conv.idx] + ": " + ROTULO_PRESENCA[t.value].toLowerCase() + ".");
    return true;
  }
  if (t.dataset.relatorio !== undefined) {
    conv = c.convocacoes[Number(t.dataset.relatorio)]; conv.relatorio = t.value;
    conv.dataRelatorio = t.value === "entregue" ? (conv.dataRelatorio || hojeISO()) : "";
    gravarControle(id, c, "Relatório de " + r.participantes[conv.idx] + ": " + ROTULO_RELATORIO[t.value].toLowerCase() + ".");
    return true;
  }
  if (t.dataset.relatorioData !== undefined) {
    conv = c.convocacoes[Number(t.dataset.relatorioData)]; conv.dataRelatorio = t.value;
    gravarControle(id, c, "Data de entrega do relatório de " + r.participantes[conv.idx] + ": " + dataBR(t.value) + ".");
    return true;
  }
  if (t.dataset.email !== undefined) {
    var i = t.dataset.email, e = t.value.trim().toLowerCase();
    if (e) c.emails[i] = e; else delete c.emails[i];
    gravarControle(id, c, "E-mail de " + r.participantes[Number(i)] + (e ? " atualizado." : " removido."));
    return true;
  }
  return false;
}

/* ---------- conta própria e usuários (administrador) ---------- */
var uiUs = { lista: null, historico: [], senha: null, msg: "", erro: "", msgConta: "", erroConta: "" };
function telaConta() {
  var u = estado.usuario, h = '<section class="painel login"><h2>Minha conta</h2><dl class="resumo"><dt>Nome</dt><dd>' + esc(u.nome) + "</dd><dt>Usuário</dt><dd class=\"mono\">" + esc(u.login) + "</dd><dt>Perfil</dt><dd>" + (u.admin ? "Administrador" : "Equipe") + "</dd></dl>";
  if (estado.modoLogin === "cabecalho") return h + '<p class="nota">O acesso é feito pelo login institucional: a senha é a da rede do MPSC.</p></section>';
  if (u.trocarSenha) h += '<div class="aviso erro" role="alert">Você entrou com uma senha provisória. Crie uma senha pessoal para continuar.</div>';
  h += '<form id="form-senha" class="formulario"><h3>Trocar senha</h3>' +
    '<label class="campo" for="s-atual">Senha atual' + (u.trocarSenha ? "<small>A senha provisória que você recebeu.</small>" : "") + '<input type="password" id="s-atual" autocomplete="current-password" required></label>' +
    '<label class="campo" for="s-nova">Nova senha<small>Pelo menos 12 caracteres. Ninguém, nem o administrador, tem acesso a ela.</small><input type="password" id="s-nova" autocomplete="new-password" minlength="12" required></label>' +
    '<label class="campo" for="s-rep">Repita a nova senha<input type="password" id="s-rep" autocomplete="new-password" minlength="12" required></label>' +
    '<div class="acoes"><button type="submit" class="primario">Salvar nova senha</button></div>' +
    (uiUs.erroConta ? '<div class="aviso erro" role="alert">' + esc(uiUs.erroConta) + "</div>" : "") +
    (uiUs.msgConta ? '<div class="aviso ok" role="status">' + esc(uiUs.msgConta) + "</div>" : "") + "</form></section>";
  return h;
}
function trocarSenha() {
  var atual = document.getElementById("s-atual").value, nova = document.getElementById("s-nova").value, rep = document.getElementById("s-rep").value;
  uiUs.erroConta = ""; uiUs.msgConta = "";
  if (nova.length < 12) uiUs.erroConta = "A nova senha deve ter pelo menos 12 caracteres.";
  else if (nova !== rep) uiUs.erroConta = "A repetição não confere com a nova senha.";
  if (uiUs.erroConta) { desenhar(); return; }
  var eraProvisoria = estado.usuario.trocarSenha;
  api("POST", "/api/conta/senha", { atual: atual, nova: nova }).then(function (d) {
    estado.usuario = d.usuario;
    uiUs.msgConta = "Senha alterada. As outras sessões abertas com a senha antiga foram encerradas.";
    if (eraProvisoria) return recarregarEquipe().then(function () { irPara("controle"); });
    desenhar();
  }).catch(function (e) { if (e.status === 401) { estado.usuario = null; irPara("entrar"); return; } uiUs.erroConta = e.message; desenhar(); });
}

function carregarUsuarios() {
  if (!estado.usuario || !estado.usuario.admin || estado.usuario.trocarSenha) return Promise.resolve();
  return api("GET", "/api/usuarios").then(aplicarUsuarios);
}
function aplicarUsuarios(d) { uiUs.lista = d.usuarios; uiUs.historico = d.historico; if (d.senhaProvisoria !== undefined) return d; }
function telaUsuarios() {
  if (!estado.usuario.admin) return '<div class="aviso erro">Área restrita ao administrador.</div>';
  if (!uiUs.lista) { carregarUsuarios().then(desenhar, function (e) { uiUs.erro = e.message; desenhar(); }); return '<p class="nota">Carregando…</p>'; }
  var sso = estado.modoLogin === "cabecalho";
  var h = '<section class="painel"><div><h2>Usuários</h2><p class="nota">As pessoas cadastradas aqui acessam o controle e a criação de sorteios. Só o administrador vê esta tela. ' +
    (sso ? "O acesso é pelo login institucional: cadastre o mesmo usuário da rede do MPSC." : "Ao criar um usuário ou redefinir a senha, a senha provisória é o usuário seguido do ano corrente (ex.: maria.souza" + hojeISO().slice(0, 4) + "). A pessoa é obrigada a trocá-la no primeiro acesso, e a senha pessoal que ela criar não fica visível para ninguém.") + "</p></div>";
  if (uiUs.senha) {
    h += '<div class="aviso ok senha-provisoria" role="status"><span>Senha provisória de <strong>' + esc(uiUs.senha.login) + '</strong>:</span> <span class="mono" id="senha-prov">' + esc(uiUs.senha.senha) +
      '</span> <button type="button" id="b-copiar-senha" class="pequeno">Copiar</button><br><span class="nota">Informe à pessoa e peça que entre logo e crie a senha pessoal: enquanto isso não acontecer, quem souber o padrão consegue entrar.</span> <button type="button" id="b-fechar-senha" class="pequeno">Já anotei</button></div>';
  }
  if (uiUs.erro) h += '<div class="aviso erro" role="alert">' + esc(uiUs.erro) + "</div>";
  if (uiUs.msg) h += '<div class="aviso info" role="status">' + esc(uiUs.msg) + "</div>";
  h += '<form id="form-novo-usuario" class="campos"><label class="campo" for="u-login">Usuário (para entrar)<small>Ex.: maria.souza</small><input type="text" id="u-login" autocomplete="off" maxlength="40" required></label>' +
    '<label class="campo" for="u-nome">Nome completo<small>Aparece no topo da tela e no histórico.</small><input type="text" id="u-nome" autocomplete="off" maxlength="120" required></label>' +
    '<div class="campo"><span>&nbsp;</span><button type="submit" class="primario">Criar usuário</button></div></form>';
  h += '<div class="tabela"><table><thead><tr><th>Nome</th><th>Usuário</th><th>Situação</th><th>Ações</th></tr></thead><tbody>' + uiUs.lista.map(function (x) {
    var proprio = x.login === estado.usuario.login;
    var sit = x.admin ? '<span class="selo a">Administrador</span>' : x.ativo ? (x.trocarSenha ? '<span class="selo w">Senha provisória</span>' : '<span class="selo ok">Ativo</span>') : '<span class="selo x">Inativo</span>';
    var acoes = '<button type="button" class="pequeno" data-us-renomear="' + esc(x.login) + '">Renomear</button>';
    if (!x.admin && !proprio) {
      acoes += '<button type="button" class="pequeno" data-us-ativo="' + esc(x.login) + '" data-valor="' + (x.ativo ? "0" : "1") + '">' + (x.ativo ? "Inativar" : "Reativar") + "</button>" +
        (sso ? "" : '<button type="button" class="pequeno" data-us-senha="' + esc(x.login) + '">Redefinir senha</button>') +
        '<button type="button" class="pequeno perigo" data-us-excluir="' + esc(x.login) + '">Excluir</button>';
    }
    return "<tr><td>" + esc(x.nome) + (proprio ? ' <span class="nota">(você)</span>' : "") + '</td><td class="mono">' + esc(x.login) + "</td><td>" + sit + '</td><td><div class="acoes">' + acoes + "</div></td></tr>";
  }).join("") + "</tbody></table></div></section>";
  h += '<section class="painel"><h3>Histórico de usuários</h3>' + (uiUs.historico.length ? '<ul class="historico">' + uiUs.historico.map(function (x) {
    return "<li><time>" + esc(new Date(x.quando).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })) + "</time>" + esc(x.usuario) + ": " + esc(x.texto) + "</li>";
  }).join("") + "</ul>" : '<p class="nota">Nenhum registro.</p>') + "</section>";
  return h;
}
function acaoUsuarios(metodo, caminho, corpo, msg) {
  uiUs.erro = ""; uiUs.msg = "";
  return api(metodo, caminho, corpo).then(function (d) {
    aplicarUsuarios(d);
    if (d.senhaProvisoria) uiUs.senha = { login: caminho.split("/")[3] ? decodeURIComponent(caminho.split("/")[3]) : corpo.login.trim().toLowerCase(), senha: d.senhaProvisoria };
    uiUs.msg = msg || ""; desenhar();
    return d;
  }).catch(function (e) { if (e.status === 401) { estado.usuario = null; irPara("entrar"); return; } uiUs.erro = e.message; desenhar(); });
}
function tratarCliqueUsuarios(b) {
  var url = function (login) { return "/api/usuarios/" + encodeURIComponent(login); };
  var pessoa = function (login) { return uiUs.lista.filter(function (x) { return x.login === login; })[0]; };
  if (b.id === "b-fechar-senha") { uiUs.senha = null; desenhar(); return true; }
  if (b.id === "b-copiar-senha") { copiar(uiUs.senha.senha, function () { uiUs.msg = "Senha copiada."; desenhar(); }, function () { uiUs.msg = "Selecione e copie a senha manualmente."; desenhar(); }); return true; }
  if (b.dataset.usRenomear) {
    var p = pessoa(b.dataset.usRenomear), nome = window.prompt("Novo nome de " + p.login + ":", p.nome);
    if (nome && nome.trim() && nome.trim() !== p.nome) acaoUsuarios("PATCH", url(p.login), { nome: nome }, "Usuário renomeado.").then(function () {
      if (p.login === estado.usuario.login) { estado.usuario.nome = normalizar(nome); desenhar(); }
    });
    return true;
  }
  if (b.dataset.usAtivo) {
    var ativo = b.dataset.valor === "1";
    acaoUsuarios("PATCH", url(b.dataset.usAtivo), { ativo: ativo }, ativo ? "Usuário reativado." : "Usuário inativado: não consegue mais entrar, e as sessões abertas foram encerradas.");
    return true;
  }
  if (b.dataset.usSenha) {
    if (window.confirm("Redefinir a senha de " + b.dataset.usSenha + "? A senha atual deixa de valer e a nova senha provisória será " + b.dataset.usSenha + hojeISO().slice(0, 4) + ".")) acaoUsuarios("POST", url(b.dataset.usSenha) + "/senha", undefined, "");
    return true;
  }
  if (b.dataset.usExcluir) {
    if (window.confirm("Excluir definitivamente o usuário " + b.dataset.usExcluir + "? O histórico dos sorteios continua mostrando o nome de quem fez cada alteração. Para apenas bloquear o acesso, use Inativar.")) acaoUsuarios("DELETE", url(b.dataset.usExcluir), undefined, "Usuário excluído.");
    return true;
  }
  return false;
}

/* ---------- eventos ---------- */
var CAMPOS_TEXTO = { text: 1, textarea: 1, email: 1, url: 1 };
app.addEventListener("click", function (e) {
  var a = e.target.closest("[data-ir],[data-ata],[data-ctl],[data-insc],[data-ch]");
  if (a) {
    e.preventDefault();
    if (a.dataset.ata) irPara("ata", a.dataset.ata);
    else if (a.dataset.ctl) irPara("controleSorteio", a.dataset.ctl);
    else if (a.dataset.insc) irPara("inscricao", a.dataset.insc);
    else if (a.dataset.ch) irPara("chamada", a.dataset.ch);
    else irPara(a.dataset.ir);
    return;
  }
  var b = e.target.closest("button"); if (!b) return;
  if (b.id === "b-sair") { api("POST", "/api/logout").finally(function () { estado.usuario = null; controles = {}; equipe = {}; uiUs.lista = null; uiUs.senha = null; irPara("registro"); }); return; }
  if (b.dataset.exportar !== undefined) { exportarExcel(b.dataset.exportar); return; }
  if (tratarCliqueUsuarios(b)) return;
  if (tratarCliqueChamada(b)) return;
  tratarCliqueControle(b);
});
app.addEventListener("submit", function (e) {
  if (e.target.id === "form-inscricao") { e.preventDefault(); enviarInscricao(e.target); return; }
  if (e.target.id === "form-senha") { e.preventDefault(); trocarSenha(); return; }
  if (e.target.id === "form-novo-usuario") {
    e.preventDefault();
    var novo = { login: document.getElementById("u-login").value, nome: document.getElementById("u-nome").value };
    acaoUsuarios("POST", "/api/usuarios", novo, "Usuário criado.").then(function (d) { if (!d) { document.getElementById("u-login").value = novo.login; document.getElementById("u-nome").value = novo.nome; } });
    return;
  }
  if (e.target.id !== "form-login") return;
  e.preventDefault();
  ui.avisoLogin = "";
  api("POST", "/api/login", { login: document.getElementById("l-login").value, senha: document.getElementById("l-senha").value }).then(function (d) {
    estado.usuario = d.usuario; uiUs.msgConta = ""; uiUs.erroConta = "";
    return recarregarEquipe().then(function () { irPara(d.usuario.trocarSenha ? "conta" : "controle"); });
  }).catch(function (err) { ui.avisoLogin = err.message; desenhar(); var s = document.getElementById("l-senha"); if (s) s.focus(); });
});
app.addEventListener("input", function (e) {
  var t = e.target;
  if (t.id === "ctl-emails") { var cid = idControleAtual(); if (cid) uiCtl.emails[cid] = t.value; return; }
  if (t.id === "ch-lote") { var chid = idChamadaAtual(); if (chid) uiCh.lote[chid] = t.value; return; }
  if (t.dataset.form && t.dataset.f && (CAMPOS_TEXTO[t.type] || t.tagName === "TEXTAREA")) { lerCampoForm(t); aposEditarForm(t.dataset.form, false); }
});
app.addEventListener("change", function (e) {
  var t = e.target;
  if (t.id === "ctl-emails" || t.id === "ch-lote" || /^corpo-/.test(t.id) || t.id === "arquivo" || /^[li]-/.test(t.id) || t.name === "i-int" || t.name === "i-atua") return;
  if (t.dataset.form && t.dataset.f && (CAMPOS_TEXTO[t.type] || t.tagName === "TEXTAREA")) return;
  if (tratarMudancaChamada(t)) return;
  tratarMudancaControle(t);
});
window.addEventListener("hashchange", function () {
  telaAtual = null; document.title = "Sorteios CEAF"; desenhar();
  // Busca o estado mais recente (novas inscrições, sorteio automático feito enquanto a página estava aberta).
  (estado.usuario ? recarregarEquipe() : recarregarPublico()).then(desenhar, function () {});
});

/* Logotipos opcionais: escondidos se o arquivo não existir. */
Array.prototype.forEach.call(document.querySelectorAll("[data-logo]"), function (img) {
  function esconder() { img.hidden = true; }
  if (img.complete && !img.naturalWidth) esconder(); else img.addEventListener("error", esconder);
});


/* ---------- exportação para Excel (no navegador, com vendor/xlsx.mini.min.js) ---------- */
(function () {
  function quando(iso, seg) { try { return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: seg ? "medium" : "short" }).replace(",", ""); } catch (e) { return iso; } }
  function dh(v) { return v ? dataBR(v.slice(0, 10)) + " " + v.slice(11, 16) : ""; }
  function sn(v) { return v === 1 ? "Sim" : v === 0 ? "Não" : "Não informado"; }
  function situacaoSorteio(r, i) {
    var res = r.resultado;
    if (res.reservadas.indexOf(i) >= 0) return "Contemplada – vaga reservada";
    if (res.ampla.indexOf(i) >= 0) return fem(r, i, "Contemplada", "Contemplado(a)") + " – ampla concorrência";
    var p = [];
    if (res.suplentesMulheres.indexOf(i) >= 0) p.push((res.suplentesMulheres.indexOf(i) + 1) + "º lugar na suplência das vagas reservadas");
    if (res.suplentesGerais.indexOf(i) >= 0) p.push((res.suplentesGerais.indexOf(i) + 1) + "º lugar na lista geral de suplentes");
    return p.join("; ") || "Não contemplado(a)";
  }
  window.exportarExcel = function (filtro) {
    if (!window.XLSX) { alert("Biblioteca de Excel não carregada."); return; }
    var chs = Object.keys(equipe).map(function (k) { return equipe[k]; }), regs = estado.registros.slice();
    if (filtro) {
      chs = chs.filter(function (c) { return c.id === filtro || c.sorteioId === filtro; });
      var lig = chs.map(function (c) { return c.sorteioId; });
      regs = regs.filter(function (r) { return r.id === filtro || lig.indexOf(r.id) >= 0; });
    }
    var regPorId = {}, ligados = {};
    regs.forEach(function (r) { regPorId[r.id] = r; });
    chs.forEach(function (c) { if (c.sorteioId) ligados[c.sorteioId] = true; });
    var S = [["Código do sorteio", "Registro público", "Evento", "Texto público", "Local", "Início do evento", "Término do evento", "Situação", "Formulário público", "Inscrições – início", "Inscrições – encerramento", "Sorteio previsto para", "Modo do sorteio", "Sorteio realizado em", "Responsável", "Vagas", "Reserva feminina", "Vagas reservadas", "Inscrições recebidas", "Concorrentes", "Convocados no sorteio", "Convocados depois (suplentes)", "Confirmados", "Aguardando confirmação", "Desistências", "Vagas a preencher", "Relatórios entregues", "Relatórios pendentes", "Prazo de confirmação", "Prazo do relatório", "Página pública"]];
    var Vg = [["Registro público", "Evento", "Nº", "Pessoa", "E-mail", "Vaga", "Convocação", "Convocado(a) em", "No lugar de", "Presença", "Relatório", "Entrega do relatório"]];
    var P = [["Código do sorteio", "Registro público", "Evento", "Nome", "E-mail", "Interesse e disponibilidade", "Atua na área", "Origem da inscrição", "Inscrito(a) em", "Concorreu", "Marcada para a reserva feminina", "Resultado do sorteio", "Convocação", "Presença", "Relatório", "Entrega do relatório"]];
    var H = [["Código do sorteio", "Registro público", "Evento", "Data e hora", "Usuário", "Registro"]];
    function resultado(r, c, k) {
      if (k === null || k === undefined) return ["", "", "", "", ""];
      var cv = c.convocacoes.filter(function (x) { return x.idx === k; })[0];
      return [situacaoSorteio(r, k), cv ? rotuloConvocacao(r, cv) : "Não convocado(a)", cv ? ROTULO_PRESENCA[cv.presenca] : "",
        cv && cv.presenca === "confirmada" ? ROTULO_RELATORIO[cv.relatorio] : "", cv && cv.relatorio === "entregue" ? dataBR(cv.dataRelatorio) : ""];
    }
    function sorteio(ch, r) {
      var d = ch ? ch.dados : null, c = r ? controleDe(r.id) : null, ev = c ? c.evento : d.evento, vagas = r ? r.vagas : d.vagas, res = r ? r.reserva : d.reserva;
      var nome = r ? r.nome : d.nome, ins = ch ? ch.inscricoes : [];
      var linha = [ch ? ch.id : "", r ? r.id : "", nome, d ? d.textoPublico : "", ev.local || "", dataBR(ev.inicio), dataBR(ev.fim),
        c ? fase(c).t : { agendado: "Inscrições ainda não abertas", aberto: "Inscrições abertas", encerrado: "Inscrições encerradas – aguardando sorteio" }[situacaoCh(d, null)],
        d ? (d.formularioPublico ? "Sim" : "Não") : "", d ? dh(d.inscricaoInicio) : "", d ? dh(d.inscricaoFim) : "", d ? dh(d.dataSorteio) : "",
        d ? (d.modoSorteio === "automatico" ? "Automático" : "Manual") : "", r ? quando(r.dataHora, true) : "", r ? r.responsavel : d.responsavel, vagas,
        res.ativa ? "Sim (arredondamento para " + (res.arredondamento === "baixo" ? "baixo" : "cima") + ")" : "Não", vagasReservadas(vagas, res),
        ch ? ins.length : r.participantes.length, r ? r.participantes.length : concorrentesDe(ch).length];
      if (!c) return linha.concat(["", "", "", "", "", "", "", "", "", "", linkInscricao(ch.id)]);
      var cv = c.convocacoes, conf = cv.filter(function (x) { return x.presenca === "confirmada"; });
      var ent = conf.filter(function (x) { return x.relatorio === "entregue"; }).length;
      var conta = function (st) { return cv.filter(function (x) { return x.presenca === st; }).length; };
      var abertas = cv.filter(function (x) { return x.presenca === "desistiu" && !substituida(c, x); }).length;
      return linha.concat([cv.filter(function (x) { return x.origem === "sorteio"; }).length, cv.filter(function (x) { return x.origem === "suplente"; }).length,
        conf.length, conta("aguardando"), conta("desistiu"), abertas, ent, conf.length - ent, dataBR(c.prazoConfirmacao), dataBR(c.prazoRelatorio), linkDe(r.id)]);
    }
    function pessoas(ch, r) {
      var c = r ? controleDe(r.id) : null, nomeEv = r ? r.nome : ch.dados.nome, porNome = {};
      if (r) r.participantes.forEach(function (n, k) { porNome[n.toLowerCase()] = k; });
      if (ch) ch.inscricoes.forEach(function (i) {
        var fora = motivoFora(ch.dados, i), k = r && !fora ? porNome[i.nome.toLowerCase()] : null;
        P.push([ch.id, r ? r.id : "", nomeEv, i.nome, (c && k != null && c.emails[k]) || i.email, sn(i.interesse), sn(i.atua),
          i.origem === "formulario" ? "Formulário público" : "Lançada pela equipe", quando(i.criado_em), fora ? "Não – " + fora : "Sim",
          ch.dados.reserva.ativa ? (i.mulher ? "Sim" : "Não") : ""].concat(r ? resultado(r, c, k) : ["Aguardando sorteio", "", "", "", ""]));
      });
      else r.participantes.forEach(function (n, k) {
        P.push(["", r.id, nomeEv, n, c.emails[k] || "", "", "", "Lista informada no sorteio", "", "Sim", r.reserva.ativa ? (r.mulheres.indexOf(k) >= 0 ? "Sim" : "Não") : ""].concat(resultado(r, c, k)));
      });
    }
    function vagasDe(r) {
      var c = controleDe(r.id);
      c.convocacoes.forEach(function (cv, n) {
        Vg.push([r.id, r.nome, n + 1, r.participantes[cv.idx], c.emails[cv.idx] || "", cv.vaga === "reservada" ? "Reservada" : "Ampla concorrência",
          cv.origem === "sorteio" ? "Contemplado(a) no sorteio" : "Suplente convocado(a)", dataBR(cv.convocadaEm), cv.substitui != null ? r.participantes[cv.substitui] : "",
          ROTULO_PRESENCA[cv.presenca], cv.presenca === "confirmada" ? ROTULO_RELATORIO[cv.relatorio] : "", cv.relatorio === "entregue" ? dataBR(cv.dataRelatorio) : ""]);
      });
    }
    chs.forEach(function (ch) {
      var r = ch.sorteioId ? regPorId[ch.sorteioId] : null;
      S.push(sorteio(ch, r)); pessoas(ch, r); if (r) vagasDe(r);
      var hs = ch.historico.slice(); if (r && controles[r.id]) hs = hs.concat(controles[r.id].historico || []);
      hs.sort(function (a, b) { return a.quando < b.quando ? -1 : 1; }).forEach(function (h) { H.push([ch.id, r ? r.id : "", r ? r.nome : ch.dados.nome, quando(h.quando), h.usuario, h.texto]); });
    });
    regs.forEach(function (r) {
      if (ligados[r.id] || !controleDe(r.id)) return;
      S.push(sorteio(null, r)); pessoas(null, r); vagasDe(r);
      (controles[r.id].historico || []).forEach(function (h) { H.push(["", r.id, r.nome, quando(h.quando), h.usuario, h.texto]); });
    });
    var wb = XLSX.utils.book_new();
    [[S, "Sorteios"], [Vg, "Vagas e presença"], [P, "Inscritos"], [H, "Histórico"]].forEach(function (x) {
      var ws = XLSX.utils.aoa_to_sheet(x[0]);
      ws["!cols"] = x[0][0].map(function (_, j) { return { wch: Math.max(10, Math.min(60, Math.max.apply(null, x[0].map(function (l) { return String(l[j] == null ? "" : l[j]).length; })) + 2)) }; });
      ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: x[0].length - 1, c: x[0][0].length - 1 } }) };
      XLSX.utils.book_append_sheet(wb, ws, x[1]);
    });
    XLSX.writeFile(wb, (filtro ? "sorteio-" + filtro : "sorteios-ceaf") + "-" + hojeISO() + ".xlsx");
  };
})();

/* ---------- início ---------- */
Promise.all([api("GET", "/api/sessao"), recarregarPublico()]).then(function (res) {
  estado.usuario = res[0].usuario; estado.modoLogin = res[0].modoLogin; estado.urlBase = res[0].urlBase; estado.dominiosEmail = res[0].dominiosEmail || [];
  return recarregarEquipe();
}).catch(function (e) {
  estado.erro = /config.js/.test(e.message) ? e.message : "Não foi possível carregar os sorteios. Recarregue a página; se o problema continuar, avise o CEAF.";
}).then(function () {
  estado.carregado = true;
  desenhar();
});
})();
