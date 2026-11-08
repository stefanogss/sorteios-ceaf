/* Testes do servidor (apps-script/Codigo.gs) rodando no simulador do Google. Abra testes-servidor.html. */
(function () {
  "use strict";
  var SIM = window.SIMULADOR, saida = document.getElementById("saida"), falhas = 0, total = 0;
  function confere(cond, texto) {
    total++; if (!cond) falhas++;
    var li = document.createElement("li");
    li.textContent = (cond ? "[OK]    " : "[FALHA] ") + texto;
    li.className = cond ? "ok" : "falha";
    saida.appendChild(li);
  }
  function chamar(metodo, caminho, corpo, token) { return SIM.chamar({ metodo: metodo, caminho: caminho, corpo: corpo, token: token }); }
  function dh(min) {
    var p = {};
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(Date.now() + min * 60000)).forEach(function (x) { p[x.type] = x.value; });
    return p.year + "-" + p.month + "-" + p.day + "T" + p.hour + ":" + p.minute;
  }
  var ANO = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 4);
  function chamada(extra) {
    var d = { nome: "Seminário de Teste", responsavel: "Residente Teste", vagas: 3, reserva: { ativa: true, arredondamento: "cima" },
      evento: { inicio: "2026-12-10", fim: "2026-12-11", local: "Florianópolis/SC" }, textoPublico: "Seminário sobre direito ambiental.",
      formularioPublico: true, linkExterno: "", exigeAtuacao: true, inscricaoInicio: dh(-60), inscricaoFim: dh(60), dataSorteio: dh(120),
      modoSorteio: "manual", sementeExterna: "" };
    Object.keys(extra || {}).forEach(function (k) { d[k] = extra[k]; });
    return d;
  }
  function inscricao(nome, extra) {
    var d = { nome: nome, email: nome.split(" ")[0].toLowerCase() + "@mpsc.mp.br", interesse: "sim", atua: "sim", ciente: true };
    Object.keys(extra || {}).forEach(function (k) { d[k] = extra[k]; });
    return d;
  }

  SIM.zerar(); window.GAS_configurar();
  SIM.mundo().props.GITHUB_TOKEN = "token-simulado";
  SIM.mundo().props.GITHUB_REPOSITORIO = "ceaf/sorteios";

  // ---------- acesso e administrador ----------
  confere(chamar("GET", "/api/sessao").dados.usuario === null, "Visitante sem login não tem sessão");
  confere(chamar("POST", "/api/chamadas", chamada()).status === 401, "Criar sorteio exige login");
  confere(chamar("POST", "/api/login", { login: "admin", senha: "errada" }).status === 401, "Senha errada é recusada");
  var r = chamar("POST", "/api/login", { login: "Admin", senha: "admin" + ANO });
  var tAdmin = r.dados && r.dados.token;
  confere(r.ok && r.dados.usuario.admin && r.dados.usuario.trocarSenha, "Administrador inicial: admin + ano, com troca obrigatória");
  confere(chamar("GET", "/api/controle", undefined, tAdmin).status === 403, "Antes da troca da senha provisória, nada além de Minha conta funciona");
  confere(chamar("POST", "/api/conta/senha", { atual: "admin" + ANO, nova: "admin" + ANO }, tAdmin).status === 422, "Não é possível manter a senha provisória");
  confere(chamar("POST", "/api/conta/senha", { atual: "admin" + ANO, nova: "nova-senha-do-admin" }, tAdmin).ok, "Administrador troca a própria senha");
  confere(chamar("GET", "/api/usuarios", undefined, tAdmin).ok, "Depois da troca, o administrador acessa o painel de usuários");
  var novo = chamar("POST", "/api/usuarios", { login: "residente", nome: "Residente Teste" }, tAdmin);
  confere(novo.ok && novo.dados.senhaProvisoria === "residente" + ANO && novo.dados.usuarios.every(function (u) { return !("senha" in u); }), "Novo usuário com senha provisória padrão; a lista não expõe senhas");
  var guardada = SIM.mundo().abas.usuarios.filter(function (l) { return l[0] === "residente"; })[0][2];
  confere(/^pbkdf2\$/.test(guardada) && guardada.indexOf("residente" + ANO) < 0, "A planilha guarda só o hash da senha");
  var t = chamar("POST", "/api/login", { login: "residente", senha: "residente" + ANO }).dados.token;
  chamar("POST", "/api/conta/senha", { atual: "residente" + ANO, nova: "senha-pessoal-residente" }, t);
  confere(chamar("GET", "/api/usuarios", undefined, t).status === 403, "Usuário comum não acessa o painel de usuários");

  // ---------- criação ----------
  confere(chamar("POST", "/api/chamadas", chamada({ vagas: 0 }), t).status === 422, "Zero vagas é recusado");
  confere(chamar("POST", "/api/chamadas", chamada({ vagas: 101 }), t).status === 422, "Mais de 100 vagas é recusado");
  confere(chamar("POST", "/api/chamadas", chamada({ dataSorteio: dh(30) }), t).status === 422, "Sorteio antes do fim das inscrições é recusado");
  var a = chamar("POST", "/api/chamadas", chamada(), t).dados;
  confere(a && a.id === "c" + ANO + "-001" && a.situacao === "aberto", "Sorteio criado com inscrições abertas (" + (a && a.id) + ")");
  var pub = chamar("GET", "/api/chamadas").dados;
  confere(pub.length === 1 && !("inscricoes" in pub[0]), "Página pública mostra o sorteio, sem dados pessoais");

  // ---------- formulário público ----------
  var url = "/api/chamadas/" + a.id + "/inscricoes";
  confere(chamar("POST", url, inscricao("Ana Souza", { email: "ana@gmail.com" })).status === 422, "E-mail não institucional é recusado");
  confere(chamar("POST", url, inscricao("Ana Souza", { ciente: false })).status === 422, "Sem ciência da publicação do nome é recusado");
  confere(chamar("POST", url, inscricao("Ana")).status === 422, "Nome incompleto é recusado");
  confere(chamar("POST", url, inscricao("Robo Teste", { site: "x" })).status === 422, "Campo invisível preenchido (robô) é recusado");
  var PESSOAS = ["Ana Souza", "Bruno Lima", "Carla Dias", "Diego Alves", "Elisa Ramos", "Fábio Costa", "Gabriela Nunes", "Heitor Prado"];
  var resps = PESSOAS.map(function (n) { return chamar("POST", url, inscricao(n)); });
  confere(resps.every(function (x) { return x.ok; }) && resps[7].dados.numero === 8, "8 inscrições recebidas pelo formulário público, sem login");
  confere(chamar("POST", url, inscricao("Outra Pessoa", { email: "ana@mpsc.mp.br" })).status === 409, "E-mail repetido é recusado");
  confere(chamar("POST", url, inscricao("ana  souza", { email: "ana2@mpsc.mp.br" })).status === 409, "Nome repetido é recusado");
  chamar("POST", url, inscricao("Igor Sem Tempo", { interesse: "nao" }));
  chamar("POST", url, inscricao("Julia Outra Area", { atua: "nao" }));
  var form = chamar("POST", url, inscricao("=HYPERLINK(\"x\") Teste", { email: "formula@mpsc.mp.br" }));
  confere(form.ok, "Nome que começa com '=' é guardado como texto, sem virar fórmula na planilha");
  var lote = chamar("POST", "/api/chamadas/" + a.id + "/inscricoes/equipe", { texto: "Karla Externa; karla@tjsc.jus.br\nBruno Lima; outro@mpsc.mp.br\n0012345 Numerico" }, t).dados;
  confere(lote.incluidas.length === 2 && lote.recusadas.length === 1, "Equipe lança inscrições em lote; repetidas são recusadas");
  var ch = chamar("GET", "/api/equipe/chamadas", undefined, t).dados[a.id];
  confere(ch.inscricoes.some(function (i) { return i.nome === "0012345 Numerico"; }), "Texto que parece número não é convertido pela planilha");
  confere(chamar("POST", "/api/chamadas/" + a.id + "/sortear", undefined, t).status === 409, "Não sorteia com as inscrições abertas");

  // ---------- encerramento e preparação ----------
  var novoD = JSON.parse(JSON.stringify(ch.dados)); novoD.inscricaoFim = dh(-1); novoD.dataSorteio = dh(0);
  confere(chamar("PUT", "/api/chamadas/" + a.id, { dados: novoD, versao: ch.versao - 1 }, t).status === 409, "Edição simultânea do sorteio é detectada");
  var g = chamar("PUT", "/api/chamadas/" + a.id, { dados: novoD, versao: ch.versao }, t).dados;
  confere(g.situacao === "encerrado", "Encerramento alterado; inscrições fechadas");
  confere(chamar("POST", url, inscricao("Tarde Demais")).status === 409, "Inscrição depois do encerramento é recusada");
  var seq = {}; g.inscricoes.forEach(function (i) { seq[i.nome] = i.seq; });
  ["Ana Souza", "Carla Dias", "Elisa Ramos", "Gabriela Nunes"].forEach(function (n) { chamar("PATCH", "/api/chamadas/" + a.id + "/inscricoes/" + seq[n], { mulher: true }, t); });
  confere(chamar("PATCH", "/api/chamadas/" + a.id + "/inscricoes/" + seq["Heitor Prado"], { excluida: " " }, t).status === 422, "Exclusão sem motivo é recusada");
  chamar("PATCH", "/api/chamadas/" + a.id + "/inscricoes/" + seq["Heitor Prado"], { excluida: "Inscrição em duplicidade" }, t);
  chamar("PATCH", "/api/chamadas/" + a.id + "/inscricoes/" + seq["0012345 Numerico"], { excluida: "Teste" }, t);
  chamar("PATCH", "/api/chamadas/" + a.id + "/inscricoes/" + seq["=HYPERLINK(\"x\") Teste"], { excluida: "Teste" }, t);
  confere(chamar("POST", "/api/chamadas/" + a.id + "/sortear", undefined, t).status === 409, "Não sorteia sem confirmar as inscritas");
  chamar("POST", "/api/chamadas/" + a.id + "/confirmacao", { confirmar: true }, t);
  g = chamar("PATCH", "/api/chamadas/" + a.id + "/inscricoes/" + seq["Elisa Ramos"], { mulher: false }, t).dados;
  confere(g.confirmacao === null, "Alterar a marcação desfaz a confirmação");
  chamar("PATCH", "/api/chamadas/" + a.id + "/inscricoes/" + seq["Elisa Ramos"], { mulher: true }, t);
  chamar("POST", "/api/chamadas/" + a.id + "/confirmacao", { confirmar: true }, t);

  // ---------- sorteio manual ----------
  SIM.github = [];
  var s1 = chamar("POST", "/api/chamadas/" + a.id + "/sortear", undefined, t), r1 = s1.dados;
  confere(s1.ok && r1.id === "s" + ANO + "-001", "Sorteio manual realizado (" + (r1 && r1.id) + ")");
  confere(JSON.stringify(r1.participantes) === JSON.stringify(["Ana Souza", "Bruno Lima", "Carla Dias", "Diego Alves", "Elisa Ramos", "Fábio Costa", "Gabriela Nunes", "Karla Externa"]),
    "Concorrem só as inscrições válidas, na ordem de chegada");
  confere(JSON.stringify(r1.mulheres) === "[0,2,4,6]" && r1.resultado.reservadas.length === 2, "2 vagas reservadas (de 3) para as inscritas marcadas");
  confere(r1.inscricao.chamada === a.id && r1.inscricao.inscricoesRecebidas === 13, "Ata registra o período de inscrição e o total recebido");
  confere(window.GAS_verificarCadeia([r1]).length === 0, "O registro confere (semente, resultado, hash)");
  confere(SIM.github.length === 1 && /contents\/registros\/s\d{4}-001\.json$/.test(SIM.github[0].url), "Cópia do sorteio enviada ao repositório do GitHub");
  confere(chamar("POST", "/api/chamadas/" + a.id + "/sortear", undefined, t).status === 409, "O mesmo sorteio não pode ser repetido");
  confere(chamar("PATCH", "/api/chamadas/" + a.id + "/inscricoes/" + seq["Ana Souza"], { mulher: false }, t).status === 409, "Inscrições ficam travadas depois do sorteio");
  ch = chamar("GET", "/api/equipe/chamadas", undefined, t).dados[a.id];
  var alt = JSON.parse(JSON.stringify(ch.dados)); alt.textoPublico = "Texto novo."; alt.vagas = 50;
  var tx = chamar("PUT", "/api/chamadas/" + a.id, { dados: alt, versao: ch.versao }, t).dados;
  confere(tx.dados.textoPublico === "Texto novo." && tx.dados.vagas === 3, "Depois do sorteio, só o texto público pode mudar");
  var ctl = chamar("GET", "/api/controle", undefined, t).dados[r1.id];
  confere(ctl.dados.convocacoes.length === 3 && ctl.dados.emails["0"] === "ana@mpsc.mp.br", "Controle já nasce com os e-mails do formulário");

  // ---------- falha do GitHub e nova tentativa ----------
  SIM.githubFalha = true;
  var b = chamar("POST", "/api/chamadas", chamada({ nome: "Curso Automático", vagas: 25, reserva: { ativa: false }, formularioPublico: false,
    inscricaoInicio: dh(-120), inscricaoFim: dh(-60), dataSorteio: dh(-1), modoSorteio: "automatico" }), t).dados;
  var nomes = []; for (var k = 0; k < 30; k++) nomes.push("Pessoa Numero " + k);
  chamar("POST", "/api/chamadas/" + b.id + "/inscricoes/equipe", { texto: nomes.join("\n") }, t);
  confere(chamar("POST", "/api/chamadas/" + b.id + "/sortear", undefined, t).status === 409, "Sorteio automático não pode ser feito pelo botão manual");
  var d = chamar("POST", "/api/chamadas", chamada({ nome: "Automático pendente", modoSorteio: "automatico", inscricaoInicio: dh(-120), inscricaoFim: dh(-60), dataSorteio: dh(-1) }), t).dados;
  chamar("POST", "/api/chamadas/" + d.id + "/inscricoes/equipe", { texto: "Maria Teste\nJoão Teste" }, t);
  SIM.tarefaPeriodica();
  var todas = chamar("GET", "/api/equipe/chamadas", undefined, t).dados;
  confere(todas[b.id].sorteioId && JSON.parse(SIM.mundo().abas.sorteios[2][2]).resultado.ampla.length === 25, "A tarefa periódica faz o sorteio automático vencido (25 vagas)");
  confere(!todas[d.id].sorteioId && /suspenso/.test(todas[d.id].aviso || ""), "Sem confirmação das inscritas, o automático fica suspenso com aviso");
  confere(String(SIM.mundo().abas.sorteios[2][5]).indexOf("pendente") === 0, "Com o GitHub fora do ar, a cópia fica pendente");
  SIM.githubFalha = false;
  SIM.tarefaPeriodica();
  confere(chamar("GET", "/api/equipe/chamadas", undefined, t).dados[d.id].historico.filter(function (h) { return /suspenso/.test(h.texto); }).length === 1, "O aviso de suspensão entra uma única vez no histórico");
  confere(String(SIM.mundo().abas.sorteios[2][5]).indexOf("ok") === 0, "Na rodada seguinte, a cópia pendente é publicada no GitHub");
  chamar("POST", "/api/chamadas/" + d.id + "/confirmacao", { confirmar: true }, t);
  SIM.tarefaPeriodica();
  confere(!!chamar("GET", "/api/equipe/chamadas", undefined, t).dados[d.id].sorteioId, "Confirmadas as inscritas, o automático é feito na rodada seguinte");

  // ---------- registro público ----------
  var lista = chamar("GET", "/api/sorteios").dados;
  confere(lista.length === 3 && lista[1].anterior === lista[0].hash && lista[2].anterior === lista[1].hash, "Registros encadeados pelo hash");
  var sd = chamar("GET", "/api/saude").dados;
  confere(sd.ok && sd.registros === 3, "Verificação de saúde: cadeia íntegra");
  var copia = SIM.mundo().abas.sorteios[1].slice(); var reg = JSON.parse(copia[2]); reg.participantes[0] = "Adulterado";
  SIM.mundo().abas.sorteios[1][2] = JSON.stringify(reg);
  confere(!chamar("GET", "/api/saude").dados.ok, "Alteração manual na planilha é detectada pela verificação");
  SIM.mundo().abas.sorteios[1] = copia;

  // ---------- controle ----------
  var dados = ctl.dados;
  dados.convocacoes[0].presenca = "desistiu";
  var gc = chamar("PUT", "/api/controle/" + r1.id, { dados: dados, versao: ctl.versao, acao: "Teste: desistência." }, t);
  confere(gc.ok && gc.dados.historico[gc.dados.historico.length - 1].usuario === "Residente Teste", "Controle gravado; histórico registra quem alterou");
  confere(chamar("PUT", "/api/controle/" + r1.id, { dados: dados, versao: ctl.versao, acao: "x" }, t).status === 409, "Edição simultânea do controle é detectada");

  // ---------- usuários ----------
  chamar("PATCH", "/api/usuarios/residente", { nome: "Residente Renomeada" }, tAdmin);
  confere(chamar("GET", "/api/sessao", undefined, t).dados.usuario.nome === "Residente Renomeada", "Administrador renomeia o usuário");
  confere(chamar("PATCH", "/api/usuarios/admin", { ativo: false }, tAdmin).status === 422, "Administrador não pode se inativar");
  chamar("PATCH", "/api/usuarios/residente", { ativo: false }, tAdmin);
  confere(chamar("GET", "/api/controle", undefined, t).status === 401, "Inativar derruba a sessão aberta");
  chamar("PATCH", "/api/usuarios/residente", { ativo: true }, tAdmin);
  var prov = chamar("POST", "/api/usuarios/residente/senha", undefined, tAdmin).dados.senhaProvisoria;
  confere(prov === "residente" + ANO && chamar("POST", "/api/login", { login: "residente", senha: "senha-pessoal-residente" }).status === 401, "Redefinição volta à senha padrão e invalida a pessoal");
  chamar("DELETE", "/api/usuarios/residente", undefined, tAdmin);
  confere(chamar("POST", "/api/login", { login: "residente", senha: prov }).status === 401, "Usuário excluído perde o acesso");
  var hu = chamar("GET", "/api/usuarios", undefined, tAdmin).dados.historico;
  confere(hu.some(function (h) { return /excluído/.test(h.texto); }) && hu.some(function (h) { return /renomeado/.test(h.texto); }), "Histórico de usuários registra as ações do administrador");
  for (var n = 0; n < 10; n++) chamar("POST", "/api/login", { login: "admin", senha: "errada" });
  confere(chamar("POST", "/api/login", { login: "admin", senha: "nova-senha-do-admin" }).status === 429, "Após 10 tentativas erradas, o login fica bloqueado por 15 minutos");
  chamar("POST", "/api/logout", undefined, tAdmin);
  confere(chamar("GET", "/api/usuarios", undefined, tAdmin).status === 401, "Após sair, o token deixa de valer");

  document.getElementById("registro").textContent = JSON.stringify(lista, null, 2);
  var res = document.getElementById("resultado");
  res.textContent = "RESULTADO: " + (falhas ? falhas + " falha(s) de " + total : "tudo certo (" + total + " verificações)");
  res.className = falhas ? "falha" : "ok";
})();
